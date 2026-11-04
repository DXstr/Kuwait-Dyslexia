import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { useI18n } from '../i18n/context'
import { ParentReportDocument } from './ParentReportDocument'
import { useParentReportAccess } from './context'
import { ParentReportRepositoryError } from './types'
import type { GuardianReportRow } from './types'

function decodeReportId(value: string | undefined): string | null {
  if (!value) return null
  try {
    const decoded = decodeURIComponent(value)
    return decoded.length > 0 ? decoded : null
  } catch {
    return null
  }
}

export function ParentReportPrintRoute() {
  const { auth } = useAuth()
  const { t } = useI18n()
  const access = useParentReportAccess()
  const { reportId } = useParams<{ reportId: string }>()
  const [report, setReport] = useState<GuardianReportRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const mounted = useRef(true)
  const decodedReportId = decodeReportId(reportId)

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    if (!access || auth.status !== 'signedIn' || auth.role !== 'guardian' || !decodedReportId) {
      queueMicrotask(() => {
        if (!controller.signal.aborted && mounted.current) {
          setLoading(false)
          setMessage(t('parentReportUnavailable'))
        }
      })
      return () => { controller.abort(); mounted.current = false }
    }
    void access.repository.getGuardianReport(decodedReportId, controller.signal)
      .then((next) => { if (!controller.signal.aborted && mounted.current) setReport(next) })
      .catch((error: unknown) => {
        if (controller.signal.aborted || !mounted.current) return
        setMessage(t(error instanceof ParentReportRepositoryError && error.issue === 'forbidden' ? 'parentReportUnavailable' : 'parentReportLoadError'))
      })
      .finally(() => { if (!controller.signal.aborted && mounted.current) setLoading(false) })
    return () => { mounted.current = false; controller.abort() }
  }, [access, auth.role, auth.status, decodedReportId, t])

  if (loading) return <section className="parent-report-print-page" aria-busy="true"><p role="status">{t('parentReportLoading')}</p></section>
  if (!report || message) return <section className="parent-report-print-page"><p className="professional-notice" role="alert">{message ?? t('parentReportUnavailable')}</p><Link className="action-link" to="/guardian">{t('parentReportBack')}</Link></section>

  return (
    <section className="parent-report-print-page" aria-label={t('parentReportPrintPage')}>
      <div className="parent-report-print-controls">
        <button className="action-button" type="button" onClick={() => window.print()}>{t('parentReportSavePdf')}</button>
        <Link className="action-link" to="/guardian">{t('parentReportBack')}</Link>
      </div>
      <ParentReportDocument report={report.content} demo={report.child_is_demo} />
    </section>
  )
}
