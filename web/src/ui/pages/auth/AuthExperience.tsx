import type { ReactNode } from 'react'
import { useAuth } from '../../../auth/context'
import { BrandMark, Button, Notice, Surface } from '../../core'
import { authCopy, authIssueCopy } from './copy'
import './auth.css'

export type AuthExperienceProps = {
  /** Allows the integrator to keep a stable labelled-by target when several auth surfaces exist. */
  headingId?: string
  className?: string
}

function GoogleMark(): ReactNode {
  return (
    <svg
      className="basira-auth__google-mark"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="#4285F4" d="M21.35 12.27c0-.76-.07-1.5-.22-2.2H12v4.16h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.7 2.91-4.2 2.91-7.35Z" />
      <path fill="#34A853" d="M12 21.75c2.63 0 4.84-.87 6.45-2.37l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.3v2.53A9.74 9.74 0 0 0 12 21.75Z" />
      <path fill="#FBBC05" d="M6.54 13.82a5.86 5.86 0 0 1 0-3.64V7.65H3.3a9.75 9.75 0 0 0 0 8.7l3.24-2.53Z" />
      <path fill="#EA4335" d="M12 6.15c1.44 0 2.73.5 3.75 1.49l2.81-2.81C16.84 3.27 14.63 2.25 12 2.25a9.74 9.74 0 0 0-8.7 5.4l3.24 2.53C7.31 7.87 9.46 6.15 12 6.15Z" />
    </svg>
  )
}

function joinClasses(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(' ')
}

export function AuthExperience({ className, headingId = 'basira-auth-title' }: AuthExperienceProps) {
  const { auth, controller } = useAuth()
  const waiting = auth.status === 'loading' || auth.status === 'redirecting'
  const configurationIssue = auth.status === 'unconfigured' || auth.issue === 'configuration'
  const issueMessage = auth.issue ? authIssueCopy[auth.issue] : null
  const canStart = auth.status === 'signedOut' || (auth.status === 'error' && !configurationIssue)

  return (
    <div
      className={joinClasses('noor-ui', 'basira-auth', className)}
      aria-labelledby={headingId}
      aria-busy={waiting}
    >
      <div className="basira-auth__frame">
        <Surface className="basira-auth__card">
          <header className="basira-auth__header">
            <BrandMark size={52} />
            <p className="basira-auth__eyebrow">{authCopy.eyebrow}</p>
            <h1 id={headingId}>{authCopy.title}</h1>
            <p className="basira-auth__description">{authCopy.description}</p>
          </header>

          <div className="basira-auth__content">
            {configurationIssue && (
              <Notice tone="caution" title={authCopy.configurationTitle} role="alert">
                {authCopy.configurationBody}
              </Notice>
            )}

            {auth.status === 'error' && !configurationIssue && issueMessage && (
              <Notice tone="caution" title={authCopy.errorTitle} role="alert">
                {issueMessage}
              </Notice>
            )}

            {waiting && (
              <Notice
                title={auth.status === 'redirecting' ? authCopy.redirectingTitle : authCopy.loadingTitle}
                role="status"
                aria-live="polite"
              >
                <span className="basira-auth__waiting-row">
                  <span className="basira-auth__waiting-dot" aria-hidden="true" />
                  {auth.status === 'redirecting' ? authCopy.redirectingBody : authCopy.loadingBody}
                </span>
              </Notice>
            )}

            {auth.status === 'signedIn' && (
              <Notice tone="positive" title={authCopy.signedInTitle} role="status">
                {authCopy.signedInBody}
              </Notice>
            )}

              <Button
                className="basira-auth__google-button"
                variant="gold"
                type="button"
                disabled={!canStart}
                onClick={() => { void controller.signIn('google') }}
              >
                <span className="basira-auth__google-icon"><GoogleMark /></span>
                <span>{authCopy.googleAction}</span>
              </Button>

            {auth.status === 'error' && !configurationIssue && (
              <Button
                className="basira-auth__retry-button"
                variant="outline"
                type="button"
                onClick={() => { void controller.retry() }}
              >
                {authCopy.retry}
              </Button>
            )}

            {auth.status === 'signedIn' && (
              <Button
                className="basira-auth__retry-button"
                variant="outline"
                type="button"
                onClick={() => { void controller.signOut() }}
              >
                {authCopy.signOut}
              </Button>
            )}

            <p className="basira-auth__role-note">{authCopy.roleNote}</p>
          </div>

          <aside className="basira-auth__privacy" aria-labelledby={`${headingId}-privacy`}>
            <h2 id={`${headingId}-privacy`}>{authCopy.privacyTitle}</h2>
            <p>{authCopy.privacyBody}</p>
            <p>{authCopy.consentBody}</p>
          </aside>
        </Surface>
      </div>
    </div>
  )
}
