"""A11 content pipeline: validators reject what they must, the bank matches the contract, audio is cached."""

import json
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from basira_ai.content import arabic, generate
from basira_ai.content.build import build, check_schema, content_dir, spoken_text
from basira_ai.content.validators import Candidate, Context, validate
from basira_ai.reference import reference_data

REF = reference_data()
SOURCE = content_dir() / "source"
WHEN = datetime(2026, 11, 2, tzinfo=UTC)


@pytest.fixture(scope="module")
def ctx() -> Context:
    return Context(REF, generate.lexicon(SOURCE), set())


def fails(c: Candidate, ctx: Context) -> str | None:
    return validate(c, ctx)[1]


def pair(words, skill, answer=0, band="2-3"):
    return Candidate("minimal_pair", (skill,), band, arabic.PAIR_SEPARATOR.join(words), tuple(words), answer)


# ---------------------------------------------------------------- text helpers


def test_strip_diacritics():
    assert arabic.strip_diacritics("مَدْرَسَة") == "مدرسة"


@pytest.mark.parametrize(
    "word",
    ["كِتَاب", "الشَّمْس", "الْقَمَر", "مَدْرَسَة", "عُصْفُورًا", "إِلَى", "مُسْتَشْفَى", "فِيهِ", "نُور", "قَلَم", "وَالِد"],
)
def test_fully_vowelled_words_pass(word):
    assert arabic.undiacritized_letters(word, REF.taxonomy) == []


@pytest.mark.parametrize(
    "word",
    [
        "كتاب",  # no marks at all
        "كِتاب",  # taa unmarked mid-word
        "مِائَة",  # silent alif after kasra is not standard full vowelling here
        "قَلّم",  # shadda without a vowel mid-word
        "بِال",  # article alif not word-initial
        "َب",  # stray mark
        "وَالْبَيْت",  # proclitic + article: read in isolation it would be a long "aa"
        "كَالصَّفِير",  # same, before a sun letter
    ],
)
def test_missing_vowels_are_caught(word):
    assert arabic.undiacritized_letters(word, REF.taxonomy)


# ---------------------------------------------------------------- validators


def test_valid_items_pass(ctx):
    assert fails(pair(["صَيْف", "سَيْف"], "emph.saad-siin"), ctx) is None
    assert fails(pair(["بَيْت", "بَيْن"], "dot.baa-taa-thaa-nuun-yaa"), ctx) is None
    tap = Candidate("vowel_tap", ("vowel.kasra",), "2-3", "بِ", ("بَ", "بِ", "بُ"), 1)
    assert fails(tap, ctx) is None
    assert fails(Candidate("real_word", ("decode.real",), "2-3", "قَلَم"), ctx) is None


def test_validator_names_are_recorded(ctx):
    names, failure = validate(pair(["صَيْف", "سَيْف"], "emph.saad-siin"), ctx)
    assert failure is None
    assert names[:3] == ["script", "diacritized", "g2p"] and "emphatic_pair" in names
    names, _ = validate(pair(["بَيْت", "بَيْن"], "dot.baa-taa-thaa-nuun-yaa"), ctx)
    assert "dot_group_pair" in names


@pytest.mark.parametrize(
    ("candidate", "reason"),
    [
        (Candidate("real_word", ("decode.real",), "2-3", "cat"), "script"),
        (Candidate("real_word", ("decode.real",), "2-3", "قَلَم."), "script"),
        (Candidate("real_word", ("decode.real",), "2-3", "قلم"), "diacritized"),
        (Candidate("real_word", ("decode.real",), "2-3", "بَيْت قَلَم"), "length"),
        (Candidate("real_word", ("decode.real",), "2-3", "مُسْتَشْفَيَاتُنَا"), "length"),
        (Candidate("real_word", ("decode.real",), "1-2", "قَلَم"), "length"),
        (Candidate("real_word", ("vowel.fatha",), "2-3", "قَلَم"), "skills"),
        (Candidate("real_word", ("decode.nope",), "2-3", "قَلَم"), "skills"),
        (Candidate("real_word", ("decode.real",), "2-3", "قَلَم", ("قَلَم",), 0), "answer"),
        (Candidate("real_word", ("decode.real",), "2-3", "قَلَم", probe_only=True), "probe"),
        (Candidate("letter_sound", ("ls.taa",), "2-3", "بَ"), "letter_sound"),
        (Candidate("pseudoword", ("decode.pseudo",), "2-3", "قَمَر"), "not_real_word"),
    ],
)
def test_invalid_items_are_rejected(ctx, candidate, reason):
    failure = fails(candidate, ctx)
    assert failure is not None and failure.startswith(reason), failure


