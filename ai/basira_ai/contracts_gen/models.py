# GENERATED from contracts/schemas/basira.schema.json by ai/scripts/gen_contracts.py - do not edit.

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel


class BasiraSharedContractsV010(RootModel[Any]):
    root: Any = Field(..., title='Basira shared contracts v0.1.0')
    """
    Single source of truth for every payload exchanged between workstream A (ai/, content/) and workstream B (web/, supabase/). Change only through a contracts PR approved by both.
    """


class SkillId(RootModel[str]):
    root: str = Field(
        ..., pattern='^(ls|dot|emph|vowel|pos|decode|fluency)\\.[a-z_-]+$'
    )
    """
    Must exist in contracts/skill-graph.json
    """


class ErrorCategory(
    RootModel[
        Literal[
            'dot_confusion',
            'emphatic_confusion',
            'short_vowel',
            'positional',
            'omission',
            'insertion',
            'substitution',
        ]
    ]
):
    root: Literal[
        'dot_confusion',
        'emphatic_confusion',
        'short_vowel',
        'positional',
        'omission',
        'insertion',
        'substitution',
    ]


class ReviewStatus(
    RootModel[Literal['draft', 'pending_review', 'approved', 'rejected', 'delivered']]
):
    root: Literal['draft', 'pending_review', 'approved', 'rejected', 'delivered']


class ItemType(
    RootModel[
        Literal[
            'letter_sound',
            'real_word',
            'pseudoword',
            'passage_vowelized',
            'passage_unvowelized',
            'probe_passage',
            'minimal_pair',
            'vowel_tap',
        ]
    ]
):
    root: Literal[
        'letter_sound',
        'real_word',
        'pseudoword',
        'passage_vowelized',
        'passage_unvowelized',
        'probe_passage',
        'minimal_pair',
        'vowel_tap',
    ]


