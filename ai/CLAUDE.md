# ai/ — owned by Ayman (workstream A)

Read the root `CLAUDE.md` and `docs/briefs/A-ai.md` first.

- Edit only `ai/` and `content/`. Read `contracts/`; never edit it outside a `contract/*` PR.
- `ai/basira_ai/` is a pure library (no web framework). `ai/service/` is a thin FastAPI adapter implementing
  `contracts/scorer.openapi.yaml` exactly.
- The service is stateless: no database credentials, no writes, no stored audio.
- Every response validates against `contracts/schemas/basira.schema.json` (contract tests in `ai/tests/`).
- Set `synthetic=true` for TTS or fixture audio. Short-vowel errors are never inferred from audio.
- Stubs raise `NotImplementedError`; never return fake scores.
- Contract models are generated into `basira_ai/contracts_gen/models.py`; never edit that file by hand.

## Commands (run inside `ai/`)

```
python -m venv .venv                      # once
.venv/Scripts/activate                    # Windows  (source .venv/bin/activate on macOS/Linux)
pip install -e ".[dev]"                   # install with dev tools
ruff check .                              # lint
pytest -q                                 # tests (includes contract + generated-model drift checks)
python scripts/gen_contracts.py           # regenerate models after a contracts change
python scripts/gen_contracts.py --check   # verify generated models are current
pip install -e ".[model]"                 # heavy: torch + transformers, only to run the real models
uvicorn service.app:build --factory --port 8000   # scorer API (needs SUPABASE_JWKS_URL or SUPABASE_JWT_SECRET)
```

Docker (from the repo root): `docker compose -f ai/compose.yaml up --build` → http://localhost:8000/health
