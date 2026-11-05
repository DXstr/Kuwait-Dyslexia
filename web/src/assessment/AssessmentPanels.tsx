import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/messages'
import { Button, Notice, SectionHeader, Surface } from '../ui/core'
import { ChildWorld, RecordingOrb } from '../ui/pages/child/ChildWorld'
import { childCopy } from '../ui/pages/child/copy'
import { useDelight } from '../ui/delight/DelightProvider'
import { useAssessment } from './context'
import { AudioRecorder, RecorderError, recordingDurationMs } from './recorder'
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
    <div className="noor-pro-shell">
      <SectionHeader
        eyebrow={t('assessmentPanelBadge')}
        title={t('specialistTitle')}
        description={t('assessmentPanelDescription')}
        level={1}
      />
      <Surface className="assessment-panel" aria-labelledby="assessment-launch-title">
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
          <Notice className="assessment-check" tone={consent?.valid ? 'positive' : 'caution'} title={t('assessmentConsentCheck')}>
            <span>{consent?.valid ? t('assessmentConsentValid') : t('assessmentConsentMissing')}</span>
            {selected.isDemo && <span>{t('assessmentDemoMaterial')}</span>}
          </Notice>
        )}
        {message && <Notice className="professional-notice" tone="caution" role="alert">{t(message)}</Notice>}
        {assessment.activeSession && !assessment.activeSession.completed ? (
          <div className="oauth-actions">
            <Link className="action-link" to="/child">{t('assessmentResume')}</Link>
            <Button className="action-button" variant="outline" type="button" onClick={() => { void abandon() }}>{t('assessmentAbandon')}</Button>
          </div>
        ) : (
          <Button className="action-button" type="button" disabled={starting || !selected || !consent?.valid || queue.frozen} onClick={() => { void start() }}>{t('assessmentStartButton')}</Button>
        )}
      </Surface>
      <Surface className="assessment-panel" aria-labelledby="queue-title" tone="quiet">
        <h2 id="queue-title">{t('assessmentQueueTitle')}</h2>
        <p>{t('assessmentQueueSummary')}</p>
        <dl className="queue-counts">
          <div><dt>{t('assessmentQueuePending')}</dt><dd>{queue.pending}</dd></div>
          <div><dt>{t('assessmentQueueProcessing')}</dt><dd>{queue.processing}</dd></div>
          <div><dt>{t('assessmentQueueExhausted')}</dt><dd>{queue.exhausted}</dd></div>
        </dl>
        {queue.frozen && <Notice className="professional-notice" tone="caution">{t('assessmentQueueFrozen')}</Notice>}
        {queue.lastError && <Notice className="professional-notice" tone="caution" role="alert">{t('assessmentQueueIssue')}</Notice>}
        {queue.exhausted > 0 && <Button className="action-button" variant="outline" type="button" onClick={() => assessment.queue.retryExhausted()}>{t('assessmentRetryButton')}</Button>}
        <p className="assessment-small-print">{t('assessmentUnloadWarning')}</p>
      </Surface>
    </div>
  )
}

function ActiveChildAssessment({ session, runtime }: { session: ActiveAssessmentSession; runtime: AssessmentRuntime }) {
  const { t } = useI18n()
  const { controller } = useAuth()
  const { playAdvance, playCompletion, playNeutralAttention } = useDelight()
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
    if (!item || phase !== 'ready' || recorder.current || !controller.getVerifiedSession()) return
    setNotice(null)
    setPhase('starting')
    const next = new AudioRecorder({ maxDurationMs: recordingDurationMs(item.type), onIssue: () => {
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
        playCompletion()
        void runtime.completeSession().catch(() => runtime.reportIssue('network'))
      } else playAdvance()
    } catch {
      if (!mounted.current) return
      recorder.current = null
      setPhase('ready')
      setNotice('childNeutralNotice')
      playNeutralAttention()
      runtime.reportIssue('unknown')
    }
  }

  if (finished) return (
    <ChildWorld
      className="child-assessment"
      pose="celebrating"
      noorAlt={childCopy.shell.celebratingAlt}
      title={t('childFinishedTitle')}
      titleId="child-assessment-title"
      progress={t('childItemProgress')}
    >
      <div className="child-finished-copy" role="status" aria-live="polite">
        <p className="lead">{t('childFinishedDescription')}</p>
      </div>
    </ChildWorld>
  )

  const orbState = phase === 'recording' ? 'recording' : phase === 'ready' ? 'ready' : 'processing'
  return (
    <ChildWorld
      className="child-assessment"
      pose="reading"
      noorAlt={childCopy.shell.readingAlt}
      title={<span className="child-prompt">{item.text}</span>}
      titleId="child-assessment-title"
      progress={`${t('childItemProgress')} ${index + 1} / ${session.items.length}`}
      boundary={session.child.isDemo ? childCopy.boundary.adultOnly : undefined}
    >
      {notice && <p className="noor-child-world__neutral" role="status">{t(notice)}</p>}
      <RecordingOrb
        className="child-mic-button"
        state={orbState}
        disabled={phase !== 'ready' && phase !== 'recording'}
        label={t(phase === 'recording' ? 'childMicStop' : 'childMicStart')}
        onClick={() => { void (phase === 'recording' ? stop() : begin()) }}
      >
        {t(phase === 'starting' ? 'childMicPreparing' : phase === 'finalizing' ? 'childMicFinalizing' : phase === 'recording' ? 'childMicStop' : 'childMicStart')}
      </RecordingOrb>
      <p className="noor-child-world__hint">{t('childNeutralHint')}</p>
    </ChildWorld>
  )
}

export function ChildAssessmentScreen() {
  const { t } = useI18n()
  const assessment = useAssessment()
  if (!assessment?.activeSession) return (
    <ChildWorld
      className="child-guidance"
      pose="curious"
      noorAlt={childCopy.shell.curiousAlt}
      title={t('childTitle')}
      titleId="no-session-title"
    >
      <h2>{t('noSessionTitle')}</h2>
      <p className="lead">{t('noSessionDescription')}</p>
      <p>{t('childStartGuidance')}</p>
    </ChildWorld>
  )
  return <ActiveChildAssessment key={assessment.activeSession.id} session={assessment.activeSession} runtime={assessment.runtime} />
}
