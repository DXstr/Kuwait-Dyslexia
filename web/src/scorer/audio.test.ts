// @vitest-environment node
import { describe, expect, it } from 'vitest'
import meta from '../../../contracts/fixtures/ScoreItemRequestMeta.example.json'
import { syntheticWav } from '../test/wav'
import type { ScoreItemRequestMeta } from '../contracts/basira'
import { scoreItemMultipart, validateWav } from './audio'

describe('canonical scorer audio transport', () => {
  it.each([0.3, 0.5, 15])('accepts %s seconds of 16 kHz mono 16-bit PCM without modification', async (seconds) => {
    const wav = syntheticWav(seconds)
    const before = await wav.arrayBuffer()
    await validateWav(wav)
    expect(await wav.arrayBuffer()).toEqual(before)
  })
  it.each([0.299, 15.001])('rejects out-of-contract duration %s', async (seconds) => {
    await expect(validateWav(syntheticWav(seconds))).rejects.toMatchObject({ issue: 'invalidAudio' })
  })
  it.each([
    { offset: 20, value: 3, width: 2, description: 'float encoding' },
    { offset: 22, value: 2, width: 2, description: 'stereo' },
    { offset: 24, value: 44100, width: 4, description: 'sample rate' },
    { offset: 28, value: 64000, width: 4, description: 'byte rate' },
    { offset: 32, value: 4, width: 2, description: 'block alignment' },
    { offset: 34, value: 8, width: 2, description: 'bit depth' },
    { offset: 40, value: 999999, width: 4, description: 'truncated data' },
    { offset: 4, value: 999999, width: 4, description: 'RIFF length' },
  ])('rejects invalid $description', async ({ offset, value, width }) => {
    const bytes = await syntheticWav().arrayBuffer()
    const view = new DataView(bytes)
    if (width === 2) view.setUint16(offset, value, true)
    else view.setUint32(offset, value, true)
    await expect(validateWav(new Blob([bytes]))).rejects.toMatchObject({ issue: 'invalidAudio' })
  })
  it('rejects empty, mislabeled non-WAV and oversized data', async () => {
    for (const audio of [new Blob([]), new Blob(['not a WAV'], { type: 'audio/wav' }), new Blob([new Uint8Array(10 * 1024 * 1024 + 1)])]) {
      await expect(validateWav(audio)).rejects.toMatchObject({ issue: 'invalidAudio' })
    }
  })
  it('sends audio bytes unchanged and metadata as a JSON string part without a private filename', async () => {
    const audio = syntheticWav()
    const input = meta as ScoreItemRequestMeta
    const encoded = scoreItemMultipart(audio, input)
    const request = new Request('https://scorer.example/score-item', { method: 'POST', headers: { 'Content-Type': encoded.contentType }, body: encoded.body })
    const form = await request.formData()
    const recording = form.get('audio')
    expect(recording).toBeInstanceOf(Blob)
    expect((recording as File).name).toBe('recording.wav')
    expect(await (recording as Blob).arrayBuffer()).toEqual(await audio.arrayBuffer())
    expect(typeof form.get('meta')).toBe('string')
    expect(JSON.parse(form.get('meta') as string)).toEqual(input)
    const text = await encoded.body.text()
    expect(text).toContain('name="meta"\r\nContent-Type: application/json')
    expect(text).not.toContain('name="meta"; filename=')
  })
})
