# Basira (بصيرة) — rules for every Claude session in this repo

Two people build this in parallel, each with their own Claude. Read this file fully before any change.

## Who works where

| Workstream | Person | Main folders |
| --- | --- | --- |
| A — AI & scoring | Ayman (@DXstr) | `ai/`, `content/` |
| B — Product & app | Mahmoud (@mvvhmxd) | `web/`, `supabase/` |
| Shared | both | `contracts/`, `docs/`, `.github/`, root files |

Both people may edit any folder when the work needs it. Tell the other person when you change their main folders or
`contracts/`. A contract change still updates the schema and regenerates its types, rather than working around them.

## Contracts are the interface

- `contracts/` defines every payload between A and B. Read `contracts/README.md`.
- The scorer (A) is **stateless**: audio + metadata in, JSON out. It never touches the database.
- The web app (B) stores scorer JSON unchanged and mocks the scorer with `contracts/fixtures/` until the real one is live.
- `python contracts/tools/validate_contracts.py` must pass before any PR is opened.
- Never redefine a contract type by hand; generate it from `contracts/schemas/basira.schema.json`.

## Non-negotiables (from the locked Idea, `docs/IDEA.md`)

1. Basira screens and tracks progress; it never diagnoses. Only a specialist makes referral or placement decisions.
2. Children and parents never see a risk score, a label, or the word "wrong".
3. No red anywhere in the child's experience. Correct = green; incorrect = a neutral cue inviting another try.
4. A specialist approves every flag, practice plan and parent PDF before it reaches a child or family (enforced in the database).
5. Dialect pronunciations in the child's lexicon are logged as dialect, never as errors.
6. Every synthetic result is labelled synthetic where it is shown (UI text, caption), not in a footnote. Payloads carry `synthetic`.
7. The exercise generator never receives child audio, names or results; only a skill target and constraints.
8. Generated practice items that fail validation are discarded, not repaired.
9. The hosted demo uses labelled demo profiles only; no real child data without written parental consent.
10. Every external model, API and library is disclosed with its licence (`docs/DISCLOSURES.md`).
11. No assessment session starts without a recorded, timestamped guardian consent tied to a specialist of record; enforced in code.
12. No prior-prototype code is ported; the old 16-profile rough-set rule table is not reused.
13. Every clinical, linguistic or psychometric claim traces to a named source.

## Engineering standards

- Honest status: unfinished work is reported as not done. A mock or hardcoded response is never presented as a working
  feature. Stubs raise `NotImplementedError` / throw, they do not return fake data.
- Secrets only from environment variables; never commit `.env`, never paste secrets into chat; CI runs a secret scan.
- Unit tests for scoring, referral rules, validators, learning-map logic and database policies run in CI.
- Errors are logged and surfaced to the right role, never swallowed.
- Children's data is sensitive by default: pseudonymous ids, row-level security, audio expiry.
- **Arabic first.** Arabic is the default language of every screen, message, audio prompt and document. Children learn
  to read Arabic (MSA, fully vowelled, with Kuwaiti dialect variants accepted); child screens and the parent PDF are
  Arabic only. English appears only as an optional switch on specialist/examiner screens, for English-speaking judges.
  Every user-facing string lives in an Arabic-first message catalogue, never hard-coded in English.
- Accessibility target: WCAG 2.1 AA on child screens; Arabic right-to-left; fonts with full diacritics.
- Zero-cost hosting: Cloudflare Pages (web), Supabase Free (auth/db/storage), Hugging Face ZeroGPU Space or Cloud Run (scorer).

## Git workflow

- Either person may push or merge to `main` without a review; force-pushing and deleting `main` stay blocked.
  Branches are optional: `feat/<task-code>-<short-name>`, e.g. `feat/a1-ai-scaffold` (or `contract/<name>` for contract
  changes, `chore/<name>` for docs/tooling).
- CI no longer blocks a merge, so check its result after every push to `main` and fix a failure straight away.
- New task branches start from an up-to-date `main` after the previous PR merges; no long-lived branches.
- Log any departure from `docs/IDEA.md` or `docs/DESIGN.md` in `docs/DECISIONS.md` before continuing.
- Commit messages: imperative, scoped, e.g. `ai: add forced alignment`, `web: specialist review screen`.

## Where to read more

`docs/IDEA.md` (locked scope) · `docs/DESIGN.md` (architecture, NFRs) · `docs/ADR/` · `docs/briefs/A-ai.md` ·
`docs/briefs/B-app.md` · `ai/CLAUDE.md` · `web/CLAUDE.md` · `supabase/CLAUDE.md`
