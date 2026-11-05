import { useEffect, useRef, useState } from 'react'
import type { PhoneticLetter } from '../contracts/basira'
import '../ui/pages/child/child.css'

export function MouthShapeRenderer({ letter, label }: { letter: PhoneticLetter; label: string }) {
  const { mouth } = letter
  const mouthWidth = 76 - mouth.lip_closure * 22
  const mouthHeight = 9 + mouth.jaw_open * 26
  const lipRadius = 6 + mouth.lip_rounding * 12
  const tongueY = 120 - mouth.tongue_tip.raise * 36
  const throatOpacity = 0.12 + mouth.pharyngeal_constriction * 0.5
  return (
    <svg className="teach-mouth" viewBox="0 0 240 180" role="img" aria-label={label}>
      <title>{label}</title>
      <path className="teach-mouth-face" d="M56 36 Q120 8 184 36 L176 150 Q120 174 64 150 Z" />
      <path className="teach-mouth-throat" style={{ opacity: throatOpacity }} d="M94 56 Q120 48 146 56 L136 115 Q120 132 104 115 Z" />
      <path className="teach-mouth-teeth" d="M81 87 Q120 74 159 87 Q154 101 120 101 Q86 101 81 87Z" />
      <ellipse className="teach-mouth-lips" cx="120" cy="94" rx={mouthWidth / 2} ry={mouthHeight / 2} style={{ rx: mouthWidth / 2, ry: mouthHeight / 2 }} />
      <ellipse className="teach-mouth-rounding" cx="120" cy="94" rx={lipRadius} ry={Math.max(3, lipRadius * 0.55)} />
      <path className="teach-mouth-tongue" d={`M84 ${tongueY + 22} Q120 ${tongueY - 2} 156 ${tongueY + 22} Q148 ${tongueY + 44} 120 ${tongueY + 48} Q92 ${tongueY + 44} 84 ${tongueY + 22}Z`} />
      {mouth.lower_lip_to_teeth && <path className="teach-mouth-contact" d="M92 82 Q120 72 148 82" />}
      <text className="teach-mouth-letter" x="120" y="166" textAnchor="middle">{letter.char}</text>
    </svg>
  )
}

type Point = { x: number; y: number }

export function TracePad({ label, resetLabel, completeLabel, note, canvasLabel, onComplete }: {
  label: string
  resetLabel: string
  completeLabel: string
  note: string
  canvasLabel: string
  onComplete: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.round(rect.width * ratio)
    canvas.height = Math.round(rect.height * ratio)
    const context = canvas.getContext('2d')
    if (!context) return
    context.scale(ratio, ratio)
    context.strokeStyle = '#206567'
    context.lineWidth = 5
    context.lineCap = 'round'
    context.lineJoin = 'round'
  }, [])

  const point = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const begin = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drawing.current = true
    const current = point(event)
    const context = event.currentTarget.getContext('2d')
    context?.beginPath()
    context?.moveTo(current.x, current.y)
    setHasInk(true)
  }
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const current = point(event)
    const context = event.currentTarget.getContext('2d')
    context?.lineTo(current.x, current.y)
    context?.stroke()
  }
  const finish = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = false
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }
  const reset = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
  }

  return (
    <div className="teach-trace" aria-labelledby="trace-title">
      <h3 id="trace-title">{label}</h3>
      <canvas
        ref={canvasRef}
        className="teach-trace-pad"
        aria-label={canvasLabel}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
      <div className="teach-trace-actions">
        <button className="action-button" type="button" onClick={reset} disabled={!hasInk}>{resetLabel}</button>
        <button className="action-button" type="button" onClick={onComplete} disabled={!hasInk}>{completeLabel}</button>
      </div>
      <p className="teach-trace-note">{note}</p>
    </div>
  )
}
