import { useAuth } from '../../../auth/context'
import { useI18n } from '../../../i18n/context'
import { BrandMark, Button, Noor, Notice } from '../../core'
import { DemoAccess } from './DemoAccess'
import { coreCopy } from '../../core/copy'
import { DelightControls } from '../../delight'
import { landingCopy } from './copy'
import './landing.css'

function GoogleGlyph() {
  return (
    <svg className="landing-google-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M21.6 12.23c0-.72-.06-1.41-.19-2.08H12v3.94h5.38a4.6 4.6 0 0 1-1.99 3.02v2.5h3.22c1.89-1.74 2.99-4.3 2.99-7.38Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.61-2.39l-3.22-2.5c-.9.6-2.04.96-3.39.96-2.6 0-4.8-1.76-5.59-4.13H3.08v2.58A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.41 13.94A6 6 0 0 1 6.09 12c0-.67.12-1.32.32-1.94V7.48H3.08A10 10 0 0 0 2 12c0 1.62.39 3.15 1.08 4.52l3.33-2.58Z" />
      <path fill="#EA4335" d="M12 5.93c1.47 0 2.8.5 3.84 1.49l2.88-2.88C16.95 2.93 14.7 2 12 2a10 10 0 0 0-8.92 5.48l3.33 2.58C7.2 7.69 9.4 5.93 12 5.93Z" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg className="landing-arrow" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M3 10h13M11 4l6 6-6 6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  )
}

function AuthAction({ onGoogleSignIn }: { onGoogleSignIn: () => void }) {
  const { auth } = useAuth()
  const isBusy = auth.status === 'loading' || auth.status === 'redirecting'
  const isUnavailable = auth.status === 'unconfigured'
  const isSignedIn = auth.status === 'signedIn'
  const disabled = isBusy || isUnavailable || isSignedIn

  const label = isBusy
    ? (auth.status === 'redirecting' ? landingCopy.auth.redirecting : landingCopy.auth.loading)
    : isSignedIn
      ? landingCopy.auth.signedIn
      : landingCopy.hero.primaryAction

  return (
    <div className="landing-auth-action">
      <Button
        className="landing-google-button"
        disabled={disabled}
        aria-busy={isBusy}
        onClick={onGoogleSignIn}
      >
        <GoogleGlyph />
        <span>{label}</span>
      </Button>
      <p className="landing-auth-hint">{landingCopy.hero.signInHint}</p>
      <DemoAccess />
      {isUnavailable && (
        <p className="landing-auth-status" role="status">{landingCopy.auth.unavailable}</p>
      )}
      {auth.status === 'error' && (
        <p className="landing-auth-status" role="alert">
          {auth.issue === 'signIn' ? landingCopy.auth.signInError : landingCopy.auth.unavailable}
        </p>
      )}
    </div>
  )
}

function HeroScene() {
  return (
    <div className="landing-hero-scene" aria-label={landingCopy.hero.sceneLabel}>
      <img
        className="landing-hero-scenery"
        src="/brand/kuwait-scenery.webp"
        alt={landingCopy.hero.sceneryAlt}
        width="1920"
        height="823"
        decoding="async"
      />
      <div className="landing-scene-wash" aria-hidden="true" />
      <div className="landing-scene-card" aria-label={landingCopy.hero.sampleLabel}>
        <span className="landing-scene-card__dot" aria-hidden="true" />
        <span className="landing-scene-card__label">{landingCopy.hero.sampleLabel}</span>
        <p lang="ar" className="landing-reading-line">{landingCopy.hero.sampleText}</p>
        <p className="landing-reading-hint">{landingCopy.hero.sampleHint}</p>
      </div>
      <Noor
        className="landing-hero-noor"
        pose="reading"
        size="clamp(16rem, 29vw, 24rem)"
        alt={landingCopy.hero.noorAlt}
      />
      <span className="landing-scene-sun" aria-hidden="true" />
      <span className="landing-scene-stitch landing-scene-stitch--one" aria-hidden="true" />
      <span className="landing-scene-stitch landing-scene-stitch--two" aria-hidden="true" />
    </div>
  )
}

