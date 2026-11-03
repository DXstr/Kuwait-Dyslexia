import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { useAuth } from '../auth/context'
import type { ReviewStatus, ScoreItemResponse } from '../contracts/basira'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/messages'
import { ScorerFixtureNotice } from '../scorer/ScorerNotice'
import { useReviewAccess } from './context'
import { ReviewRepositoryError } from './repository'
import skillGraph from '../../../contracts/skill-graph.json'
import taxonomy from '../../../contracts/taxonomy.json'

type ReviewKind = 'fingerprints' | 'plans' | 'parent_reports'
type ReviewAccess = NonNullable<ReturnType<typeof useReviewAccess>>
type ReviewRepository = ReviewAccess['repository']
type ReviewSummary = Awaited<ReturnType<ReviewRepository['listSessions']>>[number]
type ReviewDetail = Awaited<ReturnType<ReviewRepository['loadSession']>>
type ReviewItem = ReviewDetail['items'][number]
type Fingerprint = ReviewDetail['fingerprints'][number]
type Plan = ReviewDetail['plans'][number]
type Report = ReviewDetail['reports'][number]
type Phoneme = ScoreItemResponse['phonemes'][number]
type TransitionHandler = (kind: ReviewKind, row: { id: string; review_status: ReviewStatus }, target: ReviewStatus, note: string) => void

type ReviewMessage = { key: MessageKey; detail?: string }

const skillLabels = new Map(skillGraph.skills.map((skill) => [skill.id, skill]))
const taxonomyLetters = new Map(taxonomy.letters.map((letter) => [letter.id, letter]))

const statusMessage: Record<ReviewStatus, MessageKey> = {
  draft: 'reviewStatusDraft',
  pending_review: 'reviewStatusPending',
  approved: 'reviewStatusApproved',
  rejected: 'reviewStatusRejected',
  delivered: 'reviewStatusDelivered',
}
const itemTypeMessage: Record<ScoreItemResponse['item_type'], MessageKey> = {
  letter_sound: 'reviewItemTypeLetterSound',
  real_word: 'reviewItemTypeRealWord',
  pseudoword: 'reviewItemTypePseudoword',
  passage_vowelized: 'reviewItemTypePassageVowelized',
  passage_unvowelized: 'reviewItemTypePassageUnvowelized',
  probe_passage: 'reviewItemTypeProbePassage',
  minimal_pair: 'reviewItemTypeMinimalPair',
  vowel_tap: 'reviewItemTypeVowelTap',
}
const referralDecisionMessage: Record<Fingerprint['response']['referral']['decision'], MessageKey> = {
  no_referral_indicated: 'reviewDecisionNoReferral',
  refer_for_specialist_assessment: 'reviewDecisionRefer',
  specialist_decision_needed: 'reviewDecisionSpecialistNeeded',
}
const featureMessage: Record<string, MessageKey> = {
  dot_confusion_rate: 'reviewFeatureDotConfusion',
  emphatic_confusion_rate: 'reviewFeatureEmphaticConfusion',
  short_vowel_error_rate: 'reviewFeatureShortVowel',
  positional_error_rate: 'reviewFeaturePositional',
  omission_rate: 'reviewFeatureOmission',
  insertion_rate: 'reviewFeatureInsertion',
  substitution_rate: 'reviewFeatureSubstitution',
  wcpm: 'reviewFeatureWcpm',
  self_correction_rate: 'reviewFeatureSelfCorrection',
  pseudoword_gap: 'reviewFeaturePseudowordGap',
  vowelization_gap: 'reviewFeatureVowelizationGap',
}
const warningMessage: Record<string, MessageKey> = {
  low_audio_level: 'reviewWarningLowAudioLevel',
  clipped_audio: 'reviewWarningClippedAudio',
  too_short: 'reviewWarningTooShort',
  too_long: 'reviewWarningTooLong',
  no_speech_detected: 'reviewWarningNoSpeechDetected',
}

