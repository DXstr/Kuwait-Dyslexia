import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthController, VerifiedAuthSession } from '../auth/controller'
import { parseContract } from '../scorer/validation'
import type { ParentReportRow } from '../review/types'
import { buildParentReport } from './builder'
import type {
  ApprovedReportSource,
  GuardianReportRow,
  ParentReportCopy,
  ParentReportRepository,
} from './types'
import { ParentReportRepositoryError } from './types'

const REPORT_SELECT = 'id, child_id, session_id, content, pdf_path, review_status, approved_by'
const GUARDIAN_REPORT_SELECT = `${REPORT_SELECT}, children(first_name, is_demo, guardian_id)`
const MAX_REPORTS = 128
const DEADLINE_MS = 30_000

type RawRecord = Record<string, unknown>
type QueryWithAbort = { abortSignal?: (signal: AbortSignal) => unknown }

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function requiredString(value: unknown): string {
  if (!text(value)) throw new ParentReportRepositoryError('schema')
  return value
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return requiredString(value)
}

function reviewStatus(value: unknown): ParentReportRow['review_status'] {
  try {
    return parseContract('ReviewStatus', value)
  } catch {
    throw new ParentReportRepositoryError('schema')
  }
}

function reportRow(value: unknown, options: { approvedOnly?: boolean; childId?: string; sessionId?: string } = {}): ParentReportRow {
  if (!isRecord(value)) throw new ParentReportRepositoryError('schema')
  const status = reviewStatus(value.review_status)
  if (options.approvedOnly && status !== 'approved' && status !== 'delivered') throw new ParentReportRepositoryError('forbidden')
  const row: ParentReportRow = {
    id: requiredString(value.id),
    child_id: requiredString(value.child_id),
    session_id: requiredString(value.session_id),
    content: (() => {
      try { return parseContract('ParentReport', value.content) } catch { throw new ParentReportRepositoryError('schema') }
    })(),
    pdf_path: nullableString(value.pdf_path),
    review_status: status,
    approved_by: nullableString(value.approved_by),
  }
  if ((options.childId && row.child_id !== options.childId) || (options.sessionId && row.session_id !== options.sessionId)) throw new ParentReportRepositoryError('schema')
  if (row.pdf_path !== null && row.pdf_path !== `reports/${row.child_id}/${row.id}.pdf`) throw new ParentReportRepositoryError('schema')
  return row
}

function childRelation(value: unknown): RawRecord | null {
  if (Array.isArray(value)) return value.length === 1 && isRecord(value[0]) ? value[0] : null
  return isRecord(value) ? value : null
}

function guardianRow(value: unknown, guardianId: string): GuardianReportRow {
  if (!isRecord(value)) throw new ParentReportRepositoryError('schema')
  const report = reportRow(value, { approvedOnly: true })
  const child = childRelation(value.children)
  if (!child || !text(child.first_name) || typeof child.is_demo !== 'boolean' || child.guardian_id !== guardianId) throw new ParentReportRepositoryError('forbidden')
  return { ...report, child_first_name: child.first_name, child_is_demo: child.is_demo }
}

function mapped(error: unknown): ParentReportRepositoryError {
  if (error instanceof ParentReportRepositoryError) return error
  const code = isRecord(error) ? error.code ?? error.status : undefined
  if (code === 401 || code === '401') return new ParentReportRepositoryError('unauthorized')
  if (code === 403 || code === '403' || code === '42501') return new ParentReportRepositoryError('forbidden')
  if (code === '23505') return new ParentReportRepositoryError('conflict')
  if (code === '23514' || code === '22P02') return new ParentReportRepositoryError('schema')
  return new ParentReportRepositoryError('network', true)
}

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  throw new ParentReportRepositoryError('unavailable')
}

function withAbort<T>(query: T, signal: AbortSignal): T {
  const candidate = query as T & QueryWithAbort
  return typeof candidate.abortSignal === 'function' ? candidate.abortSignal(signal) as T : query
}

