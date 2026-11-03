/// <reference types="node" />
import { expect, test, type Page, type Route } from '@playwright/test'
import { Buffer } from 'node:buffer'
import fingerprintResponseFixture from '../../contracts/fixtures/FingerprintResponse.example.json' with { type: 'json' }
import dialectVariantResponse from '../../contracts/fixtures/ScoreItemResponse.dialect-variant.json' with { type: 'json' }
import dotConfusionResponse from '../../contracts/fixtures/ScoreItemResponse.dot-confusion.json' with { type: 'json' }
import parentReportFixture from '../../contracts/fixtures/ParentReport.sample.json' with { type: 'json' }
import health from '../../contracts/fixtures/Health.ok.json' with { type: 'json' }
import { ar } from '../src/i18n/messages'
import { api, mockSupabase, userId } from './support/auth'

// These tests intercept every Supabase/scorer/storage request at loopback. They do not
// exercise genuine OAuth, a live model, a clinical service, or real child data.
const origin = 'http://127.0.0.1:4175'
const scorer = 'http://127.0.0.1:54328'
const childId = '33333333-3333-4333-8333-333333333333'
const sessionId = '44444444-4444-4444-8444-444444444444'
const fingerprintId = '55555555-5555-4555-8555-555555555555'
const staleFingerprintId = '66666666-6666-4666-8666-666666666666'
const planId = '77777777-7777-4777-8777-777777777777'
const reportId = '88888888-8888-4888-8888-888888888888'
const startedAt = '2026-11-02T00:00:00.000Z'
const endedAt = '2026-11-02T00:09:00.000Z'
const audioExpiry = '2099-01-01T00:00:00.000Z'

