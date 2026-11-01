# External components and licences

Required by the competition and by non-negotiable 10. Add a row in the same PR that adds the dependency.

| Component | Used for | Licence / terms | Added by | Verified |
| --- | --- | --- | --- | --- |
| pydantic | Contract data models in `ai/` (runtime) | MIT | A1 | 2026-11-01 |
| datamodel-code-generator | Generates `ai/basira_ai/contracts_gen/models.py` from the schema (dev only) | MIT | A1 | 2026-11-01 |
| black, isort | Formatting used by the model generator (dev only) | MIT | A1 | 2026-11-01 |
| pytest | Tests (dev only) | MIT | A1 | 2026-11-01 |
| ruff | Lint (dev only) | MIT | A1 | 2026-11-01 |
| numpy | Alignment and scoring math in `ai/` (runtime) | BSD-3-Clause | A3 | 2026-11-01 |
| jsonschema | Contract validation (dev/CI only) | MIT | bootstrap | 2026-11-01 |
