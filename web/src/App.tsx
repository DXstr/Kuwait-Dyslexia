import type { ReactNode } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth/context'
import type { AuthIssue } from './auth/controller'
import { I18nProvider } from './i18n/I18nProvider'
import { useI18n } from './i18n/context'
import type { MessageKey } from './i18n/messages'
import { canAccess, canUseEnglish, roleHome } from './routing/roles'
import type { AppRole } from './routing/roles'

const authMessages: Record<AuthIssue, MessageKey> = {
  configuration: 'authConfiguration',
  unavailable: 'authUnavailable',
  callback: 'authCallbackError',
  session: 'authSessionError',
  profile: 'authProfileError',
  role: 'authRoleError',
  signIn: 'authSignInError',
  signOut: 'authSignOutError',
}

function Shell({ role, children }: { role: AppRole | null; children: ReactNode }) {
  const { t, locale, canSwitchLanguage, setLocale } = useI18n()
  const { controller } = useAuth()
  const { pathname } = useLocation()
  const isChildScreen = pathname === '/child'
  const homeLabel: MessageKey = role ? `${role}Title` : 'home'

  return (
    <div className={`app-shell${isChildScreen ? ' child-shell' : ''}`}>
      <a className="skip-link" href="#main-content">{t('skipToContent')}</a>
      <header className="app-header">
        <Link className="brand" to="/" aria-label={t('home')}>
          <img className="brand-mark" src="/icons/icon.svg" alt="" width="48" height="48" />
          <span className="brand-name">{t('appName')}</span>
        </Link>
        <div className="header-actions">
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

function AuthControls() {
  const { t } = useI18n()
  const { auth, controller } = useAuth()
  const unconfigured = auth.status === 'unconfigured'
  const disabled = unconfigured || !['signedOut', 'error'].includes(auth.status)
  const issue = unconfigured ? 'configuration' : auth.issue
  return (
    <section className="auth-panel" aria-labelledby="auth-sign-in-title">
      <h2 id="auth-sign-in-title">{t('authSignInTitle')}</h2>
      <p>{t('authSignInDescription')}</p>
      {issue && <p className="auth-notice" role="alert">{t(authMessages[issue])}</p>}
      <div className="oauth-actions">
        <button className="action-button" type="button" disabled={disabled} onClick={() => { void controller.signIn('google') }}>
          {t('authGoogle')}
        </button>
      </div>
      {issue && !unconfigured && (
        <button className="action-button" type="button" onClick={() => { void controller.retry() }}>{t('authRetry')}</button>
      )}
      <p className="auth-explanation">{t('authRoleProvisioning')}</p>
    </section>
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
  const { t } = useI18n()
  return (
    <>
      <section className="intro" aria-labelledby="welcome-title">
        <p className="eyebrow">{t('welcomeEyebrow')}</p>
        <h1 id="welcome-title">{t('welcomeTitle')}</h1>
        <p className="lead">{t('welcomeDescription')}</p>
      </section>
      <AuthControls />
      <section className="foundation-panel" aria-labelledby="foundation-title">
        <span className="status-note">{t('scaffoldBadge')}</span>
        <h2 id="foundation-title">{t('foundationTitle')}</h2>
        <p>{t('foundationDescription')}</p>
      </section>
      <div className="audience-panels">
        <section aria-labelledby="family-title">
          <h2 id="family-title">{t('familyTitle')}</h2>
          <p>{t('familyDescription')}</p>
        </section>
        <section aria-labelledby="professional-title">
          <h2 id="professional-title">{t('professionalTitle')}</h2>
          <p>{t('professionalDescription')}</p>
        </section>
      </div>
      <section className="before-starting" aria-labelledby="before-starting-title">
        <h2 id="before-starting-title">{t('beforeStartingTitle')}</h2>
        <ul>
          <li>{t('signInPending')}</li>
          <li>{t('consentPending')}</li>
          <li>{t('reviewPending')}</li>
        </ul>
      </section>
    </>
  )
}

function OAuthCallback({ role }: { role: AppRole | null }) {
  const { t } = useI18n()
  if (role) return <Navigate to={roleHome[role]} replace />
  return (
    <>
      <section className="intro">
        <h1>{t('authCallbackTitle')}</h1>
        <p className="lead">{t('authCallbackDescription')}</p>
        <Link className="action-link" to="/">{t('backHome')}</Link>
      </section>
      <AuthControls />
    </>
  )
}

function Workspace({ title, description }: { title: MessageKey; description: MessageKey }) {
  const { t } = useI18n()
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

export function AppRoutes() {
  const { auth } = useAuth()
  const role = auth.status === 'signedIn' ? auth.role : null
  const { pathname } = useLocation()
  const pending = auth.status === 'loading' || auth.status === 'redirecting'
  return (
    <I18nProvider allowEnglish={canUseEnglish(role, pathname)}>
      <Shell role={role}>
        {pending ? <AuthProgress /> : (
          <Routes>
            <Route path="/" element={role ? <Navigate to={roleHome[role]} replace /> : <Home />} />
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
            <Route path="/guardian" element={
              <RequireRole role={role} allowed={['guardian']}>
                <Workspace title="guardianTitle" description="guardianDescription" />
              </RequireRole>
            } />
            <Route path="/admin" element={
              <RequireRole role={role} allowed={['admin']}>
                <Workspace title="adminTitle" description="adminDescription" />
              </RequireRole>
            } />
            <Route path="/child" element={
              <RequireRole role={role} allowed={['specialist', 'examiner']}>
                <Workspace title="childTitle" description="childDescription" />
              </RequireRole>
            } />
            <Route path="*" element={<NotFound />} />
          </Routes>
        )}
      </Shell>
    </I18nProvider>
  )
}
