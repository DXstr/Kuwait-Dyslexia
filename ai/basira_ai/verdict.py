"""Turn per-sound evidence into the contract's ScoreItemResponse (tasks A4 + A5).

Per consonant (in this order):
  1. heard the expected sound                              -> status "correct"
  2. heard a variant the child's dialect lexicon accepts   -> status "dialect_variant" + rule id   (A4)
  3. otherwise                                              -> status "error" with a category       (A5)
       same dot group -> dot_confusion · emphatic partner -> emphatic_confusion · anything else -> substitution
Vowels are always "unscored": short-vowel errors are never inferred from audio (claims table, ADR-002).

Not detected yet (stated, not faked): omissions and insertions. A free-decoding comparison was tried in the
notebooks and drops real sounds (it missed both [j]s in "dayay"), so thresholds must be calibrated on real recordings
first (docs/ROADMAP.md, phase 3; issue #32). Until then a missing sound shows up as a low-scoring unit, never as a
category.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from basira_ai import __version__
from basira_ai.contracts_gen import ScoreItemRequestMeta, ScoreItemResponse
from basira_ai.g2p import Unit
from basira_ai.pronunciation import UnitEvidence, routing
from basira_ai.reference import ReferenceData

MIN_MS, MAX_MS = 300, 15_000
LOW_RMS = 0.01
CLIP_LEVEL, CLIP_FRACTION = 0.999, 0.001
DECODING_ITEMS = {"real_word": "decode.real", "pseudoword": "decode.pseudo"}
PASSAGES = {"passage_vowelized", "passage_unvowelized", "probe_passage"}


def model_version() -> str:
    r = routing()
    return f"basira-ai {__version__}; routing {r['version']}; {r['phone_model']['id']}; {r['letter_model']['id']}"


def audio_warnings(wav: np.ndarray, sample_rate: int = 16_000) -> list[str]:
    """Quality warnings for a recording (contract enum values)."""
    warnings: list[str] = []
    duration_ms = 1000 * len(wav) / sample_rate
    if duration_ms < MIN_MS:
        warnings.append("too_short")
    if duration_ms > MAX_MS:
        warnings.append("too_long")
    if len(wav):
        if float(np.sqrt(np.mean(np.square(wav)))) < LOW_RMS:
            warnings.append("low_audio_level")
        if float(np.mean(np.abs(wav) >= CLIP_LEVEL)) > CLIP_FRACTION:
            warnings.append("clipped_audio")
    return warnings


def _status(ev: UnitEvidence, ref: ReferenceData, lexicon_id: str) -> tuple[str, str | None, str | None]:
    """(status, error_category, dialect_rule_id) for one consonant."""
    unit = ev.unit
    if ev.winner_ipa == unit.ipa:
        return "correct", None, None
    rule = ref.lexicons.get(lexicon_id).accepted_variant(unit.letter, ev.winner_ipa)
    if rule is not None:
        return "dialect_variant", None, rule.id
    if ev.winner_letter is not None:
        if ref.taxonomy.is_dot_confusion(unit.letter, ev.winner_letter):
            return "error", "dot_confusion", None
        if ref.taxonomy.is_emphatic_confusion(unit.letter, ev.winner_letter):
            return "error", "emphatic_confusion", None
    return "error", "substitution", None


def _skill_evidence(units_status: list[tuple[UnitEvidence, str, str | None]], ref: ReferenceData) -> list[dict]:
    tax, skills = ref.taxonomy, ref.skills
    out: list[dict] = []
    for ev, status, category in units_status:
        unit = ev.unit
        ok = status in ("correct", "dialect_variant")
        out.append({"skill_id": skills.letter_sound(unit.letter), "correct": ok, "source": "audio"})
        group = tax.dot_group_of(unit.letter)
        if group is not None and category in (None, "dot_confusion"):
            out.append({"skill_id": skills.dot_discrimination(group), "correct": category is None, "source": "audio"})
        pair = next((p for p in tax.emphatic_pairs if unit.letter in (p.emphatic, p.plain)), None)
        if pair is not None and not ev.degraded and category in (None, "emphatic_confusion"):
            out.append({"skill_id": skills.emphatic_contrast(pair), "correct": category is None, "source": "audio"})
        if unit.position in ("initial", "medial", "final"):
            out.append({"skill_id": skills.positional(unit.position), "correct": ok, "source": "audio"})
    return out


def build_response(
    meta: ScoreItemRequestMeta,
    units: Sequence[Unit],
    evidence: Sequence[UnitEvidence],
    ref: ReferenceData,
    *,
    audio_duration_ms: int,
    synthetic: bool,
    warnings: Sequence[str] = (),
) -> ScoreItemResponse:
    ref.lexicons.get(meta.dialect_lexicon_id)  # unknown lexicon -> KeyError (service maps to 422)
    item_type = getattr(meta.item_type, "root", meta.item_type)  # generated enum wrapper -> plain string
    words = meta.expected_text.split()
    phonemes: list[dict] = []
    consonant_status: list[tuple[UnitEvidence, str, str | None]] = []
    word_ok = [True] * len(words)

    for ev in evidence:
        unit = ev.unit
        base = {
            "index": unit.index,
            "word_index": unit.word_index,
            "expected_ipa": unit.ipa,
            "score": float(min(1.0, max(0.0, ev.score))),
            "start_ms": ev.span.start_ms,
            "end_ms": ev.span.end_ms,
        }
        if unit.kind == "vowel":
            phonemes.append(
                base
                | {"expected_letter": None, "heard_ipa": None, "status": "unscored", "error_category": None,
                   "dialect_rule_id": None}
            )
            continue
        status, category, rule_id = _status(ev, ref, meta.dialect_lexicon_id)
        consonant_status.append((ev, status, category))
        if status == "error":
            word_ok[unit.word_index] = False
        phonemes.append(
            base
            | {"expected_letter": unit.letter, "heard_ipa": ev.winner_ipa, "status": status,
               "error_category": category, "dialect_rule_id": rule_id}
        )

    skill_evidence = _skill_evidence(consonant_status, ref)
    decoding_skill = DECODING_ITEMS.get(item_type)
    if decoding_skill:
        skill_evidence += [{"skill_id": decoding_skill, "correct": ok, "source": "audio"} for ok in word_ok]

    wcpm = None
    if item_type in PASSAGES and audio_duration_ms > 0:
        wcpm = round(sum(word_ok) / (audio_duration_ms / 60_000), 1)

    return ScoreItemResponse.model_validate(
        {
            "item_id": meta.item_id,
            "item_type": item_type,
            "model_version": model_version(),
            "synthetic": synthetic,
            "audio_duration_ms": audio_duration_ms,
            "words": [{"index": i, "text": w, "correct": word_ok[i]} for i, w in enumerate(words)],
            "phonemes": phonemes,
            "skill_evidence": skill_evidence,
            "wcpm": wcpm,
            "warnings": list(dict.fromkeys(warnings)),
        }
    )
