import type { ScoreItemRequestMeta } from '../contracts/basira'
import { ScorerClientError } from './errors'

const MAX_AUDIO_BYTES = 10 * 1024 * 1024

/** Validate transport only; never normalize, resample, score or repair recording bytes. */
export async function validateWav(audio: Blob): Promise<void> {
  if (!(audio instanceof Blob) || audio.size < 44 || audio.size > MAX_AUDIO_BYTES) {
    throw new ScorerClientError('invalidAudio')
  }
  const bytes = await audio.arrayBuffer()
  const view = new DataView(bytes)
  const tag = (offset: number) => String.fromCharCode(...new Uint8Array(bytes, offset, 4))
  const invalid = () => { throw new ScorerClientError('invalidAudio') }
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.byteLength) invalid()
  let formatFound = false
  let dataFound = false
  let frames = 0
  let offset = 12
  while (offset + 8 <= bytes.byteLength) {
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    const end = start + size
    if (end > bytes.byteLength) invalid()
    const chunk = tag(offset)
    if (chunk === 'fmt ') {
      if (formatFound || size < 16) invalid()
      formatFound = true
      if (view.getUint16(start, true) !== 1 || view.getUint16(start + 2, true) !== 1 ||
          view.getUint32(start + 4, true) !== 16000 || view.getUint32(start + 8, true) !== 32000 ||
          view.getUint16(start + 12, true) !== 2 || view.getUint16(start + 14, true) !== 16) invalid()
    }
    if (chunk === 'data') {
      if (dataFound || size % 2 !== 0) invalid()
      dataFound = true
      frames = size / 2
    }
    offset = end + size % 2
  }
  const seconds = frames / 16000
  if (!formatFound || !dataFound || offset !== bytes.byteLength || seconds < 0.3 || seconds > 15) invalid()
}

export function scoreItemMultipart(audio: Blob, meta: ScoreItemRequestMeta) {
  const boundary = `basira-${crypto.randomUUID()}`
  // A Blob appended to FormData becomes a file part. The OpenAPI meta field is
  // instead a JSON *string*, with application/json and no filename. Explicit
  // framing preserves both requirements (and lets FastAPI parse it as a form field).
  const body = new Blob([
    `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="recording.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    audio,
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\nContent-Type: application/json\r\n\r\n`,
    JSON.stringify(meta),
    `\r\n--${boundary}--\r\n`,
  ])
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}
