"""Basira-authored Stage 0 tasks: generator validators, the two shipped copies, and keyed raw scoring."""

import json
import re
from datetime import UTC, datetime
from pathlib import Path

import pytest
from test_fingerprint import (
    client,  # noqa: F401 - shared service fixture
    valid,
)
from test_service import token

from basira_ai.content.stage0_tasks import (
    ALLOWED_COLOURS,
    GLYPHS,
    Rejected,
    _check_glyphs,
    build_tasks,
    check_svg,
    package_dir,
)
from basira_ai.stage0 import Stage0Error, answer_key, instruments, score, task_set

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "content" / "dist" / "stage0"
TASKS, REPORT = build_tasks(datetime(2026, 11, 3, tzinfo=UTC))
IDS = [t["instrument_id"] for t in TASKS]


def items(task):
    return [i for b in task["blocks"] for i in b["items"]]


@pytest.mark.parametrize("task", TASKS, ids=IDS)
def test_task_sets_match_the_contract(task):
    assert valid("Stage0TaskSet", task) == []


@pytest.mark.parametrize("instrument_id", IDS)
def test_shipped_copies_are_current_and_identical(instrument_id):
    """content/dist (web) and basira_ai/data (scorer) hold the same file the generator makes today."""
    built = next(t for t in TASKS if t["instrument_id"] == instrument_id)
    web = json.loads((DIST / f"{instrument_id}.json").read_text("utf-8"))
    scorer = json.loads((package_dir() / f"{instrument_id}.json").read_text("utf-8"))
    assert web == scorer, "run: python -m basira_ai.content stage0 --generated-at <stamp of the shipped files>"
    assert {**built, "generated_at": web["generated_at"]} == web, "generator output changed: rebuild the task sets"


def test_every_task_is_registered_as_basira_authored_without_norms():
    reg = instruments()
    for t in TASKS:
        inst = reg[t["instrument_id"]]
        assert inst["construct"] == t["construct"] and inst["scoring"] == "keyed_proportion_correct"
        assert inst["norm_source"] is None and "NOT STANDARDIZED" in inst["note_en"]
        assert t["review"]["status"] == "unreviewed"  # until the specialist signs off


@pytest.mark.parametrize("task", TASKS, ids=IDS)
def test_items_are_well_formed(task):
    ids = [i["item_id"] for i in items(task)]
    assert len(ids) == len(set(ids))
    for block in task["blocks"]:
        assert block["items"][0]["practice"] and not any(i["practice"] for i in block["items"][1:])
        assert re.search("[ً-ْ]", block["instructions_ar"]), "instructions must be vowelled Arabic"
    for item in items(task):
        for markup in [item["stimulus_svg"], *(o["svg"] for o in item["options"] or [])]:
            if markup:
                check_svg(markup)
        if item["response_type"] == "option_id":
            option_ids = [o["option_id"] for o in item["options"]]
            assert len(option_ids) == len(set(option_ids)) and item["answer"] in option_ids
        elif item["response_type"] == "number":
            assert item["options"] is None and 1 <= item["answer"] <= 9
        else:
            assert item["answer"] is None


def test_no_red_anywhere():
    colours = set(re.findall(r'(?:fill|stroke)=\\?"([^"\\]+)', json.dumps(TASKS)))
    assert colours and colours <= ALLOWED_COLOURS
    for c in colours - {"none"}:
        r, g, b = (int(c[i:i + 2], 16) for i in (1, 3, 5))
        assert not (r > 150 and g < 100 and b < 100), f"{c} is red"


def test_pattern_items_have_six_distinct_options_and_cover_every_rule():
    pattern = TASKS[0]
    for item in items(pattern):
        svgs = [o["svg"] for o in item["options"]]
        assert len(svgs) == 6 and len(set(svgs)) == 6
    rules = {i["rule"] for i in pattern["blocks"][0]["items"]}
    assert rules == {"colour_cycle", "shape_cycle", "size_grow", "count_grow", "rotate"}


def test_orientation_blocks_are_balanced_and_glyphs_have_no_mirror_axis():
    _check_glyphs()
    for block in TASKS[1]["blocks"]:
        answers = [i["answer"] for i in block["items"] if not i["practice"]]
        assert len(set(answers)) == 2 and answers.count(answers[0]) * 2 == len(answers)


