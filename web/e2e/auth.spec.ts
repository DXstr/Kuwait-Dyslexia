import { expect, test } from '@playwright/test'
import { ar, en } from '../src/i18n/messages'
import { authIssueCopy } from '../src/ui/pages/auth/copy'
import { landingCopy } from '../src/ui/pages/landing/copy'
import { api, defaultOrigin as testOrigin, mockSupabase } from './support/auth'

// Intercepted Google/Supabase transport, not genuine OAuth evidence.
for (const entry of [
  { role: 'guardian', title: ar.guardianTitle },
  { role: 'specialist', title: ar.specialistTitle },
] as const) {
  test(`mocked Google transport completes real SDK PKCE and applies the verified ${entry.role} role`, async ({ page }) => {
    const { observed } = await mockSupabase(page, entry.role)
    await page.goto('/')
    await expect(page.getByRole('button', { name: landingCopy.hero.primaryAction }).first()).toBeEnabled()
    await page.getByRole('button', { name: landingCopy.hero.primaryAction }).first().click()
    await expect(page).toHaveURL(`${testOrigin}/${entry.role}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(entry.title)
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
    expect(observed.provider).toBe('google')
    expect(observed.exchanged).toBe(1)
    expect(observed.profileReads).toBeGreaterThan(0)
    expect(observed.userReads).toBeGreaterThan(0)
    if (entry.role === 'specialist') await expect(page.getByText(ar.scorerFixture)).toBeVisible()
    else await expect(page.locator('.scorer-notice, .fixture-notice')).toHaveCount(0)
    await page.getByRole('button', { name: ar.authSignOut }).click()
    await expect(page).toHaveURL(`${testOrigin}/`)
    await expect(page.getByRole('button', { name: landingCopy.hero.primaryAction }).first()).toBeEnabled()
    expect(observed.logout).toBe(true)
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('basira.auth:')))).toEqual([])
  })
}

test('synthetic fixture banner is Arabic-first, professional-only and never uploads to the scorer', async ({ page }, testInfo) => {
  let scorerRequests = 0
  await page.route('http://127.0.0.1:54328/**', async (route) => { scorerRequests += 1; await route.abort() })
  await mockSupabase(page, 'specialist')
  await page.goto('/')
  await page.getByRole('button', { name: landingCopy.hero.primaryAction }).first().click()
  await expect(page.getByText(ar.scorerFixture)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('b5-synthetic-fixture-tablet.png'), fullPage: true })
  await page.getByRole('button', { name: ar.languageSwitch }).click()
  await expect(page.getByText(en.scorerFixture)).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByRole('link', { name: en.childNavigation }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('.scorer-notice, .fixture-notice')).toHaveCount(0)
  await expect(page.getByText(/Fixture data|synthetic|score|referral|wrong/i)).toHaveCount(0)
  expect(scorerRequests).toBe(0)
})

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
  await expect(page.getByRole('alert')).toHaveText(landingCopy.auth.unavailable)
  await expect(page.getByRole('navigation', { name: ar.navigation })).toHaveCount(0)
  await context.setOffline(false)
})

test('a failed one-use exchange scrubs callback parameters and never exposes provider details', async ({ page }) => {
  await mockSupabase(page, 'guardian', { rejectExchange: true })
  await page.goto('/auth/callback?code=synthetic-one-use-code&next=https://evil.invalid&role=admin')
  await expect(page).toHaveURL(`${testOrigin}/auth/callback`)
  await expect(page.getByRole('alert')).toContainText(authIssueCopy.callback)
  await expect(page.getByText('synthetic-private-provider-detail')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: ar.navigation })).toHaveCount(0)
})

test('a token returned by exchange still cannot open a workspace when server identity verification fails', async ({ page }) => {
  await mockSupabase(page, 'guardian', { rejectUser: true })
  await page.goto('/')
  await page.getByRole('button', { name: landingCopy.hero.primaryAction }).first().click()
  await expect(page.getByRole('alert')).toContainText(authIssueCopy.session)
  await expect(page.getByRole('navigation', { name: ar.navigation })).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
})
