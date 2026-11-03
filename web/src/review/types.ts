import type {
  FingerprintResponse,
  ParentReport,
  ReviewStatus,
  ScoreItemResponse,
  SkillEvidence,
} from '../contracts/basira'
import type { AuthController } from '../auth/controller'
import type { ScorerClient } from '../scorer/client'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ReviewSessionType = 'assessment' | 'probe'
export type ReviewSessionStatus = 'completed'

export type ReviewChildRow = {
  id: string
  display_name: string
  first_name: string
  grade: number
  dialect_lexicon_id: string
  is_demo: boolean
  specialist_id: string
}

export type ReviewSessionRow = {
  id: string
  child_id: string
  type: ReviewSessionType
  status: ReviewSessionStatus
  started_at: string
  ended_at: string
  run_by: string
}

export type ReviewSessionListRow = ReviewSessionRow & {
  child: ReviewChildRow
  child_display_name: string
  child_is_demo: boolean
}

export type ReviewItemRow = {
  id: string
  session_id: string
  item_id: string
  response: ScoreItemResponse
  audio_path: string | null
  audio_expires_at: string
  synthetic: boolean
}

export type ReviewTapRow = {
  id: string
  session_id: string
  item_id: string
  evidence: SkillEvidence
}

export type FingerprintRow = {
  id: string
  session_id: string
  response: FingerprintResponse
  review_status: ReviewStatus
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
}

export type PlanRow = {
  id: string
  child_id: string
  skill_ids: string[]
  item_ids: string[]
  review_status: ReviewStatus
  approved_by: string | null
  approved_at: string | null
}

export type ParentReportRow = {
  id: string
  child_id: string
  session_id: string
  content: ParentReport
  pdf_path: string | null
  review_status: ReviewStatus
  approved_by: string | null
}

export type ReviewSessionDetail = {
  session: ReviewSessionRow
  child: ReviewChildRow
  items: ReviewItemRow[]
  taps: ReviewTapRow[]
  fingerprints: FingerprintRow[]
  plans: PlanRow[]
  reports: ParentReportRow[]
}

export type ReviewTransitionKind = 'fingerprints' | 'plans' | 'parent_reports'
export type ReviewTransitionAcknowledgement = FingerprintRow | PlanRow | ParentReportRow

export type ReviewRepository = {
  listSessions(signal?: AbortSignal): Promise<ReviewSessionListRow[]>
  loadSession(sessionId: string, signal?: AbortSignal): Promise<ReviewSessionDetail>
  createFingerprint(detail: ReviewSessionDetail, scorer: ScorerClient, signal?: AbortSignal): Promise<FingerprintRow>
  transition(
    kind: ReviewTransitionKind,
    rowId: string,
    expected: ReviewStatus,
    target: ReviewStatus,
    note?: string,
    signal?: AbortSignal,
  ): Promise<ReviewTransitionAcknowledgement>
  downloadAudio(detail: ReviewSessionDetail, item: ReviewItemRow, signal?: AbortSignal): Promise<Blob>
  dispose(): void
}

export type ReviewRepositoryFactory = (
  client: SupabaseClient | null,
  auth: AuthController,
) => ReviewRepository
