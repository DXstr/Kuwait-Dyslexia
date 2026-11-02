# ADR-002: Two acoustic models, each contrast routed to the model that hears it

- Status: Proposed (in the A3 PR; Mahmoud to approve)
- Date: 2026-11-01
- Decider: Ayman (A); evidence in `ai/notebooks/a3_results_v4.md`

## Context

The Listen stage scores each expected sound by CTC forced alignment and a goodness-of-pronunciation comparison
against competing sounds. Basira's core claim is that a Kuwaiti child who says ق as [g] (or ج as [j]) is not marked
wrong, while real reading errors (dot and emphatic confusions) are caught. Candidate models had to be licence-safe for
a competition entry and a later product (no non-commercial licences; Meta MMS is CC-BY-NC and was excluded).

## Decision

Use two Apache-2.0 models and a routing table that assigns every contrast to one model:

| Model | Licence | Role |
| --- | --- | --- |
| `facebook/wav2vec2-xlsr-53-espeak-cv-ft` (phonemes) | Apache-2.0 | Primary: alignment of the whole word; ق (q/ɡ/ʔ), ج (dʒ/j), ك (k/tʃ, untested), ث/ت, ذ/د and all other consonant identity |
| `jonatasgrosman/wav2vec2-large-xlsr-53-arabic` (letters) | Apache-2.0 | Secondary: emphatic vs plain (ص/س, and ض ط ظ until tested), خ/ح |

The routing table is data (`ai/basira_ai/` config), not code, so a contrast can move between models after more
evidence without a code change. Each `PhonemeResult` stays in the contract's IPA; model-specific symbols (espeak
`χ`, `s̪`, `a.`) are mapped internally and never leak into the API.

Expected pronunciations are produced by Basira's own rule-based converter from fully diacritized text using
`contracts/taxonomy.json`, not by espeak/phonemizer (both GPL-3.0, which we avoid linking into the scorer).

## Consequences

- Both models load at startup (~1.26 GB each). On a GPU host this is fine; on CPU (Cloud Run fallback) latency must be
  measured in A6/A13 against the < 3 s per item target.
- Claims stay narrow: "the model can represent these contrasts" (n = 1 per case, adult speech, one non-Kuwaiti real
  speaker). Untested contrasts are listed in the results file and must not be claimed.
- Short vowels remain measured by tap tasks (non-negotiable claim table), even though the phoneme model emits vowels.
- Revisit when Kuwaiti adult recordings exist, and again with child speech in the pilot.
