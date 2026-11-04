"""Expected pronunciation of fully diacritized Arabic text (MSA reading norms).

Basira always knows the target text, so it needs a deterministic converter from the vowelled text to the sequence of
expected sound units. Built from contracts/taxonomy.json; deliberately not espeak/phonemizer (GPL-3.0, see ADR-002).

Scope (what a primary-school reading item contains): the 28 letters, hamza carriers, taa marbuta, alif maqsura,
long vowels (madd), fatha/kasra/damma, sukun, shadda (gemination), tanwin, superscript alif, and the definite article
with sun-letter assimilation. Words are read in isolation/pause form: an unvowelled final taa marbuta is silent.

Letter positions (initial/medial/final/isolated) are by order among the word's consonants, an approximation of the
written positional form that is good enough for the positional error rate (A5).
"""

from __future__ import annotations

from dataclasses import dataclass

from basira_ai.reference import Taxonomy

FATHA, KASRA, DAMMA = "َ", "ِ", "ُ"
SUKUN, SHADDA = "ْ", "ّ"
TANWIN_FATH, TANWIN_DAMM, TANWIN_KASR = "ً", "ٌ", "ٍ"
SUPERSCRIPT_ALIF, TATWEEL = "ٰ", "ـ"
MARKS = {FATHA, KASRA, DAMMA, SUKUN, SHADDA, TANWIN_FATH, TANWIN_DAMM, TANWIN_KASR, SUPERSCRIPT_ALIF}
VOWEL_OF = {FATHA: "a", KASRA: "i", DAMMA: "u", TANWIN_FATH: "a", TANWIN_DAMM: "u", TANWIN_KASR: "i"}
TANWIN = {TANWIN_FATH, TANWIN_DAMM, TANWIN_KASR}
HAMZA_FORMS = set("ءأإؤئ")
NOT_READ_ALOUD = str.maketrans("", "", "،.؟!؛/")
MADDA_ALIF = "آ"
TAA_MARBUTA, ALIF, ALIF_MAQSURA, WAW, YAA, LAAM = "ة", "ا", "ى", "و", "ي", "ل"
SUN_LETTERS = {"taa", "thaa", "daal", "dhaal", "raa", "zaay", "siin", "shiin", "saad", "daad", "ttaa", "zhaa", "laam",
               "nuun"}


class G2PError(ValueError):
    """The text contains something the converter does not handle (it never guesses)."""


@dataclass(frozen=True)
class Unit:
    index: int
    word_index: int
    kind: str  # "consonant" | "vowel"
    ipa: str  # canonical IPA from the taxonomy (vowels: a i u aː iː uː)
    letter: str | None  # taxonomy letter id for consonants, None for vowels
    position: str | None  # initial | medial | final | isolated (consonants only)
    char_index: int  # index into written_letters(text) of the letter this unit comes from


def _split_letters(word: str) -> list[tuple[str, set[str]]]:
    out: list[tuple[str, set[str]]] = []
    for ch in word:
        if ch == TATWEEL:
            continue
        if ch in MARKS:
            if not out:
                raise G2PError(f"diacritic without a letter in {word!r}")
            out[-1][1].add(ch)
        else:
            out.append((ch, set()))
    return out


def reading_text(text: str) -> str:
    """What is read aloud from an item's display text: no punctuation, no "/" between the words of a minimal pair."""
    return " ".join(text.translate(NOT_READ_ALOUD).split())


def _vowel_marks(marks: set[str]) -> bool:
    return bool(marks & (set(VOWEL_OF) | {SUKUN, SHADDA}))


