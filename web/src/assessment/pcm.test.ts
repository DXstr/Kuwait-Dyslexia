import { describe, expect, it } from 'vitest'
import { downmixToMono, encodePcm16Wav, resampleMono } from './pcm'

describe('B6 WAV encoder', () => {
  it('downmixes multiple channels and resamples to the requested rate', () => {
    const mono = downmixToMono([new Float32Array([1, 0, -1, 0]), new Float32Array([0, 1, 0, -1])])
    expect([...mono]).toEqual([0.5, 0.5, -0.5, -0.5])
    expect(resampleMono(mono, 8_000, 16_000)).toHaveLength(8)
  })

  it('writes a genuine RIFF PCM16 mono 16 kHz header', async () => {
    const blob = encodePcm16Wav(new Float32Array([0, 0.5, -0.5, 1]), 16_000)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const view = new DataView(bytes.buffer)
    expect(blob.type).toBe('audio/wav')
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(8)
  })

  it('rejects empty clips rather than storing silence', () => {
    expect(() => encodePcm16Wav(new Float32Array(), 16_000)).toThrow('empty_audio')
  })
})
