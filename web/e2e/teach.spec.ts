import { expect, test, type Page, type Route } from '@playwright/test'
import itemBankDocument from '../../content/dist/item-bank.json' with { type: 'json' }
import phoneticInventoryDocument from '../../contracts/phonetic-inventory.json' with { type: 'json' }
import { ar } from '../src/i18n/messages'
import { landingCopy } from '../src/ui/pages/landing/copy'
import { api, defaultOrigin, mockSupabase, userId } from './support/auth'

// These are synthetic intercepted HTTP responses only. The browser uses the real
// Supabase SDK and the real Teach repository; no production test mode, live account,
// live database, child data, or hand-written catalogue substitute is installed.
const childId = '33333333-3333-4333-8333-333333333333'
const planId = '77777777-7777-4777-8777-777777777777'
const sessionId = '44444444-4444-4444-8444-444444444444'
const wrongTapId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const correctTapId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const startedAt = '2026-11-04T00:00:00.000Z'
const validConsent = { signed_at: '2026-01-01T00:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z' }
const childRow = {
  id: childId,
  first_name: 'طفل تجريبي',
  grade: 2,
  dialect_lexicon_id: 'kw',
  is_demo: true,
  specialist_id: userId,
}
const shortVowelCandidate = itemBankDocument.items.find((item) => item.type === 'vowel_tap' && item.skill_ids[0] === 'vowel.fatha')
const tracingCandidate = itemBankDocument.items.find((item) => item.type === 'letter_sound' && item.text.startsWith('ب'))
if (!shortVowelCandidate || !tracingCandidate) throw new Error('B9 fixture requires canonical vowel and letter-sound items')
const shortVowelItem = shortVowelCandidate
const tracingItem = tracingCandidate
const reviewedCue = phoneticInventoryDocument.letters.find((letter) => letter.char === shortVowelItem.text[0])
if (!reviewedCue || reviewedCue.review.status !== 'approved') throw new Error('B9 fixture requires an approved canonical phonetic cue')

function cors() {
  return {
    'access-control-allow-origin': defaultOrigin,
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-credentials': 'true',
  }
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, headers: cors(), contentType: 'application/json', body: JSON.stringify(body) })
}

function requestBody(route: Route): Record<string, unknown> {
  const body = route.request().postDataJSON()
  return (Array.isArray(body) ? body[0] : body) as Record<string, unknown>
}

type TeachApiState = {
  planReads: string[]
  assignedChildReads: string[]
  tapBodies: Record<string, unknown>[]
  tapAcknowledgementIds: string[]
  sessionBodies: Record<string, unknown>[]
  completedSessions: string[]
}

type TeachApiOptions = {
  approvedPlan: boolean
}

