import { encodeCapturedPcm } from './pcm'
import type { ItemType } from '../contracts/basira'
import { recordingQuietGate } from '../ui/delight/recordingQuietGate'

export type RecorderIssue = 'permission_denied' | 'unsupported' | 'cancelled' | 'device_ended' | 'empty' | 'too_long'

export class RecorderError extends Error {
  readonly issue: RecorderIssue
  constructor(issue: RecorderIssue) {
    super(`recorder: ${issue}`)
    this.name = 'RecorderError'
    this.issue = issue
  }
}

type RecorderOptions = {
  maxDurationMs?: number
  mediaDevices?: MediaDevices
  audioContextFactory?: typeof AudioContext
  onIssue?: (issue: RecorderIssue) => void
}

export const DEFAULT_RECORDING_DURATION_MS = 8_000
export const PASSAGE_RECORDING_DURATION_MS = 15_000
export const RECORDER_HARD_CAP_MS = 15_000

export function recordingDurationMs(itemType: ItemType): number {
  return itemType === 'passage_vowelized' || itemType === 'passage_unvowelized' || itemType === 'probe_passage'
    ? PASSAGE_RECORDING_DURATION_MS
    : DEFAULT_RECORDING_DURATION_MS
}

const workletSource = `
class BasiraPcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0]
    if (!channels || !channels.length || !channels[0].length) return true
    const mono = new Float32Array(channels[0].length)
    for (let index = 0; index < mono.length; index++) {
      for (const channel of channels) mono[index] += (channel[index] || 0) / channels.length
    }
    this.port.postMessage(mono, [mono.buffer])
    return true
  }
}
registerProcessor('basira-pcm-processor', BasiraPcmProcessor)
`

export class AudioRecorder {
  private readonly options: RecorderOptions
  private readonly maxDurationMs: number
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private worklet: AudioWorkletNode | null = null
  private moduleUrl: string | null = null
  private chunks: Float32Array[] = []
  private samples = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private state: 'idle' | 'starting' | 'recording' | 'stopping' | 'stopped' = 'idle'
  private terminalIssue: RecorderIssue | null = null
  private generation = 0
  private releaseRecordingQuiet: (() => void) | null = null

  constructor(options: RecorderOptions = {}) {
    this.options = options
    this.maxDurationMs = Math.min(Math.max(options.maxDurationMs ?? DEFAULT_RECORDING_DURATION_MS, 500), RECORDER_HARD_CAP_MS)
  }

  get isRecording() { return this.state === 'recording' }

  async start(): Promise<void> {
    if (this.state !== 'idle') throw new RecorderError('cancelled')
    const devices = this.options.mediaDevices ?? globalThis.navigator?.mediaDevices
    const Context = this.options.audioContextFactory ?? globalThis.AudioContext
    if (!devices?.getUserMedia || typeof Context !== 'function') throw new RecorderError('unsupported')
    this.state = 'starting'
    const generation = ++this.generation
    this.releaseRecordingQuiet = recordingQuietGate.acquire()
    const check = () => {
      if (generation !== this.generation || this.state !== 'starting') throw new RecorderError('cancelled')
    }
    try {
      // Construct/resume on the user gesture, not after an asynchronous permission dialog.
      this.context = new Context()
      if (!this.context.audioWorklet) throw new RecorderError('unsupported')
      await this.context.resume()
      check()
      const stream = await devices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
      if (generation !== this.generation || this.state !== 'starting') {
        stream.getTracks().forEach((track) => track.stop())
        throw new RecorderError('cancelled')
      }
      this.stream = stream
      const track = stream.getAudioTracks()[0]
      if (!track || track.readyState === 'ended') throw new RecorderError('device_ended')
      track.addEventListener('ended', this.handleDeviceEnded, { once: true })
      this.moduleUrl = URL.createObjectURL(new Blob([workletSource], { type: 'application/javascript' }))
      await this.context.audioWorklet.addModule(this.moduleUrl)
      check()
      this.source = this.context.createMediaStreamSource(stream)
      this.worklet = new AudioWorkletNode(this.context, 'basira-pcm-processor', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 })
      const sampleLimit = Math.ceil(this.context.sampleRate * this.maxDurationMs / 1000)
      this.worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!this.isRecording) return
        const value = event.data
        if (!(value instanceof Float32Array) || !value.length) return
        if (this.samples + value.length > sampleLimit) { this.terminate('too_long'); return }
        this.samples += value.length
        this.chunks.push(new Float32Array(value))
      }
      this.state = 'recording'
      // A zero-output worklet is a sink: no microphone monitoring or speaker echo.
      this.source.connect(this.worklet)
      this.timer = setTimeout(() => this.terminate('too_long'), this.maxDurationMs)
    } catch (error) {
      this.state = 'stopped'
      await this.teardown()
      if (error instanceof RecorderError) throw error
      const name = error instanceof DOMException ? error.name : ''
      throw new RecorderError(name === 'NotAllowedError' || name === 'SecurityError' ? 'permission_denied' : 'unsupported')
    }
  }

  async stop(): Promise<Blob> {
    if (!this.isRecording) throw new RecorderError(this.terminalIssue ?? 'cancelled')
    this.state = 'stopping'
    const rate = this.context?.sampleRate
    const chunks = this.chunks
    this.chunks = []
    await this.teardown()
    this.state = 'stopped'
    if (this.terminalIssue) throw new RecorderError(this.terminalIssue)
    if (!rate || !chunks.length) throw new RecorderError('empty')
    return encodeCapturedPcm(chunks, rate)
  }

  cancel(): void {
    ++this.generation
    this.terminalIssue = 'cancelled'
    this.state = 'stopped'
    this.chunks = []
    this.samples = 0
    void this.teardown()
  }

  private terminate(issue: RecorderIssue): void {
    if (this.state !== 'recording' && this.state !== 'starting') return
    ++this.generation
    this.terminalIssue = issue
    this.state = 'stopped'
    this.chunks = []
    this.samples = 0
    void this.teardown()
    this.options.onIssue?.(issue)
  }

  private readonly handleDeviceEnded = () => this.terminate('device_ended')

  private async teardown(): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    const { context, stream, worklet, source, moduleUrl } = this
    this.context = null
    this.stream = null
    this.worklet = null
    this.source = null
    this.moduleUrl = null
    worklet?.port.close()
    worklet?.disconnect()
    source?.disconnect()
    stream?.getTracks().forEach((track) => { track.removeEventListener('ended', this.handleDeviceEnded); track.stop() })
    if (moduleUrl) URL.revokeObjectURL(moduleUrl)
    if (context && context.state !== 'closed') {
      try { await context.close() } catch { /* The microphone tracks are already stopped. */ }
    }
    const releaseRecordingQuiet = this.releaseRecordingQuiet
    this.releaseRecordingQuiet = null
    releaseRecordingQuiet?.()
  }
}
