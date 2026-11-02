import assert from "node:assert/strict";
import { test } from "node:test";
import { createHandler } from "../functions/audio-cleanup/cleanup.ts";

const secret = "s".repeat(32);
const serviceUrl = "https://project.supabase.co";
const childId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const audioPath = `audio/${childId}/${sessionId}/${itemId}.wav`;
const row = {
  item_result_id: itemId,
  object_path: audioPath,
  effective_deadline: "2026-01-01T00:00:00.000Z",
};
const uuidV7 = "018f3d5e-7abc-7def-8abc-0123456789ab";
const unrestrictedCanonicalUuid = "33333333-3333-4333-f333-333333333333";

type Call = { url: string; init?: RequestInit };
type Mock = (call: Call, index: number) => Response | Promise<Response>;

function makeFetch(mock: Mock, calls: Call[]) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call = { url: String(input), init };
    calls.push(call);
    return mock(call, calls.length - 1);
  };
}

function handler(mock: Mock, calls: Call[] = []) {
  return {
    calls,
    run: createHandler({
      url: serviceUrl,
      serviceKey: "service-role-test-key",
      cleanupSecret: secret,
      fetch: makeFetch(mock, calls),
    }),
  };
}

function rpcResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function authRequest(value = `Bearer ${secret}`) {
  return new Request("https://function.test", {
    method: "POST",
    headers: { authorization: value },
  });
}

function isStorageDelete(call: Call): boolean {
  return call.url.endsWith("/storage/v1/object/audio");
}

test("rejects missing and malformed authorization before network access", async () => {
  const calls: Call[] = [];
  const { run } = handler(() => rpcResponse([]), calls);
  assert.equal((await run(new Request("https://function.test", { method: "POST" }))).status, 401);
  assert.equal((await run(authRequest("Basic not-a-bearer-token"))).status, 401);
  assert.equal(calls.length, 0);
});

test("rejects a non-POST request, including one with wrong authorization, before network access", async () => {
  const calls: Call[] = [];
  const { run } = handler(() => rpcResponse([]), calls);
  const response = await run(new Request("https://function.test", {
    method: "GET",
    headers: { authorization: "Bearer wrong" },
  }));
  assert.equal(response.status, 405);
  assert.equal(calls.length, 0);
});

test("rejects missing environment/configuration with no default secret", () => {
  assert.throws(() => createHandler({ url: "", serviceKey: "", cleanupSecret: "" }), /required/);
  assert.throws(() => createHandler({ url: serviceUrl, serviceKey: "key", cleanupSecret: "short" }), /32 bytes/);
});

test("returns failure on discovery DB error and does not attempt deletion", async () => {
  const calls: Call[] = [];
  const { run } = handler(() => rpcResponse({ message: "db down" }, 500), calls);
  const response = await run(authRequest());
  assert.equal(response.status, 502);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /rpc\/expired_audio_paths$/);
});

test("does not acknowledge when Storage API deletion fails", async () => {
  const calls: Call[] = [];
  const { run } = handler((call) => {
    if (call.url.endsWith("expired_audio_paths")) return rpcResponse([row]);
    if (isStorageDelete(call)) return rpcResponse({ error: "denied" }, 500);
    return rpcResponse([{ item_result_id: itemId }]);
  }, calls);
  const response = await run(authRequest());
  assert.equal(response.status, 502);
  assert.equal(calls.filter((call) => call.url.endsWith("confirm_audio_deleted")).length, 0);
});

test("acknowledges only after successful bulk delete and confirm RPC", async () => {
  const calls: Call[] = [];
  const { run } = handler((call) => {
    if (call.url.endsWith("expired_audio_paths")) return rpcResponse([row]);
    if (isStorageDelete(call)) return new Response(null, { status: 204 });
    return rpcResponse([{ item_result_id: itemId, object_path: audioPath }]);
  }, calls);
  const response = await run(authRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { examined: 1, deleted: 1, confirmed: 1 });
  assert.equal(calls.filter((call) => call.url.endsWith("confirm_audio_deleted")).length, 1);
  const confirmCall = calls.find((call) => call.url.endsWith("confirm_audio_deleted"));
  assert.equal(confirmCall?.url, `${serviceUrl}/rest/v1/rpc/confirm_audio_deleted`);
  assert.deepEqual(JSON.parse(String(confirmCall?.init?.body)), {
    items: [{ item_result_id: itemId, object_path: audioPath }],
  });
});

