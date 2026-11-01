"""Per-sound pronunciation evidence: for each expected sound, which candidate did the reader most likely produce?

Inputs are CTC log-posteriors from the two acoustic models (ADR-002), so this module is tested without loading them.
For every expected consonant the candidates are: the expected sound, its dot-group mates, its emphatic partner, every
dialect variant listed for that letter in any lexicon, and the extra competitors in data/routing.json (e.g. Cairene
[ʔ] for ق). Each (expected, candidate) comparison runs on the model the routing table assigns.

Scores are the expected sound's probability within its candidate set (0-1, higher = more clearly the expected sound).
This module does not decide correct / dialect / error; that is A4/A5, which read this evidence.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from importlib import resources

import numpy as np

from basira_ai.align import Span, ctc_align
from basira_ai.g2p import Unit, written_letters
from basira_ai.reference import ReferenceData

VOWEL_SETS = {"a": "aiu", "i": "aiu", "u": "aiu"}


@dataclass(frozen=True)
class AcousticOutput:
    """Frame-level log-posteriors from one CTC model."""

    log_probs: np.ndarray  # (frames, vocab), natural log
    vocab: dict[str, int]
    blank: int


@dataclass(frozen=True)
class Candidate:
    ipa: str  # canonical IPA (contract spelling, e.g. "g")
    letter: str | None  # taxonomy letter id when the candidate is a letter's MSA sound
    model: str  # "phone" | "letter"
    prob: float  # probability within its model's candidate set


@dataclass(frozen=True)
class UnitEvidence:
    unit: Unit
    span: Span  # phone-model frames for this unit
    score: float  # probability of the expected sound (0-1)
    winner_ipa: str  # canonical IPA of the most likely candidate
    winner_letter: str | None
    decided_by: str  # model whose evidence decided the winner
    candidates: tuple[Candidate, ...] = field(default=())
    degraded: bool = False  # True when a letter-model contrast had to fall back to the phone model


@lru_cache(maxsize=1)
def routing() -> dict:
    return json.loads(resources.files("basira_ai").joinpath("data/routing.json").read_text(encoding="utf-8"))


def missing_phone_tokens(vocab: dict[str, int]) -> list[str]:
    """Routing tokens absent from a phone-model vocabulary (should be empty for the configured model)."""
    return sorted({tok for tok in routing()["phone_model"]["tokens"].values() if tok not in vocab})


def _candidates_for(letter_id: str, ref: ReferenceData) -> list[tuple[str, str | None]]:
    """(canonical ipa, letter id or None) competitors for an expected letter, excluding the expected sound."""
    tax = ref.taxonomy
    expected_ipa = tax.letter(letter_id).ipa
    out: dict[str, str | None] = {}
    group = tax.dot_group_of(letter_id)
    for mate in group.letters if group else ():
        if mate != letter_id:
            out[tax.letter(mate).ipa] = mate
    for pair in tax.emphatic_pairs:
        if letter_id in (pair.emphatic, pair.plain):
            mate = pair.plain if letter_id == pair.emphatic else pair.emphatic
            out[tax.letter(mate).ipa] = mate
    for lexicon in ref.lexicons.lexicons.values():
        for rule in lexicon.rules:
            if rule.letter == letter_id:
                out.setdefault(rule.accepted_ipa, None)
    for ipa in routing()["extra_competitors"].get(letter_id, []):
        out.setdefault(ipa, tax.letter_by_ipa(ipa).id if tax.letter_by_ipa(ipa) else None)
    out.pop(expected_ipa, None)
    return list(out.items())


def _letter_routed(a: str, b: str | None) -> bool:
    return b is not None and any({a, b} == set(p) for p in routing()["letter_model_pairs"])


def _softmax(values: dict[str, float]) -> dict[str, float]:
    keys = list(values)
    arr = np.array([values[k] for k in keys])
    arr = np.exp(arr - arr.max())
    arr /= arr.sum()
    return dict(zip(keys, arr.tolist(), strict=True))


def _mean_lp(out: AcousticOutput, span: Span, token: str) -> float:
    return float(np.mean(out.log_probs[span.start : span.end, out.vocab[token]]))


def _letter_alignment(text: str, out: AcousticOutput) -> dict[int, Span]:
    """Align the written letters (plus word delimiters) with the letter model; map char_index -> span."""
    delim = routing()["letter_model"]["word_delimiter"]
    targets: list[int] = []
    owners: list[int | None] = []
    prev_word = None
    for c_idx, (w_idx, ch) in enumerate(written_letters(text)):
        if prev_word is not None and w_idx != prev_word and delim in out.vocab:
            targets.append(out.vocab[delim])
            owners.append(None)
        prev_word = w_idx
        if ch in out.vocab:
            targets.append(out.vocab[ch])
            owners.append(c_idx)
    spans = ctc_align(out.log_probs, targets, out.blank)
    return {owner: span for owner, span in zip(owners, spans, strict=True) if owner is not None}


def score_pronunciation(
    text: str,
    units: list[Unit],
    phone: AcousticOutput,
    letter: AcousticOutput | None,
    ref: ReferenceData,
) -> list[UnitEvidence]:
    tokens = routing()["phone_model"]["tokens"]
    targets = [phone.vocab[tokens[u.ipa]] for u in units]
    spans = ctc_align(phone.log_probs, targets, phone.blank)
    letter_spans = _letter_alignment(text, letter) if letter is not None else {}

    evidence: list[UnitEvidence] = []
    for unit, span in zip(units, spans, strict=True):
        if unit.kind == "vowel":
            evidence.append(_score_vowel(unit, span, phone, tokens))
            continue
        competitors = _candidates_for(unit.letter, ref)
        by_model: dict[str, dict[str, float]] = {"phone": {unit.ipa: _mean_lp(phone, span, tokens[unit.ipa])}}
        letters_of: dict[str, str | None] = {unit.ipa: unit.letter}
        degraded = False
        for ipa, cand_letter in competitors:
            letters_of[ipa] = cand_letter
            use_letter_model = _letter_routed(unit.letter, cand_letter)
            if use_letter_model and letter is not None and unit.char_index in letter_spans:
                ch_exp = ref.taxonomy.letter(unit.letter).char
                ch_cand = ref.taxonomy.letter(cand_letter).char
                if ch_exp in letter.vocab and ch_cand in letter.vocab:
                    lspan = letter_spans[unit.char_index]
                    bucket = by_model.setdefault("letter", {unit.ipa: _mean_lp(letter, lspan, ch_exp)})
                    bucket[ipa] = _mean_lp(letter, lspan, ch_cand)
                    continue
            if use_letter_model:
                degraded = True
            tok = tokens.get(ipa)
            if tok is None or tok == tokens[unit.ipa] or tok not in phone.vocab:
                continue  # indistinguishable in the phone model (e.g. emphatic vs plain): skip, never guess
            by_model["phone"][ipa] = _mean_lp(phone, span, tok)

        probs = {m: _softmax(v) for m, v in by_model.items()}
        winner, decided_by, margin = unit.ipa, "phone", -1.0
        score = min(p[unit.ipa] for p in probs.values())
        for m, p in probs.items():
            best = max((k for k in p if k != unit.ipa), key=p.get, default=None)
            if best is not None and p[best] - p[unit.ipa] > max(margin, 0.0):
                winner, decided_by, margin = best, m, p[best] - p[unit.ipa]
                score = p[unit.ipa]
        if winner == unit.ipa:
            decided_by = min(probs, key=lambda m: probs[m][unit.ipa])
        candidates = tuple(
            Candidate(ipa, letters_of.get(ipa), m, round(prob, 4))
            for m, p in probs.items()
            for ipa, prob in sorted(p.items(), key=lambda kv: -kv[1])
        )
        evidence.append(
            UnitEvidence(unit, span, round(score, 4), winner, letters_of.get(winner), decided_by, candidates, degraded)
        )
    return evidence


def _score_vowel(unit: Unit, span: Span, phone: AcousticOutput, tokens: dict[str, str]) -> UnitEvidence:
    short = unit.ipa[0]
    long_ = unit.ipa.endswith("ː")
    options = {v + ("ː" if long_ else "") for v in VOWEL_SETS[short]}
    lps = {ipa: _mean_lp(phone, span, tokens[ipa]) for ipa in options if tokens.get(ipa) in phone.vocab}
    p = _softmax(lps)
    winner = max(p, key=p.get)
    ranked = sorted(p.items(), key=lambda kv: -kv[1])
    cands = tuple(Candidate(ipa, None, "phone", round(prob, 4)) for ipa, prob in ranked)
    return UnitEvidence(unit, span, round(p[unit.ipa], 4), winner, None, "phone", cands)
