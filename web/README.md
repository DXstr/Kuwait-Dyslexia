# Basira web

A clean-room, standalone Vite + React + TypeScript application. Arabic and RTL are the defaults and the Arabic font is self-hosted. Authentication uses Google through the official Supabase SDK, not a hosted-platform login portal. Production web hosting remains Cloudflare Pages. The Google-only B4 scope and the separate unverified provider gate are recorded in `../docs/DECISIONS.md`.

## Run locally

Use Node.js 22+ and npm. From `web/`:

```sh
npm ci
npm run dev
```

Without public Supabase configuration the page remains usable as an honest unconfigured shell, with the Google sign-in button disabled. To connect Auth, copy `.env.example` to ignored `web/.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The latter accepts the project's publishable key or legacy `anon` key. Both values are public and bundled into JavaScript. Invalid URLs, partial configuration and server-only keys are rejected at Vite startup/build as well as in the client. Never put a service-role key or provider client secret in a `VITE_*` value.

For the local stack, the URL is `http://localhost:54321`; obtain its public key from the local CLI status output. Follow [`../supabase/README.md`](../supabase/README.md) for real Google registration, migrations and the enabled custom role hook. Local provider secrets belong in the repository-root `.env`, using `supabase/auth.env.example`, **not** in `web/.env.local` or `supabase/.env`. Google stays disabled by default until its real callback registration is confirmed. Public URL/key configuration alone does not configure Google on the server; downloading a Google client JSON is not proof that its redirect URI is registered. Never commit that JSON.

## Authentication and role routing (B4)

The single Arabic sign-in button calls stock `signInWithOAuth` with `google` and requests account selection for shared tablets. The controller rejects every other provider; it does not request `offline_access`. The redirect is always this frontend's own `/auth/callback`; URL parameters cannot select an external destination or application role. The exact frontend callback must be allowlisted in Supabase. Locally that is `http://localhost:5173/auth/callback` or `http://127.0.0.1:5173/auth/callback`; Google separately registers the Auth-server callback `http://localhost:54321/auth/v1/callback`.

The callback is processed once outside React StrictMode effect replay. Supabase performs the PKCE code exchange; the app removes the code/error/hash from browser history immediately and never renders raw provider errors. A failed or cancelled callback stays closed until an explicit retry/new sign-in. There is no password form, child account, role picker, URL override, production mock-auth switch or custom token issuer.

A cached session locates a candidate only. The controller verifies identity with server-side `getUser(access_token)`, queries only `profiles.id,role` filtered to that verified ID through RLS, and checks the SDK-verified JWT `sub`/`app_role`. A stale claim permits one refresh and recheck, never an unverified role fallback. New users are guardians; professional/admin roles require trusted provisioning, not email domains or user metadata. UI route guards are navigation only: B3's database RLS, consent and specialist approval triggers remain the authorization boundary.

SDK session tokens and the PKCE verifier use **per-tab `sessionStorage`**, not `localStorage`; they survive redirects/reloads in that tab but are not a cross-tab persistent login. Roles are held only in memory after verification. Offline, changed-identity, verification and sign-out transitions immediately remove trusted role access; stale promises cannot restore it. Reconnection/focus revalidates with the server. Sign-out uses the SDK's local scope plus removal of only this project's SDK-owned keys, including on failures. A failure message does not claim remote tokens were revoked. Sign-out does not sign the person out of Google itself.

- `/guardian`: guardian account, Arabic only.
- `/specialist`: specialist account, Arabic default with an optional English switch.
- `/examiner`: examiner account, Arabic default with an optional English switch.
- `/admin`: administrator account, Arabic only.
- `/child`: supervised specialist or examiner account, always Arabic; children never sign in themselves.

All React UI copy is in `src/i18n/messages.ts`. English preference stays in memory and applies only to an authorized professional screen; child/public/guardian/admin or failed-auth screens immediately return to Arabic, including document language/direction. No child profiles, reading results, recordings, reports or session mutations are implemented by B4; the only application-data query is the signed-in adult's own profile role.

**B4's genuine Google sign-in demonstration remains unverified.** Its code merged separately in PR #41, but the sandbox sign-in attempt was blocked by Google's unrecognized-device protection before a Google identity reached Supabase. No hosted project or working OAuth credentials are supplied by this repository. Automated mocked transport tests prove wiring, not actual provider configuration; do not substitute seeded demo identities for real OAuth or interpret the merge/CI as manual verification.

