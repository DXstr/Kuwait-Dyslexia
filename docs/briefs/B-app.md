# Brief — Workstream B: Product & app (Mahmoud)

You own `web/` and `supabase/`. You never edit `ai/` or `content/`. Everything you need from workstream A is defined in
`contracts/`; until A's real pieces are live, you build against `contracts/fixtures/`.

## What you receive from A, and what to use until then

| You need | Contract | Use until A delivers | A delivers (target) |
| --- | --- | --- | --- |
| Item scoring | `POST /score-item` → `ScoreItemResponse` | Mock scorer serving `contracts/fixtures/ScoreItemResponse.*.json` | Scorer in docker: day 2 |
| Session fingerprint | `POST /fingerprint` → `FingerprintResponse` | `FingerprintResponse.example.json` | day 3 |
| Probe result | `POST /probe` → `ProbeResponse` | `ProbeResponse.example.json` | day 3 |
| Stage 0 scoring | `POST /stage0/score` → `Stage0ScoreResponse` | `Stage0ScoreResponse.license-pending.json` | day 3 |
| Practice items + audio | `ItemBank` in `content/dist/item-bank.json` | `ItemBank.sample.json` | v1: day 3 |
| Skill graph, taxonomy, lexicons | `contracts/*.json` | already final for v0.1 | — |
| Phonetic inventory for the mouth generator | schema added by A in a contracts PR | build the renderer with 2–3 hand-entered letters behind the same shape | schema + data: day 2–3 |

**Mock mode must be honest:** when `VITE_SCORER_MODE=mock`, every screen that shows a score displays a visible banner
"Fixture data — synthetic, not a real scoring result". Switching to `real` is one env change, no code change.

## Your tasks, in order (each = one GitHub Issue, one PR)

1. **Web scaffold** — Vite + React + TypeScript; Arabic RTL (`dir="rtl"`), a font with full diacritics (e.g. Noto Naskh
   Arabic), tablet-first layout, routing by role, installable PWA, Vitest + Playwright, ESLint. Add the `web` CI job.
2. **Generated types** — `json-schema-to-typescript` from `contracts/schemas/basira.schema.json` into
   `web/src/contracts/` (generated, never hand-edited); an npm script regenerates them.
3. **Supabase platform** — Supabase CLI local stack; migrations for every table in `contracts/data-model.md`; RLS per
   role; consent trigger (no session without valid consent); approval state-machine trigger; append-only `audit_log`;
   custom access token hook putting `app_role` in the JWT; storage buckets with audio expiry; labelled demo seed data.
   Database tests (pgTAP or SQL tests) for every policy and trigger, run in CI.
4. **Auth** — Google and Microsoft sign-in through Supabase Auth (two identity providers, both working).
5. **Scorer client** — one module `web/src/scorer/` that implements `contracts/scorer.openapi.yaml`, validates every
   response against the schema, and has the mock/real switch. Warm-up `GET /health` at sign-in.
6. **Assessment session (child)** — 16 kHz mono WAV recorder; next item shows immediately; background upload queue with
   retries; results stored in `item_results`; audio to storage with expiry. The child never waits on the AI.
7. **Specialist review** — session fingerprint, per-item phonemes with audio playback, dialect variants shown as dialect
   (never error), referral rules as readable text, approve/reject flags, plan and parent report.
8. **Learning-map engine** — pure TypeScript in `web/src/learning-map/` with unit tests: mastery update from
   `skill_evidence` and taps, bands 0.6 / 0.85, prerequisites from `skill-graph.json`, next-plan selection, "mastered
   only after probe transfer", no-gain flag. Progress-over-time view for the specialist.
9. **Teach** — practice from the item bank, tap tasks for short vowels, tracing, cues, mnemonics, mouth-shape renderer;
   psychological safety: no red, no "wrong", neutral retry cue.
10. **Prove** — probe session flow (probe-only items), results side by side for the specialist.
11. **Parent report + PDF** — build `ParentReport` JSON from the approved session and plan; render Arabic PDF. Arabic
    shaping is the risk: an HTML print route ("Save as PDF") renders Arabic correctly; use a PDF library only after
    proving it shapes Arabic and diacritics correctly. Downloadable only after approval.
12. **Stage 0 examiner screens + consent capture** — examiner-only routes, the 7 constructs, `LICENSE PENDING`
    placeholders clearly marked, results via `/stage0/score`.
13. **Hosting** — Cloudflare Pages deploy from `main`, env vars, GitHub Actions keep-alive for Supabase, health page.

## Definition of done (every PR)

Contract types generated not hand-written · tests added and green · non-negotiables checked (no red, no score shown to
child/parent, synthetic labelled, approval gate respected) · `docs/DISCLOSURES.md` updated for new dependencies ·
PR template filled · reviewed and merged by Ayman.

## When you are blocked by A

Do not edit `ai/` or `content/`. Keep building against fixtures and open an issue labelled `needs-A`. If the contract
itself is wrong or missing something, open a `contract/<name>` PR.
