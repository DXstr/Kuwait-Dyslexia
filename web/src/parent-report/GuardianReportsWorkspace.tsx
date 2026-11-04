import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { useI18n } from '../i18n/context'
import { ParentReportRepositoryError } from './types'
import { useParentReportAccess } from './context'
import { ParentReportDocument } from './ParentReportDocument'
import type { GuardianReportRow } from './types'

function isAbort(error: unknown) {
  return error instanceof ParentReportRepositoryError && error.issue === 'cancelled'
}

export function GuardianReportsWorkspace() {
  const { auth } = useAuth()
  const { t } = useI18n()
  const access = useParentReportAccess()
  const [reports, setReports] = useState<GuardianReportRow[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const mounted = useRef(true)
  const loadAbort = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    if (!access || auth.status !== 'signedIn' || auth.role !== 'guardian') return
    loadAbort.current?.abort()
    const controller = new AbortController()
    loadAbort.current = controller
    setLoading(true)
    setMessage(null)
    try {
      const rows = await access.repository.listGuardianReports(controller.signal)
      if (!controller.signal.aborted && mounted.current && loadAbort.current === controller) setReports(rows)
    } catch (error) {
      if (!isAbort(error) && mounted.current && loadAbort.current === controller) {
        setReports([])
        setMessage(t(error instanceof ParentReportRepositoryError && error.issue === 'forbidden' ? 'parentReportUnavailable' : 'parentReportLoadError'))
      }
    } finally {
      if (!controller.signal.aborted && mounted.current && loadAbort.current === controller) {
        loadAbort.current = null
        setLoading(false)
      }
    }
  }, [access, auth.role, auth.status, t])

  useEffect(() => {
    mounted.current = true
    queueMicrotask(() => { void load() })
    return () => {
      mounted.current = false
      loadAbort.current?.abort()
      loadAbort.current = null
    }
  }, [load])

  if (!access) return <p className="professional-notice" role="status">{t('parentReportUnavailable')}</p>
  if (loading) return <p role="status" aria-live="polite">{t('parentReportLoading')}</p>
  if (message) return <p className="professional-notice" role="alert">{message}</p>
  if (reports.length === 0) return <p className="review-empty">{t('parentReportNone')}</p>

  return (
    <section className="parent-reports-workspace" aria-labelledby="parent-reports-heading">
      <div className="parent-reports-toolbar">
        <h2 id="parent-reports-heading">{t('parentReportAvailable')}</h2>
        <button className="action-button" type="button" onClick={() => { void load() }}>{t('parentReportReload')}</button>
      </div>
      <div className="parent-reports-list">
        {reports.map((row) => (
          <article className="parent-report-card" key={row.id}>
            <ParentReportDocument report={row.content} demo={row.child_is_demo} />
            <Link className="action-button parent-report-print-link" to={`/guardian/reports/${encodeURIComponent(row.id)}/print`}>{t('parentReportPrint')}</Link>
          </article>
        ))}
      </div>
    </section>
  )
}