## Validation

```sh
npm run typecheck
npm test
npm run build
npm run lint
npx playwright install chromium
npm run test:e2e
```

`typecheck` includes the read-only generated-contract drift check. Vitest covers routing, catalogues, configuration, PKCE callback handling and controller races. `test:watch` enables watch mode. On a fresh Linux CI machine use `npx playwright install --with-deps chromium`.

Playwright runs three isolated projects: `chromium` tests the unconfigured production/PWA build; `mocked-auth-sdk` tests the real SDK with synthetic intercepted Auth HTTP and fixture-mode notices; `real-mode-scorer-http` changes only scorer environment values and tests anonymous health requests, verification order, deduplication and failure/retry handling through intercepted HTTP. The SDK cases also cover PKCE verifier/challenge, Google options, server identity/profile verification, role isolation and logout. Every mocked identity/response is synthetic, no live service accepts the fixture key, and none of this is a runtime mock-auth feature or genuine provider/model demonstration. Tests never contact Google or use real child data.

For real-provider verification, complete the Google registration in `supabase/README.md`, enable it locally, and preserve the same browser origin/tab across sign-in and callback. The browser must reach both the frontend and the chosen Supabase endpoint: `localhost` in a user's browser is their computer, not a cloud sandbox. Run the local stack/frontend on that computer, or use an operator-configured first-party development endpoint with exact matching callbacks. Demonstrate sign-in, check the profile-backed destination and Arabic default, sign out, and confirm a protected deep link cannot reopen a workspace. Never capture tokens, provider secrets or real child data in evidence. Hosted testing additionally requires migrations, the Auth hook, exact redirect allowlists and server-side Google settings on the actual Supabase project.

## Generated contract types (B2)

`src/contracts/basira.ts` is generated, never hand-edited, from `../contracts/schemas/basira.schema.json` using the exactly pinned `json-schema-to-typescript` development dependency:

```sh
npm run generate:contracts
npm run check:contracts
```

