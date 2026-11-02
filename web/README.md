# Basira web

A clean-room, standalone Vite + React + TypeScript application. Arabic and RTL are the defaults and the Arabic font is self-hosted. Authentication uses Google through the official Supabase SDK, not a hosted-platform login portal. Production web hosting remains Cloudflare Pages. The Google-only B4 scope is recorded in `../docs/DECISIONS.md` and awaits Ayman's PR review.

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

**B4 is not complete until genuine Google sign-in with profile-backed roles applied is demonstrated and the Google-only scope is reviewed.** No hosted project or working OAuth credentials are supplied by this repository. Automated mocked transport tests prove wiring, not actual provider configuration. Keep the implementation PR in draft until the manual gate passes; do not substitute seeded demo identities for real OAuth.

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

Playwright runs two isolated projects: `chromium` tests the unconfigured production/PWA build; `mocked-auth-sdk` uses a separate Vite server with a synthetic public key and intercepted loopback HTTP. The latter exercises the real SDK's PKCE verifier/challenge, Google options, server identity/profile verification, guardian and specialist role isolation, logout and failure paths. Every mocked identity is synthetic, no live service accepts the fixture key, and none of this is a runtime application feature or real provider demonstration. Tests never contact Google or use real child data.

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

Generated TypeScript is not runtime validation. The scorer client, full response validation and warm-up remain B5; this auth task does not call the scorer. Contract changes require their own approved contracts PR.

## Cloudflare Pages and PWA

Cloudflare Pages builds with `web` as root, `npm ci && npm run build`, and `dist` as output. Set only the public `VITE_*` values there and configure the exact production `/auth/callback` in Supabase. The SPA fallback handles direct links. Callback responses use `no-store` and `no-referrer`. B13 owns connecting/publishing the real Pages project; this task does not provision or deploy hosted resources.

The PWA caches build-time static shell assets only, never auth/REST/Storage/scorer requests, profiles, audio or reports. Auth callback navigation is excluded from offline fallback. Offline support is not offline assessment or authenticated offline access. Worker updates wait rather than take over an active session. PWA installation requires HTTPS except on localhost.

Noto Naskh Arabic is [OFL-1.1](https://fontsource.org/fonts/noto-naskh-arabic/about), copyright 2022 The Noto Project Authors, with licence in `public/licenses/`. External dependencies and licences are disclosed in `../docs/DISCLOSURES.md`.
