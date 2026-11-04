import { describe, expect, it } from 'vitest'
import type { AuthController, AuthSnapshot, VerifiedAuthSession } from '../auth/controller'
import { createAssessmentRuntime } from './runtime'
import type { AssessmentChild, AssessmentItem } from './types'

const identity: VerifiedAuthSession = { id: 'adult-1', role: 'specialist', accessToken: 'verified-token' }
const child: AssessmentChild = { id: 'child-1', firstName: 'طفل', grade: 2, dialectLexiconId: 'kw', isDemo: true }
const practiceItem: AssessmentItem = { id: 'vt-d681ae06', type: 'vowel_tap', text: 'سَ', dialectLexiconId: 'kw', synthetic: true }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}

function authFixture() {
  let snapshot: AuthSnapshot = { status: 'signedIn', role: 'specialist', issue: null }
  let verified = identity
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    getVerifiedSession: () => snapshot.status === 'signedIn' ? verified : null,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    setStatus(next: AuthSnapshot) { snapshot = next; listeners.forEach((listener) => listener()) },
    setIdentity(next: VerifiedAuthSession) { verified = next; snapshot = { status: 'signedIn', role: next.role, issue: null }; listeners.forEach((listener) => listener()) },
  }
}

function clientFixture(consent: ReturnType<typeof deferred<{ data: unknown; error: null }>>) {
  let sessionInserts = 0
  const consentScopes: string[] = []
  const sessionTypes: string[] = []
  const consentQuery = {
    select: () => consentQuery,
    eq: (column: string, value: string) => { if (column === 'scope') consentScopes.push(value); return consentQuery },
    order: () => consentQuery,
    limit: () => consentQuery,
    maybeSingle: () => consent.promise,
  }
  let updatedStatus = ''
  const sessionsQuery = {
    insert: (value: { type: string }) => { sessionInserts += 1; sessionTypes.push(value.type); return sessionsQuery },
    update: (value: { status: string }) => { updatedStatus = value.status; return sessionsQuery },
    eq: () => sessionsQuery,
    select: () => sessionsQuery,
    single: async () => ({ data: { id: 'session-1', child_id: child.id, started_at: new Date().toISOString(), status: 'in_progress' }, error: null }),
    maybeSingle: async () => ({ data: { id: 'session-1', status: updatedStatus }, error: null }),
  }
  const client = { from: (table: string) => table === 'consents' ? consentQuery : sessionsQuery }
  return { client, getSessionInserts: () => sessionInserts, getConsentScopes: () => consentScopes, getSessionTypes: () => sessionTypes }
}

const browser = window

describe('assessment runtime', () => {
  it('does not publish or insert a session when logout wins a delayed consent read', async () => {
    const auth = authFixture()
    const consent = deferred<{ data: unknown; error: null }>()
    const fixture = clientFixture(consent)
    const runtime = createAssessmentRuntime(fixture.client as never, auth as unknown as AuthController, { mode: 'mock' } as never, browser)

    const start = runtime.startSession(child)
    auth.setStatus({ status: 'signedOut', role: null, issue: null })
    consent.resolve({ data: { signed_at: '2026-01-01T00:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z' }, error: null })

    await expect(start).rejects.toThrow('authentication changed')
    expect(fixture.getSessionInserts()).toBe(0)
    expect(runtime.getActiveSession()).toBeNull()
    runtime.dispose()
  })

  it('returns one coherent stable snapshot and retains the queue compatibility getter', () => {
    const auth = authFixture()
    const consent = deferred<{ data: unknown; error: null }>()
    const fixture = clientFixture(consent)
    const runtime = createAssessmentRuntime(fixture.client as never, auth as unknown as AuthController, { mode: 'mock' } as never, browser)
    const first = runtime.getSnapshot()
    expect(runtime.getSnapshot()).toBe(first)
    expect(first.activeSession).toBeNull()
    expect(first.queue).toBe(runtime.getQueueSnapshot())
    runtime.dispose()
  })

  it('clears the prior child session when a different specialist finishes server verification', async () => {
    const auth = authFixture()
    const consent = deferred<{ data: unknown; error: null }>()
    const fixture = clientFixture(consent)
    const runtime = createAssessmentRuntime(fixture.client as never, auth as unknown as AuthController, { mode: 'mock' } as never, browser)
    consent.resolve({ data: { signed_at: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z' }, error: null })
    await runtime.startSession(child)
    auth.setStatus({ status: 'loading', role: null, issue: null })
    auth.setIdentity({ ...identity, id: 'another-adult' })
    expect(runtime.getActiveSession()).toBeNull()
    expect(runtime.getQueueSnapshot().pending).toBe(0)
    runtime.dispose()
  })

  it('clears an active session on same-account loss of specialist role', async () => {
    const auth = authFixture()
    const consent = deferred<{ data: unknown; error: null }>()
    const fixture = clientFixture(consent)
    const runtime = createAssessmentRuntime(fixture.client as never, auth as unknown as AuthController, { mode: 'mock' } as never, browser)
    consent.resolve({ data: { signed_at: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z' }, error: null })
    await runtime.startSession(child)
    auth.setIdentity({ ...identity, role: 'guardian' })
    expect(runtime.getActiveSession()).toBeNull()
    runtime.dispose()
  })

  it('retains only the completed in-memory child session so its thank-you screen can remain mounted', async () => {
    const auth = authFixture()
    const consent = deferred<{ data: unknown; error: null }>()
    const fixture = clientFixture(consent)
    const runtime = createAssessmentRuntime(fixture.client as never, auth as unknown as AuthController, { mode: 'mock' } as never, browser)
    consent.resolve({ data: { signed_at: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z' }, error: null })
    await runtime.startSession(child)
    await runtime.completeSession()
    expect(runtime.getActiveSession()?.completed).toBe(true)
    expect(runtime.getActiveSession()?.id).toBe('session-1')
    runtime.dispose()
  })

  it('requires practice consent and acknowledges a practice session without changing the item payload', async () => {
    const auth = authFixture()
    const consent = deferred<{ data: unknown; error: null }>()
    const fixture = clientFixture(consent)
    const runtime = createAssessmentRuntime(fixture.client as never, auth as unknown as AuthController, { mode: 'mock' } as never, browser)
    consent.resolve({ data: { signed_at: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z' }, error: null })

    const started = await runtime.startPracticeSession(child, [practiceItem])
    expect(fixture.getConsentScopes()).toEqual(['practice'])
    expect(fixture.getSessionTypes()).toEqual(['practice'])
    expect(started.type).toBe('practice')
    expect(started.items).toEqual([practiceItem])
    expect(runtime.getActiveSession()?.type).toBe('practice')
    runtime.dispose()
  })

  it('does not acknowledge a practice session after identity cancellation wins the consent read', async () => {
    const auth = authFixture()
    const consent = deferred<{ data: unknown; error: null }>()
    const fixture = clientFixture(consent)
    const runtime = createAssessmentRuntime(fixture.client as never, auth as unknown as AuthController, { mode: 'mock' } as never, browser)

    const start = runtime.startPracticeSession(child, [practiceItem])
    auth.setStatus({ status: 'signedOut', role: null, issue: null })
    consent.resolve({ data: { signed_at: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z' }, error: null })

    await expect(start).rejects.toThrow('authentication changed')
    expect(fixture.getSessionInserts()).toBe(0)
    expect(runtime.getActiveSession()).toBeNull()
    runtime.dispose()
  })
})
