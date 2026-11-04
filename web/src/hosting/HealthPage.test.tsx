import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { HealthPage } from './HealthPage'
import { I18nProvider } from '../i18n/I18nProvider'
import { ar } from '../i18n/messages'

describe('public health page', () => {
  it('shows static frontend availability without claiming backend readiness', () => {
    render(
      <I18nProvider allowEnglish={false}>
        <MemoryRouter>
          <HealthPage />
        </MemoryRouter>
      </I18nProvider>,
    )

    expect(screen.getByRole('heading', { name: ar.healthPageTitle })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(ar.healthPageStatus)
    expect(screen.getByRole('status')).toHaveTextContent(ar.healthPageScope)
    expect(screen.getByRole('link', { name: ar.backHome })).toHaveAttribute('href', '/')
    expect(document.documentElement).toHaveAttribute('lang', 'ar')
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
  })
})
