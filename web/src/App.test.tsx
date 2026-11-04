import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from './App'
import { AuthProvider } from './auth/AuthProvider'
import type { AuthSnapshot } from './auth/controller'
import { ar, en } from './i18n/messages'
import type { MessageKey } from './i18n/messages'
import { roleHome } from './routing/roles'
import type { AppRole } from './routing/roles'
import { createTestAuth } from './test/auth'

function renderAuth(path: string, fixture: ReturnType<typeof createTestAuth>) {
  const router = createMemoryRouter(
    [{ path: '*', element: <AppRoutes /> }],
    { initialEntries: [path] },
  )
  render(<AuthProvider controller={fixture.controller}><RouterProvider router={router} /></AuthProvider>)
  return router
}

function renderApp(path = '/', role: AppRole | null = null) {
  return renderAuth(path, createTestAuth({
    status: role ? 'signedIn' : 'unconfigured', role, issue: role ? null : 'configuration',
  }))
}

const workspaces: { role: AppRole; title: MessageKey }[] = [
  { role: 'guardian', title: 'guardianTitle' },
  { role: 'specialist', title: 'specialistTitle' },
  { role: 'examiner', title: 'examinerTitle' },
  { role: 'admin', title: 'adminTitle' },
]

const paths = ['/guardian', '/specialist', '/examiner', '/admin', '/child']

describe('Arabic-first scaffold', () => {
  it('renders Arabic sign-in controls that stay disabled without configuration', () => {
    renderApp()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ar.welcomeTitle)
    expect(screen.getByText(ar.scaffoldBadge)).toBeVisible()
    expect(screen.getByText(ar.foundationDescription)).toBeVisible()
    expect(document.documentElement).toHaveAttribute('lang', 'ar')
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
    expect(document.title).toBe(ar.appTitle)
    expect(screen.getByRole('button', { name: ar.authGoogle })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Microsoft|مايكروسوفت/i })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(ar.authConfiguration)
    expect(screen.getByRole('link', { name: ar.skipToContent })).toHaveAttribute('href', '#main-content')
  })

  it('renders an Arabic not-found page', () => {
    renderApp('/does-not-exist')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ar.notFoundTitle)
    expect(screen.getByRole('link', { name: ar.backHome })).toHaveAttribute('href', '/')
  })

  it('keeps the public health page available while auth is loading', () => {
    renderAuth('/health', createTestAuth({ status: 'loading', role: null, issue: null }))
    expect(screen.getByRole('heading', { name: ar.healthPageTitle })).toBeVisible()
    expect(screen.queryByRole('heading', { name: ar.authLoadingTitle })).not.toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
  })

  it('does not accept role or language from browser storage or the URL', async () => {
    localStorage.setItem('app_role', 'specialist')
    localStorage.setItem('locale', 'en')
    const router = renderApp('/specialist?role=specialist&locale=en')
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(ar.welcomeTitle)
    expect(router.state.location.pathname).toBe('/')
    expect(document.documentElement).toHaveAttribute('lang', 'ar')
    localStorage.clear()
  })
})

describe('role routing (navigation only, not database authorization)', () => {
  it.each(paths)('sends an unauthenticated visit to %s back to the public shell', async (path) => {
    const router = renderApp(path)
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(ar.welcomeTitle)
    expect(router.state.location.pathname).toBe('/')
  })

  it.each(workspaces)('routes $role to its own workspace', async ({ role, title }) => {
    const router = renderApp('/', role)
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(ar[title])
    expect(router.state.location.pathname).toBe(roleHome[role])
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
  })

  it.each(workspaces.flatMap(({ role, title }) => paths.map((path) => ({ role, title, path }))))(
    'checks $role access to $path, including direct links',
    ({ role, title, path }) => {
      renderApp(path, role)
      const allowed = path === roleHome[role] ||
        (path === '/child' && (role === 'specialist' || role === 'examiner'))
      const expectedTitle = !allowed ? ar.unavailableTitle : path === '/child' ? ar.childTitle : ar[title]
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(expectedTitle)
      if (!allowed) {
        expect(screen.getByRole('link', { name: ar.backToWorkspace })).toHaveAttribute('href', roleHome[role])
      }
    },
  )
})

