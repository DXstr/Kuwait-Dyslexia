import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import type { AuthController, AuthSnapshot, VerifiedAuthSession } from '../auth/controller'
import type { FingerprintResponse, ScoreItemResponse } from '../contracts/basira'
import fingerprintFixture from '../../../contracts/fixtures/FingerprintResponse.example.json'
import scoreFixture from '../../../contracts/fixtures/ScoreItemResponse.dialect-variant.json'
import { createScorerClient, type ScorerClient } from '../scorer/client'
import { createReviewRepository, ReviewRepositoryError } from './repository'
import type { ReviewSessionDetail } from './types'
import { syntheticWav } from '../test/wav'

const identity: VerifiedAuthSession = { id: 'specialist-1', role: 'specialist', accessToken: 'verified-token' }
const itemResponse = scoreFixture as ScoreItemResponse

function authFixture(role: VerifiedAuthSession['role'] = 'specialist') {
  let current: VerifiedAuthSession | null = role === 'specialist' ? identity : { ...identity, role }
  const listeners = new Set<() => void>()
  const snapshot = (): AuthSnapshot => current
    ? { status: 'signedIn', role: current.role, issue: null }
    : { status: 'signedOut', role: null, issue: null }
  const auth: AuthController = {
    getSnapshot: snapshot,
    getVerifiedSession: () => current,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    start: () => () => {},
    retry: async () => {},
    signIn: async () => {},
    signOut: async () => {},
  }
  return {
    auth,
    set(next: VerifiedAuthSession | null) { current = next; listeners.forEach((listener) => listener()) },
  }
}

type Result = { data: unknown; error: unknown | null }
type Builder = {
  select: (...args: unknown[]) => Builder
  eq: (...args: unknown[]) => Builder
  in: (...args: unknown[]) => Builder
  order: (...args: unknown[]) => Builder
  insert: (value: unknown) => Builder
  update: (value: unknown) => Builder
  abortSignal: (signal: AbortSignal) => Builder
  maybeSingle: () => Promise<Result>
  single: () => Promise<Result>
  then: <TResult1 = Result, TResult2 = never>(onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) => Promise<TResult1 | TResult2>
}

type FakeOptions = {
  fingerprint?: Result | (() => Result)
  insert?: Result | (() => Result)
  update?: Result | (() => Result)
  planLookup?: Result | (() => Result)
  audio?: Result | (() => Result)
}

function fakeClient(options: FakeOptions = {}) {
  const calls: string[] = []
  const audioCalls: string[] = []
  let inserted: unknown = null
  const value = (candidate: Result | (() => Result) | undefined): Result => typeof candidate === 'function' ? candidate() : candidate ?? { data: null, error: null }
  const builderFor = (table: string): Builder => {
    let operation = 'select'
    const builder = {} as Builder
    builder.select = () => builder
    builder.eq = () => builder
    builder.in = () => builder
    builder.order = () => builder
    builder.abortSignal = () => builder
    builder.insert = (row) => { operation = 'insert'; inserted = row; return builder }
    builder.update = () => { operation = 'update'; return builder }
    builder.maybeSingle = async () => {
      calls.push(`${operation}:${table}:maybeSingle`)
      if (table === 'fingerprints') return value(options.fingerprint)
      if (table === 'plans') return value(options.planLookup)
      return { data: null, error: null }
    }
    builder.single = async () => {
      calls.push(`${operation}:${table}:single`)
      if (operation === 'insert') return value(options.insert)
      if (operation === 'update') return value(options.update)
      return { data: null, error: null }
    }
    builder.then = (onfulfilled, onrejected) => Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected)
    return builder
  }
  return {
    client: {
      from: (table: string) => builderFor(table),
      storage: { from: () => ({ download: async (path: string) => { audioCalls.push(path); return value(options.audio) } }) },
    },
    calls,
    audioCalls,
    inserted: () => inserted,
  }
}

function reordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reordered)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([key, entry]) => [key, reordered(entry)]))
}

function sdkJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

function realSdkClient(routes: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => routes(new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url), init))
  const client = createClient('https://db.example.test', 'anon-key', { global: { fetch: fetcher } })
  return { client, fetcher }
}

function detail(sessionId = 'actual-session-uuid'): ReviewSessionDetail {
  const started = '2026-01-01T00:00:00.000Z'
  const ended = '2026-01-01T00:09:00.000Z'
  return {
    session: { id: sessionId, child_id: 'child-1', type: 'assessment', status: 'completed', started_at: started, ended_at: ended, run_by: identity.id },
    child: { id: 'child-1', display_name: 'طفل', first_name: 'طفل', grade: 3, dialect_lexicon_id: 'kw', is_demo: true, specialist_id: identity.id },
    items: [{ id: 'item-result-1', session_id: sessionId, item_id: itemResponse.item_id, response: itemResponse, audio_path: null, audio_expires_at: '2099-01-01T00:00:00.000Z', synthetic: itemResponse.synthetic }],
    taps: [],
    fingerprints: [],
    plans: [],
    reports: [],
  }
}