function isAbort(error: unknown) {
  return (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof ReviewRepositoryError && error.issue === 'cancelled')
}

function errorMessage(error: unknown, fallback: MessageKey): ReviewMessage {
  if (isAbort(error)) return { key: fallback }
  if (error instanceof ReviewRepositoryError && error.issue === 'lostUpdate') {
    return { key: 'reviewLostUpdate' }
  }
  return { key: fallback }
}

function reviewStatus(row: { review_status: ReviewStatus }) {
  return row.review_status
}

function itemResponse(item: ReviewItem): ScoreItemResponse {
  return item.response
}

function itemIsSynthetic(item: ReviewItem, response: ScoreItemResponse) {
  return item.synthetic === true || response.synthetic === true
}

function childLabel(detail: ReviewDetail, t: (key: MessageKey) => string) {
  const child = detail.child
  const name = child.display_name ?? child.first_name ?? child.id
  return child.is_demo ? `${name} — ${t('reviewDemoChild')}` : name
}

function skillLabel(id: string, locale: string) {
  const skill = skillLabels.get(id)
  if (!skill) return id
  return locale === 'en' ? skill.label_en : skill.label_ar
}

function letterLabel(id: string | null, locale: string) {
  if (!id) return '—'
  const letter = taxonomyLetters.get(id)
  if (!letter) return id
  return `${letter.char} · ${locale === 'en' ? letter.name_en : letter.name_ar}`
}

