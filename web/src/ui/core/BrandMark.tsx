import type { CSSProperties, HTMLAttributes } from 'react'
import './core.css'
import { coreCopy } from './copy'

export type BrandMarkProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  showName?: boolean
  name?: string
  size?: number
}

export function BrandMark({
  'aria-label': ariaLabel,
  className,
  name = coreCopy.brandName,
  showName = true,
  size = 40,
  style,
  ...props
}: BrandMarkProps) {
  const markStyle = {
    ...style,
    '--brand-mark-size': `${size}px`,
  } as CSSProperties

  return (
    <span
      {...props}
      className={['noor-ui', 'noor-ui-brand-mark', className].filter(Boolean).join(' ')}
      aria-label={ariaLabel ?? (!showName ? coreCopy.brandAriaLabel : undefined)}
      style={markStyle}
    >
      <img
        className="noor-ui-brand-mark__image"
        src="/brand/gold-eye.webp"
        alt=""
        width={size}
        height={size}
        decoding="async"
      />
      {showName && <span className="noor-ui-brand-mark__name">{name}</span>}
    </span>
  )
}
