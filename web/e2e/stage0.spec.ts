import { expect, test, type Page, type Route } from '@playwright/test'
import { ar } from '../src/i18n/messages'
import { api, defaultOrigin, mockSupabase, userId } from './support/auth'

// Every record below is a clearly labelled synthetic fixture intercepted at the
// loopback API. These tests do not use real OAuth, real child data, browser
// microphone/native UI, or a production Supabase project.
const childId = '33333333-3333-4333-8333-333333333333'
const specialistId = '44444444-4444-4444-8444-444444444444'
const examinerId = '11111111-1111-4111-8111-111111111111'
const consentId = '55555555-5555-4555-8555-555555555555'
const sessionId = '66666666-6666-4666-8666-666666666666'
const childRow = {
  id: childId,
  first_name: 'ملف طفل اصطناعي (ملف تجريبي)',
  grade: 3,
  birth_month: '2018-01',
  specialist_id: specialistId,
  guardian_id: userId,
  is_demo: true,
}
const consentRow = {
  id: consentId,
  child_id: childId,
  guardian_id: childRow.guardian_id,
  specialist_id: specialistId,
  scope: 'assessment',
  signed_at: '2026-11-04T18:00:00.000Z',
  expires_at: '2099-01-01T00:00:00.000Z',
  evidence_path: 'synthetic/consent-reference-only',
  ethics_ref: null,
}
const sessionRow = {
  id: sessionId,
  child_id: childId,
  type: 'stage0',
  status: 'in_progress',
  started_at: '2026-11-04T18:01:00.000Z',
  ended_at: null,
  run_by: examinerId,
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
function requestBody(route: Route): Record<string, unknown> {
  const body = route.request().postDataJSON()
  return (Array.isArray(body) ? body[0] : body) as Record<string, unknown>
}
async function installConsentApi(page: Page) {
  let saved = false
  const observed = { createBodies: [] as Record<string, unknown>[], revokeBodies: [] as Record<string, unknown>[] }
  await page.route(`${api}/rest/v1/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') return json(route, null, 204)
    if (url.pathname === '/rest/v1/profiles') return route.fallback()
    if (url.pathname === '/rest/v1/children' && request.method() === 'GET') return json(route, [childRow])
    // The guardian workspace also loads the existing approved-report list;
    // this B12 fixture has no report rows, but must not reject that unrelated
    // read and break the synthetic OAuth callback.
    if (url.pathname === '/rest/v1/parent_reports' && request.method() === 'GET') return json(route, [])
    if (url.pathname === '/rest/v1/consents' && request.method() === 'GET') return json(route, saved ? [consentRow] : [])
    if (url.pathname === '/rest/v1/consents' && request.method() === 'POST') {
      const body = requestBody(route)
      observed.createBodies.push(body)
      expect(body).toMatchObject({ child_id: childId, guardian_id: childRow.guardian_id, specialist_id: specialistId, scope: 'assessment', evidence_path: 'synthetic/evidence-reference' })
      expect(body).not.toHaveProperty('signed_at')
      saved = true
      return json(route, consentRow)
    }
    if (url.pathname === '/rest/v1/consents' && request.method() === 'PATCH') {
      const body = requestBody(route)
      observed.revokeBodies.push(body)
      expect(body).toEqual({ expires_at: '1970-01-01T00:00:00.000Z' })
      saved = false
      return json(route, { ...consentRow, expires_at: '1970-01-01T00:00:00.000Z' })
    }
    throw new Error(`Unexpected synthetic consent REST request: ${request.method()} ${url.pathname}`)
  })
  return observed
}

test('guardian records consent with an evidence reference and can revoke it', async ({ page }) => {
  await mockSupabase(page, 'guardian')
  const observed = await installConsentApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: ar.authGoogle }).click()
  await expect(page).toHaveURL(`${defaultOrigin}/guardian`)
  await page.goto(`${defaultOrigin}/guardian/consent`)
  await expect(page).toHaveURL(`${defaultOrigin}/guardian/consent`)
  await expect(page.getByRole('heading', { name: ar.consentTitle })).toBeVisible()
  await expect(page.getByText(ar.consentSyntheticWarning)).toBeVisible()

  await page.getByPlaceholder(ar.consentEvidencePlaceholder).fill('synthetic/evidence-reference')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: ar.consentCapture }).click()
  await expect(page.getByRole('status')).toContainText(ar.consentSaved)
  expect(observed.createBodies).toHaveLength(1)
  await expect(page.getByText(ar.consentEvidence, { exact: true })).toBeVisible()

  await page.getByRole('button', { name: ar.consentRevoke }).click()
  await expect(page.getByRole('status')).toContainText(ar.consentRevoked)
  expect(observed.revokeBodies).toEqual([{ expires_at: '1970-01-01T00:00:00.000Z' }])
})

test('examiner Stage 0 remains blocked by the database consent gate', async ({ page }) => {
  await mockSupabase(page, 'examiner')
  let sessionAttempts = 0
  await page.route(`${api}/rest/v1/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') return json(route, null, 204)
    if (url.pathname === '/rest/v1/profiles') return route.fallback()
    if (url.pathname === '/rest/v1/children' && request.method() === 'GET') return json(route, [childRow])
    if (url.pathname === '/rest/v1/sessions' && request.method() === 'POST') {
      sessionAttempts += 1
      return json(route, { code: '23514', message: 'valid guardian consent required' }, 400)
    }
    throw new Error(`Unexpected synthetic Stage 0 REST request: ${request.method()} ${url.pathname}`)
  })
  await page.goto('/')
  await page.getByRole('button', { name: ar.authGoogle }).click()
  await expect(page).toHaveURL(`${defaultOrigin}/examiner`)
  await expect(page.getByRole('heading', { name: ar.stage0Title })).toBeVisible()

  await page.getByRole('button', { name: ar.stage0Start }).click()
  await expect(page.getByRole('alert')).toContainText(ar.stage0ConsentMissing)
  expect(sessionAttempts).toBe(1)
  await expect(page.getByText(ar.stage0SessionStarted)).toHaveCount(0)
})

test('examiner Stage 0 shows only synthetic task material after a permitted session starts', async ({ page }) => {
  await mockSupabase(page, 'examiner')
  await page.route(`${api}/rest/v1/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') return json(route, null, 204)
    if (url.pathname === '/rest/v1/profiles') return route.fallback()
    if (url.pathname === '/rest/v1/children' && request.method() === 'GET') return json(route, [childRow])
    if (url.pathname === '/rest/v1/sessions' && request.method() === 'POST') {
      expect(requestBody(route)).toMatchObject({ child_id: childId, type: 'stage0', status: 'in_progress', run_by: examinerId })
      return json(route, sessionRow)
    }
    throw new Error(`Unexpected synthetic Stage 0 REST request: ${request.method()} ${url.pathname}`)
  })
  await page.goto('/')
  await page.getByRole('button', { name: ar.authGoogle }).click()
  await expect(page).toHaveURL(`${defaultOrigin}/examiner`)
  await page.getByRole('button', { name: ar.stage0Start }).click()
  await expect(page.getByText(ar.stage0SessionStarted)).toBeVisible()
  await expect(page.getByText(ar.stage0ResultSynthetic)).toHaveCount(0)
  await expect(page.getByText(ar.stage0TaskUnavailable, { exact: true })).toHaveCount(4)
  await expect(page.getByText(ar.stage0TaskAvailable, { exact: true })).toHaveCount(3)
  await expect(page.getByText(ar.consentSyntheticWarning)).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
})
