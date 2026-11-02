import type {
  FingerprintRequest,
  FingerprintResponse,
  Health,
  ProbeRequest,
  ProbeResponse,
  ScoreItemRequestMeta,
  ScoreItemResponse,
  Stage0ScoreRequest,
  Stage0ScoreResponse,
} from '../contracts/basira'

import healthFixture from '../../../contracts/fixtures/Health.ok.json'
import fingerprintRequestFixture from '../../../contracts/fixtures/FingerprintRequest.example.json'
import fingerprintResponseFixture from '../../../contracts/fixtures/FingerprintResponse.example.json'
import probeRequestFixture from '../../../contracts/fixtures/ProbeRequest.example.json'
import probeResponseFixture from '../../../contracts/fixtures/ProbeResponse.example.json'
import scoreItemRequestFixture from '../../../contracts/fixtures/ScoreItemRequestMeta.example.json'
import dialectVariantResponseFixture from '../../../contracts/fixtures/ScoreItemResponse.dialect-variant.json'
import dotConfusionResponseFixture from '../../../contracts/fixtures/ScoreItemResponse.dot-confusion.json'
import stage0RequestFixture from '../../../contracts/fixtures/Stage0ScoreRequest.example.json'
import stage0ResponseFixture from '../../../contracts/fixtures/Stage0ScoreResponse.license-pending.json'

export type MockOperation = 'health' | 'scoreItem' | 'fingerprint' | 'probe' | 'stage0'

export class FixtureUnavailableError extends Error {
  readonly code = 'fixture_unavailable'

  constructor() {
    super('The requested canonical mock fixture is unavailable.')
    this.name = 'FixtureUnavailableError'
  }
}

const health = healthFixture as Health
const fingerprintRequest = fingerprintRequestFixture as FingerprintRequest
const fingerprintResponse = fingerprintResponseFixture as FingerprintResponse
const probeRequest = probeRequestFixture as ProbeRequest
const probeResponse = probeResponseFixture as ProbeResponse
const scoreItemRequest = scoreItemRequestFixture as ScoreItemRequestMeta
const dialectVariantResponse = dialectVariantResponseFixture as ScoreItemResponse
const dotConfusionResponse = dotConfusionResponseFixture as ScoreItemResponse
const stage0Request = stage0RequestFixture as Stage0ScoreRequest
const stage0Response = stage0ResponseFixture as Stage0ScoreResponse

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stableEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right || left === null || right === null) return false

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => stableEqual(value, right[index]))
  }

  if (!isRecord(left) || !isRecord(right)) return false

  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (leftKeys.length !== rightKeys.length) return false

  return leftKeys.every((key, index) => key === rightKeys[index] && stableEqual(left[key], right[key]))
}

function unavailable(): never {
  throw new FixtureUnavailableError()
}

function scoreRequestMatches(request: unknown, response: ScoreItemResponse): request is ScoreItemRequestMeta {
  if (!isRecord(request)) return false

  const expectedText = response.words.map((word) => word.text).join(' ')
  return (
    request.item_id === response.item_id &&
    request.item_type === response.item_type &&
    request.expected_text === expectedText &&
    request.dialect_lexicon_id === scoreItemRequest.dialect_lexicon_id
  )
}

function scoreItemFixture(request: unknown): ScoreItemResponse {
  const response = [dialectVariantResponse, dotConfusionResponse].find((candidate) =>
    scoreRequestMatches(request, candidate),
  )
  return response === undefined ? unavailable() : structuredClone(response)
}

export function fixtureResponse(operation: MockOperation, request?: unknown): unknown {
  switch (operation) {
    case 'health':
      return structuredClone(health)
    case 'scoreItem':
      return scoreItemFixture(request)
    case 'fingerprint':
      return stableEqual(request, fingerprintRequest)
        ? structuredClone(fingerprintResponse)
        : unavailable()
    case 'probe':
      return stableEqual(request, probeRequest) ? structuredClone(probeResponse) : unavailable()
    case 'stage0':
      return stableEqual(request, stage0Request) ? structuredClone(stage0Response) : unavailable()
    default:
      return unavailable()
  }
}
