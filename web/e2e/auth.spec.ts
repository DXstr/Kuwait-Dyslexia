import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ar } from '../src/i18n/messages'

// These are synthetic HTTP fixtures, not Google/Microsoft accounts or evidence
// of genuine OAuth. The normal application has no mock-auth runtime switch.
const api = 'http://127.0.0.1:54329'
const userId = '11111111-1111-4111-8111-111111111111'
const testOrigin = 'http://127.0.0.1:4174'
type Role = 'guardian' | 'specialist' | 'examiner' | 'admin'

const encode = (value: string) => btoa(value).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const encodeBytes = (value: ArrayBuffer) => encode(String.fromCharCode(...new Uint8Array(value)))

async function syntheticSession(role: Role, provider = 'google') {
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
      id: userId, aud: 'authenticated', role: 'authenticated',
      email: 'synthetic-adult@example.invalid',
      created_at: '2026-11-02T00:00:00Z',
      app_metadata: { provider, providers: [provider] },
      user_metadata: { role: 'admin', full_name: 'Synthetic adult fixture — not a real account' },
    },
  }
}

async function mockSupabase(page: Page, role: Role, options: { rejectUser?: boolean; rejectExchange?: boolean } = {}) {
  const session = await syntheticSession(role)
  let challenge = ''
  const observed = { provider: '', scopedEmail: false, exchanged: 0, profileReads: 0, userReads: 0, logout: false }
  const cors = {
    'access-control-allow-origin': testOrigin,
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  }
  await page.route(`${api}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (url.pathname === '/auth/v1/authorize') {
      observed.provider = url.searchParams.get('provider') ?? ''
      observed.scopedEmail = (url.searchParams.get('scopes') ?? '').split(' ').includes('email')
      expect(url.searchParams.get('redirect_to')).toBe(`${testOrigin}/auth/callback`)
      expect(url.searchParams.get('prompt')).toBe('select_account')
      expect(url.searchParams.get('code_challenge_method')?.toLowerCase()).toBe('s256')
      challenge = url.searchParams.get('code_challenge') ?? ''
      expect(challenge).not.toBe('')
      return route.fulfill({ status: 302, headers: { location: `${testOrigin}/auth/callback?code=synthetic-one-use-code` } })
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
    if (url.pathname === '/auth/v1/logout') {
      expect(url.searchParams.get('scope')).toBe('local')
      observed.logout = true
      return route.fulfill({ status: 204, headers: cors })
    }
    throw new Error(`Unexpected mocked-auth request path: ${url.pathname}`)
  })
  return { session, observed }
}

for (const entry of [
  { provider: 'google', role: 'guardian', button: ar.authGoogle, title: ar.guardianTitle },
  { provider: 'azure', role: 'specialist', button: ar.authMicrosoft, title: ar.specialistTitle },
] as const) {
  test(`mocked ${entry.provider} transport completes real SDK PKCE and applies the verified profile role`, async ({ page }) => {
    const { observed } = await mockSupabase(page, entry.role)
    await page.goto('/')
    await expect(page.getByRole('button', { name: entry.button })).toBeEnabled()
    await page.getByRole('button', { name: entry.button }).click()
    await expect(page).toHaveURL(`${testOrigin}/${entry.role}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(entry.title)
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
    expect(observed.provider).toBe(entry.provider)
    expect(observed.exchanged).toBe(1)
    expect(observed.profileReads).toBeGreaterThan(0)
    expect(observed.userReads).toBeGreaterThan(0)
    if (entry.provider === 'azure') expect(observed.scopedEmail).toBe(true)
    await page.getByRole('button', { name: ar.authSignOut }).click()
    await expect(page).toHaveURL(`${testOrigin}/`)
    await expect(page.getByRole('button', { name: ar.authGoogle })).toBeEnabled()
    expect(observed.logout).toBe(true)
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('basira.auth:')))).toEqual([])
  })
}

test('cached role/user metadata cannot override a fresh server-verified guardian profile', async ({ page, context }) => {
  const { session } = await mockSupabase(page, 'guardian')
  await page.addInitScript(({ key, value }) => {
    sessionStorage.setItem(key, JSON.stringify(value))
    localStorage.setItem('app_role', 'admin')
  }, { key: `basira.auth:${api}`, value: session })
  await page.goto('/admin?role=admin')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.unavailableTitle)
  await expect(page.getByRole('link', { name: ar.backToWorkspace })).toHaveAttribute('href', '/guardian')
  await context.setOffline(true)
  await expect(page).toHaveURL(`${testOrigin}/`)
  await expect(page.getByRole('alert')).toHaveText(ar.authUnavailable)
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await context.setOffline(false)
})

test('a failed one-use exchange scrubs callback parameters and never exposes provider details', async ({ page }) => {
  await mockSupabase(page, 'guardian', { rejectExchange: true })
  await page.goto('/auth/callback?code=synthetic-one-use-code&next=https://evil.invalid&role=admin')
  await expect(page).toHaveURL(`${testOrigin}/auth/callback`)
  await expect(page.getByRole('alert')).toHaveText(ar.authCallbackError)
  await expect(page.getByText('synthetic-private-provider-detail')).toHaveCount(0)
  await expect(page.getByRole('navigation')).toHaveCount(0)
})

test('a token returned by exchange still cannot open a workspace when server identity verification fails', async ({ page }) => {
  await mockSupabase(page, 'guardian', { rejectUser: true })
  await page.goto('/')
  await page.getByRole('button', { name: ar.authGoogle }).click()
  await expect(page.getByRole('alert')).toHaveText(ar.authSessionError)
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
})
