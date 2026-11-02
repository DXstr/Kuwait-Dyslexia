import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { useI18n } from '../i18n/context'
import type { MessageKey } from '../i18n/messages'
import { useScorer } from './context'
import type { ScorerPhase } from './runtime'

const statusMessages: Record<Exclude<ScorerPhase, 'idle'>, MessageKey> = {
  checking: 'scorerChecking',
  ready: 'scorerReady',
  warming: 'scorerWarming',
  degraded: 'scorerDegraded',
  unavailable: 'scorerUnavailable',
}

function canSeeScorerNotice(role: ReturnType<typeof useAuth>['auth']['role'], pathname: string) {
  if (pathname === '/child' || pathname.startsWith('/child/')) return false
  return role === 'specialist' || role === 'examiner' || role === 'admin'
}

export function ScorerFixtureNotice({ synthetic = false }: { synthetic?: boolean }) {
  const { auth } = useAuth()
  const { pathname } = useLocation()
  const scorer = useScorer()
  const { t } = useI18n()
  if (auth.status !== 'signedIn' || !canSeeScorerNotice(auth.role, pathname)) return null
  const mode = scorer?.scorer.mode ?? null
  if (mode !== 'mock' && synthetic !== true) return null
  return <p className="fixture-notice" role="status">{t('scorerFixture')}</p>
}

export function ScorerNotice() {
  const { auth } = useAuth()
  const { pathname } = useLocation()
  const scorer = useScorer()
  const { t } = useI18n()
  if (!scorer || auth.status !== 'signedIn' || !canSeeScorerNotice(auth.role, pathname)) return null
  const { phase, issue } = scorer.scorer
  if (phase === 'idle') return null
  const message = scorer.scorer.mode === 'mock'
    ? t('scorerMockStatus')
    : issue === 'configuration' && phase === 'unavailable'
      ? t('scorerConfiguration')
      : t(statusMessages[phase])
  const canRetry = scorer.scorer.mode === 'real' && issue !== 'configuration' &&
    (phase === 'warming' || phase === 'degraded' || phase === 'unavailable')
  return (
    <aside className="scorer-notice" aria-labelledby="scorer-status-title" aria-live="polite">
      <h2 id="scorer-status-title">{t('scorerStatusTitle')}</h2>
      <p>{message}</p>
      {canRetry && (
        <button className="action-button" type="button" onClick={() => { void scorer.runtime.retry() }}>
          {t('scorerRetry')}
        </button>
      )}
      <ScorerFixtureNotice />
    </aside>
  )
}
