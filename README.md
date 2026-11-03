# Basira (بصيرة)

Dialect-aware **Arabic** reading screening and adaptive practice for primary-school children in Kuwait. Children read
fully vowelled Modern Standard Arabic; Kuwaiti dialect pronunciations are accepted as dialect, never marked as errors.
Every screen defaults to Arabic; English exists only as a switch on specialist and examiner screens.

**Basira screens and tracks progress; it never diagnoses.** A specialist approves every flag, practice plan and parent
report before it reaches a child or family. ADC 2026 AI Innovation Competition entry.

## How it works

| Stage | What happens | Built by |
| --- | --- | --- |
| 0. Examiner battery | Phonological awareness, fluency (WCPM), and three Basira-authored screening tasks (pattern completion, shape/letter orientation, number sense; raw score only, "not standardized"). ITPA and visual agnosia stay LICENSE PENDING until after the competition. | A10 |
| 1. Read aloud | The child reads words, pseudowords and passages; a stateless scorer listens and returns per-phoneme results | A3–A6 |
| 2. Fingerprint | Session features + rough-set referral rules with an explicit "specialist decision needed" boundary | A8 |
| 3. Teach | Practice from an offline item bank; pre-recorded Arabic voice prompts react to each reading (no live AI voice) | A11, A14 |
| 4. Prove | Practised vs unseen items per skill: `transfer_shown`, `no_transfer_yet` or `insufficient_data` | A9 |

The scorer uses two Apache-2.0 acoustic models and routes each Arabic contrast to the model that hears it (ADR-002):
a phoneme model for ق/ج/ث/ذ and the Kuwaiti variants, a letter model for emphatics and خ/ح. Practice items are
generated offline and validated; failures are discarded, never repaired. No child audio, name or result ever reaches
an LLM.

## Evidence so far (honest status)

All numbers below come from **synthetic TTS audio or one adult team member's voice**: **no child speech** and **no
Kuwaiti speaker** yet.

- **A3 model comparison** (`ai/notebooks/a3_results_v4.md`, n = 1 per case): the phoneme model separates [q]/[ɡ]/[ʔ]
  and [dʒ]/[j] on real adult speech with large margins; the letter model separates emphatic vs plain, which the
  phoneme model cannot.
- **A7 synthetic evaluation** (`ai/eval/report-synthetic.md`, 308 cases): dot confusions found 86%, emphatic 72%;
  all 22 dialect cells behaved as designed (ج read [j] accepted under the Kuwaiti lexicon, flagged under MSA);
  4% of non-target consonants falsely flagged. Short vowels are never judged from audio (tap tasks instead) and
  omissions are not detected yet; both are stated, not hidden.
- **Not tested:** Kuwaiti ق→[g] and ك→[tʃ] on real Kuwaiti speech, insertions, any child. Collecting that data is
  Phase 2 of `docs/ROADMAP.md`.

## Repo map

| Folder | Owner | What |
| --- | --- | --- |
| `contracts/` | both | The interface between workstreams: JSON Schema (v0.4.0), scorer API, taxonomy, skill graph, lexicons, fixtures |
| `ai/` | Ayman (A) | Scoring core (Python) + stateless FastAPI scorer, evaluation (`ai/eval/`), notebooks |
| `content/` | Ayman (A) | Offline pipeline → `content/dist/`: item bank (263 items + Maryam TTS audio), voice prompts, Stage 0 tasks |
| `web/` | Mahmoud (B) | React web app (child, specialist, examiner, parent PDF), Arabic/RTL by default |
| `supabase/` | Mahmoud (B) | Database, auth, row-level security, consent and approval triggers |
| `docs/` | both | Idea Lock, design, ADRs, decisions, roadmap, briefs, disclosures |

## Run it

```sh
# contracts
pip install "jsonschema>=4.18" && python contracts/tools/validate_contracts.py

# scorer (from ai/): tests, then the API (needs SUPABASE_JWKS_URL or SUPABASE_JWT_SECRET)
python -m venv .venv && .venv/Scripts/activate        # source .venv/bin/activate on macOS/Linux
pip install -e ".[dev]" && pytest -q
pip install -e ".[model]"                             # torch + transformers, to run the real models
uvicorn service.app:build --factory --port 8000       # http://localhost:8000/health, /docs

# content (from ai/)
python -m basira_ai.content build        # item bank
python -m basira_ai.content prompts      # Teach voice prompts
python -m basira_ai.content stage0       # Basira-authored Stage 0 tasks
```

Docker: `docker compose -f ai/compose.yaml up --build` from the repo root. Web and database: see
[`web/README.md`](web/README.md) and [`supabase/README.md`](supabase/README.md).

## Status (2026-11-03)

| Area | Done | Not done yet |
| --- | --- | --- |
| Contracts | v0.4.0, validated in CI, generated types for Python, TypeScript and SQL | Clinical/phonetics sign-off of taxonomy, skill graph and dialect rules |
| Scorer (A) | Listen, dialect rules, error categories, fingerprint, prove, Stage 0 scoring, content pipeline, voice-prompt text, synthetic evaluation | Public hosting (A13, Hugging Face ZeroGPU Space prepared), prompt audio (needs the Azure key), omission/insertion detection (A5b, needs data) |
| App (B) | Scaffold, Supabase platform with RLS, Google sign-in, scorer client with honest fixture mode | Child session, specialist review, learning map, Teach, Prove, parent PDF, examiner screens, web hosting (B6–B14) |

Every generated item, prompt and Stage 0 task ships `unreviewed` until the named specialist approves it. Rules for
contributors (human or AI): [`CLAUDE.md`](CLAUDE.md).
