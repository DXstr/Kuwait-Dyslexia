import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { createTestAuth } from '../test/auth'
import { createTeachRepository } from './repository'

const childId = '33333333-3333-4333-8333-333333333333'
const sessionId = '44444444-4444-4444-8444-444444444444'
const itemId = 'vt-d681ae06'
const evidence = { skill_id: 'vowel.fatha' as const, correct: false, source: 'tap' as const }

function rpcClient(result: unknown, error: unknown = null, onRpc = vi.fn()) {
  return {
    rpc: vi.fn((name: string, args: unknown) => { onRpc(name, args); return Promise.resolve({ data: result, error }) }),
    from: vi.fn(),
  } as unknown as SupabaseClient
}

function insertClient(result: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {}
  builder.insert = vi.fn(() => builder)
  builder.select = vi.fn(() => builder)
  builder.single = vi.fn(async () => ({ data: result, error }))
  return {
    rpc: vi.fn(),
    from: vi.fn(() => builder),
  } as unknown as SupabaseClient
}

describe('Teach repository', () => {
  it('reads only the database-filtered approved plan RPC for a verified specialist', async () => {
    const auth = createTestAuth({ status: 'signedIn', role: 'specialist', issue: null })
    const onRpc = vi.fn()
    const client = rpcClient([{ plan_id: 'plan-1', skill_ids: ['vowel.fatha'], item_ids: [itemId] }], null, onRpc)
    const repository = createTeachRepository(client, auth.controller)

    await expect(repository.readApprovedPracticePlan(childId)).resolves.toMatchObject({
      id: 'plan-1', childId, reviewStatus: 'approved', source: 'approved_practice_plan',
    })
    expect(onRpc).toHaveBeenCalledWith('approved_practice_plan', { p_child_id: childId })
    repository.dispose()
  })

  it('fails closed for guardians and never queries a private practice plan', async () => {
    const auth = createTestAuth({ status: 'signedIn', role: 'guardian', issue: null })
    const rpc = vi.fn()
    const repository = createTeachRepository({ rpc } as unknown as SupabaseClient, auth.controller)

    await expect(repository.readApprovedPracticePlan(childId)).rejects.toMatchObject({ code: 'forbidden' })
    expect(rpc).not.toHaveBeenCalled()
    repository.dispose()
  })

  it('rejects a pre-aborted read before consulting Supabase', async () => {
    const auth = createTestAuth({ status: 'signedIn', role: 'specialist', issue: null })
    const rpc = vi.fn()
    const repository = createTeachRepository({ rpc } as unknown as SupabaseClient, auth.controller)
    const abort = new AbortController()
    abort.abort()

    await expect(repository.readApprovedPracticePlan(childId, { signal: abort.signal })).rejects.toMatchObject({ code: 'stale' })
    expect(rpc).not.toHaveBeenCalled()
    repository.dispose()
  })

  it('discards a late plan response after verified identity changes', async () => {
    let release!: (value: unknown) => void
    const auth = createTestAuth({ status: 'signedIn', role: 'specialist', issue: null })
    const rpc = vi.fn(() => new Promise((resolve) => { release = resolve }))
    const repository = createTeachRepository({ rpc } as unknown as SupabaseClient, auth.controller)
    const pending = repository.readApprovedPracticePlan(childId)

    auth.update({ status: 'signedIn', role: 'guardian', issue: null })
    release({ data: [{ plan_id: 'plan-1', skill_ids: ['vowel.fatha'], item_ids: [itemId] }], error: null })
    await expect(pending).rejects.toMatchObject({ code: 'stale' })
    repository.dispose()
  })

  it('rejects malformed or multiple RPC rows instead of choosing unreviewed material', async () => {
    const auth = createTestAuth({ status: 'signedIn', role: 'specialist', issue: null })
    const malformed = createTeachRepository(rpcClient([{ plan_id: 'plan-1', skill_ids: ['vowel.fatha'], item_ids: [] }]), auth.controller)
    await expect(malformed.readApprovedPracticePlan(childId)).rejects.toMatchObject({ code: 'schema' })
    malformed.dispose()

    const multiple = createTeachRepository(rpcClient([
      { plan_id: 'plan-1', skill_ids: ['vowel.fatha'], item_ids: [itemId] },
      { plan_id: 'plan-2', skill_ids: ['vowel.kasra'], item_ids: [itemId] },
    ]), auth.controller)
    await expect(multiple.readApprovedPracticePlan(childId)).rejects.toMatchObject({ code: 'schema' })
    multiple.dispose()
  })

  it('stores only canonical tap evidence and rejects audio/probe-style substitutions', async () => {
    const auth = createTestAuth({ status: 'signedIn', role: 'specialist', issue: null })
    const client = insertClient({ id: 'tap-1', session_id: sessionId, item_id: itemId, evidence })
    const repository = createTeachRepository(client, auth.controller)

    await expect(repository.insertTapResult({ sessionId, childId, itemId, evidence })).resolves.toBeUndefined()
    await expect(repository.insertTapResult({ sessionId, childId, itemId, evidence: { ...evidence, source: 'audio' } as never })).rejects.toMatchObject({ code: 'schema' })
    repository.dispose()
  })
})
