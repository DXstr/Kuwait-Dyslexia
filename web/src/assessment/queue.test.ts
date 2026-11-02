import { describe, expect, it, vi } from 'vitest'
import type { AuthController, AuthSnapshot, VerifiedAuthSession } from '../auth/controller'
import type { ScorerClient } from '../scorer/client'
import { ScorerClientError } from '../scorer/errors'
import { createAssessmentQueue } from './queue'
import { AssessmentRepositoryError } from './repository'
import type { AssessmentRepository } from './repository'
import type { AssessmentItem, QueueRecord } from './types'

const identity: VerifiedAuthSession = { id: 'adult-1', role: 'specialist', accessToken: 'verified-token' }
const item: AssessmentItem = { id: 'rw-0001', type: 'real_word', text: 'قَلَم', dialectLexiconId: 'kw', synthetic: true }
const response = { item_id: 'rw-0001', item_type: 'real_word', model_version: 'fixture', synthetic: true, audio_duration_ms: 200, words: [], phonemes: [], skill_evidence: [], wcpm: null, warnings: [] } as QueueRecord['response']

function authFixture() {
  let snapshot: AuthSnapshot = { status: 'signedIn', role: 'specialist', issue: null }
  let currentIdentity: VerifiedAuthSession | null = identity
  const listeners = new Set<() => void>()
  const controller = {
    getSnapshot: () => snapshot,
    getVerifiedSession: () => snapshot.status === 'signedIn' ? currentIdentity : null,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    setStatus(next: AuthSnapshot, nextIdentity: VerifiedAuthSession | null = currentIdentity) {
      snapshot = next
      currentIdentity = nextIdentity
      listeners.forEach((listener) => listener())
    },
  }
  return controller
}

function repositoryFixture() {
  const calls = { insert: 0, upload: 0 }
  const repository = {
    insertResult: vi.fn(async () => { calls.insert += 1 }),
    uploadAudio: vi.fn(async () => { calls.upload += 1 }),
  }
  return { repository: repository as unknown as AssessmentRepository, calls }
}

function scorerFixture(score: () => Promise<NonNullable<typeof response>>) {
  return { mode: 'mock', scoreItem: vi.fn(score) } as unknown as ScorerClient
}

