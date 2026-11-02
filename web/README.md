# Basira web — B1 scaffold

A clean-room, standalone Vite + React + TypeScript application. Arabic and RTL are the defaults. The font is bundled locally; production does not need a font CDN. There is no platform-specific runtime, hosted login portal, database or storage dependency.

## Run locally

Use Node.js 22 and npm. From `web/`:

```sh
npm ci
npm run dev
```

No environment variables or credentials are required for this scaffold. `.env.example` lists the browser-safe settings reserved for later integration. Never put a Supabase service-role key in a `VITE_*` variable.

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Vitest runs the component and routing tests once; `npm run test:watch` enables watch mode. The browser smoke tests use a production build and Playwright Chromium:

```sh
npx playwright install chromium
npm run test:e2e
```

On a fresh Linux CI machine, use `npx playwright install --with-deps chromium`. `npm run preview` serves the production build locally. PWA installation and the service worker require HTTPS, except on localhost.

## Routes and language

`/` is an honest public scaffold page. The future Supabase session/profile adapter will supply the authenticated application role to `AppRoutes`. Production currently supplies `null`: every protected deep link returns to `/`. There is deliberately no role picker, URL override, local-storage role, mock session or proprietary sign-in flow. Component tests inject roles in memory to verify the navigation policy.

- `/guardian`: guardian account, Arabic only.
- `/specialist`: specialist account, Arabic default with an optional English switch.
- `/examiner`: examiner account, Arabic default with an optional English switch.
- `/admin`: administrator account, Arabic only.
- `/child`: supervised specialist or examiner account, always Arabic. Children do not have an auth role.

All React UI copy is in `src/i18n/messages.ts`. An English preference lasts only in memory and only applies to the authorized professional screen; navigation into a child or other screen immediately selects Arabic, including the document language/direction. An English professional screen uses `lang="en" dir="ltr"`; the initial HTML and all other screens use `lang="ar" dir="rtl"`.

These route guards are **navigation only, not authorization**. They must never replace database enforcement. There are no database queries, reports, plans, results, audio recording or session mutations in B1. Consent triggers, approval state transitions and guardian/child RLS must be implemented and tested in B3 before those flows are added. Google and Microsoft sign-in must use Supabase Auth in B4.

## Static build and PWA

Cloudflare Pages can build this directory with `npm ci && npm run build`, using `web` as its root directory and `dist` as the output directory. The committed SPA fallback supports protected direct links. B13 owns connecting and deploying the real Cloudflare Pages project; this PR does not publish anything or provision services.

The production build includes Arabic install metadata, local PNG/maskable icons and a service worker for the static shell. Its precache is restricted to build-time shell assets. It does not implement runtime caching of Supabase, scorer, auth, audio or report requests, and it is not offline assessment support. Worker updates wait for existing application clients to close rather than taking over a session. Future authenticated data must stay out of both the precache and runtime caches.

## Scope and next steps

B1 is a shell, not an operational screening app. No real or synthetic child profiles, scores or results are shown. No assessment can start; no plan or report can be delivered. B2 owns generated payload types from `../contracts/schemas/basira.schema.json`; no scorer payload types are defined by hand here and type generation is not yet implemented. B3 owns Supabase and database gates, B4 owns Google/Microsoft authentication, and subsequent tasks own scoring and workflows.

Noto Naskh Arabic is distributed under [OFL-1.1](https://fontsource.org/fonts/noto-naskh-arabic/about), copyright 2022 The Noto Project Authors. Its licence ships in `public/licenses/`. Direct dependencies and their licences are disclosed in `../docs/DISCLOSURES.md`.
