import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthController, VerifiedAuthSession } from '../auth/controller'
import type { Stage0ScoreRequest, Stage0ScoreResponse } from '../contracts/basira'
import { parseContract } from '../scorer/validation'

export type Stage0Child = {
  id: string
  first_name: string
  grade: number
  birth_month: string
  specialist_id: string
  is_demo: boolean
}

export type GuardianConsent = {
  id: string
  child_id: string
  guardian_id: string
  specialist_id: string
  scope: 'assessment' | 'practice' | 'audio_research'
  signed_at: string
  expires_at: string
  evidence_path: string
  ethics_ref: string | null
  valid: boolean
}

export type Stage0Session = {
  id: string
  child_id: string
  type: 'stage0'
  status: 'in_progress' | 'completed' | 'abandoned'
  started_at: string
  ended_at: string | null
  run_by: string
}

export type Stage0Result = {
  id: string
  child_id: string
  session_id: string
  request: Stage0ScoreRequest
  response: Stage0ScoreResponse
  examiner_id: string
  review_status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'delivered'
}

export type Stage0RepositoryIssue = 'unavailable' | 'unauthorized' | 'forbidden' | 'consent' | 'schema' | 'conflict' | 'network' | 'cancelled'
export type Stage0RepositoryOptions = { signal?: AbortSignal }

export class Stage0RepositoryError extends Error {
  readonly issue: Stage0RepositoryIssue
  constructor(issue: Stage0RepositoryIssue) {
    super(`stage0: ${issue}`)
    this.name = 'Stage0RepositoryError'
    this.issue = issue
  }
}

type RawRecord = Record<string, unknown>
function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Stage0RepositoryError('schema')
  return value
}
function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return requiredString(value)
}
function errorIssue(error: unknown): Stage0RepositoryIssue {
  if (!isRecord(error)) return 'network'
  const code = error.code ?? error.status ?? error.statusCode
  if (code === '401' || code === 401) return 'unauthorized'
  if (code === '403' || code === 403 || code === '42501') return 'forbidden'
  if (code === '23514') return 'consent'
  if (code === '23503' || code === '22P02') return 'schema'
  if (code === '23505') return 'conflict'
  return 'network'
}
function parseChild(value: unknown): Stage0Child {
  if (!isRecord(value) || !Number.isInteger(value.grade) || (value.grade as number) < 1 || (value.grade as number) > 6 || typeof value.is_demo !== 'boolean') throw new Stage0RepositoryError('schema')
  return {
    id: requiredString(value.id),
    first_name: requiredString(value.first_name),
    grade: value.grade as number,
    birth_month: requiredString(value.birth_month),
    specialist_id: requiredString(value.specialist_id),
    is_demo: value.is_demo,
  }
}
function parseConsent(value: unknown, now = Date.now()): GuardianConsent {
  if (!isRecord(value)) throw new Stage0RepositoryError('schema')
  const signedAt = requiredString(value.signed_at)
  const expiresAt = requiredString(value.expires_at)
  if (!Number.isFinite(Date.parse(signedAt)) || !Number.isFinite(Date.parse(expiresAt))) throw new Stage0RepositoryError('schema')
  const scope = value.scope
  if (scope !== 'assessment' && scope !== 'practice' && scope !== 'audio_research') throw new Stage0RepositoryError('schema')
  return {
    id: requiredString(value.id),
    child_id: requiredString(value.child_id),
    guardian_id: requiredString(value.guardian_id),
    specialist_id: requiredString(value.specialist_id),
    scope,
    signed_at: signedAt,
    expires_at: expiresAt,
    evidence_path: requiredString(value.evidence_path),
    ethics_ref: nullableString(value.ethics_ref),
    valid: Date.parse(signedAt) <= now && Date.parse(expiresAt) > now,
  }
}
function parseSession(value: unknown): Stage0Session {
  if (!isRecord(value) || value.type !== 'stage0' || !['in_progress', 'completed', 'abandoned'].includes(String(value.status))) throw new Stage0RepositoryError('schema')
  return {
    id: requiredString(value.id), child_id: requiredString(value.child_id), type: 'stage0',
    status: value.status as Stage0Session['status'], started_at: requiredString(value.started_at),
    ended_at: nullableString(value.ended_at), run_by: requiredString(value.run_by),
  }
}
function parseResult(value: unknown): Stage0Result {
  if (!isRecord(value)) throw new Stage0RepositoryError('schema')
  const request = parseContract('Stage0ScoreRequest', value.request)
  const response = parseContract('Stage0ScoreResponse', value.response)
  if (response.construct !== request.construct || response.instrument_id !== request.instrument_id) throw new Stage0RepositoryError('schema')
  const reviewStatus = value.review_status
  if (!['draft', 'pending_review', 'approved', 'rejected', 'delivered'].includes(String(reviewStatus))) throw new Stage0RepositoryError('schema')
  return {
    id: requiredString(value.id), child_id: requiredString(value.child_id), session_id: requiredString(value.session_id),
    request, response, examiner_id: requiredString(value.examiner_id), review_status: reviewStatus as Stage0Result['review_status'],
  }
}

