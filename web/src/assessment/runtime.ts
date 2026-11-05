import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthController, VerifiedAuthSession } from '../auth/controller'
import type { ScorerClient } from '../scorer/client'
import { createAssessmentQueue } from './queue'
import { createAssessmentRepository, AssessmentRepositoryError } from './repository'
import type { ActiveAssessmentSession, AssessmentChild, AssessmentItem, QueueErrorCode, QueueSnapshot } from './types'
import { demoAssessmentItems } from './types'
import { selectScreeningItems } from './screening'

export type AssessmentRuntimeSnapshot = {
  activeSession: ActiveAssessmentSession | null
  queue: QueueSnapshot
}

export type AssessmentRuntime = ReturnType<typeof createAssessmentRuntime>

function issueFor(error: unknown): QueueErrorCode {
  if (error instanceof AssessmentRepositoryError) {
    if (error.code === 'auth') return 'auth'
    if (error.code === 'consent' || error.code === '42501' || error.code === '23514') return 'consent'
    if (error.code === 'schema' || error.code === 'conflict') return 'schema'
    return 'storage'
  }
  return 'unknown'
}

export function createAssessmentRuntime(client: SupabaseClient | null, auth: AuthController, scorer: ScorerClient | null, browser: Window = window) {
  const repository = createAssessmentRepository(client)
  const queue = createAssessmentQueue(repository, scorer, auth)
  let activeSession: ActiveAssessmentSession | null = null
  let activeOwner: string | null = null
  const listeners = new Set<() => void>()
  let authGeneration = 0
  let authKey = ''
  let startingChildId: string | null = null
  let startOperation: Promise<ActiveAssessmentSession> | null = null

  let snapshot: AssessmentRuntimeSnapshot = { activeSession, queue: queue.getSnapshot() }
  const emit = () => {
    const nextQueue = queue.getSnapshot()
    if (snapshot.activeSession === activeSession && snapshot.queue === nextQueue) return
    snapshot = { activeSession, queue: nextQueue }
    for (const listener of [...listeners]) listener()
  }

  const currentAuth = () => {
    const authSnapshot = auth.getSnapshot()
    const identity = auth.getVerifiedSession()
    const nextKey = `${authSnapshot.status}|${authSnapshot.role ?? ''}|${identity?.id ?? ''}|${identity?.role ?? ''}`
    if (nextKey !== authKey) {
      authKey = nextKey
      authGeneration += 1
    }
    return { authSnapshot, identity }
  }

  const isSpecialist = (identity: VerifiedAuthSession | null) => {
    const { authSnapshot } = currentAuth()
    return authSnapshot.status === 'signedIn' && authSnapshot.role === 'specialist' && identity?.role === 'specialist'
  }

  const ensureIdentity = (generation: number, identityId: string): VerifiedAuthSession => {
    const { identity } = currentAuth()
    if (!identity || generation !== authGeneration || !isSpecialist(identity) || identity.id !== identityId) {
      throw new Error('assessment: authentication changed')
    }
    return identity
  }

  const unsubscribeAuth = auth.subscribe(() => {
    const { authSnapshot, identity } = currentAuth()
    const roleLost = authSnapshot.status === 'signedIn' && (!identity || !isSpecialist(identity))
    const ownerChanged = authSnapshot.status === 'signedIn' && activeOwner !== null && activeOwner !== identity?.id
    if (authSnapshot.status === 'signedOut' || authSnapshot.status === 'unconfigured' || roleLost || ownerChanged) {
      activeSession = null
      activeOwner = null
    }
    emit()
  })
  const unsubscribeQueue = queue.subscribe(emit)

  const beforeUnload = (event: BeforeUnloadEvent) => {
    const current = queue.getSnapshot()
    if (current.pending > 0 || current.exhausted > 0 || activeSession && !activeSession.completed) {
      event.preventDefault()
      event.returnValue = ''
    }
  }
  browser.addEventListener('beforeunload', beforeUnload)
  const online = () => queue.handleOnline()
  browser.addEventListener('online', online)
  browser.addEventListener('visibilitychange', online)
  currentAuth()

  return {
    repository,
    queue,
    getSnapshot: () => snapshot,
    getActiveSession: () => activeSession,
    getQueueSnapshot: (): QueueSnapshot => queue.getSnapshot(),
    reportIssue(code: QueueErrorCode | null) { queue.reportIssue(code) },
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
    async listChildren(): Promise<AssessmentChild[]> { return repository.listAssignedChildren() },
    startSession(child: AssessmentChild): Promise<ActiveAssessmentSession> {
      if (activeSession && !activeSession.completed) return Promise.reject(new Error('assessment: active session already exists'))
      if (startOperation) {
        if (startingChildId === child.id) return startOperation
        return Promise.reject(new Error('assessment: another session is starting'))
      }

      const identity = currentAuth().identity
      if (!identity || !isSpecialist(identity)) return Promise.reject(new Error('assessment: specialist verification required'))
      const generation = authGeneration
      const identityId = identity.id
      const guard = () => { ensureIdentity(generation, identityId) }
      startingChildId = child.id
      const operation = (async () => {
        const consent = await repository.readAssessmentConsent(child.id, guard)
        guard()
        if (!consent.valid) throw new Error('assessment: valid consent required')
        // Fixture answers only exist for the fixture items; the real scorer takes the approved bank.
        const items = scorer?.mode === 'mock' ? [...demoAssessmentItems] : selectScreeningItems(child)
        if (items.length === 0) throw new Error('assessment: approved assessment material unavailable')
        guard()
        const session = await repository.createSession(child.id, identityId, 'assessment', guard)
        guard()
        // Clone caller-owned metadata so later panel mutations cannot alter the
        // session that has already been recorded in the database.
        activeSession = {
          id: session.id,
          child: { ...child },
          startedAt: session.started_at,
          items,
          type: 'assessment',
        }
        activeOwner = identityId
        emit()
        return activeSession
      })()
      startOperation = operation.finally(() => {
        startOperation = null
        startingChildId = null
      })
      return startOperation
    },
    startPracticeSession(child: AssessmentChild, items: readonly AssessmentItem[]): Promise<ActiveAssessmentSession> {
      if (activeSession && !activeSession.completed) return Promise.reject(new Error('assessment: active session already exists'))
      if (startOperation) {
        if (startingChildId === child.id) return startOperation
        return Promise.reject(new Error('assessment: another session is starting'))
      }

      const identity = currentAuth().identity
      if (!identity || !isSpecialist(identity)) return Promise.reject(new Error('assessment: specialist verification required'))
      if (!Array.isArray(items) || items.length === 0) return Promise.reject(new Error('assessment: approved practice material required'))
      const generation = authGeneration
      const identityId = identity.id
      const guard = () => { ensureIdentity(generation, identityId) }
      startingChildId = child.id
      const operation = (async () => {
        const consent = await repository.readPracticeConsent(child.id, guard)
        guard()
        if (!consent.valid) throw new Error('assessment: valid practice consent required')
        guard()
        const session = await repository.createSession(child.id, identityId, 'practice', guard)
        guard()
        activeSession = {
          id: session.id,
          child: { ...child },
          startedAt: session.started_at,
          items: items.map((item) => ({ ...item })),
          type: 'practice',
        }
        activeOwner = identityId
        emit()
        return activeSession
      })()
      startOperation = operation.finally(() => {
        startOperation = null
        startingChildId = null
      })
      return startOperation
    },
    async completeSession() {
      const session = activeSession
      if (!session || session.completed) return
      const identity = currentAuth().identity
      if (!identity || !isSpecialist(identity)) throw new Error('assessment: specialist verification required')
      const generation = authGeneration
      const guard = () => { ensureIdentity(generation, identity.id) }
      try {
        await repository.completeSession(session.id, guard)
        guard()
        if (activeSession?.id === session.id) {
          activeSession = { ...session, completed: true }
          emit()
        }
      } catch (error) {
        queue.reportIssue(issueFor(error))
        throw error
      }
    },
    async abandonSession() {
      const session = activeSession
      if (!session) return
      const identity = currentAuth().identity
      if (!identity || !isSpecialist(identity)) throw new Error('assessment: specialist verification required')
      const generation = authGeneration
      const guard = () => { ensureIdentity(generation, identity.id) }
      try {
        await repository.abandonSession(session.id, guard)
        guard()
        if (activeSession?.id === session.id) {
          activeSession = null
          activeOwner = null
          queue.cancelSession(session.id)
          emit()
        }
      } catch (error) {
        queue.reportIssue(issueFor(error))
        throw error
      }
    },
    clearActiveSession() { activeSession = null; activeOwner = null; emit() },
    dispose() {
      queue.dispose()
      unsubscribeQueue()
      unsubscribeAuth()
      browser.removeEventListener('beforeunload', beforeUnload)
      browser.removeEventListener('online', online)
      browser.removeEventListener('visibilitychange', online)
      listeners.clear()
    },
  }
}
