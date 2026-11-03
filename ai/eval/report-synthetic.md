# A7 synthetic evaluation (SYNTHETIC: TTS audio, adult synthetic voice, no child speech)

Set 0.1.0 (seed 7007), scorer facebook/wav2vec2-xlsr-53-espeak-cv-ft; jonatasgrosman/wav2vec2-large-xlsr-53-arabic, run 2026-11-03T18:13Z on Colab cuda Tesla T4, torch 2.11.0+cu130, Python 3.13.16. TTS for injected cases: gTTS (Google Translate TTS, lang=ar). Errors were written into the text the TTS voice read; a voice may 'autocorrect' a nonword back to a real word, which shows up here as a miss.

## Injected errors

| Error | Found (status error) | Right category |
| --- | --- | --- |
| dot_confusion | 86% (132/154) | 83% (128/154) |
| emphatic_confusion | 72% (42/58) | 69% (40/58) |
| omission | 29% (14/48) | 0% (0/48) |
| short_vowel | 0% (0/120) | 0% (0/120) |

Expected by design: `short_vowel` is never flagged (vowels are unscored from audio) and `omission` is not detected yet (verdict.py). Both are listed so the limit is measured, not hidden.

## Whole cases by severity (any error flagged)

| Severity | Flagged |
| --- | --- |
| none | 18% (14/80) |
| mild | 55% (44/80) |
| moderate | 90% (70/78) |
| severe | 88% (42/48) |

False alarms: 4% (33/772) of non-target consonants flagged; clean cases with any flag 18% (14/80). Most often: {'baa': 6, 'daal': 6, 'daad': 6, 'siin': 4, 'qaaf': 4, 'ghayn': 4, 'dhaal': 2, 'zhaa': 2, 'kaaf': 1}.

## Dialect

| Cell | Expected | Got it |
| --- | --- | --- |
| kw_jiim_j | dialect_variant (kw.jiim-j) | 100% (4/4) |
| msa_jiim_j | error | 100% (4/4) |
| kw_qaaf_glottal | error | 100% (7/7) |
| msa_qaaf_glottal | error | 100% (7/7) |

Not tested: Kuwaiti ق -> [g] (kw.qaaf-g): no Arabic letter makes a TTS voice say [g]; Kuwaiti ك -> [tʃ] (kw.kaaf-tsh): no Arabic letter makes a TTS voice say [tʃ]; insertions: not generated (not detected by the scorer yet, verdict.py).

## Item-bank clips (Azure Maryam TTS) scored against their own text

Clips with no flag: 78% (70/90); false alarms 8% (25/305) of consonants. Most often: {'qaaf': 6, 'ttaa': 4, 'baa': 4, 'khaa': 3, 'taa': 2, 'jiim': 2, 'daad': 1, 'dhaal': 1, 'zhaa': 1, 'daal': 1}.

Every number is synthetic and n is small; none of it is evidence about children (CLAUDE.md non-negotiable 6).
