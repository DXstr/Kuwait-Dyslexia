import type { ReactNode } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth/context'
import { I18nProvider } from './i18n/I18nProvider'
import { useI18n } from './i18n/context'
import type { MessageKey } from './i18n/messages'
import { canAccess, canUseEnglish, roleHome } from './routing/roles'
import type { AppRole } from './routing/roles'
import { ScorerNotice } from './scorer/ScorerNotice'
import { ChildAssessmentScreen, SpecialistAssessmentPanel } from './assessment/AssessmentPanels'
import { useAssessment } from './assessment/context'
import { ReviewWorkspace } from './review/ReviewWorkspace'
import { ProgressWorkspace } from './learning-map/ProgressWorkspace'
import { GuardianReportsWorkspace } from './parent-report/GuardianReportsWorkspace'
import { ParentReportPrintRoute } from './parent-report/ParentReportPrintRoute'
import { HealthPage } from './hosting/HealthPage'
import { ConsentWorkspace } from './stage0/ConsentWorkspace'
import { Stage0Workspace } from './stage0/Stage0Workspace'
import { ProbeWorkspace } from './prove/ProbeWorkspace'
import { TeachWorkspace } from './teach/TeachWorkspace'
import { BrandMark } from './ui/core'
import { DelightControls, DelightProvider } from './ui/delight'
import { AuthExperience } from './ui/pages/auth'
import { LandingExperience } from './ui/pages/landing'
import { SpecialistWorkspaceShell } from './ui/pages/specialist/SpecialistShell'

function Shell({ role, children }: { role: AppRole | null; children: ReactNode }) {
  const { t, locale, canSwitchLanguage, setLocale } = useI18n()
  const { controller } = useAuth()
  const { pathname } = useLocation()
  const isChildScreen = pathname === '/child'
  const isPublicLanding = pathname === '/' && !role
  const homeLabel: MessageKey = role ? `${role}Title` : 'home'

  if (isPublicLanding) return <>{children}</>

  return (
    <div className={`app-shell premium-shell${isChildScreen ? ' child-shell' : ''}`}>
      <a className="skip-link" href="#main-content">{t('skipToContent')}</a>
      <header className="app-header">
        <Link className="brand" to="/" aria-label={t('home')}>
          <BrandMark name={t('appName')} size={48} />
        </Link>
        <div className="header-actions">
          <DelightControls className="app-delight-controls" />
          {canSwitchLanguage && (
            <button
              className="language-switch"
              type="button"
              aria-label={t('languageSwitch')}
              onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
            >
              <span lang={locale === 'ar' ? 'en' : 'ar'} dir={locale === 'ar' ? 'ltr' : 'rtl'}>
                {t(locale === 'ar' ? 'switchToEnglish' : 'switchToArabic')}
              </span>
            </button>
          )}
          {role && !isChildScreen && (
            <button className="action-button" type="button" onClick={() => { void controller.signOut() }}>
              {t('authSignOut')}
            </button>
          )}
        </div>
      </header>
      <ScorerNotice />
      {role && !isChildScreen && (
        <nav className="workspace-nav" aria-label={t('navigation')}>
          <NavLink to={roleHome[role]}>{t(homeLabel)}</NavLink>
          {(role === 'specialist' || role === 'examiner') && (
            <NavLink to="/child">{t('childNavigation')}</NavLink>
          )}
        </nav>
      )}
      <main id="main-content" tabIndex={-1}>{children}</main>
      <footer className="app-footer">{t('footer')}</footer>
    </div>
  )
}

function AuthProgress() {
  const { auth } = useAuth()
  const { t } = useI18n()
  const redirecting = auth.status === 'redirecting'
  return (
    <section className="intro" role="status" aria-live="polite" aria-busy="true">
      <h1>{t(redirecting ? 'authRedirectingTitle' : 'authLoadingTitle')}</h1>
      <p className="lead">{t(redirecting ? 'authRedirectingDescription' : 'authLoadingDescription')}</p>
    </section>
  )
}

function Home() {
  return <LandingExperience />
}

function OAuthCallback({ role }: { role: AppRole | null }) {
  if (role) return <Navigate to={roleHome[role]} replace />
  return <AuthExperience className="auth-callback-experience" />
}

