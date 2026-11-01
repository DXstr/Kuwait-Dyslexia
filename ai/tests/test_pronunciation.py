"""Scorer behaviour on synthetic posteriors imitating the real models (see ai/notebooks/a3_results_v4.md)."""

import numpy as np
import pytest

from basira_ai.g2p import to_units
from basira_ai.pronunciation import AcousticOutput, missing_phone_tokens, routing, score_pronunciation
from basira_ai.reference import reference_data

REF = reference_data()
PHONE_TOKENS = ["<pad>"] + sorted(set(routing()["phone_model"]["tokens"].values()))
PHONE_VOCAB = {t: i for i, t in enumerate(PHONE_TOKENS)}
LETTER_TOKENS = ["<pad>", "|"] + [letter.char for letter in REF.taxonomy.letters.values()] + list("ءأإؤئةى")
LETTER_VOCAB = {t: i for i, t in enumerate(LETTER_TOKENS)}


def frames(tokens: list[str], vocab: dict[str, int], p: float = 0.9) -> AcousticOutput:
    """Two frames per token with a blank between tokens, each frame confidently its token."""
    seq: list[int] = []
    for tok in tokens:
        seq += [vocab[tok], vocab[tok], 0]
    lp = np.full((len(seq) + 1, len(vocab)), np.log((1 - p) / (len(vocab) - 1)))
    for t, k in enumerate(seq):
        lp[t, k] = np.log(p)
    lp[-1, 0] = np.log(p)
    return AcousticOutput(lp, vocab, 0)


def run(text: str, heard_phones: list[str], heard_letters: list[str] | None = None):
    units = to_units(text, REF.taxonomy)
    phone = frames(heard_phones, PHONE_VOCAB)
    letter = frames(heard_letters, LETTER_VOCAB) if heard_letters else None
    return {e.unit.index: e for e in score_pronunciation(text, units, phone, letter, REF)}, units


def consonant(ev, units, letter_id):
    return next(ev[u.index] for u in units if u.letter == letter_id)


def test_configured_tokens_exist_in_test_vocab():
    assert missing_phone_tokens(PHONE_VOCAB) == []


def test_correct_qaaf():
    ev, units = run("قَلَم", ["q", "a", "l", "a", "m"])
    q = consonant(ev, units, "qaaf")
    assert q.winner_ipa == "q" and q.score > 0.5 and q.decided_by == "phone"


def test_qaaf_said_as_g_is_heard_as_g_not_as_an_error_letter():
    ev, units = run("قَلَم", ["ɡ", "a", "l", "a", "m"])
    q = consonant(ev, units, "qaaf")
    assert q.winner_ipa == "g" and q.winner_letter is None and q.score < 0.2


def test_qaaf_said_as_glottal_stop_is_heard_as_hamza():
    ev, units = run("قَلَم", ["ʔ", "a", "l", "a", "m"])
    q = consonant(ev, units, "qaaf")
    assert q.winner_ipa == "ʔ" and q.winner_letter == "alif"


def test_jiim_said_as_y():
    ev, units = run("دَجَاج", ["d", "a", "j", "aː", "j"])
    jiims = [ev[u.index] for u in units if u.letter == "jiim"]
    assert all(j.winner_ipa == "j" for j in jiims)


def test_thaa_read_as_taa_is_a_dot_mate():
    ev, units = run("ثَوْب", ["t", "a", "w", "b"])
    th = consonant(ev, units, "thaa")
    assert th.winner_ipa == "t" and th.winner_letter == "taa"


def test_emphatic_contrast_is_decided_by_the_letter_model():
    # phone model cannot separate ص/س (both "s"); the letter model hears س
    ev, units = run("صَبَاح", ["s", "a", "b", "aː", "ħ"], heard_letters=["س", "ب", "ا", "ح"])
    sad = consonant(ev, units, "saad")
    assert sad.winner_letter == "siin" and sad.decided_by == "letter" and not sad.degraded


def test_correct_emphatic_with_letter_model():
    ev, units = run("صَبَاح", ["s", "a", "b", "aː", "ħ"], heard_letters=["ص", "ب", "ا", "ح"])
    sad = consonant(ev, units, "saad")
    assert sad.winner_ipa == "sˤ" and sad.score > 0.5


def test_without_letter_model_emphatic_contrast_is_flagged_degraded_not_guessed():
    ev, units = run("صَبَاح", ["s", "a", "b", "aː", "ħ"])
    sad = consonant(ev, units, "saad")
    assert sad.degraded and sad.winner_ipa == "sˤ"  # no evidence against the expected sound -> not called an error


def test_vowels_are_scored_but_only_against_vowels():
    ev, units = run("قَلَم", ["q", "i", "l", "a", "m"])
    first_vowel = ev[units[1].index]
    assert first_vowel.winner_ipa == "i" and {c.ipa for c in first_vowel.candidates} == {"a", "i", "u"}


@pytest.mark.parametrize("text", ["قَلَم", "ثَوْب", "دَجَاج", "صَبَاح", "خَرُوف", "مَدْرَسَةٌ", "الشَّمْس"])
def test_every_unit_gets_evidence_with_valid_ranges(text):
    units = to_units(text, REF.taxonomy)
    heard = [routing()["phone_model"]["tokens"][u.ipa] for u in units]
    ev, _ = run(text, heard)
    assert len(ev) == len(units)
    for e in ev.values():
        assert 0.0 <= e.score <= 1.0
        assert e.span.end > e.span.start


def test_acoustic_module_imports_without_torch():
    import basira_ai.acoustic as acoustic

    assert acoustic.SAMPLE_RATE == 16_000