function numberLocale(locale: string) {
  return locale === 'en' ? 'en-GB' : 'ar-KW'
}

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? value : new Intl.DateTimeFormat(numberLocale(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

function formatNumber(value: number | null | undefined, locale: string, options: Intl.NumberFormatOptions = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat(numberLocale(locale), options).format(value)
}

function formatScore(value: number | null | undefined, locale: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat(numberLocale(locale), { style: 'percent', maximumFractionDigits: 0 }).format(value)
}

function formatFeatureValue(key: string, value: number | null, locale: string, t: (key: MessageKey) => string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return t('reviewValueUnavailable')
  if (key === 'wcpm') return formatNumber(value, locale, { maximumFractionDigits: 1 })
  if (key === 'pseudoword_gap' || key === 'vowelization_gap') {
    return formatNumber(value, locale, { signDisplay: 'always', maximumFractionDigits: 2 })
  }
  return formatScore(value, locale)
}

function StatusPill({ status, t }: { status: ReviewStatus; t: (key: MessageKey) => string }) {
  return <span className={`review-status review-status-${status}`}>{t(statusMessage[status])}</span>
}

function ReviewActions({
  kind,
  row,
  note,
  onNote,
  onTransition,
  busy,
  t,
}: {
  kind: ReviewKind
  row: { id: string; review_status: ReviewStatus }
  note: string
  onNote: (value: string) => void
  onTransition: (kind: ReviewKind, row: { id: string; review_status: ReviewStatus }, target: ReviewStatus, note: string) => void
  busy: boolean
  t: (key: MessageKey) => string
}) {
  const status = reviewStatus(row)
  const terminal = status === 'approved' || status === 'rejected' || status === 'delivered'
  if (terminal) return <p className="review-readonly">{t('reviewReadonly')}</p>
  return (
    <div className="review-actions">
      {status === 'draft' && (
        <button className="action-button" type="button" disabled={busy} onClick={() => onTransition(kind, row, 'pending_review', note)}>
          {t('reviewSubmit')}
        </button>
      )}
      {status === 'pending_review' && (
        <>
          <button className="action-button" type="button" disabled={busy} onClick={() => onTransition(kind, row, 'approved', note)}>
            {t('reviewApprove')}
          </button>
          <button className="action-button" type="button" disabled={busy} onClick={() => onTransition(kind, row, 'rejected', note)}>
            {t('reviewReject')}
          </button>
        </>
      )}
      {kind === 'fingerprints' && <label className="review-note-field"><span>{t('reviewNote')}</span><textarea value={note} onChange={(event) => onNote(event.target.value)} /></label>}
    </div>
  )
}

function AudioReview({
  detail,
  item,
  locale,
  t,
  onError,
}: {
  detail: ReviewDetail
  item: ReviewItem
  locale: string
  t: (key: MessageKey) => string
  onError: (message: ReviewMessage) => void
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const playAbortRef = useRef<AbortController | null>(null)
  const stopTimerRef = useRef<number | null>(null)
  const loadedItemRef = useRef<string | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const mountedRef = useRef(false)
  const repository = useReviewAccess()?.repository

  const revoke = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    playAbortRef.current?.abort()
    playAbortRef.current = null
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current)
    stopTimerRef.current = null
    audioRef.current?.pause()
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    audioUrlRef.current = null
    if (mountedRef.current) setAudioUrl(null)
    loadedItemRef.current = null
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      revoke()
    }
  }, [revoke])
  useEffect(() => revoke, [revoke, detail.session.id, item.id])

  const load = async () => {
    if (!repository || !item.audio_path) {
      onError({ key: 'reviewAudioUnavailable' })
      return null
    }
    if (audioUrl && loadedItemRef.current === item.id) return audioUrl
    setLoading(true)
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    try {
      const blob = await repository.downloadAudio(detail, item, controller.signal)
      if (controller.signal.aborted) return null
      const nextUrl = URL.createObjectURL(blob)
      if (controller.signal.aborted || !mountedRef.current) {
        URL.revokeObjectURL(nextUrl)
        return null
      }
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = nextUrl
      loadedItemRef.current = item.id
      setAudioUrl(nextUrl)
      return nextUrl
    } catch (error) {
      if (!isAbort(error) && mountedRef.current) onError({ key: 'reviewAudioError' })
      return null
    } finally {
      if (!controller.signal.aborted && mountedRef.current) setLoading(false)
    }
  }

  const waitForAudioReady = (audio: HTMLAudioElement, signal: AbortSignal) => new Promise<boolean>((resolve) => {
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve(true)
      return
    }
    let settled = false
    const finish = (ready: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      audio.removeEventListener('loadedmetadata', onReady)
      audio.removeEventListener('canplay', onReady)
      signal.removeEventListener('abort', onAbort)
      resolve(ready && !signal.aborted)
    }
    const onReady = () => finish(true)
    const onAbort = () => finish(false)
    const timeout = window.setTimeout(() => finish(false), 1500)
    audio.addEventListener('loadedmetadata', onReady, { once: true })
    audio.addEventListener('canplay', onReady, { once: true })
    signal.addEventListener('abort', onAbort, { once: true })
  })

  const playSegment = async (event: MouseEvent<HTMLButtonElement>, phoneme: Phoneme) => {
    event.preventDefault()
    playAbortRef.current?.abort()
    const playController = new AbortController()
    playAbortRef.current = playController
    const url = await load()
    if (!url || playController.signal.aborted || !mountedRef.current || !audioRef.current) return
    const audio = audioRef.current
    audio.src = url
    const ready = await waitForAudioReady(audio, playController.signal)
    if (!ready || playController.signal.aborted || !mountedRef.current) return
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null
    if (duration !== null && phoneme.start_ms / 1000 >= duration) {
      onError({ key: 'reviewAudioSegmentUnavailable' })
      return
    }
    const start = duration === null ? Math.max(0, phoneme.start_ms / 1000) : Math.min(duration, Math.max(0, phoneme.start_ms / 1000))
    const end = duration === null ? Math.max(start, phoneme.end_ms / 1000) : Math.min(duration, Math.max(start, phoneme.end_ms / 1000))
    audio.currentTime = start
    try { await audio.play() } catch {
      if (!playController.signal.aborted && mountedRef.current) onError({ key: 'reviewAudioError' })
      return
    }
    if (playController.signal.aborted || !mountedRef.current) return
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current)
    stopTimerRef.current = window.setTimeout(() => { audio.pause(); stopTimerRef.current = null }, Math.max(0, (end - start) * 1000))
  }

  return (
    <div className="review-audio">
      {!item.audio_path ? (
        <p className="review-muted">{t('reviewAudioUnavailable')}</p>
      ) : (
        <>
          <button className="action-button" type="button" disabled={loading} onClick={() => { void load() }}>
            {t(loading ? 'reviewAudioLoading' : 'reviewPlayClip')}
          </button>
          <audio ref={audioRef} controls={Boolean(audioUrl)} preload="metadata" src={audioUrl ?? undefined} aria-label={t('reviewAudioControls')} />
          {audioUrl && <p className="review-muted">{t('reviewAudioPrivate')}</p>}
        </>
      )}
      <div className="review-phoneme-actions">
        {itemResponse(item).phonemes.map((phoneme) => (
          <button key={`${item.id}-${phoneme.index}`} className="action-button" type="button" disabled={loading || !item.audio_path} onClick={(event) => { void playSegment(event, phoneme) }}>
            {t('reviewPlaySegment')} · {phoneme.index + 1} ({phoneme.start_ms}–{phoneme.end_ms} {t('reviewMilliseconds')})
          </button>
        ))}
      </div>
      <span className="sr-only">{locale === 'en' ? t('reviewAudioPrivate') : t('reviewAudioPrivate')}</span>
    </div>
  )
}

