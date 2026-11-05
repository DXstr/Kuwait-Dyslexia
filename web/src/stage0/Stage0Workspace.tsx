import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Stage0Construct, Stage0ScoreRequest, Stage0TaskItem } from '../contracts/basira'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/messages'
import { useScorer } from '../scorer/context'
import { ScorerClientError } from '../scorer/errors'
import { ExaminerSidebar } from '../ui/pages/examiner/ExaminerSidebar'
import { WorkspaceShell } from '../ui/pages/examiner/ExaminerWorkspaceShell'
import { constructItems, constructLabels } from '../ui/pages/examiner/constructs'
import { useStage0RepositoryState } from './context'
import { STAGE0_CONSTRUCTS, isSafeStimulusSvg, scoredItemsForTaskSet, stage0Catalog } from './catalog'
import type { Stage0Child, Stage0Result, Stage0Session } from './repository'
import { Stage0RepositoryError } from './repository'

function monthsOld(birthMonth: string, at = new Date()) {
  const match = /^(\d{4})-(\d{2})$/.exec(birthMonth)
  if (!match) return null
  const months = (at.getUTCFullYear() - Number(match[1])) * 12 + (at.getUTCMonth() + 1 - Number(match[2]))
  return Number.isInteger(months) && months >= 60 && months <= 160 ? months : null
}

function safeItemSvg(value: string | null) {
  return isSafeStimulusSvg(value) ? <span className="stage0-svg" aria-hidden="true" dangerouslySetInnerHTML={{ __html: value }} /> : null
}

function responseComplete(item: Stage0TaskItem, value: string | number | boolean | undefined) {
  if (value === undefined) return false
  if (item.response_type === 'number') return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 9
  if (item.response_type === 'tap') return value === true
  return typeof value === 'string' && value.length > 0
}

function TaskCard({ item, value, onResponse }: { item: Stage0TaskItem; value: string | number | boolean | undefined; onResponse: (value: string | number | boolean, timeMs?: number) => void }) {
  const { t } = useI18n()
  return (
    <article className="stage0-item">
      <div className="stage0-item-heading">
        <h4>{item.item_id}</h4>
        {item.practice && <span className="status-note">{t('stage0PracticeItem')}</span>}
      </div>
      {safeItemSvg(item.stimulus_svg)}
      {item.stimulus_text && <p className="stage0-stimulus-text">{item.stimulus_text}</p>}
      <div className="stage0-response" aria-label={`${t('stage0RecordResponse')}: ${item.item_id}`}>
        {item.response_type === 'option_id' && item.options?.map((option) => (
          <button
            className={`stage0-option${value === option.option_id ? ' stage0-option-selected' : ''}`}
            type="button"
            key={option.option_id}
            aria-pressed={value === option.option_id}
            onClick={() => onResponse(option.option_id)}
          >
            {safeItemSvg(option.svg)}
            {option.text && <span>{option.text}</span>}
          </button>
        ))}
        {item.response_type === 'number' && (
          <label className="stage0-number-field">
            <span>{t('stage0NumberAnswer')}</span>
            <input type="number" min={1} max={9} value={typeof value === 'number' ? value : ''} onChange={(event) => { const number = Number(event.target.value); if (Number.isInteger(number) && number >= 1 && number <= 9) onResponse(number) }} />
          </label>
        )}
        {item.response_type === 'tap' && <button className={`action-button${value === true ? ' stage0-option-selected' : ''}`} type="button" aria-pressed={value === true} onClick={() => onResponse(true, 0)}>{t('stage0Tap')}</button>}
      </div>
    </article>
  )
}