def to_units(text: str, taxonomy: Taxonomy) -> list[Unit]:
    """Convert fully diacritized Arabic text into expected sound units. Raises G2PError on anything unsupported."""
    raw: list[tuple[int, str, str, str | None, int]] = []  # (word_index, kind, ipa, letter, char_index)
    base = 0
    for w_idx, word in enumerate(text.split()):
        letters = _split_letters(word)
        for i, (ch, marks) in enumerate(letters):
            c_idx = base + i
            prev_vowel = raw[-1][2] if raw and raw[-1][0] == w_idx and raw[-1][1] == "vowel" else None

            if ch == ALIF and not _vowel_marks(marks):
                if prev_vowel == "a":
                    raw[-1] = (w_idx, "vowel", "aː", None, raw[-1][4])
                elif i == 0:  # word-initial bare alif (e.g. the article): read as a glottal onset + a
                    raw.append((w_idx, "consonant", "ʔ", "alif", c_idx))
                    raw.append((w_idx, "vowel", "a", None, c_idx))
                continue  # otherwise silent (e.g. the alif after tanwin fath)
            if ch == ALIF_MAQSURA:
                if prev_vowel == "a":
                    raw[-1] = (w_idx, "vowel", "aː", None, raw[-1][4])
                continue
            if ch in (WAW, YAA) and not _vowel_marks(marks):
                long_of = {"u": "uː"} if ch == WAW else {"i": "iː"}
                if prev_vowel in long_of:
                    raw[-1] = (w_idx, "vowel", long_of[prev_vowel], None, raw[-1][4])
                    continue
            if ch == TAA_MARBUTA:
                if not (marks & set(VOWEL_OF)):
                    continue  # pausal form: silent
                letter_id = "taa"
            elif ch == MADDA_ALIF:
                raw.append((w_idx, "consonant", "ʔ", "alif", c_idx))
                raw.append((w_idx, "vowel", "aː", None, c_idx))
                continue
            elif ch in HAMZA_FORMS or ch == ALIF:
                letter_id = "alif"
            else:
                letter = taxonomy.letter_by_char(ch)
                if letter is None:
                    raise G2PError(f"unsupported character {ch!r} (U+{ord(ch):04X}) in {word!r}")
                letter_id = letter.id
            # definite article: unvowelled laam before a sun letter carrying shadda is assimilated (silent)
            if ch == LAAM and not _vowel_marks(marks) and i + 1 < len(letters):
                nxt_ch, nxt_marks = letters[i + 1]
                nxt = taxonomy.letter_by_char(nxt_ch)
                if nxt is not None and nxt.id in SUN_LETTERS and SHADDA in nxt_marks:
                    continue
            ipa = taxonomy.letter(letter_id).ipa
            for _ in range(2 if SHADDA in marks else 1):
                raw.append((w_idx, "consonant", ipa, letter_id, c_idx))
            vowel = next((VOWEL_OF[m] for m in marks if m in VOWEL_OF), None)
            if vowel:
                raw.append((w_idx, "vowel", vowel, None, c_idx))
            if marks & TANWIN:
                raw.append((w_idx, "consonant", "n", "nuun", c_idx))
            if SUPERSCRIPT_ALIF in marks:
                raw.append((w_idx, "vowel", "aː", None, c_idx))
        base += len(letters)

    units: list[Unit] = []
    for w_idx in sorted({r[0] for r in raw}):
        word_units = [r for r in raw if r[0] == w_idx]
        cons_idx = [k for k, r in enumerate(word_units) if r[1] == "consonant"]
        for k, (_, kind, ipa, letter, c_idx) in enumerate(word_units):
            position = None
            if kind == "consonant":
                if len(cons_idx) == 1:
                    position = "isolated"
                elif k == cons_idx[0] or (k == cons_idx[0] + 1 and word_units[k - 1][2] == ipa):
                    position = "initial"
                elif k == cons_idx[-1] or (k == cons_idx[-1] - 1 and word_units[k + 1][2] == ipa):
                    position = "final"
                else:
                    position = "medial"
            units.append(Unit(len(units), w_idx, kind, ipa, letter, position, c_idx))
    if not units:
        raise G2PError("empty text")
    return units


def written_letters(text: str) -> list[tuple[int, str]]:
    """(word_index, character) for every written letter, without diacritics; Unit.char_index points into this."""
    return [(w_idx, ch) for w_idx, word in enumerate(text.split()) for ch, _ in _split_letters(word)]


def ipa_string(units: list[Unit]) -> str:
    return " ".join(u.ipa for u in units)
