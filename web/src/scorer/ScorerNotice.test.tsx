import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { I18nProvider } from '../i18n/I18nProvider'
import { ar } from '../i18n/messages'
import { createTestAuth } from '../test/auth'
import { ScorerProvider } from './ScorerProvider'
import { ScorerFixtureNotice, ScorerNotice } from './ScorerNotice'
import { startScorerRuntime } from './runtime'

const signedIn = { status: 'signedIn' as const, role: 'specialist' as const, issue: null }
const signedOut = { status: 'signedOut' as const, role: null, issue: null }
const health = () => new Response(JSON.stringify({
  status: 'ok',
  model_loaded: true,
  model_version: 'synthetic-model',
  rules_version: 'synthetic-rules',
  contracts_version: 'synthetic-contracts',
}), { status: 200, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ScorerNotice', () => {
  it('shows mock status and fixture labeling to professional roles', async () => {
    const auth = createTestAuth(signedIn)
    const runtime = startScorerRuntime({}, auth.controller)
    render(
      <AuthProvider controller={auth.controller}>
        <I18nProvider allowEnglish={false}>
          <ScorerProvider runtime={runtime}>
            <MemoryRouter initialEntries={['/specialist']}>
              <ScorerNotice />
            </MemoryRouter>
          </ScorerProvider>
        </I18nProvider>
      </AuthProvider>,
    )
    expect(await screen.findByText(ar.scorerMockStatus)).toBeVisible()
    expect(screen.getByText(ar.scorerFixture)).toBeVisible()
    expect(screen.queryByText(ar.scorerReady)).not.toBeInTheDocument()
    runtime.dispose()
  })

  it.each([
    ['/guardian', 'guardian' as const],
    ['/child/', 'specialist' as const],
    ['/specialist', null],
  ])('suppresses notices for restricted route or auth state: %s', (path, role) => {
    const auth = createTestAuth(role ? { status: 'signedIn', role, issue: null } : signedOut)
    const runtime = startScorerRuntime({}, auth.controller)
    render(
      <AuthProvider controller={auth.controller}>
        <I18nProvider allowEnglish={false}>
          <ScorerProvider runtime={runtime}>
            <MemoryRouter initialEntries={[path]}><ScorerNotice /></MemoryRouter>
          </ScorerProvider>
        </I18nProvider>
      </AuthProvider>,
    )
    expect(screen.queryByRole('heading', { name: ar.scorerStatusTitle })).not.toBeInTheDocument()
    expect(screen.queryByText(ar.scorerFixture)).not.toBeInTheDocument()
    runtime.dispose()
  })

  it('renders no status when the existing tree has no ScorerProvider', () => {
    const auth = createTestAuth(signedIn)
    render(
      <AuthProvider controller={auth.controller}>
        <I18nProvider allowEnglish={false}>
          <MemoryRouter initialEntries={['/specialist']}><ScorerNotice /></MemoryRouter>
        </I18nProvider>
      </AuthProvider>,
    )
    expect(screen.queryByRole('heading', { name: ar.scorerStatusTitle })).not.toBeInTheDocument()
  })

  it('labels synthetic content in real mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => health()))
    const auth = createTestAuth(signedIn)
    const runtime = startScorerRuntime({
      VITE_SCORER_MODE: 'real',
      VITE_SCORER_URL: 'https://scorer.example',
    }, auth.controller)
    render(
      <AuthProvider controller={auth.controller}>
        <I18nProvider allowEnglish={false}>
          <ScorerProvider runtime={runtime}>
            <MemoryRouter initialEntries={['/specialist']}>
              <ScorerFixtureNotice synthetic />
            </MemoryRouter>
          </ScorerProvider>
        </I18nProvider>
      </AuthProvider>,
    )
    expect(await screen.findByText(ar.scorerFixture)).toBeVisible()
    runtime.dispose()
  })
})
