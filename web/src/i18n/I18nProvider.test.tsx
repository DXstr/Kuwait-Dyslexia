import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { I18nProvider } from './I18nProvider'
import { useI18n } from './context'
import { ar, en } from './messages'

function LanguageProbe() {
  const { t, canSwitchLanguage, setLocale } = useI18n()
  return (
    <>
      <h1>{t('guardianTitle')}</h1>
      {canSwitchLanguage && <button onClick={() => setLocale('en')}>{t('switchToEnglish')}</button>}
    </>
  )
}

it('restores Arabic content and document metadata when a role or route disallows English', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<I18nProvider allowEnglish><LanguageProbe /></I18nProvider>)
  await user.click(screen.getByRole('button', { name: ar.switchToEnglish }))
  expect(screen.getByRole('heading')).toHaveTextContent(en.guardianTitle)
  expect(document.documentElement).toHaveAttribute('lang', 'en')
  rerender(<I18nProvider allowEnglish={false}><LanguageProbe /></I18nProvider>)
  expect(screen.getByRole('heading')).toHaveTextContent(ar.guardianTitle)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(document.documentElement).toHaveAttribute('lang', 'ar')
  expect(document.documentElement).toHaveAttribute('dir', 'rtl')
  expect(document.title).toBe(ar.appTitle)
})
