import { describe, expect, it, vi } from 'vitest'

import fingerprintRequestFixture from '../../../contracts/fixtures/FingerprintRequest.example.json'
import fingerprintResponseFixture from '../../../contracts/fixtures/FingerprintResponse.example.json'
import healthFixture from '../../../contracts/fixtures/Health.ok.json'
import probeRequestFixture from '../../../contracts/fixtures/ProbeRequest.example.json'
import probeResponseFixture from '../../../contracts/fixtures/ProbeResponse.example.json'
import scoreItemRequestFixture from '../../../contracts/fixtures/ScoreItemRequestMeta.example.json'
import dialectVariantResponseFixture from '../../../contracts/fixtures/ScoreItemResponse.dialect-variant.json'
import dotConfusionResponseFixture from '../../../contracts/fixtures/ScoreItemResponse.dot-confusion.json'
import stage0RequestFixture from '../../../contracts/fixtures/Stage0ScoreRequest.example.json'
import stage0ResponseFixture from '../../../contracts/fixtures/Stage0ScoreResponse.license-pending.json'
import { FixtureUnavailableError, fixtureResponse } from './fixtures'

function reordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reordered)
  if (typeof value !== 'object' || value === null) return value

  const entries = Object.entries(value as Record<string, unknown>)
    .reverse()
    .map(([key, nestedValue]) => [key, reordered(nestedValue)])
  return Object.fromEntries(entries)
}

function dotConfusionRequest(): Record<string, unknown> {
  return {
    ...scoreItemRequestFixture,
    item_id: dotConfusionResponseFixture.item_id,
    expected_text: dotConfusionResponseFixture.words.map((word) => word.text).join(' '),
  }
}

function expectUnavailable(call: () => unknown): void {
  expect(call).toThrow(FixtureUnavailableError)
  try {
    call()
  } catch (error) {
    expect(error).toMatchObject({
      code: 'fixture_unavailable',
      message: 'The requested canonical mock fixture is unavailable.',
    })
  }
}

describe('fixtureResponse', () => {
  it('returns every canonical endpoint output unchanged', () => {
    expect(fixtureResponse('health')).toEqual(healthFixture)
    expect(fixtureResponse('scoreItem', scoreItemRequestFixture)).toEqual(dialectVariantResponseFixture)
    expect(fixtureResponse('scoreItem', dotConfusionRequest())).toEqual(dotConfusionResponseFixture)
    expect(fixtureResponse('fingerprint', fingerprintRequestFixture)).toEqual(fingerprintResponseFixture)
    expect(fixtureResponse('probe', probeRequestFixture)).toEqual(probeResponseFixture)
    expect(fixtureResponse('stage0', stage0RequestFixture)).toEqual(stage0ResponseFixture)
  })

  it('keeps synthetic true on every scoring response and omits it from health', () => {
    const responses = [
      fixtureResponse('scoreItem', scoreItemRequestFixture),
      fixtureResponse('scoreItem', dotConfusionRequest()),
      fixtureResponse('fingerprint', fingerprintRequestFixture),
      fixtureResponse('probe', probeRequestFixture),
      fixtureResponse('stage0', stage0RequestFixture),
    ]

    for (const response of responses) {
      expect(response).toMatchObject({ synthetic: true })
    }
    expect(fixtureResponse('health')).not.toHaveProperty('synthetic')
  })

  it('matches structured requests regardless of object property ordering', () => {
    expect(fixtureResponse('fingerprint', reordered(fingerprintRequestFixture))).toEqual(
      fingerprintResponseFixture,
    )
    expect(fixtureResponse('probe', reordered(probeRequestFixture))).toEqual(probeResponseFixture)
    expect(fixtureResponse('stage0', reordered(stage0RequestFixture))).toEqual(stage0ResponseFixture)
  })

  it('returns a fresh clone for every response', () => {
    const cases: [Parameters<typeof fixtureResponse>[0], unknown][] = [
      ['health', undefined],
      ['scoreItem', scoreItemRequestFixture],
      ['scoreItem', dotConfusionRequest()],
      ['fingerprint', fingerprintRequestFixture],
      ['probe', probeRequestFixture],
      ['stage0', stage0RequestFixture],
    ]

    for (const [operation, request] of cases) {
      const first = fixtureResponse(operation, request) as Record<string, unknown>
      const second = fixtureResponse(operation, request) as Record<string, unknown>
      expect(second).not.toBe(first)

      if ('synthetic' in first) first.synthetic = false
      else first.status = 'degraded'
      expect(fixtureResponse(operation, request)).toEqual(
        operation === 'health'
          ? healthFixture
          : operation === 'scoreItem'
            ? request === scoreItemRequestFixture
              ? dialectVariantResponseFixture
              : dotConfusionResponseFixture
            : operation === 'fingerprint'
              ? fingerprintResponseFixture
              : operation === 'probe'
                ? probeResponseFixture
                : stage0ResponseFixture,
      )
    }
  })

  it('fails closed for unknown or mismatched requests', () => {
    expectUnavailable(() =>
      fixtureResponse('scoreItem', { ...scoreItemRequestFixture, item_id: 'rw-9999' }),
    )
    expectUnavailable(() =>
      fixtureResponse('scoreItem', { ...scoreItemRequestFixture, item_type: 'pseudoword' }),
    )
    expectUnavailable(() =>
      fixtureResponse('scoreItem', { ...dotConfusionRequest(), expected_text: 'ثَوْبٌ' }),
    )
    expectUnavailable(() => fixtureResponse('fingerprint'))
    expectUnavailable(() =>
      fixtureResponse('fingerprint', { ...fingerprintRequestFixture, session_id: 'unknown' }),
    )
    expectUnavailable(() => fixtureResponse('probe', reordered({ ...probeRequestFixture, session_id: 'unknown' })))
    expectUnavailable(() => fixtureResponse('stage0', { ...stage0RequestFixture, grade: 4 }))
  })

  it('does not call fetch or any network transport', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    fixtureResponse('health')
    fixtureResponse('scoreItem', scoreItemRequestFixture)
    fixtureResponse('scoreItem', dotConfusionRequest())
    fixtureResponse('fingerprint', fingerprintRequestFixture)
    fixtureResponse('probe', probeRequestFixture)
    fixtureResponse('stage0', stage0RequestFixture)

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
