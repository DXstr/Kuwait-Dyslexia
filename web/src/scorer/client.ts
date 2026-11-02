import type {
  FingerprintRequest, FingerprintResponse, Health, ProbeRequest, ProbeResponse,
  ScoreItemRequestMeta, ScoreItemResponse, Stage0ScoreRequest, Stage0ScoreResponse,
} from '../contracts/basira'
import type { VerifiedAuthSession } from '../auth/controller'
import { scoreItemMultipart, validateWav } from './audio'
import type { ScorerConfig } from './config'
import { readScorerConfig } from './config'
import { ScorerClientError } from './errors'
import type { MockOperation } from './fixtures'
import { fixtureResponse } from './fixtures'
import type { ContractName, ContractPayloads } from './validation'
import { parseContract } from './validation'

export interface ScorerClient {
  readonly mode: 'mock' | 'real'
  health(options?: CallOptions): Promise<Health>
  scoreItem(audio: Blob, meta: ScoreItemRequestMeta, options?: CallOptions): Promise<ScoreItemResponse>
  fingerprint(request: FingerprintRequest, options?: CallOptions): Promise<FingerprintResponse>
  probe(request: ProbeRequest, options?: CallOptions): Promise<ProbeResponse>
  stage0(request: Stage0ScoreRequest, options?: CallOptions): Promise<Stage0ScoreResponse>
}

export type CallOptions = { signal?: AbortSignal }
type ClientOptions = {
  getAuthorization: () => VerifiedAuthSession | null
  fetch?: typeof fetch
  timeoutMs?: number
}
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

function assertRequest<K extends ContractName>(name: K, value: unknown): ContractPayloads[K] {
  try { return parseContract(name, value) } catch { throw new ScorerClientError('invalidRequest') }
}
function assertResponse<K extends ContractName>(name: K, value: unknown): ContractPayloads[K] {
  try { return parseContract(name, value) } catch { throw new ScorerClientError('invalidResponse') }
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
  if (contentType !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/.test(contentType)) {
    throw new ScorerClientError('invalidResponse')
  }
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new ScorerClientError('invalidResponse')
  if (!response.body) throw new ScorerClientError('invalidResponse')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const decode = (value?: Uint8Array, stream = false) => {
    try { return decoder.decode(value, { stream }) } catch { throw new ScorerClientError('invalidResponse') }
  }
  let count = 0
  let text = ''
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      count += value.byteLength
      if (count > MAX_RESPONSE_BYTES) throw new ScorerClientError('invalidResponse')
      text += decode(value, true)
    }
    text += decode()
    signal.throwIfAborted()
    try { return JSON.parse(text) as unknown } catch { throw new ScorerClientError('invalidResponse') }
  } finally {
    try { await reader.cancel() } catch { /* An already-aborted stream may reject cancellation. */ }
    reader.releaseLock()
  }
}

