import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthController, VerifiedAuthSession } from '../auth/controller'
import { stableEqual } from '../assessment/repository'
import type {
  FingerprintRequest,
  FingerprintResponse,
  ParentReport,
  ReviewStatus,
  ScoreItemResponse,
  SkillEvidence,
} from '../contracts/basira'
import { parseContract } from '../scorer/validation'
import { validateWav as validateScorerWav } from '../scorer/audio'
import type { ScorerClient } from '../scorer/client'
import type {
  FingerprintRow,
  ParentReportRow,
  PlanRow,
  ReviewChildRow,
  ReviewItemRow,
  ReviewRepository,
  ReviewSessionDetail,
  ReviewSessionListRow,
  ReviewSessionRow,
  ReviewSessionType,
  ReviewTapRow,
  ReviewTransitionAcknowledgement,
  ReviewTransitionKind,
} from './types'

const DEADLINE_MS = 30_000
const MAX_ITEMS = 256
const MAX_TAPS = 512
const MAX_FINGERPRINTS = 64
const MAX_PLANS = 128
const MAX_REPORTS = 128
const ITEM_SELECT = 'id, session_id, item_id, response, audio_path, audio_expires_at, synthetic'
const TAP_SELECT = 'id, session_id, item_id, evidence'
const FINGERPRINT_SELECT = 'id, session_id, response, review_status, reviewed_by, reviewed_at, review_note'
const PLAN_SELECT = 'id, child_id, skill_ids, item_ids, review_status, approved_by, approved_at'
const REPORT_SELECT = 'id, child_id, session_id, content, pdf_path, review_status, approved_by'

export type ReviewRepositoryIssue =
  | 'unavailable'
  | 'unauthorized'
  | 'forbidden'
  | 'cancelled'
  | 'timeout'
  | 'network'
  | 'schema'
  | 'conflict'
  | 'lostUpdate'
  | 'audioUnavailable'
  | 'fingerprintUnavailable'

export class ReviewRepositoryError extends Error {
  readonly issue: ReviewRepositoryIssue
  readonly retryable: boolean

  constructor(issue: ReviewRepositoryIssue, retryable = false) {
    super(`review: ${issue}`)
    this.name = 'ReviewRepositoryError'
    this.issue = issue
    this.retryable = retryable
  }
}

type QueryWithAbort = {
  abortSignal?: (signal: AbortSignal) => unknown
}

type RawRecord = Record<string, unknown>
type Association = { kind: ReviewTransitionKind; sessionId?: string; childId: string }

type StorageDownload = {
  data: Blob | null
  error: unknown | null
}

function fail(issue: ReviewRepositoryIssue, retryable = false): never {
  throw new ReviewRepositoryError(issue, retryable)
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) fail('schema')
  return value
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return requiredString(value)
}

function integer(value: unknown, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) fail('schema')
  return value as number
}

function boundedRows(value: unknown, max: number): RawRecord[] {
  if (!Array.isArray(value) || value.length > max || value.some((row) => !isRecord(row))) fail('schema')
  return value as RawRecord[]
}

function reviewStatus(value: unknown): ReviewStatus {
  try {
    return parseContract('ReviewStatus', value)
  } catch {
    fail('schema')
  }
}

function scoreItemResponse(value: unknown): ScoreItemResponse {
  try {
    const response = parseContract('ScoreItemResponse', value)
    if (response.words.length > MAX_ITEMS || response.phonemes.length > MAX_ITEMS * 8 || response.skill_evidence.length > MAX_TAPS) fail('schema')
    return response
  } catch (error) {
    if (error instanceof ReviewRepositoryError) throw error
    fail('schema')
  }
}

function fingerprintResponse(value: unknown): FingerprintResponse {
  try {
    return parseContract('FingerprintResponse', value)
  } catch (error) {
    if (error instanceof ReviewRepositoryError) throw error
    fail('schema')
  }
}

function skillEvidence(value: unknown): SkillEvidence {
  try {
    return parseContract('SkillEvidence', value)
  } catch {
    fail('schema')
  }
}

function parentReport(value: unknown): ParentReport {
  try {
    return parseContract('ParentReport', value)
  } catch {
    fail('schema')
  }
}

