# A3 model comparison — results v4 (2026-11-01)

Notebook: `ai/notebooks/a3_model_comparison.ipynb` (v4), run on Google Colab (T4 GPU), Python 3.13.16,
transformers 4.46.3, torch 2.11.0+cu130.

**Audio:** 11 clips SYNTHETIC (Google TTS Arabic, adult voice) + 4 REAL voice notes from an adult Egyptian team
member producing the target sounds (not a Kuwaiti speaker). One clip per case. No child speech.

**Method:** expected word → expected phone/letter sequence → CTC Viterbi forced alignment → mean log-posterior of the
expected unit vs a competing unit over the aligned frames (higher = more likely; 0 is certain).

| Case | Audio | Phoneme model `facebook/wav2vec2-xlsr-53-espeak-cv-ft` | Letter model `jonatasgrosman/wav2vec2-large-xlsr-53-arabic` |
| --- | --- | --- | --- |
| ق MSA | synth | q −0.37 vs ɡ −6.55, vs ʔ −4.58 → **q** ✅ | top ق ✅ |
| ق MSA | **real** | q −0.23 vs ɡ −7.34, vs ʔ −5.43 → **q** ✅ | top ق ✅ |
| ق as [g] | **real** | ɡ −0.03 vs q −8.78 → **ɡ** ✅ | top غ ❌ (no [g] unit) |
| ق as [ʔ] (Cairene) | **real** | ʔ −3.54 vs q −5.38; ɡ −8.16 → **ʔ** ✅ | top أ ✅ |
| ج MSA | synth | dʒ −0.80 vs j −6.89 → **dʒ** ✅ | top ج ✅ |
| ج as [j] | synth | j −0.95 vs dʒ −7.04 → **j** ✅ | top ي ✅ |
| ج as [j] | **real** | j −2.49 vs dʒ −6.73 → **j** ✅ | top ي ✅ |
| ث (pseudoword) | synth | θ −0.25 vs t −4.73, vs f −3.38 → **θ** ✅ | top ف ❌ |
| ث read ت | synth | t −0.16 vs θ −6.80 → **t** ✅ | top ت ✅ |
| ذ (pseudoword) | synth | ð −0.21 vs d −4.44 → **ð** ✅ | top ن ❌ |
| ذ read د | synth | d −0.12 vs ð −3.69 → **d** ✅ | top ن ❌ (د 3rd) |
| خ (pseudoword) | synth | model emits x (−0.38), χ −3.32 | top خ ✅ |
| خ read ح | synth | χ −2.92 vs ħ −2.42; free decode heard x ❌ unreliable | top ح ✅ |
| ص (pseudoword) | synth | s −0.87 beats s̪ −2.96; plain a beats a. ❌ | top ص ✅ |
| ص read س | synth | s −0.08 → plain ✅ (but cannot separate from correct ص) | top س ✅ |

v3 (same models) additionally showed: the letter model heard ث as ف on a real word (ثوب) too; a TTS clip of دهب
was autocorrected to ذهب by the voice (invalid test, fixed in v4 with pseudowords).

## Conclusions

1. The phoneme model separates the Kuwaiti dialect contrasts on real speech with large margins: [q] / [ɡ] / [ʔ]
   and [dʒ] / [j]. It also handles ث/ت and ذ/د.
2. The phoneme model cannot separate emphatic from plain consonants (ص/س) or خ/ح; the letter model can.
3. The letter model cannot represent [ɡ] and repeatedly misses ث and ذ.
4. Therefore: route each contrast to the model that passed it (ADR-002).

## Not yet tested

ض/د, ط/ت, ظ/ذ (emphatics other than ص), Kuwaiti ك→[tʃ], positional and short-vowel effects, any Kuwaiti speaker,
any child speaker. Every number above is n = 1.
