import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DelightControls, DelightProvider, useDelight } from './DelightProvider'
import { recordingQuietGate } from './recordingQuietGate'
import { DelightSoundEngine } from './soundEngine'

class MockParam {
  setValueAtTime = vi.fn()
  linearRampToValueAtTime = vi.fn()
  exponentialRampToValueAtTime = vi.fn()
}

class MockOscillator {
  static instances: MockOscillator[] = []
  type: OscillatorType = 'sine'
  frequency = new MockParam()
  onended: (() => void) | null = null
  connect = vi.fn()
  disconnect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
  constructor() { MockOscillator.instances.push(this) }
}

class MockGain {
  gain = new MockParam()
  connect = vi.fn()
  disconnect = vi.fn()
}

class MockAudioContext {
  static instances: MockAudioContext[] = []
  static resumePromise: Promise<void> | null = null
  currentTime = 0
  state: AudioContextState = 'running'
  destination = {}
  resume = vi.fn(() => MockAudioContext.resumePromise ?? Promise.resolve())
  close = vi.fn(async () => { this.state = 'closed' })
  createOscillator = vi.fn(() => new MockOscillator() as unknown as OscillatorNode)
  createGain = vi.fn(() => new MockGain() as unknown as GainNode)
  constructor() { MockAudioContext.instances.push(this) }
}

function Trigger() {
  const { motionReduced } = useDelight()
  return <button type="button" data-ui-sound="tap">{motionReduced ? 'حركة هادئة' : 'نقرة'}</button>
}

afterEach(() => {
  vi.unstubAllGlobals()
  MockAudioContext.instances = []
  MockAudioContext.resumePromise = null
  MockOscillator.instances = []
  vi.restoreAllMocks()
  expect(recordingQuietGate.locked).toBe(false)
})

describe('delight provider and original chimes', () => {
  it('creates sound only after a delegated user gesture', async () => {
    vi.stubGlobal('AudioContext', MockAudioContext)
    render(<DelightProvider><Trigger /></DelightProvider>)
    expect(MockAudioContext.instances).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'نقرة' }))
    await Promise.resolve()
    expect(MockAudioContext.instances).toHaveLength(1)
    expect(MockOscillator.instances).toHaveLength(1)
  })

  it('mutes and reduces motion without changing the underlying control contract', async () => {
    vi.stubGlobal('AudioContext', MockAudioContext)
    render(<DelightProvider><Trigger /><DelightControls /></DelightProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'نقرة' }))
    await Promise.resolve()
    expect(MockOscillator.instances).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'كتم الأصوات' }))
    fireEvent.click(screen.getByRole('button', { name: 'نقرة' }))
    await Promise.resolve()
    expect(MockOscillator.instances).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'تقليل الحركة' }))
    expect(screen.getByRole('button', { name: 'حركة هادئة' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'حركة هادئة' }))
    await Promise.resolve()
    expect(MockOscillator.instances).toHaveLength(1)
  })

  it('keeps audio available when reduced motion is selected independently', async () => {
    vi.stubGlobal('AudioContext', MockAudioContext)
    render(<DelightProvider><Trigger /><DelightControls /></DelightProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'تقليل الحركة' }))
    fireEvent.click(screen.getByRole('button', { name: 'حركة هادئة' }))
    await Promise.resolve()
    expect(MockOscillator.instances).toHaveLength(1)
  })

  it('rate-limits repeated cues and keeps peak gain bounded', async () => {
    vi.stubGlobal('AudioContext', MockAudioContext)
    const engine = new DelightSoundEngine()
    expect(engine.play('tap')).toBe(true)
    expect(engine.play('tap')).toBe(false)
    await Promise.resolve()
    const gain = MockAudioContext.instances[0] && MockAudioContext.instances[0].createGain.mock.results[0]?.value as MockGain
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.034, expect.any(Number))
    engine.dispose()
  })

  it('drops a pending gesture sound when recording quiet starts before resume settles', async () => {
    vi.stubGlobal('AudioContext', MockAudioContext)
    let resolveResume!: () => void
    MockAudioContext.resumePromise = new Promise<void>((resolve) => { resolveResume = resolve })
    render(<DelightProvider><Trigger /></DelightProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'نقرة' }))
    const release = recordingQuietGate.acquire()
    resolveResume()
    await Promise.resolve()
    expect(MockOscillator.instances).toHaveLength(0)
    release()
  })

  it('stops already playing oscillators when recording quiet starts', async () => {
    vi.stubGlobal('AudioContext', MockAudioContext)
    render(<DelightProvider><Trigger /></DelightProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'نقرة' }))
    await Promise.resolve()
    const oscillator = MockOscillator.instances[0]
    const release = recordingQuietGate.acquire()
    expect(oscillator.stop).toHaveBeenCalled()
    release()
  })

  it('pauses existing media and blocks attempted play only while the gate is locked', () => {
    const media = document.createElement('audio')
    Object.defineProperty(media, 'paused', { configurable: true, value: false })
    const pause = vi.spyOn(media, 'pause').mockImplementation(() => undefined)
    document.body.append(media)

    const release = recordingQuietGate.acquire()
    expect(pause).toHaveBeenCalledOnce()
    media.dispatchEvent(new Event('play'))
    expect(pause).toHaveBeenCalledTimes(2)

    release()
    media.dispatchEvent(new Event('play'))
    expect(pause).toHaveBeenCalledTimes(2)
    media.remove()
  })

  it('keeps media quiet across nested locks and releases only after the final lock', () => {
    const media = document.createElement('video')
    Object.defineProperty(media, 'paused', { configurable: true, value: true })
    const pause = vi.spyOn(media, 'pause').mockImplementation(() => undefined)
    document.body.append(media)

    const outerRelease = recordingQuietGate.acquire()
    const innerRelease = recordingQuietGate.acquire()
    media.dispatchEvent(new Event('play'))
    expect(pause).toHaveBeenCalledOnce()

    outerRelease()
    media.dispatchEvent(new Event('play'))
    expect(pause).toHaveBeenCalledTimes(2)
    innerRelease()
    media.dispatchEvent(new Event('play'))
    expect(pause).toHaveBeenCalledTimes(2)
    media.remove()
  })

  it('drops pending sound when mute is toggled off and back on before resume settles', async () => {
    vi.stubGlobal('AudioContext', MockAudioContext)
    let resolveResume!: () => void
    MockAudioContext.resumePromise = new Promise<void>((resolve) => { resolveResume = resolve })
    render(<DelightProvider><Trigger /><DelightControls /></DelightProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'نقرة' }))
    fireEvent.click(screen.getByRole('button', { name: 'كتم الأصوات' }))
    fireEvent.click(screen.getByRole('button', { name: 'تشغيل الأصوات' }))
    resolveResume()
    await Promise.resolve()
    await Promise.resolve()
    expect(MockOscillator.instances).toHaveLength(0)
  })

  it('silences active voices immediately when mute is enabled', async () => {
    vi.stubGlobal('AudioContext', MockAudioContext)
    render(<DelightProvider><Trigger /><DelightControls /></DelightProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'نقرة' }))
    await Promise.resolve()
    const oscillator = MockOscillator.instances[0]
    fireEvent.click(screen.getByRole('button', { name: 'كتم الأصوات' }))
    expect(oscillator.stop).toHaveBeenCalled()
  })
})