function ItemResult({ item, detail, locale, t, onError }: { item: ReviewItem; detail: ReviewDetail; locale: string; t: (key: MessageKey) => string; onError: (message: ReviewMessage) => void }) {
  const response = itemResponse(item)
  return (
    <article className="review-card review-item-card" aria-labelledby={`review-item-${item.id}`}>
      <div className="review-card-heading">
        <div>
          <p className="review-kicker">{t('reviewItemResult')}</p>
          <h3 id={`review-item-${item.id}`}>{response.words.map((word) => word.text).join(' ') || '—'}</h3>
        </div>
        <span className="review-item-type">{t(itemTypeMessage[response.item_type])}</span>
      </div>
      <ScorerFixtureNotice synthetic={itemIsSynthetic(item, response)} />
      <dl className="review-metadata">
        <div><dt>{t('reviewModelVersion')}</dt><dd>{response.model_version}</dd></div>
        <div><dt>{t('reviewAudioDuration')}</dt><dd>{formatNumber(response.audio_duration_ms, locale)} {t('reviewMilliseconds')}</dd></div>
        <div><dt>{t('reviewWarnings')}</dt><dd>{response.warnings.length ? response.warnings.map((warning) => t(warningMessage[warning] ?? 'reviewWarningUnknown')).join('، ') : '—'}</dd></div>
      </dl>
      <div className="review-table-wrap">
        <table className="review-table">
          <caption>{t('reviewPhonemeTable')}</caption>
          <thead><tr><th>{t('reviewExpectedLetter')}</th><th>{t('reviewExpectedIpa')}</th><th>{t('reviewHeardIpa')}</th><th>{t('reviewConfidence')}</th><th>{t('reviewPhonemeStatus')}</th><th>{t('reviewAudio')}</th></tr></thead>
          <tbody>
            {response.phonemes.map((phoneme) => (
              <tr key={`${item.id}-${phoneme.index}`}>
                <td>{letterLabel(phoneme.expected_letter, locale)}</td>
                <td dir="ltr">{phoneme.expected_ipa}</td>
                <td dir="ltr">{phoneme.heard_ipa ?? '—'}</td>
                <td>{formatScore(phoneme.status === 'unscored' ? null : phoneme.score, locale)}</td>
                <td><span className={`review-phoneme-status review-phoneme-${phoneme.status}`}>{t(`reviewPhoneme${phoneme.status === 'dialect_variant' ? 'Dialect' : phoneme.status === 'correct' ? 'Correct' : phoneme.status === 'error' ? 'Error' : 'Unscored'}` as MessageKey)}</span></td>
                <td>{phoneme.status === 'dialect_variant' && <span className="review-dialect-label"><span>{t('reviewDialectVariant')}</span>{phoneme.dialect_rule_id && <span> · {t('reviewDialectRule')}: {phoneme.dialect_rule_id}</span>}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AudioReview detail={detail} item={item} locale={locale} t={t} onError={onError} />
    </article>
  )
}

function FingerprintCard({ fingerprint, locale, t, note, onNote, onTransition, busy }: { fingerprint: Fingerprint; locale: string; t: (key: MessageKey) => string; note: string; onNote: (value: string) => void; onTransition: TransitionHandler; busy: boolean }) {
  const response = fingerprint.response
  return (
    <article className="review-card" aria-labelledby={`fingerprint-${fingerprint.id}`}>
      <div className="review-card-heading"><div><p className="review-kicker">{t('reviewFingerprint')}</p><h3 id={`fingerprint-${fingerprint.id}`}>{t('reviewReferralDecision')}: {t(referralDecisionMessage[response.referral.decision])}</h3></div><StatusPill status={fingerprint.review_status} t={t} /></div>
      <ScorerFixtureNotice synthetic={response.synthetic} />
      <dl className="review-metadata">
        <div><dt>{t('reviewModelVersion')}</dt><dd>{response.model_version}</dd></div>
        <div><dt>{t('reviewRulesVersion')}</dt><dd>{response.rules_version}</dd></div>
      </dl>
      <div className="review-feature-grid">{Object.entries(response.features).map(([key, value]) => <div key={key}><dt>{t(featureMessage[key] ?? 'reviewFeatureUnknown')}</dt><dd>{formatFeatureValue(key, value, locale, t)}</dd></div>)}</div>
      <section className="review-rules" aria-labelledby={`fingerprint-rules-${fingerprint.id}`}>
        <h4 id={`fingerprint-rules-${fingerprint.id}`}>{t('reviewRulesFired')}</h4>
        {response.referral.rules_fired.length === 0 ? <p className="review-muted">{t('reviewNoRules')}</p> : <ul>{response.referral.rules_fired.map((rule) => <li key={rule.rule_id}><strong>{rule.rule_id}</strong><span>{locale === 'en' ? rule.text_en : rule.text_ar}</span></li>)}</ul>}
      </section>
      {fingerprint.review_note && <p className="review-readonly"><strong>{t('reviewNote')}</strong> {fingerprint.review_note}</p>}
      <ReviewActions kind="fingerprints" row={fingerprint} note={note} onNote={onNote} onTransition={onTransition} busy={busy} t={t} />
    </article>
  )
}

function PlanCard({ plan, locale, t, note, onNote, onTransition, busy, childIsDemo }: { plan: Plan; locale: string; t: (key: MessageKey) => string; note: string; onNote: (value: string) => void; onTransition: (kind: ReviewKind, row: { id: string; review_status: ReviewStatus }, target: ReviewStatus, note: string) => void; busy: boolean; childIsDemo: boolean }) {
  return <article className="review-card"><div className="review-card-heading"><div><p className="review-kicker">{t('reviewPlan')}</p><h3>{plan.id}</h3></div><StatusPill status={plan.review_status} t={t} /></div><ScorerFixtureNotice synthetic={childIsDemo} /><dl className="review-list"><div><dt>{t('reviewSkillIds')}</dt><dd>{plan.skill_ids.map((id) => <span key={id} className="review-chip">{skillLabel(id, locale)}</span>)}</dd></div><div><dt>{t('reviewItemIds')}</dt><dd>{plan.item_ids.length ? plan.item_ids.join('، ') : '—'}</dd></div></dl><ReviewActions kind="plans" row={plan} note={note} onNote={onNote} onTransition={onTransition} busy={busy} t={t} /></article>
}

function ReportCard({ report, t, note, onNote, onTransition, busy, childIsDemo }: { report: Report; t: (key: MessageKey) => string; note: string; onNote: (value: string) => void; onTransition: (kind: ReviewKind, row: { id: string; review_status: ReviewStatus }, target: ReviewStatus, note: string) => void; busy: boolean; childIsDemo: boolean }) {
  const content = report.content
  return <article className="review-card"><div className="review-card-heading"><div><p className="review-kicker">{t('reviewParentReport')}</p><h3>{report.id}</h3></div><StatusPill status={report.review_status} t={t} /></div><ScorerFixtureNotice synthetic={childIsDemo} /><div className="review-report-summary"><p><strong>{t('reviewNextFocus')}</strong> {content.next_focus_ar || '—'}</p><p><strong>{t('reviewSessionDate')}</strong> {content.session_date || '—'}</p><h4>{t('reviewProgressNotes')}</h4><ul>{content.progress_notes.map((entry) => <li key={entry.skill_id}>{entry.note_ar}</li>)}</ul></div><ReviewActions kind="parent_reports" row={report} note={note} onNote={onNote} onTransition={onTransition} busy={busy} t={t} /></article>
}

export function ReviewWorkspace() {
  const { auth } = useAuth()
  const access = useReviewAccess()
  const { t, locale } = useI18n()
  const repository = access?.repository
  const scorer = access?.scorer ?? null
  const [sessions, setSessions] = useState<ReviewSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<ReviewDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [message, setMessage] = useState<ReviewMessage | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busyRow, setBusyRow] = useState<string | null>(null)
  const [fingerprintBusy, setFingerprintBusy] = useState(false)
  const listAbort = useRef<AbortController | null>(null)
  const detailAbort = useRef<AbortController | null>(null)
  const mutationAbort = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const selectedIdRef = useRef(selectedId)
  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      listAbort.current?.abort()
      detailAbort.current?.abort()
      mutationAbort.current?.abort()
    }
  }, [])

  const loadSessions = useCallback(async () => {
    if (!repository || auth.status !== 'signedIn' || auth.role !== 'specialist') return
    listAbort.current?.abort()
    const controller = new AbortController()
    listAbort.current = controller
    setLoading(true)
    setMessage(null)
    try {
      const rows = await repository.listSessions(controller.signal)
      if (controller.signal.aborted || !mountedRef.current) return
      setSessions(rows)
      setSelectedId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? '')
    } catch (error) {
      if (!isAbort(error) && !controller.signal.aborted && mountedRef.current) setMessage(errorMessage(error, 'reviewSessionsError'))
    } finally {
      if (!controller.signal.aborted && mountedRef.current) setLoading(false)
    }
  }, [auth.role, auth.status, repository])

  const loadDetail = useCallback(async (sessionId: string) => {
    if (!repository || !sessionId || auth.status !== 'signedIn' || auth.role !== 'specialist') return
    detailAbort.current?.abort()
    const controller = new AbortController()
    detailAbort.current = controller
    setDetailLoading(true)
    setDetail(null)
    setMessage(null)
    try {
      const next = await repository.loadSession(sessionId, controller.signal)
      if (controller.signal.aborted || !mountedRef.current || selectedIdRef.current !== sessionId) return
      setDetail(next)
    } catch (error) {
      if (!isAbort(error) && !controller.signal.aborted && mountedRef.current && selectedIdRef.current === sessionId) setMessage(errorMessage(error, 'reviewSessionError'))
    } finally {
      if (!controller.signal.aborted && mountedRef.current && selectedIdRef.current === sessionId) setDetailLoading(false)
    }
  }, [auth.role, auth.status, repository])

  useEffect(() => {
    if (auth.status !== 'signedIn' || auth.role !== 'specialist' || !repository) return
    queueMicrotask(() => { void loadSessions() })
    return () => { listAbort.current?.abort(); detailAbort.current?.abort() }
  }, [auth.role, auth.status, loadSessions, repository])

  useEffect(() => {
    if (!selectedId) return
    queueMicrotask(() => { void loadDetail(selectedId) })
    return () => detailAbort.current?.abort()
  }, [loadDetail, selectedId])

  const selectedSummary = useMemo(() => sessions.find((session) => session.id === selectedId) ?? null, [selectedId, sessions])

  const createFingerprint = async () => {
    if (!repository || !scorer || !detail || detail.session.status !== 'completed' || fingerprintBusy || busyRow) return
    if (scorer.mode === 'mock' && detail.session.id !== 'demo-session-1') {
      setMessage({ key: 'reviewFixtureLimitation' })
      return
    }
    mutationAbort.current?.abort()
    const controller = new AbortController()
    mutationAbort.current = controller
    setFingerprintBusy(true)
    setMessage(null)
    const sessionId = detail.session.id
    try {
      await repository.createFingerprint(detail, scorer, controller.signal)
      if (controller.signal.aborted || !mountedRef.current || selectedIdRef.current !== sessionId) return
      await loadDetail(sessionId)
      if (controller.signal.aborted || !mountedRef.current || selectedIdRef.current !== sessionId) return
    } catch (error) {
      if (!controller.signal.aborted && mountedRef.current && selectedIdRef.current === sessionId) {
        setMessage(errorMessage(error, scorer.mode === 'mock' ? 'reviewFixtureLimitation' : 'reviewFingerprintError'))
      }
    } finally {
      if (mutationAbort.current === controller) {
        mutationAbort.current = null
        if (mountedRef.current) setFingerprintBusy(false)
      }
    }
  }

  const transition = async (kind: ReviewKind, row: { id: string; review_status: ReviewStatus }, target: ReviewStatus, note: string) => {
    if (!repository || busyRow || fingerprintBusy) return
    mutationAbort.current?.abort()
    const controller = new AbortController()
    mutationAbort.current = controller
    setBusyRow(row.id)
    setMessage(null)
    const sessionId = detail?.session.id
    try {
      await repository.transition(kind, row.id, row.review_status, target, kind === 'fingerprints' ? note || undefined : undefined, controller.signal)
      if (controller.signal.aborted || !mountedRef.current || !sessionId || selectedIdRef.current !== sessionId) return
      await loadDetail(sessionId)
      if (controller.signal.aborted || !mountedRef.current || selectedIdRef.current !== sessionId) return
    } catch (error) {
      if (!controller.signal.aborted && mountedRef.current && (!sessionId || selectedIdRef.current === sessionId)) setMessage(errorMessage(error, 'reviewTransitionError'))
    } finally {
      if (mutationAbort.current === controller) {
        mutationAbort.current = null
        if (mountedRef.current) setBusyRow(null)
      }
    }
  }

  useEffect(() => {
    mutationAbort.current?.abort()
    return () => {
      listAbort.current?.abort()
      detailAbort.current?.abort()
      mutationAbort.current?.abort()
    }
  }, [auth.role, auth.status, selectedId])

  if (auth.status !== 'signedIn' || auth.role !== 'specialist') return <section className="review-protected" aria-label={t('reviewTitle')}><p className="review-muted">{t('reviewSpecialistOnly')}</p></section>
  if (!access || !repository) return <section className="review-panel review-protected" aria-labelledby="review-title"><h2 id="review-title">{t('reviewTitle')}</h2><p className="professional-notice" role="status">{t('reviewUnavailable')}</p></section>

  return (
    <section className="review-panel" aria-labelledby="review-title">
      <div className="intro review-intro"><p className="status-note">{t('reviewBadge')}</p><h2 id="review-title">{t('reviewTitle')}</h2><p className="lead">{t('reviewDescription')}</p></div>
      <div className="review-toolbar"><label className="review-field" htmlFor="review-session"><span>{t('reviewChooseSession')}</span><select id="review-session" value={selectedId} disabled={loading || detailLoading || Boolean(busyRow || fingerprintBusy) || sessions.length === 0} onChange={(event) => { setSelectedId(event.target.value); setMessage(null) }}><option value="">{t('reviewChooseSessionPlaceholder')}</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.child_display_name}{session.child_is_demo ? ` — ${t('reviewDemoChild')}` : ''} · {formatDate(session.started_at, locale)}</option>)}</select></label><button className="action-button" type="button" disabled={loading || Boolean(busyRow || fingerprintBusy)} onClick={() => { void loadSessions() }}>{t('reviewReload')}</button></div>
      {loading && <p role="status" aria-live="polite">{t('reviewLoadingSessions')}</p>}
      {message && <p className="professional-notice" role="alert">{t(message.key)}{message.detail ? ` — ${message.detail}` : ''}</p>}
      {!loading && sessions.length === 0 && <p className="review-empty">{t('reviewNoSessions')}</p>}
      {selectedSummary && <p className="review-selected-summary">{selectedSummary.child_display_name} · {formatDate(selectedSummary.started_at, locale)} · {t('reviewSessionCompleted')}</p>}
      {detailLoading && <p role="status" aria-live="polite">{t('reviewLoadingSession')}</p>}
      {detail && (
        <>
          <div className="review-detail-heading"><div><p className="review-kicker">{t('reviewSessionDetail')}</p><h3>{childLabel(detail, t)}</h3><p className="review-muted">{formatDate(detail.session.started_at, locale)} · {t('reviewSessionCompleted')}</p></div><div className="review-fingerprint-control"><button className="action-button" type="button" disabled={Boolean(busyRow || fingerprintBusy) || !scorer || detail.session.status !== 'completed'} onClick={() => { void createFingerprint() }}>{t(fingerprintBusy ? 'reviewFingerprintLoading' : 'reviewCreateFingerprint')}</button>{scorer?.mode === 'mock' && detail.session.id !== 'demo-session-1' && <p className="review-muted">{t('reviewFixtureLimitation')}</p>}{!scorer && <p className="review-muted">{t('reviewScorerUnavailable')}</p>}</div></div>
          <section className="review-section" aria-labelledby="review-items-title"><h3 id="review-items-title">{t('reviewItemsTitle')}</h3>{detail.items.length ? detail.items.map((item) => <ItemResult key={item.id} item={item} detail={detail} locale={locale} t={t} onError={setMessage} />) : <p className="review-empty">{t('reviewNoItems')}</p>}</section>
          <section className="review-section" aria-labelledby="review-fingerprints-title"><h3 id="review-fingerprints-title">{t('reviewFingerprintsTitle')}</h3>{detail.fingerprints.length ? detail.fingerprints.map((fingerprint) => <FingerprintCard key={fingerprint.id} fingerprint={fingerprint} locale={locale} t={t} note={notes[fingerprint.id] ?? fingerprint.review_note ?? ''} onNote={(value) => setNotes((current) => ({ ...current, [fingerprint.id]: value }))} onTransition={transition} busy={Boolean(busyRow || fingerprintBusy)} />) : <p className="review-empty">{t('reviewNoFingerprints')}</p>}</section>
          <section className="review-section" aria-labelledby="review-plans-title"><h3 id="review-plans-title">{t('reviewPlansTitle')}</h3>{detail.plans.length ? detail.plans.map((plan) => <PlanCard key={plan.id} plan={plan} locale={locale} t={t} note="" onNote={() => {}} onTransition={transition} busy={Boolean(busyRow || fingerprintBusy)} childIsDemo={detail.child.is_demo} />) : <p className="review-empty">{t('reviewNoPlans')}</p>}</section>
          <section className="review-section" aria-labelledby="review-reports-title"><h3 id="review-reports-title">{t('reviewReportsTitle')}</h3>{detail.reports.length ? detail.reports.map((report) => <ReportCard key={report.id} report={report} t={t} note="" onNote={() => {}} onTransition={transition} busy={Boolean(busyRow || fingerprintBusy)} childIsDemo={detail.child.is_demo} />) : <p className="review-empty">{t('reviewNoReports')}</p>}</section>
        </>
      )}
    </section>
  )
}
