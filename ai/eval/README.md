# ai/eval: synthetic evaluation (A7)

Everything in this folder is **synthetic**: TTS audio of an adult synthetic voice, never a child. It measures whether
the scorer finds errors that were written into the text a TTS voice read. It is not evidence about children.

| File | What |
| --- | --- |
| `synthetic-set.json` | The set: 308 cases from 40 item-bank words; 4 severities (none, mild, moderate, severe) crossed with the `msa` and `kw` lexicons, plus dialect cells (ج as [j], ق as [ʔ]). Reproducible. |
| `report-synthetic.md`, `results-synthetic.json` | Output of the Colab run (added after the run). |

Rebuild the set (deterministic, seed 7007):

```
cd ai
python -c "from pathlib import Path; from basira_ai.eval_synthetic import write_set; write_set(Path('eval/synthetic-set.json'), Path('../content/dist/item-bank.json'))"
```

Run the evaluation: open `ai/notebooks/a7_synthetic_eval.ipynb` in Colab (T4 GPU) via
https://colab.research.google.com/github/DXstr/Kuwait-Dyslexia/blob/feat/a7-synthetic-eval/ai/notebooks/a7_synthetic_eval.ipynb
and Run all. Not testable with TTS from Arabic text: Kuwaiti ق -> [g] and ك -> [tʃ] (listed in the set as `untested`).

## What the first run says (2026-11-03, synthetic only)

Full numbers: `report-synthetic.md`. In short, on TTS audio:

- **Dot confusions** found 86% (right category 83%), **emphatic confusions** 72% (69%). Some misses are likely the TTS
  voice "autocorrecting" a nonword back to a real word; not separated here.
- **Dialect:** all 22 dialect cells behaved as designed: ج read [j] was accepted under the Kuwaiti lexicon and flagged
  under MSA; ق read [ʔ] (not a Kuwaiti rule) was flagged under both.
- **Short vowels 0%, omissions 0% right category:** as designed (not inferred from audio / not detected yet).
- **False alarms:** 4% of non-target consonants in the injected set; 18% of clean words had at least one flag. On the
  item bank's own Maryam clips, 78% of clips were flag-free (8% of consonants flagged). The most common false alarm on
  Maryam is ق heard as [k] (5 of 6; once [g]), then ط heard as plain [t]. These are the first thresholds to calibrate
  (ROADMAP phase 3, item 1) and a reason the specialist confirms every flag.

Untested: Kuwaiti ق -> [g], ك -> [tʃ], insertions, any real child or Kuwaiti speaker. Nothing here is evidence about
children.
