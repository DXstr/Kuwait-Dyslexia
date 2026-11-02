# Basira audio cleanup

This is a server-only Supabase Edge Function, not a browser API for scores or an application login mechanism. It handles one bounded batch of at most 100 expired audio objects per invocation:

1. Reject methods other than POST and authenticate the request.
2. Call the service-only `expired_audio_paths` RPC.
3. Delete each complete object key through `DELETE /storage/v1/object/audio` with JSON `{ "prefixes": ["audio/{child}/{session}/{item}.wav"] }`.
4. Only after all deletions succeed, call `confirm_audio_deleted` with `{ "items": [{ "item_result_id": "...", "object_path": "..." }] }`.

Acknowledgement matches **both** UUID and path, rechecks effective expiry, and refuses to clear a pointer while the corresponding Storage metadata exists. Cleanup only clears `audio_path`; the original scorer JSON, synthetic marker and other evidence remain unchanged. A changed effective deadline may prevent acknowledgement, but cannot make an object that was already physically deleted reappear. Failures return a non-success response, are logged without secrets/payloads, and are retried by a later bounded invocation. Storage deletion is idempotent, including already absent objects.

## Server environment

Supply only through the Supabase server/runtime environment:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BASIRA_AUDIO_CLEANUP_SECRET` — cryptographically random, at least 32 bytes

`SUPABASE_URL` must be HTTPS, except for explicit localhost/loopback development or Supabase's stock internal Docker gateway `http://kong:8000`. Public plaintext HTTP endpoints are rejected. The service role key is used only for outgoing server requests. The cleanup secret is separate from any Supabase key and never reaches the browser, seed, migrations or repository.

The committed config has `verify_jwt = false` because this endpoint verifies its own dedicated server-to-server authentication. Missing, malformed or incorrect authorization is rejected before any database/Storage request. Missing environment fails closed with a logged `cleanup_not_configured` error, never a fake successful result.

An operator who already has the server secret can make a manual POST with `Authorization: Bearer <secret>`. Scheduled requests use the safer short-lived form below; never put the long-lived secret in a queued header.

## Supabase-native scheduler

`basira_private.configure_audio_cleanup(text, text, text)` is executable only by the service role/postgres operator. It accepts exactly the five-minute schedule, the deployed HTTPS `/functions/v1/audio-cleanup` URL, and the secret supplied from a secure runtime environment. Through an authorized parameter-binding client, the operation is:

```sql
select basira_private.configure_audio_cleanup('*/5 * * * *', $1, $2);
-- Bind $1 from the deployed function URL and $2 from BASIRA_AUDIO_CLEANUP_SECRET.
-- Do not paste real values into committed SQL or shell command arguments.
```

The function requires `pg_cron`, `pg_net`, Vault and pgcrypto, stores the long-lived secret encrypted in Vault, and replaces the named `basira-audio-cleanup` job. The scheduled command resolves the secret only when computing HMAC-SHA256 over `basira-audio-cleanup:{unix_seconds}`. Its queued headers contain the hex signature and `x-basira-cleanup-timestamp`, **not the long-lived secret**. This matters because Supabase's extension-owned pg_net queue may be readable by ordinary database roles even when its schema is not exposed through the Data API. The handler accepts signatures only within a 60-second clock window. They are short-lived capabilities, not guaranteed single-use tokens; they authorize only the bounded expired-audio cleanup operation. Keep server clocks synchronized and do not expose the `net`/`vault` schemas through the Data API.

The HTTP request has a two-minute network timeout; each invocation still processes only one batch. No hosted job is activated by a migration or test. The scheduler tests enqueue only inside a transaction that is rolled back, so they never send a future request.

## Deployment boundary

After the target Supabase project is explicitly selected, deploy migrations and the Edge Function using the repository's reviewed operational process. Configure the server environment, verify unauthorized requests fail, then bind the deployed URL/secret into the scheduler function above. Function deployment, server secrets and scheduler activation are separate from this code PR. They have **not** been performed against a hosted project by B3.

For local verification, use `npm run test:cleanup`, `npm run test:integration` and `npm run test:db` from `supabase/`. The integration suite deletes real synthetic Storage bytes, tests approved PDF immutability through HTTP, and verifies PostgreSQL-generated HMAC authentication. All data and credentials used by those tests belong to the disposable loopback stack.
