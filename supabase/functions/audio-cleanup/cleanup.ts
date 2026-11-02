export interface CleanupConfig {
  url: string;
  serviceKey: string;
  cleanupSecret: string;
  fetch?: typeof globalThis.fetch;
}

type CleanupRow = {
  item_result_id: string;
  object_path: string;
  effective_deadline: string;
};

type Fetcher = typeof globalThis.fetch;

const BATCH_SIZE = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_SEGMENT = /^[\p{L}\p{N}._ -]+$/u;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function validConfig(config: CleanupConfig): void {
  if (!config.url || !config.serviceKey || !config.cleanupSecret) {
    throw new Error("BASIRA_AUDIO_CLEANUP_SECRET, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  if (new TextEncoder().encode(config.cleanupSecret).byteLength < 32) {
    throw new Error("BASIRA_AUDIO_CLEANUP_SECRET must be at least 32 bytes");
  }
  const parsed = new URL(config.url);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  const dockerGateway = parsed.hostname === "kong" && parsed.port === "8000";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && (loopback || dockerGateway))) {
    throw new Error("SUPABASE_URL must use HTTPS");
  }
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

// SHA-256 gives both values the same length; the comparison itself does not early exit.
async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

async function signedCleanupToken(secret: string, timestamp: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`basira-audio-cleanup:${timestamp}`)));
  return [...signature].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalAudioPath(path: string): boolean {
  const parts = path.split("/");
  return (
    parts.length === 4 &&
    parts[0] === "audio" &&
    UUID.test(parts[1]) &&
    UUID.test(parts[2]) &&
    parts[3].endsWith(".wav") &&
    parts[3].length > 4 &&
    SAFE_SEGMENT.test(parts[3].slice(0, -4))
  );
}

function validCleanupRow(value: unknown): value is CleanupRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<CleanupRow>;
  return (
    typeof row.item_result_id === "string" && UUID.test(row.item_result_id) &&
    typeof row.object_path === "string" && canonicalAudioPath(row.object_path) &&
    typeof row.effective_deadline === "string" && !Number.isNaN(Date.parse(row.effective_deadline))
  );
}

function endpoint(base: string, suffix: string): string {
  return `${base.replace(/\/$/, "")}${suffix}`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createHandler(config: CleanupConfig): (request: Request) => Promise<Response> {
  validConfig(config);
  const fetcher: Fetcher = config.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") throw new Error("fetch is required");
  const baseUrl = config.url.replace(/\/$/, "");
  const commonHeaders = {
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
    "content-type": "application/json",
  };

  async function rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetcher(endpoint(baseUrl, `/rest/v1/rpc/${name}`), {
      method: "POST",
      headers: { ...commonHeaders, Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
    const payload = await readJson(response);
    if (!response.ok) throw new Error(`RPC ${name} failed (${response.status})`);
    return payload;
  }

  async function deleteObject(path: string): Promise<void> {
    // Equivalent to storage.from('audio').remove([path]). The bucket and the
    // full object key are distinct; never strip the key's canonical audio/ prefix.
    const response = await fetcher(endpoint(baseUrl, "/storage/v1/object/audio"), {
      method: "DELETE",
      headers: commonHeaders,
      body: JSON.stringify({ prefixes: [path] }),
    });
    if (!response.ok) throw new Error(`Storage deletion failed (${response.status})`);
  }

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const supplied = request.headers.get("authorization");
    if (!supplied || !/^Bearer [^\s]+$/.test(supplied)) {
      return json({ error: "unauthorized" }, 401);
    }
    const timestamp = request.headers.get("x-basira-cleanup-timestamp");
    if (timestamp !== null && (!/^[0-9]{10,12}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 60)) {
      return json({ error: "unauthorized" }, 401);
    }
    const expectedToken = timestamp === null ? config.cleanupSecret : await signedCleanupToken(config.cleanupSecret, timestamp);
    if (!(await timingSafeEqual(supplied.slice("Bearer ".length), expectedToken))) {
      return json({ error: "unauthorized" }, 401);
    }

    try {
      // Exactly one bounded batch is handled per invocation. The scheduler calls
      // us again five minutes later, so a large backlog cannot monopolize a run.
      const discovered = await rpc("expired_audio_paths", { batch_size: BATCH_SIZE });
      if (!Array.isArray(discovered) || discovered.length > BATCH_SIZE || !discovered.every(validCleanupRow)) {
        throw new Error("cleanup discovery returned malformed rows");
      }
      const rows = discovered as CleanupRow[];
      for (const row of rows) await deleteObject(row.object_path);

      let confirmed: unknown[] = [];
      if (rows.length > 0) {
        const acknowledgement = await rpc("confirm_audio_deleted", {
          items: rows.map(({ item_result_id, object_path }) => ({ item_result_id, object_path })),
        });
        if (!Array.isArray(acknowledgement)) throw new Error("cleanup acknowledgement returned malformed rows");
        confirmed = acknowledgement;
      }
      return json({ examined: rows.length, deleted: rows.length, confirmed: confirmed.length });
    } catch (error) {
      // Never acknowledge a failed Storage deletion or DB call. The next bounded
      // invocation will retry; details stay server-side and secrets stay private.
      const message = error instanceof Error ? error.message : "";
      const safeReason = /^(RPC [a-z_]+ failed \([0-9]{3}\)|Storage deletion failed \([0-9]{3}\)|cleanup (discovery|acknowledgement) returned malformed rows)$/.test(message)
        ? message : "network_or_unexpected_error";
      console.error("audio_cleanup_failed:", safeReason);
      return json({ error: "cleanup_failed" }, 502);
    }
  };
}
