import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/context'
import { useAssessment } from '../assessment/context'
import { AudioRecorder, RecorderError, recordingDurationMs } from '../assessment/recorder'
import type { ActiveAssessmentSession, AssessmentChild, AssessmentItem } from '../assessment/types'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/messages'
import { useLearningMap } from '../learning-map/context'
import { getCanonicalTeachBank, itemLetter, selectApprovedTeachItems, type ApprovedTeachPlan, type TeachItem } from './catalogue'
import { useTeachRepository } from './context'
import { TeachRepositoryError } from './repository'
import { MouthShapeRenderer, TracePad } from './TeachVisuals'

function assessmentItem(item: TeachItem, child: AssessmentChild): AssessmentItem {
  return {
    id: item.id,
    type: item.type,
    text: item.text,
    dialectLexiconId: child.dialectLexiconId as AssessmentItem['dialectLexiconId'],
    synthetic: true,
  }
}

function planItems(plan: ApprovedTeachPlan, focusSkillIds: readonly string[]): TeachItem[] {
  return selectApprovedTeachItems(plan, getCanonicalTeachBank(), focusSkillIds)
}

function sessionItems(session: ActiveAssessmentSession): TeachItem[] {
  const bank = getCanonicalTeachBank()
  return session.items.map((sessionItem) => {
    const item = bank.items.find((candidate) => candidate.id === sessionItem.id)
    if (!item || item.review.status !== 'approved' || item.validation.passed !== true || item.probe_only) throw new Error('teach: active material is no longer approved')
    return { ...item, skillIds: [...item.skill_ids] }
  })
}

function planErrorMessage(error: unknown): MessageKey {
  if (error instanceof TeachRepositoryError && error.code === 'forbidden') return 'teachUnavailable'
  if (error instanceof TeachRepositoryError && error.code === 'unauthorized') return 'teachUnavailable'
  if (error instanceof TeachRepositoryError && error.code === 'schema') return 'teachMaterialBlocked'
  return 'teachLoadError'
}