type AbortableQuery = { abortSignal?: (signal: AbortSignal) => unknown }
function withAbort<T extends AbortableQuery>(query: T, signal: AbortSignal): T {
  return typeof query.abortSignal === 'function' ? query.abortSignal(signal) as T : query
}

export function createStage0Repository(client: SupabaseClient | null, auth: AuthController) {
  let generation = 0
  let identitySignature = ''
  let disposed = false
  const requests = new Set<AbortController>()
  const listeners = new Set<() => void>()
  const allowedRoles: readonly VerifiedAuthSession['role'][] = ['guardian', 'examiner']

  const signature = (identity: VerifiedAuthSession | null) => identity
    ? `${identity.id}:${identity.role}:${identity.accessToken}`
    : ''
  identitySignature = signature(auth.getVerifiedSession())

  const ensureNotAborted = (options?: Stage0RepositoryOptions) => {
    if (options?.signal?.aborted) throw new Stage0RepositoryError('cancelled')
  }
  const requireClient = () => {
    if (!client) throw new Stage0RepositoryError('unavailable')
    return client
  }
  const requireIdentity = (roles: readonly VerifiedAuthSession['role'][]): VerifiedAuthSession => {
    const snapshot = auth.getSnapshot()
    const identity = auth.getVerifiedSession()
    if (snapshot.status !== 'signedIn' || !identity) throw new Stage0RepositoryError('unauthorized')
    if (!roles.includes(identity.role)) throw new Stage0RepositoryError('forbidden')
    return identity
  }
  const isCurrent = (identity: VerifiedAuthSession, workGeneration: number, workSignature: string) => (
    !disposed &&
    generation === workGeneration &&
    auth.getSnapshot().status === 'signedIn' &&
    signature(auth.getVerifiedSession()) === workSignature &&
    signature(auth.getVerifiedSession()) === signature(identity)
  )
  const call = async <T>(
    operation: (db: SupabaseClient, identity: VerifiedAuthSession, options: Stage0RepositoryOptions) => Promise<T>,
    roles: readonly VerifiedAuthSession['role'][],
    options?: Stage0RepositoryOptions,
  ): Promise<T> => {
    ensureNotAborted(options)
    const identity = requireIdentity(roles)
    const workGeneration = generation
    const workSignature = signature(identity)
    const requestController = new AbortController()
    const abortFromCaller = () => requestController.abort()
    options?.signal?.addEventListener('abort', abortFromCaller, { once: true })
    requests.add(requestController)
    try {
      const value = await operation(requireClient(), identity, { signal: requestController.signal })
      if (options?.signal?.aborted) throw new Stage0RepositoryError('cancelled')
      if (!isCurrent(identity, workGeneration, workSignature)) throw new Stage0RepositoryError('unauthorized')
      return value
    } catch (error) {
      if (options?.signal?.aborted) throw new Stage0RepositoryError('cancelled')
      if (!isCurrent(identity, workGeneration, workSignature)) throw new Stage0RepositoryError('unauthorized')
      if (error instanceof Stage0RepositoryError) throw error
      throw new Stage0RepositoryError(errorIssue(error))
    } finally {
      options?.signal?.removeEventListener('abort', abortFromCaller)
      requests.delete(requestController)
    }
  }
  const readChildren = async (db: SupabaseClient, _identity: VerifiedAuthSession, options: Stage0RepositoryOptions): Promise<Stage0Child[]> => {
    ensureNotAborted(options)
    const response = await withAbort(db.from('children').select('id, first_name, grade, birth_month, specialist_id, is_demo').order('first_name'), options.signal as AbortSignal)
    if (response.error) throw new Stage0RepositoryError(errorIssue(response.error))
    const rows = response.data ?? []
    if (!Array.isArray(rows)) throw new Stage0RepositoryError('schema')
    return rows.map(parseChild)
  }

  const unsubscribe = auth.subscribe(() => {
    const nextSignature = signature(auth.getVerifiedSession())
    if (nextSignature === identitySignature) return
    identitySignature = nextSignature
    generation += 1
    for (const request of requests) request.abort()
    requests.clear()
    for (const listener of [...listeners]) listener()
  })

  return {
    async listExaminerChildren(options?: Stage0RepositoryOptions) {
      return call(readChildren, ['examiner'], options)
    },
    async listGuardianChildren(options?: Stage0RepositoryOptions) {
      return call(readChildren, ['guardian'], options)
    },
    async listConsents(childId: string, scope?: GuardianConsent['scope'], options?: Stage0RepositoryOptions) {
      if (typeof childId !== 'string' || childId.length === 0) throw new Stage0RepositoryError('schema')
      return call(async (db, _identity, requestOptions) => {
        ensureNotAborted(requestOptions)
        let query = db.from('consents').select('id, child_id, guardian_id, specialist_id, scope, signed_at, expires_at, evidence_path, ethics_ref').eq('child_id', childId).order('expires_at', { ascending: false })
        if (scope) query = query.eq('scope', scope)
        const response = await withAbort(query, requestOptions.signal as AbortSignal)
        if (response.error) throw new Stage0RepositoryError(errorIssue(response.error))
        if (!Array.isArray(response.data)) throw new Stage0RepositoryError('schema')
        return response.data.map((row) => parseConsent(row))
      }, allowedRoles, options)
    },
    async createConsent(child: Stage0Child, evidencePath: string, expiresAt: string, options?: Stage0RepositoryOptions) {
      return call(async (db, identity, requestOptions) => {
        const evidence = evidencePath.trim()
        if (!evidence || evidence.length > 500 || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) throw new Stage0RepositoryError('schema')
        const query = withAbort(db.from('consents').insert({ child_id: child.id, guardian_id: identity.id, specialist_id: child.specialist_id, scope: 'assessment', expires_at: expiresAt, evidence_path: evidence }).select('id, child_id, guardian_id, specialist_id, scope, signed_at, expires_at, evidence_path, ethics_ref'), requestOptions.signal as AbortSignal)
        const response = await query.single()
        if (response.error) throw new Stage0RepositoryError(errorIssue(response.error))
        const consent = parseConsent(response.data)
        if (consent.guardian_id !== identity.id || consent.child_id !== child.id || consent.specialist_id !== child.specialist_id || consent.scope !== 'assessment') throw new Stage0RepositoryError('schema')
        return consent
      }, ['guardian'], options)
    },
    async revokeConsent(consentId: string, options?: Stage0RepositoryOptions) {
      if (typeof consentId !== 'string' || consentId.length === 0) throw new Stage0RepositoryError('schema')
      return call(async (db, identity, requestOptions) => {
        // The migration clamps this shortening to statement_timestamp(); using an
        // always-past value also makes revocation fail closed on a fast client clock.
        const expiresAt = '1970-01-01T00:00:00.000Z'
        const query = withAbort(db.from('consents').update({ expires_at: expiresAt }).eq('id', consentId).select('id, child_id, guardian_id, specialist_id, scope, signed_at, expires_at, evidence_path, ethics_ref'), requestOptions.signal as AbortSignal)
        const response = await query.single()
        if (response.error) throw new Stage0RepositoryError(errorIssue(response.error))
        const consent = parseConsent(response.data)
        if (consent.guardian_id !== identity.id || consent.valid) throw new Stage0RepositoryError('schema')
        return consent
      }, ['guardian'], options)
    },
    async createExaminerSession(childId: string, options?: Stage0RepositoryOptions) {
      if (typeof childId !== 'string' || childId.length === 0) throw new Stage0RepositoryError('schema')
      return call(async (db, identity, requestOptions) => {
        const query = withAbort(db.from('sessions').insert({ child_id: childId, type: 'stage0', status: 'in_progress', run_by: identity.id }).select('id, child_id, type, status, started_at, ended_at, run_by'), requestOptions.signal as AbortSignal)
        const response = await query.single()
        if (response.error) throw new Stage0RepositoryError(errorIssue(response.error))
        const session = parseSession(response.data)
        if (session.child_id !== childId || session.run_by !== identity.id) throw new Stage0RepositoryError('schema')
        return session
      }, ['examiner'], options)
    },
    async saveResult(session: Stage0Session, request: Stage0ScoreRequest, result: Stage0ScoreResponse, options?: Stage0RepositoryOptions) {
      return call(async (db, identity, requestOptions) => {
        if (session.type !== 'stage0' || session.status !== 'in_progress' || session.run_by !== identity.id) throw new Stage0RepositoryError('forbidden')
        const checkedRequest = parseContract('Stage0ScoreRequest', structuredClone(request))
        const checkedResult = parseContract('Stage0ScoreResponse', structuredClone(result))
        if (checkedResult.construct !== checkedRequest.construct || checkedResult.instrument_id !== checkedRequest.instrument_id) throw new Stage0RepositoryError('schema')
        const query = withAbort(db.from('stage0_results').insert({ session_id: session.id, child_id: session.child_id, request: checkedRequest, response: checkedResult, examiner_id: identity.id }).select('id, child_id, session_id, request, response, examiner_id, review_status'), requestOptions.signal as AbortSignal)
        const response = await query.single()
        if (response.error) throw new Stage0RepositoryError(errorIssue(response.error))
        return parseResult(response.data)
      }, ['examiner'], options)
    },
    async completeSession(sessionId: string, options?: Stage0RepositoryOptions) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Stage0RepositoryError('schema')
      return call(async (db, _identity, requestOptions) => {
        const query = withAbort(db.from('sessions').update({ status: 'completed' }).eq('id', sessionId).eq('status', 'in_progress').select('id, child_id, type, status, started_at, ended_at, run_by'), requestOptions.signal as AbortSignal)
        const response = await query.single()
        if (response.error) throw new Stage0RepositoryError(errorIssue(response.error))
        return parseSession(response.data)
      }, ['examiner'], options)
    },
    canRead: () => Boolean(!disposed && client && allowedRoles.includes(auth.getVerifiedSession()?.role as VerifiedAuthSession['role']) && signature(auth.getVerifiedSession()) === identitySignature),
    getVersion: () => {
      const identity = auth.getVerifiedSession()
      if (disposed || !client || auth.getSnapshot().status !== 'signedIn' || !identity || !allowedRoles.includes(identity.role) || signature(identity) !== identitySignature) return -1
      return generation
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      if (disposed) return
      disposed = true
      generation += 1
      unsubscribe()
      for (const request of requests) request.abort()
      requests.clear()
      listeners.clear()
    },
  }
}
export type Stage0Repository = ReturnType<typeof createStage0Repository>
