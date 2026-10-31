# Brief — Workstream A: AI & scoring (Ayman)

You own `ai/` and `content/`. You never edit `web/` or `supabase/`. You deliver exactly what `contracts/` promises.

## What B is waiting for (keep these dates or announce a slip in the daily check-in)

| Deliverable | Contract | Target |
| --- | --- | --- |
| Scorer running in docker: `/health`, `/score-item` | `scorer.openapi.yaml`, `ScoreItemResponse` | day 2 |
| Phonetic inventory schema + first data | contracts PR adding `$defs/PhoneticInventory` | day 2–3 |
| `/fingerprint`, `/probe`, `/stage0/score` | matching `$defs` | day 3 |
| Item bank v1 + audio | `ItemBank` → `content/dist/` | day 3 |
| Hosted scorer URL | same contract | day 4 |

## Your tasks, in order

1. **AI scaffold** — Python 3.11+, `pyproject.toml`, pytest, ruff; models generated from the schema with
   `datamodel-code-generator` into `ai/basira_ai/contracts_gen/`. Add the `ai` CI job.
2. **Contract loaders** — taxonomy, skill graph, dialect lexicons read from `contracts/` (never copied).
3. **Listen** — forced alignment of audio to the known diacritized text, per-phoneme goodness of pronunciation.
   Check the model licence first and record it in `docs/DISCLOSURES.md`.
4. **Dialect lexicon** — apply `dialect-lexicons.json` rules: an accepted variant → `status=dialect_variant` + rule id.
5. **Error categories + skill evidence** — dot/emphatic from taxonomy tables; omission/insertion/substitution;
   `skill_evidence` per item (letter, dot group, emphatic pair, positional, decoding). Short vowels never from audio.
6. **Service** — FastAPI implementing the OpenAPI file exactly: Supabase JWT verification via JWKS, `app_role` check,
   CORS from env, 120 req/min per user, structured logs, `/health` warm/cold. Dockerfile with the model baked in;
   `docker compose` service. Contract test: every response validates against the schema.
7. **Synthetic evaluation set** — TTS-generated items with injected errors at 4 severities, crossed with dialect
   variants; reproducible script; every output labelled synthetic.
8. **Fingerprint** — session features + rough-set rules re-derived from scratch (the old 16-profile table is banned),
   explicit `specialist_decision_needed` boundary, Arabic + English rule text.
9. **Prove** — practised vs unseen per skill, `transfer_shown | no_transfer_yet | insufficient_data`.
10. **Stage 0 scoring** — instrument scoring rules; unlicensed → `license_pending`, `scaled_score=null`, never invented norms.
11. **Content pipeline** — offline generation (no child data in prompts), deterministic validators (script, full
    diacritics, length, dot-group / emphatic pair checks, vowel-option checks), failures discarded, pre-rendered audio,
    output `content/dist/item-bank.json` valid against `ItemBank`.
12. **Phonetic inventory** — 28 letters (IPA, place, manner, voicing, emphatic, rendering notes) verified against
    Watson (2002); reviewer sign-off tracked.
13. **Hosting** — verify a ZeroGPU Space can serve the REST contract; otherwise Cloud Run. Keep-alive ping.

## Definition of done

Responses validate against the contract · tests green · synthetic flag correct · no child data reaches an LLM ·
disclosures updated · reviewed and merged by Mahmoud.
