import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthController, VerifiedAuthSession } from '../auth/controller'
import type { ScorerClient } from '../scorer/client'
import { createAssessmentQueue } from '../assessment/queue'
import type { AssessmentRepository } from '../assessment/repository'
import type { AssessmentItem, QueueRecord } from '../assessment/types'
import { buildProbeRequest, freshProbeEventId, reviewedProbeItems, asProbeSessionItem } from './bank'
import { createProbeRepository } from './repository'
import type { ProbeRuntimeSnapshot, ProbeSession } from './types'

export type ProbeRuntime = ReturnType<typeof createProbeRuntime>

type Browser = Pick<Window, 'addEventListener' | 'removeEventListener'>

function uuidLike(value: string) {
  return value.trim().length > 0
}

export function createProbeRuntime(
  client: SupabaseClient | null,
  auth: AuthController,
  scorer: ScorerClient | null,
  browser: Browser = window,
) {
  const repository = createProbeRepository(client)
  let activeSession: ProbeSession | null = null
  let activeOwner: string | null = null
  let disposed = false
  let authGeneration = 0
  let authKey = ''
  const listeners = new Set<() => void>()

  let snapshot: ProbeRuntimeSnapshot = { activeSession, queue: { pending: 0, processing: 0, exhausted: 0, frozen: false, lastError: null } }
  const emit = () => {
    if (disposed) return
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

  const ensureIdentity = (generation: number, identityId: string) => {
    const { identity } = currentAuth()
    if (!identity || generation !== authGeneration || !isSpecialist(identity) || identity.id !== identityId) {
      throw new Error('prove: authentication changed')
    }
    return identity
  }

  const onCompleted = (record: QueueRecord, response: NonNullable<QueueRecord['response']>) => {
    if (!activeSession || activeSession.id !== record.sessionId || activeSession.completed) return
    activeSession = {
      ...activeSession,
      responses: { ...activeSession.responses, [record.item.id]: response },
    }
    emit()
  }

  const queue = createAssessmentQueue(
    repository as unknown as AssessmentRepository,
    scorer,
    auth,
    { onCompleted },
  )

  const clearForAuthLoss = () => {
    if (!activeSession) return
    queue.cancelSession(activeSession.id)
    activeSession = null
    activeOwner = null
    emit()
  }

  const unsubscribeAuth = auth.subscribe(() => {
    const { authSnapshot, identity } = currentAuth()
    const roleLost = authSnapshot.status === 'signedIn' && (!identity || !isSpecialist(identity))
    const ownerChanged = authSnapshot.status === 'signedIn' && activeOwner !== null && activeOwner !== identity?.id
    if (authSnapshot.status === 'signedOut' || authSnapshot.status === 'unconfigured' || roleLost || ownerChanged) clearForAuthLoss()
    else emit()
  })
  currentAuth()

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

  return {
    repository,
    queue,
    getSnapshot: () => snapshot,
    getActiveSession: () => activeSession,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
    async listChildren() { return repository.listAssignedChildren() },
    async startSession(child: ProbeSession['child'], practised: ProbeSession['practised'] = []) {
      if (activeSession && !activeSession.completed) throw new Error('prove: active session already exists')
      if (!uuidLike(child.id)) throw new Error('prove: invalid child')
      const identity = currentAuth().identity
      if (!identity || !isSpecialist(identity)) throw new Error('prove: specialist verification required')
      const generation = authGeneration
      const identityId = identity.id
      const guard = () => { ensureIdentity(generation, identityId) }
      const consent = await repository.readAssessmentConsent(child.id)
      guard()
      if (!consent.valid) throw new Error('prove: valid consent required')
      const bankItems = reviewedProbeItems()
      if (bankItems.length === 0) throw new Error('prove: reviewed probe material unavailable')
      const items = bankItems.map((item) => asProbeSessionItem(item, child.dialectLexiconId))
      const session = await repository.createSession(child.id, identityId)
      guard()
      activeSession = {
        id: session.id,
        eventId: freshProbeEventId(),
        child: { ...child },
        startedAt: session.started_at,
        items,
        practised: [...practised],
        responses: {},
        completed: false,
        result: null,
      }
      activeOwner = identityId
      emit()
      return activeSession
    },
    enqueue(item: AssessmentItem, audio: Blob) {
      const session = activeSession
      if (!session || session.completed) throw new Error('prove: no active session')
      const identity = currentAuth().identity
      if (!identity || !isSpecialist(identity) || activeOwner !== identity.id) throw new Error('prove: specialist verification required')
      if (!session.items.some((candidate) => candidate.id === item.id)) throw new Error('prove: item is not in this session')
      return queue.enqueue({ sessionId: session.id, childId: session.child.id, item, audio, identityId: identity.id })
    },
    async finishSession() {
      const session = activeSession
      if (!session || session.completed) return session?.result ?? null
      if (queue.getSnapshot().pending > 0 || queue.getSnapshot().processing > 0 || queue.getSnapshot().exhausted > 0) throw new Error('prove: recordings still processing')
      const identity = currentAuth().identity
      if (!identity || !isSpecialist(identity) || activeOwner !== identity.id) throw new Error('prove: specialist verification required')
      const generation = authGeneration
      const guard = () => { ensureIdentity(generation, identity.id) }
      const unseen = session.items.map((item) => session.responses[item.id]).filter((response): response is NonNullable<QueueRecord['response']> => Boolean(response))
      if (unseen.length !== session.items.length) throw new Error('prove: every probe item must be acknowledged before scoring')
      const request = buildProbeRequest(session.id, session.practised, unseen)
      if (!scorer) throw new Error('prove: scorer unavailable')
      guard()
      const response = await scorer.probe(request)
      guard()
      const persisted = await repository.finalizeProbe(session.id, session.eventId, response, guard)
      guard()
      const result = {
        request,
        response: persisted.response,
        childId: persisted.childId,
        sessionId: persisted.sessionId,
        eventId: persisted.eventId,
        createdAt: persisted.createdAt,
      }
      activeSession = { ...session, completed: true, result }
      emit()
      return result
    },
    async abandonSession() {
      const session = activeSession
      if (!session) return
      const identity = currentAuth().identity
      if (!identity || !isSpecialist(identity) || activeOwner !== identity.id) throw new Error('prove: specialist verification required')
      const generation = authGeneration
      const guard = () => { ensureIdentity(generation, identity.id) }
      await repository.abandonSession(session.id, guard)
      guard()
      queue.cancelSession(session.id)
      if (activeSession?.id === session.id) {
        activeSession = null
        activeOwner = null
        emit()
      }
    },
    retryExhausted() { queue.retryExhausted() },
    dispose() {
      if (disposed) return
      disposed = true
      queue.dispose()
      unsubscribeAuth()
      browser.removeEventListener('beforeunload', beforeUnload)
      browser.removeEventListener('online', online)
      browser.removeEventListener('visibilitychange', online)
      activeSession = null
      activeOwner = null
      listeners.clear()
    },
  }
}
