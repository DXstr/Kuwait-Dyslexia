// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import health from '../../../contracts/fixtures/Health.ok.json'
import meta from '../../../contracts/fixtures/ScoreItemRequestMeta.example.json'
import dialect from '../../../contracts/fixtures/ScoreItemResponse.dialect-variant.json'
import dot from '../../../contracts/fixtures/ScoreItemResponse.dot-confusion.json'
import fingerprintRequest from '../../../contracts/fixtures/FingerprintRequest.example.json'
import fingerprintResponse from '../../../contracts/fixtures/FingerprintResponse.example.json'
import probeRequest from '../../../contracts/fixtures/ProbeRequest.example.json'
import probeResponse from '../../../contracts/fixtures/ProbeResponse.example.json'
import stageRequest from '../../../contracts/fixtures/Stage0ScoreRequest.example.json'
import stageResponse from '../../../contracts/fixtures/Stage0ScoreResponse.license-pending.json'
import unauthorized from '../../../contracts/fixtures/Error.unauthorized.json'
import type { VerifiedAuthSession } from '../auth/controller'
import type { FingerprintRequest, ProbeRequest, ScoreItemRequestMeta, Stage0ScoreRequest } from '../contracts/basira'
import { syntheticWav } from '../test/wav'
import { createScorerClient, type ScorerClient } from './client'

