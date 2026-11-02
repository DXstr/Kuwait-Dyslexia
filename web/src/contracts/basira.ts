/**
 * GENERATED FILE — DO NOT EDIT.
 * Source: contracts/schemas/basira.schema.json
 * Source SHA-256: 2094a38cb5aee20862fff5204bfcfe04908b14cf65f9abf331b01a723543e655
 * Generator: json-schema-to-typescript (version pinned in package-lock.json).
 * Regenerate from web/: npm run generate:contracts
 * These types are not runtime validation or database authorization.
 */

/**
 * Must exist in contracts/skill-graph.json
 *
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "SkillId".
 */
export type SkillId = string
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "ErrorCategory".
 */
export type ErrorCategory =
  | 'dot_confusion'
  | 'emphatic_confusion'
  | 'short_vowel'
  | 'positional'
  | 'omission'
  | 'insertion'
  | 'substitution'
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "ReviewStatus".
 */
export type ReviewStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'delivered'
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "ItemType".
 */
export type ItemType =
  | 'letter_sound'
  | 'real_word'
  | 'pseudoword'
  | 'passage_vowelized'
  | 'passage_unvowelized'
  | 'probe_passage'
  | 'minimal_pair'
  | 'vowel_tap'
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "Stage0Construct".
 */
export type Stage0Construct =
  | 'itpa'
  | 'reversal'
  | 'nonverbal_iq'
  | 'visual_agnosia'
  | 'dyscalculia'
  | 'phonological_awareness'
  | 'reading_fluency'

/**
 * Single source of truth for every payload exchanged between workstream A (ai/, content/) and workstream B (web/, supabase/). Change only through a contracts PR approved by both.
 */
export interface BasiraSharedContractsV010 {
  [k: string]: unknown
}
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "PhonemeResult".
 */
export interface PhonemeResult {
  index: number
  word_index: number
  /**
   * Letter id from taxonomy.json, null for a vowel-only unit
   */
  expected_letter: string | null
  expected_ipa: string
  /**
   * Best competing phoneme the model heard; null on omission
   */
  heard_ipa: string | null
  /**
   * Goodness-of-pronunciation mapped to 0-1
   */
  score: number
  status: 'correct' | 'dialect_variant' | 'error' | 'unscored'
  error_category: ErrorCategory | null
  /**
   * Rule id from dialect-lexicons.json when status=dialect_variant
   */
  dialect_rule_id: string | null
  start_ms: number
  end_ms: number
}
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "SkillEvidence".
 */
export interface SkillEvidence {
  skill_id: SkillId
  correct: boolean
  source: 'audio' | 'tap' | 'probe'
}
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "ScoreItemRequestMeta".
 */
export interface ScoreItemRequestMeta {
  item_id: string
  item_type: ItemType
  /**
   * Fully diacritized Arabic target text
   */
  expected_text: string
  /**
   * Lexicon id from dialect-lexicons.json, e.g. kw or msa
   */
  dialect_lexicon_id: string
}
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "ScoreItemResponse".
 */
export interface ScoreItemResponse {
  item_id: string
  item_type: ItemType
  model_version: string
  /**
   * true when the audio is TTS/synthetic or a fixture; must be shown wherever the result is shown
   */
  synthetic: boolean
  audio_duration_ms: number
  words: {
    index: number
    text: string
    /**
     * true when every phoneme is correct or dialect_variant
     */
    correct: boolean
  }[]
  phonemes: PhonemeResult[]
  skill_evidence: SkillEvidence[]
  /**
   * Words correct per minute; passages only
   */
  wcpm?: number | null
  warnings: (
    'low_audio_level' | 'clipped_audio' | 'too_short' | 'too_long' | 'no_speech_detected'
  )[]
}
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "FingerprintRequest".
 */
export interface FingerprintRequest {
  session_id: string
  grade: number
  duration_ms: number
  items: ScoreItemResponse[]
  /**
   * Short-vowel and discrimination tap tasks recorded by the web app
   */
  tap_results: SkillEvidence[]
}
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "FingerprintResponse".
 */
