"""A7 synthetic evaluation set: injected reading errors at 4 severities, crossed with dialect variants.

EVERYTHING HERE IS SYNTHETIC. Audio comes from TTS of the *spoken* text (an adult synthetic voice), never from a child.
The numbers measure whether the scorer finds errors that were written into the text the TTS voice read; they say
nothing yet about real children. Every output carries `synthetic: true`.

1. `build_set()` (deterministic, no model): picks real words from the item bank and writes cases
   {expected_text, spoken_text, lexicon, severity, injected[]}. Severities: none (0 errors), mild (1), moderate (2),
   severe (3, one of them an omission). Error kinds: dot_confusion, emphatic_confusion, short_vowel, omission.
   Dialect cells: ج read [j] (written ي) under the Kuwaiti lexicon (expected: dialect_variant) and under MSA (expected:
   error); ق read [ʔ] (written أ, a Cairene variant, not a Kuwaiti rule) under both (expected: error).
   Not producible with TTS from Arabic text, so not tested: Kuwaiti ق -> [g] and ك -> [tʃ].
2. `evaluate_case()` compares one ScoreItemResponse with what was injected (by unit index, via Unit.char_index).
3. `summarize()` aggregates; `report_markdown()` writes the report for ai/eval/.

Known by design (verdict.py): short vowels are never scored from audio, omissions/insertions are not detected yet. The
set still contains them, so the report shows those limits as measured facts rather than leaving them out.
"""

from __future__ import annotations

import json
import random
from collections import Counter, defaultdict
from pathlib import Path

from basira_ai.content import arabic
from basira_ai.g2p import DAMMA, FATHA, KASRA, to_units
from basira_ai.reference import ReferenceData, reference_data

SET_VERSION = "0.1.0"
SEED = 7007
SEVERITY_ERRORS = {"none": 0, "mild": 1, "moderate": 2, "severe": 3}

# written-letter swaps; a dot swap stays inside a dot group of contracts/taxonomy.json, an emphatic swap is a pair
DOT_SWAP = {"ب": "ت", "ت": "ث", "ث": "ت", "ن": "ب", "ج": "خ", "ح": "خ", "خ": "ح", "د": "ذ", "ذ": "د", "ر": "ز",
            "ز": "ر", "س": "ش", "ش": "س", "ص": "ض", "ض": "ص", "ط": "ظ", "ظ": "ط", "ع": "غ", "غ": "ع", "ف": "ق",
            "ق": "ف"}
EMPHATIC_SWAP = {"س": "ص", "ص": "س", "د": "ض", "ض": "د", "ت": "ط", "ط": "ت", "ذ": "ظ", "ظ": "ذ"}
VOWEL_SWAP = {FATHA: KASRA, KASRA: FATHA, DAMMA: FATHA}
NOT_OMITTED = set("اويىءأإآؤئة")  # long vowels / hamza seats / taa marbuta: dropping them is not a clean omission
DIALECT_CELLS = [
    # (name, written letter, written replacement, lexicon, expected status, dialect rule)
    ("kw_jiim_j", "ج", "ي", "kw", "dialect_variant", "kw.jiim-j"),
    ("msa_jiim_j", "ج", "ي", "msa", "error", None),
    ("kw_qaaf_glottal", "ق", "أ", "kw", "error", None),
    ("msa_qaaf_glottal", "ق", "أ", "msa", "error", None),
]
UNTESTED = ["Kuwaiti ق -> [g] (kw.qaaf-g): no Arabic letter makes a TTS voice say [g]",
            "Kuwaiti ك -> [tʃ] (kw.kaaf-tsh): no Arabic letter makes a TTS voice say [tʃ]",
            "insertions: not generated (not detected by the scorer yet, verdict.py)"]


def _letters(word: str) -> list[list]:
    return [[ch, set(marks)] for ch, marks in arabic.split_letters(word)]