class PhonemeResult(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    index: int = Field(..., ge=0)
    word_index: int = Field(..., ge=0)
    expected_letter: str | None = None
    """
    Letter id from taxonomy.json, null for a vowel-only unit
    """
    expected_ipa: str
    heard_ipa: str | None = None
    """
    Best competing phoneme the model heard; null on omission
    """
    score: float = Field(..., ge=0.0, le=1.0)
    """
    Goodness-of-pronunciation mapped to 0-1
    """
    status: Literal['correct', 'dialect_variant', 'error', 'unscored']
    error_category: ErrorCategory | None = None
    dialect_rule_id: str | None = None
    """
    Rule id from dialect-lexicons.json when status=dialect_variant
    """
    start_ms: int = Field(..., ge=0)
    end_ms: int = Field(..., ge=0)


class SkillEvidence(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    skill_id: SkillId
    correct: bool
    source: Literal['audio', 'tap', 'probe']


class ScoreItemRequestMeta(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    item_id: str
    item_type: ItemType
    expected_text: str = Field(..., min_length=1)
    """
    Fully diacritized Arabic target text
    """
    dialect_lexicon_id: str
    """
    Lexicon id from dialect-lexicons.json, e.g. kw or msa
    """


class Word(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    index: int = Field(..., ge=0)
    text: str
    correct: bool
    """
    true when every phoneme is correct or dialect_variant
    """


class ScoreItemResponse(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    item_id: str
    item_type: ItemType
    model_version: str
    synthetic: bool
    """
    true when the audio is TTS/synthetic or a fixture; must be shown wherever the result is shown
    """
    audio_duration_ms: int = Field(..., ge=0)
    words: list[Word]
    phonemes: list[PhonemeResult]
    skill_evidence: list[SkillEvidence]
    wcpm: float | None = None
    """
    Words correct per minute; passages only
    """
    warnings: list[
        Literal[
            'low_audio_level',
            'clipped_audio',
            'too_short',
            'too_long',
            'no_speech_detected',
        ]
    ]


class FingerprintRequest(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: str
    grade: int = Field(..., ge=1, le=6)
    duration_ms: int = Field(..., ge=0)
    items: list[ScoreItemResponse]
    tap_results: list[SkillEvidence]
    """
    Short-vowel and discrimination tap tasks recorded by the web app
    """


class Features(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    dot_confusion_rate: float | None = None
    emphatic_confusion_rate: float | None = None
    short_vowel_error_rate: float | None = None
    """
    From tap_results only
    """
    positional_error_rate: float | None = None
    omission_rate: float | None = None
    insertion_rate: float | None = None
    substitution_rate: float | None = None
    wcpm: float | None = None
    self_correction_rate: float | None = None
    pseudoword_gap: float | None = None
    """
    real-word accuracy minus pseudoword accuracy
    """
    vowelization_gap: float | None = None
    """
    vowelized minus unvowelized passage accuracy
    """


class RulesFiredItem(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    rule_id: str
    text_en: str
    text_ar: str


class Referral(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    decision: Literal[
        'no_referral_indicated',
        'refer_for_specialist_assessment',
        'specialist_decision_needed',
    ]
    rules_fired: list[RulesFiredItem]


class FingerprintResponse(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: str
    model_version: str
    rules_version: str
    synthetic: bool
    features: Features
    referral: Referral
    review_status: Literal['pending_review']
    """
    Every fingerprint starts pending; only a specialist approves (enforced in the database)
    """


class ProbeRequest(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: str
    practised: list[ScoreItemResponse]
    unseen: list[ScoreItemResponse]


class PerSkillItem(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    skill_id: SkillId
    practised_accuracy: float | None = None
    unseen_accuracy: float | None = None
    n_practised: int = Field(..., ge=0)
    n_unseen: int = Field(..., ge=0)
    transfer: Literal['transfer_shown', 'no_transfer_yet', 'insufficient_data']


class ProbeResponse(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    session_id: str
    model_version: str
    synthetic: bool
    per_skill: list[PerSkillItem]


class Stage0Construct(
    RootModel[
        Literal[
            'itpa',
            'reversal',
            'nonverbal_iq',
            'visual_agnosia',
            'dyscalculia',
            'phonological_awareness',
            'reading_fluency',
        ]
    ]
):
    root: Literal[
        'itpa',
        'reversal',
        'nonverbal_iq',
        'visual_agnosia',
        'dyscalculia',
        'phonological_awareness',
        'reading_fluency',
    ]


class Response(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    item_id: str
    response: str | float | bool
    time_ms: int | None = Field(None, ge=0)


class Stage0ScoreRequest(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    construct_: Stage0Construct = Field(..., alias='construct')
    instrument_id: str
    child_age_months: int = Field(..., ge=60, le=160)
    grade: int = Field(..., ge=1, le=6)
    responses: list[Response]


class Stage0ScoreResponse(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    construct_: Stage0Construct = Field(..., alias='construct')
    instrument_id: str
    licence_status: Literal['licensed', 'public_domain', 'license_pending']
    raw_score: float | None = None
    scaled_score: float | None = None
    """
    Always null when licence_status=license_pending or no norms are available
    """
    norm_source: str | None = None
    note_en: str
    scorer_version: str
    synthetic: bool


class Health(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    status: Literal['ok', 'warming', 'degraded']
    model_loaded: bool
    model_version: str
    rules_version: str
    contracts_version: str


class Error1(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    code: Literal[
        'unauthorized',
        'forbidden',
        'invalid_request',
        'audio_invalid',
        'rate_limited',
        'model_unavailable',
        'internal',
    ]
    message: str


class Error(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    error: Error1


class Validation(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    passed: Literal[True]
    """
    Items that fail validation are discarded, never shipped
    """
    validators: list[str]


class Review(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    status: Literal['unreviewed', 'approved', 'rejected']
    reviewer: str | None = None


class Item(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: str
    type: ItemType
    skill_ids: list[SkillId] = Field(..., min_length=1)
    grade_band: Literal['2-3', '4-6']
    text: str
    """
    Fully diacritized
    """
    text_plain: str
    """
    Without diacritics
    """
    audio_path: str | None = None
    """
    Relative to the item-bank folder
    """
    options: list[str]
    """
    Tap tasks and minimal pairs only
    """
    answer_index: int | None = Field(..., ge=0)
    probe_only: bool
    """
    true: never used in practice, only in unseen-passage probes
    """
    validation: Validation
    review: Review


class PractisedItem(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    skill_id: SkillId
    plain_ar: str


class ProgressNote(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    skill_id: SkillId
    note_ar: str


class HomePlanItem(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    title_ar: str
    minutes: int = Field(..., ge=5, le=10)
    words: list[str]
    how_ar: str


class Specialist(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    name: str
    contact: str


class ParentReport(BaseModel):
    """
    Deliberately has no field that can carry a score, a risk level or a label (non-negotiable 2).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    language: Literal['ar']
    child_first_name: str
    session_date: date
    duration_min: int = Field(..., ge=0)
    practised: list[PractisedItem]
    progress_notes: list[ProgressNote]
    home_plan: list[HomePlanItem] = Field(..., max_length=3, min_length=1)
    next_focus_ar: str
    specialist: Specialist


class ItemBank(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    version: str
    generated_at: datetime
    synthetic_audio: bool
    """
    true: item audio is TTS
    """
    items: list[Item]
