import { describe, expect, it, vi } from 'vitest'
import type { AuthController, AuthSnapshot, VerifiedAuthSession } from '../auth/controller'
import type { ParentReport } from '../contracts/basira'
import skillGraph from '../../../contracts/skill-graph.json'
import { createParentReportRepository } from './repository'
import { ParentReportRepositoryError, type ApprovedReportSource } from './types'

const identity: VerifiedAuthSession = { id: 'guardian-1', role: 'guardian', accessToken: 'guardian-token' }
const skillId = skillGraph.skills[0].id
const content: ParentReport = {
  language: 'ar',
  child_first_name: 'سارة',
  session_date: '2026-01-01',
  duration_min: 5,
  practised: [{ skill_id: skillId, plain_ar: skillGraph.skills[0].label_ar }],
  progress_notes: [],
  home_plan: [{ title_ar: 'قراءة', minutes: 5, words: ['بَابٌ'], how_ar: 'اقرؤوا الكلمة بهدوء.' }],
  next_focus_ar: 'نواصل القراءة.',
  specialist: { name: 'أ. ليلى', contact: '555 1234' },
}

function authFixture(initial: VerifiedAuthSession = identity) {
  let current: VerifiedAuthSession | null = initial
  const listeners = new Set<() => void>()
  const snapshot = (): AuthSnapshot => current
    ? { status: 'signedIn', role: current.role, issue: null }
    : { status: 'signedOut', role: null, issue: null }
  const auth: AuthController = {
    getSnapshot: snapshot,
    getVerifiedSession: () => current,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    start: () => () => {},
    retry: async () => {},
    signIn: async () => {},
    signOut: async () => {},
  }
  return { auth, set(next: VerifiedAuthSession | null) { current = next; listeners.forEach((listener) => listener()) } }
}

type Result = { data: unknown; error: unknown | null }
type Builder = {
  select: (...args: unknown[]) => Builder
  eq: (...args: unknown[]) => Builder
  in: (...args: unknown[]) => Builder
  order: (...args: unknown[]) => Builder
  limit: (...args: unknown[]) => Builder
  insert: (value: unknown) => Builder
  abortSignal: (signal: AbortSignal) => Builder
  maybeSingle: () => Promise<Result>
  single: () => Promise<Result>
  then: <TResult1 = Result, TResult2 = never>(onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) => Promise<TResult1 | TResult2>
}

type FakeOptions = {
  list?: Result | (() => Result | Promise<Result>)
  single?: Result | (() => Result | Promise<Result>)
  insert?: Result | (() => Result | Promise<Result>)
}

function fakeClient(options: FakeOptions = {}) {
  const calls: string[] = []
  let inserted: Record<string, unknown> | null = null
  const resolve = async (value: Result | (() => Result | Promise<Result>) | undefined): Promise<Result> => typeof value === 'function' ? value() : value ?? { data: null, error: null }
  const builderFor = (table: string): Builder => {
    let operation = 'select'
    const builder = {} as Builder
    builder.select = () => builder
    builder.eq = () => builder
    builder.in = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.abortSignal = () => builder
    builder.insert = (value) => { operation = 'insert'; inserted = value as Record<string, unknown>; return builder }
    builder.maybeSingle = async () => {
      calls.push(`${operation}:${table}:maybeSingle`)
      return resolve(options.single)
    }
    builder.single = async () => {
      calls.push(`${operation}:${table}:single`)
      return operation === 'insert' ? resolve(options.insert) : resolve(options.single)
    }
    builder.then = (onfulfilled, onrejected) => resolve(options.list).then(onfulfilled, onrejected)
    return builder
  }
  return { client: { from: (table: string) => builderFor(table) }, calls, inserted: () => inserted }
}

function guardianRow(status: string, guardianId = identity.id) {
  return {
    id: 'report-1',
    child_id: 'child-1',
    session_id: 'session-1',
    content,
    pdf_path: null,
    review_status: status,
    approved_by: 'specialist-1',
    children: { first_name: 'سارة', is_demo: true, guardian_id: guardianId },
  }
}

function specialistSource(): ApprovedReportSource {
  const response = {
    session_id: 'session-1',
    model_version: 'fixture',
    rules_version: 'fixture',
    synthetic: true,
    features: {
      dot_confusion_rate: null, emphatic_confusion_rate: null, short_vowel_error_rate: null,
      positional_error_rate: null, omission_rate: null, insertion_rate: null, substitution_rate: null,
      wcpm: null, self_correction_rate: null, pseudoword_gap: null, vowelization_gap: null,
    },
    referral: { decision: 'no_referral_indicated' as const, rules_fired: [] },
    review_status: 'pending_review' as const,
  }
  return {
    detail: {
      session: { id: 'session-1', child_id: 'child-1', type: 'assessment', status: 'completed', started_at: '2026-01-01T10:00:00.000Z', ended_at: '2026-01-01T10:05:00.000Z', run_by: 'specialist-1' },
      child: { id: 'child-1', display_name: 'سارة', first_name: 'سارة', grade: 2, dialect_lexicon_id: 'kw', is_demo: true, specialist_id: 'specialist-1' },
      items: [], taps: [], fingerprints: [], plans: [], reports: [],
    },
    fingerprint: { id: 'fingerprint-1', session_id: 'session-1', response, review_status: 'approved', reviewed_by: 'specialist-1', reviewed_at: '2026-01-01T10:06:00.000Z', review_note: null },
    plan: { id: 'plan-1', child_id: 'child-1', skill_ids: [skillId], item_ids: [], review_status: 'approved', approved_by: 'specialist-1', approved_at: '2026-01-01T10:07:00.000Z' },
  }
}

