import type { CSSProperties, HTMLAttributes } from 'react'
import './core.css'
import type { noorPoses } from './copy'

export type NoorPose = (typeof noorPoses)[number]
export type NoorSize = number | string

export type NoorProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  pose?: NoorPose
  alt?: string
  size?: NoorSize
}

export function Noor({
  alt = '',
  className,
  pose = 'welcome',
  size = 176,
  style,
  ...props
}: NoorProps) {
  const sizeValue = typeof size === 'number' ? `${size}px` : size
  const noorStyle = {
    ...style,
    '--noor-size': sizeValue,
  } as CSSProperties

  return (
    <span
      {...props}
      className={['noor-ui', 'noor-ui-noor', `noor-ui-noor--${pose}`, className].filter(Boolean).join(' ')}
      data-noor-pose={pose}
      style={noorStyle}
      aria-hidden={alt === '' ? true : undefined}
    >
      <img
        className="noor-ui-noor__image"
        src={`/brand/noor/${pose}.webp`}
        alt={alt}
        width={typeof size === 'number' ? size : undefined}
        height={typeof size === 'number' ? size : undefined}
        loading="lazy"
        decoding="async"
      />
    </span>
  )
}