function retryAfter(response: Response): number | null {
  const raw = response.headers.get('retry-after')
  if (!raw) return null
  const seconds = /^\d+$/.test(raw) ? Number(raw) : Math.ceil((Date.parse(raw) - Date.now()) / 1000)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

/** No database access, result repair, automatic scoring retries or mock fallback. */
export function createScorerClient(config: ScorerConfig, options: ClientOptions): ScorerClient {
  // Recheck even programmatically supplied config; URL construction must not leak bearer tokens.
  const verifiedConfig = readScorerConfig({ VITE_SCORER_MODE: config.mode, VITE_SCORER_URL: config.baseUrl ?? '' })
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  const timeoutMs = options.timeoutMs ?? 30_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ScorerClientError('configuration')

  const authorization = (stage0 = false) => {
    const current = options.getAuthorization()
    if (!current || !current.accessToken || /\s/.test(current.accessToken) ||
        [...current.accessToken].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      throw new ScorerClientError('unauthorized')
    }
    const allowed = stage0 ? ['examiner', 'admin'] : ['specialist', 'examiner', 'admin']
    if (!allowed.includes(current.role)) throw new ScorerClientError('forbidden')
    return current
  }

  const sameIdentity = (identity: VerifiedAuthSession | null) => {
    if (!identity) return
    const current = options.getAuthorization()
    if (!current || current.id !== identity.id || current.role !== identity.role || current.accessToken !== identity.accessToken) {
      throw new ScorerClientError('unauthorized')
    }
  }

  const bounded = async <T,>(callOptions: CallOptions, operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    if (callOptions.signal?.aborted) throw new ScorerClientError('cancelled')
    const controller = new AbortController()
    const cancel = () => controller.abort('cancelled')
    callOptions.signal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)
    let onAbort: (() => void) | undefined
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new ScorerClientError(controller.signal.reason === 'timeout' ? 'timeout' : 'cancelled'))
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      return await Promise.race([operation(controller.signal), aborted])
    } catch (error) {
      if (controller.signal.aborted) throw new ScorerClientError(controller.signal.reason === 'timeout' ? 'timeout' : 'cancelled')
      if (error instanceof ScorerClientError) throw error
      throw new ScorerClientError('network')
    } finally {
      clearTimeout(timer)
      callOptions.signal?.removeEventListener('abort', cancel)
      if (onAbort) controller.signal.removeEventListener('abort', onAbort)
    }
  }

  const exchange = async <K extends ContractName>(
    path: string, operation: MockOperation, responseName: K, request: unknown,
    init: RequestInit, identity: VerifiedAuthSession | null, signal: AbortSignal,
  ): Promise<ContractPayloads[K]> => {
    signal.throwIfAborted()
    sameIdentity(identity)
    let payload: unknown
    if (verifiedConfig.mode === 'mock') {
      try { payload = fixtureResponse(operation, request) } catch { throw new ScorerClientError('fixtureUnavailable') }
    } else {
      const headers = new Headers(init.headers)
      headers.set('Accept', 'application/json')
      if (identity) headers.set('Authorization', `Bearer ${identity.accessToken}`)
      const response = await fetcher(`${verifiedConfig.baseUrl}${path}`, {
        ...init, headers, signal, credentials: 'omit', cache: 'no-store',
        redirect: 'error', referrerPolicy: 'no-referrer',
      })
      signal.throwIfAborted()
      sameIdentity(identity)
      payload = await readJson(response, signal)
      sameIdentity(identity)
      if (!response.ok) {
        const error = assertResponse('Error', payload)
        throw new ScorerClientError('remote', {
          status: response.status, remoteCode: error.error.code, retryAfterSeconds: retryAfter(response),
        })
      }
    }
    signal.throwIfAborted()
    sameIdentity(identity)
    const result = assertResponse(responseName, payload)
    if (verifiedConfig.mode === 'mock' && operation !== 'health' &&
        (!(typeof result === 'object' && result !== null && 'synthetic' in result) || result.synthetic !== true)) {
      throw new ScorerClientError('invalidResponse')
    }
    return result
  }

  const jsonCall = <RequestName extends ContractName, ResponseName extends ContractName>(
    requestName: RequestName, responseName: ResponseName, path: string,
    operation: MockOperation, request: ContractPayloads[RequestName], callOptions: CallOptions,
    match: (response: ContractPayloads[ResponseName], input: ContractPayloads[RequestName]) => boolean,
  ) => bounded(callOptions, async (signal) => {
    const identity = authorization(operation === 'stage0')
    const input = structuredClone(assertRequest(requestName, request))
    const result = await exchange(path, operation, responseName, input, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }, identity, signal)
    if (!match(result, input)) throw new ScorerClientError('responseMismatch')
    return result
  })

  return {
    mode: verifiedConfig.mode,
    health: (callOptions = {}) => bounded(callOptions, (signal) =>
      exchange('/health', 'health', 'Health', undefined, { method: 'GET' }, null, signal)),
    scoreItem: (audio, meta, callOptions = {}) => bounded(callOptions, async (signal) => {
      const identity = authorization()
      const metadata = structuredClone(assertRequest('ScoreItemRequestMeta', meta))
      await validateWav(audio)
      signal.throwIfAborted()
      const { body, contentType } = scoreItemMultipart(audio, metadata)
      const response = await exchange('/score-item', 'scoreItem', 'ScoreItemResponse', metadata, {
        method: 'POST', headers: { 'Content-Type': contentType }, body,
      }, identity, signal)
      if (response.item_id !== metadata.item_id || response.item_type !== metadata.item_type) throw new ScorerClientError('responseMismatch')
      return response
    }),
    fingerprint: (request, callOptions = {}) => jsonCall('FingerprintRequest', 'FingerprintResponse', '/fingerprint', 'fingerprint', request, callOptions,
      (response, input) => response.session_id === input.session_id),
    probe: (request, callOptions = {}) => jsonCall('ProbeRequest', 'ProbeResponse', '/probe', 'probe', request, callOptions,
      (response, input) => response.session_id === input.session_id),
    stage0: (request, callOptions = {}) => jsonCall('Stage0ScoreRequest', 'Stage0ScoreResponse', '/stage0/score', 'stage0', request, callOptions,
      (response, input) => response.construct === input.construct && response.instrument_id === input.instrument_id &&
        (response.licence_status !== 'license_pending' || response.scaled_score === null)),
  }
}
