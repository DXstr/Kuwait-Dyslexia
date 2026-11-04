import { expect, test, type Page, type Route } from '@playwright/test'
import parentReportFixture from '../../contracts/fixtures/ParentReport.sample.json' with { type: 'json' }
import type { ParentReport } from '../src/contracts/basira'
import { ar } from '../src/i18n/messages'
import { api, defaultOrigin, mockSupabase, userId } from './support/auth'

// This is the canonical contract fixture served through intercepted loopback HTTP only.
// It is labelled synthetic and does not represent a real clinic child or patient.
const canonicalParentReport = parentReportFixture as ParentReport
const reportId = 'b1111111-1111-4111-8111-111111111111'
const childId = 'b2222222-2222-4222-8222-222222222222'
const sessionId = 'b3333333-3333-4333-8333-333333333333'
const foreignGuardianId = '99999999-9999-4999-8999-999999999999'

const approvedRow = (guardianId = userId, content: unknown = canonicalParentReport, status = 'approved') => ({
  id: reportId,
  child_id: childId,
  session_id: sessionId,
  content,
  pdf_path: null,
  review_status: status,
  approved_by: 'b4444444-4444-4444-8444-444444444444',
  children: {
    first_name: canonicalParentReport.child_first_name,
    is_demo: true,
    guardian_id: guardianId,
  },
})

type ParentReportApiState = {
  listRequests: number
  detailRequests: number
}

type ParentReportApiOptions = {
  listBody: unknown[]
  detailBody: unknown | null
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    headers: {
      'access-control-allow-origin': defaultOrigin,
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-credentials': 'true',
    },
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function installParentReportsApi(page: Page, options: ParentReportApiOptions): Promise<ParentReportApiState> {
  const state: ParentReportApiState = { listRequests: 0, detailRequests: 0 }

  await page.route(`${api}/rest/v1/parent_reports**`, async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fallback()
    if (request.method() !== 'GET') throw new Error(`Unexpected parent_reports method: ${request.method()}`)

    const url = new URL(request.url())
    const select = url.searchParams.get('select')?.replaceAll(' ', '')
    expect(select).toBe('id,child_id,session_id,content,pdf_path,review_status,approved_by,children(first_name,is_demo,guardian_id)')
    expect(url.searchParams.get('review_status')).toBe('in.(approved,delivered)')

    if (url.searchParams.has('id')) {
      state.detailRequests += 1
      expect(url.searchParams.get('id')).toBe(`eq.${reportId}`)
      expect(url.searchParams.get('order')).toBeNull()
      expect(url.searchParams.get('limit')).toBeNull()
      return json(route, options.detailBody)
    }

    state.listRequests += 1
    expect(url.searchParams.get('order')).toBe('id.desc')
    expect(url.searchParams.get('limit')).toBe('128')
    return json(route, options.listBody)
  })

  return state
}

async function signInGuardian(page: Page, options: ParentReportApiOptions) {
  const auth = await mockSupabase(page, 'guardian')
  const reports = await installParentReportsApi(page, options)
  await page.goto('/')
  await page.getByRole('button', { name: ar.authGoogle }).click()
  await expect(page).toHaveURL(`${defaultOrigin}/guardian`)
  await expect(page.getByRole('heading', { name: ar.guardianTitle, exact: true })).toBeVisible()
  return { auth, reports }
}

async function expectNoRenderableReport(page: Page, message: string) {
  await expect(page.locator('.parent-report-document')).toHaveCount(0)
  await expect(page.getByRole('button', { name: ar.parentReportSavePdf })).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveText(message)
}

for (const invalidCase of [
  {
    name: 'a draft report',
    row: approvedRow(userId, canonicalParentReport, 'draft'),
    message: ar.parentReportUnavailable,
  },
  {
    name: 'an approved report joined to a different guardian',
    row: approvedRow(foreignGuardianId),
    message: ar.parentReportUnavailable,
  },
  {
    name: 'a malformed approved response',
    row: approvedRow(userId, { ...canonicalParentReport, duration_min: 'not-a-number' }),
    message: ar.parentReportLoadError,
  },
] as const) {
  test(`${invalidCase.name} cannot render the article or print/save control`, async ({ page }) => {
    const { reports } = await signInGuardian(page, { listBody: [invalidCase.row], detailBody: invalidCase.row })
    await expectNoRenderableReport(page, invalidCase.message)
    expect(reports.listRequests).toBe(1)

    await page.goto(`${defaultOrigin}/guardian/reports/${reportId}/print`)
    await expectNoRenderableReport(page, invalidCase.message)
    expect(reports.detailRequests).toBe(1)
  })
}

test('guardian sees an approved synthetic report, opens the real print route, and produces Chromium PDF evidence', async ({ page }, testInfo) => {
  const { auth, reports } = await signInGuardian(page, { listBody: [approvedRow()], detailBody: approvedRow() })

  await expect(page.getByRole('heading', { name: ar.parentReportAvailable })).toBeVisible()
  await expect(page.getByText(canonicalParentReport.child_first_name, { exact: true })).toBeVisible()
  await expect(page.getByText(ar.parentReportDemo)).toBeVisible()
  await expect(page.getByRole('link', { name: ar.parentReportPrint })).toHaveAttribute('href', `/guardian/reports/${reportId}/print`)
  expect(reports.listRequests).toBe(1)

  await page.getByRole('link', { name: ar.parentReportPrint }).click()
  await expect(page).toHaveURL(`${defaultOrigin}/guardian/reports/${reportId}/print`)
  await expect(page.locator('.parent-report-document')).toBeVisible()
  await expect(page.getByRole('button', { name: ar.parentReportSavePdf })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('.parent-report-document')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('.parent-report-document')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByText(canonicalParentReport.child_first_name, { exact: true })).toBeVisible()
  await expect(page.getByText(canonicalParentReport.specialist.contact, { exact: true })).toBeVisible()
  await expect(page.getByText(/score|risk|diagnosis|error|درجة|مخاطر|تشخيص|خطأ/i)).toHaveCount(0)
  expect(reports.detailRequests).toBe(1)

  const notoNaskhLoaded = await page.evaluate(async () => {
    await document.fonts.ready
    return document.fonts.check('700 1rem "Noto Naskh Arabic"')
  })
  expect(notoNaskhLoaded).toBe(true)

  const screenshotPath = testInfo.outputPath('b11-synthetic-report-tablet.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('b11-synthetic-report-tablet.png', { path: screenshotPath, contentType: 'image/png' })

  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('button', { name: ar.parentReportSavePdf })).toBeHidden()
  const pdfPath = testInfo.outputPath('b11-synthetic-parent-report.pdf')
  await page.pdf({ path: pdfPath, format: 'A4', printBackground: true })
  await testInfo.attach('b11-synthetic-parent-report.pdf', { path: pdfPath, contentType: 'application/pdf' })

  await page.emulateMedia({ media: 'screen' })
  await page.getByRole('button', { name: ar.authSignOut }).click()
  await expect(page).toHaveURL(`${defaultOrigin}/`)
  await expect(page.locator('.parent-report-document')).toHaveCount(0)
  await expect(page.getByRole('button', { name: ar.authGoogle })).toBeEnabled()
  expect(auth.observed.logout).toBe(true)
})