def _join(letters: list[list]) -> str:
    order = "ًٌٍَُِّْٰ"  # stable mark order so equal words compare equal
    return "".join(ch + "".join(sorted(m, key=order.find)) for ch, m in letters)


def _consonants(word: str, ref: ReferenceData) -> dict[int, str]:
    """char_index -> letter id for every consonant unit of a one-word text."""
    return {u.char_index: u.letter for u in to_units(word, ref.taxonomy) if u.kind == "consonant"}


def _inject(rng: random.Random, word: str, kinds: list[str], ref: ReferenceData) -> tuple[str, list[dict]] | None:
    letters = _letters(word)
    consonants = _consonants(word, ref)
    used: set[int] = set()
    injected: list[dict] = []
    omit: int | None = None
    for kind in kinds:
        if kind in {"dot_confusion", "emphatic_confusion"}:
            table = DOT_SWAP if kind == "dot_confusion" else EMPHATIC_SWAP
            choices = [i for i in consonants if i not in used and letters[i][0] in table]
            if not choices:
                return None
            i = rng.choice(choices)
            injected.append({"category": kind, "char_index": i, "from": letters[i][0], "to": table[letters[i][0]]})
            letters[i][0] = table[letters[i][0]]
        elif kind == "short_vowel":
            choices = [i for i in consonants if i not in used and letters[i][1] & set(VOWEL_SWAP)]
            if not choices:
                return None
            i = rng.choice(choices)
            mark = next(m for m in letters[i][1] if m in VOWEL_SWAP)
            injected.append({"category": kind, "char_index": i, "from": mark, "to": VOWEL_SWAP[mark]})
            letters[i][1] = (letters[i][1] - {mark}) | {VOWEL_SWAP[mark]}
        else:  # omission of a medial consonant
            choices = [i for i in consonants if i not in used and 0 < i < len(letters) - 1
                       and letters[i][0] not in NOT_OMITTED]
            if not choices:
                return None
            omit = rng.choice(choices)
            injected.append({"category": "omission", "char_index": omit, "from": letters[omit][0], "to": None})
            i = omit
        used.add(i)
    if omit is not None:
        letters = [x for k, x in enumerate(letters) if k != omit]
    return _join(letters), injected


def build_set(item_bank: dict, ref: ReferenceData | None = None, n_words: int = 40) -> dict:
    ref = ref or reference_data()
    rng = random.Random(SEED)
    words = [i for i in item_bank["items"] if i["type"] == "real_word" and " " not in i["text"]]
    words = [w for w in words if len(_consonants(w["text"], ref)) >= 3]
    words.sort(key=lambda w: w["id"])
    rng.shuffle(words)
    plans = {"none": [[]], "mild": [["dot_confusion"], ["emphatic_confusion"], ["short_vowel"]],
             "moderate": [["dot_confusion", "short_vowel"], ["dot_confusion", "emphatic_confusion"]],
             "severe": [["dot_confusion", "emphatic_confusion", "omission"],
                        ["dot_confusion", "short_vowel", "omission"]]}
    cases: list[dict] = []
    for w in words[:n_words]:
        for severity, options in plans.items():
            for kinds in rng.sample(options, len(options)):
                made = _inject(rng, w["text"], kinds, ref) if kinds else (w["text"], [])
                if made is None:
                    continue  # this word cannot carry these errors: try the next plan, never force it
                spoken, injected = made
                for lexicon in ("msa", "kw"):
                    cases.append(_case(w, spoken, lexicon, severity, injected, cell=None))
                break
    for w in words:  # dialect cells on every word with the letter
        for cell, letter, repl, lexicon, status, rule in DIALECT_CELLS:
            letters = _letters(w["text"])
            idx = [i for i, (ch, _) in enumerate(letters) if ch == letter and i in _consonants(w["text"], ref)]
            if not idx:
                continue
            letters[idx[0]][0] = repl
            inj = [{"category": "dialect", "char_index": idx[0], "from": letter, "to": repl, "expect_status": status,
                    "expect_rule": rule}]
            cases.append(_case(w, _join(letters), lexicon, "dialect", inj, cell=cell))
    for k, c in enumerate(cases):
        c["case_id"] = f"syn-{k:04d}"
    return {"version": SET_VERSION, "seed": SEED, "synthetic": True, "item_bank_version": item_bank["version"],
            "untested": UNTESTED, "cases": cases}


