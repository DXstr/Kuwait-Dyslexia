import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/messages'
import { useAssessment } from './context'
import { AudioRecorder, RecorderError } from './recorder'
import type { ActiveAssessmentSession, AssessmentChild, AssessmentConsent } from './types'
import type { AssessmentRuntime } from './runtime'

export function SpecialistAssessmentPanel() {
  const { t } = useI18n()
  const assessment = useAssessment()
  const runtime = assessment?.runtime
  const navigate = useNavigate()
  const [children, setChildren] = useState<AssessmentChild[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [consentState, setConsentState] = useState<{ childId: string; consent: AssessmentConsent } | null>(null)
  const [loading, setLoading] = useState(Boolean(runtime))
  const [starting, setStarting] = useState(false)
  const [message, setMessage] = useState<MessageKey | null>(null)

  useEffect(() => {
    if (!runtime) return
    let alive = true
    void runtime.listChildren().then((rows) => {
      if (!alive) return
      setChildren(rows)
      setSelectedId((current) => current || rows[0]?.id || '')
    }).catch(() => { if (alive) setMessage('assessmentLoadError') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [runtime])

  const selected = children.find((child) => child.id === selectedId) ?? null
  const consent = consentState?.childId === selectedId ? consentState.consent : null
  useEffect(() => {
    if (!runtime || !selectedId) return
    let alive = true
    void runtime.repository.readAssessmentConsent(selectedId).then((value) => {
      if (alive) setConsentState({ childId: selectedId, consent: value })
    }).catch(() => { if (alive) setMessage('assessmentLoadError') })
    return () => { alive = false }
  }, [runtime, selectedId])

  if (!assessment) return null
  const queue = assessment.snapshot
  const start = async () => {
    if (!selected || starting) return
    setStarting(true)
    setMessage(null)
    try {
      await assessment.runtime.startSession(selected)
      navigate('/child')
    } catch (error) {
      const text = error instanceof Error ? error.message : ''
      setMessage(text.includes('consent') ? 'assessmentConsentBlocked' : text.includes('material') ? 'assessmentMaterialBlocked' : 'assessmentStartError')
    } finally { setStarting(false) }
  }
  const abandon = async () => {
    try { await assessment.runtime.abandonSession() }
    catch { setMessage('assessmentAbandonError') }
  }

  return (
    <>
      <section className="intro" aria-labelledby="workspace-title">
        <p className="status-note">{t('assessmentPanelBadge')}</p>
        <h1 id="workspace-title">{t('specialistTitle')}</h1>
        <p className="lead">{t('assessmentPanelDescription')}</p>
      </section>
      <section className="assessment-panel" aria-labelledby="assessment-launch-title">
        <h2 id="assessment-launch-title">{t('assessmentLaunchTitle')}</h2>
        <p>{t('assessmentLaunchDescription')}</p>
        {loading && <p role="status">{t('assessmentLoading')}</p>}
        <label className="assessment-field" htmlFor="assessment-child">
          <span>{t('assessmentChildLabel')}</span>
          <select id="assessment-child" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setMessage(null) }} disabled={loading || starting || Boolean(assessment.activeSession && !assessment.activeSession.completed) || children.length === 0}>
            <option value="">{t('assessmentChooseChild')}</option>
            {children.map((child) => <option key={child.id} value={child.id}>{child.firstName}{child.isDemo ? ` — ${t('assessmentDemoLabel')}` : ''}</option>)}
          </select>
        </label>
        {selected && (
          <div className="assessment-check" aria-live="polite">
            <strong>{t('assessmentConsentCheck')}</strong>
            <span>{consent?.valid ? t('assessmentConsentValid') : t('assessmentConsentMissing')}</span>
            {selected.isDemo && <span>{t('assessmentDemoMaterial')}</span>}
          </div>
        )}
        {message && <p className="professional-notice" role="alert">{t(message)}</p>}
        {assessment.activeSession && !assessment.activeSession.completed ? (
          <div className="oauth-actions">
            <Link className="action-link" to="/child">{t('assessmentResume')}</Link>
            <button className="action-button" type="button" onClick={() => { void abandon() }}>{t('assessmentAbandon')}</button>
          </div>
        ) : (
          <button className="action-button" type="button" disabled={starting || !selected || !consent?.valid || queue.frozen} onClick={() => { void start() }}>{t('assessmentStartButton')}</button>
        )}
      </section>
      <section className="assessment-panel" aria-labelledby="queue-title">
        <h2 id="queue-title">{t('assessmentQueueTitle')}</h2>
        <p>{t('assessmentQueueSummary')}</p>
        <dl className="queue-counts">
          <div><dt>{t('assessmentQueuePending')}</dt><dd>{queue.pending}</dd></div>
          <div><dt>{t('assessmentQueueProcessing')}</dt><dd>{queue.processing}</dd></div>
          <div><dt>{t('assessmentQueueExhausted')}</dt><dd>{queue.exhausted}</dd></div>
        </dl>
        {queue.frozen && <p className="professional-notice">{t('assessmentQueueFrozen')}</p>}
        {queue.lastError && <p className="professional-notice" role="alert">{t('assessmentQueueIssue')}</p>}
        {queue.exhausted > 0 && <button className="action-button" type="button" onClick={() => assessment.queue.retryExhausted()}>{t('assessmentRetryButton')}</button>}
        <p className="assessment-small-print">{t('assessmentUnloadWarning')}</p>
      </section>
    </>
  )
}

function ActiveChildAssessment({ session, runtime }: { session: ActiveAssessmentSession; runtime: AssessmentRuntime }) {
  const { t } = useI18n()
  const { controller } = useAuth()
  const recorder = useRef<AudioRecorder | null>(null)
  const mounted = useRef(false)
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<'ready' | 'starting' | 'recording' | 'finalizing'>('ready')
  const [notice, setNotice] = useState<MessageKey | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; recorder.current?.cancel(); recorder.current = null }
  }, [])

  const item = session.items[index]
  const finished = !item
  const begin = async () => {
    if (phase !== 'ready' || recorder.current || !controller.getVerifiedSession()) return
    setNotice(null)
    setPhase('starting')
    const next = new AudioRecorder({ onIssue: () => {
      if (!mounted.current || recorder.current !== next) return
      recorder.current = null
      setPhase('ready')
      setNotice('childNeutralNotice')
      runtime.reportIssue('unknown')
    } })
    recorder.current = next
    try {
      await next.start()
      if (!mounted.current || recorder.current !== next || !controller.getVerifiedSession()) { next.cancel(); return }
      setPhase('recording')
    } catch (error) {
      if (!mounted.current || recorder.current !== next) return
      next.cancel()
      recorder.current = null
      setPhase('ready')
      setNotice(error instanceof RecorderError && error.issue === 'permission_denied' ? 'childMicPermission' : 'childMicUnavailable')
      runtime.reportIssue('unknown')
    }
  }
  const stop = async () => {
    const current = recorder.current
    const identity = controller.getVerifiedSession()
    if (!current || !item || phase !== 'recording' || !identity) { current?.cancel(); return }
    setPhase('finalizing')
    try {
      // Only local WAV finalization is awaited. No scorer, storage or database request blocks the next prompt.
      const audio = await current.stop()
      const verified = controller.getVerifiedSession()
      if (!mounted.current || recorder.current !== current || verified?.id !== identity.id || verified.role !== 'specialist') return
      runtime.queue.enqueue({ sessionId: session.id, childId: session.child.id, item, audio, identityId: identity.id })
      recorder.current = null
      const nextIndex = index + 1
      setIndex(nextIndex)
      setPhase('ready')
      if (nextIndex >= session.items.length) {
        void runtime.completeSession().catch(() => runtime.reportIssue('network'))
      }
    } catch {
      if (!mounted.current) return
      recorder.current = null
      setPhase('ready')
      setNotice('childNeutralNotice')
      runtime.reportIssue('unknown')
    }
  }

  return (
    <section className="child-assessment" aria-labelledby="child-assessment-title">
      <p className="child-kicker">{t('childSessionKicker')}</p>
      {session.child.isDemo && <p className="demo-label">{t('assessmentDemoLabel')} — {t('assessmentDemoMaterial')}</p>}
      {finished ? (
        <div className="child-finished" role="status" aria-live="polite">
          <h1 id="child-assessment-title">{t('childFinishedTitle')}</h1>
          <p className="lead">{t('childFinishedDescription')}</p>
        </div>
      ) : (
        <>
          <h1 id="child-assessment-title" className="child-prompt">{item.text}</h1>
          <p className="child-step" aria-live="polite">{t('childItemProgress')} {index + 1} / {session.items.length}</p>
          {notice && <p className="child-neutral-notice" role="status">{t(notice)}</p>}
          {phase === 'recording' ? (
            <button className="child-mic-button child-mic-button-recording" type="button" onClick={() => { void stop() }}>{t('childMicStop')}</button>
          ) : (
            <button className="child-mic-button" type="button" disabled={phase !== 'ready'} onClick={() => { void begin() }}>{t(phase === 'starting' ? 'childMicPreparing' : phase === 'finalizing' ? 'childMicFinalizing' : 'childMicStart')}</button>
          )}
          <p className="child-neutral-hint">{t('childNeutralHint')}</p>
        </>
      )}
    </section>
  )
}

export function ChildAssessmentScreen() {
  const { t } = useI18n()
  const assessment = useAssessment()
  if (!assessment?.activeSession) return (
    <section className="intro child-guidance" aria-labelledby="no-session-title">
      <h1 id="no-session-title">{t('childTitle')}</h1>
      <h2>{t('noSessionTitle')}</h2>
      <p className="lead">{t('noSessionDescription')}</p>
      <p>{t('childStartGuidance')}</p>
    </section>
  )
  return <ActiveChildAssessment key={assessment.activeSession.id} session={assessment.activeSession} runtime={assessment.runtime} />
}