function HowItWorks() {
  return (
    <section className="landing-section landing-how" id="how-it-works" aria-labelledby="landing-how-title">
      <div className="landing-section-heading">
        <p className="landing-eyebrow">{landingCopy.howItWorks.eyebrow}</p>
        <h2 id="landing-how-title">{landingCopy.howItWorks.title}</h2>
        <p>{landingCopy.howItWorks.description}</p>
      </div>
      <ol className="landing-steps">
        {landingCopy.howItWorks.steps.map((step, index) => (
          <li className="landing-step" key={step.number}>
            <div className="landing-step__marker" aria-hidden="true">
              <span>{step.number}</span>
              {index < landingCopy.howItWorks.steps.length - 1 && <i />}
            </div>
            <div className="landing-step__body">
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function AudienceSection({
  eyebrow,
  title,
  body,
  note,
  action,
  id,
  tone,
}: {
  eyebrow: string
  title: string
  body: string
  note: string
  action: string
  id: string
  tone: 'family' | 'specialist'
}) {
  return (
    <section className={`landing-audience landing-audience--${tone}`} id={id} aria-labelledby={`${id}-title`}>
      <div className="landing-audience__art" aria-hidden="true">
        <span className="landing-audience__shape landing-audience__shape--back" />
        <span className="landing-audience__shape landing-audience__shape--front" />
        <span className="landing-audience__glyph">{tone === 'family' ? 'ب' : 'ن'}</span>
      </div>
      <div className="landing-audience__copy">
        <p className="landing-eyebrow">{eyebrow}</p>
        <h2 id={`${id}-title`}>{title}</h2>
        <p>{body}</p>
        <p className="landing-audience__note">{note}</p>
        <a className="landing-text-link" href="#how-it-works">
          <span>{action}</span>
          <ArrowIcon />
        </a>
      </div>
    </section>
  )
}

export function LandingExperience() {
  const { auth, controller } = useAuth()
  const { t } = useI18n()
  const authBusy = auth.status === 'loading' || auth.status === 'redirecting'
  const authUnavailable = auth.status === 'unconfigured' || auth.status === 'signedIn'
  const signIn = () => {
    void controller.signIn('google')
  }

  return (
    <div className="landing-page" dir="rtl" id="top">
      <a className="skip-link" href="#main-content">{t('skipToContent')}</a>
      <header className="landing-nav">
        <a className="landing-brand" href="#top" aria-label={coreCopy.brandAriaLabel}>
          <BrandMark size={38} />
        </a>
        <nav className="landing-nav__links" aria-label={landingCopy.navigation.label}>
          <a href="#how-it-works">{landingCopy.navigation.howItWorks}</a>
          <a href="#families">{landingCopy.navigation.forFamilies}</a>
          <a href="#specialists">{landingCopy.navigation.forSpecialists}</a>
        </nav>
        <DelightControls className="landing-nav__settings" compact />
        <a className="landing-nav__signin" href="#sign-in">{landingCopy.navigation.signIn}</a>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="landing-hero" aria-labelledby="landing-hero-title">
          <div className="landing-hero__copy">
            <p className="landing-eyebrow">{landingCopy.hero.eyebrow}</p>
            <h1 id="landing-hero-title">{landingCopy.hero.title}</h1>
            <p className="landing-hero__description">{landingCopy.hero.description}</p>
            <div className="landing-hero__actions" id="sign-in">
              <AuthAction onGoogleSignIn={signIn} />
              <a className="landing-discover-link" href="#how-it-works">
                <span>{landingCopy.hero.secondaryAction}</span>
                <ArrowIcon />
              </a>
            </div>
            <Notice className="landing-demo-notice" tone="neutral" title={landingCopy.demo.title}>
              {landingCopy.demo.body}
            </Notice>
          </div>
          <HeroScene />
        </section>

        <HowItWorks />

        <section className="landing-audiences" aria-label={landingCopy.audienceLabel}>
          <AudienceSection {...landingCopy.families} id="families" tone="family" />
          <AudienceSection {...landingCopy.specialists} id="specialists" tone="specialist" />
        </section>

        <section className="landing-closing" aria-labelledby="landing-closing-title">
          <div className="landing-closing__halo" aria-hidden="true" />
          <Noor pose="encouraging" size="clamp(8rem, 16vw, 13rem)" alt={landingCopy.closing.noorAlt} />
          <div className="landing-closing__copy">
            <p className="landing-eyebrow">{landingCopy.closing.eyebrow}</p>
            <h2 id="landing-closing-title">{landingCopy.closing.title}</h2>
            <p>{landingCopy.closing.body}</p>
            <Button
              className="landing-closing__button"
              disabled={authBusy || authUnavailable}
              aria-busy={authBusy}
              onClick={signIn}
            >
              <GoogleGlyph />
              <span>{landingCopy.closing.action}</span>
            </Button>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <BrandMark size={30} />
        <p>{landingCopy.footer}</p>
      </footer>
    </div>
  )
}

export default LandingExperience