function childFromRow(value: unknown): ReviewChildRow {
  if (!isRecord(value)) fail('schema')
  const child: ReviewChildRow = {
    id: requiredString(value.id),
    display_name: typeof value.display_name === 'string' ? value.display_name : requiredString(value.first_name),
    first_name: requiredString(value.first_name),
    grade: integer(value.grade, 1),
    dialect_lexicon_id: requiredString(value.dialect_lexicon_id),
    is_demo: value.is_demo as boolean,
    specialist_id: requiredString(value.specialist_id),
  }
  if (child.grade > 6 || typeof child.is_demo !== 'boolean') fail('schema')
  return child
}

function sessionFromRow(value: unknown): ReviewSessionRow {
  if (!isRecord(value)) fail('schema')
  const type = value.type
  if (type !== 'assessment' && type !== 'probe') fail('schema')
  if (value.status !== 'completed') fail('schema')
  const started = requiredString(value.started_at)
  const ended = requiredString(value.ended_at)
  if (!Number.isFinite(Date.parse(started)) || !Number.isFinite(Date.parse(ended)) || Date.parse(ended) < Date.parse(started)) fail('schema')
  return {
    id: requiredString(value.id),
    child_id: requiredString(value.child_id),
    type: type as ReviewSessionType,
    status: 'completed',
    started_at: started,
    ended_at: ended,
    run_by: requiredString(value.run_by),
  }
}

function itemFromRow(value: unknown, sessionId: string): ReviewItemRow {
  if (!isRecord(value)) fail('schema')
  const response = scoreItemResponse(value.response)
  const item: ReviewItemRow = {
    id: requiredString(value.id),
    session_id: requiredString(value.session_id),
    item_id: requiredString(value.item_id),
    response,
    audio_path: nullableString(value.audio_path),
    audio_expires_at: requiredString(value.audio_expires_at),
    synthetic: value.synthetic as boolean,
  }
  if (item.session_id !== sessionId || response.item_id !== item.item_id || response.synthetic !== item.synthetic || typeof item.synthetic !== 'boolean') fail('schema')
  if (!Number.isFinite(Date.parse(item.audio_expires_at))) fail('schema')
  return item
}

function tapFromRow(value: unknown, sessionId: string): ReviewTapRow {
  if (!isRecord(value)) fail('schema')
  const row: ReviewTapRow = {
    id: requiredString(value.id),
    session_id: requiredString(value.session_id),
    item_id: requiredString(value.item_id),
    evidence: skillEvidence(value.evidence),
  }
  if (row.session_id !== sessionId) fail('schema')
  return row
}

function fingerprintFromRow(value: unknown, sessionId?: string): FingerprintRow {
  if (!isRecord(value)) fail('schema')
  const row: FingerprintRow = {
    id: requiredString(value.id),
    session_id: requiredString(value.session_id),
    response: fingerprintResponse(value.response),
    review_status: reviewStatus(value.review_status),
    reviewed_by: nullableString(value.reviewed_by),
    reviewed_at: nullableString(value.reviewed_at),
    review_note: nullableString(value.review_note),
  }
  if ((sessionId && row.session_id !== sessionId) || row.response.session_id !== row.session_id) fail('schema')
  return row
}

function stringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length > max || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) fail('schema')
  return [...value] as string[]
}

function planFromRow(value: unknown, childId?: string): PlanRow {
  if (!isRecord(value)) fail('schema')
  const row: PlanRow = {
    id: requiredString(value.id),
    child_id: requiredString(value.child_id),
    skill_ids: stringArray(value.skill_ids, MAX_ITEMS),
    item_ids: stringArray(value.item_ids, MAX_ITEMS),
    review_status: reviewStatus(value.review_status),
    approved_by: nullableString(value.approved_by),
    approved_at: nullableString(value.approved_at),
  }
  if (childId && row.child_id !== childId) fail('schema')
  return row
}

