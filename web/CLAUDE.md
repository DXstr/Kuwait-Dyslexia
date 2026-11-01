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

Commands are added here by the scaffold PR (dev, test, typecheck, build, regenerate types).
