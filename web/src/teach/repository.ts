import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthController, VerifiedAuthSession } from '../auth/controller'
import type { SkillEvidence } from '../contracts/basira'
import { parseContract } from '../scorer/validation'
import { resolveApprovedTeachPlan, TeachCatalogueError, type ApprovedTeachPlan } from './catalogue'

export type TeachRepositoryErrorCode = 'unavailable' | 'unauthorized' | 'forbidden' | 'schema' | 'network' | 'stale'

export class TeachRepositoryError extends Error {
  readonly code: TeachRepositoryErrorCode
  constructor(code: TeachRepositoryErrorCode) {
    super(`teach_repository:${code}`)
    this.name = 'TeachRepositoryError'
    this.code = code
  }
}

type ReadOptions = { signal?: AbortSignal }
type RawRow = { plan_id?: unknown; skill_ids?: unknown; item_ids?: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mapError(value: unknown): TeachRepositoryError {
  const code = isRecord(value) && typeof value.code === 'string' ? value.code : ''
  if (code === '401') return new TeachRepositoryError('unauthorized')
  if (code === '403' || code === '42501') return new TeachRepositoryError('forbidden')
  if (code === '23514' || code === '22P02') return new TeachRepositoryError('schema')
  return new TeachRepositoryError('network')
}

export type TeachRepository = {
  readApprovedPracticePlan(childId: string, options?: ReadOptions): Promise<ApprovedTeachPlan | null>
  insertTapResult(input: { sessionId: string; childId: string; itemId: string; evidence: SkillEvidence }, options?: ReadOptions): Promise<void>
  dispose(): void
}

export function createTeachRepository(client: SupabaseClient | null, auth: AuthController): TeachRepository {
  let disposed = false
  let generation = 0
  const unsubscribe = auth.subscribe(() => { generation += 1 })

  const requireIdentity = (signal?: AbortSignal): { identity: VerifiedAuthSession; operationGeneration: number } => {
    if (disposed || signal?.aborted) throw new TeachRepositoryError('stale')
    const identity = auth.getVerifiedSession()
    if (!client) throw new TeachRepositoryError('unavailable')
    if (!identity) throw new TeachRepositoryError('unauthorized')
    if (identity.role !== 'specialist') throw new TeachRepositoryError('forbidden')
    return { identity, operationGeneration: generation }
  }
  const check = (identity: VerifiedAuthSession, operationGeneration: number, signal?: AbortSignal) => {
    if (disposed || signal?.aborted) throw new TeachRepositoryError('stale')
    const current = auth.getVerifiedSession()
    if (!current || current.id !== identity.id || current.role !== 'specialist' || current.accessToken !== identity.accessToken || generation !== operationGeneration) {
      throw new TeachRepositoryError('stale')
    }
  }

  return {
    async readApprovedPracticePlan(childId, options) {
      if (typeof childId !== 'string' || childId.trim().length === 0) throw new TeachRepositoryError('schema')
      const { identity, operationGeneration } = requireIdentity(options?.signal)
      try {
        check(identity, operationGeneration, options?.signal)
        const response = await client!.rpc('approved_practice_plan', { p_child_id: childId }) as { data: unknown; error: unknown | null }
        check(identity, operationGeneration, options?.signal)
        if (response.error) throw mapError(response.error)
        if (response.data === null || response.data === undefined) return null
        if (!Array.isArray(response.data)) throw new TeachRepositoryError('schema')
        if (response.data.length === 0) return null
        if (response.data.length !== 1) throw new TeachRepositoryError('schema')
        const row = response.data[0] as RawRow
        if (!isRecord(row) || typeof row.plan_id !== 'string') throw new TeachRepositoryError('schema')
        return resolveApprovedTeachPlan({
          id: row.plan_id,
          child_id: childId,
          skill_ids: row.skill_ids,
          item_ids: row.item_ids,
          // The RPC only exposes rows after its database-level approved gate.
          review_status: 'approved',
        })
      } catch (error) {
        if (error instanceof TeachRepositoryError) throw error
        if (error instanceof TeachCatalogueError) throw new TeachRepositoryError('schema')
        throw mapError(error)
      }
    },

    async insertTapResult(input, options) {
      if (!input || typeof input.sessionId !== 'string' || typeof input.childId !== 'string' || typeof input.itemId !== 'string') {
        throw new TeachRepositoryError('schema')
      }
      let evidence: SkillEvidence
      try { evidence = parseContract('SkillEvidence', input.evidence) } catch { throw new TeachRepositoryError('schema') }
      if (evidence.source !== 'tap') throw new TeachRepositoryError('schema')
      const { identity, operationGeneration } = requireIdentity(options?.signal)
      try {
        check(identity, operationGeneration, options?.signal)
        const response = await client!.from('tap_results').insert({ session_id: input.sessionId, item_id: input.itemId, evidence }).select('id, session_id, item_id, evidence').single()
        check(identity, operationGeneration, options?.signal)
        if (response.error || !isRecord(response.data) || response.data.session_id !== input.sessionId || response.data.item_id !== input.itemId) {
          if (response.error) throw mapError(response.error)
          throw new TeachRepositoryError('schema')
        }
        try { parseContract('SkillEvidence', response.data.evidence) } catch { throw new TeachRepositoryError('schema') }
      } catch (error) {
        if (error instanceof TeachRepositoryError) throw error
        throw mapError(error)
      }
    },

    dispose() {
      if (disposed) return
      disposed = true
      generation += 1
      unsubscribe()
    },
  }
}
