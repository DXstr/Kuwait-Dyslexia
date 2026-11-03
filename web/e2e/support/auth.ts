import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Synthetic intercepted HTTP only. No real account, provider, JWKS or service
// accepts these credentials; production never imports this test helper.
export const api = 'http://127.0.0.1:54329'
export const userId = '11111111-1111-4111-8111-111111111111'
export const defaultOrigin = 'http://127.0.0.1:4174'
type Role = 'guardian' | 'specialist' | 'examiner' | 'admin'
const encode = (value: string) => btoa(value).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const encodeBytes = (value: ArrayBuffer) => encode(String.fromCharCode(...new Uint8Array(value)))

async function syntheticSession(role: Role) {
  const now = Math.floor(Date.now() / 1000)
  const header = encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const claims = encode(JSON.stringify({
    sub: userId, role: 'authenticated', app_role: role, aud: 'authenticated',
    iss: `${api}/auth/v1`, iat: now, exp: now + 3600,
    session_id: '22222222-2222-4222-8222-222222222222',
  }))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('synthetic-test-key-not-used-by-a-live-service'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = encodeBytes(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${claims}`)))
  return {
    access_token: `${header}.${claims}.${signature}`,
    refresh_token: 'synthetic-refresh-token-not-valid-anywhere',
    token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
    user: {
      id: userId, aud: 'authenticated', role: 'authenticated', email: 'synthetic-adult@example.invalid',
      created_at: '2026-11-02T00:00:00Z',
      app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { role: 'admin', full_name: 'Synthetic adult fixture — not a real account' },
    },
  }
}

export async function mockSupabase(page: Page, role: Role, options: { rejectUser?: boolean; rejectExchange?: boolean; origin?: string } = {}) {
  const origin = options.origin ?? defaultOrigin
  const session = await syntheticSession(role)
  let challenge = ''
  const observed = { provider: '', exchanged: 0, profileReads: 0, userReads: 0, logout: false }
  const cors = { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
  await page.route(`${api}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (url.pathname === '/auth/v1/authorize') {
      observed.provider = url.searchParams.get('provider') ?? ''
      expect(url.searchParams.get('scopes') ?? '').not.toContain('offline_access')
      expect(url.searchParams.get('redirect_to')).toBe(`${origin}/auth/callback`)
      expect(url.searchParams.get('prompt')).toBe('select_account')
      expect(url.searchParams.get('code_challenge_method')?.toLowerCase()).toBe('s256')
      challenge = url.searchParams.get('code_challenge') ?? ''
      expect(challenge).not.toBe('')
      return route.fulfill({ status: 302, headers: { location: `${origin}/auth/callback?code=synthetic-one-use-code` } })
    }
    if (url.pathname === '/auth/v1/token') {
      observed.exchanged += 1
      expect(url.searchParams.get('grant_type')).toBe('pkce')
      const body = request.postDataJSON()
      expect(body.auth_code).toBe('synthetic-one-use-code')
      if (options.rejectExchange) return json({ code: 'flow_state_not_found', msg: 'synthetic-private-provider-detail' }, 400)
      expect(encodeBytes(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.code_verifier)))).toBe(challenge)
      return json(session)
    }
    if (url.pathname === '/auth/v1/user') {
      observed.userReads += 1
      if (options.rejectUser) return json({ code: 'bad_jwt', msg: 'synthetic-private-provider-detail' }, 401)
      return json(session.user)
    }
    if (url.pathname === '/rest/v1/profiles') {
      observed.profileReads += 1
      expect(url.searchParams.get('id')).toBe(`eq.${userId}`)
      expect(url.searchParams.get('select')?.replaceAll(' ', '')).toBe('id,role')
      return json([{ id: userId, role }])
    }
    if (url.pathname === '/rest/v1/children' && request.method() === 'GET') {
      // B6 reads only RLS-visible assignments. Auth-only cases have no demo child.
      return json([])
    }
    if (url.pathname === '/auth/v1/logout') {
      expect(url.searchParams.get('scope')).toBe('local')
      observed.logout = true
      return route.fulfill({ status: 204, headers: cors })
    }
    throw new Error(`Unexpected mocked-auth request path: ${url.pathname}`)
  })
  return { session, observed }
}
