import type { ProbeRequest, ProbeResponse, ScoreItemResponse } from '../contracts/basira'
import type { AssessmentChild, AssessmentItem, QueueRecord } from '../assessment/types'

export type ProbeChild = AssessmentChild

export type ProbeSession = {
  id: string
  eventId: string
  child: ProbeChild
  startedAt: string
  items: readonly AssessmentItem[]
  practised: readonly ScoreItemResponse[]
  responses: Readonly<Record<string, ScoreItemResponse>>
  completed: boolean
  result: ProbeResult | null
}

export type ProbeResult = {
  /** The canonical scorer response is returned unchanged from probe_results. */
  request: ProbeRequest | null
  response: ProbeResponse
  childId: string
  sessionId: string
  eventId: string
  createdAt: string
}

export type ProbeRepository = {
  listAssignedChildren(): Promise<ProbeChild[]>
  readAssessmentConsent(childId: string): Promise<{ signedAt: string; expiresAt: string; valid: boolean }>
  createSession(childId: string, runBy: string): Promise<{ id: string; child_id: string; started_at: string; status: 'in_progress' }>
  finalizeProbe(sessionId: string, eventId: string, response: ProbeResponse, guard?: () => void): Promise<ProbeResult>
  completeSession(sessionId: string, guard?: () => void): Promise<void>
  abandonSession(sessionId: string, guard?: () => void): Promise<void>
  insertResult(record: QueueRecord, response: ScoreItemResponse, audioPath: string, guard?: () => void): Promise<void>
  uploadAudio(record: QueueRecord, audioPath: string, guard?: () => void): Promise<void>
}

export type ProbeRuntimeSnapshot = {
  activeSession: ProbeSession | null
  queue: { pending: number; processing: number; exhausted: number; frozen: boolean; lastError: string | null }
}
