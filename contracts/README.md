# contracts/ — the only shared folder

Everything workstream A (Ayman: `ai/`, `content/`) and workstream B (Mahmoud: `web/`, `supabase/`) exchange is
defined here. If it is not in this folder, the other side must not depend on it.

| File | What it defines | Producer | Consumer |
| --- | --- | --- | --- |
| `schemas/basira.schema.json` | Every payload shape (`$defs`) | — | both |
| `scorer.openapi.yaml` | Scorer HTTP endpoints, auth, errors | A implements | B calls |
| `taxonomy.json` | 28 letters, IPA, dot groups, emphatic pairs, vowels, error categories | A | both |
| `skill-graph.json` | Learning-map skills and prerequisites (53 skills) | A drafts, both approve | B's learning-map engine; A's skill evidence |
| `dialect-lexicons.json` | Accepted dialect variants per lexicon (`kw`, `msa`) | A | B stores the child's lexicon id; A applies the rules |
| `phonetic-inventory.json` | 28 letters: place, manner, voicing, emphatic, mouth-shape targets, Arabic cue; vowel modifiers (A12, draft until reviewed) | A | B's mouth-shape renderer (Teach) |
| `$defs/Stage0TaskSet` | Basira-authored Stage 0 tasks (items, blocks, answers, Arabic instructions); files in `content/dist/stage0/` | A | B's examiner Stage 0 screens (B12) |
| `data-model.md` | Database tables and approval state machine | B implements | documentation for A |
| `fixtures/` | One valid example per payload; B mocks the scorer with them | both | both |
| `examples/` | Schema-validated synthetic persistence examples; never selected as mock scoring outputs | B | database/learning-map implementation review |
| `tools/validate_contracts.py` | CI check: fixtures vs schema, ids exist, no cycles | — | CI |

## Rules

1. Change a contract only in a PR that touches nothing but `contracts/` (plus the version bump below), approved by both.
2. Bump `version` in the changed file; add a line to `CHANGELOG.md`.
3. Add or update a fixture for every changed `$def`; `python contracts/tools/validate_contracts.py` must pass.
4. Breaking change = both sides update in the same day; announce it in the daily check-in.
5. Generate types, never hand-copy them: B uses `json-schema-to-typescript`, A uses `datamodel-code-generator`.

Status: v0.1.0 DRAFT. Taxonomy, skill graph and dialect rules need sign-off by the named clinical/phonetics reviewer.
