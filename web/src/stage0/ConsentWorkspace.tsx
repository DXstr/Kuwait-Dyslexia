import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useI18n } from '../i18n/context'
import { useStage0RepositoryState } from './context'
import type { GuardianConsent, Stage0Child } from './repository'
import { Stage0RepositoryError } from './repository'
import { WorkspaceShell } from '../ui/pages/examiner/ExaminerWorkspaceShell'

function defaultExpiry() {
  const value = new Date()
  value.setFullYear(value.getFullYear() + 1)
  return value.toISOString().slice(0, 10)
}

function expiryIso(date: string) {
  return `${date}T23:59:59.999Z`
}

function formatDate(value: string, locale: string) {
  const parsed = new Date(value)
  return Number.isFinite(parsed.valueOf()) ? new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ar-KW', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed) : value
}

function ConsentSidebar() {
  const { t } = useI18n()
  return (
    <div className="consent-sidebar">
      <div>
        <p className="consent-sidebar__eyebrow">{t('consentGuardianOnly')}</p>
        <h3 className="consent-sidebar__title">{t('consentTitle')}</h3>
      </div>
      <ol className="consent-sidebar__list">
        <li>{t('consentChooseChild')}</li>
        <li>{t('consentEvidenceLabel')}</li>
        <li>{t('consentAcknowledgement')}</li>
        <li>{t('consentDescription')}</li>
      </ol>
      <div className="examiner-sidebar__footer">
        <p>{t('consentSignedAt')}</p>
        <p>{t('consentPending')}</p>
      </div>
    </div>
  )
}