const identity: VerifiedAuthSession = { id: 'synthetic-adult-id', role: 'examiner', accessToken: 'synthetic-verified-access-token' }
const json = (payload: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const realClient = (fetcher: typeof fetch, getAuthorization = () => identity) =>
  createScorerClient({ mode: 'real', baseUrl: 'https://scorer.example/prefix' }, { fetch: fetcher, getAuthorization })
const requests = {
  fingerprint: fingerprintRequest as FingerprintRequest,
  probe: probeRequest as ProbeRequest,
  stage0: stageRequest as Stage0ScoreRequest,
}
const cases = [
  { path: '/fingerprint', call: (client: ScorerClient) => client.fingerprint(requests.fingerprint), request: fingerprintRequest, response: fingerprintResponse },
  { path: '/probe', call: (client: ScorerClient) => client.probe(requests.probe), request: probeRequest, response: probeResponse },
  { path: '/stage0/score', call: (client: ScorerClient) => client.stage0(requests.stage0), request: stageRequest, response: stageResponse },
]

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('stateless real scorer client', () => {
  it('health is anonymous, non-cached and never sends tokens or cookies', async () => {
    const getAuthorization = vi.fn(() => identity)
    const fetcher = vi.fn<typeof fetch>(async () => json(health))
    const client = createScorerClient({ mode: 'real', baseUrl: 'http://localhost:8000' }, { fetch: fetcher, getAuthorization })
    expect(await client.health()).toEqual(health)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('http://localhost:8000/health')
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' })
    expect(getAuthorization).not.toHaveBeenCalled()
  })

  it.each(cases)('implements JSON POST $path without changing request or response', async ({ path, call, request, response }) => {
    const fetcher = vi.fn<typeof fetch>(async () => json(response))
    const before = structuredClone(request)
    expect(await call(realClient(fetcher))).toEqual(response)
    expect(request).toEqual(before)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe(`https://scorer.example/prefix${path}`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual(request)
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${identity.accessToken}`)
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' })
  })

  it('implements WAV multipart /score-item with JSON string metadata and fresh verified bearer auth', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json(dialect))
    const audio = syntheticWav()
    expect(await realClient(fetcher).scoreItem(audio, meta as ScoreItemRequestMeta)).toEqual(dialect)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://scorer.example/prefix/score-item')
    const form = await new Request(url as string, init).formData()
    expect(JSON.parse(form.get('meta') as string)).toEqual(meta)
    expect(await (form.get('audio') as Blob).arrayBuffer()).toEqual(await audio.arrayBuffer())
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${identity.accessToken}`)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([null, { ...identity, accessToken: '' }, { ...identity, accessToken: 'bad\ntoken' }])('rejects missing or unsafe credentials before transport', async (auth) => {
    const fetcher = vi.fn<typeof fetch>()
    const client = createScorerClient({ mode: 'real', baseUrl: 'https://scorer.example' }, { fetch: fetcher, getAuthorization: () => auth })
    await expect(client.fingerprint(requests.fingerprint)).rejects.toMatchObject({ issue: 'unauthorized' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not let guardian credentials score, including in mock mode', async () => {
    const fetcher = vi.fn<typeof fetch>()
    for (const mode of ['real', 'mock'] as const) {
      const client = createScorerClient({ mode, baseUrl: 'https://scorer.example' }, { fetch: fetcher, getAuthorization: () => ({ ...identity, role: 'guardian' }) })
      await expect(client.fingerprint(requests.fingerprint)).rejects.toMatchObject({ issue: 'forbidden' })
      await expect(client.scoreItem(syntheticWav(), meta as ScoreItemRequestMeta)).rejects.toMatchObject({ issue: 'forbidden' })
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('Stage 0 rejects specialists and permits only examiner/admin', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json(stageResponse))
    const specialist = createScorerClient({ mode: 'real', baseUrl: 'https://scorer.example' }, { fetch: fetcher, getAuthorization: () => ({ ...identity, role: 'specialist' }) })
    await expect(specialist.stage0(requests.stage0)).rejects.toMatchObject({ issue: 'forbidden' })
    expect(fetcher).not.toHaveBeenCalled()
    const admin = createScorerClient({ mode: 'real', baseUrl: 'https://scorer.example' }, { fetch: fetcher, getAuthorization: () => ({ ...identity, role: 'admin' }) })
    expect(await admin.stage0(requests.stage0)).toEqual(stageResponse)
  })

  it('rejects invalid outgoing contracts and invalid WAV before network calls', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const client = realClient(fetcher)
    await expect(client.fingerprint({ ...requests.fingerprint, grade: 7 })).rejects.toMatchObject({ issue: 'invalidRequest' })
    await expect(client.probe({ ...requests.probe, unseen: [{}] } as ProbeRequest)).rejects.toMatchObject({ issue: 'invalidRequest' })
    await expect(client.stage0({ ...requests.stage0, child_age_months: 0 })).rejects.toMatchObject({ issue: 'invalidRequest' })
    await expect(client.scoreItem(syntheticWav(), { ...meta, expected_text: '' } as ScoreItemRequestMeta)).rejects.toMatchObject({ issue: 'invalidRequest' })
    await expect(client.scoreItem(new Blob(['not PCM']), meta as ScoreItemRequestMeta)).rejects.toMatchObject({ issue: 'invalidAudio' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(cases)('rejects invalid nested response for $path instead of repairing it', async ({ call, response }) => {
    const payload = { ...response, unexpected_private_field: 'synthetic-secret-must-not-leak' }
    const fetcher = vi.fn<typeof fetch>(async () => json(payload))
    await expect(call(realClient(fetcher))).rejects.toMatchObject({ issue: 'invalidResponse' })
    expect(payload).toHaveProperty('unexpected_private_field')
  })

  it('enforces fingerprint pending review and licensed-score safety', async () => {
    await expect(realClient(vi.fn(async () => json({ ...fingerprintResponse, review_status: 'approved' }))).fingerprint(requests.fingerprint)).rejects.toMatchObject({ issue: 'invalidResponse' })
    await expect(realClient(vi.fn(async () => json({ ...stageResponse, scaled_score: 99 }))).stage0(requests.stage0)).rejects.toMatchObject({ issue: 'responseMismatch' })
  })

  it.each(cases)('rejects a valid but unrelated response for $path', async ({ call, response }) => {
    const payload = 'session_id' in response ? { ...response, session_id: 'unrelated-session' } : { ...response, instrument_id: 'unrelated-instrument' }
    await expect(call(realClient(vi.fn(async () => json(payload))))).rejects.toMatchObject({ issue: 'responseMismatch' })
  })

  it('rejects score results belonging to another item', async () => {
    await expect(realClient(vi.fn(async () => json(dot))).scoreItem(syntheticWav(), meta as ScoreItemRequestMeta)).rejects.toMatchObject({ issue: 'responseMismatch' })
  })

  it.each([400, 401, 403, 422, 429, 503])('validates HTTP %s error responses and never keeps remote messages', async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ error: { ...unauthorized.error, message: 'synthetic-private-remote-detail' } }, status, { 'Retry-After': '12' }))
    const error = await realClient(fetcher).fingerprint(requests.fingerprint).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ issue: 'remote', status, remoteCode: 'unauthorized', retryAfterSeconds: 12 })
    expect(JSON.stringify(error)).not.toContain('synthetic-private-remote-detail')
    expect(String(error)).not.toContain(identity.accessToken)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('validates malformed error bodies too', async () => {
    await expect(realClient(vi.fn(async () => json({ detail: 'private-service-error' }, 500))).fingerprint(requests.fingerprint)).rejects.toMatchObject({ issue: 'invalidResponse' })
  })

  it('rejects malformed UTF-8 inside otherwise valid response JSON instead of replacing bytes', async () => {
    const payload = JSON.stringify({ ...health, model_version: 'sentinel' })
    const bytes = new TextEncoder().encode(payload)
    bytes[payload.indexOf('sentinel')] = 0xff
    const fetcher = vi.fn<typeof fetch>(async () => new Response(bytes, { headers: { 'Content-Type': 'application/json' } }))
    await expect(realClient(fetcher).health()).rejects.toMatchObject({ issue: 'invalidResponse' })
  })

  it('preserves valid UTF-8 Arabic text without normalization', async () => {
    const payload = { ...health, model_version: 'إِصْدَارٌ تَجْرِيبِيٌّ' }
    expect(await realClient(vi.fn(async () => json(payload))).health()).toEqual(payload)
  })

  it.each([
    () => new Response('<html>upstream error</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
    () => new Response('{broken JSON', { headers: { 'Content-Type': 'application/json' } }),
    () => json(health, 200, { 'Content-Length': String(2 * 1024 * 1024 + 1) }),
    () => new Response(' '.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }),
  ])('rejects invalid or oversized HTTP JSON', async (response) => {
    await expect(realClient(vi.fn(async () => response())).health()).rejects.toMatchObject({ issue: 'invalidResponse' })
  })

  it('does not silently fall back to mocks when real mode is offline', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('private-network-detail') })
    await expect(realClient(fetcher).health()).rejects.toMatchObject({ issue: 'network' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('times out even a non-cooperative transport and sends an aborted signal', async () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}))
    const client = createScorerClient({ mode: 'real', baseUrl: 'https://scorer.example' }, { fetch: fetcher, getAuthorization: () => identity, timeoutMs: 10 })
    await expect(client.health()).rejects.toMatchObject({ issue: 'timeout' })
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it('cancels before or during a call without retries', async () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}))
    const client = realClient(fetcher)
    const alreadyCancelled = new AbortController(); alreadyCancelled.abort()
    await expect(client.health({ signal: alreadyCancelled.signal })).rejects.toMatchObject({ issue: 'cancelled' })
    expect(fetcher).not.toHaveBeenCalled()
    const pending = new AbortController()
    const promise = client.health({ signal: pending.signal })
    pending.abort()
    await expect(promise).rejects.toMatchObject({ issue: 'cancelled' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('discards in-flight results if verified auth disappears', async () => {
    let current: VerifiedAuthSession | null = identity
    const fetcher = vi.fn<typeof fetch>(async () => { current = null; return json(fingerprintResponse) })
    const client = createScorerClient({ mode: 'real', baseUrl: 'https://scorer.example' }, { fetch: fetcher, getAuthorization: () => current })
    await expect(client.fingerprint(requests.fingerprint)).rejects.toMatchObject({ issue: 'unauthorized' })
  })

  it('snapshots validated input so caller mutation cannot alter sent data or response correlation', async () => {
    const request = structuredClone(requests.fingerprint)
    const fetcher = vi.fn<typeof fetch>(async () => {
      request.session_id = 'mutated-after-send'
      request.grade = 7
      return json(fingerprintResponse)
    })
    expect(await realClient(fetcher).fingerprint(request)).toEqual(fingerprintResponse)
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual(fingerprintRequest)
  })
})

describe('honest fixture mode', () => {
  it('returns canonical fixtures unchanged and never calls the configured real URL', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const client = createScorerClient({ mode: 'mock', baseUrl: 'https://scorer.example' }, { fetch: fetcher, getAuthorization: () => identity })
    expect(await client.health()).toEqual(health)
    expect(await client.scoreItem(syntheticWav(), meta as ScoreItemRequestMeta)).toEqual(dialect)
    expect(await client.scoreItem(syntheticWav(), { ...meta, item_id: dot.item_id, expected_text: dot.words.map((word) => word.text).join(' ') } as ScoreItemRequestMeta)).toEqual(dot)
    for (const entry of cases) expect(await entry.call(client)).toEqual(entry.response)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('refuses unknown fixture scenarios rather than manufacturing results', async () => {
    const client = createScorerClient({ mode: 'mock', baseUrl: null }, { getAuthorization: () => identity })
    await expect(client.scoreItem(syntheticWav(), { ...meta, item_id: 'unseen-item' } as ScoreItemRequestMeta)).rejects.toMatchObject({ issue: 'fixtureUnavailable' })
    await expect(client.fingerprint({ ...requests.fingerprint, session_id: 'new-session' })).rejects.toMatchObject({ issue: 'fixtureUnavailable' })
  })
})
