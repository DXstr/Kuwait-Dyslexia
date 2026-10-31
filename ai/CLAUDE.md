# ai/ — owned by Ayman (workstream A)

Read the root `CLAUDE.md` and `docs/briefs/A-ai.md` first.

- Edit only `ai/` and `content/`. Read `contracts/`; never edit it outside a `contract/*` PR.
- `ai/basira_ai/` is a pure library (no web framework). `ai/service/` is a thin FastAPI adapter implementing
  `contracts/scorer.openapi.yaml` exactly.
- The service is stateless: no database credentials, no writes, no stored audio.
- Every response validates against `contracts/schemas/basira.schema.json` (contract tests in `ai/tests/`).
- Set `synthetic=true` for TTS or fixture audio. Short-vowel errors are never inferred from audio.
- Stubs raise `NotImplementedError`; never return fake scores.

Commands are added here by the scaffold PR (install, test, lint, run service, build image).