@pytest.mark.parametrize(
    ("words", "skill", "why"),
    [
        (["جَمَل", "حَمَل"], "dot.baa-taa-thaa-nuun-yaa", "not a contrast"),  # wrong dot group
        (["بَاب", "قَلَم"], "dot.baa-taa-thaa-nuun-yaa", "differ in"),  # many letters differ
        (["تَمْر", "ثَمَر"], "dot.baa-taa-thaa-nuun-yaa", "differ in"),  # vowels differ too
        (["بَيْت", "بَيْتَيْن"], "dot.baa-taa-thaa-nuun-yaa", "length"),
        (["سَيْف", "صَيْف"], "emph.ttaa-taa", "not the emphatic"),
        (["طِين", "تِين"], "dot.ttaa-zhaa", "not a contrast"),  # emphatic pair passed off as a dot pair
        (["سِحْر", "شِعْر"], "dot.siin-shiin", "differ in"),
    ],
)
def test_bad_minimal_pairs_are_rejected(ctx, words, skill, why):
    failure = fails(pair(words, skill), ctx)
    assert failure is not None and why in failure, failure


def test_minimal_pair_position_skill_must_match(ctx):
    c = pair(["صَيْف", "سَيْف"], "emph.saad-siin")
    assert fails(replace(c, skill_ids=("emph.saad-siin", "pos.initial")), ctx) is None
    failure = fails(replace(c, skill_ids=("emph.saad-siin", "pos.final")), ctx)
    assert failure is not None and "positional" in failure


@pytest.mark.parametrize(
    ("text", "options", "answer", "why"),
    [
        ("بِ", ("بَ", "بِ", "تُ"), 1, "same letters"),
        ("بِ", ("بَ", "بِ", "بُ"), 0, "not the answer"),
        ("بَتَ", ("بَتَ", "بُتُ"), 0, "marks of 2 letters"),
        ("بِ", ("بَ", "بِ", "بَ"), 1, "duplicate"),
        ("بِ", ("بَ", "بِ", "بُ"), 5, "out of range"),
    ],
)
def test_bad_vowel_taps_are_rejected(ctx, text, options, answer, why):
    failure = fails(Candidate("vowel_tap", ("vowel.kasra",), "2-3", text, options, answer), ctx)
    assert failure is not None and why in failure, failure


def test_probe_passage_must_be_unseen():
    practice = next(p for p in generate.passages(SOURCE) if not p.probe_only)
    c = replace(practice, type="probe_passage", probe_only=True)
    ctx = Context(REF, set(), {practice.text})
    failure = fails(c, ctx)
    assert failure is not None and failure.startswith("probe"), failure
    assert fails(c, Context(REF, set(), set())) is None


# ---------------------------------------------------------------- generators


def test_generated_candidates_are_deterministic():
    assert generate.vowel_taps() == generate.vowel_taps()
    assert generate.pseudowords(set()) == generate.pseudowords(set())


def test_tap_answers_are_not_always_in_one_place():
    for skill in ("vowel.fatha", "vowel.tanwin", "vowel.shadda"):
        positions = {c.answer_index for c in generate.vowel_taps() if c.skill_ids == (skill,)}
        assert len(positions) > 1, skill


