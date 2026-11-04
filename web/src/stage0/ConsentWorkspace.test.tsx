import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n/I18nProvider'
import { ar } from '../i18n/messages'
import { Stage0Context } from './context'
import { ConsentWorkspace } from './ConsentWorkspace'
import { Stage0RepositoryError } from './repository'
import type { Stage0Repository } from './repository'

const child = { id: 'child-1', first_name: 'طفل تجريبي', grade: 2, birth_month: '2017-01', specialist_id: 'specialist-1', is_demo: true }
const consent = {
  id: 'consent-1', child_id: child.id, guardian_id: 'guardian-1', specialist_id: child.specialist_id,
  scope: 'assessment' as const, signed_at: '2026-11-03T00:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z',
  evidence_path: 'fixture/evidence', ethics_ref: null, valid: true,
}
function repository(overrides: Partial<Stage0Repository> = {}): Stage0Repository {
  return {
    listExaminerChildren: vi.fn(async () => [child]),
    listGuardianChildren: vi.fn(async () => [child]),
    listConsents: vi.fn(async () => []),
    createConsent: vi.fn(async () => consent),
    revokeConsent: vi.fn(async () => ({ ...consent, valid: false, expires_at: '1970-01-01T00:00:00.000Z' })),
    createExaminerSession: vi.fn(), saveResult: vi.fn(), completeSession: vi.fn(),
    ...overrides,
  } as unknown as Stage0Repository
}
function renderConsent(value: Stage0Repository) {
  return render(
    <I18nProvider allowEnglish={false}>
      <Stage0Context.Provider value={value}><ConsentWorkspace /></Stage0Context.Provider>
    </I18nProvider>,
  )
}

describe('ConsentWorkspace', () => {
  it('requires an explicit unchecked acknowledgement before signing', async () => {
    const value = repository()
    const user = userEvent.setup()
    renderConsent(value)
    const capture = await screen.findByRole('button', { name: ar.consentCapture })
    expect(capture).toBeDisabled()
    await user.type(screen.getByPlaceholderText(ar.consentEvidencePlaceholder), 'fixture/evidence')
    expect(capture).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    expect(capture).toBeEnabled()
    await user.click(capture)
    await waitFor(() => expect(value.createConsent).toHaveBeenCalledWith(child, 'fixture/evidence', expect.stringMatching(/T23:59:59\.999Z$/)))
  })

  it('does not show a saved notice when the server rejects the consent', async () => {
    const value = repository({ createConsent: vi.fn(async () => { throw new Stage0RepositoryError('forbidden') }) })
    const user = userEvent.setup()
    renderConsent(value)
    await screen.findByRole('button', { name: ar.consentCapture })
    await user.type(screen.getByPlaceholderText(ar.consentEvidencePlaceholder), 'fixture/evidence')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: ar.consentCapture }))
    expect(await screen.findByRole('alert')).toHaveTextContent(ar.consentLoadError)
    expect(screen.queryByRole('status', { name: ar.consentSaved })).not.toBeInTheDocument()
  })

  it('stops a canceled child load before starting consent fan-out reads', async () => {
    let release!: (rows: typeof child[]) => void
    const listGuardianChildren = vi.fn(() => new Promise<typeof child[]>((resolve) => { release = resolve }))
    const listConsents = vi.fn(async () => [])
    const value = repository({ listGuardianChildren, listConsents })
    const view = renderConsent(value)
    await waitFor(() => expect(listGuardianChildren).toHaveBeenCalled())
    view.unmount()
    release([child])
    await Promise.resolve()
    expect(listConsents).not.toHaveBeenCalled()
  })

  it('replaces old child data when the repository identity is replaced', async () => {
    const replacement = { ...child, id: 'child-2', first_name: 'طفل جديد' }
    let release!: (rows: typeof child[]) => void
    const oldValue = repository({ listGuardianChildren: vi.fn(() => new Promise<typeof child[]>((resolve) => { release = resolve })) })
    const newValue = repository({ listGuardianChildren: vi.fn(async () => [replacement]), listConsents: vi.fn(async () => []) })
    const view = renderConsent(oldValue)
    await waitFor(() => expect(oldValue.listGuardianChildren).toHaveBeenCalled())
    view.rerender(
      <I18nProvider allowEnglish={false}>
        <Stage0Context.Provider value={newValue}><ConsentWorkspace /></Stage0Context.Provider>
      </I18nProvider>,
    )
    expect(await screen.findByRole('option', { name: new RegExp(`^${replacement.first_name}`) })).toBeInTheDocument()
    release([child])
    await Promise.resolve()
    expect(screen.queryByRole('option', { name: child.first_name })).not.toBeInTheDocument()
  })
})
