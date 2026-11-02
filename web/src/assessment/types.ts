import type { ScoreItemRequestMeta, ScoreItemResponse } from '../contracts/basira'
import requestFixture from '../../../contracts/fixtures/ScoreItemRequestMeta.example.json'
import dialectFixture from '../../../contracts/fixtures/ScoreItemResponse.dialect-variant.json'
import dotFixture from '../../../contracts/fixtures/ScoreItemResponse.dot-confusion.json'

export type AssessmentItem = {
  id: string
  type: ScoreItemRequestMeta['item_type']
  text: string
  dialectLexiconId: ScoreItemRequestMeta['dialect_lexicon_id']
  synthetic: true
}

export const demoAssessmentItems: readonly AssessmentItem[] = [dialectFixture, dotFixture].map((source) => {
  const response = source as ScoreItemResponse
  return {
    id: response.item_id,
    type: response.item_type,
    text: response.words.map((word) => word.text).join(' '),
    dialectLexiconId: (requestFixture as ScoreItemRequestMeta).dialect_lexicon_id,
    synthetic: true,
  }
})

export type AssessmentChild = {
  id: string
  firstName: string
  grade: number
  dialectLexiconId: string
  isDemo: boolean
}

export type AssessmentConsent = {
  signedAt: string
  expiresAt: string
  valid: boolean
}

export type ActiveAssessmentSession = {
  id: string
  child: AssessmentChild
  startedAt: string
  items: readonly AssessmentItem[]
  completed?: boolean
}

export type QueueRecord = {
  id: string
  sessionId: string
  childId: string
  item: AssessmentItem
  audio: Blob
  identityId: string
  response?: ScoreItemResponse
  attempts: number
  status: 'queued' | 'processing' | 'retrying' | 'exhausted' | 'done'
  lastError?: QueueErrorCode
}

export type QueueErrorCode =
  | 'offline'
  | 'auth'
  | 'consent'
  | 'schema'
  | 'storage'
  | 'network'
  | 'capacity'
  | 'material'
  | 'cancelled'
  | 'unknown'

export type QueueSnapshot = {
  pending: number
  processing: number
  exhausted: number
  frozen: boolean
  lastError: QueueErrorCode | null
}

export type RepositoryChildRow = {
  id: string
  first_name: string
  grade: number
  dialect_lexicon_id: string
  is_demo: boolean
}

export type RepositoryConsentRow = {
  signed_at: string
  expires_at: string
}

export type RepositorySessionRow = {
  id: string
  child_id: string
  started_at: string
  status: 'in_progress' | 'completed' | 'abandoned'
}
