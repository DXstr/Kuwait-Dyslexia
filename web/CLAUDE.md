# web/ — owned by Mahmoud (workstream B)

Read the root `CLAUDE.md` and `docs/briefs/B-app.md` first.

- Edit only `web/` and `supabase/`. Read `contracts/` and `content/dist/` but never edit them here.
- Types for every payload come from `contracts/schemas/basira.schema.json` via `json-schema-to-typescript`
  into `web/src/contracts/` (generated; do not hand-edit).
- All scorer calls go through `web/src/scorer/`; it validates responses against the schema and honours
  `VITE_SCORER_MODE=mock|real`. Mock mode shows a visible "Fixture data — synthetic" banner.
- Arabic first: `lang="ar" dir="rtl"` everywhere; every string comes from the Arabic message catalogue. Child screens
  and the parent PDF have no English. Only specialist/examiner screens get an optional English switch.
- Child screens: RTL, no red, never show a score, label or the word "wrong"; WCAG 2.1 AA.
- Parent and child views only ever read `approved` / `delivered` rows.
- Env: copy `.env.example` → `.env.local`; never commit it.

## Commands (from `web/`, Node.js 22)

- `npm ci` — install the locked dependencies.
- `npm run dev` — local Vite server.
- `npm run generate:contracts` — regenerate `src/contracts/basira.ts` from the canonical JSON Schema.
- `npm run check:contracts` — fail on missing/stale generated output without overwriting it.
- `npm run typecheck` — check generated-contract drift, then TypeScript.
- `npm run lint` — ESLint, with warnings treated as failures.
- `npm test` / `npm run test:watch` — Vitest once / watch mode.
- `npx playwright install chromium && npm run test:e2e` — production/PWA smoke tests plus an isolated mocked-HTTP SDK flow project (not genuine OAuth).
- `npm run build` / `npm run preview` — static `dist/` for Cloudflare Pages / local production preview.

Never edit `src/contracts/basira.ts` by hand. Schema changes require a separate contracts PR; regenerate after it merges.
Auth uses the official Supabase SDK, server-verified identity and profile-backed roles. Never trust cached metadata/URL roles or add a production mock-login/role picker. Public frontend configuration is validated before build; provider secrets belong only in the local repository-root `.env` or hosted Auth settings, never `VITE_*`. No genuine provider sign-in may be claimed from mocked transport tests.
See `README.md` for auth setup, fail-closed role routing, PWA cache boundaries and unfinished integrations.
