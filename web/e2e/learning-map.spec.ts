import { expect, test } from '@playwright/test'
import scoreFixture from '../../contracts/fixtures/ScoreItemResponse.dialect-variant.json' with { type: 'json' }
import { ar } from '../src/i18n/messages'
import { api, defaultOrigin, mockSupabase, userId } from './support/auth'

// Explicitly synthetic intercepted HTTP, not real OAuth, a model result or a
// clinical demonstration. No production auth/role bypass is installed.
const childId = '33333333-3333-4333-8333-333333333333'
const otherChildId = '77777777-7777-4777-8777-777777777777'
const sessionId = '44444444-4444-4444-8444-444444444444'
const resultId = '55555555-5555-4555-8555-555555555555'
const at = '2026-11-02T12:00:00.000Z'

async function progressTransport(page: Parameters<typeof mockSupabase>[0], options: { holdOther?: boolean } = {}) {
  await mockSupabase(page, 'specialist')
  let releaseOther: (() => void) | undefined
  let otherRequested = false
  const held = new Promise<void>((resolve) => { releaseOther = resolve })
  const observed = { dataReads: 0, dataWrites: 0, otherRead: () => otherRequested, releaseOther: () => releaseOther?.() }
  await page.route(`${api}/rest/v1/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/rest/v1/profiles') return route.fallback()
    const headers = { 'access-control-allow-origin': defaultOrigin, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,OPTIONS' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    expect(request.method()).toBe('GET')
    if (request.method() !== 'GET') observed.dataWrites += 1
    observed.dataReads += 1
    const json = (body: unknown) => route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname === '/rest/v1/children') {
      // B8 explicitly filters the assignment; B6's existing read relies on RLS.
      if (url.searchParams.get('select')?.includes('specialist_id')) {
        expect(url.searchParams.get('specialist_id')).toBe(`eq.${userId}`)
      }
      return json([
        { id: childId, first_name: 'ملف تقدم اصطناعي أول', is_demo: true, specialist_id: userId, grade: 2, dialect_lexicon_id: 'kw' },
        { id: otherChildId, first_name: 'ملف تقدم اصطناعي ثان', is_demo: true, specialist_id: userId, grade: 2, dialect_lexicon_id: 'kw' },
      ])
    }
    if (url.pathname === '/rest/v1/sessions') {
      const selected = url.searchParams.get('child_id')
      expect(url.searchParams.get('status')).toBe('eq.completed')
      // B7 independently lists reviewable sessions without a selected child.
      if (selected === null) return json([])
      if (selected === `eq.${otherChildId}`) {
        otherRequested = true
        if (options.holdOther) await held
        return json([])
      }
      expect(selected).toBe(`eq.${childId}`)
      return json([{ id: sessionId, child_id: childId, type: 'practice', status: 'completed', started_at: at, ended_at: at }])
    }
    if (url.pathname === '/rest/v1/item_results') {
      expect(url.searchParams.get('session_id')).toContain(sessionId)
      return json([{
        id: resultId, session_id: sessionId, item_id: scoreFixture.item_id, synthetic: true,
        response: { ...scoreFixture, skill_evidence: [
          { skill_id: 'decode.real', correct: true, source: 'audio' },
          { skill_id: 'decode.real', correct: false, source: 'audio' },
          { skill_id: 'decode.real', correct: true, source: 'audio' },
        ] },
      }])
    }
    if (url.pathname === '/rest/v1/tap_results') return json([])
    if (url.pathname === '/rest/v1/skill_mastery') return json([])
    if (url.pathname === '/rest/v1/consents') return json([])
    throw new Error(`Unexpected synthetic progress table: ${url.pathname}`)
  })
  return observed
}

async function signIn(page: Parameters<typeof mockSupabase>[0]) {
  await page.goto('/')
  await page.getByRole('button', { name: ar.authGoogle }).click()
  await expect(page).toHaveURL(/\/specialist$/)
}

test('counts all repeated canonical word observations and labels the Arabic specialist progress as provisional/synthetic', async ({ page }, testInfo) => {
  const observed = await progressTransport(page)
  await signIn(page)
  const workspace = page.locator('.learning-map-workspace')
  await expect(workspace.getByRole('heading', { name: ar.learningMapSummaryTitle })).toBeVisible()
  await workspace.getByRole('combobox', { name: ar.learningMapSkillLabel }).selectOption('decode.real')
  const summary = workspace.locator('.learning-map-metrics')
  const expectedFraction = new Intl.NumberFormat('ar', { style: 'percent', maximumFractionDigits: 0 }).format(2 / 3)
  await expect(summary).toContainText(expectedFraction)
  await expect(summary).toContainText(ar.learningMapBandGrowing)
  await expect(summary.locator('dd').last()).toHaveText('3')
  await expect(workspace.getByText(ar.learningMapSyntheticBanner)).toBeVisible()
  await expect(workspace.getByText(ar.learningMapProvisionalDescription)).toBeVisible()
  await expect(workspace.getByRole('combobox', { name: ar.learningMapSkillLabel }).locator('option')).toHaveCount(53)
  await expect(workspace.getByText(ar.learningMapBandMastered, { exact: true })).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await workspace.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: testInfo.outputPath('b8-synthetic-progress-tablet.png'), fullPage: false })
  await page.getByRole('button', { name: ar.authSignOut }).click()
  await expect(page).toHaveURL('/')
  await expect(page.locator('.learning-map-workspace')).toHaveCount(0)
  expect(observed.dataReads).toBeGreaterThan(0)
  expect(observed.dataWrites).toBe(0)
})

test('removes the previous child map immediately while the next child read is pending', async ({ page }) => {
  const observed = await progressTransport(page, { holdOther: true })
  await signIn(page)
  const workspace = page.locator('.learning-map-workspace')
  await expect(workspace.locator('.learning-map-metrics')).toBeVisible()
  await workspace.getByRole('combobox', { name: ar.learningMapChildLabel }).selectOption(otherChildId)
  await expect.poll(observed.otherRead).toBe(true)
  await expect(workspace.locator('.learning-map-metrics')).toHaveCount(0)
  observed.releaseOther()
  await expect(workspace.getByText(ar.learningMapNoEvents)).toBeVisible()
  await expect(workspace.locator('.learning-map-metrics')).not.toContainText(new Intl.NumberFormat('ar', { style: 'percent' }).format(2 / 3))
})

test('guardian navigation cannot show learning-map metrics or read private progress tables', async ({ page }) => {
  await mockSupabase(page, 'guardian')
  const privateReads: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (/\/rest\/v1\/(children|sessions|item_results|tap_results|skill_mastery)$/.test(path)) privateReads.push(path)
  })
  await page.goto('/')
  await page.getByRole('button', { name: ar.authGoogle }).click()
  await expect(page).toHaveURL(/\/guardian$/)
  await page.goto('/specialist')
  await expect(page.getByRole('heading', { name: ar.unavailableTitle })).toBeVisible()
  await expect(page.locator('.learning-map-workspace')).toHaveCount(0)
  expect(privateReads).toEqual([])
})
