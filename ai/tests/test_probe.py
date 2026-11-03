"""A9 Prove: practised vs unseen accuracy per skill and the transfer verdict."""

import json
from pathlib import Path

import pytest
from test_fingerprint import (
    client,  # noqa: F401 - shared service fixture
    valid,
)
from test_service import token

from basira_ai.probe import MIN_EVIDENCE, probe, transfer_threshold

FIXTURES = Path(__file__).resolve().parents[2] / "contracts/fixtures"
DOT = "dot.baa-taa-thaa-nuun-yaa"
EMPH = "emph.saad-siin"


def item(evidence: list[tuple[str, bool]], n: int = 0, synthetic: bool = True, source: str = "audio") -> dict:
    return {"item_id": f"i-{n}", "item_type": "passage_vowelized", "model_version": "test", "synthetic": synthetic,
            "audio_duration_ms": 1000, "words": [], "phonemes": [], "wcpm": None, "warnings": [],
            "skill_evidence": [{"skill_id": s, "correct": c, "source": source} for s, c in evidence]}


def ev(skill: str, right: int, wrong: int) -> list[tuple[str, bool]]:
    return [(skill, True)] * right + [(skill, False)] * wrong


def request(practised, unseen) -> dict:
    return {"session_id": "p1", "practised": [item(practised)], "unseen": [item(unseen, 1)]}


def run(req: dict) -> dict:
    out = probe(req)
    assert valid("ProbeResponse", out) == [], valid("ProbeResponse", out)
    return out


def row(out: dict, skill: str) -> dict:
    return next(r for r in out["per_skill"] if r["skill_id"] == skill)


def test_threshold_comes_from_the_skill_graph():
    assert transfer_threshold() == 0.85


def test_transfer_shown_when_unseen_reaches_the_probe_band():
    r = row(run(request(ev(DOT, 9, 1), ev(DOT, 9, 1))), DOT)
    assert r == {"skill_id": DOT, "practised_accuracy": 0.9, "unseen_accuracy": 0.9, "n_practised": 10,
                 "n_unseen": 10, "transfer": "transfer_shown"}


def test_no_transfer_when_unseen_lags():
    r = row(run(request(ev(DOT, 10, 0), ev(DOT, 6, 4))), DOT)
    assert r["practised_accuracy"] == 1.0 and r["unseen_accuracy"] == 0.6 and r["transfer"] == "no_transfer_yet"


@pytest.mark.parametrize(("practised", "unseen"), [
    (ev(DOT, 10, 0), ev(DOT, MIN_EVIDENCE - 1, 0)),  # too few unseen observations
    (ev(DOT, MIN_EVIDENCE - 1, 0), ev(DOT, 10, 0)),  # too few practised observations
    (ev(DOT, 10, 0), []),  # never probed: accuracy null, not zero
])
def test_insufficient_data(practised, unseen):
    r = row(run(request(practised, unseen)), DOT)
    assert r["transfer"] == "insufficient_data"
    if not unseen:
        assert r["unseen_accuracy"] is None and r["n_unseen"] == 0


def test_skills_are_reported_side_by_side_and_sorted():
    out = run(request(ev(EMPH, 5, 0) + ev(DOT, 5, 0), ev(DOT, 5, 0)))
    assert [r["skill_id"] for r in out["per_skill"]] == sorted([DOT, EMPH])
    assert row(out, EMPH)["transfer"] == "insufficient_data"


def test_only_audio_evidence_counts():
    req = request(ev(DOT, 10, 0), ev(DOT, 10, 0))
    req["unseen"].append(item(ev(DOT, 0, 10), 2, source="tap"))
    assert row(run(req), DOT)["unseen_accuracy"] == 1.0


def test_synthetic_flag():
    req = request(ev(DOT, 5, 0), ev(DOT, 5, 0))
    assert run(req)["synthetic"] is True
    for i in req["practised"] + req["unseen"]:
        i["synthetic"] = False
    assert run(req)["synthetic"] is False


def test_endpoint_matches_contract(client):  # noqa: F811
    r = client.post("/probe", headers={"Authorization": token()}, json=request(ev(DOT, 9, 1), ev(DOT, 9, 1)))
    assert r.status_code == 200, r.text
    assert valid("ProbeResponse", r.json()) == [] and r.json()["per_skill"][0]["transfer"] == "transfer_shown"


def test_endpoint_accepts_the_contract_fixture(client):  # noqa: F811
    fixture = json.loads((FIXTURES / "ProbeRequest.example.json").read_text("utf-8"))
    r = client.post("/probe", headers={"Authorization": token()}, json=fixture)
    assert r.status_code == 200, r.text
    assert valid("ProbeResponse", r.json()) == []


@pytest.mark.parametrize(("auth", "status"), [(None, 401), (token(role="guardian"), 403)])
def test_endpoint_auth(client, auth, status):  # noqa: F811
    headers = {"Authorization": auth} if auth else {}
    assert client.post("/probe", headers=headers, json=request([], [])).status_code == status
