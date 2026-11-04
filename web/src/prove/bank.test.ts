import { describe, expect, it } from 'vitest'
import type { ItemBank, ScoreItemResponse } from '../contracts/basira'
import probeRequest from '../../../contracts/fixtures/ProbeRequest.example.json'
import { buildProbeRequest, freshProbeEventId, reviewedProbeItems } from './bank'

const response = probeRequest.practised[0] as ScoreItemResponse

describe('prove bank and canonical helpers', () => {
  it('selects only approved, validated probe-only items from the canonical bank', () => {
    const items = reviewedProbeItems()
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((item) => item.probe_only && item.review.status === 'approved' && item.validation.passed)).toBe(true)
    expect(items.map((item) => item.id)).toEqual(['pp-0f32386c', 'pp-fe200672'])
  })

  it('fails closed when a probe item is not approved', () => {
    const candidate = reviewedProbeItems()[0]
    const bank = {
      version: 'test', generated_at: '2026-01-01T00:00:00Z', synthetic_audio: true,
      items: [{ ...candidate, review: { ...candidate.review, status: 'rejected' } }],
    } as ItemBank
    expect(reviewedProbeItems(bank)).toEqual([])
  })

  it('constructs the canonical request without rewriting scorer response JSON', () => {
    const practised = [structuredClone(response)]
    const unseen = [structuredClone(response)]
    const request = buildProbeRequest('probe-cycle-1', practised, unseen)
    expect(request).toMatchObject({ session_id: 'probe-cycle-1', practised, unseen })
    expect(request.practised[0]).toBe(practised[0])
    expect(request.unseen[0]).toBe(unseen[0])
    expect(request.practised[0]).toEqual(response)
  })

  it('creates a non-timestamp UUID event identity for retries to reuse', () => {
    const eventId = freshProbeEventId()
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/)
    expect(Number.isNaN(Date.parse(eventId))).toBe(true)
  })
})
