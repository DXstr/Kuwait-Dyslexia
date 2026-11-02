"""Small, deterministic helpers for vowelled Arabic text used by the content validators."""

from __future__ import annotations

from basira_ai.g2p import (
    ALIF,
    ALIF_MAQSURA,
    DAMMA,
    FATHA,
    HAMZA_FORMS,
    KASRA,
    LAAM,
    MADDA_ALIF,
    MARKS,
    SHADDA,
    SUKUN,
    SUN_LETTERS,
    SUPERSCRIPT_ALIF,
    TAA_MARBUTA,
    TANWIN,
    TANWIN_FATH,
    WAW,
    YAA,
)
from basira_ai.reference import Taxonomy

PUNCTUATION = set("،.؟!؛")
PAIR_SEPARATOR = " / "
VOWELS = {FATHA, KASRA, DAMMA}
#: marks that give a letter its vowel (or explicitly none); shadda alone does not
VOCALIC = VOWELS | TANWIN | {SUKUN, SUPERSCRIPT_ALIF}


def split_letters(word: str) -> list[tuple[str, frozenset[str]]]:
    """[(letter, marks)] for one word. A mark with no letter before it is kept as a letter so validators reject it."""
    out: list[tuple[str, set[str]]] = []
    for ch in word:
        if ch in MARKS and out:
            out[-1][1].add(ch)
        else:
            out.append((ch, set()))
    return [(ch, frozenset(marks)) for ch, marks in out]


def strip_punctuation(text: str) -> str:
    return "".join(ch for ch in text if ch not in PUNCTUATION)


def words(text: str) -> list[str]:
    return [w for w in strip_punctuation(text).split() if w]


def strip_diacritics(text: str) -> str:
    return "".join(ch for ch in text if ch not in MARKS)


def letter_count(word: str) -> int:
    return len(split_letters(strip_punctuation(word)))


def arabic_letters(taxonomy: Taxonomy) -> set[str]:
    """Every base character an item may contain."""
    chars = {letter.char for letter in taxonomy.letters.values()}
    return chars | HAMZA_FORMS | {MADDA_ALIF, TAA_MARBUTA, ALIF_MAQSURA, ALIF}


def letter_id(ch: str, taxonomy: Taxonomy) -> str | None:
    if ch in HAMZA_FORMS or ch in (ALIF, MADDA_ALIF):
        return "alif"
    if ch == TAA_MARBUTA:
        return "taa"
    letter = taxonomy.letter_by_char(ch)
    return letter.id if letter else None


def undiacritized_letters(word: str, taxonomy: Taxonomy) -> list[int]:
    """Indexes of letters in `word` that lack a vowel mark where standard full vowelling requires one.

    Allowed without a mark (standard school spelling, read in isolation/pause):
    - long-vowel letters: ا or ى after fatha (and the alif after tanwin fath), و after damma, ي after kasra;
    - the bare alif of the definite article, and its laam when assimilated to a following sun letter with shadda;
    - a word-final letter (pausal sukun), including taa marbuta.
    A shadda must always carry a vowel or tanwin. A stray mark (no letter before it) is always reported.
    """
    letters = split_letters(word)
    bad: list[int] = []
    for i, (ch, marks) in enumerate(letters):
        prev = letters[i - 1][1] if i > 0 else frozenset()
        last = i == len(letters) - 1
        if ch in MARKS:  # stray mark
            bad.append(i)
            continue
        if SHADDA in marks and not marks & (VOWELS | TANWIN):
            if not last:
                bad.append(i)
            continue
        if marks & VOCALIC:
            continue
        if last:
            continue
        if ch in (ALIF, ALIF_MAQSURA) and prev & {FATHA, TANWIN_FATH}:
            continue
        if ch == WAW and DAMMA in prev or ch == YAA and KASRA in prev:
            continue
        if ch == ALIF and i == 0 and len(letters) > 1 and letters[1][0] == LAAM:
            continue
        if ch == LAAM and i == 1 and letters[0][0] == ALIF and not letters[0][1]:
            nxt_ch, nxt_marks = letters[i + 1]
            nxt = letter_id(nxt_ch, taxonomy)
            if nxt in SUN_LETTERS and SHADDA in nxt_marks:
                continue
        bad.append(i)
    return bad
