"""A8 Fingerprint: features, rough-set rules and the specialist-decision boundary, on synthetic sessions."""

import copy
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from test_service import KEY, PerfectReader, token

from basira_ai.fingerprint import RoughSetModel, default_model, fingerprint, session_features
from basira_ai.reference import reference_data
from service.app import create_app
from service.auth import Verifier

REF = reference_data()
MODEL = default_model()
SCHEMA = json.loads((Path(__file__).resolve().parents[2] / "contracts/schemas/basira.schema.json").read_text("utf-8"))
REGISTRY = Registry().with_resource(SCHEMA["$id"], Resource.from_contents(SCHEMA))

OK = ("correct", None, None)
DOT = ("error", "dot_confusion", None)
EMPH = ("error", "emphatic_confusion", None)
SUBST = ("error", "substitution", None)
DIALECT = ("dialect_variant", None, "kw-qaaf-g")


def valid(definition: str, payload: dict) -> list[str]:
    v = Draft202012Validator({"$ref": f"{SCHEMA['$id']}#/$defs/{definition}"}, registry=REGISTRY)
    return [e.message for e in v.iter_errors(payload)]


def item(kind: str, sounds: list[tuple[str, tuple]], n: int = 0, synthetic: bool = True) -> dict:
    """A ScoreItemResponse with one word made of the given (letter, (status, category, rule)) sounds."""
    phonemes = []
    for i, (letter, (status, cat, rule)) in enumerate(sounds):
        phonemes.append({
            "index": i, "word_index": 0, "expected_letter": letter, "expected_ipa": REF.taxonomy.letter(letter).ipa,
            "heard_ipa": None, "score": 0.9 if status != "error" else 0.2, "status": status, "error_category": cat,
            "dialect_rule_id": rule, "start_ms": i * 100, "end_ms": i * 100 + 90,
        })
    correct = all(s[1][0] in ("correct", "dialect_variant") for s in sounds)
    return {"item_id": f"{kind}-{n}", "item_type": kind, "model_version": "test", "synthetic": synthetic,
            "audio_duration_ms": 1000, "words": [{"index": 0, "text": "x", "correct": correct}],
            "phonemes": phonemes, "skill_evidence": [], "wcpm": None, "warnings": []}


def taps(prefix_skill: str, n: int, wrong: int = 0) -> list[dict]:
    return [{"skill_id": prefix_skill, "correct": i >= wrong, "source": "tap"} for i in range(n)]


def session(real=OK, pseudo=OK, emph=OK, other=OK, vowel_taps=True, pos_taps=True, n=6) -> dict:
    items = []
    for i in range(n):
        items.append(item("real_word", [("baa", real), ("taa", OK), ("saad", emph), ("miim", other)], i))
        items.append(item("pseudoword", [("nuun", pseudo), ("daal", pseudo), ("siin", OK), ("laam", OK)], i))
    tap_results = []
    if vowel_taps:
        tap_results += taps("vowel.kasra", 8)
    if pos_taps:
        tap_results += taps("pos.final", 8)
    return {"session_id": "s1", "grade": 3, "duration_ms": 600000, "items": items, "tap_results": tap_results}


def run(req: dict) -> dict:
    out = fingerprint(req, REF)
    assert valid("FingerprintResponse", out) == [], valid("FingerprintResponse", out)
    return out


# ---------------------------------------------------------------- rough-set model


def test_induced_rules_reproduce_every_table_row():
    for values, decision in MODEL.rows:
        got, fired = MODEL.classify(dict(values))
        assert got == decision, values
        assert fired and all(f["rule_id"] != "R-boundary" for f in fired)


def test_rules_are_readable_in_both_languages():
    ids = [MODEL.rule_id(r) for r in MODEL.rules]
    assert len(ids) == len(set(ids))
    for r in MODEL.rules:
        text = MODEL.rule_text(r)
        assert text["text_en"].startswith("IF ") and text["text_ar"].startswith("إذا كان ")
        if r.decision == "refer_for_specialist_assessment":
            assert len(r.conditions) <= 3  # short enough for a specialist to read
        for banned in ("dyslex", "wrong", "عسر", "خطأ"):
            assert banned not in (text["text_en"] + text["text_ar"]).lower()


def test_table_is_editable_data_and_inconsistency_is_rejected():
    table = copy.deepcopy(MODEL.table)
    target = next(r for r in table["rows"] if r["decision"] == "specialist_decision_needed")
    target["decision"] = "refer_for_specialist_assessment"
    edited = RoughSetModel(table)  # a specialist edit re-induces the rules
    assert edited.classify(dict(target["values"]))[0] == "refer_for_specialist_assessment"
    assert edited.version != MODEL.version
    table["rows"].append({"values": dict(target["values"]), "decision": "no_referral_indicated"})
    with pytest.raises(ValueError, match="inconsistent"):
        RoughSetModel(table)


