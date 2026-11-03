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
