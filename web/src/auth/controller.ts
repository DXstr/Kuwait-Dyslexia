import type { Session, SupabaseClient } from '@supabase/supabase-js'
import type { AppRole } from '../routing/roles'
import { roleHome } from '../routing/roles'

export type OAuthProvider = 'google' | 'azure'

export type AuthIssue =
  | 'configuration'
  | 'unavailable'
  | 'callback'
  | 'session'
  | 'profile'
  | 'role'
  | 'signIn'
  | 'signOut'

export type AuthSnapshot = {
  status: 'unconfigured' | 'loading' | 'signedOut' | 'signedIn' | 'error' | 'redirecting'
  role: AppRole | null
  issue: AuthIssue | null
}

export interface AuthController {
  getSnapshot(): AuthSnapshot
  subscribe(listener: () => void): () => void
  start(): () => void
  retry(): Promise<void>
  signIn(provider: OAuthProvider): Promise<void>
  signOut(): Promise<void>
}

type AuthCallback = {
  code: string | null
  error: boolean
}

type AuthOptions = {
  origin: string
  callback?: AuthCallback
  clearCallbackUrl?: () => void
  clearLocalSession?: () => void
  isOnline?: () => boolean
}

type AuthResponse<T> = {
  data: T
  error: unknown
}

type ProfileRow = {
  id: unknown
  role: unknown
}

type VerifiedIdentity = {
  id: string
  role: AppRole
  accessToken: string
}

type VerificationIssue = 'unavailable' | 'session' | 'profile' | 'role'
type PendingVerification = {
  session?: Session | null
  failureIssue: AuthIssue
}

