import type { ReactNode } from 'react'
import { useAuth } from '../../../auth/context'
import { useI18n } from '../../../i18n/context'
import { BrandMark, Notice } from '../../core'
import './specialist.css'

export type SpecialistSection = 'review' | 'prove' | 'map'

type SpecialistCopy = {
  eyebrow: string
  title: string
  description: string
  navigation: string
  review: string
  prove: string
  map: string
  guard: string
  guardDescription: string
  provenance: string
}

const copy: Record<'ar' | 'en', SpecialistCopy> = {
  ar: {
    eyebrow: 'مساحة الاختصاصي',
    title: 'لوحة المراجعة والمتابعة',
    description: 'مكتب هادئ لمراجعة الأدلة المحفوظة، واعتماد الخطط والتقارير، ومتابعة ما يحتاج إلى قرار اختصاصي.',
    navigation: 'أقسام مساحة الاختصاصي',
    review: 'مراجعة الجلسات',
    prove: 'إثبات نقل التعلّم',
    map: 'خريطة التقدّم',
    guard: 'مساحة الاختصاصي فقط',
    guardDescription: 'تُفتح هذه المساحة للحساب الموثّق ذي دور الاختصاصي فقط.',
    provenance: 'البيانات الخام والنتائج غير المعتمدة تبقى داخل هذه المساحة المهنية.',
  },
  en: {
    eyebrow: 'Specialist workspace',
    title: 'Review and follow-up cockpit',
    description: 'A focused desk for reviewing stored evidence, approving plans and reports, and recording specialist decisions.',
    navigation: 'Specialist workspace sections',
    review: 'Session review',
    prove: 'Transfer probe',
    map: 'Learning map',
    guard: 'Specialist workspace only',
    guardDescription: 'This workspace opens only for a verified account with the specialist role.',
    provenance: 'Raw evidence and unapproved results remain inside this professional workspace.',
  },
}

function isSpecialist(auth: ReturnType<typeof useAuth>['auth']) {
  return auth.status === 'signedIn' && auth.role === 'specialist'
}

export function SpecialistAccessNotice() {
  const { t } = useI18n()
  return (
    <section className="specialist-access specialist-module" aria-labelledby="specialist-access-title">
      <Notice tone="neutral" title={t('reviewSpecialistOnly')}>
        <p id="specialist-access-title">{t('reviewSpecialistOnly')}</p>
      </Notice>
    </section>
  )
}

export function SpecialistRoleWrapper({ children }: { children: ReactNode }) {
  const { auth } = useAuth()
  return isSpecialist(auth) ? <>{children}</> : <SpecialistAccessNotice />
}

export function SpecialistWorkspaceShell({
  activeSection,
  children,
  title,
  description,
  showHeader = true,
}: {
  activeSection: SpecialistSection
  children: ReactNode
  title?: ReactNode
  description?: ReactNode
  showHeader?: boolean
}) {
  const { auth } = useAuth()
  const { locale } = useI18n()
  const labels = copy[locale]

  if (!isSpecialist(auth)) return <SpecialistAccessNotice />

  return (
    <section className="specialist-cockpit noor-ui" dir={locale === 'en' ? 'ltr' : 'rtl'} aria-labelledby={showHeader ? 'specialist-cockpit-title' : undefined} aria-label={!showHeader ? labels.title : undefined}>
      <aside className="specialist-cockpit__rail" aria-label={labels.navigation}>
        <BrandMark className="specialist-cockpit__brand" size={42} />
        <div className="specialist-cockpit__rail-copy">
          <p className="specialist-cockpit__eyebrow">{labels.eyebrow}</p>
          <p>{labels.provenance}</p>
        </div>
        <nav className="specialist-cockpit__nav" aria-label={labels.navigation}>
          <a className={activeSection === 'review' ? 'is-active' : undefined} aria-current={activeSection === 'review' ? 'page' : undefined} href="#review-workspace">{labels.review}</a>
          <a className={activeSection === 'prove' ? 'is-active' : undefined} aria-current={activeSection === 'prove' ? 'page' : undefined} href="#prove-workspace">{labels.prove}</a>
          <a className={activeSection === 'map' ? 'is-active' : undefined} aria-current={activeSection === 'map' ? 'page' : undefined} href="#learning-map-workspace">{labels.map}</a>
        </nav>
        <div className="specialist-cockpit__rail-status" role="note">
          <span className="specialist-cockpit__status-dot" aria-hidden="true" />
          <span>{labels.guard}</span>
        </div>
      </aside>
      <div className="specialist-cockpit__main">
        {showHeader && <header className="specialist-cockpit__header">
          <div>
            <p className="specialist-cockpit__eyebrow">{labels.eyebrow}</p>
            <h1 id="specialist-cockpit-title">{title ?? labels.title}</h1>
            <p>{description ?? labels.description}</p>
          </div>
          <span className="specialist-cockpit__role-badge">{labels.guard}</span>
        </header>}
        {children}
      </div>
    </section>
  )
}
