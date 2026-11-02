# Basira — System Design

Live version: https://claude.ai/artifact/12yjDSeX8pCETkkGuUUwND. Repo copy, updated by ADR-001 (stateless scorer).

## Architecture

```
            ┌──────────────────── Web app (Cloudflare Pages) · B ────────────────────┐
            │  Child session + Teach   │  Specialist + examiner  │ Learning-map engine │
            └───────┬──────────────────────────┬─────────────────────────▲───────────┘
     auth + data    │          audio + token   │      JSON results       │ static item bank + audio
                    ▼                          ▼                         │
      ┌──────── Supabase · B ───────┐   ┌──── Scorer · A ────┐   ┌── Content pipeline · A ──┐
      │ Auth (Google only)          │   │ stateless REST     │   │ offline: LLM items,      │
      │ Postgres + RLS + triggers   │   │ HF ZeroGPU / Cloud │   │ validators, TTS audio    │
      │ Storage (audio w/ expiry)   │   │ Run / docker       │   │ → content/dist/          │
      └─────────────────────────────┘   └────────────────────┘   └──────────────────────────┘
      ════════════ contracts/ — schemas, OpenAPI, taxonomy, skill graph, lexicons ════════════
```

The web app calls the scorer, receives contract JSON, and writes it to Supabase itself. The scorer has no database
credentials. Practice content is built offline and shipped as static files, so the child's practice loop needs no server.

## Modules

| Module | Folder | Owner | Interface |
| --- | --- | --- | --- |
| M0 Contracts | `contracts/` | both | — |
| M1 Scoring core (pure Python) | `ai/basira_ai/` | A | function signatures returning contract models |
| M2 Scoring service (FastAPI) | `ai/service/` | A | `contracts/scorer.openapi.yaml` |
| M3 Content pipeline | `content/` | A | `ItemBank` + `PromptBank` (ADR-003) schemas; output `content/dist/` |
| M4 Platform | `supabase/` | B | `contracts/data-model.md` |
| M5 Web app (React, RTL, tablet-first) | `web/` | B | Supabase client + scorer API |
| M6 Learning-map engine (pure TS) | `web/src/learning-map/` | B | `skill-graph.json` |
| M7 Ops | `.github/` | both | — |

## One assessment session

1. Specialist signs in with Google through Supabase Auth (Google-only scope per the 2026-11-02 decision); app calls `GET /health` to warm the scorer (B5).
2. App creates the session; a database trigger refuses it without valid consent.
3. Child reads an item; browser records 16 kHz mono WAV; next item shows immediately.
4. In the background the app posts audio + `ScoreItemRequestMeta` to `/score-item` with the user's token.
5. Scorer verifies token + `app_role`, aligns, scores, returns `ScoreItemResponse`. App stores it in `item_results`
   and uploads the audio to private storage with an expiry.
6. Session end: app posts all item responses + tap results to `/fingerprint`; stores the result as `pending_review`.
7. Learning-map engine updates mastery and proposes a plan (`pending_review`).
8. Specialist confirms/rejects flags, edits the plan, approves the parent report. RLS then releases them.
9. Practice runs offline from the item bank; taps update mastery locally and sync.

## Zero-cost hosting

| Piece | Host | Free limits (checked 2026-10-31) | Mitigation |
| --- | --- | --- | --- |
| Web | Cloudflare Pages | 500 builds/mo, 20,000 files, 25 MiB/file | bundle audio per skill |
| Auth/DB/storage | Supabase Free | 500 MB DB, 1 GB storage, 50k MAU, 5 GB egress; pauses after 1 week idle | daily keep-alive; audio expiry |
| Scorer | HF ZeroGPU Space | 2 Spaces/free account (account > 30 days); 5 GPU-min/day per signed-in caller | must serve the REST contract; else Cloud Run |
| Scorer fallback | Google Cloud Run (CPU) | free monthly allowance; billing account required | model baked into image; quantized ONNX |
| Dev | docker compose | — | same image as Cloud Run |
| Items + audio | static, built offline | — | no runtime LLM/TTS bill |

## Non-functional targets (to be measured)

| Area | Target |
| --- | --- |
| Child-facing tap/screen change | < 100 ms, no network in the loop |
| Scoring one item, warm | < 3 s p95 |
| Child waits on AI | never (background scoring, retry queue) |
| Results for specialist | < 60 s after session end |
| Cold start | warm before first item (ping at sign-in) |
| First load, tablet 4G | usable < 3 s |
| Availability in judging window | 24/7 via keep-alive + fallback switch |
| Privacy | child data only in Supabase; scorer stateless; never reaches an LLM |
| Consent/approval | unbypassable: DB triggers + RLS, tested in CI |
| Accessibility | WCAG 2.1 AA, RTL, full-diacritic fonts, no red |
| Portability | fresh clone runs from README |

## Workflow

See `CLAUDE.md` (ownership, git rules) and `docs/briefs/`.
