import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useAuth } from '../auth/context'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/messages'
import { ScorerFixtureNotice } from '../scorer/ScorerNotice'
import { AudioRecorder, RecorderError, recordingDurationMs } from '../assessment/recorder'
import { useProbe } from './context'
import type { ProbeChild, ProbeResult } from './types'

const noSubscribe = () => () => {}
const noSnapshot = () => null

function useProbeSnapshot(runtime: ReturnType<typeof useProbe>) {
  return useSyncExternalStore(
    runtime?.subscribe ?? noSubscribe,
    runtime?.getSnapshot ?? noSnapshot,
    runtime?.getSnapshot ?? noSnapshot,
  )
}

function percent(value: number | null, locale: string) {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'ar-KW', { style: 'percent', maximumFractionDigits: 0 }).format(value)
}

export function ProbeResults({ result }: { result: ProbeResult }) {
  const { t, locale } = useI18n()
  return (
    <section className="probe-results" aria-labelledby="probe-results-title">
      <h2 id="probe-results-title">{t('proveResultsTitle')}</h2>
      <ScorerFixtureNotice synthetic={result.response.synthetic} />
      <p className="professional-notice">{t('proveInMemoryNotice')}</p>
      <p className="assessment-check">{t('provePersistedAt')}: {new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ar-KW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(result.createdAt))}</p>
      <div className="probe-table-wrap">
        <table className="probe-table">
          <caption>{t('proveResultsTitle')}</caption>
          <thead><tr><th>{t('proveSkill')}</th><th>{t('provePractised')}</th><th>{t('proveUnseen')}</th><th>{t('proveTransfer')}</th></tr></thead>
          <tbody>
            {result.response.per_skill.map((row) => (
              <tr key={row.skill_id}>
                <th scope="row" dir="ltr">{row.skill_id}</th>
                <td>{percent(row.practised_accuracy, locale)} · {row.n_practised}</td>
                <td>{percent(row.unseen_accuracy, locale)} · {row.n_unseen}</td>
                <td>{t(row.transfer === 'transfer_shown' ? 'proveTransferShown' : row.transfer === 'no_transfer_yet' ? 'proveNoTransferYet' : 'proveInsufficientData')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="probe-raw">
        <summary>{t('proveRawResponse')}</summary>
        <pre dir="ltr">{JSON.stringify(result.response, null, 2)}</pre>
      </details>
    </section>
  )
}

export function ProbeWorkspace() {
  const { t } = useI18n()
  const { auth, controller } = useAuth()
  const runtime = useProbe()
  const snapshot = useProbeSnapshot(runtime)
  const [children, setChildren] = useState<ProbeChild[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [consentValid, setConsentValid] = useState(false)
  const [loading, setLoading] = useState(Boolean(runtime))
  const [starting, setStarting] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [message, setMessage] = useState<MessageKey | null>(null)
  const [index, setIndex] = useState(0)
  const [submitted, setSubmitted] = useState<Set<string>>(() => new Set())
  const recorder = useRef<AudioRecorder | null>(null)
  const mounted = useRef(false)
  const [phase, setPhase] = useState<'ready' | 'starting' | 'recording' | 'finalizing'>('ready')

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      recorder.current?.cancel()
      recorder.current = null
    }
  }, [])

  useEffect(() => {
    if (!runtime || auth.status !== 'signedIn' || auth.role !== 'specialist') return
    let alive = true
    void runtime.listChildren().then((rows) => {
      if (!alive) return
      setChildren(rows)
      setSelectedId((current) => current || rows[0]?.id || '')
    }).catch(() => { if (alive) setMessage('proveNoChildren') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [auth.role, auth.status, runtime])

  useEffect(() => {
    if (!runtime || !selectedId || snapshot?.activeSession) return
    let alive = true
    void runtime.repository.readAssessmentConsent(selectedId).then((consent) => {
      if (alive) setConsentValid(consent.valid)
    }).catch(() => { if (alive) setConsentValid(false) })
    return () => { alive = false }
  }, [runtime, selectedId, snapshot?.activeSession])

  const active = snapshot?.activeSession ?? null
  const selected = children.find((child) => child.id === selectedId) ?? null
  const item = active?.items[index]
  const allSubmitted = Boolean(active && active.items.length > 0 && active.items.every((candidate) => submitted.has(candidate.id)))

  const start = async () => {
    if (!runtime || !selected || starting || !consentValid) return
    setStarting(true)
    setMessage(null)
    try {
      await runtime.startSession(selected)
      setIndex(0)
      setSubmitted(new Set())
      setPhase('ready')
    } catch (error) {
      setMessage(error instanceof Error && error.message.includes('consent') ? 'proveConsentRequired' : 'proveStartError')
    } finally { setStarting(false) }
  }

  const begin = async () => {
    if (!runtime || !active || !item || phase !== 'ready' || recorder.current || !controller.getVerifiedSession()) return
    setMessage(null)
    setPhase('starting')
    const next = new AudioRecorder({ maxDurationMs: recordingDurationMs(item.type), onIssue: () => {
      if (!mounted.current || recorder.current !== next) return
      recorder.current = null
      setPhase('ready')
      setMessage('proveRecordingError')
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
      setMessage(error instanceof RecorderError ? 'proveRecordingError' : 'proveRecordingError')
    }
  }

  const stop = async () => {
    const current = recorder.current
    const identity = controller.getVerifiedSession()
    if (!runtime || !active || !item || !current || phase !== 'recording' || !identity) { current?.cancel(); return }
    setPhase('finalizing')
    try {
      const audio = await current.stop()
      const verified = controller.getVerifiedSession()
      if (!mounted.current || recorder.current !== current || verified?.id !== identity.id || verified.role !== 'specialist') return
      runtime.enqueue(item, audio)
      setSubmitted((previous) => new Set(previous).add(item.id))
      setIndex((currentIndex) => currentIndex + 1)
      recorder.current = null
      setPhase('ready')
    } catch {
      if (!mounted.current) return
      recorder.current = null
      setPhase('ready')
      setMessage('proveRecordingError')
    }
  }

  const finish = async () => {
    if (!runtime || !snapshot || finishing || !allSubmitted || snapshot.queue.pending || snapshot.queue.processing || snapshot.queue.exhausted) return
    setFinishing(true)
    setMessage(null)
    try { await runtime.finishSession() }
    catch { setMessage('proveFinishError') }
    finally { setFinishing(false) }
  }

  const cancel = async () => {
    if (!runtime) return
    try { await runtime.abandonSession() }
    catch { setMessage('proveCancelError') }
  }

  if (auth.status !== 'signedIn' || auth.role !== 'specialist') return <section className="review-protected"><p className="review-muted">{t('reviewSpecialistOnly')}</p></section>
  if (!runtime || !snapshot) return <section className="review-panel"><p className="professional-notice">{t('reviewUnavailable')}</p></section>

  return (
    <section className="probe-panel" aria-labelledby="prove-title">
      <div className="intro review-intro"><p className="status-note">{t('proveBadge')}</p><h2 id="prove-title">{t('proveTitle')}</h2><p className="lead">{t('proveDescription')}</p></div>
      {!active && (
        <section className="assessment-panel" aria-labelledby="prove-start-title">
          <h2 id="prove-start-title">{t('proveTitle')}</h2>
          <p>{t('proveItemsAvailable')}: 2</p>
          {loading && <p role="status">{t('assessmentLoading')}</p>}
          <label className="assessment-field" htmlFor="prove-child"><span>{t('proveChooseChild')}</span><select id="prove-child" value={selectedId} disabled={loading || starting || children.length === 0} onChange={(event) => { setSelectedId(event.target.value); setMessage(null) }}><option value="">{t('assessmentChooseChild')}</option>{children.map((child) => <option key={child.id} value={child.id}>{child.firstName}{child.isDemo ? ` — ${t('assessmentDemoLabel')}` : ''}</option>)}</select></label>
          {selected && <p className="assessment-check">{consentValid ? t('proveConsentValid') : t('proveConsentRequired')}</p>}
          {runtime.queue.getSnapshot().lastError === 'material' && <p className="professional-notice">{t('proveMockLimitation')}</p>}
          {message && <p className="professional-notice" role="alert">{t(message)}</p>}
          <button className="action-button" type="button" disabled={starting || !selected || !consentValid || runtime.queue.getSnapshot().frozen} onClick={() => { void start() }}>{t('proveStart')}</button>
        </section>
      )}
      {active && !active.completed && (
        <section className="assessment-panel probe-active" aria-labelledby="prove-active-title">
          <h2 id="prove-active-title">{t('proveProgress')} {Math.min(index + 1, active.items.length)} / {active.items.length}</h2>
          <p className="demo-label">{t('proveBadge')}</p>
          {item ? <><h3 className="probe-prompt">{item.text}</h3>{message && <p className="professional-notice" role="alert">{t(message)}</p>}{phase === 'recording' ? <button className="action-button" type="button" onClick={() => { void stop() }}>{t('proveRecordStop')}</button> : <button className="action-button" type="button" disabled={phase !== 'ready'} onClick={() => { void begin() }}>{t(phase === 'starting' ? 'proveRecordingPreparing' : phase === 'finalizing' ? 'proveRecordingFinalizing' : 'proveRecordStart')}</button>}</> : <p className="professional-notice">{t('proveFinish')}</p>}
          <p>{t('proveQueuePending')}: {snapshot.queue.pending + snapshot.queue.processing}</p>
          {snapshot.queue.exhausted > 0 && <button className="action-button" type="button" onClick={() => runtime.retryExhausted()}>{t('proveQueueRetry')}</button>}
          {runtime.queue.getSnapshot().lastError === 'material' && <p className="professional-notice">{t('proveMockLimitation')}</p>}
          <div className="oauth-actions"><button className="action-button" type="button" disabled={!allSubmitted || finishing || Boolean(snapshot.queue.pending || snapshot.queue.processing || snapshot.queue.exhausted)} onClick={() => { void finish() }}>{t(finishing ? 'proveRecordingFinalizing' : 'proveFinish')}</button><button className="action-button" type="button" disabled={finishing} onClick={() => { void cancel() }}>{t('proveCancel')}</button></div>
        </section>
      )}
      {active?.completed && active.result && <ProbeResults result={active.result} />}
    </section>
  )
}
