# Basira (بصيرة)

Dialect-aware Arabic reading screening and adaptive practice for primary-school children in Kuwait.
Screening and progress tracking only — Basira never diagnoses. ADC 2026 AI Innovation Competition entry.

## Repo map

| Folder | Owner | What |
| --- | --- | --- |
| `contracts/` | both | The interface between workstreams: schemas, scorer API, taxonomy, skill graph, lexicons, fixtures |
| `ai/` | Ayman (A) | Scoring core (Python) + stateless scorer service |
| `content/` | Ayman (A) | Offline practice-item and audio pipeline → `content/dist/` |
| `web/` | Mahmoud (B) | React web app (child, specialist, examiner, parent PDF) |
| `supabase/` | Mahmoud (B) | Database, auth, row-level security, consent and approval triggers |
| `docs/` | both | Idea Lock, design, ADRs, decisions, briefs, disclosures |

## Start here

1. Read `CLAUDE.md` (rules for humans and Claude alike).
2. Read your brief: `docs/briefs/A-ai.md` or `docs/briefs/B-app.md`.
3. Check contracts: `pip install "jsonschema>=4.18" && python contracts/tools/validate_contracts.py`

Run instructions for each module are added by its scaffold PR.

## Status

Day 0 (2026-10-31): contracts v0.1.0 draft, docs, CI. No feature code yet.
