"""A7 synthetic evaluation: the set is reproducible and the evaluation counts exactly what was injected."""

import json
from pathlib import Path

import pytest

from basira_ai.eval_synthetic import (
    SEVERITY_ERRORS,
    build_set,
    evaluate_case,
    report_markdown,
    summarize,
    summarize_clips,
)
from basira_ai.g2p import to_units
from basira_ai.reference import reference_data

ROOT = Path(__file__).resolve().parents[2]
BANK = json.loads((ROOT / "content/dist/item-bank.json").read_text("utf-8"))
SHIPPED = ROOT / "ai/eval/synthetic-set.json"
REF = reference_data()
SET = build_set(BANK, REF)


def test_shipped_set_is_reproducible():
    assert json.loads(SHIPPED.read_text("utf-8")) == SET, "rebuild: see ai/eval/README.md"


def test_every_case_is_synthetic_and_severities_match_error_counts():
    assert SET["synthetic"] is True and SET["untested"]
    for c in SET["cases"]:
        assert c["synthetic"] is True
        if c["severity"] in SEVERITY_ERRORS:
            assert len(c["injected"]) == SEVERITY_ERRORS[c["severity"]]
            assert (c["spoken_text"] == c["expected_text"]) == (c["severity"] == "none")
    assert {c["severity"] for c in SET["cases"]} == {*SEVERITY_ERRORS, "dialect"}
    assert {c["dialect_cell"] for c in SET["cases"]} >= {"kw_jiim_j", "msa_jiim_j", "kw_qaaf_glottal"}


def test_spoken_text_differs_exactly_at_the_injected_letters():
    for c in SET["cases"]:
        for inj in c["injected"]:
            if inj["category"] in {"dot_confusion", "emphatic_confusion", "dialect"}:
                assert inj["to"] in c["spoken_text"] and inj["from"] != inj["to"]


def fake_response(case, detect=True, false_alarm_letter=None):
    """A scorer that finds every injected consonant error (or none), honouring the dialect expectations."""
    units = to_units(case["expected_text"], REF.taxonomy)
    phonemes = []
    for u in units:
        p = {"index": u.index, "expected_letter": u.letter, "heard_ipa": u.ipa, "status": "correct",
             "error_category": None, "dialect_rule_id": None}
        if u.kind == "vowel":
            p["status"] = "unscored"
        for inj in case["injected"]:
            if detect and u.kind == "consonant" and u.char_index == inj["char_index"]:
                if inj["category"] == "dialect":
                    p["status"], p["dialect_rule_id"] = inj["expect_status"], inj["expect_rule"]
                    p["error_category"] = "substitution" if inj["expect_status"] == "error" else None
                elif inj["category"] in {"dot_confusion", "emphatic_confusion"}:
                    p["status"], p["error_category"] = "error", inj["category"]
        if false_alarm_letter and u.letter == false_alarm_letter and p["status"] == "correct":
            p["status"], p["error_category"] = "error", "substitution"
        phonemes.append(p)
    return {"phonemes": phonemes}


def test_perfect_scorer_scores_perfectly_except_what_audio_cannot_show():
    results = [evaluate_case(c, fake_response(c), REF) for c in SET["cases"]]
    s = summarize(results)
    assert s["categories"]["dot_confusion"]["right_category"]["rate"] == 1.0
    assert s["categories"]["emphatic_confusion"]["right_category"]["rate"] == 1.0
    assert s["categories"]["short_vowel"]["found"]["rate"] == 0.0  # vowels are unscored by design
    assert s["false_alarm_per_unit"]["hits"] == 0 and s["clean_cases_with_any_flag"]["hits"] == 0
    assert all(v["rate"] == 1.0 for v in s["dialect"].values())
    assert s["case_flagged_by_severity"]["none"]["rate"] == 0.0


def test_deaf_scorer_finds_nothing_and_false_alarms_are_counted():
    results = [evaluate_case(c, fake_response(c, detect=False), REF) for c in SET["cases"]]
    s = summarize(results)
    assert s["categories"]["dot_confusion"]["found"]["rate"] == 0.0
    assert s["dialect"]["kw_jiim_j"]["rate"] == 0.0
    noisy = [evaluate_case(c, fake_response(c, false_alarm_letter="laam"), REF) for c in SET["cases"]]
    s2 = summarize(noisy)
    assert s2["false_alarm_per_unit"]["hits"] > 0 and "laam" in s2["false_alarm_letters"]


def test_report_says_synthetic_and_lists_untested_cells():
    results = [evaluate_case(c, fake_response(c), REF) for c in SET["cases"]]
    clips = summarize_clips(results[:5])
    md = report_markdown(summarize(results), clips, {"set_version": SET["version"], "seed": SET["seed"]})
    assert md.startswith("# A7 synthetic evaluation (SYNTHETIC")
    assert "kw.qaaf-g" in md and "none of it is evidence about children" in md


@pytest.mark.parametrize("severity", ["mild", "moderate", "severe"])
def test_each_severity_has_cases_for_both_lexicons(severity):
    lex = {c["lexicon"] for c in SET["cases"] if c["severity"] == severity}
    assert lex == {"msa", "kw"}
