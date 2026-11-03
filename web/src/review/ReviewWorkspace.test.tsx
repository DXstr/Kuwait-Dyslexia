import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import type { AuthSnapshot } from '../auth/controller'
import type { FingerprintResponse, ParentReport, ScoreItemResponse } from '../contracts/basira'
import { I18nProvider } from '../i18n/I18nProvider'
import { ar } from '../i18n/messages'
import { ScorerContext } from '../scorer/context'
import type { ScorerRuntime } from '../scorer/runtime'
import { createTestAuth } from '../test/auth'
import { ReviewContext } from './context'
import { ReviewRepositoryError } from './repository'
import type { ReviewAccess } from './context'
import type { ReviewRepository, ReviewSessionDetail } from './types'
import { ReviewWorkspace } from './ReviewWorkspace'
import scoreFixture from '../../../contracts/fixtures/ScoreItemResponse.dialect-variant.json'
import fingerprintFixture from '../../../contracts/fixtures/FingerprintResponse.example.json'

const score = scoreFixture as ScoreItemResponse
const fingerprintResponse = fingerprintFixture as FingerprintResponse
const reportContent: ParentReport = {
  language: 'ar',
  child_first_name: 'سارة',
  session_date: '',
  duration_min: 0,
  practised: [],
  progress_notes: [],
  home_plan: [{ title_ar: '', minutes: 0, words: [], how_ar: '' }],
  next_focus_ar: '',
  specialist: { name: '', contact: '' },
}

function makeDetail(overrides: Partial<ReviewSessionDetail> = {}): ReviewSessionDetail {
  const item = {
    id: 'item-row-1',
    session_id: 'demo-session-1',
    item_id: score.item_id,
    response: score,
    audio_path: null,
    audio_expires_at: '2099-01-01T00:00:00.000Z',
    synthetic: true,
  }
  return {
    session: { id: 'demo-session-1', child_id: 'child-1', type: 'assessment', status: 'completed', started_at: '2026-01-01T10:00:00.000Z', ended_at: '2026-01-01T10:02:00.000Z', run_by: 'specialist-1' },
    child: { id: 'child-1', display_name: 'سارة', first_name: 'سارة', grade: 2, dialect_lexicon_id: 'kw', is_demo: true, specialist_id: 'specialist-1' },
    items: [item],
    taps: [],
    fingerprints: [{ id: 'fingerprint-1', session_id: 'demo-session-1', response: fingerprintResponse, review_status: 'pending_review', reviewed_by: null, reviewed_at: null, review_note: null }],
    plans: [],
    reports: [],
    ...overrides,
  }
}

function makeRepository(detail = makeDetail()): ReviewRepository {
  return {
    listSessions: vi.fn(async () => [{ ...detail.session, child: detail.child, child_display_name: detail.child.display_name, child_is_demo: detail.child.is_demo }]),
    loadSession: vi.fn(async () => detail),
    createFingerprint: vi.fn(async () => detail.fingerprints[0]),
    transition: vi.fn(async (_kind, _rowId, _expected, target) => ({ ...detail.fingerprints[0], review_status: target })),
    downloadAudio: vi.fn(async () => new Blob(['RIFF'])) ,
    dispose: vi.fn(),
  }
}

function makeRuntime(scorer: NonNullable<ReviewAccess['scorer']>): ScorerRuntime {
  const snapshot = { phase: 'ready' as const, issue: null, mode: scorer.mode }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    getClient: () => scorer,
    retry: vi.fn(async () => {}),
    dispose: vi.fn(),
  }
}

function renderReview({ role = 'specialist', repository = makeRepository(), scorer = null, snapshot }: { role?: AuthSnapshot['role']; repository?: ReviewRepository; scorer?: NonNullable<ReviewAccess['scorer']> | null; snapshot?: AuthSnapshot } = {}) {
  const auth = createTestAuth(snapshot ?? { status: 'signedIn', role, issue: null })
  const access: ReviewAccess = { repository, scorer }
  return {
    auth,
    ...render(
      <AuthProvider controller={auth.controller}>
        <ScorerContext.Provider value={scorer ? makeRuntime(scorer) : null}>
          <MemoryRouter>
            <I18nProvider allowEnglish={role === 'specialist'}>
              <ReviewContext.Provider value={access}>
                <ReviewWorkspace />
              </ReviewContext.Provider>
            </I18nProvider>
          </MemoryRouter>
        </ScorerContext.Provider>
      </AuthProvider>,
    ),
  }
}

