import type { AuthController, VerifiedAuthSession } from '../auth/controller'
import type { ScorerClient } from '../scorer/client'
import { ScorerClientError } from '../scorer/errors'
import type { AssessmentRepository } from './repository'
import { AssessmentRepositoryError } from './repository'
import type { QueueErrorCode, QueueRecord, QueueSnapshot } from './types'

const MAX_QUEUE = 8
const MAX_ATTEMPTS = 4
const RETRY_BASE_MS = 500

class QueueFrozenError extends Error {}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function errorCode(error: unknown): QueueErrorCode {
  if (error instanceof QueueFrozenError) return 'offline'
  if (error instanceof ScorerClientError) {
    if (['unauthorized', 'forbidden'].includes(error.issue)) return 'auth'
    if (['invalidRequest', 'invalidAudio', 'invalidResponse', 'responseMismatch'].includes(error.issue)) return 'schema'
    if (error.issue === 'fixtureUnavailable') return 'material'
    if (error.issue === 'cancelled') return 'cancelled'
    return error.issue === 'configuration' ? 'material' : 'network'
  }
  if (error instanceof AssessmentRepositoryError) {
    if (error.code === '42501' || error.code === '23514' || error.code === 'consent') return 'consent'
    if (['schema', 'conflict'].includes(error.code ?? '')) return 'schema'
    if (error.code === 'auth') return 'auth'
    return 'storage'
  }
  return 'unknown'
}

function retryable(error: unknown): boolean {
  if (error instanceof QueueFrozenError) return false
  if (error instanceof ScorerClientError) return ['network', 'timeout', 'remote'].includes(error.issue)
  if (error instanceof AssessmentRepositoryError) return error.retryable
  return true
}

export type AssessmentQueue = ReturnType<typeof createAssessmentQueue>

