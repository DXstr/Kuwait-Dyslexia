import pytest

from basira_ai.g2p import G2PError, ipa_string, to_units
from basira_ai.reference import reference_data

TAX = reference_data().taxonomy


@pytest.mark.parametrize(
    "text, expected",
    [
        ("قَلَم", "q a l a m"),
        ("ثَوْب", "θ a w b"),  # waw with sukun is a consonant (diphthong), not a long vowel
        ("دَجَاج", "d a dʒ aː dʒ"),  # fatha + alif = long a
        ("صَبَاح", "sˤ a b aː ħ"),
        ("خَرُوف", "x a r uː f"),  # damma + waw = long u
        ("كَبِير", "k a b iː r"),  # kasra + yaa = long i
        ("كِتَابٌ", "k i t aː b u n"),  # tanwin damm
        ("مَدْرَسَةٌ", "m a d r a s a t u n"),  # vowelled taa marbuta is t
        ("مَدْرَسَة", "m a d r a s a"),  # pausal taa marbuta is silent
        ("الشَّمْس", "ʔ a ʃ ʃ a m s"),  # sun letter: laam assimilated, shiin doubled
        ("الْقَمَر", "ʔ a l q a m a r"),  # moon letter: laam pronounced
        ("سَأَلَ", "s a ʔ a l a"),  # hamza on alif
        ("مُوسَى", "m uː s aː"),  # alif maqsura lengthens fatha
        ("آدَم", "ʔ aː d a m"),  # madda
        ("شُكْرًا", "ʃ u k r a n"),  # tanwin fath + silent alif
        ("هٰذَا", "h aː ð aː"),  # superscript alif
    ],
)
def test_expected_pronunciation(text, expected):
    assert ipa_string(to_units(text, TAX)) == expected


def test_units_carry_letters_and_positions():
    units = to_units("قَلَم", TAX)
    consonants = [u for u in units if u.kind == "consonant"]
    assert [(u.letter, u.position) for u in consonants] == [("qaaf", "initial"), ("laam", "medial"), ("miim", "final")]
    assert all(u.letter is None and u.position is None for u in units if u.kind == "vowel")
    assert [u.index for u in units] == list(range(len(units)))


def test_geminate_consonant_keeps_one_position():
    units = to_units("الشَّمْس", TAX)
    shiin = [u for u in units if u.letter == "shiin"]
    assert len(shiin) == 2 and {u.position for u in shiin} == {"medial"}


def test_multiple_words_get_word_indices():
    units = to_units("قَلَم ثَوْب", TAX)
    assert {u.word_index for u in units} == {0, 1}
    assert [u.position for u in units if u.word_index == 1 and u.kind == "consonant"] == ["initial", "medial", "final"]


def test_single_consonant_word_is_isolated():
    assert [u.position for u in to_units("بِ", TAX) if u.kind == "consonant"] == ["isolated"]


@pytest.mark.parametrize("bad", ["hello", "قلمx", "َب", ""])
def test_unsupported_text_raises(bad):
    with pytest.raises(G2PError):
        to_units(bad, TAX)


def test_units_point_to_their_written_letter():
    from basira_ai.g2p import written_letters

    text = "دَجَاج قَلَم"
    units = to_units(text, TAX)
    letters = written_letters(text)
    assert [ch for _, ch in letters] == list("دجاجقلم")
    for u in units:
        if u.kind == "consonant" and u.letter != "alif":
            assert TAX.letter(u.letter).char == letters[u.char_index][1]
    long_a = next(u for u in units if u.ipa == "aː")
    assert letters[long_a.char_index][1] in "جا"
