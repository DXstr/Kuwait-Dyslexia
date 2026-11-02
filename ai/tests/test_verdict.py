"""Item verdicts (A4 + A5) from synthetic evidence; every response must satisfy the shared contract."""

import json
from pathlib import Path

import numpy as np
import pytest
from _synthetic import LETTER_VOCAB, PHONE_VOCAB, REF, frames, phones_for
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from basira_ai.contracts_gen import ScoreItemRequestMeta
from basira_ai.g2p import to_units
from basira_ai.pronunciation import score_pronunciation
from basira_ai.verdict import audio_warnings, build_response

SCHEMA = json.loads((Path(__file__).resolve().parents[2] / "contracts/schemas/basira.schema.json").read_text("utf-8"))
VALIDATOR = Draft202012Validator(
    {"$ref": f"{SCHEMA['$id']}#/$defs/ScoreItemResponse"},
    registry=Registry().with_resource(SCHEMA["$id"], Resource.from_contents(SCHEMA)),
)


def verdict(text, heard, letters=None, lexicon="kw", item_type="real_word", duration_ms=1200):
    meta = ScoreItemRequestMeta.model_validate(
        {"item_id": "t-1", "item_type": item_type, "expected_text": text, "dialect_lexicon_id": lexicon}
    )
    units = to_units(text, REF.taxonomy)
    ev = score_pronunciation(
        text, units, frames(heard, PHONE_VOCAB), frames(letters, LETTER_VOCAB) if letters else None, REF
    )
    resp = build_response(meta, units, ev, REF, audio_duration_ms=duration_ms, synthetic=True)
    payload = resp.model_dump(mode="json", by_alias=True)
    errors = [e.message for e in VALIDATOR.iter_errors(payload)]
    assert not errors, errors
    return payload


def consonant(payload, letter):
    return next(p for p in payload["phonemes"] if p["expected_letter"] == letter)


def evidence(payload, skill):
    return [e["correct"] for e in payload["skill_evidence"] if e["skill_id"] == skill]


def test_correct_reading():
    p = verdict("قَلَم", phones_for("قَلَم"))
    assert all(ph["status"] in ("correct", "unscored") for ph in p["phonemes"])
    assert p["words"] == [{"index": 0, "text": "قَلَم", "correct": True}]
    assert evidence(p, "ls.qaaf") == [True] and evidence(p, "decode.real") == [True]


def test_kuwaiti_g_is_a_dialect_variant_not_an_error():
    p = verdict("قَلَم", ["ɡ", "a", "l", "a", "m"], lexicon="kw")
    q = consonant(p, "qaaf")
    assert q["status"] == "dialect_variant" and q["dialect_rule_id"] == "kw.qaaf-g" and q["error_category"] is None
    assert p["words"][0]["correct"] is True
    assert evidence(p, "ls.qaaf") == [True]  # a dialect pronunciation never counts against the child


def test_same_g_under_msa_lexicon_is_an_error():
    p = verdict("قَلَم", ["ɡ", "a", "l", "a", "m"], lexicon="msa")
    q = consonant(p, "qaaf")
    assert q["status"] == "error" and q["error_category"] == "substitution" and q["heard_ipa"] == "g"


def test_cairene_glottal_stop_is_not_accepted_as_kuwaiti():
    p = verdict("قَلَم", ["ʔ", "a", "l", "a", "m"], lexicon="kw")
    q = consonant(p, "qaaf")
    assert q["status"] == "error" and q["heard_ipa"] == "ʔ"


def test_kuwaiti_jiim_as_y():
    p = verdict("دَجَاج", ["d", "a", "j", "aː", "j"], lexicon="kw")
    jiims = [ph for ph in p["phonemes"] if ph["expected_letter"] == "jiim"]
    assert [j["dialect_rule_id"] for j in jiims] == ["kw.jiim-j", "kw.jiim-j"]


def test_dot_confusion_category_and_skill_evidence():
    p = verdict("ثَوْب", ["t", "a", "w", "b"])
    th = consonant(p, "thaa")
    assert th["status"] == "error" and th["error_category"] == "dot_confusion" and th["heard_ipa"] == "t"
    assert evidence(p, "dot.baa-taa-thaa-nuun-yaa") == [False, True]  # ث failed, ب (same group) succeeded
    assert evidence(p, "ls.thaa") == [False] and p["words"][0]["correct"] is False


def test_emphatic_confusion_via_letter_model():
    p = verdict("صَبَاح", ["s", "a", "b", "aː", "ħ"], letters=["س", "ب", "ا", "ح"])
    sad = consonant(p, "saad")
    assert sad["status"] == "error" and sad["error_category"] == "emphatic_confusion"
    assert evidence(p, "emph.saad-siin") == [False]


def test_degraded_emphatic_gives_no_emphatic_evidence():
    p = verdict("صَبَاح", ["s", "a", "b", "aː", "ħ"])  # no letter model
    assert consonant(p, "saad")["status"] == "correct"
    assert evidence(p, "emph.saad-siin") == []  # never claim a contrast that was not measured


def test_vowels_are_always_unscored():
    p = verdict("قَلَم", ["q", "i", "l", "a", "m"])
    vowels = [ph for ph in p["phonemes"] if ph["expected_letter"] is None]
    assert vowels and all(v["status"] == "unscored" and v["heard_ipa"] is None for v in vowels)


def test_pseudoword_evidence_and_positions():
    p = verdict("ثَمِيك", phones_for("ثَمِيك"), item_type="pseudoword")
    assert evidence(p, "decode.pseudo") == [True]
    assert evidence(p, "pos.initial") == [True] and evidence(p, "pos.final") == [True]


def test_passage_gets_wcpm():
    text = "قَلَم ثَوْب"
    p = verdict(text, phones_for(text), item_type="passage_vowelized", duration_ms=6000)
    assert p["wcpm"] == 20.0  # 2 correct words in 0.1 minute


def test_unknown_lexicon_is_rejected():
    with pytest.raises(KeyError):
        verdict("قَلَم", phones_for("قَلَم"), lexicon="xx")


@pytest.mark.parametrize(
    "wav, expected",
    [
        (np.zeros(1600, dtype=np.float32), {"too_short", "low_audio_level"}),
        (np.full(16000, 0.2, dtype=np.float32), set()),
        (np.ones(16000, dtype=np.float32), {"clipped_audio"}),
        (np.full(16000 * 16, 0.2, dtype=np.float32), {"too_long"}),
    ],
)
def test_audio_warnings(wav, expected):
    assert set(audio_warnings(wav)) == expected