const itemResponses = [dialectVariantResponse, dotConfusionResponse] as const
const tapEvidence = [
  { skill_id: 'vowel.kasra', correct: false, source: 'tap' },
  { skill_id: 'vowel.fatha', correct: true, source: 'tap' },
] as const
const canonicalFingerprintResponse = fingerprintResponseFixture
const syntheticFingerprintResponse = { ...canonicalFingerprintResponse, session_id: sessionId }
const childRow = {
  id: childId,
  first_name: 'سارة',
  grade: 3,
  dialect_lexicon_id: 'kw',
  is_demo: true,
  specialist_id: userId,
}
const sessionRow = {
  id: sessionId,
  child_id: childId,
  type: 'assessment',
  status: 'completed',
  started_at: startedAt,
  ended_at: endedAt,
  run_by: userId,
}
const itemRows = itemResponses.map((response, index) => ({
  id: `99999999-9999-4999-8999-99999999999${index + 1}`,
  session_id: sessionId,
  item_id: response.item_id,
  response,
  audio_path: `audio/${childId}/${sessionId}/${response.item_id}.wav`,
  audio_expires_at: audioExpiry,
  synthetic: true,
}))
const tapRows = tapEvidence.map((evidence, index) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index + 1}`,
  session_id: sessionId,
  item_id: 'tap-0001',
  evidence,
}))

type ReviewApiOptions = {
  withApprovalRows?: boolean
  holdTransition?: string
  staleTransition?: string
}
type ReviewApiState = {
  fingerprintRows: Array<Record<string, unknown>>
  planRows: Array<Record<string, unknown>>
  reportRows: Array<Record<string, unknown>>
  transitionBodies: Array<{ table: string; body: Record<string, unknown>; query: URL }>
  storagePaths: string[]
  fingerprintRequests: Record<string, unknown>[]
  releaseTransition: (() => void) | null
}

function cors(originValue = origin) {
  return {
    'access-control-allow-origin': originValue,
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-credentials': 'true',
  }
}
function json(route: Route, body: unknown, status = 200, originValue = origin) {
  return route.fulfill({ status, headers: cors(originValue), contentType: 'application/json', body: JSON.stringify(body) })
}
function bodyOf(route: Route): Record<string, unknown> {
  const body = route.request().postDataJSON()
  return (Array.isArray(body) ? body[0] : body) as Record<string, unknown>
}
function wav(durationMs: number): Uint8Array {
  const sampleRate = 16_000
  const channels = 1
  const bits = 16
  const dataLength = Math.floor(sampleRate * durationMs / 1000) * channels * bits / 8
  const output = new Uint8Array(44 + dataLength)
  const view = new DataView(output.buffer)
  const ascii = (text: string, offset: number) => text.split('').forEach((character, index) => output[offset + index] = character.charCodeAt(0))
  ascii('RIFF', 0)
  view.setUint32(4, 36 + dataLength, true)
  ascii('WAVE', 8)
  ascii('fmt ', 12)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * bits / 8, true)
  view.setUint16(32, channels * bits / 8, true)
  view.setUint16(34, bits, true)
  ascii('data', 36)
  view.setUint32(40, dataLength, true)
  return output
}
function responseForFingerprint(id: string) {
  return {
    id,
    session_id: sessionId,
    response: syntheticFingerprintResponse,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    sessions: { child_id: childId },
  }
}
function responseForPlan(reviewStatus: string) {
  return {
    id: planId,
    child_id: childId,
    skill_ids: ['dot.baa-taa-thaa-nuun-yaa'],
    item_ids: ['rw-0002'],
    review_status: reviewStatus,
    approved_by: reviewStatus === 'approved' ? userId : null,
    approved_at: reviewStatus === 'approved' ? '2026-11-03T00:00:00.000Z' : null,
  }
}
function responseForReport(reviewStatus: string) {
  return {
    id: reportId,
    child_id: childId,
    session_id: sessionId,
    content: parentReportFixture,
    pdf_path: null,
    review_status: reviewStatus,
    approved_by: reviewStatus === 'approved' ? userId : null,
  }
}

async function installReviewApi(page: Page, options: ReviewApiOptions = {}): Promise<ReviewApiState> {
  const state: ReviewApiState = {
    fingerprintRows: options.withApprovalRows
      ? [responseForFingerprint(fingerprintId), responseForFingerprint(staleFingerprintId)]
      : [],
    planRows: options.withApprovalRows ? [responseForPlan('draft')] : [],
    reportRows: options.withApprovalRows ? [responseForReport('pending_review')] : [],
    transitionBodies: [],
    storagePaths: [],
    fingerprintRequests: [],
    releaseTransition: null,
  }
  let held = false
  let staleUsed = false

  await page.route(`${api}/rest/v1/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') return json(route, null, 204)
    if (url.pathname === '/rest/v1/profiles') return route.fallback()
    if (url.pathname === '/rest/v1/children') return route.fallback()
    if (url.pathname === '/rest/v1/sessions' && request.method() === 'GET') {
      if (url.searchParams.has('id')) return json(route, { ...sessionRow, children: childRow })
      return json(route, [{ ...sessionRow, children: childRow }])
    }
    if (url.pathname === '/rest/v1/item_results' && request.method() === 'GET') return json(route, itemRows)
    if (url.pathname === '/rest/v1/tap_results' && request.method() === 'GET') return json(route, tapRows)
    if (url.pathname === '/rest/v1/fingerprints' && request.method() === 'GET') {
      if (url.searchParams.has('id') && !url.searchParams.has('session_id')) {
        const row = state.fingerprintRows.find((candidate) => candidate.id === url.searchParams.get('id')?.replace('eq.', ''))
        return json(route, row ?? null)
      }
      return json(route, state.fingerprintRows)
    }
    if (url.pathname === '/rest/v1/plans' && request.method() === 'GET') return json(route, state.planRows)
    if (url.pathname === '/rest/v1/parent_reports' && request.method() === 'GET') return json(route, state.reportRows)
    if (url.pathname === '/rest/v1/fingerprints' && request.method() === 'POST') {
      const requestBody = bodyOf(route)
      state.fingerprintRequests.push(requestBody)
      expect(requestBody).toMatchObject({ session_id: sessionId, review_status: 'pending_review' })
      expect(requestBody.response).toEqual(syntheticFingerprintResponse)
      const row = { id: fingerprintId, ...requestBody, reviewed_by: null, reviewed_at: null, review_note: null }
      state.fingerprintRows = [row]
      return json(route, row)
    }
    if (request.method() === 'PATCH' && ['fingerprints', 'plans', 'parent_reports'].some((table) => url.pathname === `/rest/v1/${table}`)) {
      const table = url.pathname.split('/').at(-1) ?? ''
      const requestBody = bodyOf(route)
      state.transitionBodies.push({ table, body: requestBody, query: url })
      const rowId = url.searchParams.get('id')?.replace('eq.', '') ?? ''
      const expected = url.searchParams.get('review_status')?.replace('eq.', '') ?? ''
      if (options.staleTransition === rowId && !staleUsed) {
        staleUsed = true
        return json(route, { code: 'PGRST116', message: 'synthetic stale row for test only' }, 406)
      }
      if (options.holdTransition === rowId && !held) {
        held = true
        await new Promise<void>((resolve) => { state.releaseTransition = resolve })
      }
      const target = String(requestBody.review_status)
      if (table === 'fingerprints') {
        const row = state.fingerprintRows.find((candidate) => candidate.id === rowId)
        if (!row || row.review_status !== expected) return json(route, { code: 'PGRST116' }, 406)
        Object.assign(row, { review_status: target, review_note: requestBody.review_note ?? null, reviewed_by: target === 'approved' ? userId : null, reviewed_at: target === 'approved' ? '2026-11-03T00:00:00.000Z' : null })
        return json(route, row)
      }
      if (table === 'plans') {
        const row = state.planRows[0]
        if (row.id !== rowId || row.review_status !== expected) return json(route, { code: 'PGRST116' }, 406)
        Object.assign(row, { review_status: target, approved_by: target === 'approved' ? userId : null, approved_at: target === 'approved' ? '2026-11-03T00:00:00.000Z' : null })
        return json(route, row)
      }
      const row = state.reportRows[0]
      if (row.id !== rowId || row.review_status !== expected) return json(route, { code: 'PGRST116' }, 406)
      Object.assign(row, { review_status: target, approved_by: target === 'approved' ? userId : null })
      return json(route, row)
    }
    throw new Error(`Unexpected review REST request: ${request.method()} ${url.pathname}`)
  })

  await page.route(`${api}/storage/v1/object/audio/**`, async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return json(route, null, 204)
    expect(request.method()).toBe('GET')
    const url = new URL(request.url())
    const path = decodeURIComponent(url.pathname.replace('/storage/v1/object/audio/', ''))
    state.storagePaths.push(path)
    expect(path).toBe(`audio/${childId}/${sessionId}/${itemResponses[0].item_id}.wav`)
    return route.fulfill({ status: 200, headers: cors(), contentType: 'audio/wav', body: Buffer.from(wav(itemResponses[0].audio_duration_ms)) })
  })

  await page.route(`${scorer}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET') {
      expect(url.pathname).toBe('/health')
      expect(request.headers().authorization).toBeUndefined()
      return json(route, health)
    }
    expect(request.method()).toBe('POST')
    expect(url.pathname).toBe('/fingerprint')
    const requestBody = bodyOf(route)
    state.fingerprintRequests.push(requestBody)
    expect(requestBody.session_id).toBe(sessionId)
    expect(requestBody.grade).toBe(3)
    expect(requestBody.duration_ms).toBe(540_000)
    expect(requestBody.items).toEqual(itemResponses)
    expect(requestBody.tap_results).toEqual(tapEvidence)
    return json(route, syntheticFingerprintResponse)
  })
  return state
}

async function signInSpecialist(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: ar.authGoogle }).click()
  await expect(page).toHaveURL(`${origin}/specialist`)
  await expect(page.getByRole('heading', { name: ar.reviewTitle })).toBeVisible()
}

async function prepareURLRevokeSpy(page: Page) {
  await page.addInitScript(() => {
    const target = window as Window & { __basiraRevokedObjectURLs?: string[] }
    target.__basiraRevokedObjectURLs = []
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = (url: string) => {
      target.__basiraRevokedObjectURLs?.push(url)
      return revoke(url)
    }
  })
}

test('renders a completed synthetic session, submits the actual fingerprint request, and keeps audio private', async ({ page }, testInfo) => {
  await prepareURLRevokeSpy(page)
  await mockSupabase(page, 'specialist', { origin })
  const backend = await installReviewApi(page)
  await signInSpecialist(page)

  await expect(page.locator('#review-session')).toHaveValue(sessionId)
  await expect(page.locator('.review-detail-heading')).toContainText('سارة')
  await expect(page.locator('.review-detail-heading')).toContainText(ar.reviewDemoChild)
  await expect(page.getByRole('heading', { name: 'قَلَم' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'ثَوْب' })).toBeVisible()
  await expect(page.getByText(ar.reviewDialectVariant)).toBeVisible()
  await expect(page.getByText(/لهجة.*خطأ/)).toHaveCount(1)
  await expect(page.getByText(ar.scorerFixture)).toHaveCount(2)
  await expect(page.getByText('عدد البنود غير كافٍ للفصل: القرار للأخصائي.')).toHaveCount(0)

  const firstItem = page.locator('article.review-item-card').first()
  await firstItem.getByRole('button', { name: ar.reviewPlayClip }).click()
  await expect.poll(() => backend.storagePaths.length).toBe(1)
  await expect(firstItem.locator('audio')).toHaveAttribute('src', /^blob:/)
  expect(backend.storagePaths).toEqual([`audio/${childId}/${sessionId}/${itemResponses[0].item_id}.wav`])
  expect(await page.locator('body').innerText()).not.toContain('/storage/v1/object/audio')
  expect(await page.locator('body').innerText()).not.toContain('signedURL')

  await page.getByRole('button', { name: ar.reviewCreateFingerprint }).click()
  await expect(page.locator('.review-fingerprint-card, article[aria-labelledby^="fingerprint-"]').first()).toBeVisible()
  await expect(page.getByText('عدد البنود غير كافٍ للفصل: القرار للأخصائي.')).toBeVisible()
  const scorerRequest = backend.fingerprintRequests.find((request) => request.session_id === sessionId && request.items)
  expect(scorerRequest).toBeDefined()
  expect(scorerRequest).toMatchObject({ session_id: sessionId, grade: 3, duration_ms: 540_000, items: itemResponses, tap_results: tapEvidence })
  expect(backend.fingerprintRequests.some((request) => request.response && request.review_status === 'pending_review')).toBe(true)
  await expect(page.getByText(ar.reviewStatusPending)).toBeVisible()

  await page.screenshot({ path: testInfo.outputPath('b7-synthetic-review-tablet.png') })
  await page.getByRole('button', { name: ar.authSignOut }).click()
  await expect(page).toHaveURL(`${origin}/`)
  await expect.poll(() => page.evaluate(() => (window as Window & { __basiraRevokedObjectURLs?: string[] }).__basiraRevokedObjectURLs?.length ?? 0)).toBeGreaterThan(0)
})

test('uses exact approval acknowledgements, does not publish optimistically, and surfaces a stale-row error', async ({ page }) => {
  await mockSupabase(page, 'specialist', { origin })
  const backend = await installReviewApi(page, { withApprovalRows: true, holdTransition: fingerprintId, staleTransition: staleFingerprintId })
  await signInSpecialist(page)
  await expect(page.getByText(ar.reviewStatusPending)).toHaveCount(3)
  await expect(page.getByText(ar.reviewStatusDraft)).toHaveCount(1)

  const fingerprintCards = page.locator('article[aria-labelledby^="fingerprint-"]')
  const firstFingerprint = fingerprintCards.nth(0)
  const staleFingerprint = fingerprintCards.nth(1)
  const firstApprove = firstFingerprint.getByRole('button', { name: ar.reviewApprove })
  await firstApprove.click()
  await expect.poll(() => backend.transitionBodies.length).toBe(1)
  expect(backend.transitionBodies[0]).toMatchObject({ table: 'fingerprints', body: { review_status: 'approved' } })
  await expect(firstFingerprint.getByText(ar.reviewStatusPending)).toBeVisible()
  backend.releaseTransition?.()
  await expect(firstFingerprint.getByText(ar.reviewStatusApproved)).toBeVisible()

  const plans = page.getByRole('heading', { name: ar.reviewPlansTitle }).locator('..').locator('.review-card')
  await plans.getByRole('button', { name: ar.reviewSubmit }).click()
  await expect.poll(() => backend.transitionBodies.some(({ table, body }) => table === 'plans' && body.review_status === 'pending_review')).toBe(true)
  const planTransition = backend.transitionBodies.find(({ table }) => table === 'plans')
  expect(planTransition?.query.searchParams.get('review_status')).toBe('eq.draft')
  expect(planTransition?.body).toEqual({ review_status: 'pending_review' })
  await expect(plans.getByText(ar.reviewStatusPending)).toBeVisible()
  await plans.getByRole('button', { name: ar.reviewApprove }).click()
  await expect.poll(() => backend.transitionBodies.filter(({ table }) => table === 'plans').length).toBe(2)
  const planApproval = backend.transitionBodies.filter(({ table }) => table === 'plans')[1]
  expect(planApproval.query.searchParams.get('review_status')).toBe('eq.pending_review')
  expect(planApproval.body).toEqual({ review_status: 'approved' })
  await expect(plans.getByText(ar.reviewStatusApproved)).toBeVisible()

  const reports = page.getByRole('heading', { name: ar.reviewReportsTitle }).locator('..').locator('.review-card')
  await reports.getByRole('button', { name: ar.reviewApprove }).click()
  await expect.poll(() => backend.transitionBodies.some(({ table }) => table === 'parent_reports')).toBe(true)
  const reportTransition = backend.transitionBodies.find(({ table }) => table === 'parent_reports')
  expect(reportTransition?.query.searchParams.get('review_status')).toBe('eq.pending_review')
  expect(reportTransition?.body).toEqual({ review_status: 'approved' })
  await expect(reports.getByText(ar.reviewStatusApproved)).toBeVisible()

  await staleFingerprint.getByRole('button', { name: ar.reviewReject }).click()
  await expect.poll(() => backend.transitionBodies.filter(({ table }) => table === 'fingerprints').length).toBe(2)
  await expect(page.getByText(ar.reviewLostUpdate)).toBeVisible()
  await expect(staleFingerprint.getByText(ar.reviewStatusPending)).toBeVisible()
})

test('guardian navigation cannot render specialist review or read sessions', async ({ page }) => {
  const sessionReads: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/rest/v1/sessions')) sessionReads.push(request.url())
  })
  await mockSupabase(page, 'guardian', { origin })
  await page.goto('/')
  await page.getByRole('button', { name: ar.authGoogle }).click()
  await expect(page).toHaveURL(`${origin}/guardian`)
  await page.goto(`${origin}/specialist`)
  await expect(page.getByText(ar.unavailableTitle)).toBeVisible()
  await expect(page.getByText(ar.reviewTitle)).toHaveCount(0)
  expect(sessionReads).toEqual([])
})