function reportFromRow(value: unknown, childId?: string, sessionId?: string): ParentReportRow {
  if (!isRecord(value)) fail('schema')
  const row: ParentReportRow = {
    id: requiredString(value.id),
    child_id: requiredString(value.child_id),
    session_id: requiredString(value.session_id),
    content: parentReport(value.content),
    pdf_path: nullableString(value.pdf_path),
    review_status: reviewStatus(value.review_status),
    approved_by: nullableString(value.approved_by),
  }
  if ((childId && row.child_id !== childId) || (sessionId && row.session_id !== sessionId)) fail('schema')
  return row
}

function childRelation(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null
  return value
}

function queryWithSignal<T>(query: T, signal: AbortSignal): T {
  const candidate = query as T & QueryWithAbort
  if (typeof candidate.abortSignal === 'function') return candidate.abortSignal(signal) as T
  return query
}

function errorCode(error: unknown): string | number | null {
  if (!isRecord(error)) return null
  const code = error.code ?? error.status ?? error.statusCode
  return typeof code === 'string' || typeof code === 'number' ? code : null
}

function mappedError(error: unknown): ReviewRepositoryError {
  if (error instanceof ReviewRepositoryError) return error
  const code = errorCode(error)
  if (code === 401 || code === '401') return new ReviewRepositoryError('unauthorized')
  if (code === 403 || code === '403' || code === '42501') return new ReviewRepositoryError('forbidden')
  if (code === '23505') return new ReviewRepositoryError('conflict')
  if (code === '23514' || code === '22P02') return new ReviewRepositoryError('schema')
  return new ReviewRepositoryError('network', true)
}

