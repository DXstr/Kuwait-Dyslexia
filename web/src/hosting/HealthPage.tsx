import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/context'

export function HealthPage() {
  const { t } = useI18n()

  return (
    <section className="health-page" aria-labelledby="health-title">
      <p className="eyebrow">{t('healthPageKicker')}</p>
      <h1 id="health-title">{t('healthPageTitle')}</h1>
      <p className="lead">{t('healthPageDescription')}</p>
      <div className="health-status" role="status" aria-live="polite">
        <span className="status-note">{t('healthPageStatus')}</span>
        <p>{t('healthPageScope')}</p>
      </div>
      <Link className="action-link" to="/">{t('backHome')}</Link>
    </section>
  )
}