test("accepts UUIDv7 and other canonical UUID variants without version or variant filtering", async () => {
  const rows = [
    {
      ...row,
      item_result_id: uuidV7,
      object_path: `audio/${childId}/${sessionId}/${uuidV7}.wav`,
    },
    {
      ...row,
      item_result_id: unrestrictedCanonicalUuid,
      object_path: `audio/${childId}/${sessionId}/${unrestrictedCanonicalUuid}.wav`,
    },
  ];
  const calls: Call[] = [];
  const { run } = handler((call) => {
    if (call.url.endsWith("expired_audio_paths")) return rpcResponse(rows);
    if (isStorageDelete(call)) return new Response(null, { status: 204 });
    return rpcResponse(rows.map(({ item_result_id, object_path }) => ({ item_result_id, object_path })));
  }, calls);
  const response = await run(authRequest());
  assert.equal(response.status, 200);
  const confirmCall = calls.find((call) => call.url.endsWith("confirm_audio_deleted"));
  assert.deepEqual(JSON.parse(String(confirmCall?.init?.body)), {
    items: rows.map(({ item_result_id, object_path }) => ({ item_result_id, object_path })),
  });
});

test("sends an encoded Unicode and dotted item name as the full JSON path, not a URL transform", async () => {
  const unicodePath = `audio/${childId}/${sessionId}/كلمة .1.wav`;
  const unicodeRow = { ...row, object_path: unicodePath };
  const calls: Call[] = [];
  const { run } = handler((call) => {
    if (call.url.endsWith("expired_audio_paths")) return rpcResponse([unicodeRow]);
    if (isStorageDelete(call)) {
      assert.deepEqual(JSON.parse(String(call.init?.body)), { prefixes: [unicodePath] });
      return new Response(null, { status: 204 });
    }
    return rpcResponse([{ item_result_id: itemId, object_path: unicodePath }]);
  }, calls);
  assert.equal((await run(authRequest())).status, 200);
  assert.equal(calls.filter(isStorageDelete).length, 1);
});

test("rejects oversized discovery before any Storage delete", async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({
    ...row,
    item_result_id: `${itemId.slice(0, -2)}${String(index).padStart(2, "0")}`,
  }));
  const calls: Call[] = [];
  const { run } = handler((call) => call.url.endsWith("expired_audio_paths")
    ? rpcResponse(rows)
    : new Response(null, { status: 204 }), calls);
  const response = await run(authRequest());
  assert.equal(response.status, 502);
  assert.equal(calls.filter(isStorageDelete).length, 0);
  assert.equal(calls.filter((call) => call.url.endsWith("confirm_audio_deleted")).length, 0);
});

test("rejects malformed discovery rows before any Storage delete", async () => {
  const calls: Call[] = [];
  const { run } = handler((call) => call.url.endsWith("expired_audio_paths")
    ? rpcResponse([{ ...row, item_result_id: "not-a-uuid" }])
    : new Response(null, { status: 204 }), calls);
  const response = await run(authRequest());
  assert.equal(response.status, 502);
  assert.equal(calls.filter(isStorageDelete).length, 0);
  assert.equal(calls.filter((call) => call.url.endsWith("confirm_audio_deleted")).length, 0);
});

