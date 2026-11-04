import { describe, expect, it } from 'vitest'
import type { AuthController, AuthSnapshot, VerifiedAuthSession } from '../auth/controller'
import type { ScorerClient } from '../scorer/client'
import { createProbeRuntime } from './runtime'
import type { ProbeChild } from './types'

const identity: VerifiedAuthSession = { id: 'specialist-1', role: 'specialist', accessToken: 'verified-token' }
const child: ProbeChild = { id: 'child-1', firstName: 'طفل', grade: 3, dialectLexiconId: 'kw', isDemo: true }

function authFixture(role: VerifiedAuthSession['role'] = 'specialist') {
  let current: VerifiedAuthSession | null = { ...identity, role }
  let state: AuthSnapshot = { status: 'signedIn', role, issue: null }
  const listeners = new Set<() => void>()
  const auth: AuthController = {
    getSnapshot: () => state,
    getVerifiedSession: () => state.status === 'signedIn' ? current : null,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    start: () => () => {},
    retry: async () => {},
    signIn: async () => {},
    signOut: async () => {},
  }
  return {
    auth,
    set(next: AuthSnapshot, nextIdentity: VerifiedAuthSession | null = current) {
      state = next
      current = nextIdentity
      listeners.forEach((listener) => listener())
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function clientFixture(consent: ReturnType<typeof deferred<{ data: unknown; error: null }>>) {
  let sessionInserts = 0
  const consentQuery = {
    select: () => consentQuery,
    eq: () => consentQuery,
    order: () => consentQuery,
    limit: () => consentQuery,
    maybeSingle: () => consent.promise,
  }
  const sessionsQuery = {
    insert: () => { sessionInserts += 1; return sessionsQuery },
    select: () => sessionsQuery,
    single: async () => ({ data: { id: 'probe-session-1', child_id: child.id, started_at: '2026-01-01T00:00:00Z', status: 'in_progress' }, error: null }),
  }
  return {
    client: { from: (table: string) => table === 'consents' ? consentQuery : sessionsQuery },
    getSessionInserts: () => sessionInserts,
  }
}

const scorer = null as unknown as ScorerClient | null

describe('probe runtime guards', () => {
  it('does not create a probe session when the verified adult is lost during consent read', async () => {
    const auth = authFixture()
    const consent = deferred<{ data: unknown; error: null }>()
    const fixture = clientFixture(consent)
    const runtime = createProbeRuntime(fixture.client as never, auth.auth, scorer, window)
    const start = runtime.startSession(child)
    auth.set({ status: 'signedOut', role: null, issue: null }, null)
    consent.resolve({ data: { signed_at: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z' }, error: null })
    await expect(start).rejects.toThrow('authentication changed')
    expect(fixture.getSessionInserts()).toBe(0)
    expect(runtime.getActiveSession()).toBeNull()
    runtime.dispose()
  })

  it('rejects a guardian before consulting the database or starting recording', async () => {
    const auth = authFixture('guardian')
    const runtime = createProbeRuntime(null, auth.auth, scorer, window)
    await expect(runtime.startSession(child)).rejects.toThrow('specialist verification required')
    expect(runtime.getActiveSession()).toBeNull()
    runtime.dispose()
  })
})
