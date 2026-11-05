import type { ReactNode } from 'react'
import type { NoorPose } from '../../core'
import { Noor, Notice } from '../../core'
import { childCopy } from './copy'
import './child.css'

export type ChildWorldProps = {
  children: ReactNode
  pose?: NoorPose
  noorAlt?: string
  title?: ReactNode
  titleId?: string
  eyebrow?: ReactNode
  progress?: ReactNode
  boundary?: ReactNode
  className?: string
}

export function ChildWorld({
  boundary,
  children,
  className,
  eyebrow = childCopy.shell.eyebrow,
  noorAlt = childCopy.shell.readingAlt,
  pose = 'reading',
  progress,
  title,
  titleId = 'child-world-title',
}: ChildWorldProps) {
  return (
    <div className={['noor-ui', 'noor-child-world', className].filter(Boolean).join(' ')} dir="rtl">
      <div className="noor-child-world__layout">
        <aside className="noor-child-world__noor" aria-label={noorAlt}>
          <Noor pose={pose} alt={noorAlt} size="clamp(9rem, 24vw, 15rem)" />
        </aside>
        <section className="noor-child-world__task" aria-labelledby={title ? titleId : undefined}>
          <div className="noor-child-world__task-topline">
            <p className="noor-child-world__eyebrow">{eyebrow}</p>
            {progress && <p className="noor-child-world__progress" aria-live="polite">{progress}</p>}
          </div>
          {title && <h1 id={titleId} className="noor-child-world__title">{title}</h1>}
          {boundary && (
            <Notice className="noor-child-world__boundary" tone="caution" title={childCopy.boundary.synthetic}>
              {boundary}
            </Notice>
          )}
          <div className="noor-child-world__content">{children}</div>
        </section>
      </div>
    </div>
  )
}

export type RecordingOrbState = 'ready' | 'recording' | 'processing'

export function RecordingOrb({
  className,
  children,
  disabled = false,
  label,
  onClick,
  state = 'ready',
}: {
  className?: string
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
  state?: RecordingOrbState
}) {
  return (
    <button
      className={['noor-child-world__record-orb', `noor-child-world__record-orb--${state}`, className].filter(Boolean).join(' ')}
      type="button"
      aria-label={label}
      aria-pressed={state === 'recording'}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="noor-child-world__record-orb-icon" aria-hidden="true">●</span>
      <span className="noor-child-world__record-orb-label">{children}</span>
    </button>
  )
}

export function ChildChoiceGrid({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return <div className="noor-child-world__choice-grid" role="group" aria-label={label}>{children}</div>
}