export interface FingerprintResponse {
  session_id: string
  model_version: string
  rules_version: string
  synthetic: boolean
  features: {
    dot_confusion_rate: number | null
    emphatic_confusion_rate: number | null
    /**
     * From tap_results only
     */
    short_vowel_error_rate: number | null
    positional_error_rate: number | null
    omission_rate: number | null
    insertion_rate: number | null
    substitution_rate: number | null
    wcpm: number | null
    self_correction_rate: number | null
    /**
     * real-word accuracy minus pseudoword accuracy
     */
    pseudoword_gap: number | null
    /**
     * vowelized minus unvowelized passage accuracy
     */
    vowelization_gap: number | null
  }
  referral: {
    decision:
      'no_referral_indicated' | 'refer_for_specialist_assessment' | 'specialist_decision_needed'
    rules_fired: {
      rule_id: string
      text_en: string
      text_ar: string
    }[]
  }
  /**
   * Every fingerprint starts pending; only a specialist approves (enforced in the database)
   */
  review_status: 'pending_review'
}
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "ProbeRequest".
 */
export interface ProbeRequest {
  session_id: string
  practised: ScoreItemResponse[]
  unseen: ScoreItemResponse[]
}
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "ProbeResponse".
 */
export interface ProbeResponse {
  session_id: string
  model_version: string
  synthetic: boolean
  per_skill: {
    skill_id: SkillId
    practised_accuracy: number | null
    unseen_accuracy: number | null
    n_practised: number
    n_unseen: number
    transfer: 'transfer_shown' | 'no_transfer_yet' | 'insufficient_data'
  }[]
}
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "Stage0ScoreRequest".
 */
export interface Stage0ScoreRequest {
  construct: Stage0Construct
  instrument_id: string
  child_age_months: number
  grade: number
  responses: {
    item_id: string
    response: string | number | boolean
    time_ms?: number
  }[]
}
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "Stage0ScoreResponse".
 */
export interface Stage0ScoreResponse {
  construct: Stage0Construct
  instrument_id: string
  licence_status: 'licensed' | 'public_domain' | 'license_pending'
  raw_score: number | null
  /**
   * Always null when licence_status=license_pending or no norms are available
   */
  scaled_score: number | null
  norm_source: string | null
  note_en: string
  scorer_version: string
  synthetic: boolean
}
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "Health".
 */
export interface Health {
  status: 'ok' | 'warming' | 'degraded'
  model_loaded: boolean
  model_version: string
  rules_version: string
  contracts_version: string
}
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "Error".
 */
export interface Error {
  error: {
    code:
      | 'unauthorized'
      | 'forbidden'
      | 'invalid_request'
      | 'audio_invalid'
      | 'rate_limited'
      | 'model_unavailable'
      | 'internal'
    message: string
  }
}
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "ItemBank".
 */
export interface ItemBank {
  version: string
  generated_at: string
  /**
   * true: item audio is TTS
   */
  synthetic_audio: boolean
  items: Item[]
}
/**
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "Item".
 */
export interface Item {
  id: string
  type: ItemType
  /**
   * @minItems 1
   */
  skill_ids: [SkillId, ...SkillId[]]
  grade_band: '2-3' | '4-6'
  /**
   * Fully diacritized
   */
  text: string
  /**
   * Without diacritics
   */
  text_plain: string
  /**
   * Relative to the item-bank folder
   */
  audio_path: string | null
  /**
   * Tap tasks and minimal pairs only
   */
  options: string[] | null
  answer_index: number | null
  /**
   * true: never used in practice, only in unseen-passage probes
   */
  probe_only: boolean
  validation: {
    /**
     * Items that fail validation are discarded, never shipped
     */
    passed: true
    validators: string[]
  }
  review: {
    status: 'unreviewed' | 'approved' | 'rejected'
    reviewer: string | null
  }
}
/**
 * Deliberately has no field that can carry a score, a risk level or a label (non-negotiable 2).
 *
 * This interface was referenced by `BasiraSharedContractsV010`'s JSON-Schema
 * via the `definition` "ParentReport".
 */
export interface ParentReport {
  language: 'ar'
  child_first_name: string
  session_date: string
  duration_min: number
  practised: {
    skill_id: SkillId
    plain_ar: string
  }[]
  progress_notes: {
    skill_id: SkillId
    note_ar: string
  }[]
  /**
   * @minItems 1
   * @maxItems 3
   */
  home_plan:
    | [
        {
          title_ar: string
          minutes: number
          words: string[]
          how_ar: string
        },
      ]
    | [
        {
          title_ar: string
          minutes: number
          words: string[]
          how_ar: string
        },
        {
          title_ar: string
          minutes: number
          words: string[]
          how_ar: string
        },
      ]
    | [
        {
          title_ar: string
          minutes: number
          words: string[]
          how_ar: string
        },
        {
          title_ar: string
          minutes: number
          words: string[]
          how_ar: string
        },
        {
          title_ar: string
          minutes: number
          words: string[]
          how_ar: string
        },
      ]
  next_focus_ar: string
  specialist: {
    name: string
    contact: string
  }
}
