import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import persistedProbeFixture from '../../../contracts/examples/ProbeResponse.persisted-cycle.synthetic.json'
import scoreFixture from '../../../contracts/fixtures/ScoreItemResponse.dialect-variant.json'
import { createTestAuth } from '../test/auth'
import { createRepository, LearningMapRepositoryError } from './repository'

const specialist = createTestAuth({ status: 'signedIn', role: 'specialist', issue: null })
const childId = '33333333-3333-4333-8333-333333333333'
const sessionId = '44444444-4444-4444-8444-444444444444'
const resultId = '55555555-5555-4555-8555-555555555555'
const tapId = '66666666-6666-4666-8666-666666666666'
const at = '2026-11-02T00:00:00.000Z'

function query(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) builder[method] = vi.fn(() => builder)
  builder.abortSignal = vi.fn(() => builder)
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve)
  return builder
}

function clientFor(rows: Record<string, unknown[]>, onFrom = vi.fn()) {
  return {
    from: vi.fn((table: string) => {
      onFrom(table)
      return query(rows[table] ?? [])
    }),
  } as unknown as SupabaseClient
}

function validRows() {
  return {
    children: [{ id: childId, first_name: 'طفل تجريبي', is_demo: true, specialist_id: 'synthetic-adult-test-id' }],
    sessions: [{ id: sessionId, child_id: childId, type: 'practice', status: 'completed', started_at: at, ended_at: at }],
    item_results: [{ id: resultId, session_id: sessionId, item_id: scoreFixture.item_id, response: scoreFixture, synthetic: scoreFixture.synthetic }],
    tap_results: [{ id: tapId, session_id: sessionId, item_id: 'tap-1', evidence: { skill_id: 'vowel.fatha', correct: true, source: 'tap' } }],
    probe_results: [] as unknown[],
    skill_mastery: [{ child_id: childId, skill_id: 'ls.alif', mastery: 0.75, updated_at: at, source_session_id: sessionId }],
  }
}

