import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from 'react'
import './core.css'

export type ButtonVariant = 'gold' | 'soft' | 'outline'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
}

function joinClasses(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ')
}

export function Button({
  className,
  type = 'button',
  variant = 'gold',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={joinClasses('noor-ui', 'noor-ui-button', `noor-ui-button--${variant}`, className)}
      data-ui-sound="tap"
    />
  )
}

export type SurfaceTone = 'default' | 'tinted' | 'quiet'

export type SurfaceProps = HTMLAttributes<HTMLDivElement> & {
  tone?: SurfaceTone
  interactive?: boolean
}

export function Surface({
  children,
  className,
  interactive = false,
  tone = 'default',
  ...props
}: SurfaceProps) {
  return (
    <div
      {...props}
      className={joinClasses(
        'noor-ui',
        'noor-ui-surface',
        `noor-ui-surface--${tone}`,
        interactive && 'noor-ui-surface--interactive',
        className,
      )}
    >
      {children}
    </div>
  )
}

export type SectionHeaderProps = {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  level?: 1 | 2 | 3 | 4 | 5 | 6
  className?: string
}

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

export function SectionHeader({
  actions,
  className,
  description,
  eyebrow,
  level = 2,
  title,
}: SectionHeaderProps) {
  const Heading = `h${level}` as HeadingTag
  return (
    <header className={joinClasses('noor-ui', 'noor-ui-section-header', className)}>
      <div className="noor-ui-section-header__copy">
        {eyebrow && <p className="noor-ui-section-header__eyebrow">{eyebrow}</p>}
        <Heading className="noor-ui-section-header__title">{title}</Heading>
        {description && <p className="noor-ui-section-header__description">{description}</p>}
      </div>
      {actions && <div className="noor-ui-section-header__actions">{actions}</div>}
    </header>
  )
}

export type NoticeTone = 'neutral' | 'positive' | 'caution'

export type NoticeProps = HTMLAttributes<HTMLDivElement> & {
  tone?: NoticeTone
  title?: ReactNode
  icon?: ReactNode
}

export function Notice({
  children,
  className,
  icon,
  role,
  title,
  tone = 'neutral',
  ...props
}: NoticeProps) {
  return (
    <div
      {...props}
      className={joinClasses('noor-ui', 'noor-ui-notice', `noor-ui-notice--${tone}`, className)}
      role={role ?? (tone === 'caution' ? 'alert' : 'status')}
    >
      {icon && <span className="noor-ui-notice__icon" aria-hidden="true">{icon}</span>}
      <div className="noor-ui-notice__body">
        {title && <p className="noor-ui-notice__title">{title}</p>}
        <div className="noor-ui-notice__content">{children}</div>
      </div>
    </div>
  )
}
