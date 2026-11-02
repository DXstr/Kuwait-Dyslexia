import { createHandler } from "./cleanup.ts";

const url = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const cleanupSecret = Deno.env.get("BASIRA_AUDIO_CLEANUP_SECRET");

let handler: (request: Request) => Promise<Response>;
try {
  // No fallback/default secret is permitted. createHandler also enforces the
  // minimum 32-byte secret length before the function starts serving requests.
  handler = createHandler({
    url: url ?? "",
    serviceKey: serviceKey ?? "",
    cleanupSecret: cleanupSecret ?? "",
  });
} catch {
  console.error("audio_cleanup_not_configured: required server configuration is missing or invalid");
  handler = async () => new Response(JSON.stringify({ error: "cleanup_not_configured" }), {
    status: 500,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(handler);