function PracticeSession({ session, teachItems, onFinished }: { session: ActiveAssessmentSession; teachItems: readonly TeachItem[]; onFinished?: () => void }) {
  const { t } = useI18n()
  const { controller } = useAuth()
  const assessment = useAssessment()
  const repository = useTeachRepository()
  const recorder = useRef<AudioRecorder | null>(null)
  const mounted = useRef(false)
  const completed = useRef(false)
  const [index, setIndex] = useState(0)
  const [mode, setMode] = useState<'read' | 'trace'>('read')
  const [helperOpen, setHelperOpen] = useState(false)
  const [phase, setPhase] = useState<'ready' | 'starting' | 'recording' | 'finalizing'>('ready')
  const [tapBusy, setTapBusy] = useState(false)
  const [tapAttempts, setTapAttempts] = useState(0)
  const [notice, setNotice] = useState<MessageKey | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; recorder.current?.cancel(); recorder.current = null }
  }, [])

  const current = session.items[index]
  const material = current ? teachItems.find((item) => item.id === current.id) ?? null : null
  const letter = material ? itemLetter(material) : null
  const finished = !current || !material
  const finish = () => {
    if (completed.current) return
    completed.current = true
    void assessment?.runtime.completeSession().catch(() => assessment.runtime.reportIssue('network'))
    onFinished?.()
  }
  const advance = () => {
    const next = index + 1
    setNotice(null)
    setHelperOpen(false)
    setTapAttempts(0)
    setMode('read')
    if (next >= session.items.length) finish()
    setIndex(next)
  }

  const beginRecording = async () => {
    if (!assessment || !current || phase !== 'ready' || recorder.current || !controller.getVerifiedSession()) return
    setNotice(null)
    setPhase('starting')
    const next = new AudioRecorder({ maxDurationMs: recordingDurationMs(current.type), onIssue: () => {
      if (!mounted.current || recorder.current !== next) return
      recorder.current = null
      setPhase('ready')
      setNotice('childNeutralNotice')
      assessment.runtime.reportIssue('unknown')
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
      assessment.runtime.reportIssue('unknown')
    }
  }

  const stopRecording = async () => {
    const currentRecorder = recorder.current
    const identity = controller.getVerifiedSession()
    if (!assessment || !current || !currentRecorder || phase !== 'recording' || !identity) { currentRecorder?.cancel(); return }
    setPhase('finalizing')
    try {
      const audio = await currentRecorder.stop()
      const verified = controller.getVerifiedSession()
      if (!mounted.current || recorder.current !== currentRecorder || verified?.id !== identity.id || verified.role !== 'specialist') return
      assessment.queue.enqueue({ sessionId: session.id, childId: session.child.id, item: current, audio, identityId: identity.id })
      recorder.current = null
      setPhase('ready')
      advance()
    } catch {
      if (!mounted.current) return
      recorder.current = null
      setPhase('ready')
      setNotice('childNeutralNotice')
      assessment.runtime.reportIssue('unknown')
    }
  }

  const chooseTap = async (optionIndex: number) => {
    if (!repository || !material || !current || tapBusy || typeof material.answer_index !== 'number') return
    const identity = controller.getVerifiedSession()
    if (!identity) { setNotice('teachUnavailable'); return }
    const correct = optionIndex === material.answer_index
    setTapBusy(true)
    setNotice(null)
    try {
      await repository.insertTapResult({
        sessionId: session.id,
        childId: session.child.id,
        itemId: current.id,
        evidence: { skill_id: material.skill_ids[0], correct, source: 'tap' },
      })
      if (correct) advance()
      else {
        setTapAttempts((value) => value + 1)
        setNotice('teachNeutralRetry')
        setHelperOpen(true)
      }
    } catch {
      setNotice('teachTapSaveError')
    } finally { setTapBusy(false) }
  }

  if (finished) return (
    <section className="teach-finished" aria-labelledby="teach-finished-title">
      <p className="child-kicker">{t('teachKicker')}</p>
      <h1 id="teach-finished-title">{t('teachFinishedTitle')}</h1>
      <p className="lead">{t('teachFinishedDescription')}</p>
      {assessment?.snapshot.pending ? <p className="teach-queue-note">{t('teachQueueNote')}</p> : null}
    </section>
  )

  const isTap = material.type === 'vowel_tap' && Array.isArray(material.options) && typeof material.answer_index === 'number'
  return (
    <section className="teach-session" aria-labelledby="teach-title">
      <p className="child-kicker">{t('teachKicker')}</p>
      <p className="teach-progress" aria-live="polite">{t('teachProgress')} {index + 1} / {session.items.length}</p>
      <h1 id="teach-title" className="teach-prompt">{material.text}</h1>
      <div className="teach-actions" role="group" aria-label={t('teachActivityChoices')}>
        <button className={`action-button${mode === 'read' ? ' teach-action-selected' : ''}`} type="button" onClick={() => { setMode('read'); setNotice(null) }}>{t('teachReadMode')}</button>
        <button className={`action-button${mode === 'trace' ? ' teach-action-selected' : ''}`} type="button" onClick={() => { setMode('trace'); setNotice(null) }}>{t('teachTraceMode')}</button>
      </div>
      {notice && <p className="child-neutral-notice" role="status" aria-live="polite">{t(notice)}</p>}
      <div className="teach-helper-actions">
        <button className="action-button" type="button" onClick={() => setHelperOpen((open) => !open)} aria-expanded={helperOpen}>{t('teachShowCue')}</button>
        {tapAttempts > 0 && <span className="teach-attempt-note">{t('teachTryAgain')}</span>}
      </div>
      {helperOpen && letter && (
        <aside className="teach-helper" aria-labelledby="teach-helper-title">
          <h2 id="teach-helper-title">{t('teachCueTitle')}</h2>
          <MouthShapeRenderer letter={letter} label={t('teachMouthLabel')} />
          <p>{letter.cue_ar}</p>
          <p className="teach-no-mnemonic">{t('teachNoMnemonic')}</p>
        </aside>
      )}
      {mode === 'trace' ? (
        <TracePad
          label={t('teachTraceTitle')}
          resetLabel={t('teachTraceReset')}
          completeLabel={t('teachTraceComplete')}
          note={t('teachTraceNote')}
          canvasLabel={t('teachTraceCanvasLabel')}
          onComplete={advance}
        />
      ) : isTap ? (
        <div className="teach-tap" aria-labelledby="teach-tap-title">
          <h2 id="teach-tap-title">{t('teachTapTitle')}</h2>
          <p>{t('teachTapDescription')}</p>
          <div className="teach-option-grid">
            {material.options?.map((option, optionIndex) => (
              <button className="teach-option" key={`${material.id}-${option}`} type="button" disabled={tapBusy} onClick={() => { void chooseTap(optionIndex) }}>{option}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="teach-read">
          <p>{t('teachReadDescription')}</p>
          {phase === 'recording' ? (
            <button className="child-mic-button child-mic-button-recording" type="button" onClick={() => { void stopRecording() }}>{t('teachReadStop')}</button>
          ) : (
            <button className="child-mic-button" type="button" disabled={phase !== 'ready'} onClick={() => { void beginRecording() }}>{t(phase === 'starting' ? 'childMicPreparing' : phase === 'finalizing' ? 'childMicFinalizing' : 'teachReadStart')}</button>
          )}
          <p className="child-neutral-hint">{t('teachNeutralHint')}</p>
        </div>
      )}
    </section>
  )
}

export function TeachWorkspace() {
  const { t } = useI18n()
  const assessment = useAssessment()
  const assessmentRuntime = assessment?.runtime
  const repository = useTeachRepository()
  const learningMap = useLearningMap()
  const [children, setChildren] = useState<AssessmentChild[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [plan, setPlan] = useState<ApprovedTeachPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [planLoading, setPlanLoading] = useState(false)
  const [message, setMessage] = useState<MessageKey | null>(null)
  const loadedPlanKey = useRef<string | null>(null)

  useEffect(() => {
    if (!assessmentRuntime) return
    let alive = true
    void assessmentRuntime.listChildren().then((rows) => {
      if (!alive) return
      setChildren(rows)
      setSelectedId((current) => current || learningMap?.selectedChildId || rows[0]?.id || '')
    }).catch(() => { if (alive) setMessage('teachLoadError') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [assessmentRuntime, learningMap?.selectedChildId])

  const selectedChild = children.find((child) => child.id === selectedId) ?? null
  const activePractice = assessment?.activeSession?.type === 'practice' ? assessment.activeSession : null
  const focusSkillIds = learningMap?.nextPlan?.focusSkillIds
  const material = useMemo(() => {
    if (!plan) return { items: [] as TeachItem[], blocked: false }
    try { return { items: planItems(plan, focusSkillIds ?? []), blocked: false } }
    catch { return { items: [] as TeachItem[], blocked: true } }
  }, [focusSkillIds, plan])
  const items = material.items
  useEffect(() => {
    if (!repository || !selectedId || activePractice) return
    const planKey = selectedId
    if (loadedPlanKey.current === planKey) return
    loadedPlanKey.current = planKey
    let alive = true
    const load = async () => {
      setPlanLoading(true)
      setPlan(null)
      setMessage(null)
      try {
        const next = await repository.readApprovedPracticePlan(selectedId)
        if (!alive) return
        if (!next) { setMessage('teachPlanUnavailable'); return }
        setPlan(next)
      } catch (error) {
        if (alive) setMessage(planErrorMessage(error))
      } finally {
        if (alive) setPlanLoading(false)
      }
    }
    void load()
    return () => { alive = false }
  }, [activePractice, repository, selectedId])

  const start = async () => {
    if (!assessment || !selectedChild || !plan || items.length === 0) return
    setMessage(null)
    try {
      await assessment.runtime.startPracticeSession(selectedChild, items.map((item) => assessmentItem(item, selectedChild)))
    } catch (error) {
      const text = error instanceof Error ? error.message : ''
      setMessage(text.includes('consent') ? 'teachConsentBlocked' : text.includes('material') ? 'teachMaterialBlocked' : 'teachStartError')
    }
  }
  const displayedMessage: MessageKey | null = material.blocked ? 'teachMaterialBlocked' : message

  if (activePractice) return <PracticeSession session={activePractice} teachItems={items.length ? items : sessionItems(activePractice)} />

  return (
    <>
      <section className="intro child-guidance" aria-labelledby="teach-intro-title">
        <p className="child-kicker">{t('teachKicker')}</p>
        <h1 id="teach-intro-title">{t('childTitle')}</h1>
        <p className="lead">{t('teachDescription')}</p>
        {!plan && <p>{t('noSessionDescription')}</p>}
      </section>
      <section className="teach-launch" aria-labelledby="teach-launch-title">
        <h2 id="teach-launch-title">{t('teachLaunchTitle')}</h2>
        {loading && <p role="status">{t('teachLoading')}</p>}
        <label className="assessment-field" htmlFor="teach-child">
          <span>{t('teachChildLabel')}</span>
          <select id="teach-child" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={loading || planLoading || children.length === 0}>
            <option value="">{t('teachChooseChild')}</option>
            {children.map((child) => <option key={child.id} value={child.id}>{child.firstName}{child.isDemo ? ` — ${t('assessmentDemoLabel')}` : ''}</option>)}
          </select>
        </label>
        {planLoading && <p role="status">{t('teachPlanLoading')}</p>}
        {plan && <p className="teach-approval-note">{t('teachApprovedPlanNotice')} {items.length}</p>}
        {displayedMessage && <p className="child-neutral-notice" role="alert">{t(displayedMessage)}</p>}
        {plan && items.length > 0 && (
          <button className="child-mic-button" type="button" disabled={!selectedChild || planLoading} onClick={() => { void start() }}>{t('teachStart')}</button>
        )}
      </section>
    </>
  )
}