describe('ReviewWorkspace', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('does not render review results outside the specialist role', () => {
    renderReview({ role: 'guardian' })
    expect(screen.queryByText(ar.reviewItemsTitle)).not.toBeInTheDocument()
    expect(screen.getByText(ar.reviewSpecialistOnly)).toBeVisible()
  })

  it('labels synthetic results and dialect variants without calling them errors', async () => {
    renderReview({ scorer: { mode: 'mock', fingerprint: vi.fn() } as never })
    expect(await screen.findByText(ar.reviewItemsTitle)).toBeVisible()
    expect(screen.getAllByText(ar.scorerFixture)).not.toHaveLength(0)
    expect(screen.getAllByText(ar.reviewDialectVariant)).not.toHaveLength(0)
    expect(screen.queryByText(ar.reviewPhonemeError)).not.toBeInTheDocument()
  })

  it('waits for the server acknowledgement before reloading a row action', async () => {
    const repository = makeRepository()
    const user = userEvent.setup()
    renderReview({ repository })
    const approve = await screen.findByRole('button', { name: ar.reviewApprove })
    await user.click(approve)
    await waitFor(() => expect(repository.transition).toHaveBeenCalledWith('fingerprints', 'fingerprint-1', 'pending_review', 'approved', undefined, expect.any(AbortSignal)))
    await waitFor(() => expect(repository.loadSession).toHaveBeenCalledTimes(2))
  })

  it('surfaces a lost-update response rather than showing an optimistic status', async () => {
    const repository = makeRepository()
    vi.mocked(repository.transition).mockRejectedValueOnce(new ReviewRepositoryError('lostUpdate'))
    const user = userEvent.setup()
    renderReview({ repository })
    await user.click(await screen.findByRole('button', { name: ar.reviewApprove }))
    expect(await screen.findByRole('alert')).toHaveTextContent(ar.reviewLostUpdate)
    expect(screen.getByText(ar.reviewStatusPending)).toBeVisible()
  })

  it('revokes an in-memory audio URL when the protected view unmounts', async () => {
    const detail = makeDetail({ items: [{ ...makeDetail().items[0], audio_path: 'private-only-path.wav' }] })
    const repository = makeRepository(detail)
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:review-test')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const user = userEvent.setup()
    const view = renderReview({ repository })
    await user.click(await screen.findByRole('button', { name: ar.reviewPlayClip }))
    await waitFor(() => expect(createUrl).toHaveBeenCalledOnce())
    view.unmount()
    expect(revokeUrl).toHaveBeenCalledWith('blob:review-test')
  })

  it('plays the first requested segment after the private audio becomes ready', async () => {
    const detail = makeDetail({ items: [{ ...makeDetail().items[0], audio_path: 'private-only-path.wav' }] })
    const repository = makeRepository(detail)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:segment-test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderReview({ repository })
    const segment = (await screen.findAllByRole('button', { name: new RegExp(ar.reviewPlaySegment) }))[0]
    await user.click(segment)
    const audio = document.querySelector('audio') as HTMLAudioElement
    Object.defineProperty(audio, 'duration', { configurable: true, value: 1 })
    audio.dispatchEvent(new Event('loadedmetadata'))
    await waitFor(() => expect(play).toHaveBeenCalledOnce())
    expect(audio.src).toContain('blob:segment-test')
  })

  it('uses raw words per minute and signed gaps rather than percent formatting', async () => {
    const response = { ...fingerprintResponse, features: { ...fingerprintResponse.features, wcpm: 84, pseudoword_gap: -0.2, vowelization_gap: 0.15 } }
    const detail = makeDetail({ fingerprints: [{ ...makeDetail().fingerprints[0], response }] })
    renderReview({ repository: makeRepository(detail) })
    await screen.findByText(ar.reviewFingerprintsTitle)
    const card = screen.getByRole('article', { name: new RegExp(ar.reviewReferralDecision) })
    expect(card).toHaveTextContent('٨٤')
    expect(card).not.toHaveTextContent('8,400%')
    expect(card).toHaveTextContent('؜-٠٫٢')
    expect(card).not.toHaveTextContent('-20%')
  })

  it('shows stored fingerprint notes while offering no plan or report note fields', async () => {
    const detail = makeDetail({
      fingerprints: [{ ...makeDetail().fingerprints[0], review_note: 'ملاحظة محفوظة' }],
      plans: [{ id: 'plan-1', child_id: 'child-1', skill_ids: [], item_ids: [], review_status: 'pending_review', approved_by: null, approved_at: null }],
      reports: [{ id: 'report-1', child_id: 'child-1', session_id: 'demo-session-1', content: reportContent, pdf_path: null, review_status: 'pending_review', approved_by: null }],
    })
    renderReview({ repository: makeRepository(detail) })
    expect((await screen.findAllByText('ملاحظة محفوظة'))[0]).toBeVisible()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
  })

  it('places a fixture notice beside each demo plan and report', async () => {
    const detail = makeDetail({
      plans: [{ id: 'plan-1', child_id: 'child-1', skill_ids: [], item_ids: [], review_status: 'pending_review', approved_by: null, approved_at: null }],
      reports: [{ id: 'report-1', child_id: 'child-1', session_id: 'demo-session-1', content: reportContent, pdf_path: null, review_status: 'pending_review', approved_by: null }],
    })
    renderReview({ repository: makeRepository(detail), scorer: { mode: 'mock', fingerprint: vi.fn() } as never })
    await screen.findByText(ar.reviewPlansTitle)
    expect(screen.getAllByText(ar.scorerFixture)).toHaveLength(4)
  })

  it('does not update review state after an in-flight mutation is aborted by unmount', async () => {
    let resolveTransition: (() => void) | undefined
    const repository = makeRepository()
    vi.mocked(repository.transition).mockImplementationOnce(() => new Promise((resolve) => { resolveTransition = () => resolve(makeDetail().fingerprints[0]) }))
    const user = userEvent.setup()
    const view = renderReview({ repository })
    await user.click(await screen.findByRole('button', { name: ar.reviewApprove }))
    view.unmount()
    resolveTransition?.()
    await Promise.resolve()
    expect(repository.loadSession).toHaveBeenCalledOnce()
  })
})