const input = (audio = new Blob(['wav'], { type: 'audio/wav' })) => ({ sessionId: 'session-1', childId: 'child-1', item, audio, identityId: identity.id })
const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms))

 describe('assessment background queue', () => {
  it('returns a cached snapshot reference until queue state actually changes', () => {
    const auth = authFixture()
    const { repository } = repositoryFixture()
    const queue = createAssessmentQueue(repository, null, auth as unknown as AuthController)
    const initial = queue.getSnapshot()
    expect(queue.getSnapshot()).toBe(initial)
    let notifications = 0
    queue.subscribe(() => { notifications += 1 })
    queue.reportIssue('unknown')
    const changed = queue.getSnapshot()
    expect(changed).not.toBe(initial)
    expect(queue.getSnapshot()).toBe(changed)
    expect(notifications).toBe(1)
    queue.dispose()
  })

  it('returns the stable queue id before scoring or storage completes', async () => {
    const auth = authFixture()
    const { repository, calls } = repositoryFixture()
    let release!: () => void
    const scorer = scorerFixture(() => new Promise((resolve) => { release = () => resolve(response!) }))
    const queue = createAssessmentQueue(repository, scorer, auth as unknown as AuthController, { retryBaseMs: 0 })
    const id = queue.enqueue(input())
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(calls.insert).toBe(0)
    release()
    await wait()
    expect(calls.insert).toBe(1)
    expect(calls.upload).toBe(1)
    queue.dispose()
  })

  it('retries a transient scorer failure without retrying permanent schema failures forever', async () => {
    const auth = authFixture()
    const { repository, calls } = repositoryFixture()
    let attempts = 0
    const scorer = scorerFixture(async () => {
      attempts += 1
      if (attempts === 1) throw new ScorerClientError('network')
      return response!
    })
    const queue = createAssessmentQueue(repository, scorer, auth as unknown as AuthController, { retryBaseMs: 0 })
    queue.enqueue(input())
    await wait(20)
    expect(attempts).toBe(2)
    expect(calls.insert).toBe(1)
    queue.dispose()
  })

  it('automatically purges and blocks a delayed scorer result after sign-out', async () => {
    const auth = authFixture()
    const { repository, calls } = repositoryFixture()
    let release!: () => void
    const scorer = scorerFixture(() => new Promise((resolve) => { release = () => resolve(response!) }))
    const queue = createAssessmentQueue(repository, scorer, auth as unknown as AuthController)
    queue.enqueue(input())
    auth.setStatus({ status: 'signedOut', role: null, issue: null }, null)
    expect(queue.getSnapshot().pending).toBe(0)
    release()
    await wait()
    expect(calls.insert).toBe(0)
    expect(calls.upload).toBe(0)
    queue.dispose()
  })

  it('freezes on transient auth and resumes the same adult without losing owner audio', async () => {
    const auth = authFixture()
    const { repository, calls } = repositoryFixture()
    let release!: () => void
    let attempts = 0
    const scorer = scorerFixture(() => {
      attempts += 1
      return attempts === 1 ? new Promise((resolve) => { release = () => resolve(response!) }) : Promise.resolve(response!)
    })
    const queue = createAssessmentQueue(repository, scorer, auth as unknown as AuthController, { retryBaseMs: 0 })
    queue.enqueue(input())
    await wait()
    auth.setStatus({ status: 'loading', role: null, issue: null })
    expect(queue.getSnapshot().frozen).toBe(true)
    expect(queue.getSnapshot().pending).toBe(1)
    auth.setStatus({ status: 'signedIn', role: 'specialist', issue: null }, identity)
    expect(queue.getSnapshot().frozen).toBe(false)
    release()
    await wait(20)
    expect(attempts).toBe(2)
    expect(calls.insert).toBe(1)
    queue.dispose()
  })

  it('clears retry timers on sign-out instead of spinning canceled work', async () => {
    const auth = authFixture()
    const { repository } = repositoryFixture()
    let attempts = 0
    const scorer = scorerFixture(async () => {
      attempts += 1
      throw new ScorerClientError('network')
    })
    const queue = createAssessmentQueue(repository, scorer, auth as unknown as AuthController, { retryBaseMs: 20 })
    queue.enqueue(input())
    await wait()
    auth.setStatus({ status: 'signedOut', role: null, issue: null }, null)
    await wait(40)
    expect(attempts).toBe(1)
    queue.dispose()
  })

  it('exhausts permanent repository auth errors without retrying', async () => {
    const auth = authFixture()
    const repository = {
      insertResult: vi.fn(async () => { throw new AssessmentRepositoryError('denied', 'auth', false) }),
      uploadAudio: vi.fn(async () => undefined),
    } as unknown as AssessmentRepository
    const scorer = scorerFixture(async () => response!)
    const queue = createAssessmentQueue(repository, scorer, auth as unknown as AuthController, { retryBaseMs: 0 })
    queue.enqueue(input())
    await wait()
    expect(repository.insertResult).toHaveBeenCalledTimes(1)
    expect(queue.getSnapshot().exhausted).toBe(1)
    expect(queue.getSnapshot().lastError).toBe('auth')
    queue.dispose()
  })

  it('resumes when verification finishes before a canceled scorer promise settles', async () => {
    const auth = authFixture()
    const { repository, calls } = repositoryFixture()
    let reject!: (error: unknown) => void
    let attempts = 0
    const scorer = scorerFixture(() => {
      attempts += 1
      return attempts === 1 ? new Promise((_, fail) => { reject = fail }) : Promise.resolve(response!)
    })
    const queue = createAssessmentQueue(repository, scorer, auth as unknown as AuthController)
    queue.enqueue(input())
    auth.setStatus({ status: 'loading', role: null, issue: null })
    auth.setStatus({ status: 'signedIn', role: 'specialist', issue: null }, identity)
    reject(new ScorerClientError('cancelled'))
    await wait(20)
    expect(attempts).toBe(2)
    expect(calls.insert).toBe(1)
    expect(queue.getSnapshot().pending).toBe(0)
    queue.dispose()
  })

  it('discards an abandoned session before a delayed scorer response can be written', async () => {
    const auth = authFixture()
    const { repository, calls } = repositoryFixture()
    let release!: () => void
    const scorer = scorerFixture(() => new Promise((resolve) => { release = () => resolve(response!) }))
    const queue = createAssessmentQueue(repository, scorer, auth as unknown as AuthController)
    queue.enqueue(input())
    queue.cancelSession('session-1')
    release()
    await wait()
    expect(calls.insert).toBe(0)
    expect(calls.upload).toBe(0)
    expect(queue.getSnapshot().pending).toBe(0)
    queue.dispose()
  })
})
