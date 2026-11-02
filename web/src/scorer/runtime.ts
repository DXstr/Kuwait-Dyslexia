import type { AuthController } from '../auth/controller'
import { createScorerClient } from './client'
import type { ScorerClient } from './client'
import { readScorerConfig } from './config'
import type { ScorerIssue } from './errors'
import { ScorerClientError } from './errors'

export type ScorerPhase = 'idle' | 'checking' | 'ready' | 'warming' | 'degraded' | 'unavailable'

export type ScorerSnapshot = {
  phase: ScorerPhase
  issue: ScorerIssue | null
  mode: 'mock' | 'real' | null
}

export interface ScorerRuntime {
  getSnapshot(): ScorerSnapshot
  subscribe(listener: () => void): () => void
  getClient(): ScorerClient | null
  retry(): Promise<void>
  dispose(): void
}

const initialSnapshot = (mode: ScorerSnapshot['mode']): ScorerSnapshot => ({
  phase: mode === null ? 'unavailable' : 'idle',
  issue: mode === null ? 'configuration' : null,
  mode,
})

function createSafeWarning() {
  let count = 0
  return (issue: ScorerIssue) => {
    // Never log tokens, sessions, provider errors, response bodies or URLs.
    if (count >= 3) return
    count += 1
    console.warn(`scorer: ${issue}`)
  }
}

function issueFrom(error: unknown): ScorerIssue {
  return error instanceof ScorerClientError ? error.issue : 'network'
}

export function startScorerRuntime(
  environment: Record<string, unknown>,
  authController: AuthController,
): ScorerRuntime {
  let mode: ScorerSnapshot['mode'] = null
  let client: ScorerClient | null = null
  const safeWarning = createSafeWarning()
  try {
    const config = readScorerConfig(environment)
    client = createScorerClient(config, {
      getAuthorization: () => authController.getVerifiedSession(),
    })
    mode = config.mode
  } catch {
    // Configuration errors are deliberately not converted into mock mode.
    mode = null
    client = null
  }

  let snapshot = initialSnapshot(mode)
  const listeners = new Set<() => void>()
  let disposed = false
  let seenIdentity: string | null = null
  let healthAbort: AbortController | null = null
  let healthWork: Promise<void> | null = null
  let workGeneration = 0

  const notify = () => {
    if (disposed) return
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // A subscriber must not break the runtime's auth/health lifecycle.
      }
    }
  }

  const setSnapshot = (next: ScorerSnapshot) => {
    if (
      snapshot.phase === next.phase &&
      snapshot.issue === next.issue &&
      snapshot.mode === next.mode
    ) return
    snapshot = next
    notify()
  }

  const abortHealth = () => {
    workGeneration += 1
    healthAbort?.abort('scorer-runtime-invalidated')
    healthAbort = null
    healthWork = null
  }

  const resetForUnauthenticatedState = () => {
    abortHealth()
    seenIdentity = null
    if (mode !== null) setSnapshot({ phase: 'idle', issue: null, mode })
  }

  const checkHealth = (identityId: string, force: boolean): Promise<void> => {
    if (disposed || !client || mode === null) return Promise.resolve()
    if (!force && seenIdentity === identityId) return healthWork ?? Promise.resolve()

    abortHealth()
    seenIdentity = identityId
    const generation = workGeneration
    const abort = new AbortController()
    healthAbort = abort
    setSnapshot({ phase: 'checking', issue: null, mode })

    let tracked = Promise.resolve()
    tracked = (async () => {
      try {
        const health = await client?.health({ signal: abort.signal })
        if (disposed || generation !== workGeneration || abort.signal.aborted || !health) return
        const phase: ScorerPhase = health.status === 'degraded'
          ? 'degraded'
          : health.status === 'ok' && health.model_loaded
            ? 'ready'
            : 'warming'
        setSnapshot({ phase, issue: null, mode })
      } catch (error) {
        if (disposed || generation !== workGeneration || abort.signal.aborted) return
        const issue = issueFrom(error)
        safeWarning(issue)
        setSnapshot({ phase: 'unavailable', issue, mode })
      } finally {
        if (healthWork === tracked) {
          healthWork = null
          healthAbort = null
        }
      }
    })()
    healthWork = tracked
    return tracked
  }

  const reconcileAuth = () => {
    if (disposed) return
    const auth = authController.getSnapshot()
    if (auth.status !== 'signedIn') {
      if (['signedOut', 'error', 'unconfigured', 'redirecting'].includes(auth.status)) {
        resetForUnauthenticatedState()
      }
      return
    }

    const verified = authController.getVerifiedSession()
    if (!verified) {
      resetForUnauthenticatedState()
      return
    }
    if (seenIdentity === verified.id) return
    void checkHealth(verified.id, false)
  }

  const unsubscribeAuth = authController.subscribe(reconcileAuth)
  // The controller may have reached signedIn before this runtime was created.
  reconcileAuth()

  const runtime: ScorerRuntime = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getClient: () => disposed ? null : client,
    retry: async () => {
      if (disposed || !client || mode === null) return
      const auth = authController.getSnapshot()
      if (auth.status !== 'signedIn') return
      const verified = authController.getVerifiedSession()
      if (!verified) return
      seenIdentity = verified.id
      await checkHealth(verified.id, true)
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      abortHealth()
      unsubscribeAuth()
      listeners.clear()
    },
  }
  return runtime
}