describe('createParentReportRepository', () => {
  it.each(['draft', 'pending_review', 'rejected'])('denies guardian access to %s reports', async (status) => {
    const auth = authFixture()
    const fake = fakeClient({ list: { data: [guardianRow(status)], error: null } })
    const repository = createParentReportRepository(fake.client as never, auth.auth)
    await expect(repository.listGuardianReports()).rejects.toMatchObject({ issue: 'forbidden' })
    repository.dispose()
  })

  it('fails closed when an approved row is joined to another guardian', async () => {
    const auth = authFixture()
    const fake = fakeClient({ list: { data: [guardianRow('approved', 'guardian-2')], error: null } })
    const repository = createParentReportRepository(fake.client as never, auth.auth)
    await expect(repository.listGuardianReports()).rejects.toMatchObject({ issue: 'forbidden' })
    repository.dispose()
  })

  it('rejects a pre-aborted read before issuing a database request', async () => {
    const auth = authFixture()
    const fake = fakeClient({ list: { data: [guardianRow('approved')], error: null } })
    const repository = createParentReportRepository(fake.client as never, auth.auth)
    const signal = AbortSignal.timeout(1)
    await new Promise((resolve) => setTimeout(resolve, 2))
    await expect(repository.listGuardianReports(signal)).rejects.toMatchObject({ issue: 'cancelled' })
    expect(fake.calls).toHaveLength(0)
    repository.dispose()
  })

  it('cancels a late guardian read when the verified identity changes', async () => {
    const auth = authFixture()
    let release!: (result: Result) => void
    const fake = fakeClient({ list: () => new Promise<Result>((resolve) => { release = resolve }) })
    const repository = createParentReportRepository(fake.client as never, auth.auth)
    const pending = repository.listGuardianReports()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    auth.set(null)
    release({ data: [guardianRow('approved')], error: null })
    await expect(pending).rejects.toMatchObject({ issue: 'cancelled' })
    repository.dispose()
  })

  it('creates only a specialist-owned draft and acknowledges the server status', async () => {
    const specialist = { id: 'specialist-1', role: 'specialist' as const, accessToken: 'specialist-token' }
    const auth = authFixture(specialist)
    const fake = fakeClient({ insert: () => ({ data: { ...(fake.inserted() ?? {}), review_status: 'draft', approved_by: null, pdf_path: null }, error: null }) })
    const repository = createParentReportRepository(fake.client as never, auth.auth)
    const result = await repository.createDraft(specialistSource(), {
      progressNotes: [],
      homePlan: [{ title_ar: 'قراءة', minutes: 5, words: ['بَابٌ'], how_ar: 'اقرؤوا الكلمة.' }],
      nextFocusAr: 'نواصل القراءة.',
      specialist: { name: 'أ. ليلى', contact: '555 1234' },
    })
    expect(result.review_status).toBe('draft')
    expect(fake.inserted()).toMatchObject({ child_id: 'child-1', session_id: 'session-1', review_status: 'draft' })
    repository.dispose()
  })

  it('does not issue a draft request for a guardian identity', async () => {
    const auth = authFixture()
    const fake = fakeClient()
    const repository = createParentReportRepository(fake.client as never, auth.auth)
    await expect(repository.createDraft(specialistSource(), {
      progressNotes: [], homePlan: [{ title_ar: 'قراءة', minutes: 5, words: ['بَابٌ'], how_ar: 'اقرؤوا الكلمة.' }], nextFocusAr: 'نواصل القراءة.', specialist: { name: 'أ. ليلى', contact: '555 1234' },
    })).rejects.toBeInstanceOf(ParentReportRepositoryError)
    expect(fake.calls).toHaveLength(0)
    repository.dispose()
  })

  it('does not leak an unacknowledged insert status', async () => {
    const specialist = { id: 'specialist-1', role: 'specialist' as const, accessToken: 'specialist-token' }
    const auth = authFixture(specialist)
    const fake = fakeClient({ insert: () => ({ data: { ...(fake.inserted() ?? {}), review_status: 'approved', approved_by: 'specialist-1', pdf_path: null }, error: null }) })
    const repository = createParentReportRepository(fake.client as never, auth.auth)
    await expect(repository.createDraft(specialistSource(), {
      progressNotes: [], homePlan: [{ title_ar: 'قراءة', minutes: 5, words: ['بَابٌ'], how_ar: 'اقرؤوا الكلمة.' }], nextFocusAr: 'نواصل القراءة.', specialist: { name: 'أ. ليلى', contact: '555 1234' },
    })).rejects.toMatchObject({ issue: 'conflict' })
    repository.dispose()
  })
})
