import { expect, test, type Page, type Route } from '@playwright/test'
import dialectVariantResponse from '../../contracts/fixtures/ScoreItemResponse.dialect-variant.json' with { type: 'json' }
import dotConfusionResponse from '../../contracts/fixtures/ScoreItemResponse.dot-confusion.json' with { type: 'json' }
import { ar } from '../src/i18n/messages'
import { childCopy } from '../src/ui/pages/child/copy'
import { landingCopy } from '../src/ui/pages/landing/copy'
import { api, defaultOrigin, mockSupabase } from './support/auth'

// These are intercepted loopback responses only. They prove browser/runtime behavior against
// synthetic transport; they do not prove genuine OAuth or a live Supabase/scorer backend.
const childId = '33333333-3333-4333-8333-333333333333'
const sessionId = '44444444-4444-4444-8444-444444444444'
const startedAt = '2026-11-02T00:00:00.000Z'
const validConsent = { signed_at: '2026-01-01T00:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z' }
const childRow = {
  id: childId,
  first_name: 'طفل تجريبي',
  grade: 2,
  dialect_lexicon_id: 'kw',
  is_demo: true,
}
const fixtures = [dialectVariantResponse, dotConfusionResponse] as const

type AssessmentApi = {
  resultBodies: Record<string, unknown>[]
  resultAttempts: number
  uploads: { path: string; body: Uint8Array; contentType: string | undefined }[]
  releaseFirstResult: (() => void) | null
}