def _case(w, spoken, lexicon, severity, injected, cell):
    return {"item_id": w["id"], "expected_text": w["text"], "spoken_text": spoken, "lexicon": lexicon,
            "severity": severity, "dialect_cell": cell, "injected": injected, "synthetic": True}


# ---------------------------------------------------------------- evaluation


def evaluate_case(case: dict, response: dict, ref: ReferenceData | None = None) -> dict:
    """Outcome of one case: per injected error (found? right category?) and false alarms elsewhere."""
    ref = ref or reference_data()
    units = to_units(case["expected_text"], ref.taxonomy)
    by_index = {p["index"]: p for p in response["phonemes"]}
    targets: set[int] = set()
    outcomes = []
    for inj in case["injected"]:
        kind = "vowel" if inj["category"] == "short_vowel" else "consonant"
        unit = next((u for u in units if u.char_index == inj["char_index"] and u.kind == kind
                     and (kind == "consonant" or units.index(u) > 0)), None)
        if unit is None:
            outcomes.append({**inj, "status": None, "error_category": None, "found": False, "category_ok": False})
            continue
        targets.add(unit.index)
        p = by_index.get(unit.index, {})
        status, category = p.get("status"), p.get("error_category")
        if inj["category"] == "dialect":
            found = status == inj["expect_status"]
            ok = found and (inj["expect_rule"] is None or p.get("dialect_rule_id") == inj["expect_rule"])
        else:
            found = status == "error"
            ok = found and category == inj["category"]
        outcomes.append({**inj, "status": status, "error_category": category, "found": found, "category_ok": ok})
    scored = [p for p in response["phonemes"] if p["status"] != "unscored"]
    false_alarms = [p for p in scored if p["index"] not in targets and p["status"] == "error"]
    return {"case_id": case["case_id"], "severity": case["severity"], "lexicon": case["lexicon"],
            "dialect_cell": case["dialect_cell"], "injected": outcomes,
            "flagged": any(p["status"] == "error" for p in scored),
            "scored_units": len(scored), "non_target_units": len([p for p in scored if p["index"] not in targets]),
            "false_alarms": [{"letter": p["expected_letter"], "heard": p["heard_ipa"]} for p in false_alarms],
            "synthetic": True}


def _rate(num: int, den: int) -> dict:
    return {"n": den, "hits": num, "rate": round(num / den, 3) if den else None}


def summarize(results: list[dict]) -> dict:
    by_cat: dict[str, list[dict]] = defaultdict(list)
    for r in results:
        for o in r["injected"]:
            if o["category"] != "dialect":
                by_cat[o["category"]].append(o)
    categories = {c: {"found": _rate(sum(o["found"] for o in os_), len(os_)),
                      "right_category": _rate(sum(o["category_ok"] for o in os_), len(os_))}
                  for c, os_ in sorted(by_cat.items())}
    severity = {s: _rate(sum(r["flagged"] for r in rs), len(rs))
                for s in SEVERITY_ERRORS for rs in [[r for r in results if r["severity"] == s]] if rs}
    dialect = {}
    for cell, *_ in DIALECT_CELLS:
        rs = [r for r in results if r["dialect_cell"] == cell]
        dialect[cell] = _rate(sum(r["injected"][0]["category_ok"] for r in rs), len(rs))
    clean = [r for r in results if r["severity"] == "none"]
    fa_units = sum(len(r["false_alarms"]) for r in results if r["severity"] != "dialect")
    all_units = sum(r["non_target_units"] for r in results if r["severity"] != "dialect")
    fa_letters = Counter(f["letter"] for r in results for f in r["false_alarms"])
    return {"synthetic": True, "cases": len(results), "categories": categories, "case_flagged_by_severity": severity,
            "clean_cases_with_any_flag": _rate(sum(r["flagged"] for r in clean), len(clean)),
            "false_alarm_per_unit": _rate(fa_units, all_units), "false_alarm_letters": dict(fa_letters.most_common(10)),
            "dialect": dialect}


