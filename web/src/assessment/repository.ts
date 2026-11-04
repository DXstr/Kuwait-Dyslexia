import type { SupabaseClient } from '@supabase/supabase-js'
import type { ScoreItemResponse } from '../contracts/basira'
import type {
  AssessmentChild, AssessmentConsent, QueueRecord, RepositoryChildRow, RepositoryConsentRow,
  RepositorySessionRow,
} from './types'

export class AssessmentRepositoryError extends Error {
  readonly code: string | null
  readonly retryable: boolean
  constructor(message: string, code: string | null, retryable: boolean) {
    super(message)
    this.name = 'AssessmentRepositoryError'
    this.code = code
    this.retryable = retryable
  }
}

export function stableEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right || left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => stableEqual(value, right[index]))
  }
  if (typeof left !== 'object' || typeof right !== 'object') return false
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && stableEqual(leftRecord[key], rightRecord[key]))
}

type Guard = () => void

type RepositoryErrorLike = { code?: string; message?: string }

function repositoryError(error: RepositoryErrorLike | null | undefined): AssessmentRepositoryError {
  const rawCode = error?.code ?? null
  const status = rawCode === '401' || rawCode === '403' ? rawCode : null
  const code = status === '401' ? 'auth' : status === '403' ? 'consent' : rawCode
  const permanent = code === 'auth' || code === 'consent' || code === '42501' || code === '23514' || code === '23503' || code === '22P02'
  return new AssessmentRepositoryError('repository: ' + (permanent ? 'permanent' : 'transient'), code, !permanent)
}

function childFromRow(row: RepositoryChildRow): AssessmentChild {
  if (!row || typeof row.id !== 'string' || typeof row.first_name !== 'string' || !Number.isInteger(row.grade) || typeof row.dialect_lexicon_id !== 'string' || typeof row.is_demo !== 'boolean') {
    throw new AssessmentRepositoryError('repository: invalid child row', 'schema', false)
  }
  return { id: row.id, firstName: row.first_name, grade: row.grade, dialectLexiconId: row.dialect_lexicon_id, isDemo: row.is_demo }
}

