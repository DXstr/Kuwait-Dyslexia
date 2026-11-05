import type { ReactNode } from 'react'
import { BrandMark, Notice, SectionHeader } from '../../core'
import { guardianCopy } from './copy'
import './guardian.css'

type GuardianFamilyShellProps = {
  children: ReactNode
  loading?: boolean
  title?: string
  description?: string
  actions?: ReactNode
}

export function GuardianFamilyShell({
  actions,
  children,
  description = guardianCopy.reportsDescription,
  loading = false,
  title = guardianCopy.reportsTitle,
}: GuardianFamilyShellProps) {
  return (
    <section className="guardian-family noor-ui" dir="rtl" lang="ar" aria-busy={loading || undefined}>
      <div className="guardian-family__brand-row">
        <BrandMark name="بصيرة" size={38} />
        <p className="guardian-family__quiet-label">{guardianCopy.approvedOnly}</p>
      </div>
      <SectionHeader
        className="guardian-family__header"
        eyebrow={guardianCopy.reportsEyebrow}
        title={title}
        description={description}
        actions={actions}
        level={2}
      />
      <Notice className="guardian-family__notice" tone="positive" title={guardianCopy.familyPortal}>
        {guardianCopy.approvedOnly}
      </Notice>
      <div className="guardian-family__content">{children}</div>
    </section>
  )
}