export function createParentReportRepository(client: SupabaseClient | null, auth: AuthController): ParentReportRepository {
  let disposed = false
  let generation = 0
  const active = new Set<AbortController>()
  const stopAuth = auth.subscribe(() => {
    generation += 1
    for (const request of active) request.abort('identity-changed')
  })

  const requireIdentity = (role: VerifiedAuthSession['role']): VerifiedAuthSession => {
    if (disposed || !client) throw new ParentReportRepositoryError('unavailable')
    const identity = auth.getVerifiedSession()
    if (!identity) throw new ParentReportRepositoryError('unauthorized')
    if (identity.role !== role) throw new ParentReportRepositoryError('forbidden')
    return identity
  }

  const run = async <T>(role: VerifiedAuthSession['role'], callerSignal: AbortSignal | undefined, operation: (signal: AbortSignal, identity: VerifiedAuthSession, check: () => void) => Promise<T>): Promise<T> => {
    const identity = requireIdentity(role)
    const operationGeneration = generation
    const controller = new AbortController()
    active.add(controller)
    const timer = setTimeout(() => controller.abort('timeout'), DEADLINE_MS)
    const cancel = () => controller.abort('cancelled')
    if (callerSignal?.aborted) cancel()
    else callerSignal?.addEventListener('abort', cancel, { once: true })
    const check = () => {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason
        throw new ParentReportRepositoryError(reason === 'timeout' ? 'timeout' : 'cancelled')
      }
      const current = auth.getVerifiedSession()
      if (disposed || operationGeneration !== generation || !current || current.id !== identity.id || current.role !== identity.role || current.accessToken !== identity.accessToken) throw new ParentReportRepositoryError('unauthorized')
    }
    try {
      check()
      return await operation(controller.signal, identity, check)
    } catch (error) {
      if (error instanceof ParentReportRepositoryError) throw error
      if (controller.signal.aborted) throw new ParentReportRepositoryError(controller.signal.reason === 'timeout' ? 'timeout' : 'cancelled')
      throw mapped(error)
    } finally {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', cancel)
      active.delete(controller)
    }
  }

  const createDraft = (source: ApprovedReportSource, copy: ParentReportCopy, signal?: AbortSignal) => run('specialist', signal, async (requestSignal, identity, check) => {
    if (source.detail.child.specialist_id !== identity.id) throw new ParentReportRepositoryError('forbidden')
    const content = buildParentReport(source, copy)
    const id = uuid()
    const query = withAbort(client!.from('parent_reports')
      .insert({ id, child_id: source.detail.child.id, session_id: source.detail.session.id, content, review_status: 'draft' })
      .select(REPORT_SELECT)
      .single(), requestSignal)
    check()
    const response = await query as { data: unknown; error: unknown | null }
    check()
    if (response.error) throw mapped(response.error)
    const row = reportRow(response.data, { childId: source.detail.child.id, sessionId: source.detail.session.id })
    if (row.id !== id || row.review_status !== 'draft') throw new ParentReportRepositoryError('conflict')
    return row
  })

  const listGuardianReports = (signal?: AbortSignal) => run('guardian', signal, async (requestSignal, identity, check) => {
    const query = withAbort(client!.from('parent_reports')
      .select(GUARDIAN_REPORT_SELECT)
      .in('review_status', ['approved', 'delivered'])
      .order('id', { ascending: false })
      .limit(MAX_REPORTS), requestSignal)
    const response = await query as { data: unknown; error: unknown | null }
    check()
    if (response.error) throw mapped(response.error)
    if (!Array.isArray(response.data) || response.data.length > MAX_REPORTS) throw new ParentReportRepositoryError('schema')
    return response.data.map((row) => guardianRow(row, identity.id))
  })

  const getGuardianReport = (reportId: string, signal?: AbortSignal) => run('guardian', signal, async (requestSignal, identity, check) => {
    if (!text(reportId)) throw new ParentReportRepositoryError('schema')
    const query = withAbort(client!.from('parent_reports')
      .select(GUARDIAN_REPORT_SELECT)
      .eq('id', reportId)
      .in('review_status', ['approved', 'delivered'])
      .maybeSingle(), requestSignal)
    const response = await query as { data: unknown; error: unknown | null }
    check()
    if (response.error) throw mapped(response.error)
    if (!response.data) throw new ParentReportRepositoryError('forbidden')
    return guardianRow(response.data, identity.id)
  })

  return {
    createDraft,
    listGuardianReports,
    getGuardianReport,
    dispose() {
      if (disposed) return
      disposed = true
      generation += 1
      for (const request of active) request.abort('disposed')
      active.clear()
      stopAuth()
    },
  }
}