export function createAssessmentRepository(client: SupabaseClient | null) {
  const requireClient = () => {
    if (!client) throw new AssessmentRepositoryError('repository: unavailable', 'auth', false)
    return client
  }

  return {
    async listAssignedChildren(): Promise<AssessmentChild[]> {
      const response = await requireClient().from('children').select('id, first_name, grade, dialect_lexicon_id, is_demo').order('first_name')
      if (response.error) throw repositoryError(response.error)
      try { return ((response.data ?? []) as RepositoryChildRow[]).map(childFromRow) } catch { throw new AssessmentRepositoryError('repository: invalid child response', 'schema', false) }
    },

    async readAssessmentConsent(childId: string, guard?: Guard): Promise<AssessmentConsent> {
      return this.readConsent(childId, 'assessment', guard)
    },

    async readPracticeConsent(childId: string, guard?: Guard): Promise<AssessmentConsent> {
      return this.readConsent(childId, 'practice', guard)
    },

    async readConsent(childId: string, scope: 'assessment' | 'practice', guard?: Guard): Promise<AssessmentConsent> {
      guard?.()
      const response = await requireClient().from('consents').select('signed_at, expires_at').eq('child_id', childId).eq('scope', scope).order('expires_at', { ascending: false }).limit(1).maybeSingle()
      guard?.()
      if (response.error) throw repositoryError(response.error)
      const row = response.data as RepositoryConsentRow | null
      const valid = Boolean(row && typeof row.signed_at === 'string' && typeof row.expires_at === 'string' && Date.parse(row.signed_at) <= Date.now() && Date.parse(row.expires_at) > Date.now())
      return { signedAt: row?.signed_at ?? '', expiresAt: row?.expires_at ?? '', valid }
    },

    async createSession(childId: string, runBy: string, type: 'assessment' | 'practice' = 'assessment', guard?: Guard): Promise<RepositorySessionRow> {
      guard?.()
      const response = await requireClient().from('sessions').insert({ child_id: childId, type, status: 'in_progress', run_by: runBy }).select('id, child_id, started_at, status').single()
      guard?.()
      if (response.error) throw repositoryError(response.error)
      const row = response.data as RepositorySessionRow
      if (!row || typeof row.id !== 'string' || row.child_id !== childId || row.status !== 'in_progress' || typeof row.started_at !== 'string') throw new AssessmentRepositoryError('repository: invalid session response', 'schema', false)
      return row
    },

    async insertResult(record: QueueRecord, response: ScoreItemResponse, audioPath: string, guard?: Guard): Promise<void> {
      guard?.()
      const db = requireClient()
      const row = { id: record.id, session_id: record.sessionId, item_id: record.item.id, response, audio_path: audioPath, synthetic: response.synthetic }
      const inserted = await db.from('item_results').insert(row).select('id, session_id, item_id, response, audio_path, synthetic').maybeSingle()
      guard?.()
      if (!inserted.error) {
        const value = inserted.data as { id?: string } | null
        if (value?.id !== record.id) throw new AssessmentRepositoryError('repository: result acknowledgement mismatch', 'schema', false)
        return
      }
      if (inserted.error.code !== '23505') throw repositoryError(inserted.error)
      guard?.()
      const existing = await db.from('item_results').select('id, session_id, item_id, response, audio_path, synthetic').eq('id', record.id).maybeSingle()
      guard?.()
      if (existing.error) throw repositoryError(existing.error)
      const value = existing.data as typeof row | null
      if (!value || value.id !== row.id || value.session_id !== row.session_id || value.item_id !== row.item_id || value.audio_path !== row.audio_path || value.synthetic !== row.synthetic || !stableEqual(value.response, row.response)) {
        throw new AssessmentRepositoryError('repository: immutable result conflict', 'conflict', false)
      }
    },

    async uploadAudio(record: QueueRecord, audioPath: string, guard?: Guard): Promise<void> {
      guard?.()
      const audio = record.audio
      const storage = requireClient().storage.from('audio')
      const upload = await storage.upload(audioPath, audio, { contentType: 'audio/wav', upsert: false })
      guard?.()
      if (!upload.error) return
      const status = (upload.error as { statusCode?: string | number }).statusCode
      const message = (upload.error.message ?? '').toLowerCase()
      const duplicate = status === 409 || status === '409' || message.includes('already exists') || message.includes('duplicate')
      if (!duplicate) {
        if (status === 401 || status === '401') throw new AssessmentRepositoryError('repository: audio authorization', 'auth', false)
        if (status === 403 || status === '403') throw new AssessmentRepositoryError('repository: audio consent', 'consent', false)
        throw new AssessmentRepositoryError('repository: audio upload', String(status ?? 'storage'), true)
      }
      guard?.()
      const existing = await storage.download(audioPath)
      guard?.()
      if (existing.error) {
        const existingStatus = (existing.error as { statusCode?: string | number }).statusCode
        if (existingStatus === 401 || existingStatus === '401') throw new AssessmentRepositoryError('repository: audio authorization', 'auth', false)
        if (existingStatus === 403 || existingStatus === '403') throw new AssessmentRepositoryError('repository: audio consent', 'consent', false)
        throw new AssessmentRepositoryError('repository: audio reconciliation', String(existingStatus ?? 'storage'), true)
      }
      const expected = new Uint8Array(await audio.arrayBuffer())
      guard?.()
      const received = new Uint8Array(await existing.data.arrayBuffer())
      guard?.()
      if (expected.length !== received.length || expected.some((value, index) => value !== received[index])) throw new AssessmentRepositoryError('repository: immutable audio conflict', 'conflict', false)
    },

    async completeSession(sessionId: string, guard?: Guard): Promise<void> {
      guard?.()
      const response = await requireClient().from('sessions').update({ status: 'completed' }).eq('id', sessionId).eq('status', 'in_progress').select('id, status').maybeSingle()
      guard?.()
      if (response.error) throw repositoryError(response.error)
      const row = response.data as { id?: string; status?: string } | null
      if (!row || row.id !== sessionId || row.status !== 'completed') throw new AssessmentRepositoryError('repository: completion acknowledgement mismatch', 'schema', false)
    },

    async abandonSession(sessionId: string, guard?: Guard): Promise<void> {
      guard?.()
      const response = await requireClient().from('sessions').update({ status: 'abandoned' }).eq('id', sessionId).eq('status', 'in_progress').select('id, status').maybeSingle()
      guard?.()
      if (response.error) throw repositoryError(response.error)
      const row = response.data as { id?: string; status?: string } | null
      if (!row || row.id !== sessionId || row.status !== 'abandoned') throw new AssessmentRepositoryError('repository: abandonment acknowledgement mismatch', 'schema', false)
    },
  }
}

export type AssessmentRepository = ReturnType<typeof createAssessmentRepository>
