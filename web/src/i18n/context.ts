import { createContext, useContext } from 'react'
import type { MessageKey } from './messages'

export type Locale = 'ar' | 'en'
export type I18nValue = {
  locale: Locale
  canSwitchLanguage: boolean
  setLocale: (locale: Locale) => void
  t: (key: MessageKey) => string
}

export const I18nContext = createContext<I18nValue | null>(null)

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n requires I18nProvider')
  return context
}
