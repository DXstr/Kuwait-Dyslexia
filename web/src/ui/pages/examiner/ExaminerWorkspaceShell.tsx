import type { ReactNode } from 'react'
import { useI18n } from '../../../i18n/context'
import type { MessageKey } from '../../../i18n/messages'
import './examiner.css'

export type WorkspaceShellProps = {
  id: string
  className?: string
  eyebrow: MessageKey
  title: MessageKey
  description: MessageKey
  aside: ReactNode
  children: ReactNode
}

export function WorkspaceShell({ aside, children, className, description, eyebrow, id, title }: WorkspaceShellProps) {
  const { t } = useI18n()
  return (
    <section className={['examiner-shell', className].filter(Boolean).join(' ')} aria-labelledby={id}>
      <aside className="examiner-shell__aside" aria-label={t(eyebrow)}>
        {aside}
      </aside>
      <div className="examiner-shell__main">
        <header className="examiner-shell__header">
          <p className="examiner-shell__eyebrow">{t(eyebrow)}</p>
          <h2 id={id}>{t(title)}</h2>
          <p className="examiner-shell__description">{t(description)}</p>
        </header>
        {children}
      </div>
    </section>
  )
}