const safeWarning = (operation: string, issue?: string) => {
  // Never include provider errors, sessions, tokens, codes, or user data in logs.
  console.warn(issue ? `auth: ${operation}:${issue}` : `auth: ${operation}`)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isAppRole = (value: unknown): value is AppRole =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(roleHome, value)

const isSession = (value: unknown): value is Session => {
  if (!isRecord(value)) return false
  return typeof value.access_token === 'string' && value.access_token.length > 0
}

const normalizeOrigin = (origin: string) => origin.replace(/\/+$/, '')

const verificationFailure = (issue: VerificationIssue) => new Error(issue)

export function createAuthController(
  client: SupabaseClient | null,
  options: AuthOptions,
): AuthController {
  let snapshot: AuthSnapshot = client
    ? { status: 'loading', role: null, issue: null }
    : { status: 'unconfigured', role: null, issue: 'configuration' }
  const listeners = new Set<() => void>()
  let started = false
  let generation = 0
  let stopGeneration = 0
  let initialization: Promise<void> | null = null
  let signInOperation: Promise<void> | null = null
  let signOutOperation: Promise<void> | null = null
  let verification: Promise<void> | null = null
  let subscription: { unsubscribe: () => void } | null = null
  let callbackConsumed = false
  let callbackSettled = false
  let callbackBlocked = false
  let eventTimer: ReturnType<typeof setTimeout> | null = null
  let activeStop: (() => void) | null = null
  let pendingVerification: PendingVerification | null = null
  let trustedIdentityId: string | null = null
  let trustedAccessToken: string | null = null
  let ownedRefreshInFlight = false
  let signingOut = false

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        safeWarning('subscriber', 'notification')
      }
    }
  }

  const setSnapshot = (next: AuthSnapshot) => {
    if (
      snapshot.status === next.status &&
      snapshot.role === next.role &&
      snapshot.issue === next.issue
    ) {
      return
    }
    snapshot = next
    notify()
  }

  const isCurrent = (workGeneration: number) => started && generation === workGeneration

  const online = () => options.isOnline?.() ?? true

  const fail = (issue: AuthIssue, workGeneration?: number) => {
    if (workGeneration !== undefined && !isCurrent(workGeneration)) return
    setSnapshot({ status: 'error', role: null, issue })
  }

  const clearCallback = () => {
    try {
      options.clearCallbackUrl?.()
    } catch {
      safeWarning('callback-cleanup', 'callback')
    }
  }

  const readProfile = async (userId: string): Promise<ProfileRow | null> => {
    if (!client) return null
    const response = await client
      .from('profiles')
      .select('id, role')
      .eq('id', userId)
      .maybeSingle()
    if (response.error) throw response.error
    return (response.data ?? null) as ProfileRow | null
  }

  const verifyClaimsAndProfile = async (
    session: Session,
    workGeneration: number,
    refreshAllowed: boolean,
  ): Promise<VerifiedIdentity> => {
    if (!client || !isCurrent(workGeneration)) throw verificationFailure('session')
    if (!online()) throw verificationFailure('unavailable')

    const userResponse = (await client.auth.getUser(session.access_token)) as AuthResponse<{
      user: { id?: unknown } | null
    }>
    if (!isCurrent(workGeneration)) throw verificationFailure('session')
    if (!online()) throw verificationFailure('unavailable')
    if (userResponse.error || !userResponse.data?.user || typeof userResponse.data.user.id !== 'string') {
      throw verificationFailure('session')
    }
    const userId = userResponse.data.user.id

    let profile: ProfileRow | null
    try {
      profile = await readProfile(userId)
    } catch {
      throw verificationFailure('profile')
    }
    if (!isCurrent(workGeneration)) throw verificationFailure('session')
    if (!online()) throw verificationFailure('unavailable')
    if (!profile || profile.id !== userId || !isAppRole(profile.role)) {
      throw verificationFailure('profile')
    }

    const claimsResponse = await client.auth.getClaims(session.access_token)
    if (!isCurrent(workGeneration)) throw verificationFailure('session')
    if (!online()) throw verificationFailure('unavailable')
    if (claimsResponse.error || !claimsResponse.data) throw verificationFailure('role')
    const claims: unknown = claimsResponse.data.claims
    const sub = isRecord(claims) ? claims.sub : undefined
    const appRole = isRecord(claims) ? claims.app_role : undefined

    if (sub !== userId) throw verificationFailure('role')
    if (appRole !== profile.role) {
      if (!refreshAllowed) throw verificationFailure('role')
      if (!online()) throw verificationFailure('unavailable')
      ownedRefreshInFlight = true
      try {
        const refreshed = await client.auth.refreshSession()
        if (!isCurrent(workGeneration)) throw verificationFailure('session')
        if (!online()) throw verificationFailure('unavailable')
        if (refreshed.error || !isSession(refreshed.data?.session)) {
          throw verificationFailure('role')
        }
        return verifyClaimsAndProfile(refreshed.data.session, workGeneration, false)
      } finally {
        // Supabase emits TOKEN_REFRESHED synchronously before this promise resolves.
        ownedRefreshInFlight = false
      }
    }

    return { id: userId, role: profile.role, accessToken: session.access_token }
  }

  const verifySession = async (
    workGeneration: number,
    suppliedSession?: Session | null,
    failureIssue: AuthIssue = 'session',
  ): Promise<void> => {
    if (!client || !isCurrent(workGeneration)) return
    if (!online()) {
      fail('unavailable', workGeneration)
      return
    }

    let session: Session | null = suppliedSession ?? null
    if (suppliedSession === undefined) {
      const response = await client.auth.getSession()
      if (!isCurrent(workGeneration)) return
      if (!online()) {
        fail('unavailable', workGeneration)
        return
      }
      if (response.error) {
        fail(failureIssue, workGeneration)
        return
      }
      session = response.data.session
    }

    if (!isCurrent(workGeneration)) return
    if (!session || !isSession(session)) {
      trustedIdentityId = null
      trustedAccessToken = null
      setSnapshot({ status: 'signedOut', role: null, issue: null })
      return
    }

    try {
      const identity = await verifyClaimsAndProfile(session, workGeneration, true)
      if (!isCurrent(workGeneration)) return
      trustedIdentityId = identity.id
      trustedAccessToken = identity.accessToken
      setSnapshot({ status: 'signedIn', role: identity.role, issue: null })
    } catch (error) {
      if (!isCurrent(workGeneration)) return
      const issue: AuthIssue =
        error instanceof Error &&
        (error.message === 'unavailable' ||
          error.message === 'session' ||
          error.message === 'profile' ||
          error.message === 'role')
          ? error.message
          : failureIssue
      safeWarning('verification', issue)
      fail(issue, workGeneration)
    }
  }

  const pumpVerification = () => {
    if (!started || !client || !pendingVerification || initialization || verification) return
    if (eventTimer !== null) return
    eventTimer = setTimeout(() => {
      eventTimer = null
      if (!started || !client || !pendingVerification || initialization || verification) return
      const request = pendingVerification
      pendingVerification = null
      const workGeneration = generation
      if (!online()) {
        fail('unavailable', workGeneration)
        return
      }
      trackVerification(verifySession(workGeneration, request.session, request.failureIssue))
    }, 0)
  }

  const trackVerification = (operation: Promise<void>) => {
    const tracked = operation
      .catch(() => {
        // verifySession normally handles failures; this protects unexpected SDK failures.
        safeWarning('verification', 'session')
      })
      .finally(() => {
        if (verification === tracked) verification = null
        pumpVerification()
      })
    verification = tracked
    return tracked
  }

  const queueVerification = (session?: Session | null, failureIssue: AuthIssue = 'session') => {
    pendingVerification = { session, failureIssue }
    pumpVerification()
  }

  const invalidateTrustedState = (status: AuthSnapshot['status'] = 'loading') => {
    generation += 1
    trustedIdentityId = null
    trustedAccessToken = null
    pendingVerification = null
    setSnapshot({ status, role: null, issue: null })
    return generation
  }

  const handleAuthEvent = (event: string, eventSession?: Session | null) => {
    // This callback is deliberately synchronous. Supabase warns against awaiting auth calls here.
    if (!started || signingOut || callbackBlocked) return
    if (options.callback && !callbackSettled) return

    if (event === 'SIGNED_OUT') {
      invalidateTrustedState('signedOut')
      return
    }

    if (
      event !== 'INITIAL_SESSION' &&
      event !== 'SIGNED_IN' &&
      event !== 'TOKEN_REFRESHED' &&
      event !== 'USER_UPDATED'
    ) {
      return
    }

    if (event === 'TOKEN_REFRESHED' && ownedRefreshInFlight) return

    const suppliedSession = isSession(eventSession) ? eventSession : undefined
    const sameTrustedToken = suppliedSession?.access_token === trustedAccessToken
    if (
      event === 'SIGNED_IN' &&
      snapshot.status === 'signedIn' &&
      ((suppliedSession && sameTrustedToken) || (!suppliedSession && trustedIdentityId !== null))
    ) {
      return
    }
    if (event === 'TOKEN_REFRESHED' && snapshot.status === 'signedIn' && sameTrustedToken) return

    invalidateTrustedState('loading')
    queueVerification(suppliedSession)
  }

  const initialize = async (workGeneration: number): Promise<void> => {
    if (!client || !isCurrent(workGeneration)) return
    const callback = options.callback
    if (callback && !callbackConsumed) {
      callbackConsumed = true
      clearCallback()
      if (callback.error || !callback.code) {
        callbackSettled = true
        callbackBlocked = true
        safeWarning('callback', 'callback')
        fail('callback', workGeneration)
        return
      }
      if (!online()) {
        callbackSettled = true
        callbackBlocked = true
        safeWarning('callback', 'unavailable')
        fail('unavailable', workGeneration)
        return
      }
      try {
        const exchanged = await client.auth.exchangeCodeForSession(callback.code)
        if (!isCurrent(workGeneration)) return
        if (exchanged.error || !isSession(exchanged.data?.session)) {
          callbackSettled = true
          callbackBlocked = true
          safeWarning('callback', 'callback')
          fail('callback', workGeneration)
          return
        }
        await trackVerification(verifySession(workGeneration, exchanged.data.session, 'callback'))
        if (!isCurrent(workGeneration)) return
        callbackSettled = true
      } catch {
        callbackSettled = true
        callbackBlocked = true
        safeWarning('callback', 'callback')
        fail('callback', workGeneration)
      }
      return
    }
    await trackVerification(verifySession(workGeneration))
  }

  const begin = () => {
    if (!client) {
      setSnapshot({ status: 'unconfigured', role: null, issue: 'configuration' })
      return Promise.resolve()
    }
    if (initialization) return initialization
    const workGeneration = generation
    setSnapshot({ status: 'loading', role: null, issue: null })
    initialization = initialize(workGeneration)
      .catch(() => {
        safeWarning('initialization', 'session')
        fail('session', workGeneration)
      })
      .finally(() => {
        initialization = null
        pumpVerification()
      })
    return initialization
  }

  const stop = () => {
    if (!started) return
    started = false
    generation += 1
    stopGeneration += 1
    if (eventTimer !== null) clearTimeout(eventTimer)
    eventTimer = null
    pendingVerification = null
    subscription?.unsubscribe()
    subscription = null
    callbackSettled = true
    callbackBlocked = false
    initialization = null
    verification = null
  }

  const controller: AuthController = {
    getSnapshot: () => snapshot,

    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    start: () => {
      if (started && activeStop) return activeStop
      started = true
      const startGeneration = ++generation
      if (client) {
        subscription = client.auth.onAuthStateChange((event, eventSession) =>
          handleAuthEvent(event, eventSession),
        ).data.subscription
      }
      void begin().catch(() => {
        safeWarning('start', 'session')
        fail('session', startGeneration)
      })
      const thisStopGeneration = ++stopGeneration
      activeStop = () => {
        if (thisStopGeneration !== stopGeneration) return
        stop()
      }
      return activeStop
    },

    retry: async () => {
      if (!client) {
        // The UI may offer provider buttons in this state; do not turn configuration into an error.
        return
      }
      if (!online()) {
        invalidateTrustedState('error')
        safeWarning('retry', 'unavailable')
        setSnapshot({ status: 'error', role: null, issue: 'unavailable' })
        return
      }
      if (!started) {
        started = true
        ++generation
      }
      callbackBlocked = false
      const workGeneration = invalidateTrustedState('loading')
      if (initialization || verification) {
        queueVerification(undefined)
        return
      }
      await trackVerification(verifySession(workGeneration))
    },

    signIn: async (provider) => {
      if (snapshot.status === 'redirecting') return
      if (signOutOperation) {
        await signOutOperation
        return controller.signIn(provider)
      }
      if (signInOperation) return signInOperation
      if (!client || (provider !== 'google' && provider !== 'azure')) {
        const issue = client ? 'signIn' : 'configuration'
        safeWarning('signIn', issue)
        fail(issue)
        return
      }

      callbackSettled = true
      callbackBlocked = false
      const workGeneration = invalidateTrustedState('loading')
      const redirectTo = `${normalizeOrigin(options.origin)}/auth/callback`
      signInOperation = (async () => {
        try {
          const oauthOptions =
            provider === 'azure'
              ? { redirectTo, scopes: 'email', queryParams: { prompt: 'select_account' } }
              : { redirectTo, queryParams: { prompt: 'select_account' } }
          const response = await client.auth.signInWithOAuth({
            provider,
            options: oauthOptions,
          })
          if (!isCurrent(workGeneration)) return
          if (response.error) {
            safeWarning('signIn', 'signIn')
            fail('signIn', workGeneration)
            return
          }
          setSnapshot({ status: 'redirecting', role: null, issue: null })
        } catch {
          if (!isCurrent(workGeneration)) return
          safeWarning('signIn', 'signIn')
          fail('signIn', workGeneration)
        }
      })().finally(() => {
        signInOperation = null
      })
      await signInOperation
    },

    signOut: async () => {
      if (signOutOperation) return signOutOperation
      const workGeneration = invalidateTrustedState('signedOut')
      signingOut = true
      signOutOperation = (async () => {
        let failed = false
        if (client) {
          try {
            const response = await client.auth.signOut({ scope: 'local' })
            failed = Boolean(response.error)
          } catch {
            failed = true
          }
        }
        try {
          options.clearLocalSession?.()
        } catch {
          failed = true
          safeWarning('signOut-cleanup', 'signOut')
        }
        if (started && generation === workGeneration && failed) {
          safeWarning('signOut', 'signOut')
          fail('signOut', workGeneration)
        }
      })()
        .catch(() => {
          safeWarning('signOut', 'signOut')
          if (started && generation === workGeneration) fail('signOut', workGeneration)
        })
        .finally(() => {
          signingOut = false
          signOutOperation = null
        })
      await signOutOperation
    },
  }

  return controller
}
