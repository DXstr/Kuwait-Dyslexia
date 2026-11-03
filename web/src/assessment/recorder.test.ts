import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioRecorder, RecorderError } from './recorder'

class TestTrack extends EventTarget {
  readyState = 'live'
  stop = vi.fn(() => { this.readyState = 'ended' })
}
class TestContext {
  static current: TestContext
  sampleRate = 48_000
  state = 'running'
  audioWorklet = { addModule: vi.fn(async () => {}) }
  resume = vi.fn(async () => {})
  close = vi.fn(async () => { this.state = 'closed' })
  source = { connect: vi.fn(), disconnect: vi.fn() }
  createMediaStreamSource = vi.fn(() => this.source)
  constructor() { TestContext.current = this }
}
class TestWorklet {
  static current: TestWorklet
  port = { onmessage: null as ((event: MessageEvent<Float32Array>) => void) | null, close: vi.fn() }
  disconnect = vi.fn()
  constructor() { TestWorklet.current = this }
}
function fixture(getUserMedia?: () => Promise<MediaStream>) {
  const track = new TestTrack()
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream
  vi.stubGlobal('AudioWorkletNode', TestWorklet)
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:synthetic-worklet'), revokeObjectURL: vi.fn() })
  const onIssue = vi.fn()
  const recorder = new AudioRecorder({
    mediaDevices: { getUserMedia: getUserMedia ?? vi.fn(async () => stream) } as unknown as MediaDevices,
    audioContextFactory: TestContext as unknown as typeof AudioContext,
    maxDurationMs: 500,
    onIssue,
  })
  return { recorder, stream, track, onIssue }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('B6 microphone lifecycle (synthetic devices)', () => {
  it('stops a late permission response after cancellation, without opening a worklet', async () => {
    let resolve!: (value: MediaStream) => void
    const permission = new Promise<MediaStream>((done) => { resolve = done })
    const { recorder, stream, track } = fixture(() => permission)
    const start = recorder.start()
    const rejected = expect(start).rejects.toMatchObject({ issue: 'cancelled' })
    await Promise.resolve()
    recorder.cancel()
    resolve(stream)
    await rejected
    expect(track.stop).toHaveBeenCalledOnce()
    expect(TestContext.current.close).toHaveBeenCalledOnce()
    expect(recorder.isRecording).toBe(false)
  })

  it('encodes captured PCM at the actual source rate into 16 kHz mono WAV and tears down', async () => {
    const { recorder, track } = fixture()
    await recorder.start()
    TestWorklet.current.port.onmessage?.({ data: new Float32Array(480).fill(0.25) } as MessageEvent<Float32Array>)
    const audio = await recorder.stop()
    const bytes = await audio.arrayBuffer()
    const view = new DataView(bytes)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint32(40, true)).toBe(320)
    expect(track.stop).toHaveBeenCalledOnce()
    expect(TestContext.current.source.connect).toHaveBeenCalledWith(TestWorklet.current)
    expect(TestWorklet.current.port.close).toHaveBeenCalledOnce()
  })

  it('surfaces a device ending rather than returning an empty successful recording', async () => {
    const { recorder, track, onIssue } = fixture()
    await recorder.start()
    track.dispatchEvent(new Event('ended'))
    expect(onIssue).toHaveBeenCalledWith('device_ended')
    await expect(recorder.stop()).rejects.toMatchObject({ issue: 'device_ended' })
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('bounds capture duration and does not create an unhandled rejection from its timer', async () => {
    vi.useFakeTimers()
    const { recorder, track, onIssue } = fixture()
    await recorder.start()
    await vi.advanceTimersByTimeAsync(500)
    expect(onIssue).toHaveBeenCalledWith('too_long')
    expect(track.stop).toHaveBeenCalledOnce()
    await expect(recorder.stop()).rejects.toMatchObject({ issue: 'too_long' })
  })

  it('rejects empty capture so the child can retry the same item', async () => {
    const { recorder, track } = fixture()
    await recorder.start()
    await expect(recorder.stop()).rejects.toBeInstanceOf(RecorderError)
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('can be constructed on unsupported browsers without throwing until start', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const recorder = new AudioRecorder({ mediaDevices: {} as MediaDevices })
    await expect(recorder.start()).rejects.toMatchObject({ issue: 'unsupported' })
  })
})