def test_symmetric_glyph_is_rejected(monkeypatch):
    plus = [(40, 10), (60, 10), (60, 40), (90, 40), (90, 60), (60, 60), (60, 90), (40, 90), (40, 60), (10, 60),
            (10, 40), (40, 40)]
    monkeypatch.setitem(GLYPHS, "plus", plus)
    with pytest.raises(Rejected, match="plus"):
        _check_glyphs()


def test_number_sense_items_are_correct():
    blocks = {b["block_id"]: b for b in TASKS[2]["blocks"]}
    assert not blocks["reaction"]["scored"]
    for item in blocks["dots"]["items"]:
        assert item["stimulus_svg"].count("<circle") == item["answer"]
    for item in blocks["compare"]["items"]:
        values = [int(o["option_id"][1:]) for o in item["options"]]
        assert item["answer"] == f"n{max(values)}" and values[0] != values[1]
    rules = [i["rule"] for i in blocks["compare"]["items"][1:]]
    assert rules.count("congruent") == rules.count("incongruent")
    for item in blocks["addition"]["items"]:
        a, b = map(int, item["rule"].split("+"))
        assert a + b == item["answer"] <= 9


@pytest.mark.parametrize("markup", [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#DC2626"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="x()"/></svg>',
    "<svg><rect",
])
def test_svg_validator_discards_unsafe_or_red_markup(markup):
    with pytest.raises(Rejected):
        check_svg(markup)


# ---------------------------------------------------------------- keyed scoring


def req(instrument_id, responses):
    return {"construct": instruments()[instrument_id]["construct"], "instrument_id": instrument_id,
            "child_age_months": 96, "grade": 3, "responses": responses}


def all_answers(instrument_id):
    return [{"item_id": i, "response": a, "time_ms": 1500} for i, a in answer_key(instrument_id).items()]


@pytest.mark.parametrize("instrument_id", IDS)
def test_perfect_set_scores_one_and_matches_contract(instrument_id):
    out = score(req(instrument_id, all_answers(instrument_id)))
    assert valid("Stage0ScoreResponse", out) == []
    assert out["raw_score"] == 1.0 and out["scaled_score"] is None and out["synthetic"] is False
    assert out["licence_status"] == "public_domain"


def test_raw_score_is_proportion_of_scored_items_ignoring_practice_and_baseline():
    inst = "number-sense-basira-v0"
    rs = all_answers(inst)
    assert len(rs) == 28  # 10 dots + 10 compare + 8 addition; the reaction baseline is excluded
    for r in rs[:7]:
        r["response"] = "n0" if isinstance(r["response"], str) else 0
    extra = [{"item_id": "rt-01", "response": True, "time_ms": 420}, {"item_id": "dot-p01", "response": 2}]
    assert score(req(inst, rs + extra))["raw_score"] == round(21 / 28, 4)


def test_keypad_answers_accept_arabic_indic_and_string_digits():
    inst = "number-sense-basira-v0"
    rs = all_answers(inst)
    for r in rs:
        if isinstance(r["response"], int):
            r["response"] = "٠١٢٣٤٥٦٧٨٩"[r["response"]] if r["item_id"].startswith("dot") else str(r["response"])
    assert score(req(inst, rs))["raw_score"] == 1.0
    rs[-1]["response"] = True  # a boolean is never a number
    assert score(req(inst, rs))["raw_score"] < 1.0


@pytest.mark.parametrize("mutate, message", [
    (lambda rs: rs[:-1], "not answered"),
    (lambda rs: rs + [rs[0]], "answered twice"),
    (lambda rs: rs + [{"item_id": "seq-99", "response": "o1"}], "not an item"),
])
def test_incomplete_or_malformed_sets_are_refused_not_guessed(mutate, message):
    inst = "nonverbal-pattern-basira-v0"
    with pytest.raises(Stage0Error, match=message):
        score(req(inst, mutate(all_answers(inst))))


def test_service_scores_a_basira_task(client):  # noqa: F811 - pytest fixture
    inst = "orientation-basira-v0"
    auth = {"Authorization": token(role="examiner")}
    r = client.post("/stage0/score", headers=auth, json=req(inst, all_answers(inst)))
    assert r.status_code == 200, r.text
    assert r.json()["raw_score"] == 1.0 and valid("Stage0ScoreResponse", r.json()) == []
    r = client.post("/stage0/score", headers=auth, json=req(inst, all_answers(inst)[:3]))
    assert r.status_code == 422 and "not answered" in r.json()["error"]["message"]


def test_task_set_loader_reads_package_data():
    assert task_set("orientation-basira-v0")["construct"] == "reversal"
