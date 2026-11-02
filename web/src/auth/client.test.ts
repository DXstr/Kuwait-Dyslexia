import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createAuthClient } from './client'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ auth: {} })) }))

beforeEach(() => sessionStorage.clear())

describe('stock Supabase browser client', () => {
  const config = { url: 'https://synthetic.supabase.co', key: 'sb_publishable_synthetic_public_key_only' }

  it('uses PKCE with explicit callback handling and tab-local SDK storage', () => {
    createAuthClient(config, sessionStorage)
    expect(createClient).toHaveBeenCalledWith(config.url, config.key, {
      auth: expect.objectContaining({ flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true, storage: sessionStorage }),
    })
  })

  it('clears only its own session/verifier keys', () => {
    const { clearLocalSession } = createAuthClient(config, sessionStorage)
    sessionStorage.setItem(`basira.auth:${config.url}`, 'synthetic session')
    sessionStorage.setItem(`basira.auth:${config.url}-code-verifier`, 'synthetic verifier')
    sessionStorage.setItem(`basira.auth:${config.url}-user`, 'synthetic user')
    sessionStorage.setItem('other-project', 'keep')
    clearLocalSession()
    expect(sessionStorage.length).toBe(1)
    expect(sessionStorage.getItem('other-project')).toBe('keep')
  })

  it('fails before redirecting if durable PKCE storage is unavailable', () => {
    const storage = { setItem: () => { throw new DOMException('Blocked', 'SecurityError') } } as unknown as Storage
    expect(() => createAuthClient(config, storage)).toThrow('Blocked')
  })
})
