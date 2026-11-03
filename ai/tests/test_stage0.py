"""A10 Stage 0: every construct, LICENSE PENDING, raw scores without invented norms, examiner-only endpoint."""

import json
from pathlib import Path

import pytest
from test_fingerprint import (
    client,  # noqa: F401 - shared service fixture
    valid,
)
from test_service import token

from basira_ai.stage0 import Stage0Error, answer_key, instruments, score

SCHEMA = json.loads((Path(__file__).resolve().parents[2] / "contracts/schemas/basira.schema.json").read_text("utf-8"))
CONSTRUCTS = SCHEMA["$defs"]["Stage0Construct"]["enum"]
FIXTURE = json.loads(
    (Path(__file__).resolve().parents[2] / "contracts/fixtures/Stage0ScoreRequest.example.json").read_text("utf-8"))


def req(instrument_id: str, responses: list[dict]) -> dict:
    construct = instruments()[instrument_id]["construct"]
    return {"construct": construct, "instrument_id": instrument_id, "child_age_months": 96, "grade": 3,
            "responses": responses}


def run(r: dict) -> dict:
    out = score(r)
    assert valid("Stage0ScoreResponse", out) == [], valid("Stage0ScoreResponse", out)
    return out


def test_every_construct_has_an_instrument():
    assert sorted({i["construct"] for i in instruments().values()}) == sorted(CONSTRUCTS)


@pytest.mark.parametrize("inst", list(instruments().values()), ids=lambda i: i["instrument_id"])
def test_no_instrument_ever_has_a_scaled_score_or_invented_norm(inst):
    if inst["scoring"] == "keyed_proportion_correct":
        responses = [{"item_id": i, "response": a} for i, a in answer_key(inst["instrument_id"]).items()]
    else:
        responses = {"proportion_correct": [{"item_id": "a", "response": True}] * 4,
                     "wcpm": [{"item_id": "p", "response": 50, "time_ms": 60000}],
                     "none": [{"item_id": "x", "response": "LICENSE PENDING placeholder"}]}[inst["scoring"]]
    out = run(req(inst["instrument_id"], responses))
    assert out["scaled_score"] is None and out["norm_source"] is None
    if inst["licence_status"] == "license_pending":
        assert out["raw_score"] is None and out["synthetic"] is True and out["note_en"].startswith("LICENSE PENDING")
    else:
        assert out["raw_score"] is not None and out["synthetic"] is False


def test_contract_fixture_is_license_pending():
    out = run(FIXTURE)
    assert out["licence_status"] == "license_pending" and out["raw_score"] is None


def test_phonological_awareness_proportion_correct():
    rs = [{"item_id": f"pa-{i}", "response": i < 6} for i in range(8)]
    assert run(req("pa-basira-v0", rs))["raw_score"] == 0.75


def test_reading_fluency_wcpm():
    rs = [{"item_id": "p1", "response": 40, "time_ms": 60000}, {"item_id": "p2", "response": 50, "time_ms": 30000}]
    assert run(req("fluency-cbm-basira-v0", rs))["raw_score"] == 60.0  # 90 words in 1.5 minutes


@pytest.mark.parametrize(("instrument_id", "responses", "match"), [
    ("pa-basira-v0", [], "no responses"),
    ("pa-basira-v0", [{"item_id": "a", "response": "yes"}], "boolean"),
    ("fluency-cbm-basira-v0", [{"item_id": "p", "response": 40}], "time_ms"),
    ("fluency-cbm-basira-v0", [{"item_id": "p", "response": True, "time_ms": 1000}], "number"),
])
def test_malformed_responses_are_rejected_not_guessed(instrument_id, responses, match):
    with pytest.raises(Stage0Error, match=match):
        score(req(instrument_id, responses))


def test_unknown_instrument_and_wrong_construct():
    with pytest.raises(Stage0Error, match="unknown instrument"):
        score(dict(FIXTURE, instrument_id="made-up"))
    with pytest.raises(Stage0Error, match="measures itpa"):
        score(dict(FIXTURE, construct="dyscalculia"))


@pytest.mark.parametrize(("role", "status"), [("examiner", 200), ("admin", 200), ("specialist", 403),
                                              ("guardian", 403)])
def test_endpoint_is_examiner_only(client, role, status):  # noqa: F811
    r = client.post("/stage0/score", headers={"Authorization": token(role=role, sub=role)}, json=FIXTURE)
    assert r.status_code == status, r.text
    assert valid("Stage0ScoreResponse" if status == 200 else "Error", r.json()) == []


def test_endpoint_reports_scoring_errors_in_contract_format(client):  # noqa: F811
    r = client.post("/stage0/score", headers={"Authorization": token(role="examiner")},
                    json=dict(FIXTURE, instrument_id="made-up"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"
    assert valid("Error", r.json()) == []