describe('professional-only English catalogue', () => {
  it.each(['specialist', 'examiner'] as const)('lets the %s switch to English and back', async (role) => {
    const user = userEvent.setup()
    renderApp(roleHome[role], role)
    await user.click(screen.getByRole('button', { name: ar.languageSwitch }))
    expect(document.documentElement).toHaveAttribute('lang', 'en')
    expect(document.documentElement).toHaveAttribute('dir', 'ltr')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en[`${role}Title`])
    await user.click(screen.getByRole('button', { name: en.languageSwitch }))
    expect(document.documentElement).toHaveAttribute('lang', 'ar')
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
  })

  it.each(['guardian', 'admin'] as const)('does not offer an English switch to %s', (role) => {
    renderApp(roleHome[role], role)
    expect(screen.queryByRole('button', { name: ar.languageSwitch })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: ar.authSignOut })).toBeVisible()
    expect(document.documentElement).toHaveAttribute('lang', 'ar')
  })

  it('immediately returns to Arabic in a supervised child space, preserving only the professional preference', async () => {
    const user = userEvent.setup()
    const router = renderApp('/specialist', 'specialist')
    await user.click(screen.getByRole('button', { name: ar.languageSwitch }))
    await user.click(screen.getByRole('link', { name: en.childNavigation }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ar.childTitle)
    expect(document.documentElement).toHaveAttribute('lang', 'ar')
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    const childText = within(screen.getByRole('main')).getByRole('heading', { level: 1 }).textContent
    expect(childText).not.toMatch(/[a-z]/i)
    expect(screen.getByRole('main')).not.toHaveTextContent(/wrong|score|risk|خطر|درجة|خطأ/i)
    expect(screen.getByText(ar.noSessionDescription)).toBeVisible()
    await act(() => router.navigate('/specialist'))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en.specialistTitle)
  })

  it('does not offer English on an unauthorized professional route', () => {
    renderApp('/specialist', 'examiner')
    expect(screen.queryByRole('button', { name: ar.languageSwitch })).not.toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('lang', 'ar')
  })
})

describe('Supabase auth UI boundary (in-memory component fixtures only)', () => {
  it('offers only Google and does not offer role selection', async () => {
    const fixture = createTestAuth({ status: 'signedOut', role: null, issue: null })
    renderAuth('/', fixture)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: ar.authGoogle }))
    expect(fixture.controller.signIn).toHaveBeenCalledExactlyOnceWith('google')
    expect(screen.queryByRole('button', { name: /Microsoft|مايكروسوفت/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ar.languageSwitch })).not.toBeInTheDocument()
  })

  it('does not render a protected workspace while identity verification is pending', () => {
    const fixture = createTestAuth({ status: 'loading', role: null, issue: null })
    const router = renderAuth('/specialist', fixture)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ar.authLoadingTitle)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/specialist')
    act(() => fixture.update({ status: 'signedIn', role: 'specialist', issue: null }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ar.specialistTitle)
  })

  it('removes the workspace and English preference immediately on auth failure', async () => {
    const fixture = createTestAuth({ status: 'signedIn', role: 'specialist', issue: null })
    renderAuth('/specialist', fixture)
    await userEvent.setup().click(screen.getByRole('button', { name: ar.languageSwitch }))
    expect(document.documentElement).toHaveAttribute('lang', 'en')
    act(() => fixture.update({ status: 'error', role: null, issue: 'unavailable' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(ar.authUnavailable)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('lang', 'ar')
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
  })

  it('routes a verified callback only by server-backed role, never next or role parameters', async () => {
    const fixture = createTestAuth({ status: 'signedIn', role: 'guardian', issue: null })
    const router = renderAuth('/auth/callback?next=https://evil.invalid&role=admin', fixture)
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(ar.guardianTitle)
    expect(router.state.location.pathname).toBe('/guardian')
  })

  it.each(['callback', 'session', 'profile', 'role', 'signIn', 'signOut', 'unavailable'] as const)(
    'surfaces a safe Arabic %s issue with an explicit retry', async (issue) => {
      const snapshot: AuthSnapshot = { status: 'error', role: null, issue }
      const fixture = createTestAuth(snapshot)
      renderAuth('/auth/callback', fixture)
      expect(screen.getByRole('alert')).toBeVisible()
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ar.authCallbackTitle)
      await userEvent.setup().click(screen.getByRole('button', { name: ar.authRetry }))
      expect(fixture.controller.retry).toHaveBeenCalledOnce()
      expect(document.documentElement).toHaveAttribute('dir', 'rtl')
    },
  )

  it('supports adult signout without adding controls to the child screen', async () => {
    const fixture = createTestAuth({ status: 'signedIn', role: 'guardian', issue: null })
    renderAuth('/guardian', fixture)
    await userEvent.setup().click(screen.getByRole('button', { name: ar.authSignOut }))
    expect(fixture.controller.signOut).toHaveBeenCalledOnce()
  })
})
