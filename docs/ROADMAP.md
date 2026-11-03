# Basira roadmap: from competition build to a data-driven product

The competition build (5 November 2026) uses pretrained, licence-safe acoustic models with forced alignment
(ADR-002). It needs no training data, and it makes no accuracy claims about children. The next phase collects
Arabic voice data so the models, the error categories and the learning map become measurably more precise.
No claim in the pitch changes until data from this phase supports it (see the claims table in `docs/IDEA.md`).

## Why data comes next

A survey of public speech data (`docs/research/speech-datasets.md`, on the A3 branch until it merges) found **no
dataset of Kuwaiti or Gulf children reading aloud**. Adult Gulf speech exists but is mostly non-commercial or paid.
Basira's own data collection fills this gap, and the resulting corpus is itself a contribution.

## Phase 1: competition build (now → 5 Nov 2026)

- Pretrained phoneme + letter models, each Arabic contrast routed to the model that hears it (ADR-002).
- Evidence so far: synthetic adult TTS and one adult team member's voice notes (n = 1 per case).
- Short vowels measured by tap tasks, not audio. Learning map uses simple, explainable mastery rules.
- Stage 0: Basira-authored pattern, orientation and number-sense tasks (new items, raw score only, not standardized);
  ITPA and visual agnosia stay LICENSE PENDING (DECISIONS 2026-11-03).

## Phase 2: voice data collection (after the competition)

All collection follows the consent and ethics rules in `docs/IDEA.md` (written guardian consent, ethics approval,
specialist of record, audio expiry unless research consent is given).

| Source | What | Purpose |
| --- | --- | --- |
| Consenting Kuwaiti adults (5–10) | The reading battery, read normally and with scripted errors | Confirm the Kuwaiti dialect rules (ق→[g], ج→[j], ك→[tʃ]) on real Kuwaiti speech; test the untested contrasts (ض/د, ط/ت, ظ/ذ, ك→[tʃ]) |
| AraYoungVoices (research access requested from the authors) | Children aged 7–18 reading aloud, including Gulf native speakers, with verbatim transcripts | First evaluation on real children's reading |
| Basira pilot (40–60 children, grades 2–4, one term, partner centre in Kuwait) | Recordings + two specialists' independent annotations | The real validation set: detection F1, category precision/recall, dialect fairness, specialist agreement |
| Research-only adult sets (e.g. Kejue `ar-kw`) | Transcribed Kuwaiti adult speech | Optional cross-check of dialect rules; never used to train or ship anything (non-commercial licences) |

## Phase 3: use the data to make Basira more precise

1. **Calibrate scoring:** set per-contrast decision thresholds from real recordings instead of defaults.
2. **Adapt the acoustic models to child speech:** fine-tune the Apache-2.0 models on consented child recordings;
   re-test whether one model can replace the two-model routing.
3. **Short vowels from audio:** test whether the phoneme model's vowel output is reliable enough to add audio
   evidence to the tap tasks. Claim it only if the pilot shows it.
4. **Referral rules:** re-derive the rough-set rules from specialist-labelled pilot sessions (replacing the
   synthetic-only rules).
5. **Learning map:** fit mastery parameters (e.g. Bayesian knowledge tracing) to real progress data, and check that
   unseen-passage probes predict transfer.
6. **Stage 0 instruments:** request licences (Pearson for Raven's, PRO-ED for ITPA-3, the Azzam 2007 Arabic norms
   from Ain Shams); build a Basira ITPA-style language task only with a reviewer; add visual agnosia screening only
   after a physician names the protocol. Collect local norms for the three Basira tasks before any scaled score.
7. **Report results broken down** by grade, sex and dialect background, as `docs/IDEA.md` requires.

## Gate for every claim

A claim moves from "cannot say" to "can say" only when the data behind it is in the repo (or its evaluation report
is), labelled with its source (synthetic / adult / child), its size and its date.