type AssessmentApiOptions = {
  consentValid?: boolean
  holdFirstResult?: boolean
  failFirstResult?: boolean
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    headers: {
      'access-control-allow-origin': defaultOrigin,
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
      'access-control-allow-credentials': 'true',
    },
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function requestBody(request: ReturnType<Route['request']>): Record<string, unknown> {
  const body = request.postDataJSON()
  return (Array.isArray(body) ? body[0] : body) as Record<string, unknown>
}

async function installAssessmentApi(page: Page, options: AssessmentApiOptions = {}): Promise<AssessmentApi> {
  const state: AssessmentApi = {
    resultBodies: [],
    resultAttempts: 0,
    uploads: [],
    releaseFirstResult: null,
  }
  const consentRow = options.consentValid === false ? null : validConsent
  let heldFirstResult = false
  let failedFirstResult = false

  await page.route(`${api}/rest/v1/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') return json(route, null, 204)
    if (url.pathname === '/rest/v1/profiles') return route.fallback()
    if (url.pathname === '/rest/v1/sessions' && request.method() === 'GET') return route.fallback()

    if (url.pathname === '/rest/v1/children' && request.method() === 'GET') {
      return json(route, [childRow])
    }
    if (url.pathname === '/rest/v1/consents' && request.method() === 'GET') {
      return json(route, consentRow)
    }
    if (url.pathname === '/rest/v1/sessions' && request.method() === 'POST') {
      const body = requestBody(request)
      expect(body).toMatchObject({ child_id: childId, type: 'assessment', status: 'in_progress' })
      return json(route, { id: sessionId, child_id: childId, started_at: startedAt, status: 'in_progress' })
    }
    if (url.pathname === '/rest/v1/sessions' && request.method() === 'PATCH') {
      return json(route, { id: sessionId, status: requestBody(request).status })
    }
    if (url.pathname === '/rest/v1/item_results' && request.method() === 'POST') {
      state.resultAttempts += 1
      const body = requestBody(request)
      state.resultBodies.push(body)
      if (options.failFirstResult && !failedFirstResult) {
        failedFirstResult = true
        return route.abort('failed')
      }
      if (options.holdFirstResult && !heldFirstResult) {
        heldFirstResult = true
        await new Promise<void>((resolve) => { state.releaseFirstResult = resolve })
      }
      return json(route, {
        id: body.id,
        session_id: body.session_id,
        item_id: body.item_id,
        response: body.response,
        audio_path: body.audio_path,
        synthetic: body.synthetic,
      })
    }
    throw new Error(`Unexpected assessment REST request: ${request.method()} ${url.pathname}`)
  })

  await page.route(`${api}/storage/v1/object/audio/**`, async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return json(route, null, 204)
    expect(request.method()).toBe('POST')
    const url = new URL(request.url())
    state.uploads.push({
      path: decodeURIComponent(url.pathname.replace('/storage/v1/object/audio/', '')),
      body: request.postDataBuffer() ?? new Uint8Array(),
      contentType: request.headers()['content-type'],
    })
    return json(route, { Key: state.uploads.at(-1)?.path ?? '' })
  })

  return state
}

async function countMicrophoneRequests(page: Page) {
  return page.evaluate(() => (window as Window & { __basiraGetUserMediaCalls?: number }).__basiraGetUserMediaCalls ?? 0)
}

async function preparePage(page: Page, options: AssessmentApiOptions = {}) {
  await page.addInitScript(() => {
    const devices = navigator.mediaDevices
    if (!devices?.getUserMedia) return
    const original = devices.getUserMedia.bind(devices)
    Object.defineProperty(devices, 'getUserMedia', {
      configurable: true,
      value: (...args: Parameters<MediaDevices['getUserMedia']>) => {
        const target = window as Window & { __basiraGetUserMediaCalls?: number }
        target.__basiraGetUserMediaCalls = (target.__basiraGetUserMediaCalls ?? 0) + 1
        return original(...args)
      },
    })
  })
  await mockSupabase(page, 'specialist')
  const backend = await installAssessmentApi(page, options)
  await page.goto('/')
  await page.getByRole('button', { name: landingCopy.hero.primaryAction }).first().click()
  await expect(page).toHaveURL(`${defaultOrigin}/specialist`)
  await expect(page.locator('#assessment-child')).toHaveValue(childId)
  return backend
}

async function beginSession(page: Page) {
  await expect(page.getByText(ar.assessmentConsentValid)).toBeVisible()
  const start = page.getByRole('button', { name: ar.assessmentStartButton })
  await expect(start).toBeEnabled()
  await start.click()
  await expect(page).toHaveURL(`${defaultOrigin}/child`)
  await expect(page.getByRole('heading', { name: 'قَلَم' })).toBeVisible()
  await expect(page.getByText(childCopy.boundary.synthetic)).toBeVisible()
  await expect(page.getByRole('heading', { name: ar.assessmentQueueTitle })).toHaveCount(0)
}

async function recordCurrentItem(page: Page) {
  await page.getByRole('button', { name: ar.childMicStart }).click()
  await expect(page.getByRole('button', { name: ar.childMicStop })).toBeVisible()
  // Let Chromium's fake device feed frames through the real AudioWorklet before stopping.
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: ar.childMicStop }).click()
}

function expectChildSafety(page: Page) {
  return expect.poll(async () => {
    const text = await page.locator('body').innerText()
    return { text, hasEnglish: /[A-Za-z]/.test(text), hasForbidden: /score|risk|error|wrong|red/i.test(text) }
  }).toEqual(expect.objectContaining({ hasEnglish: false, hasForbidden: false }))
}

test('blocks microphone access when guardian consent is missing', async ({ page }) => {
  await preparePage(page, { consentValid: false })

  await expect(page.getByText(ar.assessmentConsentMissing)).toBeVisible()
  await expect(page.getByRole('button', { name: ar.assessmentStartButton })).toBeDisabled()
  expect(await countMicrophoneRequests(page)).toBe(0)
})

test('advances immediately with real AudioWorklet WAV capture while background result/storage work is pending', async ({ page }, testInfo) => {
  const backend = await preparePage(page, { holdFirstResult: true })
  await beginSession(page)

  await recordCurrentItem(page)
  await expect(page.getByRole('heading', { name: 'ثَوْب' })).toBeVisible()
  await expect.poll(() => backend.resultBodies).toHaveLength(1)
  // The first result request is deliberately still unresolved; the child already sees item 2.
  expect(await countMicrophoneRequests(page)).toBe(1)
  await expectChildSafety(page)
  await page.screenshot({ path: testInfo.outputPath('b6-synthetic-child-tablet.png') })

  backend.releaseFirstResult?.()
  await expect.poll(() => backend.uploads).toHaveLength(1)

  await recordCurrentItem(page)
  await expect(page.getByRole('heading', { name: ar.childFinishedTitle })).toBeVisible()
  await expectChildSafety(page)
  await expect.poll(() => backend.resultBodies).toHaveLength(2)
  await expect.poll(() => backend.uploads).toHaveLength(2)

  for (const [index, body] of backend.resultBodies.entries()) {
    expect(body.response).toEqual(fixtures[index])
    expect(body.response).toMatchObject({ synthetic: true })
    expect(body.synthetic).toBe(true)
    expect(body.audio_path).toBe(`audio/${childId}/${sessionId}/${fixtures[index].item_id}.wav`)
  }
  for (const upload of backend.uploads) {
    expect(upload.path).toMatch(new RegExp(`^audio/${childId}/${sessionId}/rw-000[12]\\.wav$`))
    expect(upload.contentType).toMatch(/^multipart\/form-data; boundary=/)
    const riff = [0x52, 0x49, 0x46, 0x46]
    const riffIndex = upload.body.findIndex((value, index) => riff.every((byte, offset) => upload.body[index + offset] === byte))
    expect(riffIndex).toBeGreaterThanOrEqual(0)
    expect(new TextDecoder().decode(upload.body.subarray(riffIndex + 8, riffIndex + 12))).toBe('WAVE')
    const wavHeader = new DataView(upload.body.buffer, upload.body.byteOffset + riffIndex, 44)
    expect(wavHeader.getUint16(20, true)).toBe(1)
    expect(wavHeader.getUint16(22, true)).toBe(1)
    expect(wavHeader.getUint32(24, true)).toBe(16_000)
    expect(wavHeader.getUint16(34, true)).toBe(16)
    expect(upload.body.length - riffIndex).toBeGreaterThan(44)
  }

  await page.goBack()
  await expect(page).toHaveURL(`${defaultOrigin}/specialist`)
  await expect(page.getByRole('heading', { name: ar.assessmentQueueTitle })).toBeVisible()
  await expect(page.locator('.queue-counts dd').nth(0)).toHaveText('0')
  await expect(page.locator('.queue-counts dd').nth(2)).toHaveText('0')
})

test('retries a failed result after offline/reconnect in the same tab without exposing queue state to the child', async ({ page, context }) => {
  const backend = await preparePage(page, { failFirstResult: true })
  await beginSession(page)

  await recordCurrentItem(page)
  await expect(page.getByRole('heading', { name: 'ثَوْب' })).toBeVisible()
  await expect.poll(() => backend.resultAttempts).toBe(1)
  await page.goBack()
  await expect(page).toHaveURL(`${defaultOrigin}/specialist`)
  await context.setOffline(true)
  await page.waitForTimeout(700)
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))

  await expect.poll(() => backend.resultAttempts, { timeout: 10_000 }).toBeGreaterThan(1)
  await expect.poll(() => backend.uploads, { timeout: 10_000 }).toHaveLength(1)
  await expect(page.locator('.queue-counts dd').nth(0)).toHaveText('0')
  await expect(page.locator('.queue-counts dd').nth(2)).toHaveText('0')
  expect(backend.resultBodies.at(-1)?.response).toMatchObject({ synthetic: true })
})
