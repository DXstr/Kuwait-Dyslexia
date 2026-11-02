import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuthController, type AuthSnapshot } from './controller'

type TestSession = ReturnType<typeof session>
type FakeAuth = {
  getSession: ReturnType<typeof vi.fn>
  exchangeCodeForSession: ReturnType<typeof vi.fn>
  getUser: ReturnType<typeof vi.fn>
  getClaims: ReturnType<typeof vi.fn>
  refreshSession: ReturnType<typeof vi.fn>
  signInWithOAuth: ReturnType<typeof vi.fn>
  signOut: ReturnType<typeof vi.fn>
  onAuthStateChange: ReturnType<typeof vi.fn>
  emit: (event: string, suppliedSession?: TestSession | null) => void
}

type FakeClient = {
  auth: FakeAuth
  from: ReturnType<typeof vi.fn>
}

const session = (token = 'access-token', userId = 'candidate-id') => ({
  access_token: token,
  refresh_token: 'refresh-token',
  expires_in: 3600,
  expires_at: 1_900_000_000,
  token_type: 'bearer',
  user: { id: userId, user_metadata: { role: 'admin' } },
})

const makeClient = ({
  currentSession = session(),
  profile = { id: 'candidate-id', role: 'specialist' },
  user = { id: 'candidate-id' },
  claims = { sub: 'candidate-id', app_role: 'specialist' },
}: {
  currentSession?: TestSession | null
  profile?: { id: string; role: string } | null
  user?: { id: string } | null
  claims?: Record<string, unknown>
} = {}): FakeClient => {
  let eventCallback: ((event: string, suppliedSession?: TestSession | null) => void) | null = null
  const auth: FakeAuth = {
    getSession: vi.fn(async () => ({ data: { session: currentSession }, error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ data: { session: currentSession }, error: null })),
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
    getClaims: vi.fn(async () => ({ data: { claims }, error: null })),
    refreshSession: vi.fn(async () => ({ data: { session: currentSession }, error: null })),
    signInWithOAuth: vi.fn(async () => ({ data: { provider: 'google', url: 'https://accounts.test' }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    onAuthStateChange: vi.fn((callback: (event: string, suppliedSession?: TestSession | null) => void) => {
      eventCallback = callback
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    }),
    emit: (event, suppliedSession) => eventCallback?.(event, suppliedSession),
  }
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: profile, error: null })),
  }
  return { auth, from: vi.fn(() => query) }
}

const controllerFor = (client: FakeClient, overrides: Partial<Parameters<typeof createAuthController>[1]> = {}) =>
  createAuthController(client as unknown as SupabaseClient, {
    origin: 'https://app.test/',
    ...overrides,
  })