export function createAssessmentQueue(
  repository: AssessmentRepository,
  scorer: ScorerClient | null,
  auth: AuthController,
  options: { maxQueue?: number; maxAttempts?: number; retryBaseMs?: number } = {},
) {
  const maxQueue = Math.min(Math.max(options.maxQueue ?? MAX_QUEUE, 1), MAX_QUEUE)
  const maxAttempts = Math.min(Math.max(options.maxAttempts ?? MAX_ATTEMPTS, 1), MAX_ATTEMPTS)
  const retryBaseMs = Math.max(options.retryBaseMs ?? RETRY_BASE_MS, 0)
  const records: QueueRecord[] = []
  const listeners = new Set<() => void>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let activeAbort: AbortController | null = null
  let activeRecordId: string | null = null
  let disposed = false
  let frozen = false
  let lastError: QueueErrorCode | null = null
  let pumping = false
  let authGeneration = 0
  let authKey = ''

  const calculateSnapshot = (): QueueSnapshot => ({
    pending: records.filter((record) => ['queued', 'processing', 'retrying'].includes(record.status)).length,
    processing: records.filter((record) => record.status === 'processing').length,
    exhausted: records.filter((record) => record.status === 'exhausted').length,
    frozen,
    lastError,
  })
  let cachedSnapshot = calculateSnapshot()

  const emit = () => {
    const next = calculateSnapshot()
    if (
      cachedSnapshot.pending === next.pending &&
      cachedSnapshot.processing === next.processing &&
      cachedSnapshot.exhausted === next.exhausted &&
      cachedSnapshot.frozen === next.frozen &&
      cachedSnapshot.lastError === next.lastError
    ) return
    cachedSnapshot = next
    for (const listener of [...listeners]) listener()
  }

  const cancelActive = () => {
    activeAbort?.abort('auth_changed')
  }

  const authState = () => {
    const snapshot = auth.getSnapshot()
    const identity = auth.getVerifiedSession()
    return { snapshot, identity }
  }

  const purge = () => {
    authGeneration += 1
    cancelActive()
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    for (const record of records) {
      record.audio = new Blob()
      record.response = undefined
    }
    records.splice(0, records.length)
    frozen = false
    lastError = null
    emit()
  }

  const freeze = () => {
    frozen = true
    cancelActive()
    emit()
  }

  const isEligible = (identity: VerifiedAuthSession | null) => {
    const { snapshot } = authState()
    return snapshot.status === 'signedIn' && snapshot.role === 'specialist' && identity?.role === 'specialist'
  }

  const reconcileAuth = () => {
    const { snapshot, identity } = authState()
    const nextKey = `${snapshot.status}|${snapshot.role ?? ''}|${identity?.id ?? ''}|${identity?.role ?? ''}`
    if (nextKey !== authKey) {
      authKey = nextKey
      authGeneration += 1
    }

    if (snapshot.status === 'signedOut' || snapshot.status === 'unconfigured') {
      purge()
      return null
    }
    if (snapshot.status === 'signedIn' && (!identity || snapshot.role !== 'specialist' || identity.role !== 'specialist')) {
      purge()
      return null
    }
    if (!isEligible(identity)) {
      freeze()
      return null
    }
    if (records.some((record) => record.identityId !== identity?.id)) {
      purge()
      return null
    }
    if (frozen) {
      frozen = false
      emit()
    }
    return identity
  }

  const currentIdentity = () => {
    const identity = reconcileAuth()
    if (!identity) {
      const { snapshot } = authState()
      if (snapshot.status === 'signedOut' || snapshot.status === 'unconfigured') return null
      throw new QueueFrozenError('auth_revalidation')
    }
    return identity
  }

  const operationIsCurrent = (record: QueueRecord, generation: number, identityId: string) => {
    if (disposed || generation !== authGeneration || !records.includes(record)) return false
    const identity = reconcileAuth()
    if (!identity || identity.id !== identityId || record.identityId !== identity.id) return false
    return true
  }

  const process = async (record: QueueRecord, generation: number, identity: VerifiedAuthSession) => {
    if (!operationIsCurrent(record, generation, identity.id)) return false
    record.status = 'processing'
    const operationAbort = new AbortController()
    activeAbort = operationAbort
    activeRecordId = record.id
    const retainAfterInvalidation = () => {
      const status = auth.getSnapshot().status
      if (records.includes(record) && status !== 'signedOut' && status !== 'unconfigured') {
        record.status = 'queued'
        emit()
      }
      return status === 'signedIn'
    }
    emit()
    try {
      if (!record.response) {
        if (!scorer) throw new AssessmentRepositoryError('scorer unavailable', 'material', false)
        const scored = await scorer.scoreItem(record.audio, {
          item_id: record.item.id,
          item_type: record.item.type,
          expected_text: record.item.text,
          dialect_lexicon_id: record.item.dialectLexiconId,
        }, { signal: operationAbort.signal })
        if (!operationIsCurrent(record, generation, identity.id)) {
          return retainAfterInvalidation()
        }
        record.response = scored
      }

      if (!operationIsCurrent(record, generation, identity.id)) {
        return retainAfterInvalidation()
      }
      const audioPath = `audio/${record.childId}/${record.sessionId}/${record.item.id}.wav`
      const guard = () => {
        if (!operationIsCurrent(record, generation, identity.id)) throw new QueueFrozenError('auth_changed')
      }
      await repository.insertResult(record, record.response, audioPath, guard)
      if (!operationIsCurrent(record, generation, identity.id)) {
        return retainAfterInvalidation()
      }
      await repository.uploadAudio(record, audioPath, guard)
      if (!operationIsCurrent(record, generation, identity.id)) {
        return retainAfterInvalidation()
      }
      record.status = 'done'
      record.audio = new Blob()
      record.response = undefined
      records.splice(records.indexOf(record), 1)
      lastError = null
      emit()
      return true
    } catch (error) {
      if (!records.includes(record)) return false
      const current = operationIsCurrent(record, generation, identity.id)
      if (!current || error instanceof QueueFrozenError) {
        if (current || (auth.getSnapshot().status !== 'signedOut' && auth.getSnapshot().status !== 'unconfigured')) {
          record.status = 'queued'
          emit()
        }
        // Auth may finish revalidation before the aborted operation settles.
        // Its earlier resume notification saw pumping=true, so continue here.
        return auth.getSnapshot().status === 'signedIn' && isEligible(auth.getVerifiedSession())
      }
      const code = errorCode(error)
      lastError = code
      record.lastError = code
      if (retryable(error) && record.attempts < maxAttempts) {
        record.status = 'retrying'
        const delay = retryBaseMs * (2 ** Math.max(record.attempts - 1, 0))
        const timer = setTimeout(() => {
          timers.delete(timer)
          if (!disposed && records.includes(record) && record.status === 'retrying') {
            record.status = 'queued'
            emit()
            void pump()
          }
        }, delay)
        timers.add(timer)
      } else {
        record.status = 'exhausted'
      }
      emit()
      return false
    } finally {
      if (activeAbort === operationAbort) { activeAbort = null; activeRecordId = null }
      emit()
    }
  }

  const pump = async (): Promise<void> => {
    if (pumping || disposed) return
    pumping = true
    try {
      while (!disposed) {
        let identity: VerifiedAuthSession | null
        try { identity = currentIdentity() } catch { break }
        if (!identity) break
        const next = records.find((record) => record.status === 'queued' && record.identityId === identity.id)
        if (!next) break
        const generation = authGeneration
        next.attempts += 1
        const completed = await process(next, generation, identity)
        if (!completed && next.status === 'queued') break
      }
    } finally {
      pumping = false
      emit()
    }
  }

  const unsubscribeAuth = auth.subscribe(() => {
    const identity = reconcileAuth()
    if (identity) void pump()
  })
  reconcileAuth()

  return {
    getSnapshot: () => cachedSnapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
    enqueue(input: Omit<QueueRecord, 'id' | 'attempts' | 'status'>): string {
      const identity = currentIdentity()
      if (!identity || identity.id !== input.identityId) throw new QueueFrozenError('auth_changed')
      if (records.filter((record) => record.status !== 'done').length >= maxQueue) throw new AssessmentRepositoryError('queue capacity', 'capacity', false)
      const record: QueueRecord = { ...input, id: newId(), attempts: 0, status: 'queued' }
      records.push(record)
      emit()
      void pump()
      return record.id
    },
    retryExhausted() {
      let changed = false
      for (const record of records) {
        if (record.status === 'exhausted') {
          record.status = 'queued'
          record.attempts = 0
          record.lastError = undefined
          changed = true
        }
      }
      if (changed) emit()
      void pump()
    },
    retryNow() {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      let changed = false
      for (const record of records) {
        if (record.status === 'retrying') {
          record.status = 'queued'
          changed = true
        }
      }
      if (changed) emit()
      void pump()
    },
    handleOnline() {
      const identity = reconcileAuth()
      if (identity) void pump()
    },
    reportIssue(code: QueueErrorCode | null) {
      if (lastError === code) return
      lastError = code
      emit()
    },
    cancelSession(sessionId: string) {
      for (let index = records.length - 1; index >= 0; index -= 1) {
        const record = records[index]
        if (record.sessionId !== sessionId) continue
        if (record.id === activeRecordId) cancelActive()
        record.audio = new Blob()
        record.response = undefined
        records.splice(index, 1)
      }
      emit()
    },
    purge,
    dispose() {
      disposed = true
      unsubscribeAuth()
      purge()
      listeners.clear()
    },
  }
}
