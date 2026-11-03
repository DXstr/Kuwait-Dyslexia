import type { SupabaseClient } from '@supabase/supabase-js'
import type { ScoreItemResponse, SkillEvidence, SkillId } from '../contracts/basira'
import { parseContract } from '../scorer/validation'
import { isCanonicalSkillId } from './engine'
import type { LearningMapEvent, LearningMapProbe } from './types'
import type { AuthController, VerifiedAuthSession } from '../auth/controller'

const CHILD_LIMIT = 100
const SESSION_LIMIT = 200
const RESULT_LIMIT = 200
const MASTERY_LIMIT = 200
const SESSION_TYPES = ['assessment', 'practice', 'probe'] as const

type ChildRow = {
  id: unknown
  first_name: unknown
  is_demo: unknown
  specialist_id: unknown
}

type SessionRow = {
  id: unknown
  child_id: unknown
  type: unknown
  status: unknown
  started_at: unknown
  ended_at: unknown
}

type ItemResultRow = {
  id: unknown
  session_id: unknown
  item_id: unknown
  response: unknown
  synthetic: unknown
}

type TapResultRow = {
  id: unknown
  session_id: unknown
  item_id: unknown
  evidence: unknown
}

type MasteryRow = {
  child_id: unknown
  skill_id: unknown
  mastery: unknown
  updated_at: unknown
  source_session_id: unknown
}

export type LearningMapChild = {
  id: string
  firstName: string
  isDemo: boolean
}

export type StoredMasteryRow = {
  childId: string
  skillId: SkillId
  mastery: number
  updatedAt: number
  sourceSessionId: string
}

export type LearningMapRead = {
  child: LearningMapChild
  events: LearningMapEvent[]
  probes: LearningMapProbe[]
  storedMastery: StoredMasteryRow[]
  sessionsRead: number
  sessionsTruncated: boolean
  resultsTruncated: boolean
}

export type LearningMapRepositoryErrorCode =
  | 'unavailable'
  | 'not_authorized'
  | 'stale'
  | 'invalid_data'
  | 'query_failed'

export class LearningMapRepositoryError extends Error {
  readonly code: LearningMapRepositoryErrorCode

  constructor(code: LearningMapRepositoryErrorCode) {
    super(`learning_map_repository:${code}`)
    this.name = 'LearningMapRepositoryError'
    this.code = code
  }
}

type ReadOptions = { signal?: AbortSignal }
type QueryWithAbort = { abortSignal?: (signal: AbortSignal) => unknown }

