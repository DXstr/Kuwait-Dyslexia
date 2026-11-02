import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthController, AuthSnapshot, VerifiedAuthSession } from '../auth/controller'
import type { AppRole } from '../routing/roles'
import { startScorerRuntime } from './runtime'

const sessionFor = (id = 'adult-1', role: AppRole = 'specialist', token = 'synthetic-token'):
  VerifiedAuthSession => ({ id, role, accessToken: token })

function authFixture(
  initial: AuthSnapshot,
  initialSession: VerifiedAuthSession | null = initial.status === 'signedIn' && initial.role
    ? sessionFor('adult-1', initial.role)
    : null,
) {
  let snapshot = initial
  let verified = initialSession
  const listeners = new Set<() => void>()
  const controller: AuthController = {
    getSnapshot: () => snapshot,
    getVerifiedSession: () => snapshot.status === 'signedIn' ? verified : null,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start: () => () => {},
    retry: async () => {},
    signIn: async () => {},
    signOut: async () => {},
  }
  return {
    controller,
    update(next: AuthSnapshot, nextSession = verified) {
      snapshot = next
      verified = nextSession
      for (const listener of [...listeners]) listener()
    },
  }
}

function healthResponse(status: 'ok' | 'warming' | 'degraded' = 'ok', modelLoaded = true) {
  return new Response(JSON.stringify({
    status,
    model_loaded: modelLoaded,
    model_version: 'synthetic-model',
    rules_version: 'synthetic-rules',
    contracts_version: 'synthetic-contracts',
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

const signedIn: AuthSnapshot = { status: 'signedIn', role: 'specialist', issue: null }
const signedOut: AuthSnapshot = { status: 'signedOut', role: null, issue: null }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('startScorerRuntime', () => {
  it('checks once for a restored verified session and deduplicates auth revalidation', async () => {
    const fetcher = vi.fn(async () => healthResponse())
    vi.stubGlobal('fetch', fetcher)
    const auth = authFixture(signedIn)
    const runtime = startScorerRuntime({
      VITE_SCORER_MODE: 'real',
      VITE_SCORER_URL: 'https://scorer.example',
    }, auth.controller)

    await vi.waitFor(() => expect(runtime.getSnapshot().phase).toBe('ready'))
    expect(fetcher).toHaveBeenCalledTimes(1)
    auth.update(signedIn, sessionFor('adult-1', 'specialist', 'refreshed-token'))
    auth.update(signedIn, sessionFor('adult-1', 'specialist', 'another-token'))
    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledTimes(1)
    runtime.dispose()
  })

  it('does not health-check unverified auth and starts after verified sign-in', async () => {
    const fetcher = vi.fn(async () => healthResponse())
    vi.stubGlobal('fetch', fetcher)
    const auth = authFixture({ status: 'loading', role: null, issue: null }, null)
    const runtime = startScorerRuntime({
      VITE_SCORER_MODE: 'real',
      VITE_SCORER_URL: 'https://scorer.example',
    }, auth.controller)
    await Promise.resolve()
    expect(fetcher).not.toHaveBeenCalled()

    auth.update(signedIn, sessionFor())
    await vi.waitFor(() => expect(runtime.getSnapshot().phase).toBe('ready'))
    expect(fetcher).toHaveBeenCalledTimes(1)
    runtime.dispose()
  })

  it('surfaces a health error without changing the verified auth state', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('synthetic network failure') })
    vi.stubGlobal('fetch', fetcher)
    const auth = authFixture(signedIn)
    const runtime = startScorerRuntime({
      VITE_SCORER_MODE: 'real',
      VITE_SCORER_URL: 'https://scorer.example',
    }, auth.controller)

    await vi.waitFor(() => expect(runtime.getSnapshot()).toMatchObject({ phase: 'unavailable', issue: 'network' }))
    expect(auth.controller.getSnapshot()).toEqual(signedIn)
    expect(auth.controller.getVerifiedSession()).toEqual(sessionFor())
    runtime.dispose()
  })

  it('fails closed for invalid configuration without creating a client', () => {
    const auth = authFixture(signedOut)
    const runtime = startScorerRuntime({ VITE_SCORER_MODE: 'real' }, auth.controller)
    expect(runtime.getSnapshot()).toEqual({ phase: 'unavailable', issue: 'configuration', mode: null })
    expect(runtime.getClient()).toBeNull()
    runtime.dispose()
  })

  it('ignores a late health completion after sign-out or disposal', async () => {
    let release: (response: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const fetcher = vi.fn(() => pending)
    vi.stubGlobal('fetch', fetcher)
    const auth = authFixture(signedIn)
    const runtime = startScorerRuntime({
      VITE_SCORER_MODE: 'real',
      VITE_SCORER_URL: 'https://scorer.example',
    }, auth.controller)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))

    auth.update(signedOut, null)
    expect(runtime.getSnapshot()).toMatchObject({ phase: 'idle', issue: null })
    release(healthResponse())
    await Promise.resolve()
    await Promise.resolve()
    expect(runtime.getSnapshot().phase).toBe('idle')

    auth.update(signedIn, sessionFor())
    runtime.dispose()
    release(healthResponse())
    await Promise.resolve()
    expect(runtime.getClient()).toBeNull()
  })
})
