# External components and licences

Required by the competition and by non-negotiable 10. Add a row in the same PR that adds the dependency.

| Component | Used for | Licence / terms | Added by | Verified |
| --- | --- | --- | --- | --- |
| facebook/wav2vec2-xlsr-53-espeak-cv-ft | Phoneme acoustic model (Listen, primary) — ADR-002 | Apache-2.0 | A3 | 2026-11-01 |
| jonatasgrosman/wav2vec2-large-xlsr-53-arabic | Arabic letter acoustic model (emphatics, خ/ح) — ADR-002 | Apache-2.0 | A3 | 2026-11-01 |
| torch | Running the acoustic models (optional `model` extra) | BSD-3-Clause | A3 | 2026-11-01 |
| transformers | Loading the acoustic models (optional `model` extra) | Apache-2.0 | A3 | 2026-11-01 |
| librosa | Audio loading/resampling (optional `model` extra) | ISC | A3 | 2026-11-01 |
| soundfile | Audio decoding (optional `model` extra) | BSD-3-Clause | A3 | 2026-11-01 |
| gTTS (research notebooks only) | Synthetic Arabic test audio in Colab experiments; never shipped | MIT (client); uses Google Translate TTS | A3 | 2026-11-01 |
| pydantic | Contract data models in `ai/` (runtime) | MIT | A1 | 2026-11-01 |
| datamodel-code-generator | Generates `ai/basira_ai/contracts_gen/models.py` from the schema (dev only) | MIT | A1 | 2026-11-01 |
| black, isort | Formatting used by the model generator (dev only) | MIT | A1 | 2026-11-01 |
| pytest | Tests (dev only) | MIT | A1 | 2026-11-01 |
| ruff | Lint (dev only) | MIT | A1 | 2026-11-01 |
| numpy | Alignment and scoring math in `ai/` (runtime) | BSD-3-Clause | A3 | 2026-11-01 |
| jsonschema | Contract validation (dev/CI only) | MIT | bootstrap | 2026-11-01 |
