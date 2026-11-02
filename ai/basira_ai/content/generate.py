"""Candidate items: deterministic generators plus the LLM-authored lists in content/source/.

Nothing here sees child data: inputs are the reference data (contracts/) and the source lists, whose prompt holds only
skill targets and constraints (content/prompts/candidates.md, non-negotiable 7).
"""

from __future__ import annotations

import json
import random
from pathlib import Path

from basira_ai.content import arabic
from basira_ai.content.validators import Candidate
from basira_ai.g2p import DAMMA, FATHA, KASRA, SHADDA, SUKUN, TANWIN_DAMM, TANWIN_FATH, TANWIN_KASR
from basira_ai.reference import ReferenceData

VOWEL_MARK = {"vowel.fatha": FATHA, "vowel.kasra": KASRA, "vowel.damma": DAMMA}
TAP_LETTERS = "بتدرسفكلمن"
SUKUN_PAIRS = ["بت", "من", "كل", "سد", "فر", "قم"]
TANWIN_WORDS = ["كِتَاب", "قَلَم", "بَيْت", "وَلَد"]
PSEUDO_CONSONANTS = "بتدرزسفكلمنقجحخش"
PSEUDO_SEED = 2026
PSEUDO_COUNT = {"2-3": 20, "4-6": 12}


def _rotate(options: list[str], answer: int, k: int) -> tuple[tuple[str, ...], int]:
    """Rotate the options by k so the answer is not always in the same place (deterministic)."""
    k %= len(options)
    rotated = options[k:] + options[:k]
    return tuple(rotated), (answer - k) % len(options)


def letter_sounds(ref: ReferenceData) -> list[Candidate]:
    out = []
    for letter in ref.taxonomy.letters.values():
        char = "أ" if letter.id == "alif" else letter.char
        out.append(Candidate("letter_sound", (f"ls.{letter.id}",), "2-3", char + FATHA))
    return out


def vowel_taps() -> list[Candidate]:
    out: list[Candidate] = []
    n = 0
    for ch in TAP_LETTERS:
        base = [ch + FATHA, ch + KASRA, ch + DAMMA]
        for answer, skill in enumerate(VOWEL_MARK):
            options, idx = _rotate(base, answer, n // 3)  # same layout per letter, so the answer moves
            out.append(Candidate("vowel_tap", (skill,), "2-3", options[idx], options, idx))
            n += 1
    for c1, c2 in SUKUN_PAIRS:
        head = c1 + FATHA + c2
        for skill, base in (
            ("vowel.sukun", [head + SUKUN, head + FATHA, head + DAMMA]),
            ("vowel.shadda", [head + SHADDA + FATHA, head + FATHA, head + SUKUN]),
        ):
            options, idx = _rotate(base, 0, n)
            out.append(Candidate("vowel_tap", (skill,), "2-3", options[idx], options, idx))
            n += 1
    for word in TANWIN_WORDS:
        base = [word + TANWIN_DAMM, word + TANWIN_KASR, word + TANWIN_FATH + "ا"]
        for answer in range(3):
            options, idx = _rotate(base, answer, n // 3)
            out.append(Candidate("vowel_tap", ("vowel.tanwin",), "2-3", options[idx], options, idx))
            n += 1
    return out


def pseudowords(lexicon: set[str]) -> list[Candidate]:
    """CVCVC (grades 2-3) and CVCCVC (grades 4-6) nonwords; consonants never repeat within a word."""
    rng = random.Random(PSEUDO_SEED)
    out: list[Candidate] = []
    seen: set[str] = set()
    for band, count in PSEUDO_COUNT.items():
        made = 0
        for _ in range(count * 50):
            if made == count:
                break
            n_cons = 3 if band == "2-3" else 4
            cons = rng.sample(PSEUDO_CONSONANTS, n_cons)
            vowels = [rng.choice((FATHA, KASRA, DAMMA)) for _ in range(n_cons)]
            if band == "2-3":
                word = cons[0] + vowels[0] + cons[1] + vowels[1] + cons[2]
            else:
                word = cons[0] + vowels[0] + cons[1] + SUKUN + cons[2] + vowels[2] + cons[3]
            plain = arabic.strip_diacritics(word)
            if plain in seen or plain in lexicon:
                continue
            seen.add(plain)
            out.append(Candidate("pseudoword", ("decode.pseudo",), band, word, source="generated:pseudoword"))
            made += 1
    return out


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def minimal_pairs(source_dir: Path) -> list[Candidate]:
    raw = _load(source_dir / "minimal_pairs.json")
    out = []
    for pair in raw["pairs"]:
        words = tuple(pair["words"])
        a, b = (arabic.split_letters(w) for w in words)
        diff = [i for i, (x, y) in enumerate(zip(a, b, strict=False)) if x != y]
        skill_ids: tuple[str, ...] = (pair["skill"],)
        if len(diff) == 1 and len(a) == len(b):  # otherwise the validator rejects it; do not guess a position
            i = diff[0]
            skill_ids += ("pos." + ("initial" if i == 0 else "final" if i == len(a) - 1 else "medial"),)
        for answer in range(2):
            out.append(
                Candidate(
                    "minimal_pair", skill_ids, pair["grade_band"], arabic.PAIR_SEPARATOR.join(words), words, answer,
                    source=raw["source"],
                )
            )
    return out


def real_words(source_dir: Path) -> list[Candidate]:
    raw = _load(source_dir / "real_words.json")
    return [
        Candidate("real_word", ("decode.real",), w["grade_band"], w["text"], source=raw["source"]) for w in raw["words"]
    ]


def passages(source_dir: Path) -> list[Candidate]:
    raw = _load(source_dir / "passages.json")
    return [
        Candidate(
            p["use"], ("fluency.passage",), p["grade_band"], p["text"], probe_only=p["use"] == "probe_passage",
            source=raw["source"],
        )
        for p in raw["passages"]
    ]


def lexicon(source_dir: Path) -> set[str]:
    """Undiacritized forms of every real word in the source lists."""
    known: set[str] = set()
    for c in real_words(source_dir) + minimal_pairs(source_dir) + passages(source_dir):
        for s in c.options or (c.text,):
            known.update(arabic.strip_diacritics(w) for w in arabic.words(s))
    known.update(arabic.strip_diacritics(w) for w in TANWIN_WORDS)
    blocklist = source_dir / "pseudoword_blocklist.json"
    if blocklist.is_file():
        known.update(arabic.strip_diacritics(w) for w in _load(blocklist)["real_words"])
    return known
