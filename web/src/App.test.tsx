import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from './App'
import { ar, en } from './i18n/messages'
import type { MessageKey } from './i18n/messages'
import { roleHome } from './routing/roles'
import type { AppRole } from './routing/roles'

function renderApp(path = '/', role: AppRole | null = null) {
  const router = createMemoryRouter(
    [{ path: '*', element: <AppRoutes role={role} /> }],
    { initialEntries: [path] },
  )
  render(<RouterProvider router={router} />)
  return router
}

const workspaces: { role: AppRole; title: MessageKey }[] = [
  { role: 'guardian', title: 'guardianTitle' },
  { role: 'specialist', title: 'specialistTitle' },
  { role: 'examiner', title: 'examinerTitle' },
  { role: 'admin', title: 'adminTitle' },
]

const paths = ['/guardian', '/specialist', '/examiner', '/admin', '/child']

describe('Arabic-first scaffold', () => {
  it('renders an honest Arabic-only public shell without a pretend sign-in', () => {
    renderApp()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ar.welcomeTitle)
    expect(screen.getByText(ar.scaffoldBadge)).toBeVisible()
    expect(screen.getByText(ar.foundationDescription)).toBeVisible()
    expect(document.documentElement).toHaveAttribute('lang', 'ar')
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
    expect(document.title).toBe(ar.appTitle)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: ar.skipToContent })).toHaveAttribute('href', '#main-content')
  })

  it('renders an Arabic not-found page', () => {
    renderApp('/does-not-exist')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ar.notFoundTitle)
    expect(screen.getByRole('link', { name: ar.backHome })).toHaveAttribute('href', '/')
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
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
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
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('lang', 'ar')
  })
})