def summarize_clips(results: list[dict]) -> dict:
    """Maryam item-bank clips scored against their own text: every flag is a false alarm (the voice read the text)."""
    fa = Counter(f["letter"] for r in results for f in r["false_alarms"])
    units = sum(r["non_target_units"] for r in results)
    return {"synthetic": True, "clips": len(results),
            "clips_all_correct": _rate(sum(not r["flagged"] for r in results), len(results)),
            "false_alarm_per_unit": _rate(sum(fa.values()), units), "false_alarm_letters": dict(fa.most_common(10))}


def report_markdown(summary: dict, clips: dict | None, meta: dict) -> str:
    def pct(r):
        return "n/a" if r["rate"] is None else f"{r['rate'] * 100:.0f}% ({r['hits']}/{r['n']})"

    lines = [
        "# A7 synthetic evaluation (SYNTHETIC: TTS audio, adult synthetic voice, no child speech)",
        "",
        f"Set {meta.get('set_version')} (seed {meta.get('seed')}), scorer {meta.get('model_version')}, run "
        f"{meta.get('run_at')} on {meta.get('runtime')}. TTS for injected cases: {meta.get('tts')}. "
        "Errors were written into the text the TTS voice read; a voice may 'autocorrect' a nonword back to a real "
        "word, which shows up here as a miss.",
        "",
        "## Injected errors",
        "",
        "| Error | Found (status error) | Right category |",
        "| --- | --- | --- |",
    ]
    for c, v in summary["categories"].items():
        lines.append(f"| {c} | {pct(v['found'])} | {pct(v['right_category'])} |")
    lines += ["", "Expected by design: `short_vowel` is never flagged (vowels are unscored from audio) and "
              "`omission` is not detected yet (verdict.py). Both are listed so the limit is measured, not hidden.", "",
              "## Whole cases by severity (any error flagged)", "", "| Severity | Flagged |", "| --- | --- |"]
    for s, v in summary["case_flagged_by_severity"].items():
        lines.append(f"| {s} | {pct(v)} |")
    lines += ["", f"False alarms: {pct(summary['false_alarm_per_unit'])} of non-target consonants flagged; clean cases "
              f"with any flag {pct(summary['clean_cases_with_any_flag'])}. Most often: "
              f"{summary['false_alarm_letters'] or 'none'}.", "", "## Dialect", "",
              "| Cell | Expected | Got it |", "| --- | --- | --- |"]
    expect = {c[0]: f"{c[4]}{' (' + c[5] + ')' if c[5] else ''}" for c in DIALECT_CELLS}
    for cell, v in summary["dialect"].items():
        lines.append(f"| {cell} | {expect[cell]} | {pct(v)} |")
    lines += ["", "Not tested: " + "; ".join(UNTESTED) + "."]
    if clips:
        lines += ["", "## Item-bank clips (Azure Maryam TTS) scored against their own text", "",
                  f"Clips with no flag: {pct(clips['clips_all_correct'])}; false alarms "
                  f"{pct(clips['false_alarm_per_unit'])} of consonants. "
                  f"Most often: {clips['false_alarm_letters'] or 'none'}."]
    lines += ["", "Every number is synthetic and n is small; none of it is evidence about children (CLAUDE.md "
              "non-negotiable 6).", ""]
    return "\n".join(lines)


def write_set(path: Path, item_bank_path: Path) -> dict:
    data = build_set(json.loads(item_bank_path.read_text(encoding="utf-8")))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    return data