export function ConsentWorkspace() {
  const { t, locale } = useI18n()
  const { repository, version, readable } = useStage0RepositoryState()
  const [children, setChildren] = useState<Stage0Child[]>([])
  const [consents, setConsents] = useState<Record<string, GuardianConsent[]>>({})
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null)
  const [childId, setChildId] = useState('')
  const [scope, setScope] = useState<GuardianConsent['scope']>('assessment')
  const [evidencePath, setEvidencePath] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [expiresOn, setExpiresOn] = useState(defaultExpiry)
  const [loading, setLoading] = useState(Boolean(repository && readable))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(!repository)
  const [notice, setNotice] = useState<'saved' | 'revoked' | null>(null)

  const isCurrent = useCallback(() => {
    const currentVersion = repository?.getVersion?.() ?? version
    return Boolean(repository && readable && currentVersion === version)
  }, [readable, repository, version])

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadedVersion(null)
    if (!repository || !readable) {
      setChildren([])
      setConsents({})
      setChildId('')
      setLoading(false)
      setError(true)
      return
    }
    setLoading(true)
    setError(false)
    const requestVersion = version
    try {
      const rows = await repository.listGuardianChildren({ signal })
      if (signal?.aborted || !isCurrent() || (repository.getVersion?.() ?? requestVersion) !== requestVersion) return
      const entries = await Promise.all(rows.map(async (child) => [child.id, await repository.listConsents(child.id, undefined, { signal })] as const))
      if (signal?.aborted || !isCurrent() || (repository.getVersion?.() ?? requestVersion) !== requestVersion) return
      setChildren(rows)
      setConsents(Object.fromEntries(entries))
      setChildId((current) => rows.some((child) => child.id === current) ? current : rows[0]?.id || '')
      setLoadedVersion(requestVersion)
    } catch (caught) {
      if (!signal?.aborted && isCurrent()) setError(caught instanceof Stage0RepositoryError && caught.issue === 'cancelled' ? false : true)
    } finally {
      if (!signal?.aborted && isCurrent()) setLoading(false)
    }
  }, [isCurrent, readable, repository, version])

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => { void load(controller.signal) }, 0)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [load])

  const hasCurrentData = readable && loadedVersion === version
  const selectedChild = useMemo(() => hasCurrentData ? children.find((child) => child.id === childId) ?? null : null, [children, childId, hasCurrentData])
  const childConsents = selectedChild ? consents[selectedChild.id] ?? [] : []
  const currentAssessmentConsent = childConsents.find((consent) => consent.valid && consent.scope === 'assessment')
  const currentPracticeConsent = childConsents.find((consent) => consent.valid && consent.scope === 'practice')
  const currentConsent = scope === 'practice' ? currentPracticeConsent : currentAssessmentConsent
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!repository || !selectedChild || !evidencePath.trim() || !expiresOn || !acknowledged || !isCurrent()) return
    const operationVersion = version
    setBusy(true)
    setNotice(null)
    setError(false)
    try {
      const consent = await repository.createConsent(selectedChild, evidencePath, expiryIso(expiresOn), scope)
      if (!isCurrent() || (repository.getVersion?.() ?? operationVersion) !== operationVersion) return
      setConsents((current) => ({ ...current, [selectedChild.id]: [consent, ...(current[selectedChild.id] ?? [])] }))
      setEvidencePath('')
      setAcknowledged(false)
      setNotice('saved')
    } catch (caught) {
      if (isCurrent() && !(caught instanceof Stage0RepositoryError && caught.issue === 'cancelled')) setError(true)
      setNotice(null)
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }
  const revoke = async () => {
    if (!repository || !currentConsent || !isCurrent()) return
    const operationVersion = version
    setBusy(true)
    setError(false)
    setNotice(null)
    try {
      const revoked = await repository.revokeConsent(currentConsent.id)
      if (!isCurrent() || (repository.getVersion?.() ?? operationVersion) !== operationVersion) return
      setConsents((current) => ({ ...current, [revoked.child_id]: (current[revoked.child_id] ?? []).map((consent) => consent.id === revoked.id ? revoked : consent) }))
      setNotice('revoked')
    } catch {
      if (isCurrent()) setError(true)
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }

  return (
    <WorkspaceShell id="consent-title" className="consent-workspace-shell" eyebrow="consentGuardianOnly" title="consentTitle" description="consentDescription" aside={<ConsentSidebar />}>
      <section className="consent-panel" aria-busy={busy}>
        {!repository && <p className="professional-notice" role="alert">{t('consentLoadError')}</p>}
        {loading && repository && <p role="status" aria-live="polite">{t('assessmentLoading')}</p>}
        {error && repository && <p className="professional-notice" role="alert">{t(notice === 'revoked' ? 'consentRevokeError' : notice === 'saved' ? 'consentSaveError' : 'consentLoadError')}</p>}
        {!loading && hasCurrentData && children.length === 0 && <p className="workspace-empty-state">{t('consentNoChildren')}</p>}
        {!loading && hasCurrentData && children.length > 0 && (
          <>
            <label className="assessment-field" htmlFor="consent-child">
              <span>{t('consentChooseChild')}</span>
              <select id="consent-child" value={childId} onChange={(event) => { setChildId(event.target.value); setNotice(null) }}>
                <option value="">{t('stage0ChooseChildPlaceholder')}</option>
                {children.map((child) => <option key={child.id} value={child.id}>{child.first_name}{child.is_demo ? ` — ${t('assessmentDemoLabel')}` : ''}</option>)}
              </select>
            </label>
            {selectedChild?.is_demo && <p className="fixture-notice">{t('consentSyntheticWarning')}</p>}
            <fieldset className="consent-scope-status">
              <legend>{t('consentScopeStatusTitle')}</legend>
              <p>{t('consentScopeAssessment')}: {currentAssessmentConsent ? t('consentScopeActive') : t('consentScopeMissing')}</p>
              <p>{t('consentScopePractice')}: {currentPracticeConsent ? t('consentScopeActive') : t('consentScopeMissing')}</p>
            </fieldset>
            {currentConsent && (
              <section className="consent-current" aria-labelledby="consent-current-title">
                <h3 id="consent-current-title">{t('consentCurrent')} — {scope === 'practice' ? t('consentScopePractice') : t('consentScopeAssessment')}</h3>
                <dl>
                  <div><dt>{t('consentSignedAt')}</dt><dd>{formatDate(currentConsent.signed_at, locale)}</dd></div>
                  <div><dt>{t('consentExpiresAt')}</dt><dd>{formatDate(currentConsent.expires_at, locale)}</dd></div>
                  <div><dt>{t('consentEvidence')}</dt><dd>{currentConsent.evidence_path}</dd></div>
                </dl>
                <button className="action-button" type="button" disabled={busy} onClick={() => { void revoke() }}>{t('consentRevoke')}</button>
              </section>
            )}
            <form className="consent-form" onSubmit={(event) => { void submit(event) }}>
              <fieldset className="assessment-field" id="consent-scope">
                <legend>{t('consentScopeLabel')}</legend>
                <label className="consent-checkbox" htmlFor="consent-scope-assessment">
                  <input id="consent-scope-assessment" type="radio" name="consent-scope" value="assessment" checked={scope === 'assessment'} onChange={() => setScope('assessment')} />
                  <span>{t('consentScopeAssessment')}</span>
                </label>
                <label className="consent-checkbox" htmlFor="consent-scope-practice">
                  <input id="consent-scope-practice" type="radio" name="consent-scope" value="practice" checked={scope === 'practice'} onChange={() => setScope('practice')} />
                  <span>{t('consentScopePractice')}</span>
                </label>
              </fieldset>
              <label className="assessment-field" htmlFor="consent-evidence">
                <span>{t('consentEvidenceLabel')}</span>
                <input id="consent-evidence" required maxLength={500} value={evidencePath} placeholder={t('consentEvidencePlaceholder')} onChange={(event) => setEvidencePath(event.target.value)} />
                <small>{t('consentEvidenceHelp')}</small>
              </label>
              <label className="assessment-field" htmlFor="consent-expires">
                <span>{t('consentExpiresLabel')}</span>
                <input id="consent-expires" required type="date" min={new Date().toISOString().slice(0, 10)} value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} />
              </label>
              <label className="consent-checkbox" htmlFor="consent-acknowledged">
                <input id="consent-acknowledged" type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
                <span>{t('consentAcknowledgement')}</span>
              </label>
              <button className="action-button" type="submit" disabled={busy || !selectedChild || !evidencePath.trim() || !expiresOn || !acknowledged}>
                {busy ? t('consentCapturing') : t('consentCapture')}
              </button>
            </form>
            {notice === 'saved' && <p className="professional-notice" role="status" aria-live="polite">{t('consentSaved')}</p>}
            {notice === 'revoked' && <p className="professional-notice" role="status" aria-live="polite">{t('consentRevoked')}</p>}
            <button className="action-button action-button-secondary" type="button" disabled={busy} onClick={() => { void load() }}>{t('consentReload')}</button>
          </>
        )}
      </section>
    </WorkspaceShell>
  )
}
