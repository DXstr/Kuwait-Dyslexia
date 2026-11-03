import { afterEach, describe, expect, it, vi } from 'vitest'
import { boundedSupabaseFetch } from './fetch'

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Supabase private transport bounds', () => {
  it('forces no-store and aborts the signal even after headers arrive', async () => {
    vi.useFakeTimers()
    const transport = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', transport)
    await boundedSupabaseFetch('https://synthetic.supabase.co/rest/v1/children')
    const options = transport.mock.calls[0] as unknown as [unknown, RequestInit]
    expect(options[1].cache).toBe('no-store')
    expect(options[1].signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(options[1].signal?.aborted).toBe(true)
  })

  it('preserves caller cancellation without replacing its authorization headers', async () => {
    vi.useFakeTimers()
    const transport = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', transport)
    const controller = new AbortController()
    await boundedSupabaseFetch('https://synthetic.supabase.co/storage/v1/object/audio', { signal: controller.signal, headers: { Authorization: 'Bearer synthetic-not-real' } })
    const options = transport.mock.calls[0] as unknown as [unknown, RequestInit]
    controller.abort()
    expect(options[1].signal?.aborted).toBe(true)
    expect(options[1].headers).toEqual({ Authorization: 'Bearer synthetic-not-real' })
  })
})
