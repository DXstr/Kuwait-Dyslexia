import type { SupabaseClient } from '@supabase/supabase-js'
import { createAssessmentRepository, AssessmentRepositoryError } from '../assessment/repository'
import { parseContract } from '../scorer/validation'
import type { ProbeResponse } from '../contracts/basira'
import type { ProbeRepository, ProbeResult } from './types'

function probeResultFromRow(value: unknown, sessionId: string, eventId: string): ProbeResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AssessmentRepositoryError('repository: invalid probe acknowledgement', 'schema', false)
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || row.session_id !== sessionId || row.child_id === undefined || typeof row.child_id !== 'string' || row.event_id !== eventId || typeof row.synthetic !== 'boolean' || typeof row.created_at !== 'string') {
    throw new AssessmentRepositoryError('repository: invalid probe acknowledgement', 'schema', false)
  }
  let response: ProbeResponse
  try { response = parseContract('ProbeResponse', row.response) } catch { throw new AssessmentRepositoryError('repository: invalid probe response', 'schema', false) }
  if (response.session_id !== sessionId || response.synthetic !== row.synthetic) throw new AssessmentRepositoryError('repository: probe acknowledgement mismatch', 'schema', false)
  return { request: null, response, childId: row.child_id, sessionId, eventId, createdAt: row.created_at }
}

export function createProbeRepository(client: SupabaseClient | null): ProbeRepository {
  const base = createAssessmentRepository(client)
  return {
    listAssignedChildren: base.listAssignedChildren,
    readAssessmentConsent: base.readAssessmentConsent.bind(base),
    insertResult: base.insertResult,
    uploadAudio: base.uploadAudio,
    completeSession: base.completeSession,
    abandonSession: base.abandonSession,
    async createSession(childId, runBy) {
      if (!client) throw new AssessmentRepositoryError('repository: unavailable', 'auth', false)
      const response = await client
        .from('sessions')
        .insert({ child_id: childId, type: 'probe', status: 'in_progress', run_by: runBy })
        .select('id, child_id, started_at, status')
        .single()
      if (response.error) {
        const code = response.error.code ?? null
        const permanent = code === '401' || code === '403' || code === '42501' || code === '23514' || code === '23503'
        throw new AssessmentRepositoryError('repository: session create failed', code, !permanent)
      }
      const row = response.data as { id?: unknown; child_id?: unknown; started_at?: unknown; status?: unknown } | null
      if (!row || typeof row.id !== 'string' || row.child_id !== childId || typeof row.started_at !== 'string' || row.status !== 'in_progress') {
        throw new AssessmentRepositoryError('repository: invalid probe session response', 'schema', false)
      }
      return { id: row.id, child_id: row.child_id, started_at: row.started_at, status: 'in_progress' as const }
    },
    async finalizeProbe(sessionId, eventId, result, guard): Promise<ProbeResult> {
      if (!client) throw new AssessmentRepositoryError('repository: unavailable', 'auth', false)
      guard?.()
      const response = await client.rpc('finalize_probe', {
        p_session_id: sessionId,
        p_event_id: eventId,
        p_response: result,
      }).maybeSingle()
      guard?.()
      if (response.error) {
        const code = response.error.code ?? null
        if (code === '23505') throw new AssessmentRepositoryError('repository: conflicting probe retry', 'conflict', false)
        throw new AssessmentRepositoryError('repository: probe finalization failed', code, false)
      }
      return probeResultFromRow(response.data, sessionId, eventId)
    },
  }
}
