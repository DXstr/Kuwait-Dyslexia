"""A14 Teach voice prompts: validators, shipped bank, audio rendering (ADR-003)."""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from test_content import FakeTTS

from basira_ai.content.build import check_schema
from basira_ai.content.prompts import Prompt, build_prompts, validate
from basira_ai.reference import reference_data

ROOT = Path(__file__).resolve().parents[2]
SHIPPED = ROOT / "content" / "dist" / "prompt-bank.json"
WHEN = datetime(2026, 11, 3, tzinfo=UTC)
REF = reference_data()
TRIGGERS = json.loads((ROOT / "contracts/schemas/basira.schema.json").read_text("utf-8"))["$defs"]["PromptTrigger"]


def test_shipped_bank_is_current_and_valid(tmp_path):
    bank, report = build_prompts(tmp_path, generated_at=WHEN)
    shipped = json.loads(SHIPPED.read_text("utf-8"))
    assert shipped == bank, "rebuild: python -m basira_ai.content prompts --generated-at 2026-11-03T00:00:00Z"
    check_schema(shipped, "PromptBank")
    assert shipped["synthetic_audio"] is True


def test_every_trigger_has_three_variants_all_unreviewed():
    shipped = json.loads(SHIPPED.read_text("utf-8"))
    for trigger in TRIGGERS["enum"]:
        assert sum(p["trigger"] == trigger for p in shipped["prompts"]) == 3, trigger
    assert all(p["review"] == {"status": "unreviewed", "reviewer": None} for p in shipped["prompts"])
    assert len({p["id"] for p in shipped["prompts"]}) == len(shipped["prompts"])


def test_source_controls_are_discarded_not_repaired(tmp_path):
    _, report = build_prompts(tmp_path, generated_at=WHEN)
    raw = json.loads((ROOT / "content/source/prompts.json").read_text("utf-8"))["prompts"]
    controls = {p["text"] for p in raw if p.get("expect_rejected")}
    assert controls and {r["text"] for r in report["rejected"]} == controls


@pytest.mark.parametrize("text, reason", [
    ("أَخْطَأْنَا قَلِيلًا.", "no_negative_words"),           # "we made a small mistake"
    ("هٰذَا خَطَأٌ.", "no_negative_words"),                   # contains "mistake"
    ("الْقِرَاءَةُ غَلَطٌ.", "no_negative_words"),             # "wrong"
    ("لَا تَفْشَلْ.", "no_negative_words"),                    # "failure" root
    ("أَحْسَنْتَ!", "gender_neutral"),                         # well done (m)
    ("أَحْسَنْتِ!", "gender_neutral"),                         # well done (f)
    ("قَرَأْتَ جَيِّدًا.", "gender_neutral"),                  # you (m) read well
    ("هَيَّا نَقْرَأُ كِتَابَكِ.", "gender_neutral"),            # your (f) book
    ("هيا نقرأ", "diacritized"),
    ("let us read", "script"),
    (" ".join(["نَقْرَأُ"] * 13), "length"),
])
def test_validators_reject(text, reason):
    assert (validate(Prompt("item_retry", text), REF) or "").startswith(reason)


@pytest.mark.parametrize("text", ["لِنَنْظُرْ إِلَى الْحَرَكَاتِ.", "هَيَّا نُحَاوِلُ مَرَّةً أُخْرَى.",
                                  "نَنْطِقُهُ بِصَوْتٍ ثَقِيلٍ."])
def test_validators_accept_neutral_prompts(text):
    assert validate(Prompt("item_retry", text), REF) is None


def test_missing_trigger_fails_the_build(tmp_path):
    src = tmp_path / "prompts.json"
    src.write_text(json.dumps({"prompts": [{"trigger": "item_retry", "text": "هَيَّا نُحَاوِلُ مَرَّةً أُخْرَى."}]},
                              ensure_ascii=False), encoding="utf-8")
    with pytest.raises(ValueError, match="every trigger"):
        build_prompts(tmp_path / "out", source=src, generated_at=WHEN)


def test_audio_rendered_once_then_cached(tmp_path):
    tts = FakeTTS()
    bank, report = build_prompts(tmp_path, engine=tts, generated_at=WHEN)
    assert report["audio"]["rendered"] == 27 and len(tts.calls) == 27
    for p in bank["prompts"]:
        assert p["audio_path"] == f"prompt-audio/{p['id']}.mp3"
        assert (tmp_path / p["audio_path"]).read_bytes() == p["text"].encode("utf-8")
    check_schema(bank, "PromptBank")
    _, again = build_prompts(tmp_path, engine=tts, generated_at=WHEN)
    assert again["audio"] == {"engine": "fake", "voice": "test-voice", "rendered": 0, "cached": 27}