async function installTeachApi(page: Page, options: TeachApiOptions): Promise<TeachApiState> {
  const state: TeachApiState = { planReads: [], assignedChildReads: [], tapBodies: [], tapAcknowledgementIds: [], sessionBodies: [], completedSessions: [] }
  await page.route(`${api}/rest/v1/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') return json(route, null, 204)
    if (url.pathname === '/rest/v1/profiles') return route.fallback()
    // The specialist's existing review and progress views read sessions on login.
    // The baseline helper gives those reads an empty, explicitly synthetic result.
    if (url.pathname === '/rest/v1/sessions' && request.method() === 'GET') return route.fallback()
    if (url.pathname === '/rest/v1/skill_mastery' && request.method() === 'GET') {
      expect(url.searchParams.get('select')?.replaceAll(' ', '')).toBe('child_id,skill_id,mastery,updated_at,source_session_id')
      expect(url.searchParams.get('child_id')).toBe(`eq.${childId}`)
      expect(url.searchParams.get('order')).toBe('updated_at.asc')
      return json(route, [])
    }


    if (url.pathname === '/rest/v1/children' && request.method() === 'GET') {
      const select = url.searchParams.get('select')?.replaceAll(' ', '')
      if (select === 'id,first_name,is_demo,specialist_id') {
        expect(url.searchParams.get('specialist_id')).toBe(`eq.${userId}`)
        expect(url.searchParams.get('order')).toBe('id.asc')
        expect(url.searchParams.get('limit')).toBe('100')
        return json(route, [childRow])
      }

      expect(select).toBe('id,first_name,grade,dialect_lexicon_id,is_demo')
      expect(url.searchParams.get('order')).toBe('first_name.asc')
      state.assignedChildReads.push(childRow.id)
      return json(route, [childRow])
    }

    if (url.pathname === '/rest/v1/rpc/approved_practice_plan' && request.method() === 'POST') {
      const body = requestBody(route)
      expect(body).toEqual({ p_child_id: childId })
      state.planReads.push(String(body.p_child_id))
      // A real approved_practice_plan RPC returns no row for draft, pending,
      // rejected, or delivered material. The client cannot render a task from [].
      return json(route, options.approvedPlan ? [{
        plan_id: planId,
        skill_ids: [shortVowelItem.skill_ids[0], tracingItem.skill_ids[0]],
        item_ids: [shortVowelItem.id, tracingItem.id],
      }] : [])
    }

    if (url.pathname === '/rest/v1/consents' && request.method() === 'GET') {
      expect(url.searchParams.get('select')?.replaceAll(' ', '')).toBe('signed_at,expires_at')
      expect(url.searchParams.get('child_id')).toBe(`eq.${childId}`)
      // The separate assessment panel checks assessment consent after login.
      // Only Teach's practice consent exists in this synthetic scenario.
      if (url.searchParams.get('scope') === 'eq.assessment') return json(route, null)
      expect(url.searchParams.get('scope')).toBe('eq.practice')
      expect(url.searchParams.get('order')).toBe('expires_at.desc')
      expect(url.searchParams.get('limit')).toBe('1')
      return json(route, validConsent)
    }

    if (url.pathname === '/rest/v1/sessions' && request.method() === 'POST') {
      const body = requestBody(route)
      state.sessionBodies.push(body)
      expect(body).toEqual({ child_id: childId, type: 'practice', status: 'in_progress', run_by: userId })
      return json(route, { id: sessionId, child_id: childId, started_at: startedAt, status: 'in_progress' })
    }

    if (url.pathname === '/rest/v1/tap_results' && request.method() === 'POST') {
      const body = requestBody(route)
      state.tapBodies.push(body)
      expect(body).toMatchObject({ session_id: sessionId, item_id: shortVowelItem.id })
      const correct = state.tapBodies.length === 2
      expect(body.evidence).toEqual({ skill_id: shortVowelItem.skill_ids[0], correct, source: 'tap' })
      const acknowledgementId = correct ? correctTapId : wrongTapId
      state.tapAcknowledgementIds.push(acknowledgementId)
      return json(route, { id: acknowledgementId, session_id: sessionId, item_id: shortVowelItem.id, evidence: body.evidence })
    }

    if (url.pathname === '/rest/v1/sessions' && request.method() === 'PATCH') {
      expect(url.searchParams.get('id')).toBe(`eq.${sessionId}`)
      expect(url.searchParams.get('status')).toBe('eq.in_progress')
      expect(requestBody(route)).toEqual({ status: 'completed' })
      state.completedSessions.push(sessionId)
      return json(route, { id: sessionId, status: 'completed' })
    }

    throw new Error(`Unexpected synthetic Teach REST request: ${request.method()} ${url.pathname}`)
  })
  return state
}

async function signInSpecialist(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: landingCopy.hero.primaryAction }).first().click()
  await expect(page).toHaveURL(`${defaultOrigin}/specialist`)
  await page.goto(`${defaultOrigin}/child`)
  await expect(page.locator('#teach-child')).toBeVisible()
}

function expectArabicChildSurface(page: Page) {
  return expect.poll(async () => {
    const text = await page.locator('body').innerText()
    return {
      text,
      hasEnglish: /[A-Za-z]/.test(text),
      hasForbiddenJudgement: /score|risk|wrong|error|red|درجة|خطر|خطأ|أحمر/i.test(text),
    }
  }).toEqual(expect.objectContaining({ hasEnglish: false, hasForbiddenJudgement: false }))
}

test('does not render a Teach task when the approved-plan read has no approved row', async ({ page }) => {
  await mockSupabase(page, 'specialist')
  const backend = await installTeachApi(page, { approvedPlan: false })
  await signInSpecialist(page)

  await expect(page.getByText(ar.teachPlanUnavailable)).toBeVisible()
  const start = page.getByRole('button', { name: ar.teachStart })
  if (await start.count() > 0) await expect(start).toBeDisabled()
  await expect(page.locator('.teach-session')).toHaveCount(0)
  await expect(page.locator('#teach-child option:checked')).toContainText(ar.assessmentDemoLabel)
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  expect(backend.assignedChildReads.length).toBeGreaterThan(0)
  expect(backend.assignedChildReads.every((assignedId) => assignedId === childId)).toBe(true)
  expect(backend.planReads).toEqual([childId])
  expect(backend.assignedChildReads).toContain(backend.planReads[0])
})

test('reads the approved plan for the assigned demo child, then covers neutral retry, cue/mouth rendering, tracing, and Arabic child copy', async ({ page }, testInfo) => {
  await mockSupabase(page, 'specialist')
  const backend = await installTeachApi(page, { approvedPlan: true })
  await signInSpecialist(page)

  await expect(page.locator('#teach-child option:checked')).toContainText(ar.assessmentDemoLabel)
  await expect(page.getByText(ar.teachApprovedPlanNotice)).toContainText('2')
  await expect(page.getByRole('button', { name: ar.teachStart })).toBeEnabled()
  await expectArabicChildSurface(page)

  await page.getByRole('button', { name: ar.teachStart }).click()
  await expect(page.locator('.teach-session')).toBeVisible()
  await expect(page.getByRole('heading', { name: shortVowelItem.text })).toBeVisible()
  await expect.poll(() => backend.sessionBodies).toHaveLength(1)

  const options = shortVowelItem.options ?? []
  expect(options.length).toBeGreaterThan(shortVowelItem.answer_index ?? 0)
  const wrongOption = options.findIndex((_, index) => index !== shortVowelItem.answer_index)
  await page.getByRole('button', { name: options[wrongOption], exact: true }).click()
  await expect(page.getByText(ar.teachNeutralRetry)).toBeVisible()
  await expect(page.getByText(ar.teachTryAgain)).toBeVisible()
  await expect(page.getByRole('heading', { name: ar.teachCueTitle })).toBeVisible()
  await expect(page.getByRole('img', { name: ar.teachMouthLabel })).toBeVisible()
  await expect(page.getByText(reviewedCue.cue_ar)).toBeVisible()
  await expectArabicChildSurface(page)

  await page.getByRole('button', { name: options[shortVowelItem.answer_index ?? 0], exact: true }).click()
  await expect(page.getByRole('heading', { name: tracingItem.text })).toBeVisible()
  await page.getByRole('button', { name: ar.teachTraceMode }).click()
  const trace = page.getByLabel(ar.teachTraceCanvasLabel)
  await expect(trace).toBeVisible()
  const traceBox = await trace.boundingBox()
  expect(traceBox).not.toBeNull()
  if (!traceBox) throw new Error('Teach trace canvas has no layout box')
  await page.mouse.move(traceBox.x + traceBox.width * 0.25, traceBox.y + traceBox.height * 0.25)
  await page.mouse.down()
  await page.mouse.move(traceBox.x + traceBox.width * 0.75, traceBox.y + traceBox.height * 0.75, { steps: 4 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: ar.teachTraceComplete })).toBeEnabled()
  await page.getByRole('button', { name: ar.teachTraceComplete }).click()
  await expect(page.getByRole('heading', { name: ar.teachFinishedTitle })).toBeVisible()
  await expectArabicChildSurface(page)

  await expect.poll(() => backend.tapBodies).toHaveLength(2)
  await expect.poll(() => backend.completedSessions).toEqual([sessionId])
  expect(backend.assignedChildReads.length).toBeGreaterThan(0)
  expect(backend.assignedChildReads.every((assignedId) => assignedId === childId)).toBe(true)
  expect(backend.planReads).toEqual([childId])
  expect(backend.assignedChildReads).toContain(backend.planReads[0])
  expect(backend.sessionBodies).toEqual([{ child_id: childId, type: 'practice', status: 'in_progress', run_by: userId }])
  expect(backend.tapAcknowledgementIds).toEqual([wrongTapId, correctTapId])
  expect(backend.tapBodies.map((body) => body.evidence)).toEqual([
    { skill_id: shortVowelItem.skill_ids[0], correct: false, source: 'tap' },
    { skill_id: shortVowelItem.skill_ids[0], correct: true, source: 'tap' },
  ])

  await page.screenshot({ path: testInfo.outputPath('b9-synthetic-teach-tablet.png'), fullPage: false })
})