describe('learning-map live repository', () => {
  it('fails closed before any database read for guardians and unconfigured clients', async () => {
    const from = vi.fn()
    const guardian = createTestAuth({ status: 'signedIn', role: 'guardian', issue: null })
    const repository = createRepository({ from } as unknown as SupabaseClient, guardian.controller)
    expect(repository.canRead()).toBe(false)
    await expect(repository.getAssignedChildren()).rejects.toMatchObject({ code: 'not_authorized' })
    expect(from).not.toHaveBeenCalled()

    const unconfigured = createRepository(null, guardian.controller)
    await expect(unconfigured.listAssignedChildren()).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('returns canonical item skill evidence and tap evidence without score inference', async () => {
    const rows = validRows()
    const repository = createRepository(clientFor(rows), specialist.controller)
    const result = await repository.readChild(childId)
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ childId, sessionId, eventId: `item:${resultId}`, synthetic: true, evidence: scoreFixture.skill_evidence }),
      expect.objectContaining({ childId, sessionId, eventId: `tap:${tapId}`, synthetic: false, evidence: [{ skill_id: 'vowel.fatha', correct: true, source: 'tap' }] }),
    ]))
    expect(result.probes).toEqual([])
    expect(result.storedMastery[0]).toMatchObject({ skillId: 'ls.alif', mastery: 0.75 })
  })

  it('consumes only an acknowledged probe row and preserves its stable event identity and server time', async () => {
    const rows = validRows()
    const probeSession = '77777777-7777-4777-8777-777777777777'
    const eventId = '88888888-8888-4888-8888-888888888888'
    rows.sessions = [{ id: probeSession, child_id: childId, type: 'probe', status: 'completed', started_at: at, ended_at: at }]
    rows.probe_results = [{
      id: '99999999-9999-4999-8999-999999999999', session_id: probeSession, child_id: childId,
      event_id: eventId, response: { ...persistedProbeFixture, session_id: probeSession }, synthetic: true,
      created_at: '2026-11-03T12:34:56.000Z',
    }]
    rows.item_results = []
    rows.tap_results = []
    const repository = createRepository(clientFor(rows), specialist.controller)
    const result = await repository.readChild(childId)
    expect(result.probes).toEqual([expect.objectContaining({
      childId, sessionId: probeSession, eventId, at: Date.parse('2026-11-03T12:34:56.000Z'), completed: true,
    })])
  })

  it('rejects a probe row whose canonical response does not correlate to the durable session', async () => {
    const rows = validRows()
    rows.sessions = [{ id: sessionId, child_id: childId, type: 'probe', status: 'completed', started_at: at, ended_at: at }]
    rows.probe_results = [{ id: resultId, session_id: sessionId, child_id: childId, event_id: tapId, response: persistedProbeFixture, synthetic: true, created_at: at }]
    rows.item_results = []
    rows.tap_results = []
    const repository = createRepository(clientFor(rows), specialist.controller)
    await expect(repository.readChild(childId)).rejects.toMatchObject({ code: 'invalid_data' })
  })

  it('keeps all ordered evidence for one item event and skips unscored items', async () => {
    const rows = validRows()
    const evidence = [
      { skill_id: 'decode.real', correct: true, source: 'audio' },
      { skill_id: 'ls.qaaf', correct: false, source: 'audio' },
      { skill_id: 'ls.laam', correct: true, source: 'audio' },
    ]
    rows.item_results = [
      { ...rows.item_results[0], response: { ...scoreFixture, skill_evidence: evidence } },
      { ...rows.item_results[0], id: '55555555-5555-4555-8555-555555555556', response: { ...scoreFixture, skill_evidence: [] } },
    ]
    const repository = createRepository(clientFor(rows), specialist.controller)
    const result = await repository.readChild(childId)
    const itemEvents = result.events.filter((event) => event.eventId.startsWith('item:'))
    expect(itemEvents).toHaveLength(1)
    expect(itemEvents[0]).toMatchObject({ eventId: `item:${resultId}`, evidence })
  })

  it('orders result windows and flags mastery-window truncation', async () => {
    const rows = validRows()
    rows.skill_mastery = Array.from({ length: 200 }, (_, index) => ({
      child_id: childId,
      skill_id: 'ls.alif',
      mastery: index / 200,
      updated_at: at,
      source_session_id: sessionId,
    }))
    const client = clientFor(rows)
    const repository = createRepository(client, specialist.controller)
    const result = await repository.readChild(childId)
    expect(result.resultsTruncated).toBe(true)
    expect(client.from).toHaveBeenCalledWith('item_results')
    expect(client.from).toHaveBeenCalledWith('tap_results')
  })

  it('rejects a pre-aborted read before consulting the SDK', async () => {
    const from = vi.fn()
    const repository = createRepository({ from } as unknown as SupabaseClient, specialist.controller)
    const abort = new AbortController()
    abort.abort()
    await expect(repository.listAssignedChildren({ signal: abort.signal })).rejects.toMatchObject({ code: 'stale' })
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects malformed or unknown canonical evidence and mastery rows', async () => {
    const rows = validRows()
    rows.item_results[0] = {
      ...rows.item_results[0],
      response: { ...scoreFixture, skill_evidence: [{ skill_id: 'not.canonical', correct: true, source: 'audio' }] },
    }
    const repository = createRepository(clientFor(rows), specialist.controller)
    await expect(repository.readChild(childId)).rejects.toMatchObject({ code: 'invalid_data' })

    const invalidRows = validRows()
    invalidRows.item_results = []
    invalidRows.skill_mastery = [{ ...invalidRows.skill_mastery[0], mastery: 4 }]
    const invalidRepository = createRepository(clientFor(invalidRows), specialist.controller)
    await expect(invalidRepository.readChild(childId)).rejects.toMatchObject({ code: 'invalid_data' })
  })

  it('exposes a generation only for the current verified specialist identity', () => {
    const auth = createTestAuth({ status: 'signedIn', role: 'specialist', issue: null })
    const repository = createRepository(clientFor({ children: [] }), auth.controller)
    expect(repository.getVersion()).toBe(0)

    auth.update({ status: 'signedIn', role: 'guardian', issue: null })
    expect(repository.getVersion()).toBe(-1)

    auth.update({ status: 'signedIn', role: 'specialist', issue: null })
    expect(repository.getVersion()).toBe(2)
    repository.dispose()
    expect(repository.getVersion()).toBe(-1)
  })

  it('discards a late response after the verified role changes and clears private cache', async () => {
    let releaseSessions: (() => void) | null = null
    const rows = validRows()
    const onFrom = vi.fn()
    const client = {
      from: vi.fn((table: string) => {
        onFrom(table)
        if (table === 'children') return query(rows.children)
        if (table === 'sessions') {
          const pending = new Promise<unknown>((resolve) => { releaseSessions = () => resolve({ data: rows.sessions, error: null }) })
          const builder = query([])
          builder.then = (resolve: (value: unknown) => unknown) => pending.then(resolve)
          return builder
        }
        return query((rows as Record<string, unknown[]>)[table] ?? [])
      }),
    } as unknown as SupabaseClient
    const repository = createRepository(client, specialist.controller)
    const pending = repository.readChild(childId)
    await Promise.resolve()
    specialist.update({ status: 'signedIn', role: 'guardian', issue: null })
    const release = releaseSessions as (() => void) | null
    if (release) release()
    await expect(pending).rejects.toMatchObject({ code: 'stale' })
    expect(onFrom).toHaveBeenCalledWith('children')
  })

  it('uses safe repository errors without exposing provider detail', async () => {
    const safeAuth = createTestAuth({ status: 'signedIn', role: 'specialist', issue: null })
    const repository = createRepository(clientFor({ children: [] }, vi.fn()), safeAuth.controller)
    const error = new LearningMapRepositoryError('invalid_data')
    expect(error.message).not.toMatch(/https?:|token|secret/i)
    await expect(repository.listAssignedChildren()).resolves.toEqual([])
  })
})