# ---------------------------------------------------------------- features


def test_features_count_opportunities_and_dialect_is_never_an_error():
    f = session_features(session(real=DOT)["items"], [], REF)
    # dot-group sounds per item pair: baa, taa, saad (real) + nuun, daal, siin (pseudo); 1 of 6 is a confusion
    assert f["dot_confusion_rate"] == round(1 / 6, 4)
    dialect = session(other=DIALECT)
    assert session_features(dialect["items"], dialect["tap_results"], REF)["substitution_rate"] == 0.0


def test_too_little_evidence_is_null_not_zero():
    req = session(n=1, vowel_taps=False, pos_taps=False)
    f = session_features(req["items"], req["tap_results"], REF)
    assert f["short_vowel_error_rate"] is None and f["positional_error_rate"] is None
    assert f["pseudoword_gap"] is None  # fewer than 3 items of each kind
    assert f["omission_rate"] is None and f["insertion_rate"] is None and f["self_correction_rate"] is None


def test_short_vowels_come_from_taps_only():
    req = session()
    req["tap_results"] = taps("vowel.damma", 8, wrong=4) + taps("pos.final", 8)
    assert run(req)["features"]["short_vowel_error_rate"] == 0.5


# ---------------------------------------------------------------- decisions on synthetic sessions


def test_clean_session_no_referral():
    out = run(session())
    assert out["referral"]["decision"] == "no_referral_indicated"
    assert out["review_status"] == "pending_review" and out["synthetic"] is True


def test_dot_confusion_with_decoding_gap_suggests_assessment():
    out = run(session(real=DOT, pseudo=SUBST))
    f = out["features"]
    assert f["pseudoword_gap"] is not None
    # real words have dot errors too, so make the gap explicit: real words clean, pseudowords wrong
    out = run(session(pseudo=DOT))
    assert out["features"]["pseudoword_gap"] == 1.0 and out["features"]["dot_confusion_rate"] == round(2 / 6, 4)
    assert out["referral"]["decision"] == "refer_for_specialist_assessment"
    assert "R-refer-D+G" in [r["rule_id"] for r in out["referral"]["rules_fired"]]


def test_one_isolated_concern_is_for_the_specialist():
    out = run(session(emph=EMPH))
    assert out["referral"]["decision"] == "specialist_decision_needed"
    assert out["referral"]["rules_fired"][0]["rule_id"].startswith("R-specialist-")


def test_missing_taps_put_a_clean_session_in_the_boundary_region():
    out = run(session(vowel_taps=False, pos_taps=False))
    assert out["referral"]["decision"] == "specialist_decision_needed"
    fired = out["referral"]["rules_fired"]
    assert fired[0]["rule_id"] == "R-boundary" and "short-vowel" in fired[0]["text_en"]


def test_missing_taps_do_not_hide_a_clear_pattern():
    out = run(session(pseudo=DOT, vowel_taps=False, pos_taps=False))  # every completion of V and P refers
    assert out["referral"]["decision"] == "refer_for_specialist_assessment"
    assert "R-refer-D+G" in [r["rule_id"] for r in out["referral"]["rules_fired"]]


def test_real_audio_is_not_marked_synthetic():
    req = session()
    for i in req["items"]:
        i["synthetic"] = False
    assert run(req)["synthetic"] is False


# ---------------------------------------------------------------- service


@pytest.fixture
def client():
    app = create_app(listener_factory=PerfectReader, verifier=Verifier(lambda _t: (KEY.public_key(), ["ES256"])),
                     allowed_origins=["http://localhost:5173"], rate_limit_per_min=50)
    with TestClient(app) as c:
        for _ in range(100):
            if c.get("/health").json()["status"] == "ok":
                break
            time.sleep(0.01)
        yield c


def test_endpoint_matches_contract(client):
    r = client.post("/fingerprint", headers={"Authorization": token()}, json=session(pseudo=DOT))
    assert r.status_code == 200, r.text
    assert valid("FingerprintResponse", r.json()) == []
    assert r.json()["referral"]["decision"] == "refer_for_specialist_assessment"


def test_endpoint_accepts_the_contract_fixture(client):
    fixture = json.loads((Path(__file__).resolve().parents[2] / "contracts/fixtures/FingerprintRequest.example.json")
                         .read_text("utf-8"))
    r = client.post("/fingerprint", headers={"Authorization": token()}, json=fixture)
    assert r.status_code == 200, r.text
    assert valid("FingerprintResponse", r.json()) == []


@pytest.mark.parametrize(("auth", "body", "status"), [
    (None, session(), 401),
    (token(role="guardian"), session(), 403),
    (token(), {"session_id": "x"}, 422),
])
def test_endpoint_errors(client, auth, body, status):
    headers = {"Authorization": auth} if auth else {}
    r = client.post("/fingerprint", headers=headers, json=body)
    assert r.status_code == status
    assert valid("Error", r.json()) == []
