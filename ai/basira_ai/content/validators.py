"""Deterministic validators for generated practice items.

Each validator returns None when the candidate passes, or a short reason when it fails. A candidate that fails any
validator is discarded (non-negotiable 8: never repaired). The names of the validators an item passed are recorded in
`Item.validation.validators`.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from basira_ai.content import arabic
from basira_ai.g2p import ALIF, TANWIN_FATH, G2PError, to_units
from basira_ai.reference import ReferenceData

GRADE_BANDS = ("2-3", "4-6")
TAP_TYPES = {"minimal_pair", "vowel_tap"}
PASSAGE_TYPES = {"passage_vowelized", "passage_unvowelized", "probe_passage"}

#: which skill-id prefixes each item type may target
SKILL_PREFIXES = {
    "letter_sound": ("ls.",),
    "vowel_tap": ("vowel.",),
    "minimal_pair": ("dot.", "emph.", "pos."),
    "real_word": ("decode.real",),
    "pseudoword": ("decode.pseudo",),
    "passage_vowelized": ("fluency.",),
    "passage_unvowelized": ("fluency.",),
    "probe_passage": ("fluency.",),
}

#: (min, max) letters per word for single-word items, words per text for passages
LETTER_BOUNDS = {
    ("letter_sound", "2-3"): (1, 1),
    ("letter_sound", "4-6"): (1, 1),
    ("vowel_tap", "2-3"): (1, 6),
    ("vowel_tap", "4-6"): (1, 6),
    ("minimal_pair", "2-3"): (2, 6),
    ("minimal_pair", "4-6"): (2, 7),
    ("real_word", "2-3"): (2, 6),
    ("real_word", "4-6"): (3, 9),
    ("pseudoword", "2-3"): (3, 5),
    ("pseudoword", "4-6"): (3, 6),
}
WORD_BOUNDS = {"2-3": (8, 30), "4-6": (15, 60)}


@dataclass(frozen=True)
class Candidate:
    type: str
    skill_ids: tuple[str, ...]
    grade_band: str
    text: str
    options: tuple[str, ...] | None = None
    answer_index: int | None = None
    probe_only: bool = False
    source: str = "generated"


@dataclass
class Context:
    ref: ReferenceData
    #: undiacritized forms of every real word the pipeline knows (pseudowords must avoid them)
    lexicon: set[str] = field(default_factory=set)
    #: texts of practice passages (probe passages must be unseen)
    practice_texts: set[str] = field(default_factory=set)


Validator = Callable[[Candidate, Context], str | None]


def _texts(c: Candidate) -> list[str]:
    """Every Arabic string the candidate shows: the options for tap items, else the text."""
    return list(c.options) if c.options else [c.text]


# ---------------------------------------------------------------- validators


def script(c: Candidate, ctx: Context) -> str | None:
    allowed = arabic.arabic_letters(ctx.ref.taxonomy) | arabic.MARKS | arabic.PUNCTUATION | {" "}
    text = c.text.replace(arabic.PAIR_SEPARATOR, " ") if c.type == "minimal_pair" else c.text
    for s in [text, *(c.options or [])]:
        bad = sorted({ch for ch in s if ch not in allowed})
        if bad:
            return "non-Arabic characters: " + " ".join(f"U+{ord(ch):04X}" for ch in bad)
        if c.type not in PASSAGE_TYPES and set(s) & arabic.PUNCTUATION:
            return "punctuation outside a passage"
    return None


def diacritized(c: Candidate, ctx: Context) -> str | None:
    for s in _texts(c):
        for word in arabic.words(s):
            bad = arabic.undiacritized_letters(word, ctx.ref.taxonomy)
            if bad:
                return f"missing vowel mark in {word!r} at letter {bad[0]}"
    return None


def g2p(c: Candidate, ctx: Context) -> str | None:
    """The reference pronunciation (A2) can be derived, so the scorer can score a reading of it."""
    for s in _texts(c):
        try:
            to_units(arabic.strip_punctuation(s), ctx.ref.taxonomy)
        except G2PError as exc:
            return f"g2p: {exc}"
    return None


def length(c: Candidate, ctx: Context) -> str | None:
    if c.grade_band not in GRADE_BANDS:
        return f"unknown grade band {c.grade_band!r}"
    if c.type in PASSAGE_TYPES:
        lo, hi = WORD_BOUNDS[c.grade_band]
        n = len(arabic.words(c.text))
        return None if lo <= n <= hi else f"{n} words, expected {lo}-{hi}"
    lo, hi = LETTER_BOUNDS[(c.type, c.grade_band)]
    for s in _texts(c):
        ws = arabic.words(s)
        if len(ws) != 1:
            return f"expected one word, got {len(ws)}"
        n = arabic.letter_count(ws[0])
        if not lo <= n <= hi:
            return f"{n} letters, expected {lo}-{hi}"
    return None


def skills(c: Candidate, ctx: Context) -> str | None:
    if not c.skill_ids:
        return "no skill"
    for sid in c.skill_ids:
        if sid not in ctx.ref.skills:
            return f"unknown skill {sid!r}"
        if not sid.startswith(SKILL_PREFIXES[c.type]):
            return f"skill {sid!r} does not fit item type {c.type}"
    return None


def answer(c: Candidate, ctx: Context) -> str | None:
    if c.type in TAP_TYPES:
        if not c.options or len(c.options) < 2:
            return "tap item needs at least two options"
        if len(set(c.options)) != len(c.options):
            return "duplicate options"
        if c.answer_index is None or not 0 <= c.answer_index < len(c.options):
            return "answer_index out of range"
        return None
    if c.options is not None or c.answer_index is not None:
        return "only tap items have options"
    return None


def probe(c: Candidate, ctx: Context) -> str | None:
    if c.probe_only != (c.type == "probe_passage"):
        return "probe_only must be set exactly on probe passages"
    if c.probe_only and c.text in ctx.practice_texts:
        return "probe passage is also a practice passage"
    return None


def _pair_difference(c: Candidate, ctx: Context) -> tuple[str, str, int] | str:
    """(letter_a, letter_b, position) of the single differing letter, or a failure reason."""
    if not c.options or len(c.options) != 2:
        return "a minimal pair has exactly two options"
    a, b = (arabic.split_letters(w) for w in c.options)
    if len(a) != len(b):
        return "pair words differ in length"
    diffs = [i for i, (x, y) in enumerate(zip(a, b, strict=True)) if x != y]
    if len(diffs) != 1:
        return f"pair words differ in {len(diffs)} letters, expected exactly one"
    i = diffs[0]
    if a[i][1] != b[i][1]:
        return "pair words differ in vowel marks, not only the letter"
    la, lb = (arabic.letter_id(w[i][0], ctx.ref.taxonomy) for w in (a, b))
    if la is None or lb is None:
        return "pair letter not in the taxonomy"
    return la, lb, i


def _expected_position(index: int, n_letters: int) -> str:
    return "initial" if index == 0 else "final" if index == n_letters - 1 else "medial"


def minimal_pair(c: Candidate, ctx: Context) -> str | None:
    """dot_group_pair / emphatic_pair: the two words differ in one letter, and that letter pair is the skill target."""
    diff = _pair_difference(c, ctx)
    if isinstance(diff, str):
        return diff
    la, lb, i = diff
    tax = ctx.ref.taxonomy
    target = [s for s in c.skill_ids if s.startswith(("dot.", "emph."))]
    if len(target) != 1:
        return "a minimal pair targets exactly one dot-group or emphatic skill"
    skill = target[0]
    if skill.startswith("dot."):
        group = tax.dot_group_of(la)
        if not tax.is_dot_confusion(la, lb) or group is None or group.id != skill:
            return f"{la}/{lb} is not a contrast of {skill}"
    else:
        pair = tax.emphatic_pair_of(la, lb)
        if pair is None or pair.id != skill:
            return f"{la}/{lb} is not the emphatic contrast {skill}"
    pos = [s for s in c.skill_ids if s.startswith("pos.")]
    expected = "pos." + _expected_position(i, len(arabic.split_letters(c.options[0])))
    if pos and pos != [expected]:
        return f"positional skill {pos} but the contrast is {expected}"
    if c.text != arabic.PAIR_SEPARATOR.join(c.options):
        return "pair text must list both options"
    return None


def _skeleton(word: str) -> str:
    """Letters without marks, ignoring the spelling alif that follows tanwin fath."""
    letters = arabic.split_letters(word)
    if len(letters) > 1 and letters[-1][0] == ALIF and TANWIN_FATH in letters[-2][1]:
        letters = letters[:-1]
    return "".join(ch for ch, _ in letters)


def vowel_options(c: Candidate, ctx: Context) -> str | None:
    """All options are the same letters and differ only in the marks of one letter; the text is the answer."""
    if not c.options or c.answer_index is None:
        return "vowel tap needs options and an answer"
    if len({_skeleton(o) for o in c.options}) != 1:
        return "options are not the same letters"
    marks = [[m for _, m in arabic.split_letters(o)][: len(_skeleton(o))] for o in c.options]
    differing = {i for i in range(len(marks[0])) if len({tuple(sorted(m[i])) for m in marks}) > 1}
    if len(differing) != 1:
        return f"options differ in the marks of {len(differing)} letters, expected one"
    if c.text != c.options[c.answer_index]:
        return "text is not the answer option"
    return None


def not_real_word(c: Candidate, ctx: Context) -> str | None:
    """A pseudoword must not be a word the pipeline knows (catches only our own lexicon; review catches the rest)."""
    if arabic.strip_diacritics(c.text) in ctx.lexicon:
        return "pseudoword is a known real word"
    return None


def letter_sound(c: Candidate, ctx: Context) -> str | None:
    (sid,) = c.skill_ids
    letter = arabic.letter_id(arabic.split_letters(c.text)[0][0], ctx.ref.taxonomy)
    return None if sid == f"ls.{letter}" else f"text letter {letter} does not match {sid}"


COMMON: list[tuple[str, Validator]] = [
    ("script", script),
    ("diacritized", diacritized),
    ("g2p", g2p),
    ("length", length),
    ("skills", skills),
    ("answer", answer),
    ("probe", probe),
]
BY_TYPE: dict[str, list[tuple[str, Validator]]] = {
    "letter_sound": [("letter_sound", letter_sound)],
    "vowel_tap": [("vowel_options", vowel_options)],
    "minimal_pair": [("minimal_pair", minimal_pair)],
    "pseudoword": [("not_real_word", not_real_word)],
}


def validate(c: Candidate, ctx: Context) -> tuple[list[str], str | None]:
    """(names of validators run, first failure reason or None). Stops at the first failure."""
    names: list[str] = []
    for name, fn in COMMON + BY_TYPE.get(c.type, []):
        if name == "minimal_pair":
            name = "emphatic_pair" if any(s.startswith("emph.") for s in c.skill_ids) else "dot_group_pair"
        names.append(name)
        reason = fn(c, ctx)
        if reason is not None:
            return names, f"{name}: {reason}"
    return names, None