function scorerReturning(response: FingerprintResponse): ScorerClient {
  return { mode: 'real', health: vi.fn(), scoreItem: vi.fn(), fingerprint: vi.fn(async () => response), probe: vi.fn(), stage0: vi.fn() } as unknown as ScorerClient
}

function audioDetail(synthetic: boolean, durationMs: number): ReviewSessionDetail {
  const sessionId = '00000000-0000-4000-8000-000000000002'
  const childId = '00000000-0000-4000-8000-000000000001'
  const response = { ...itemResponse, synthetic, audio_duration_ms: durationMs }
  const result = detail(sessionId)
  result.session.child_id = childId
  result.child.id = childId
  result.items[0] = {
    ...result.items[0],
    session_id: sessionId,
    item_id: response.item_id,
    response,
    synthetic,
    audio_path: `audio/${childId}/${sessionId}/${response.item_id}.wav`,
  }
  return result
}

describe('createReviewRepository', () => {
  it('does not rewrite an actual UUID into the canonical mock fixture request', async () => {
    const auth = authFixture()
    const fake = fakeClient()
    const scorer = createScorerClient({ mode: 'mock', baseUrl: null }, { getAuthorization: () => identity })
    const repository = createReviewRepository(fake.client as never, auth.auth)
    await expect(repository.createFingerprint(detail(), scorer)).rejects.toMatchObject({ issue: 'fingerprintUnavailable' })
    expect(fake.inserted()).toBeNull()
    repository.dispose()
  })

  it('validates and stores a test transport response unchanged as pending', async () => {
    const auth = authFixture()
    const response = { ...fingerprintFixture, session_id: 'actual-session-uuid' } as FingerprintResponse
    const fake = fakeClient({
      insert: () => {
        return {
          data: { id: '11111111-1111-4111-8111-111111111111', session_id: 'actual-session-uuid', response, review_status: 'pending_review', reviewed_by: null, reviewed_at: null, review_note: null },
          error: null,
        }
      },
    })
    const repository = createReviewRepository(fake.client as never, auth.auth)
    const result = await repository.createFingerprint(detail(), scorerReturning(response))
    expect(result.review_status).toBe('pending_review')
    expect(result.response).toBe(response)
    expect(fake.inserted()).toMatchObject({ session_id: 'actual-session-uuid', response, review_status: 'pending_review' })
    repository.dispose()
  })

  it('turns a zero-row compare-and-set approval into a lost-update error', async () => {
    const auth = authFixture()
    const fake = fakeClient({ planLookup: { data: { id: 'plan-1', child_id: 'child-1' }, error: null }, update: { data: null, error: { code: 'PGRST116' } } })
    const repository = createReviewRepository(fake.client as never, auth.auth)
    await expect(repository.transition('plans', 'plan-1', 'pending_review', 'approved')).rejects.toMatchObject({ issue: 'lostUpdate' })
    repository.dispose()
  })

  it('does not issue a database request for an unauthorized reviewer', async () => {
    const auth = authFixture('guardian')
    const fake = fakeClient()
    const repository = createReviewRepository(fake.client as never, auth.auth)
    await expect(repository.transition('plans', 'plan-1', 'pending_review', 'approved')).rejects.toMatchObject({ issue: 'forbidden' })
    expect(fake.calls).toHaveLength(0)
    repository.dispose()
  })

  it('rejects an arbitrary audio path before Storage download', async () => {
    const auth = authFixture()
    const fake = fakeClient()
    const repository = createReviewRepository(fake.client as never, auth.auth)
    const candidate = detail()
    candidate.items[0].audio_path = 'audio/other-child/other-session/other-item.wav'
    await expect(repository.downloadAudio(candidate, candidate.items[0])).rejects.toMatchObject({ issue: 'audioUnavailable' })
    expect(fake.calls).toHaveLength(0)
    repository.dispose()
  })

  it('exposes safe typed errors rather than SDK messages', async () => {
    const auth = authFixture()
    const fake = fakeClient({ planLookup: { data: null, error: { code: 'PGRST116', message: 'secret provider detail' } } })
    const repository = createReviewRepository(fake.client as never, auth.auth)
    const error = await repository.transition('plans', 'plan-1', 'pending_review', 'approved').catch((value: unknown) => value)
    expect(error).toBeInstanceOf(ReviewRepositoryError)
    expect((error as Error).message).not.toContain('secret provider detail')
    repository.dispose()
  })

  it('reconciles an actual Supabase insert when PostgREST reorders JSONB keys', async () => {
    const auth = authFixture()
    const response = { ...fingerprintFixture, session_id: 'actual-session-uuid' } as FingerprintResponse
    const row = { id: '11111111-1111-4111-8111-111111111111', session_id: 'actual-session-uuid', response: reordered(response), review_status: 'pending_review', reviewed_by: null, reviewed_at: null, review_note: null }
    const sdk = realSdkClient((url, init) => {
      const method = (init.method ?? 'GET').toUpperCase()
      if (url.pathname.endsWith('/fingerprints') && method === 'GET') return sdkJson([])
      if (url.pathname.endsWith('/fingerprints') && method === 'POST') return sdkJson(row, 201)
      return sdkJson({ message: 'unexpected test route' }, 500)
    })
    const repository = createReviewRepository(sdk.client as never, auth.auth)
    const result = await repository.createFingerprint(detail(), scorerReturning(response))
    expect(result.response).toEqual(response)
    expect(sdk.fetcher).toHaveBeenCalledTimes(2)
    repository.dispose()
  })

  it('accepts a genuine 700ms synthetic WAV without fixture-duration equality and rejects a real mismatch', async () => {
    const auth = authFixture()
    const wav = syntheticWav(0.7)
    const syntheticFake = fakeClient({ audio: { data: wav, error: null } })
    const syntheticRepository = createReviewRepository(syntheticFake.client as never, auth.auth)
    await expect(syntheticRepository.downloadAudio(audioDetail(true, 1300), audioDetail(true, 1300).items[0])).resolves.toBe(wav)
    expect(syntheticFake.audioCalls).toHaveLength(1)
    syntheticRepository.dispose()

    const realFake = fakeClient({ audio: { data: wav, error: null } })
    const realRepository = createReviewRepository(realFake.client as never, auth.auth)
    const realDetail = audioDetail(false, 1100)
    await expect(realRepository.downloadAudio(realDetail, realDetail.items[0])).rejects.toMatchObject({ issue: 'audioUnavailable' })
    expect(realFake.audioCalls).toHaveLength(1)
    realRepository.dispose()
  })

  it('rejects a malicious item filename before issuing a Storage request', async () => {
    const auth = authFixture()
    const fake = fakeClient({ audio: { data: syntheticWav(0.7), error: null } })
    const repository = createReviewRepository(fake.client as never, auth.auth)
    const candidate = audioDetail(true, 1300)
    candidate.items[0].item_id = '../escape'
    candidate.items[0].response = { ...candidate.items[0].response, item_id: '../escape' }
    await expect(repository.downloadAudio(candidate, candidate.items[0])).rejects.toMatchObject({ issue: 'audioUnavailable' })
    expect(fake.audioCalls).toHaveLength(0)
    repository.dispose()
  })

  it('cancels an in-flight fingerprint after identity loss without a subsequent insert', async () => {
    const auth = authFixture()
    const fake = fakeClient()
    const response = { ...fingerprintFixture, session_id: 'actual-session-uuid' } as FingerprintResponse
    let release!: (value: FingerprintResponse) => void
    const scorer = { ...scorerReturning(response), fingerprint: vi.fn(() => new Promise<FingerprintResponse>((resolve) => { release = resolve })) } as unknown as ScorerClient
    const repository = createReviewRepository(fake.client as never, auth.auth)
    const pending = repository.createFingerprint(detail(), scorer)
    await new Promise((resolve) => setTimeout(resolve, 0))
    auth.set(null)
    release(response)
    await expect(pending).rejects.toMatchObject({ issue: 'cancelled' })
    expect(fake.inserted()).toBeNull()
    repository.dispose()
  })

  it('purges fingerprint idempotency state when the verified identity changes', async () => {
    const auth = authFixture()
    const response = { ...fingerprintFixture, session_id: 'actual-session-uuid' } as FingerprintResponse
    const fake = fakeClient({ insert: () => {
      const inserted = fake.inserted() as { id: string; session_id: string; response: FingerprintResponse }
      return { data: { ...inserted, review_status: 'pending_review', reviewed_by: null, reviewed_at: null, review_note: null }, error: null }
    } })
    const repository = createReviewRepository(fake.client as never, auth.auth)
    await repository.createFingerprint(detail(), scorerReturning(response))
    const firstId = (fake.inserted() as { id: string }).id
    const nextIdentity = { id: 'specialist-2', role: 'specialist' as const, accessToken: 'new-verified-token' }
    auth.set(nextIdentity)
    const nextDetail = detail()
    nextDetail.child.specialist_id = nextIdentity.id
    await repository.createFingerprint(nextDetail, scorerReturning(response))
    expect((fake.inserted() as { id: string }).id).not.toBe(firstId)
    repository.dispose()
  })

  it('does not acknowledge approval when the returned association child differs', async () => {
    const auth = authFixture()
    const fake = fakeClient({
      planLookup: { data: { id: 'plan-1', child_id: 'child-1' }, error: null },
      update: { data: { id: 'plan-1', child_id: 'child-2', skill_ids: [], item_ids: [], review_status: 'approved', approved_by: null, approved_at: null }, error: null },
    })
    const repository = createReviewRepository(fake.client as never, auth.auth)
    await expect(repository.transition('plans', 'plan-1', 'pending_review', 'approved')).rejects.toMatchObject({ issue: 'lostUpdate' })
    repository.dispose()
  })
})