function Workspace({ title, description }: { title: MessageKey; description: MessageKey }) {
  const { t } = useI18n()
  const assessment = useAssessment()
  if (title === 'examinerTitle') return <>
    <section className="intro" aria-labelledby="workspace-title">
      <p className="status-note">{t('scaffoldBadge')}</p>
      <h1 id="workspace-title">{t(title)}</h1>
      <p className="lead">{t(description)}</p>
    </section>
    <Stage0Workspace />
  </>
  if (title === 'specialistTitle') return <SpecialistWorkspaceShell activeSection="review" showHeader={false}>
    {assessment ? <SpecialistAssessmentPanel /> : (
      <section className="intro" aria-labelledby="workspace-title">
        <p className="status-note">{t('scaffoldBadge')}</p>
        <h1 id="workspace-title">{t(title)}</h1>
        <p className="lead">{t(description)}</p>
      </section>
    )}
    <ReviewWorkspace />
    <ProbeWorkspace />
    <ProgressWorkspace />
  </SpecialistWorkspaceShell>
  if (title === 'guardianTitle') return <>
    <section className="intro" aria-labelledby="workspace-title">
      <p className="status-note">{t('parentReportGuardianBadge')}</p>
      <h1 id="workspace-title">{t(title)}</h1>
      <p className="lead">{t(description)}</p>
    </section>
    <GuardianReportsWorkspace />
  </>
  return (
    <>
      <section className="intro" aria-labelledby="workspace-title">
        <p className="status-note">{t('scaffoldBadge')}</p>
        <h1 id="workspace-title">{t(title)}</h1>
        <p className="lead">{t(description)}</p>
      </section>
      <section className="foundation-panel" aria-labelledby="no-session-title">
        <h2 id="no-session-title">{t('noSessionTitle')}</h2>
        <p>{t('noSessionDescription')}</p>
      </section>
    </>
  )
}

function Unavailable({ role }: { role: AppRole }) {
  const { t } = useI18n()
  return (
    <section className="intro">
      <h1>{t('unavailableTitle')}</h1>
      <p className="lead">{t('unavailableDescription')}</p>
      <Link className="action-link" to={roleHome[role]}>{t('backToWorkspace')}</Link>
    </section>
  )
}

function RequireRole({ role, allowed, children }: { role: AppRole | null; allowed: readonly AppRole[]; children: ReactNode }) {
  // These are navigation guards. Supabase RLS/triggers remain the authorization
  // boundary. The role is supplied only by the server-verified auth controller.
  if (!role) return <Navigate to="/" replace />
  if (!canAccess(role, allowed)) return <Unavailable role={role} />
  return children
}

function NotFound() {
  const { t } = useI18n()
  return (
    <section className="intro">
      <h1>{t('notFoundTitle')}</h1>
      <p className="lead">{t('notFoundDescription')}</p>
      <Link className="action-link" to="/">{t('backHome')}</Link>
    </section>
  )
}

function ChildRoute() {
  const assessment = useAssessment()
  if (assessment?.activeSession?.type === 'assessment') return <ChildAssessmentScreen />
  return <TeachWorkspace />
}

function AppRoutesContent() {
  const { auth } = useAuth()
  const role = auth.status === 'signedIn' ? auth.role : null
  const { pathname } = useLocation()
  const pending = auth.status === 'loading' || auth.status === 'redirecting'
  return (
    <I18nProvider allowEnglish={canUseEnglish(role, pathname)}>
      <Shell role={role}>
        {pending && pathname !== '/health' ? <AuthProgress /> : (
          <Routes>
            <Route path="/" element={role ? <Navigate to={roleHome[role]} replace /> : <Home />} />
            <Route path="/health" element={<HealthPage />} />
            <Route path="/auth/callback" element={<OAuthCallback role={role} />} />
            <Route path="/specialist" element={
              <RequireRole role={role} allowed={['specialist']}>
                <Workspace title="specialistTitle" description="specialistDescription" />
              </RequireRole>
            } />
            <Route path="/examiner" element={
              <RequireRole role={role} allowed={['examiner']}>
                <Workspace title="examinerTitle" description="examinerDescription" />
              </RequireRole>
            } />
            <Route path="/examiner/stage0" element={
              <RequireRole role={role} allowed={['examiner']}>
                <Stage0Workspace />
              </RequireRole>
            } />
            <Route path="/guardian" element={
              <RequireRole role={role} allowed={['guardian']}>
                <Workspace title="guardianTitle" description="guardianDescription" />
              </RequireRole>
            } />
            <Route path="/guardian/reports/:reportId/print" element={
              <RequireRole role={role} allowed={['guardian']}>
                <ParentReportPrintRoute />
              </RequireRole>
            } />
            <Route path="/guardian/consent" element={
              <RequireRole role={role} allowed={['guardian']}>
                <ConsentWorkspace />
              </RequireRole>
            } />
            <Route path="/admin" element={
              <RequireRole role={role} allowed={['admin']}>
                <Workspace title="adminTitle" description="adminDescription" />
              </RequireRole>
            } />
            <Route path="/child" element={
              <RequireRole role={role} allowed={['specialist', 'examiner']}>
                <ChildRoute />
              </RequireRole>
            } />
            <Route path="*" element={<NotFound />} />
          </Routes>
        )}
      </Shell>
    </I18nProvider>
  )
}

export function AppRoutes() {
  return (
    <DelightProvider>
      <AppRoutesContent />
    </DelightProvider>
  )
}
