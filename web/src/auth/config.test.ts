import { describe, expect, it } from 'vitest'
import { readAuthConfig } from './config'

const publishable = 'sb_publishable_synthetic_test_public_key_only'
const encode = (value: string) => btoa(value).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const legacy = (role: string) => `${encode('{}')}.${encode(JSON.stringify({ role }))}.synthetic`

describe('Supabase public configuration', () => {
  it('is unconfigured without both public settings', () => {
    expect(readAuthConfig({})).toBeNull()
    expect(() => readAuthConfig({ VITE_SUPABASE_URL: 'https://example.supabase.co' })).toThrow(/invalid/)
  })

  it.each(['https://example.supabase.co', 'http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321'])(
    'accepts a secure or local standalone URL: %s', (url) => {
      expect(readAuthConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: publishable }))
        .toEqual({ url, key: publishable })
    },
  )

  it('accepts legacy anon keys without treating decoded data as an identity', () => {
    const key = legacy('anon')
    expect(readAuthConfig({ VITE_SUPABASE_URL: 'https://example.supabase.co/', VITE_SUPABASE_ANON_KEY: key }))
      .toEqual({ url: 'https://example.supabase.co', key })
  })

  it.each(['sb_secret_synthetic_secret_never_allowed', legacy('service_role'), legacy('authenticated'), 'arbitrary-key'])(
    'rejects non-browser credentials without repeating their contents', (key) => {
      const parse = () => readAuthConfig({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: key })
      expect(parse).toThrow('Supabase browser configuration is invalid')
      try { parse() } catch (error) { expect(String(error)).not.toContain(key) }
    },
  )

  it.each(['http://example.com', 'https://user:pass@example.com', 'https://example.com/rest/v1', 'https://example.com?key=secret', 'https://example.com#token', '//example.com', ' https://example.com'])(
    'rejects unsafe or ambiguous base URLs', (url) => {
      expect(() => readAuthConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: publishable })).toThrow(/invalid/)
    },
  )
})
