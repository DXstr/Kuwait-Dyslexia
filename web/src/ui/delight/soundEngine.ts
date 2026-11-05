import { recordingQuietGate } from './recordingQuietGate'

export type DelightSound = 'tap' | 'advance' | 'completion' | 'neutral-attention'

const MAX_PEAK_GAIN = 0.06
const GLOBAL_RATE_LIMIT_MS = 90
const RATE_LIMIT_MS: Record<DelightSound, number> = {
  tap: 90,
  advance: 160,
  completion: 650,
  'neutral-attention': 220,
}

type SoundShape = {
  frequencies: readonly number[]
  duration: number
  attack: number
  peakGain: number
  type: OscillatorType
}

const SHAPES: Record<DelightSound, SoundShape> = {
  tap: { frequencies: [660], duration: 0.075, attack: 0.012, peakGain: 0.034, type: 'sine' },
  advance: { frequencies: [523.25, 783.99], duration: 0.13, attack: 0.015, peakGain: 0.026, type: 'triangle' },
  completion: { frequencies: [523.25, 659.25, 783.99], duration: 0.28, attack: 0.02, peakGain: 0.018, type: 'sine' },
  'neutral-attention': { frequencies: [440, 349.23], duration: 0.14, attack: 0.014, peakGain: 0.022, type: 'triangle' },
}

type ScheduledOscillator = OscillatorNode & { onended: ((this: OscillatorNode, event: Event) => unknown) | null }

export class DelightSoundEngine {
  private context: AudioContext | null = null
  private readonly playing = new Set<ScheduledOscillator>()
  private readonly lastPlayed = new Map<DelightSound, number>()
  private unsubscribeQuietGate: (() => void) | null = null
  private epoch = 0
  private enabled = true
  private lastAnyPlayed = -Infinity

  constructor() {
    this.unsubscribeQuietGate = recordingQuietGate.subscribe((locked) => {
      if (locked) this.silence()
    })
  }

  get hasAudioContext(): boolean {
    return this.context !== null
  }

  /** Update synchronously so a pending resume cannot outlive mute or reduced motion. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      if (!enabled) this.silence()
      return
    }
    this.enabled = enabled
    this.epoch += 1
    if (!enabled) this.silence()
  }

  play(sound: DelightSound): boolean {
    if (!this.enabled || recordingQuietGate.locked) return false
    const now = this.now()
    const previous = this.lastPlayed.get(sound) ?? -Infinity
    if (now - this.lastAnyPlayed < GLOBAL_RATE_LIMIT_MS || now - previous < RATE_LIMIT_MS[sound]) return false

    const Context = globalThis.AudioContext
    if (typeof Context !== 'function') return false
    if (!this.context) {
      try {
        this.context = new Context()
      } catch {
        return false
      }
    }

    const context = this.context
    const currentEpoch = this.epoch
    this.lastAnyPlayed = now
    this.lastPlayed.set(sound, now)
    void context.resume().then(() => {
      if (currentEpoch !== this.epoch || !this.enabled || recordingQuietGate.locked || !this.context) return
      this.schedule(sound, context, currentEpoch)
    }).catch(() => {
      // Audio is an enhancement; a blocked or unavailable context must not affect the UI.
    })
    return true
  }

  silence(): void {
    this.epoch += 1
    const context = this.context
    const stopAt = context?.currentTime ?? 0
    for (const oscillator of this.playing) {
      try { oscillator.stop(stopAt) } catch { /* It may already have ended. */ }
      try { oscillator.disconnect() } catch { /* It may already be disconnected. */ }
    }
    this.playing.clear()
  }

  dispose(): void {
    this.silence()
    this.unsubscribeQuietGate?.()
    this.unsubscribeQuietGate = null
    const context = this.context
    this.context = null
    if (context && context.state !== 'closed') void context.close().catch(() => undefined)
  }

  private schedule(sound: DelightSound, context: AudioContext, epoch: number): void {
    if (epoch !== this.epoch || !this.enabled || recordingQuietGate.locked) return
    const shape = SHAPES[sound]
    const now = context.currentTime
    const safePeak = Math.min(MAX_PEAK_GAIN / Math.max(1, shape.frequencies.length), shape.peakGain)

    for (const frequency of shape.frequencies) {
      const oscillator = context.createOscillator() as ScheduledOscillator
      const gain = context.createGain()
      oscillator.type = shape.type
      oscillator.frequency.setValueAtTime(frequency, now)
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(safePeak, now + shape.attack)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + shape.duration)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.onended = () => {
        this.playing.delete(oscillator)
        try { oscillator.disconnect() } catch { /* Already disconnected. */ }
        try { gain.disconnect() } catch { /* Already disconnected. */ }
      }
      this.playing.add(oscillator)
      oscillator.start(now)
      oscillator.stop(now + shape.duration + 0.02)
    }
  }

  private now(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
  }
}
