// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import rawRequestFixture from '../../../contracts/fixtures/Stage0ScoreRequest.example.json'
import rawResponseFixture from '../../../contracts/fixtures/Stage0ScoreResponse.license-pending.json'
import type { AuthController, AuthSnapshot, VerifiedAuthSession } from '../auth/controller'
import { parseContract } from '../scorer/validation'
import { createStage0Repository, Stage0RepositoryError } from './repository'

const requestFixture = parseContract('Stage0ScoreRequest', rawRequestFixture)
const responseFixture = parseContract('Stage0ScoreResponse', rawResponseFixture)
const examiner: VerifiedAuthSession = { id: 'examiner-1', role: 'examiner', accessToken: 'verified-examiner-token' }
const guardian: VerifiedAuthSession = { id: 'guardian-1', role: 'guardian', accessToken: 'verified-guardian-token' }
function authFixture(initial: VerifiedAuthSession | null = examiner) {
  let current = initial
  const listeners = new Set<() => void>()
  const auth: AuthController = {
    getSnapshot: (): AuthSnapshot => current ? { status: 'signedIn', role: current.role, issue: null } : { status: 'signedOut', role: null, issue: null },
    getVerifiedSession: () => current,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    start: () => () => {}, retry: async () => {}, signIn: async () => {}, signOut: async () => {},
  }
  return { auth, set(next: VerifiedAuthSession | null) { current = next; listeners.forEach((listener) => listener()) } }
}
function query(result: { data: unknown; error: unknown | null }) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order']) builder[method] = vi.fn(() => builder)
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return builder
}
function clientFor(result: { data: unknown; error: unknown | null }, onFrom = vi.fn()) {
  return { from: vi.fn((table: string) => { onFrom(table); return query(result) }) } as unknown as SupabaseClient
}
const session = {
  id: 'session-1', child_id: 'child-1', type: 'stage0' as const, status: 'in_progress' as const,
  started_at: '2026-11-03T00:00:00.000Z', ended_at: null, run_by: examiner.id,
}

describe('Stage0 repository authorization and integrity', () => {
  it('rejects guardian examiner reads and examiner consent writes before touching the SDK', async () => {
    const from = vi.fn()
    const guardianRepository = createStage0Repository(clientFor({ data: [], error: null }, from), authFixture(guardian).auth)
    await expect(guardianRepository.listExaminerChildren()).rejects.toMatchObject({ issue: 'forbidden' })
    expect(from).not.toHaveBeenCalled()

    const examinerRepository = createStage0Repository(clientFor({ data: [], error: null }, from), authFixture(examiner).auth)
    await expect(examinerRepository.createConsent({ id: 'child-1', first_name: 'طفل', grade: 2, birth_month: '2017-01', specialist_id: 'specialist-1', is_demo: true }, 'fixture', '2099-01-01T00:00:00.000Z')).rejects.toMatchObject({ issue: 'forbidden' })
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a pre-aborted examiner read without consulting Supabase', async () => {
    const from = vi.fn()
    const repository = createStage0Repository(clientFor({ data: [], error: null }, from), authFixture().auth)
    const controller = new AbortController()
    controller.abort()
    await expect(repository.listExaminerChildren({ signal: controller.signal })).rejects.toMatchObject({ issue: 'cancelled' })
    expect(from).not.toHaveBeenCalled()
  })

  it('cancels an in-flight examiner read when its caller aborts', async () => {
    let release!: (value: { data: unknown; error: null }) => void
    const pending = new Promise<{ data: unknown; error: null }>((resolve) => { release = resolve })
    const client = { from: vi.fn(() => {
      const builder = query({ data: [], error: null })
      builder.then = (resolve: (value: unknown) => unknown) => pending.then(resolve)
      return builder
    }) } as unknown as SupabaseClient
    const repository = createStage0Repository(client, authFixture().auth)
    const controller = new AbortController()
    const read = repository.listExaminerChildren({ signal: controller.signal })
    controller.abort()
    release({ data: [], error: null })
    await expect(read).rejects.toMatchObject({ issue: 'cancelled' })
  })

  it('discards a child read when the verified actor changes before the response settles', async () => {
    let release!: (value: { data: unknown; error: null }) => void
    const pending = new Promise<{ data: unknown; error: null }>((resolve) => { release = resolve })
    const client = { from: vi.fn(() => {
      const builder = query({ data: [], error: null })
      builder.then = (resolve: (value: unknown) => unknown) => pending.then(resolve)
      return builder
    }) } as unknown as SupabaseClient
    const auth = authFixture()
    const repository = createStage0Repository(client, auth.auth)
    const read = repository.listExaminerChildren()
    auth.set(guardian)
    release({ data: [], error: null })
    await expect(read).rejects.toMatchObject({ issue: 'unauthorized' })
  })

  it('discards old private data when a same-role examiner account replaces the actor', async () => {
    let release!: (value: { data: unknown; error: null }) => void
    const pending = new Promise<{ data: unknown; error: null }>((resolve) => { release = resolve })
    const client = { from: vi.fn(() => {
      const builder = query({ data: [], error: null })
      builder.then = (resolve: (value: unknown) => unknown) => pending.then(resolve)
      return builder
    }) } as unknown as SupabaseClient
    const auth = authFixture()
    const repository = createStage0Repository(client, auth.auth)
    const read = repository.listExaminerChildren()
    auth.set({ id: 'examiner-2', role: 'examiner', accessToken: 'verified-examiner-2-token' })
    release({ data: [], error: null })
    await expect(read).rejects.toMatchObject({ issue: 'unauthorized' })
  })

  it('stores the canonical request and response unchanged after validating correlation', async () => {
    let inserted: Record<string, unknown> | null = null
    const row = { id: 'result-1', child_id: 'child-1', session_id: session.id, request: requestFixture, response: responseFixture, examiner_id: examiner.id, review_status: 'draft' }
    const client = {
      from: vi.fn((table: string) => {
        const builder = query({ data: row, error: null })
        builder.insert = vi.fn((value: unknown) => { inserted = value as Record<string, unknown>; return builder })
        builder.single = vi.fn(() => Promise.resolve({ data: row, error: null }))
        if (table !== 'stage0_results') throw new Error('unexpected table')
        return builder
      }),
    } as unknown as SupabaseClient
    const repository = createStage0Repository(client, authFixture().auth)
    const request = structuredClone(requestFixture)
    const response = structuredClone(responseFixture)
    const saved = await repository.saveResult(session, request, response)
    expect(inserted).toMatchObject({ session_id: session.id, child_id: session.child_id, examiner_id: examiner.id, request, response })
    expect(saved.request).toEqual(request)
    expect(saved.response).toEqual(response)
    expect(saved.response).not.toHaveProperty('scaled_score', 99)
  })

  it('rejects a result attributed to a different session examiner before transport', async () => {
    const from = vi.fn()
    const repository = createStage0Repository(clientFor({ data: [], error: null }, from), authFixture().auth)
    await expect(repository.saveResult({ ...session, run_by: 'other-examiner' }, requestFixture, responseFixture)).rejects.toBeInstanceOf(Stage0RepositoryError)
    expect(from).not.toHaveBeenCalled()
  })
})
