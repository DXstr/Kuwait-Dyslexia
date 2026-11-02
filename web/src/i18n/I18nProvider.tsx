import { useLayoutEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { I18nContext } from './context'
import type { I18nValue, Locale } from './context'
import { ar, en } from './messages'

export function I18nProvider({
  allowEnglish,
  children,
}: {
  allowEnglish: boolean
  children: ReactNode
}) {
  const [preference, setPreference] = useState<Locale>('ar')
  // Derive this during render: a saved professional preference must never flash
  // English content on a child, guardian, administration or public screen.
  const locale = allowEnglish ? preference : 'ar'
  const messages = locale === 'ar' ? ar : en

  useLayoutEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
    document.title = messages.appTitle
  }, [locale, messages])

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      canSwitchLanguage: allowEnglish,
      setLocale: (nextLocale) => {
        if (allowEnglish) setPreference(nextLocale)
      },
      t: (key) => messages[key],
    }),
    [allowEnglish, locale, messages],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