export function Stage0Workspace() {
  const { t } = useI18n()
  const { repository, version, readable } = useStage0RepositoryState()
  const scorerState = useScorer()
  const [children, setChildren] = useState<Stage0Child[]>([])
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null)
  const [childId, setChildId] = useState('')
  const [session, setSession] = useState<Stage0Session | null>(null)
  const [sessionVersion, setSessionVersion] = useState<number | null>(null)
  const [activeConstruct, setActiveConstruct] = useState<Stage0Construct | null>(null)
  const [responses, setResponses] = useState<Record<string, string | number | boolean>>({})
  const [saved, setSaved] = useState<Record<Stage0Construct, Stage0Result>>({} as Record<Stage0Construct, Stage0Result>)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null)

  const isCurrent = useCallback(() => {
    const currentVersion = repository?.getVersion?.() ?? version
    return Boolean(repository && readable && currentVersion === version)
  }, [readable, repository, version])

  const loadChildren = useCallback(async (signal?: AbortSignal) => {
    setLoadedVersion(null)
    setSessionVersion(null)
    setSession(null)
    setActiveConstruct(null)
    setResponses({})
    setSaved({} as Record<Stage0Construct, Stage0Result>)
    if (!repository || !readable) {
      setChildren([])
      setChildId('')
      setLoading(false)
      setErrorKey('stage0LoadError')
      return
    }
    setLoading(true)
    setErrorKey(null)
    const requestVersion = version
    try {
      const rows = await repository.listExaminerChildren({ signal })
      if (signal?.aborted || !isCurrent() || (repository.getVersion?.() ?? requestVersion) !== requestVersion) return
      setChildren(rows)
      setChildId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || '')
      setLoadedVersion(requestVersion)
    } catch {
      if (!signal?.aborted && isCurrent()) setErrorKey('stage0LoadError')
    } finally {
      if (!signal?.aborted && isCurrent()) setLoading(false)
    }
  }, [isCurrent, readable, repository, version])

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => { void loadChildren(controller.signal) }, 0)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [loadChildren])

  const hasCurrentChildren = readable && loadedVersion === version
  const child = useMemo(() => hasCurrentChildren ? children.find((row) => row.id === childId) ?? null : null, [children, childId, hasCurrentChildren])
  const currentSession = readable && sessionVersion === version ? session : null
  const start = async () => {
    if (!repository || !child || !isCurrent()) return
    const operationVersion = version
    setBusy(true)
    setErrorKey(null)
    try {
      // Consent is deliberately not treated as a UI-only pre-check. The INSERT
      // is the authoritative database gate, using server time and RLS/triggers.
      const created = await repository.createExaminerSession(child.id)
      if (!isCurrent() || (repository.getVersion?.() ?? operationVersion) !== operationVersion) return
      setSession(created)
      setSessionVersion(operationVersion)
      setActiveConstruct(null)
      setResponses({})
      setSaved({} as Record<Stage0Construct, Stage0Result>)
    } catch (error) {
      if (isCurrent()) setErrorKey(error instanceof Stage0RepositoryError && (error.issue === 'forbidden' || error.issue === 'consent') ? 'stage0ConsentMissing' : 'stage0StartError')
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }
  const chooseConstruct = (construct: Stage0Construct) => {
    if (!currentSession || saved[construct] || !stage0Catalog.find((entry) => entry.construct === construct)?.taskSet) return
    setActiveConstruct(construct)
    setResponses({})
    setErrorKey(null)
  }
  const submitConstruct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!repository || !currentSession || !activeConstruct || !child || !scorerState?.client || !isCurrent()) return
    const taskSet = stage0Catalog.find((entry) => entry.construct === activeConstruct)?.taskSet
    const age = monthsOld(child.birth_month)
    if (!taskSet || age === null) {
      setErrorKey('stage0StartError')
      return
    }
    const items = scoredItemsForTaskSet(taskSet)
    if (items.some((item) => !responseComplete(item, responses[item.item_id]))) {
      setErrorKey('stage0StartError')
      return
    }
    const request: Stage0ScoreRequest = {
      construct: taskSet.construct,
      instrument_id: taskSet.instrument_id,
      child_age_months: age,
      grade: child.grade,
      responses: items.map((item) => ({ item_id: item.item_id, response: responses[item.item_id], ...(item.response_type === 'tap' ? { time_ms: 0 } : {}) })),
    }
    const operationVersion = version
    setBusy(true)
    setErrorKey(null)
    try {
      const result = await scorerState.client.stage0(request)
      if (!isCurrent() || (repository.getVersion?.() ?? operationVersion) !== operationVersion) return
      const stored = await repository.saveResult(currentSession, request, result)
      if (!isCurrent() || (repository.getVersion?.() ?? operationVersion) !== operationVersion) return
      setSaved((current) => ({ ...current, [activeConstruct]: stored }))
      setActiveConstruct(null)
      setResponses({})
    } catch (error) {
      if (isCurrent()) setErrorKey(error instanceof ScorerClientError && error.issue === 'fixtureUnavailable' ? 'stage0FixtureUnavailable' : 'stage0StartError')
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }
  const finish = async () => {
    if (!repository || !currentSession || !isCurrent()) return
    const operationVersion = version
    setBusy(true)
    setErrorKey(null)
    try {
      const completed = await repository.completeSession(currentSession.id)
      if (!isCurrent() || (repository.getVersion?.() ?? operationVersion) !== operationVersion) return
      setSession(completed)
      setActiveConstruct(null)
    } catch {
      if (isCurrent()) setErrorKey('stage0StartError')
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }

  const items = constructItems(saved, activeConstruct)
  const sidebar = (
    <ExaminerSidebar
      childName={currentSession && child ? child.first_name : undefined}
      childIsDemo={Boolean(currentSession && child?.is_demo)}
      sessionStatus={currentSession ? (currentSession.status === 'completed' ? 'stage0SessionComplete' : 'stage0SessionStarted') : undefined}
      items={items}
      activeConstruct={activeConstruct}
      onSelect={chooseConstruct}
    />
  )

  return (
    <WorkspaceShell id="stage0-title" className="stage0-workspace-shell" eyebrow="stage0ExaminerOnly" title="stage0Title" description="stage0Description" aside={sidebar}>
      <section className="stage0-panel" aria-busy={busy}>
        {!repository && <p className="professional-notice" role="alert">{t('stage0LoadError')}</p>}
        {errorKey && <p className="professional-notice" role="alert">{t(errorKey)}</p>}
        {loading && repository && <p role="status" aria-live="polite">{t('assessmentLoading')}</p>}
        {!loading && hasCurrentChildren && children.length === 0 && <p className="workspace-empty-state">{t('consentNoChildren')}</p>}
        {!loading && hasCurrentChildren && children.length > 0 && !currentSession && (
          <div className="stage0-launch">
            <label className="assessment-field" htmlFor="stage0-child">
              <span>{t('stage0ChooseChild')}</span>
              <select id="stage0-child" value={childId} onChange={(event) => setChildId(event.target.value)}>
                <option value="">{t('stage0ChooseChildPlaceholder')}</option>
                {children.map((row) => <option key={row.id} value={row.id}>{row.first_name}{row.is_demo ? ` — ${t('assessmentDemoLabel')}` : ''}</option>)}
              </select>
            </label>
            <p className="professional-notice">{t('stage0ConsentValid')}</p>
            <div className="workspace-actions">
              <button className="action-button" type="button" disabled={busy || !child} onClick={() => { void start() }}>{t('stage0Start')}</button>
              <button className="action-button action-button-secondary" type="button" disabled={busy} onClick={() => { void loadChildren() }}>{t('stage0ConsentReload')}</button>
            </div>
          </div>
        )}
        {currentSession && child && (
          <>
            <div className="workspace-status-row">
              <p className="professional-notice" role="status">{currentSession.status === 'completed' ? t('stage0SessionComplete') : t('stage0SessionStarted')}</p>
              {child.is_demo && <p className="fixture-notice">{t('consentSyntheticWarning')}</p>}
            </div>
            <div className="stage0-construct-grid" aria-label={t('stage0Title')}>
              {stage0Catalog.map((entry) => {
                const result = saved[entry.construct]
                return (
                  <article className={`stage0-construct-card${entry.unavailable ? ' stage0-construct-unavailable' : ''}`} key={entry.construct}>
                    <h3>{t(constructLabels[entry.construct])}</h3>
                    <p className="stage0-construct-id">{entry.construct}</p>
                    {entry.unavailable ? <p className="professional-notice">{t('stage0TaskUnavailable')}</p> : <p>{t('stage0TaskAvailable')}</p>}
                    {result && <p className="fixture-notice">{result.response.synthetic ? t('stage0ResultSynthetic') : t('stage0ConstructSaved')} {t('stage0ResultPending')}</p>}
                    {!entry.unavailable && !result && currentSession.status === 'in_progress' && <button className="action-button" type="button" disabled={busy} onClick={() => chooseConstruct(entry.construct)}>{t('stage0ChooseConstruct')}</button>}
                  </article>
                )
              })}
            </div>
            {activeConstruct && stage0Catalog.find((entry) => entry.construct === activeConstruct)?.taskSet && (
              <form className="stage0-task" onSubmit={(event) => { void submitConstruct(event) }}>
                {(() => {
                  const taskSet = stage0Catalog.find((entry) => entry.construct === activeConstruct)?.taskSet
                  if (!taskSet) return null
                  return <>
                    <h3>{taskSet.title_ar}</h3>
                    <p className="professional-notice">{taskSet.notice_ar}</p>
                    <p><strong>{t('stage0FormatSource')}:</strong> {taskSet.format_source}</p>
                    {taskSet.review.status === 'unreviewed' && <p className="fixture-notice">{t('stage0Unreviewed')}</p>}
                    {taskSet.blocks.map((block) => <section className="stage0-block" key={block.block_id}><h4>{block.title_ar}</h4><p><strong>{t('stage0BlockInstructions')}:</strong> {block.instructions_ar}</p>{block.items.map((item) => <TaskCard key={item.item_id} item={item} value={responses[item.item_id]} onResponse={(value, timeMs) => setResponses((current) => ({ ...current, [item.item_id]: value, ...(timeMs === undefined ? {} : {}) }))} />)}</section>)}
                    <div className="workspace-actions">
                      <button className="action-button" type="submit" disabled={busy}>{t('stage0SubmitConstruct')}</button>
                    </div>
                  </>
                })()}
              </form>
            )}
            {currentSession.status === 'in_progress' && !activeConstruct && <button className="action-button" type="button" disabled={busy} onClick={() => { void finish() }}>{t('stage0SessionCompleteButton')}</button>}
          </>
        )}
      </section>
    </WorkspaceShell>
  )
}

export { STAGE0_CONSTRUCTS }
