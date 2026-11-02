import { expect, test } from '@playwright/test'
import { ar } from '../src/i18n/messages'

test('Arabic tablet shell loads, self-hosts its font and remains keyboard accessible', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.welcomeTitle)
  await expect(page.getByText(ar.scaffoldBadge)).toBeVisible()
  await expect(page.getByRole('button', { name: ar.authGoogle })).toBeDisabled()
  await expect(page.getByRole('button', { name: ar.authMicrosoft })).toBeDisabled()
  await expect(page.getByRole('alert')).toHaveText(ar.authConfiguration)
  await expect(page.locator('.brand-mark')).toHaveJSProperty('complete', true)
  expect(await page.locator('.brand-mark').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.fonts.check('20px "Noto Naskh Arabic"', 'بِصِيرَةٌ'))).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('unconfigured-tablet.png'), fullPage: true })
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: ar.skipToContent })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
})

test('protected direct links fail closed without a session', async ({ page }) => {
  for (const path of ['/specialist', '/examiner', '/guardian', '/admin', '/child']) {
    await page.goto(`${path}?role=specialist&locale=en`)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.welcomeTitle)
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  }
})

test('small screens do not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('unconfigured callbacks still remove codes, errors and untrusted destinations from the URL', async ({ page }) => {
  await page.goto('/auth/callback?code=synthetic-test-code&next=https://evil.invalid#access_token=synthetic-test-token')
  await expect(page).toHaveURL(/\/auth\/callback$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.authCallbackTitle)
  await expect(page.getByRole('alert')).toHaveText(ar.authConfiguration)
  await expect(page.getByRole('button', { name: ar.authGoogle })).toBeDisabled()
  await expect(page.getByText('synthetic-test-token')).toHaveCount(0)
})

test('ships Arabic install metadata and real icon assets', async ({ page, request }) => {
  await page.goto('/')
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestHref).toBeTruthy()
  const response = await request.get(manifestHref!)
  expect(response.ok()).toBe(true)
  const manifest = await response.json()
  expect(manifest).toMatchObject({ lang: 'ar', dir: 'rtl', display: 'standalone', start_url: '/' })
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192', type: 'image/png' }),
    expect.objectContaining({ sizes: '512x512', type: 'image/png' }),
    expect.objectContaining({ purpose: 'maskable' }),
  ]))
  for (const icon of manifest.icons) {
    const asset = await request.get(icon.src)
    expect(asset.ok()).toBe(true)
    expect(asset.headers()['content-type']).toMatch(/image\//)
  }
})

test('offline support caches only the static shell, never private endpoints', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    await document.fonts.ready
  })
  // A second navigation attaches the installed worker without an aggressive
  // skipWaiting/clientsClaim lifecycle that could interrupt a future session.
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  const cachedURLs = await page.evaluate(async () => {
    const keys = await caches.keys()
    return (await Promise.all(keys.map(async (key) => {
      const cache = await caches.open(key)
      return (await cache.keys()).map((entry) => entry.url)
    }))).flat()
  })
  expect(cachedURLs.length).toBeGreaterThan(0)
  expect(cachedURLs.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true)
  expect(cachedURLs.some((url) => /\/auth\/|\/rest\/|\/storage\/|\/score-item|\/reports\/|\/audio\//.test(url))).toBe(false)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.welcomeTitle)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  // A navigation to a private endpoint must fail offline, not return cached HTML.
  for (const path of ['/auth/v1/token', '/rest/v1/children', '/storage/v1/object/audio', '/score-item?item=1', '/reports/private.pdf']) {
    const privatePage = await context.newPage()
    await expect(privatePage.goto(path)).rejects.toThrow(/ERR_INTERNET_DISCONNECTED|ERR_FAILED/)
    await privatePage.close()
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.welcomeTitle)
  await context.setOffline(false)
})