def test_pseudowords_avoid_the_lexicon(ctx):
    for c in generate.pseudowords(ctx.lexicon):
        assert arabic.strip_diacritics(c.text) not in ctx.lexicon
    assert "رسل" in ctx.lexicon  # caught in review via content/source/pseudoword_blocklist.json


# ---------------------------------------------------------------- build


class FakeTTS:
    name, voice, extension = "fake", "test-voice", "mp3"

    def __init__(self):
        self.calls: list[str] = []

    def synthesize(self, text: str) -> bytes:
        self.calls.append(text)
        return text.encode("utf-8")


def test_build_without_audio_matches_the_contract(tmp_path: Path):
    result = build(tmp_path, generated_at=WHEN)
    bank = json.loads((tmp_path / "item-bank.json").read_text(encoding="utf-8"))
    check_schema(bank)
    assert bank["synthetic_audio"] is False
    assert all(i["audio_path"] is None for i in bank["items"])
    assert all(i["review"]["status"] == "unreviewed" for i in bank["items"])
    ids = [i["id"] for i in bank["items"]]
    assert len(ids) == len(set(ids))
    types = {i["type"] for i in bank["items"]}
    assert len(types) == 8  # every ItemType
    assert result.report["accepted_total"] == len(bank["items"])


def test_every_skill_in_the_graph_has_practice_items(tmp_path: Path):
    bank = build(tmp_path, generated_at=WHEN).bank
    covered = {s for i in bank["items"] if not i["probe_only"] for s in i["skill_ids"]}
    assert set(REF.skills.skills) - covered == set()


def test_only_probe_passages_are_probe_only(tmp_path: Path):
    bank = build(tmp_path, generated_at=WHEN).bank
    assert {i["type"] for i in bank["items"] if i["probe_only"]} == {"probe_passage"}


def test_build_is_reproducible(tmp_path: Path):
    a = build(tmp_path / "a", generated_at=WHEN).bank
    b = build(tmp_path / "b", generated_at=WHEN).bank
    assert a == b


def test_audio_is_rendered_cached_and_pruned(tmp_path: Path):
    tts = FakeTTS()
    bank = build(tmp_path, engine=tts, generated_at=WHEN).bank
    assert bank["synthetic_audio"] is True
    voiced = [i for i in bank["items"] if i["audio_path"]]
    assert voiced and all((tmp_path / i["audio_path"]).is_file() for i in voiced)
    assert all(i["audio_path"] is None for i in bank["items"] if i["probe_only"])
    pair_item = next(i for i in bank["items"] if i["type"] == "minimal_pair")
    spoken = (tmp_path / pair_item["audio_path"]).read_bytes().decode("utf-8")
    assert spoken == pair_item["options"][pair_item["answer_index"]]

    first = len(tts.calls)
    (tmp_path / "audio" / "stale.mp3").write_bytes(b"x")
    build(tmp_path, engine=tts, generated_at=WHEN)
    assert len(tts.calls) == first  # everything came from the cache
    assert not (tmp_path / "audio" / "stale.mp3").exists()


def test_spoken_text_for_probe_is_none():
    c = Candidate("probe_passage", ("fluency.passage",), "2-3", "x", probe_only=True)
    assert spoken_text(c) is None


def test_committed_bank_is_current(tmp_path: Path):
    """content/dist/item-bank.json must be what the pipeline builds from the committed sources."""
    committed = json.loads((content_dir() / "dist" / "item-bank.json").read_text(encoding="utf-8"))
    check_schema(committed)
    fresh = build(tmp_path, generated_at=WHEN).bank

    def strip(bank):
        return [{k: v for k, v in i.items() if k != "audio_path"} for i in bank["items"]]

    assert strip(committed) == strip(fresh), "run: python -m basira_ai.content build"
    if committed["synthetic_audio"]:
        assert all(i["audio_path"] for i in committed["items"] if not i["probe_only"])
        for i in committed["items"]:
            if i["audio_path"]:
                assert (content_dir() / "dist" / i["audio_path"]).is_file(), i["audio_path"]