function uuid(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  fail('unavailable')
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SAFE_ITEM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const MAX_WAV_BYTES = 500_044

function associationKey(kind: ReviewTransitionKind, rowId: string): string {
  return `${kind}:${rowId}`
}

function expectedAudioPath(childId: string, sessionId: string, itemId: string): string {
  if (!UUID_RE.test(childId) || !UUID_RE.test(sessionId) || !SAFE_ITEM_ID_RE.test(itemId)) fail('audioUnavailable')
  return `audio/${childId}/${sessionId}/${itemId}.wav`
}

async function validateWav(blob: Blob, expectedDurationMs: number, synthetic: boolean): Promise<void> {
  if (!(blob instanceof Blob) || blob.size < 44 || blob.size > MAX_WAV_BYTES) fail('audioUnavailable')
  try {
    await validateScorerWav(blob)
  } catch {
    fail('audioUnavailable')
  }
  if (!synthetic) {
    let bytes: ArrayBuffer
    try {
      bytes = await blob.arrayBuffer()
    } catch {
      fail('audioUnavailable')
    }
    const view = new DataView(bytes)
    let offset = 12
    let dataLength = 0
    while (offset + 8 <= view.byteLength) {
      const chunkLength = view.getUint32(offset + 4, true)
      if (String.fromCharCode(...new Uint8Array(bytes, offset, 4)) === 'data') dataLength = chunkLength
      offset += 8 + chunkLength + (chunkLength % 2)
    }
    if (dataLength <= 0) fail('audioUnavailable')
    const actualDurationMs = dataLength / 32 * 1000
    const tolerance = Math.max(250, expectedDurationMs * 0.1)
    if (Math.abs(actualDurationMs - expectedDurationMs) > tolerance) fail('audioUnavailable')
  }
}

function validateFingerprintDetail(detail: ReviewSessionDetail): void {
  if (!detail || !isRecord(detail) || !isRecord(detail.session) || !isRecord(detail.child)) fail('schema')
  const session = detail.session
  const child = detail.child
  if (session.status !== 'completed' || !session.id || !session.child_id || child.id !== session.child_id || !child.specialist_id || !Number.isInteger(child.grade) || child.grade < 1 || child.grade > 6) fail('schema')
  if (!Array.isArray(detail.items) || detail.items.length > MAX_ITEMS || !Array.isArray(detail.taps) || detail.taps.length > MAX_TAPS || !Array.isArray(detail.fingerprints) || detail.fingerprints.length > MAX_FINGERPRINTS || !Array.isArray(detail.plans) || detail.plans.length > MAX_PLANS || !Array.isArray(detail.reports) || detail.reports.length > MAX_REPORTS) fail('schema')
  for (const item of detail.items) {
    const checked = itemFromRow(item, session.id)
    if (checked.response.item_id !== checked.item_id || checked.response.synthetic !== checked.synthetic) fail('schema')
  }
  for (const tap of detail.taps) tapFromRow(tap, session.id)
  for (const fingerprint of detail.fingerprints) fingerprintFromRow(fingerprint, session.id)
  for (const plan of detail.plans) planFromRow(plan, child.id)
  for (const report of detail.reports) reportFromRow(report, child.id, session.id)
}

export function createReviewRepository(client: SupabaseClient | null, auth: AuthController): ReviewRepository {
  let disposed = false
  let generation = 0
  const active = new Set<AbortController>()
  const fingerprintIds = new Map<string, string>()
  const associations = new Map<string, Association>()

  const clearIdentityCaches = () => {
    fingerprintIds.clear()
    associations.clear()
  }

  const stopAuth = auth.subscribe(() => {
    generation += 1
    for (const controller of active) controller.abort('identity-changed')
    clearIdentityCaches()
  })

  const requireSpecialist = (): VerifiedAuthSession => {
    if (disposed || !client) fail('unavailable')
    const identity = auth.getVerifiedSession()
    if (!identity) fail('unauthorized')
    if (identity.role !== 'specialist') fail('forbidden')
    return identity
  }

  const run = async <T>(callerSignal: AbortSignal | undefined, operation: (signal: AbortSignal, check: () => void, identity: VerifiedAuthSession) => Promise<T>): Promise<T> => {
    const identity = requireSpecialist()
    const operationGeneration = generation
    const controller = new AbortController()
    active.add(controller)
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort('timeout'), DEADLINE_MS)
    const cancel = () => controller.abort('cancelled')
    if (callerSignal?.aborted) cancel()
    else callerSignal?.addEventListener('abort', cancel, { once: true })
    const check = () => {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason
        throw new ReviewRepositoryError(reason === 'timeout' ? 'timeout' : 'cancelled')
      }
      const current = auth.getVerifiedSession()
      if (disposed || operationGeneration !== generation || !current || current.id !== identity.id || current.role !== 'specialist' || current.accessToken !== identity.accessToken) fail('unauthorized')
    }
    try {
      check()
      return await operation(controller.signal, check, identity)
    } catch (error) {
      if (error instanceof ReviewRepositoryError) throw error
      if (controller.signal.aborted) {
        const reason = controller.signal.reason
        throw new ReviewRepositoryError(reason === 'timeout' ? 'timeout' : 'cancelled')
      }
      throw mappedError(error)
    } finally {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', cancel)
      active.delete(controller)
    }
  }

  const queryRows = async <T>(query: T, signal: AbortSignal, check: () => void): Promise<T> => {
    check()
    const result = await queryWithSignal(query, signal)
    check()
    return result
  }

  const listSessions = (signal?: AbortSignal) => run(signal, async (requestSignal, check, identity) => {
    const query = client!.from('sessions')
      .select('id, child_id, type, status, started_at, ended_at, run_by, children(id, first_name, grade, dialect_lexicon_id, is_demo, specialist_id)')
      .eq('status', 'completed')
      .in('type', ['assessment', 'probe'])
      .order('started_at', { ascending: false })
    const response = await queryRows(query, requestSignal, check) as { data: unknown; error: unknown | null }
    if (response.error) throw mappedError(response.error)
    const rows = boundedRows(response.data ?? [], MAX_ITEMS)
    return rows.map((raw) => {
      const session = sessionFromRow(raw)
      if (session.child_id === '') fail('schema')
      const child = childFromRow(childRelation(raw.children))
      if (child.id !== session.child_id || child.specialist_id !== identity.id) fail('schema')
      return { ...session, child, child_display_name: child.display_name, child_is_demo: child.is_demo } satisfies ReviewSessionListRow
    })
  })

  const loadSession = (sessionId: string, signal?: AbortSignal) => run(signal, async (requestSignal, check, identity) => {
    if (!sessionId) fail('schema')
    const sessionQuery = client!.from('sessions')
      .select('id, child_id, type, status, started_at, ended_at, run_by, children(id, first_name, grade, dialect_lexicon_id, is_demo, specialist_id)')
      .eq('id', sessionId)
      .eq('status', 'completed')
      .in('type', ['assessment', 'probe'])
      .maybeSingle()
    const sessionResponse = await queryRows(sessionQuery, requestSignal, check) as { data: unknown; error: unknown | null }
    if (sessionResponse.error) throw mappedError(sessionResponse.error)
    if (!sessionResponse.data) fail('forbidden')
    const rawSession = sessionResponse.data as RawRecord
    const session = sessionFromRow(rawSession)
    const child = childFromRow(childRelation(rawSession.children))
    if (session.child_id !== child.id || child.specialist_id !== identity.id) fail('forbidden')

    const itemsQuery = client!.from('item_results').select(ITEM_SELECT).eq('session_id', session.id).order('id', { ascending: true })
    const itemsResponse = await queryRows(itemsQuery, requestSignal, check) as { data: unknown; error: unknown | null }
    if (itemsResponse.error) throw mappedError(itemsResponse.error)
    const items = boundedRows(itemsResponse.data ?? [], MAX_ITEMS).map((row) => itemFromRow(row, session.id))

    const tapsQuery = client!.from('tap_results').select(TAP_SELECT).eq('session_id', session.id).order('id', { ascending: true })
    const tapsResponse = await queryRows(tapsQuery, requestSignal, check) as { data: unknown; error: unknown | null }
    if (tapsResponse.error) throw mappedError(tapsResponse.error)
    const taps = boundedRows(tapsResponse.data ?? [], MAX_TAPS).map((row) => tapFromRow(row, session.id))

    const fingerprintsQuery = client!.from('fingerprints').select(FINGERPRINT_SELECT).eq('session_id', session.id).order('id', { ascending: true })
    const fingerprintsResponse = await queryRows(fingerprintsQuery, requestSignal, check) as { data: unknown; error: unknown | null }
    if (fingerprintsResponse.error) throw mappedError(fingerprintsResponse.error)
    const fingerprints = boundedRows(fingerprintsResponse.data ?? [], MAX_FINGERPRINTS).map((row) => fingerprintFromRow(row, session.id))

    const plansQuery = client!.from('plans').select(PLAN_SELECT).eq('child_id', child.id).order('id', { ascending: true })
    const plansResponse = await queryRows(plansQuery, requestSignal, check) as { data: unknown; error: unknown | null }
    if (plansResponse.error) throw mappedError(plansResponse.error)
    const plans = boundedRows(plansResponse.data ?? [], MAX_PLANS).map((row) => planFromRow(row, child.id))

    const reportsQuery = client!.from('parent_reports').select(REPORT_SELECT).eq('child_id', child.id).eq('session_id', session.id).order('id', { ascending: true })
    const reportsResponse = await queryRows(reportsQuery, requestSignal, check) as { data: unknown; error: unknown | null }
    if (reportsResponse.error) throw mappedError(reportsResponse.error)
    const reports = boundedRows(reportsResponse.data ?? [], MAX_REPORTS).map((row) => reportFromRow(row, child.id, session.id))

    for (const row of fingerprints) associations.set(associationKey('fingerprints', row.id), { kind: 'fingerprints', sessionId: row.session_id, childId: child.id })
    for (const row of plans) associations.set(associationKey('plans', row.id), { kind: 'plans', childId: row.child_id })
    for (const row of reports) associations.set(associationKey('parent_reports', row.id), { kind: 'parent_reports', sessionId: row.session_id, childId: row.child_id })
    return { session, child, items, taps, fingerprints, plans, reports } satisfies ReviewSessionDetail
  })

  const createFingerprint = (detail: ReviewSessionDetail, scorer: ScorerClient, signal?: AbortSignal) => run(signal, async (requestSignal, check, identity) => {
    validateFingerprintDetail(detail)
    if (!scorer || detail.child.specialist_id !== identity.id) fail('forbidden')
    const sessionId = detail.session.id
    const current = detail.fingerprints.find((row) => row.session_id === sessionId)
    if (current) {
      const checked = fingerprintFromRow(current, sessionId)
      associations.set(associationKey('fingerprints', checked.id), { kind: 'fingerprints', sessionId, childId: detail.child.id })
      return checked
    }

    const existingQuery = client!.from('fingerprints').select(FINGERPRINT_SELECT).eq('session_id', sessionId).maybeSingle()
    const existingResponse = await queryRows(existingQuery, requestSignal, check) as { data: unknown; error: unknown | null }
    if (existingResponse.error) throw mappedError(existingResponse.error)
    if (existingResponse.data) {
      const existing = fingerprintFromRow(existingResponse.data, sessionId)
      associations.set(associationKey('fingerprints', existing.id), { kind: 'fingerprints', sessionId, childId: detail.child.id })
      return existing
    }

    const started = Date.parse(detail.session.started_at)
    const ended = Date.parse(detail.session.ended_at)
    if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) fail('schema')
    const itemResponses = detail.items.map((row) => scoreItemResponse(row.response))
    const tapEvidence = detail.taps.map((row) => skillEvidence(row.evidence))
    const request: FingerprintRequest = parseContract('FingerprintRequest', {
      session_id: sessionId,
      grade: detail.child.grade,
      duration_ms: ended - started,
      items: itemResponses,
      tap_results: tapEvidence,
    })
    check()
    let response: FingerprintResponse
    try {
      response = fingerprintResponse(await scorer.fingerprint(request, { signal: requestSignal }))
    } catch (error) {
      if (error instanceof ReviewRepositoryError) throw error
      fail('fingerprintUnavailable', true)
    }
    check()
    if (response.session_id !== sessionId) fail('schema')

    const id = fingerprintIds.get(sessionId) ?? uuid()
    fingerprintIds.set(sessionId, id)
    const insertQuery = client!.from('fingerprints')
      .insert({ id, session_id: sessionId, response, review_status: 'pending_review' })
      .select(FINGERPRINT_SELECT)
      .single()
    const inserted = await queryRows(insertQuery, requestSignal, check) as { data: unknown; error: unknown | null }
    if (inserted.error) {
      if (errorCode(inserted.error) === '23505') {
        const duplicateQuery = client!.from('fingerprints').select(FINGERPRINT_SELECT).eq('id', id).maybeSingle()
        const duplicate = await queryRows(duplicateQuery, requestSignal, check) as { data: unknown; error: unknown | null }
        if (duplicate.error) throw mappedError(duplicate.error)
        if (!duplicate.data) fail('conflict')
        const row = fingerprintFromRow(duplicate.data, sessionId)
        if (!stableEqual(row.response, response)) fail('conflict')
        associations.set(associationKey('fingerprints', row.id), { kind: 'fingerprints', sessionId, childId: detail.child.id })
        return row
      }
      throw mappedError(inserted.error)
    }
    if (!inserted.data) fail('schema')
    const row = fingerprintFromRow(inserted.data, sessionId)
    if (!stableEqual(row.response, response)) fail('conflict')
    associations.set(associationKey('fingerprints', row.id), { kind: 'fingerprints', sessionId, childId: detail.child.id })
    return row
  })

  const transition = (
    kind: ReviewTransitionKind,
    rowId: string,
    expected: ReviewStatus,
    target: ReviewStatus,
    note?: string,
    signal?: AbortSignal,
  ) => run(signal, async (requestSignal, check) => {
    if (!rowId) fail('schema')
    try {
      parseContract('ReviewStatus', expected)
      parseContract('ReviewStatus', target)
    } catch {
      fail('schema')
    }
    const validTransition = (expected === 'draft' && target === 'pending_review') ||
      (expected === 'pending_review' && (target === 'approved' || target === 'rejected'))
    if (!validTransition) fail('schema')

    const association = associations.get(associationKey(kind, rowId)) ?? await (async () => {
      const table = kind === 'fingerprints' ? 'fingerprints' : kind === 'plans' ? 'plans' : 'parent_reports'
      const fields = kind === 'fingerprints' ? 'id, session_id, sessions(child_id)' : kind === 'plans' ? 'id, child_id' : 'id, child_id, session_id'
      const lookup = client!.from(table).select(fields).eq('id', rowId).maybeSingle()
      const lookupResponse = await queryRows(lookup, requestSignal, check) as { data: unknown; error: unknown | null }
      if (lookupResponse.error) throw mappedError(lookupResponse.error)
      if (!lookupResponse.data || !isRecord(lookupResponse.data)) fail('lostUpdate')
      const found = lookupResponse.data
      const childId = kind === 'fingerprints'
        ? requiredString((childRelation(found.sessions) as RawRecord | null)?.child_id)
        : requiredString(found.child_id)
      return {
        kind,
        sessionId: kind === 'fingerprints' || kind === 'parent_reports' ? requiredString(found.session_id) : undefined,
        childId,
      }
    })()

    let payload: RawRecord = { review_status: target }
    if (kind === 'fingerprints' && note !== undefined) payload = { ...payload, review_note: note }
    const query = client!.from(kind).update(payload).eq('id', rowId).eq('review_status', expected)
    const constrained = association.sessionId
      ? query.eq('session_id', association.sessionId)
      : query.eq('child_id', association.childId)
    const updateQuery = constrained.select(kind === 'fingerprints' ? `${FINGERPRINT_SELECT}, sessions(child_id)` : kind === 'plans' ? PLAN_SELECT : REPORT_SELECT).single()
    const response = await queryRows(updateQuery, requestSignal, check) as { data: unknown; error: unknown | null }
    if (response.error) {
      if (errorCode(response.error) === 'PGRST116') fail('lostUpdate')
      throw mappedError(response.error)
    }
    if (!response.data) fail('lostUpdate')
    let row: ReviewTransitionAcknowledgement
    if (kind === 'fingerprints') row = fingerprintFromRow(response.data)
    else if (kind === 'plans') row = planFromRow(response.data)
    else row = reportFromRow(response.data)
    if (row.id !== rowId || row.review_status !== target) fail('lostUpdate')
    if (kind === 'fingerprints' && 'session_id' in row) {
      const returnedChildId = isRecord(response.data) ? requiredString((childRelation(response.data.sessions) as RawRecord | null)?.child_id) : ''
      if (row.session_id !== association.sessionId || returnedChildId !== association.childId) fail('lostUpdate')
    } else if (kind === 'plans' && 'child_id' in row) {
      if (row.child_id !== association.childId) fail('lostUpdate')
    } else if (kind === 'parent_reports' && 'child_id' in row && 'session_id' in row) {
      if (row.child_id !== association.childId || row.session_id !== association.sessionId) fail('lostUpdate')
    } else {
      fail('lostUpdate')
    }
    associations.set(associationKey(kind, rowId), association)
    return row
  })

  const downloadAudio = (detail: ReviewSessionDetail, item: ReviewItemRow, signal?: AbortSignal) => run(signal, async (requestSignal, check, identity) => {
    if (!detail || detail.session.status !== 'completed' || detail.child.specialist_id !== identity.id || detail.child.id !== detail.session.child_id) fail('forbidden')
    const stored = detail.items.find((candidate) => candidate.id === item.id)
    if (!stored || stored.session_id !== detail.session.id || item.session_id !== detail.session.id || item.item_id !== stored.item_id) fail('audioUnavailable')
    try {
      itemFromRow(stored, detail.session.id)
    } catch {
      fail('audioUnavailable')
    }
    const path = expectedAudioPath(detail.child.id, detail.session.id, stored.item_id)
    if (stored.audio_path === null) fail('audioUnavailable')
    if (stored.audio_path !== path || !stored.audio_expires_at || !Number.isFinite(Date.parse(stored.audio_expires_at))) fail('audioUnavailable')
    check()
    let response: StorageDownload
    try {
      response = await client!.storage.from('audio').download(path, undefined, { signal: requestSignal }) as StorageDownload
    } catch (error) {
      throw mappedError(error)
    }
    check()
    if (response.error || !response.data || !(response.data instanceof Blob)) fail('audioUnavailable')
    await validateWav(response.data, stored.response.audio_duration_ms, stored.synthetic)
    check()
    return response.data
  })

  const dispose = () => {
    if (disposed) return
    disposed = true
    generation += 1
    for (const controller of active) controller.abort('disposed')
    active.clear()
    stopAuth()
    clearIdentityCaches()
  }

  return { listSessions, loadSession, createFingerprint, transition, downloadAudio, dispose }
}

export type { ReviewRepository }