test("does not report confirmation when the acknowledgement RPC fails", async () => {
  const calls: Call[] = [];
  const { run } = handler((call) => {
    if (call.url.endsWith("expired_audio_paths")) return rpcResponse([row]);
    if (isStorageDelete(call)) return new Response(null, { status: 204 });
    if (call.url.endsWith("confirm_audio_deleted")) return rpcResponse({ message: "db down" }, 500);
    return rpcResponse([]);
  }, calls);
  const response = await run(authRequest());
  assert.equal(response.status, 502);
  assert.equal(calls.filter(isStorageDelete).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("confirm_audio_deleted")).length, 1);
});

test("handles a deadline race as a no-ack response", async () => {
  const calls: Call[] = [];
  const { run } = handler((call) => {
    if (call.url.endsWith("expired_audio_paths")) return rpcResponse([row]);
    if (isStorageDelete(call)) return new Response(null, { status: 204 });
    // The database recheck returns no rows because valid consent was shortened.
    return rpcResponse([]);
  }, calls);
  const response = await run(authRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { examined: 1, deleted: 1, confirmed: 0 });
});

test("requests and processes one bounded batch", async () => {
  const rows = Array.from({ length: 100 }, (_, index) => {
    const batchItemId = `${itemId.slice(0, -2)}${String(index).padStart(2, "0")}`;
    return {
      ...row,
      item_result_id: batchItemId,
      object_path: audioPath.replace(itemId, batchItemId),
    };
  });
  const calls: Call[] = [];
  const { run } = handler((call) => {
    if (call.url.endsWith("expired_audio_paths")) return rpcResponse(rows);
    if (isStorageDelete(call)) return new Response(null, { status: 204 });
    return rpcResponse(rows.map(({ item_result_id, object_path }) => ({ item_result_id, object_path })));
  }, calls);
  const response = await run(authRequest());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).examined, 100);
  const discovery = calls.find((call) => call.url.endsWith("expired_audio_paths"));
  assert.deepEqual(JSON.parse(String(discovery?.init?.body)), { batch_size: 100 });
  assert.equal(calls.filter(isStorageDelete).length, 100);
  const confirmCall = calls.find((call) => call.url.endsWith("confirm_audio_deleted"));
  assert.equal(JSON.parse(String(confirmCall?.init?.body)).items.length, 100);
});

async function scheduledRequest(stamp: string, alterSignature = false): Promise<Request> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`basira-audio-cleanup:${stamp}`)));
  const signature = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return new Request('https://function.test', { method: 'POST', headers: {
    authorization: `Bearer ${alterSignature ? '0'.repeat(64) : signature}`,
    'x-basira-cleanup-timestamp': stamp,
  } });
}

test('accepts a fresh scheduled HMAC without sending the long-lived secret', async () => {
  const { run, calls } = handler(() => rpcResponse([]));
  const request = await scheduledRequest(String(Math.floor(Date.now() / 1000)));
  assert.ok(!JSON.stringify([...request.headers]).includes(secret));
  assert.equal((await run(request)).status, 200);
  assert.equal(calls.length, 1);
});

test('rejects stale, future, tampered and malformed scheduled tokens before network access', async () => {
  const { run, calls } = handler(() => rpcResponse([]));
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await run(await scheduledRequest(String(now - 120)))).status, 401);
  assert.equal((await run(await scheduledRequest(String(now + 120)))).status, 401);
  assert.equal((await run(await scheduledRequest(String(now), true))).status, 401);
  assert.equal((await run(await scheduledRequest('not-a-timestamp'))).status, 401);
  assert.equal(calls.length, 0);
});

test('supports stock Supabase local gateways but never public plaintext HTTP', () => {
  for (const url of ['http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321', 'http://kong:8000']) {
    assert.doesNotThrow(() => createHandler({ url, serviceKey: 'local-test-only', cleanupSecret: secret }));
  }
  assert.throws(() => createHandler({ url: 'http://public.example', serviceKey: 'local-test-only', cleanupSecret: secret }), /HTTPS/);
  assert.throws(() => createHandler({ url: 'http://kong:80', serviceKey: 'local-test-only', cleanupSecret: secret }), /HTTPS/);
});
