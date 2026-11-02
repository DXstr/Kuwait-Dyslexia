# Gulf / Arabic speech datasets — survey (2026-11-01)

Question: is there speech data (children or adults, any Gulf/Khaleeji variety, ideally Kuwaiti) that Basira can use to
choose or validate its acoustic models? Searched open repositories (Hugging Face, Kaggle, Mendeley, IEEE DataPort,
MIT SLS), arXiv, and commercial vendors.

**Answer: no public dataset of Kuwaiti (or any Gulf) children reading aloud exists.** One new children's read-speech
corpus with Gulf speakers exists but its release status is unknown. Adult Gulf speech exists, mostly non-commercial or
paid. This matches the handover's finding that the field-wide gap is real.

## Children

| Dataset | What | Gulf? | Licence / access | Use for Basira |
| --- | --- | --- | --- | --- |
| [AraYoungVoices](https://arxiv.org/abs/2610.05044) (Chowdhury, Sheikh Ali, Lachemat, Mubarak, 2026) | 151.72 h read speech, 286 speakers aged 7–18 (AraKids 7–12); 146 L1 incl. Gulf, Egyptian, Levantine, N. African; verbatim transcripts | Yes (country not stated) | Release and licence not stated on the abstract page | **Best match** — evaluation on real children's reading. Contact the authors |
| [Arabic Little STT](https://arxiv.org/pdf/2510.23319) (2025) | 355 utterances, 288 children aged 6–13, classroom | No (Levantine) | Public (per paper) | Small sanity check of child acoustics only |
| [Phonics Exercise Audio Dataset](https://data.mendeley.com/datasets/rmkznfhfsh/1) (Mendeley, 2025) | 198 clips, correct/incorrect letters أ–ت, for dyslexia | No | Licence not shown | Too small; letter-level only |
| [ArPA](https://arxiv.org/pdf/2411.13592) (2024) | Children's correct/mispronounced alphabet + TTS-made substitution errors | No | See paper | Method reference |
| Qatar University child phonology ([QSpace](https://qspace.qu.edu.qa/handle/10576/33471)) | Spontaneous speech, 140 Qatari children | Yes (Qatari) | Availability unconfirmed | Possible future partner |

## Adults (Gulf)

| Dataset | What | Licence / access | Use for Basira |
| --- | --- | --- | --- |
| [Kejue Voice](https://huggingface.co/datasets/Arabic-STT/kejue-voice) `ar-kw` config | ~28K transcribed rows labelled Kuwaiti, aggregated from ADI-17, MGB-2, SADA, YouTube, etc. | CC BY-NC-SA 4.0, gated; mixed upstream licences | Research-only evaluation of dialect rules on Kuwaiti adult speech (never training/product) |
| [ADI-17](https://sls.csail.mit.edu/downloads/adi17) (MIT) | ~3,000 h YouTube, 17 countries incl. Kuwait; dialect labels, no transcripts | Research only, passcode by e-mail; video copyright stays with owners; Kuwait ~77% label consistency | Limited (no transcripts) |
| [SADA](https://ieee-dataport.org/node/14747) (SDAIA / Saudi Broadcasting Authority) | ~668 h Saudi TV (Najdi, Hijazi, Khaleeji) | CC BY-NC-SA 4.0 (Hugging Face mirror metadata conflicts) | Research evaluation only |
| [Nexdata UAE](https://huggingface.co/datasets/Nexdata/UAE_Arabic_Spontaneous_Speech_Data) / [Saudi](https://www.nexdata.ai/datasets/speechrecog/1150) | 749 h / 849 h spontaneous adult speech | Paid, commercial | Not needed now ($0 constraint) |
| [SpeechDataAI Gulf conversational](https://huggingface.co/datasets/SpeechDataAI/gulf-arabic-conversational-speech) | 500 h Saudi Gulf conversation | Paid, commercial; samples on request | Not needed now |
| Common Voice Arabic | Crowd-read sentences, mixed dialect backgrounds | CC0 | Free adult read speech (already in both models' training data) |

## Implications

1. Nothing found changes ADR-002: Basira uses pretrained models + forced alignment and does not need a training corpus.
2. No non-commercial (NC) dataset may be used to train or ship anything; NC data is for research evaluation only, and
   any such use is disclosed.
3. Highest-value next step: ask the AraYoungVoices authors for research access (real children reading with transcripts,
   including Gulf L1 speakers).
4. Real Kuwaiti speech for the dialect rules: record consenting Kuwaiti adults (the plan in `docs/IDEA.md`), optionally
   cross-checked on Kejue `ar-kw` in Colab.
5. A Kuwaiti children's reading corpus remains the gap Basira's pilot (40–60 children) would fill.