Generation is deterministic, uses LF line endings and records the canonical schema SHA-256 rather than a timestamp. `check:contracts` regenerates in memory and fails if committed output is missing or stale without modifying it. Tests also check all existing JSON fixtures for assignability without casts. The schema root is a definitions registry; [`unreachableDefinitions`](https://github.com/bcherny/json-schema-to-typescript#options) exports every named `$def`. Import named payloads, not the registry wrapper:

```ts
import type { ScoreItemResponse, Error as ContractError } from './contracts/basira'
```

Generated TypeScript is not runtime validation. B5 supplies runtime validation through the canonical schema; contract changes still require their own approved contracts PR.

## Scorer client and fixture mode (B5)

All scorer calls go through `src/scorer/`. `createScorerClient` implements the five operations in `../contracts/scorer.openapi.yaml`: anonymous `health()`, WAV/multipart `scoreItem(audio, meta)`, and JSON `fingerprint(request)`, `probe(request)`, `stage0(request)`. Requests and every success/error response are validated with Ajv2020 against the directly imported canonical JSON Schema. Types are the existing generated exports, not hand-written payloads. Validation never coerces values, removes fields, inserts defaults or rewrites results. A successful call returns the validated response JSON unchanged; this module never writes to Supabase or changes approval states.

In ignored `web/.env.local`, set `VITE_SCORER_MODE=mock` and preconfigure `VITE_SCORER_URL` with the actual scorer base URL. With that URL in place, switching to `VITE_SCORER_MODE=real` is the only configuration change needed; restart Vite or rebuild Cloudflare Pages because Vite variables are build-time settings. Omitted mode defaults to mock. Invalid modes, a missing real URL, credential-bearing/query/fragment URLs, insecure non-loopback HTTP and the obsolete `VITE_SCORER_BASE_URL` fail closed at startup/build. Production requires the operator's HTTPS scorer URL and an exact frontend origin in the scorer's `ALLOWED_ORIGINS`. There is no hosted-platform endpoint or automatic real-to-mock fallback.

Fixture mode returns fresh clones of the existing contract fixtures, always with their original identifiers and `synthetic=true` on scoring results. It makes no scorer network requests and never uploads recording bytes. It supports the two known score-item cases (`rw-0001` dialect variant and `rw-0002` dot confusion), plus the canonical fingerprint, probe and Stage 0 request fixtures. Unsupported or mismatched scenarios throw `fixtureUnavailable`; the client never manufactures results for arbitrary recordings/sessions. Professional screens show a visible Arabic synthetic-fixture banner, with English only through the specialist/examiner language switch. Future professional result views must include `ScorerFixtureNotice` with the response's `synthetic` flag, including in real mode. No score, referral, service detail or fixture-result renderer is added to child or guardian screens by B5.

Protected calls obtain only the controller's current, server-verified in-memory session. Guardians cannot score; specialist/examiner/admin can use the general endpoints, while Stage 0 requires examiner/admin. Bearer tokens are sent only in the Authorization header to the configured scorer, never on `/health`, in URLs or cookies. Redirects are rejected, API requests use `no-store`, and an auth change during a call discards its response. The client verifies WAV framing, 16 kHz mono 16-bit PCM and 0.3–15-second duration without resampling or altering audio. Metadata is an `application/json` multipart string without a filename; audio uses a fixed non-identifying filename. B6 must obtain valid guardian consent and an authorized session before recording/uploading; B5 does not start sessions.

The runtime performs one non-blocking anonymous `/health` warm-up after a restored or newly server-verified sign-in. Repeated notifications, token refreshes and focus revalidation for the same identity are deduplicated. Sign-out invalidates pending status and aborts the request; a late response cannot revive it. A failed health check never blocks navigation or changes auth state. Readiness/error notices and an explicit retry are professional/admin only; no polling or automatic scoring retry is added. Requests have a 30-second timeout, caller cancellation and a bounded 2 MiB response reader. Errors expose fixed safe categories/status/code, not raw service messages, audio, URLs or tokens. Future callers must catch these errors and use role-appropriate catalogue messages; B6 owns upload-queue retries.

Tests exercise every canonical fixture, all endpoint transports, role restrictions, immutable results, invalid/mismatched responses, malformed WAVs, cancellation, timeouts and sign-in/sign-out races. Intercepted browser HTTP is labelled synthetic testing, not evidence of a live model or genuine Google login. The genuine-provider B4 limitation above remains open independently of B5.

## Cloudflare Pages and PWA

Cloudflare Pages builds with `web` as root, `npm ci && npm run build`, and `dist` as output. Set only the public `VITE_*` values there and configure the exact production `/auth/callback` in Supabase. The SPA fallback handles direct links. Callback responses use `no-store` and `no-referrer`. B13 owns connecting/publishing the real Pages project; this task does not provision or deploy hosted resources.

The PWA caches build-time static shell assets only, never auth/REST/Storage/scorer requests, profiles, audio or reports. Auth callback navigation is excluded from offline fallback. Offline support is not offline assessment or authenticated offline access. Worker updates wait rather than take over an active session. PWA installation requires HTTPS except on localhost.

Noto Naskh Arabic is [OFL-1.1](https://fontsource.org/fonts/noto-naskh-arabic/about), copyright 2022 The Noto Project Authors, with licence in `public/licenses/`. External dependencies and licences are disclosed in `../docs/DISCLOSURES.md`.

## Supervised assessment and background processing (B6)

`src/assessment/` uses the existing, single Supabase SDK client. The assigned specialist selects a child, checks the recorded assessment consent, and creates a genuine database session before opening `/child` or requesting microphone access. The database remains authoritative: the session trigger requires a valid guardian consent tied to the specialist of record. The B6 migration fixes `sessions INSERT ... RETURNING` policy visibility using the same row's existing assignment fields; it does not grant guardians or unrelated professionals new access.

Recording uses browser AudioWorklet PCM capture, actual `AudioContext.sampleRate`, mono downmix and explicit resampling to a real 16 kHz PCM16 WAV. It never renames a WebM file. Recording is bounded to eight seconds by default (hard maximum fifteen), has no speaker monitoring, and stops tracks/context on cancellation, device failure and navigation. Failed local capture stays on the same prompt with a neutral Arabic retry message. After local WAV finalization the next prompt appears without waiting on AI, Storage or Postgres.

The bounded background queue validates through B5, stores scorer JSON unchanged with a stable UUID, then writes the private `audio/{child_id}/{session_id}/{item_id}.wav` key. Result-first ordering is required by Storage RLS. Retries reconcile an acknowledged duplicate against exact JSON/bytes rather than modifying immutable evidence. The database sets expiry to session start plus thirty days; the existing B3 cleanup removes actual bytes through the Storage API. Queue state/error/retry controls are professional-only, never raw scorer results on a child screen.

Recovery is **same-tab and in-memory**, not durable offline recording: no audio, result or queue is saved to localStorage, IndexedDB or the service worker. Auth revalidation pauses work; confirmed identity/role changes purge it. Keep the tab open until queued work finishes. A browser unload warning protects unsent work but cannot guarantee recovery after a browser crash. Existing fail-closed auth still requires server verification before a protected workspace is shown again.

The current launch path is intentionally restricted to `is_demo=true` children in fixture mode and the two canonical scorer fixture prompts, visibly labelled synthetic in Arabic. Their fake scores are never shown to the child. Main now includes the R1-reviewed practice bank from PR #53, but B6 does not automatically enable real-profile/real-mode assessment: integration of that reviewed material and a genuine real-model run remain separate. No real guardian consent is supplied by seed data: consent must be recorded separately; test consent evidence is explicitly synthetic and used only in disposable local tests. B12 owns consent capture UI. Genuine Google verification remains the independently disclosed B4 blocker.

Tests include pure PCM and microphone lifecycle cases, retry/auth races, real Chromium fake-device capture with intercepted synthetic HTTP, and a localhost-only authenticated PostgREST/Storage integration proving consent denial, unchanged response JSON, server-owned expiry and private WAV bytes. Synthetic browser HTTP is not evidence of a live model or genuine OAuth. No additional library or hosted resource is introduced.

## Specialist review (B7)

`src/review/` mounts only inside the server-verified specialist workspace and uses the existing single Supabase client. It lists completed assessment/probe sessions visible under RLS, validates stored item/tap/fingerprint/report JSON against the canonical contracts, and displays phonemes, readable Arabic referral rules and neutral dialect-variant labels. An English switch is available only to the specialist. Synthetic scorer outputs carry an adjacent visible banner; demo child/plan/report records are identified as demo data. None of these professional results is rendered on child or guardian routes.

Fingerprint requests use the actual selected session UUID, grade, elapsed duration and unchanged stored item/tap evidence through B5. Successful scorer JSON is stored unchanged, with the database row starting `pending_review`. Its row's review status is authoritative; the original `FingerprintResponse.review_status` remains `pending_review` even after specialist approval. Canonical fixture mode cannot compute a fingerprint for an arbitrary UUID: the supplied fixture refers to `demo-session-1`, and the client does not rewrite that identifier. The UI explains this limitation rather than manufacturing a session result. Existing UUID-correlated synthetic test records can be reviewed, but are not inserted by a production mock-auth shortcut.

Each stored flag/fingerprint, plan and parent report has an explicit review action: draft to pending review, then approve or reject. Updates filter both the row ID and expected current status and wait for an actual server acknowledgement; a stale or denied update is not displayed as approved. Attribution and transitions remain enforced by the existing Supabase triggers/RLS and append-only audit log, not by button visibility. Terminal content is read-only. B7 reviews existing drafts; B8 creates learning-map plans and B11 builds the parent report/PDF. There is no placeholder plan/PDF generator, automatic family publication or delivery action.

Audio is downloaded through authenticated private Storage at the canonical row-associated path. A null/deleted pointer produces a professional-only unavailable message. WAV bytes are validated before a temporary in-memory object URL is used; URLs and playback are revoked/stopped when switching sessions, signing out or leaving the view. No public/signed URL is saved, no private response is cached, and no audio/result is placed in browser persistence. Synthetic scorer timestamps describe the fixture and are not proof of the actual recording's acoustics; whole-clip playback remains genuine recorded WAV playback. Real outputs are checked against their recording duration.

B7 tests include role-gated components, cancellation and audio cleanup, synthetic browser HTTP for the actual SDK/fingerprint/review paths, and a genuine localhost authenticated PostgREST integration. The latter independently proves guardian draft isolation, failed direct guardian approval, valid specialist transitions, server attribution, stale compare-and-set behavior, immutable original JSON and audit events. Mocked Google/scorer browser responses are explicitly test-only and are not genuine OAuth, model or clinical evidence. B4's real Google-login blocker and the absence of a hosted Supabase project remain unchanged.
