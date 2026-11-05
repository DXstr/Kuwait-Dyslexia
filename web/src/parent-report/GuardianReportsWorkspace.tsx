import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../ui/core'
import { useAuth } from '../auth/context'
import { ParentReportRepositoryError } from './types'
import { useParentReportAccess } from './context'
import { ParentReportDocument } from './ParentReportDocument'
import type { GuardianReportRow } from './types'
import { GuardianFamilyShell } from '../ui/pages/guardian/GuardianFamilyShell'
import { guardianCopy } from '../ui/pages/guardian/copy'

function isAbort(error: unknown) {
  return error instanceof ParentReportRepositoryError && error.issue === 'cancelled'
}

function isPublished(row: GuardianReportRow) {
  return row.review_status === 'approved' || row.review_status === 'delivered'
}

export function GuardianReportsWorkspace() {
  const { auth } = useAuth()
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
      if (!controller.signal.aborted && mounted.current && loadAbort.current === controller) {
        setReports(rows.filter(isPublished))
      }
    } catch (error) {
      if (!isAbort(error) && mounted.current && loadAbort.current === controller) {
        setReports([])
        setMessage(error instanceof ParentReportRepositoryError && error.issue === 'forbidden' ? guardianCopy.unavailable : guardianCopy.loadError)
      }
    } finally {
      if (!controller.signal.aborted && mounted.current && loadAbort.current === controller) {
        loadAbort.current = null
        setLoading(false)
      }
    }
  }, [access, auth.role, auth.status])

  useEffect(() => {
    mounted.current = true
    queueMicrotask(() => { void load() })
    return () => {
      mounted.current = false
      loadAbort.current?.abort()
      loadAbort.current = null
    }
  }, [load])

  const refreshAction = (
    <Button className="guardian-family__toolbar-button" variant="soft" type="button" onClick={() => { void load() }}>
      {guardianCopy.reload}
    </Button>
  )

  if (!access) {
    return (
      <GuardianFamilyShell>
        <div className="guardian-family__state" role="alert">
          <h3 className="guardian-family__empty-title">{guardianCopy.unavailable}</h3>
        </div>
      </GuardianFamilyShell>
    )
  }

  if (loading) {
    return (
      <GuardianFamilyShell loading>
        <div className="guardian-family__state" role="status" aria-live="polite">
          <p className="guardian-family__state-description">{guardianCopy.loading}</p>
        </div>
      </GuardianFamilyShell>
    )
  }

  if (message) {
    return (
      <GuardianFamilyShell actions={refreshAction}>
        <div className="guardian-family__state" role="alert">
          <h3 className="guardian-family__empty-title">{message}</h3>
          <p className="guardian-family__state-description">{guardianCopy.approvedOnly}</p>
        </div>
      </GuardianFamilyShell>
    )
  }

  if (reports.length === 0) {
    return (
      <GuardianFamilyShell actions={refreshAction}>
        <div className="guardian-family__empty">
          <h3 className="guardian-family__empty-title">{guardianCopy.emptyTitle}</h3>
          <p className="guardian-family__empty-description">{guardianCopy.emptyDescription}</p>
          <ol className="guardian-family__steps" aria-label={guardianCopy.stepsLabel}>
            <li className="guardian-family__step">{guardianCopy.emptyStepReview}</li>
            <li className="guardian-family__step">{guardianCopy.emptyStepApprove}</li>
            <li className="guardian-family__step">{guardianCopy.emptyStepReady}</li>
          </ol>
        </div>
      </GuardianFamilyShell>
    )
  }

  return (
    <GuardianFamilyShell actions={refreshAction}>
      <div className="guardian-family__toolbar">
        <div>
          <h3 className="guardian-family__toolbar-title">{guardianCopy.availableTitle}</h3>
          <p className="guardian-family__toolbar-note">{guardianCopy.approvedOnly}</p>
        </div>
      </div>
      <div className="guardian-family__reports">
        {reports.map((row) => (
          <article className="guardian-family__report-card" key={row.id}>
            <header className="guardian-family__report-card-header">
              <div>
                <p className="guardian-family__report-card-kicker">{guardianCopy.reportCardEyebrow}</p>
                <h3 className="guardian-family__report-card-title">{row.child_first_name}</h3>
              </div>
              <span className="guardian-family__approved-status">
                {row.review_status === 'delivered' ? guardianCopy.delivered : guardianCopy.approved}
              </span>
            </header>
            <ParentReportDocument report={row.content} demo={row.child_is_demo} headingId={`parent-report-heading-${row.id}`} />
            <div className="guardian-family__card-actions">
              <Link className="guardian-family__print-link" to={`/guardian/reports/${encodeURIComponent(row.id)}/print`}>
                {guardianCopy.openPrint}
              </Link>
            </div>
          </article>
        ))}
      </div>
    </GuardianFamilyShell>
  )
}
