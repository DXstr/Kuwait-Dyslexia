# content/ — owned by Ayman (workstream A)

Offline pipeline producing practice items and audio. Output: `content/dist/item-bank.json` (+ audio files), valid
against `$defs/ItemBank`. The web app reads `content/dist/` read-only.

- Prompts contain only a skill target and constraints; never child audio, names or results.
- Deterministic validators run on every item; failures are discarded, never repaired.
- Items marked `probe_only` never appear in practice.
- Generated audio is TTS: `synthetic_audio = true`; the TTS engine is listed in `docs/DISCLOSURES.md`.
