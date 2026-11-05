/* eslint-disable react-refresh/only-export-components -- provider and its public hook are one stable API. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { recordingQuietGate } from './recordingQuietGate'
import { DelightSoundEngine, type DelightSound } from './soundEngine'
import { delightCopy } from './copy'
import './delight.css'

export type MotionPreference = 'system' | 'full' | 'reduced'

export type DelightContextValue = {
  muted: boolean
  setMuted: (muted: boolean) => void
  toggleMute: () => void
  motionPreference: MotionPreference
  setMotionPreference: (preference: MotionPreference) => void
  motionReduced: boolean
  playSound: (sound: DelightSound) => boolean
  playTap: () => boolean
  playAdvance: () => boolean
  playCompletion: () => boolean
  playNeutralAttention: () => boolean
  recordingQuiet: boolean
}

const DelightContext = createContext<DelightContextValue | null>(null)

function readSystemReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

function isDelightSound(value: string | null): value is DelightSound {
  return value === 'tap' || value === 'advance' || value === 'completion' || value === 'neutral-attention'
}

export type DelightProviderProps = {
  children: ReactNode
}

export function DelightProvider({ children }: DelightProviderProps) {
  const [muted, setMutedState] = useState(false)
  const [motionPreference, setMotionPreferenceState] = useState<MotionPreference>('system')
  const [systemReduced, setSystemReduced] = useState(readSystemReducedMotion)
  const [engine] = useState(() => new DelightSoundEngine())
  const motionReduced = motionPreference === 'reduced' || (motionPreference === 'system' && systemReduced)
  const recordingQuiet = recordingQuietGate.locked

  const setMuted = useCallback((nextMuted: boolean) => {
    setMutedState(nextMuted)
    engine.setEnabled(!nextMuted)
  }, [engine])
  const setMotionPreference = useCallback((nextPreference: MotionPreference) => {
    setMotionPreferenceState(nextPreference)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setSystemReduced(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const root = document.documentElement
    const previous = root.dataset.motion
    root.dataset.motion = motionReduced ? 'reduced' : 'full'
    return () => {
      if (previous === undefined) delete root.dataset.motion
      else root.dataset.motion = previous
    }
  }, [motionReduced])

  useEffect(() => () => engine.dispose(), [engine])

  const playSound = useCallback((sound: DelightSound) => engine.play(sound), [engine])
  const playTap = useCallback(() => playSound('tap'), [playSound])
  const playAdvance = useCallback(() => playSound('advance'), [playSound])
  const playCompletion = useCallback(() => playSound('completion'), [playSound])
  const playNeutralAttention = useCallback(() => playSound('neutral-attention'), [playSound])
  const toggleMute = useCallback(() => setMuted(!muted), [muted, setMuted])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const source = target.closest<HTMLElement>('[data-ui-sound]')
      if (isDelightSound(source?.dataset.uiSound ?? null)) playSound(source?.dataset.uiSound as DelightSound)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [playSound])

  const value = useMemo<DelightContextValue>(() => ({
    muted,
    setMuted,
    toggleMute,
    motionPreference,
    setMotionPreference,
    motionReduced,
    playSound,
    playTap,
    playAdvance,
    playCompletion,
    playNeutralAttention,
    recordingQuiet,
  }), [motionPreference, motionReduced, muted, playAdvance, playCompletion, playNeutralAttention, playSound, playTap, recordingQuiet, setMotionPreference, setMuted, toggleMute])

  return <DelightContext.Provider value={value}>{children}</DelightContext.Provider>
}

export function useDelight(): DelightContextValue {
  const value = useContext(DelightContext)
  if (!value) throw new Error('useDelight must be used within DelightProvider')
  return value
}

export type DelightControlsProps = {
  className?: string
  showMotion?: boolean
  compact?: boolean
}

export function DelightControls({ className, showMotion = true, compact = false }: DelightControlsProps) {
  const { muted, toggleMute, motionPreference, setMotionPreference } = useDelight()
  const classes = ['noor-delight-controls', className].filter(Boolean).join(' ')
  const muteLabel = muted ? delightCopy.controls.muteOff : delightCopy.controls.muteOn
  const motionLabel = motionPreference === 'reduced' ? delightCopy.controls.motionReducedLabel : motionPreference === 'full' ? delightCopy.controls.motionFullLabel : delightCopy.controls.motionSystemLabel
  return (
    <div className={classes} role="group" aria-label={delightCopy.controls.groupLabel}>
      <button
        className="noor-delight-controls__button"
        type="button"
        data-ui-sound="none"
        aria-pressed={muted}
        title={muteLabel}
        onClick={toggleMute}
      >
        <span aria-hidden="true">{muted ? delightCopy.controls.mutedIcon : delightCopy.controls.enabledIcon}</span>
        <span className={compact ? 'sr-only' : undefined}>{muteLabel}</span>
      </button>
      {showMotion && (
        <button
          className="noor-delight-controls__button"
          type="button"
          data-ui-sound="none"
          aria-pressed={motionPreference !== 'system'}
          title={motionLabel}
          onClick={() => setMotionPreference(
            motionPreference === 'system' ? 'reduced' : motionPreference === 'reduced' ? 'full' : 'system',
          )}
        >
          <span aria-hidden="true">{motionPreference === 'reduced' ? delightCopy.controls.motionReducedIcon : motionPreference === 'full' ? delightCopy.controls.motionFullIcon : delightCopy.controls.motionSystemIcon}</span>
          <span className={compact ? 'sr-only' : undefined}>{motionLabel}</span>
        </button>
      )}
    </div>
  )
}