const waitForStatus = async (controller: { getSnapshot: () => AuthSnapshot }, status: AuthSnapshot['status']) => {
  await vi.waitFor(() => expect(controller.getSnapshot().status).toBe(status))
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('createAuthController', () => {
  it('starts unconfigured without a client and retry preserves that state', async () => {
    const controller = createAuthController(null, { origin: 'https://app.test' })
    expect(controller.getSnapshot()).toEqual({ status: 'unconfigured', role: null, issue: 'configuration' })
    await controller.retry()
    expect(controller.getSnapshot()).toEqual({ status: 'unconfigured', role: null, issue: 'configuration' })
    controller.start()()
  })

  it('redeems a callback code once and scrubs the callback URL', async () => {
    const client = makeClient()
    const clearCallbackUrl = vi.fn()
    const controller = controllerFor(client, {
      callback: { code: 'one-use-code', error: false },
      clearCallbackUrl,
    })
    const stop = controller.start()
    controller.start()
    await waitForStatus(controller, 'signedIn')

    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('one-use-code')
    expect(clearCallbackUrl).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().role).toBe('specialist')
    stop()
  })

  it('fails closed for provider callback errors and missing codes', async () => {
    const clearCallbackUrl = vi.fn()
    const providerError = controllerFor(makeClient(), {
      callback: { code: null, error: true },
      clearCallbackUrl,
    })
    providerError.start()
    await waitForStatus(providerError, 'error')
    expect(providerError.getSnapshot().issue).toBe('callback')
    expect(clearCallbackUrl).toHaveBeenCalledTimes(1)

    const missingCode = controllerFor(makeClient(), {
      callback: { code: null, error: false },
    })
    missingCode.start()
    await waitForStatus(missingCode, 'error')
    expect(missingCode.getSnapshot().issue).toBe('callback')
  })

  it('blocks late auth events after a failed callback until retry', async () => {
    const client = makeClient()
    const controller = controllerFor(client, { callback: { code: null, error: true } })
    controller.start()
    await waitForStatus(controller, 'error')

    client.auth.emit('SIGNED_IN', session('late-token'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controller.getSnapshot()).toEqual({ status: 'error', role: null, issue: 'callback' })
    expect(client.auth.getUser).not.toHaveBeenCalled()

    await controller.retry()
    await waitForStatus(controller, 'signedIn')
    expect(client.auth.getUser).toHaveBeenCalled()
  })

  it('uses server identity and profile role, never user metadata', async () => {
    const client = makeClient({
      profile: { id: 'candidate-id', role: 'guardian' },
      claims: { sub: 'candidate-id', app_role: 'guardian' },
    })
    const controller = controllerFor(client)
    controller.start()
    await waitForStatus(controller, 'signedIn')
    expect(controller.getSnapshot().role).toBe('guardian')
    expect(controller.getSnapshot().role).not.toBe('admin')
    expect(client.from).toHaveBeenCalledWith('profiles')
  })

  it('refreshes at most once when the role claim is stale, then rechecks it', async () => {
    const client = makeClient()
    client.auth.getClaims
      .mockResolvedValueOnce({ data: { claims: { sub: 'candidate-id', app_role: 'guardian' } }, error: null })
      .mockResolvedValueOnce({ data: { claims: { sub: 'candidate-id', app_role: 'specialist' } }, error: null })
    client.auth.refreshSession.mockImplementationOnce(async () => {
      client.auth.emit('TOKEN_REFRESHED', session('refreshed-token'))
      return { data: { session: session('refreshed-token') }, error: null }
    })
    const stableController = controllerFor(client)
    stableController.start()
    await waitForStatus(stableController, 'signedIn')
    expect(client.auth.refreshSession).toHaveBeenCalledTimes(1)
    expect(client.auth.getClaims).toHaveBeenCalledTimes(2)
  })

  it('queues the latest event during hydration and clears the visible role during the transition', async () => {
    let releaseInitialSession: ((value: unknown) => void) | undefined
    const client = makeClient()
    client.auth.getSession.mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseInitialSession = resolve
      }),
    )
    client.auth.getUser.mockImplementation(async (accessToken: string) => ({
      data: { user: { id: accessToken === 'new-token' ? 'candidate-id' : 'candidate-id' } },
      error: null,
    }))
    const controller = controllerFor(client)
    controller.start()
    await Promise.resolve()

    const newSession = session('new-token')
    client.auth.emit('SIGNED_IN', newSession)
    expect(controller.getSnapshot().role).toBeNull()
    releaseInitialSession?.({ data: { session: session('old-token') }, error: null })

    await waitForStatus(controller, 'signedIn')
    expect(client.auth.getUser).toHaveBeenLastCalledWith('new-token')
    expect(controller.getSnapshot().role).toBe('specialist')
  })

  it('rejects missing profiles, failed identity verification, and offline restores', async () => {
    const missingProfile = controllerFor(makeClient({ profile: null }))
    missingProfile.start()
    await waitForStatus(missingProfile, 'error')
    expect(missingProfile.getSnapshot().issue).toBe('profile')

    const failedUserClient = makeClient()
    failedUserClient.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('no') })
    const failedUser = controllerFor(failedUserClient)
    failedUser.start()
    await waitForStatus(failedUser, 'error')
    expect(failedUser.getSnapshot().issue).toBe('session')

    const offline = controllerFor(makeClient(), { isOnline: () => false })
    offline.start()
    await waitForStatus(offline, 'error')
    expect(offline.getSnapshot().issue).toBe('unavailable')
  })

  it('cancels in-flight hydration immediately when retry detects offline', async () => {
    let releaseSession: ((value: unknown) => void) | undefined
    let online = true
    const client = makeClient()
    client.auth.getSession.mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseSession = resolve
      }),
    )
    const controller = controllerFor(client, { isOnline: () => online })
    controller.start()
    await Promise.resolve()

    online = false
    await controller.retry()
    expect(controller.getSnapshot()).toEqual({ status: 'error', role: null, issue: 'unavailable' })
    releaseSession?.({ data: { session: session() }, error: null })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controller.getSnapshot()).toEqual({ status: 'error', role: null, issue: 'unavailable' })
  })

  it('sends only approved OAuth providers with same-origin callback options and rejects redirect duplicates', async () => {
    const client = makeClient()
    const controller = controllerFor(client)
    controller.start()
    await controller.signIn('google')
    await controller.signIn('azure')
    expect(client.auth.signInWithOAuth).toHaveBeenCalledTimes(1)
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'https://app.test/auth/callback',
        queryParams: { prompt: 'select_account' },
      },
    })

    await controller.signOut()
    await controller.signIn('azure')
    expect(client.auth.signInWithOAuth).toHaveBeenLastCalledWith({
      provider: 'azure',
      options: {
        redirectTo: 'https://app.test/auth/callback',
        scopes: 'email',
        queryParams: { prompt: 'select_account' },
      },
    })
  })

  it('does not restore late hydration after signout and always invokes local cleanup', async () => {
    let releaseSession: ((value: unknown) => void) | undefined
    const client = makeClient()
    client.auth.getSession.mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseSession = resolve
      }),
    )
    const clearLocalSession = vi.fn()
    const controller = controllerFor(client, { clearLocalSession })
    controller.start()
    await controller.signOut()
    releaseSession?.({ data: { session: session() }, error: null })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(controller.getSnapshot()).toEqual({ status: 'signedOut', role: null, issue: null })
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(clearLocalSession).toHaveBeenCalledTimes(1)
  })

  it('guards a late OAuth completion after signout and waits before a new sign-in', async () => {
    let releaseOAuth: ((value: unknown) => void) | undefined
    const client = makeClient()
    client.auth.signInWithOAuth.mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseOAuth = resolve
      }),
    )
    let releaseSignOut: (() => void) | undefined
    client.auth.signOut.mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseSignOut = () => resolve({ error: null })
      }),
    )
    const controller = controllerFor(client)
    controller.start()
    const firstSignIn = controller.signIn('google')
    const signOut = controller.signOut()
    const secondSignIn = controller.signIn('azure')
    expect(client.auth.signInWithOAuth).toHaveBeenCalledTimes(1)

    releaseOAuth?.({ data: { provider: 'google', url: 'https://accounts.test' }, error: null })
    releaseSignOut?.()
    await Promise.all([firstSignIn, signOut, secondSignIn])
    expect(client.auth.signInWithOAuth).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().status).toBe('redirecting')
  })

  it('defers event verification outside the synchronous auth callback', async () => {
    vi.useFakeTimers()
    const client = makeClient({ currentSession: null })
    const controller = controllerFor(client)
    controller.start()
    await vi.advanceTimersByTimeAsync(0)
    client.auth.getSession.mockClear()

    client.auth.emit('TOKEN_REFRESHED', null)
    expect(client.auth.getSession).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(client.auth.getSession).toHaveBeenCalled()
    controller.start()()
  })
})
