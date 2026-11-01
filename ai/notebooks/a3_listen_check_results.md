# A3 end-to-end check — results v1 (2026-11-01)

`basira_ai.acoustic.Listener` (this branch) on both real models (ADR-002), Google Colab T4 GPU.
Notebook: `ai/notebooks/a3_listen_check.ipynb`.

**Audio:** 12 SYNTHETIC clips (Google TTS Arabic, adult voice; pseudowords for the error pairs) and 4 REAL voice
notes from an adult Egyptian team member producing the target sounds (not a Kuwaiti speaker). No child speech.
One clip per case.

| Case | Audio | Target consonant | Expected | Basira heard | Score | Decided by | Right? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| قَلَم | synth | ق | q | q | 0.93 | phone | ✅ |
| ثَمِيك | synth | ث | θ | θ | 0.99 | phone | ✅ |
| ثَمِيك read تَمِيك | synth | ث | θ | t (ت) | 0.00 | phone | ✅ |
| ذَرُوم | synth | ذ | ð | ð | 0.99 | phone | ✅ |
| ذَرُوم read دَرُوم | synth | ذ | ð | d (د) | 0.03 | phone | ✅ |
| خَلُوم | synth | خ | x | x | 1.00 | phone | ✅ |
| خَلُوم read حَلُوم | synth | خ | x | ħ (ح) | 0.00 | letter | ✅ |
| صَمُوك | synth | ص | sˤ | sˤ | 1.00 | phone + letter | ✅ |
| صَمُوك read سَمُوك | synth | ص | sˤ | s (س) | 0.00 | letter | ✅ |
| دَجَاج | synth | ج ×2 | dʒ | dʒ | 0.99, 1.00 | phone | ✅ |
| دَجَاج read دَيَاي | synth | ج ×2 | dʒ | j | 0.00, 0.02 | phone | ✅ |
| ذَهَبَ الْوَلَدُ إِلَى الْمَدْرَسَةِ | synth | all 17 consonants | — | all as expected | 0.88–1.00 | phone / letter | ✅ |
| قَلَم said "qalam" | **real** | ق | q | q | 0.97 | phone | ✅ |
| قَلَم said "galam" | **real** | ق | q | **g** (dialect variant) | 0.00 | phone | ✅ |
| قَلَم said "ʔalam" (Cairene) | **real** | ق | q | **ʔ** (hamza, not g) | 0.13 | phone | ✅ |
| دَجَاج said "dayay" | **real** | ج ×2 | dʒ | **j** | 0.01, 0.00 | phone | ✅ |

**16 / 16 cases decided correctly.** "Score" is the expected sound's probability among its candidates; a low score
means Basira heard a different candidate (which A4/A5 then classify as dialect variant or error type).

Limits: n = 1 per case; synthetic and one adult non-Kuwaiti speaker; ض/د, ط/ت, ظ/ذ and ك→[tʃ] untested.
These results show the pipeline works with the real models; they are not accuracy figures for children.
