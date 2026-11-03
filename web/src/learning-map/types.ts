import type { ProbeResponse, SkillEvidence, SkillId } from '../contracts/basira'

export type LearningMapEvent = {
  childId: string
  sessionId: string
  eventId: string
  /** ISO-8601 timestamp or epoch milliseconds. */
  at: string | number
  evidence: SkillEvidence[]
  /** True when the evidence came from TTS, a fixture, or another synthetic source. */
  synthetic: boolean
}

export type LearningMapProbe = {
  childId: string
  sessionId: string
  /** Stable, trusted probe-cycle record ID; retries must reuse it. Not a timestamp. */
  eventId: string
  /** ISO-8601 timestamp or epoch milliseconds. */
  at: string | number
  completed: boolean
  response: ProbeResponse
}

export type MasteryBand = 'unknown' | 'working_on' | 'growing' | 'probe_due' | 'mastered'
export type TransferResult = ProbeResponse['per_skill'][number]['transfer']

export type EvidenceCounts = {
  total: number
  correct: number
  incorrect: number
}

export type LearningMapHistoryPoint = {
  sessionId: string
  at: number
  mastery: number
  evidenceCounts: EvidenceCounts
  synthetic: boolean
}

export type SkillState = {
  skill_id: SkillId
  mastery: number | null
  evidenceCounts: EvidenceCounts
  band: MasteryBand
  mastered: boolean
  unlocked: boolean
  latestTransfer: TransferResult | null
  latestProbeAt: number | null
  noGainFlag: boolean
  synthetic: boolean
  history: LearningMapHistoryPoint[]
}

export type LearningMap = {
  childId: string
  skills: SkillState[]
  bySkillId: Readonly<Record<string, SkillState>>
  synthetic: boolean
}

export type LearningMapOptions = {
  childId: string
  noGainCycles?: number
}

export type LearningPlanSelection = {
  primarySkillId: SkillId | null
  reviewSkillIds: SkillId[]
  probeDueIds: SkillId[]
  focusSkillIds: SkillId[]
}

export type LearningMapErrorReason =
  | 'invalid_input'
  | 'invalid_contract'
  | 'invalid_graph'
  | 'cross_child_data'
  | 'conflicting_duplicate'

export class LearningMapError extends Error {
  readonly reason: LearningMapErrorReason

  constructor(reason: LearningMapErrorReason) {
    super(reason)
    this.name = 'LearningMapError'
    this.reason = reason
  }
}
