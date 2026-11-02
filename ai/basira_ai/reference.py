"""Read-only access to the shared reference data in contracts/: taxonomy, skill graph, dialect lexicons.

The files are read at runtime from the contracts folder (never copied into ai/), so a contracts PR is the only way
to change them. Location: env var BASIRA_CONTRACTS_DIR, else the repo's contracts/ folder next to ai/.
Cross-references are checked on load; a broken reference raises ReferenceDataError instead of failing later.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path


class ReferenceDataError(ValueError):
    """The contracts folder is missing a file or contains an inconsistent reference."""


def contracts_dir() -> Path:
    env = os.environ.get("BASIRA_CONTRACTS_DIR")
    path = Path(env) if env else Path(__file__).resolve().parents[2] / "contracts"
    if not (path / "taxonomy.json").is_file():
        raise ReferenceDataError(f"contracts folder not found at {path} (set BASIRA_CONTRACTS_DIR)")
    return path


# ---------------------------------------------------------------- taxonomy


@dataclass(frozen=True)
class Letter:
    id: str
    char: str
    ipa: str
    name_en: str
    name_ar: str
    emphatic: bool


@dataclass(frozen=True)
class DotGroup:
    id: str
    letters: tuple[str, ...]


@dataclass(frozen=True)
class EmphaticPair:
    id: str
    emphatic: str
    plain: str


@dataclass(frozen=True)
class Taxonomy:
    version: str
    letters: dict[str, Letter]
    dot_groups: tuple[DotGroup, ...]
    emphatic_pairs: tuple[EmphaticPair, ...]
    short_vowel_ids: tuple[str, ...]
    error_category_ids: tuple[str, ...]
    _by_char: dict[str, Letter] = field(repr=False, default_factory=dict)
    _dot_group_of: dict[str, DotGroup] = field(repr=False, default_factory=dict)
    _pair_of: dict[frozenset[str], EmphaticPair] = field(repr=False, default_factory=dict)

    def letter(self, letter_id: str) -> Letter:
        try:
            return self.letters[letter_id]
        except KeyError:
            raise KeyError(f"unknown letter id {letter_id!r}") from None

    def letter_by_char(self, char: str) -> Letter | None:
        return self._by_char.get(char)

    def letter_by_ipa(self, ipa: str) -> Letter | None:
        return next((letter for letter in self.letters.values() if letter.ipa == ipa), None)

    def dot_group_of(self, letter_id: str) -> DotGroup | None:
        return self._dot_group_of.get(letter_id)

    def is_dot_confusion(self, expected: str, produced: str) -> bool:
        """Different letters that share a skeleton (same dot group)."""
        group = self._dot_group_of.get(expected)
        return expected != produced and group is not None and produced in group.letters

    def emphatic_pair_of(self, a: str, b: str) -> EmphaticPair | None:
        return self._pair_of.get(frozenset((a, b)))

    def is_emphatic_confusion(self, expected: str, produced: str) -> bool:
        return expected != produced and self.emphatic_pair_of(expected, produced) is not None


# ---------------------------------------------------------------- skill graph


@dataclass(frozen=True)
class Skill:
    id: str
    type: str
    label_en: str
    label_ar: str
    letters: tuple[str, ...]
    prerequisites: tuple[str, ...]
    evidence: tuple[str, ...]


@dataclass(frozen=True)
class SkillGraph:
    version: str
    skills: dict[str, Skill]

    def __contains__(self, skill_id: str) -> bool:
        return skill_id in self.skills

    def letter_sound(self, letter_id: str) -> str:
        return self._require(f"ls.{letter_id}")

    def dot_discrimination(self, group: DotGroup) -> str:
        return self._require(group.id)

    def emphatic_contrast(self, pair: EmphaticPair) -> str:
        return self._require(pair.id)

    def positional(self, position: str) -> str:
        return self._require(f"pos.{position}")

    def _require(self, skill_id: str) -> str:
        if skill_id not in self.skills:
            raise KeyError(f"skill {skill_id!r} is not in contracts/skill-graph.json")
        return skill_id


# ---------------------------------------------------------------- dialect lexicons


@dataclass(frozen=True)
class DialectRule:
    id: str
    letter: str
    msa_ipa: str
    accepted_ipa: str
    context: str
    confirmed: bool


@dataclass(frozen=True)
class Lexicon:
    id: str
    label_en: str
    label_ar: str
    rules: tuple[DialectRule, ...]

    def accepted_variant(self, letter_id: str, heard_ipa: str) -> DialectRule | None:
        """The rule that makes `heard_ipa` an accepted dialect pronunciation of `letter_id`, if any."""
        return next((r for r in self.rules if r.letter == letter_id and r.accepted_ipa == heard_ipa), None)


@dataclass(frozen=True)
class DialectLexicons:
    version: str
    lexicons: dict[str, Lexicon]

    def get(self, lexicon_id: str) -> Lexicon:
        try:
            return self.lexicons[lexicon_id]
        except KeyError:
            raise KeyError(f"unknown dialect lexicon {lexicon_id!r}; known: {sorted(self.lexicons)}") from None


# ---------------------------------------------------------------- loading


@dataclass(frozen=True)
class ReferenceData:
    taxonomy: Taxonomy
    skills: SkillGraph
    lexicons: DialectLexicons


def _read(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ReferenceDataError(f"missing contracts file {path.name}") from None
    except json.JSONDecodeError as e:
        raise ReferenceDataError(f"{path.name} is not valid JSON: {e}") from None


def _build_taxonomy(raw: dict) -> Taxonomy:
    letters = {
        x["id"]: Letter(x["id"], x["char"], x["ipa"], x["name_en"], x["name_ar"], x["emphatic"]) for x in raw["letters"]
    }
    groups = tuple(DotGroup(g["id"], tuple(g["letters"])) for g in raw["dot_groups"])
    pairs = tuple(EmphaticPair(p["id"], p["emphatic"], p["plain"]) for p in raw["emphatic_pairs"])
    dot_group_of: dict[str, DotGroup] = {}
    for g in groups:
        for letter_id in g.letters:
            if letter_id not in letters:
                raise ReferenceDataError(f"taxonomy: dot group {g.id} names unknown letter {letter_id}")
            if letter_id in dot_group_of:
                raise ReferenceDataError(f"taxonomy: letter {letter_id} is in two dot groups")
            dot_group_of[letter_id] = g
    for p in pairs:
        for letter_id in (p.emphatic, p.plain):
            if letter_id not in letters:
                raise ReferenceDataError(f"taxonomy: emphatic pair {p.id} names unknown letter {letter_id}")
    return Taxonomy(
        version=raw["version"],
        letters=letters,
        dot_groups=groups,
        emphatic_pairs=pairs,
        short_vowel_ids=tuple(v["id"] for v in raw["short_vowels"]),
        error_category_ids=tuple(c["id"] for c in raw["error_categories"]),
        _by_char={letter.char: letter for letter in letters.values()},
        _dot_group_of=dot_group_of,
        _pair_of={frozenset((p.emphatic, p.plain)): p for p in pairs},
    )


def _build_skills(raw: dict, taxonomy: Taxonomy) -> SkillGraph:
    skills = {
        s["id"]: Skill(
            s["id"],
            s["type"],
            s["label_en"],
            s["label_ar"],
            tuple(s["letters"]),
            tuple(s["prerequisites"]),
            tuple(s["evidence"]),
        )
        for s in raw["skills"]
    }
    for s in skills.values():
        for p in s.prerequisites:
            if p not in skills:
                raise ReferenceDataError(f"skill-graph: {s.id} has unknown prerequisite {p}")
        for letter_id in s.letters:
            if letter_id not in taxonomy.letters:
                raise ReferenceDataError(f"skill-graph: {s.id} names unknown letter {letter_id}")
    graph = SkillGraph(raw["version"], skills)
    # every taxonomy entry the scorer can produce evidence for must have a skill
    for letter_id in taxonomy.letters:
        _must(graph, f"ls.{letter_id}")
    for g in taxonomy.dot_groups:
        _must(graph, g.id)
    for p in taxonomy.emphatic_pairs:
        _must(graph, p.id)
    return graph


def _must(graph: SkillGraph, skill_id: str) -> None:
    if skill_id not in graph:
        raise ReferenceDataError(f"skill-graph: missing skill {skill_id} required by the taxonomy")


def _build_lexicons(raw: dict, taxonomy: Taxonomy) -> DialectLexicons:
    lexicons = {}
    for lx in raw["lexicons"]:
        rules = []
        for r in lx["rules"]:
            letter = taxonomy.letters.get(r["letter"])
            if letter is None:
                raise ReferenceDataError(f"dialect-lexicons: {r['id']} names unknown letter {r['letter']}")
            if r["msa_ipa"] != letter.ipa:
                raise ReferenceDataError(
                    f"dialect-lexicons: {r['id']} msa_ipa {r['msa_ipa']!r} != taxonomy ipa {letter.ipa!r}"
                )
            rules.append(
                DialectRule(r["id"], r["letter"], r["msa_ipa"], r["accepted_ipa"], r["context"], r["confirmed"])
            )
        lexicons[lx["id"]] = Lexicon(lx["id"], lx["label_en"], lx["label_ar"], tuple(rules))
    return DialectLexicons(raw["version"], lexicons)


def load_reference_data(path: Path | None = None) -> ReferenceData:
    """Load and cross-check the reference data. Use `reference_data()` for the cached default."""
    root = path or contracts_dir()
    taxonomy = _build_taxonomy(_read(root / "taxonomy.json"))
    skills = _build_skills(_read(root / "skill-graph.json"), taxonomy)
    lexicons = _build_lexicons(_read(root / "dialect-lexicons.json"), taxonomy)
    return ReferenceData(taxonomy, skills, lexicons)


@lru_cache(maxsize=1)
def reference_data() -> ReferenceData:
    return load_reference_data()
