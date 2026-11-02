import { expect, test } from '@playwright/test'
import health from '../../contracts/fixtures/Health.ok.json' with { type: 'json' }
import { ar } from '../src/i18n/messages'
import { mockSupabase } from './support/auth'

// Real-mode client code and browser HTTP, with synthetic intercepted responses.
// No live Google account, scorer/model or child recording is used.
const origin = 'http://127.0.0.1:4175'
const scorer = 'http://127.0.0.1:54328'

test('env-only real mode warms up anonymously only after identity/profile verification and deduplicates focus', async ({ page }) => {
  const { observed } = await mockSupabase(page, 'specialist', { origin })
  let calls = 0
  await page.route(`${scorer}/**`, async (route) => {
    const request = route.request()
    expect(request.method()).toBe('GET')
    expect(new URL(request.url()).pathname).toBe('/health')
    expect(request.headers().authorization).toBeUndefined()
    expect(request.headers().cookie).toBeUndefined()
    expect(observed.userReads).toBeGreaterThan(0)
    expect(observed.profileReads).toBeGreaterThan(0)
    calls += 1
    await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': origin }, body: JSON.stringify(health) })
  })
  await page.goto('/')
  expect(calls).toBe(0)
  await page.getByRole('button', { name: ar.authGoogle }).click()
  await expect(page).toHaveURL(`${origin}/specialist`)
  await expect(page.getByText(ar.scorerReady)).toBeVisible()
  await expect(page.getByText(ar.scorerFixture)).toHaveCount(0)
  expect(calls).toBe(1)
  const reads = observed.profileReads
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => observed.profileReads).toBeGreaterThan(reads)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.specialistTitle)
  expect(calls).toBe(1)
  await page.getByRole('button', { name: ar.authSignOut }).click()
  await expect(page).toHaveURL(`${origin}/`)
  await expect(page.locator('.scorer-notice')).toHaveCount(0)
})

test('invalid real health JSON never blocks sign-in or silently switches to fixtures', async ({ page }) => {
  await mockSupabase(page, 'specialist', { origin })
  let calls = 0
  await page.route(`${scorer}/health`, async (route) => {
    calls += 1
    await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': origin }, body: JSON.stringify(calls === 1 ? { private_service_detail: 'synthetic-invalid-payload' } : health) })
  })
  await page.goto('/')
  await page.getByRole('button', { name: ar.authGoogle }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.specialistTitle)
  await expect(page.getByText(ar.scorerUnavailable)).toBeVisible()
  await expect(page.getByText('synthetic-invalid-payload')).toHaveCount(0)
  await expect(page.getByText(ar.scorerFixture)).toHaveCount(0)
  expect(calls).toBe(1)
  await page.getByRole('button', { name: ar.scorerRetry }).click()
  await expect(page.getByText(ar.scorerReady)).toBeVisible()
  expect(calls).toBe(2)
})