function withAbort<T extends QueryWithAbort>(query: T, signal?: AbortSignal): T {
  if (!signal || typeof query.abortSignal !== 'function') return query
  return query.abortSignal(signal) as T
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function timestamp(value: unknown): number {
  if (!text(value)) throw new LearningMapRepositoryError('invalid_data')
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new LearningMapRepositoryError('invalid_data')
  return parsed
}

function queryFailed(error: unknown): never {
  const code = isObject(error) && typeof error.code === 'string' ? error.code : ''
  if (code === '401' || code === '403' || code === '42501') throw new LearningMapRepositoryError('not_authorized')
  throw new LearningMapRepositoryError('query_failed')
}

function rowChild(row: ChildRow, identity: VerifiedAuthSession): LearningMapChild {
  if (!isObject(row) || !text(row.id) || !text(row.first_name) || row.is_demo !== true && row.is_demo !== false || row.specialist_id !== identity.id) {
    throw new LearningMapRepositoryError('invalid_data')
  }
  return { id: row.id, firstName: row.first_name, isDemo: row.is_demo }
}

function rowSession(row: SessionRow, childId: string): { id: string; at: number } {
  if (!isObject(row) || !text(row.id) || row.child_id !== childId || row.status !== 'completed' ||
      !SESSION_TYPES.includes(row.type as typeof SESSION_TYPES[number])) {
    throw new LearningMapRepositoryError('invalid_data')
  }
  const at = timestamp(row.ended_at ?? row.started_at)
  return { id: row.id, at }
}

function validateEvidence(value: SkillEvidence): SkillEvidence {
  if (!isCanonicalSkillId(value.skill_id)) throw new LearningMapRepositoryError('invalid_data')
  return value
}

function itemEvents(row: ItemResultRow, sessionAt: number, sessions: Map<string, number>, childId: string): LearningMapEvent[] {
  if (!isObject(row) || !text(row.id) || !text(row.session_id) || !text(row.item_id) || !sessions.has(row.session_id) || typeof row.synthetic !== 'boolean') {
    throw new LearningMapRepositoryError('invalid_data')
  }
  let response: ScoreItemResponse
  try {
    response = parseContract('ScoreItemResponse', row.response)
  } catch {
    throw new LearningMapRepositoryError('invalid_data')
    }
    if (response.item_id !== row.item_id || response.synthetic !== row.synthetic) throw new LearningMapRepositoryError('invalid_data')
    const evidence = response.skill_evidence.map(validateEvidence)
    if (evidence.length === 0) return []
    return [{
      childId,
      sessionId: row.session_id as string,
      eventId: `item:${row.id as string}`,
      at: sessionAt,
      evidence,
      synthetic: response.synthetic,
    }]
}

function tapEvents(row: TapResultRow, sessionAt: number, sessions: Map<string, number>, childId: string): LearningMapEvent[] {
  if (!isObject(row) || !text(row.id) || !text(row.session_id) || !sessions.has(row.session_id) || !text(row.item_id)) {
    throw new LearningMapRepositoryError('invalid_data')
  }
  let evidence: SkillEvidence
  try {
    evidence = parseContract('SkillEvidence', row.evidence)
  } catch {
    throw new LearningMapRepositoryError('invalid_data')
  }
  validateEvidence(evidence)
  return [{
    childId,
    sessionId: row.session_id as string,
    eventId: `tap:${row.id as string}`,
    at: sessionAt,
    evidence: [evidence],
    synthetic: false,
  }]
}

function masteryRows(rows: unknown, childId: string): StoredMasteryRow[] {
  if (!Array.isArray(rows)) throw new LearningMapRepositoryError('invalid_data')
  return rows.map((raw) => {
    const row = raw as MasteryRow
    if (!isObject(row) || row.child_id !== childId || !text(row.skill_id) || !isCanonicalSkillId(row.skill_id) ||
        typeof row.mastery !== 'number' || !Number.isFinite(row.mastery) || row.mastery < 0 || row.mastery > 1 ||
        !text(row.source_session_id)) throw new LearningMapRepositoryError('invalid_data')
    return {
      childId,
      skillId: row.skill_id,
      mastery: row.mastery,
      updatedAt: timestamp(row.updated_at),
      sourceSessionId: row.source_session_id,
    }
  }).sort((left, right) => left.updatedAt - right.updatedAt)
}

export interface LearningMapRepository {
  listAssignedChildren(options?: ReadOptions): Promise<LearningMapChild[]>
  getAssignedChildren(options?: ReadOptions): Promise<LearningMapChild[]>
  readChild(childId: string, options?: ReadOptions): Promise<LearningMapRead>
  canRead(): boolean
  getVersion(): number
  subscribe(listener: () => void): () => void
  clearCache(): void
  dispose(): void
}

export function createRepository(client: SupabaseClient | null, controller: AuthController): LearningMapRepository {
  let generation = 0
  let assignedCache: { identity: string; children: LearningMapChild[] } | null = null
  const readCache = new Map<string, { identity: string; value: LearningMapRead }>()
  const requests = new Set<AbortController>()
  const listeners = new Set<() => void>()
  let disposed = false
  let identitySignature = ''

  const currentIdentity = (): VerifiedAuthSession => {
    if (disposed) throw new LearningMapRepositoryError('stale')
    const identity = controller.getVerifiedSession()
    if (!identity || identity.role !== 'specialist' || !client) throw new LearningMapRepositoryError(client ? 'not_authorized' : 'unavailable')
    return identity
  }

  const signature = (identity: VerifiedAuthSession | null) => identity ? `${identity.id}:${identity.role}:${identity.accessToken}` : ''
  identitySignature = signature(controller.getVerifiedSession())

  const assertCurrent = (identity: VerifiedAuthSession, workGeneration: number, signal?: AbortSignal) => {
    if (signal?.aborted || workGeneration !== generation || signature(controller.getVerifiedSession()) !== identitySignature || signature(identity) !== identitySignature) {
      throw new LearningMapRepositoryError('stale')
    }
  }

  const run = async <T>(operation: (signal: AbortSignal, identity: VerifiedAuthSession, workGeneration: number) => Promise<T>, options?: ReadOptions): Promise<T> => {
    if (options?.signal?.aborted) throw new LearningMapRepositoryError('stale')
    const identity = currentIdentity()
    const abort = new AbortController()
    const onAbort = () => abort.abort()
    options?.signal?.addEventListener('abort', onAbort, { once: true })
    requests.add(abort)
    const workGeneration = generation
    try {
      return await operation(abort.signal, identity, workGeneration)
    } catch (error) {
      if (error instanceof LearningMapRepositoryError) throw error
      if (abort.signal.aborted) throw new LearningMapRepositoryError('stale')
      queryFailed(error)
    } finally {
      options?.signal?.removeEventListener('abort', onAbort)
      requests.delete(abort)
    }
  }

  const listAssignedChildren = (options?: ReadOptions) => run(async (signal, identity, workGeneration) => {
      const cached = assignedCache
      if (cached?.identity === identitySignature) {
        assertCurrent(identity, workGeneration, signal)
        return cached.children
      }
      assertCurrent(identity, workGeneration, signal)
      const request = withAbort(client!.from('children')
      .select('id, first_name, is_demo, specialist_id')
      .eq('specialist_id', identity.id)
        .order('id', { ascending: true })
      .limit(CHILD_LIMIT), signal)
    const response = await request
    assertCurrent(identity, workGeneration, signal)
    if (response.error) queryFailed(response.error)
    if (!Array.isArray(response.data)) throw new LearningMapRepositoryError('invalid_data')
    const children = response.data.map((row) => rowChild(row as ChildRow, identity))
    assignedCache = { identity: identitySignature, children }
    return children
  }, options)

  const readChild = (childId: string, options?: ReadOptions) => run(async (signal, identity, workGeneration) => {
    if (!text(childId)) throw new LearningMapRepositoryError('invalid_data')
      const cached = readCache.get(childId)
      if (cached?.identity === identitySignature) {
        assertCurrent(identity, workGeneration, signal)
        return cached.value
      }
    const children = await listAssignedChildren({ signal })
    assertCurrent(identity, workGeneration, signal)
    const child = children.find((candidate) => candidate.id === childId)
    if (!child) throw new LearningMapRepositoryError('not_authorized')

    const sessionRequest = withAbort(client!.from('sessions')
      .select('id, child_id, type, status, started_at, ended_at')
      .eq('child_id', childId)
      .eq('status', 'completed')
      .in('type', [...SESSION_TYPES])
      .order('ended_at', { ascending: false })
      .limit(SESSION_LIMIT), signal)
    const sessionResponse = await sessionRequest
    assertCurrent(identity, workGeneration, signal)
    if (sessionResponse.error) queryFailed(sessionResponse.error)
    if (!Array.isArray(sessionResponse.data)) throw new LearningMapRepositoryError('invalid_data')
    const sessions = sessionResponse.data.map((row) => rowSession(row as SessionRow, childId))
    const sessionTimes = new Map(sessions.map((session) => [session.id, session.at]))
    const sessionIds = sessions.map((session) => session.id)

    let itemRows: unknown[] = []
    let tapRows: unknown[] = []
    if (sessionIds.length > 0) {
        const itemRequest = withAbort(client!.from('item_results')
        .select('id, session_id, item_id, response, synthetic')
        .in('session_id', sessionIds)
          .order('id', { ascending: true })
        .limit(RESULT_LIMIT), signal)
        const tapRequest = withAbort(client!.from('tap_results')
        .select('id, session_id, item_id, evidence')
        .in('session_id', sessionIds)
          .order('id', { ascending: true })
        .limit(RESULT_LIMIT), signal)
      const [itemResponse, tapResponse] = await Promise.all([itemRequest, tapRequest])
      assertCurrent(identity, workGeneration, signal)
      if (itemResponse.error) queryFailed(itemResponse.error)
      if (tapResponse.error) queryFailed(tapResponse.error)
      if (!Array.isArray(itemResponse.data) || !Array.isArray(tapResponse.data)) throw new LearningMapRepositoryError('invalid_data')
      itemRows = itemResponse.data
      tapRows = tapResponse.data
    }

    const events = [
      ...itemRows.flatMap((row) => {
        const value = row as ItemResultRow
        return itemEvents(value, sessionTimes.get(value.session_id as string) as number, sessionTimes, childId)
      }),
      ...tapRows.flatMap((row) => {
        const value = row as TapResultRow
        return tapEvents(value, sessionTimes.get(value.session_id as string) as number, sessionTimes, childId)
      }),
    ]

    const masteryRequest = withAbort(client!.from('skill_mastery')
      .select('child_id, skill_id, mastery, updated_at, source_session_id')
      .eq('child_id', childId)
      .order('updated_at', { ascending: true })
      .limit(MASTERY_LIMIT), signal)
    const masteryResponse = await masteryRequest
    assertCurrent(identity, workGeneration, signal)
    if (masteryResponse.error) queryFailed(masteryResponse.error)
    const storedMastery = masteryRows(masteryResponse.data, childId)
    const value: LearningMapRead = {
      child,
      events,
      // No canonical ProbeResponse is persisted in B8. Do not manufacture probes from scores or mastery rows.
      probes: [],
      storedMastery,
      sessionsRead: sessions.length,
      sessionsTruncated: sessions.length >= SESSION_LIMIT,
        resultsTruncated: itemRows.length >= RESULT_LIMIT || tapRows.length >= RESULT_LIMIT || storedMastery.length >= MASTERY_LIMIT,
    }
    readCache.set(childId, { identity: identitySignature, value })
    return value
  }, options)

  const unsubscribe = controller.subscribe(() => {
    const nextSignature = signature(controller.getVerifiedSession())
    if (nextSignature === identitySignature) return
    identitySignature = nextSignature
    generation += 1
    assignedCache = null
    readCache.clear()
    for (const request of requests) request.abort()
    requests.clear()
    for (const listener of [...listeners]) listener()
  })

  const getVersion = () => {
    if (disposed || !client) return -1
    const identity = controller.getVerifiedSession()
    if (!identity || identity.role !== 'specialist' || signature(identity) !== identitySignature) return -1
    return generation
  }

  return {
    listAssignedChildren,
    getAssignedChildren: listAssignedChildren,
    readChild,
    canRead: () => Boolean(controller.getVerifiedSession()?.role === 'specialist' && client && !disposed),
    getVersion,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    clearCache() {
      generation += 1
      assignedCache = null
      readCache.clear()
      for (const request of requests) request.abort()
      requests.clear()
    },
    dispose() {
      disposed = true
      generation += 1
      unsubscribe()
      for (const request of requests) request.abort()
      requests.clear()
      assignedCache = null
      readCache.clear()
      listeners.clear()
    },
  }
}

export const createLearningMapRepository = createRepository

export type { ReadOptions as LearningMapReadOptions }
