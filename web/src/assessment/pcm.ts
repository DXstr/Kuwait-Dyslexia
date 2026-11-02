const PCM16_MAX = 0x7fff
const PCM16_MIN = -0x8000

export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array()
  if (channels.length === 1) return new Float32Array(channels[0])
  const length = Math.min(...channels.map((channel) => channel.length))
  const mono = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    let sum = 0
    for (const channel of channels) sum += channel[index]
    mono[index] = sum / channels.length
  }
  return mono
}

export function resampleMono(samples: Float32Array, sourceRate: number, targetRate = 16_000): Float32Array {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) {
    throw new Error('invalid_sample_rate')
  }
  if (samples.length === 0) return new Float32Array()
  if (sourceRate === targetRate) return new Float32Array(samples)
  const outputLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate))
  const output = new Float32Array(outputLength)
  const ratio = sourceRate / targetRate
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio
    const left = Math.floor(position)
    const right = Math.min(left + 1, samples.length - 1)
    const fraction = position - left
    output[index] = samples[left] * (1 - fraction) + samples[right] * fraction
  }
  return output
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
}

function sampleToPcm16(value: number) {
  const clipped = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0))
  return clipped < 0 ? Math.round(clipped * -PCM16_MIN) : Math.round(clipped * PCM16_MAX)
}

export function encodePcm16Wav(samples: Float32Array, sampleRate = 16_000): Blob {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error('invalid_sample_rate')
  if (samples.length === 0) throw new Error('empty_audio')
  const dataLength = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataLength, true)
  for (let index = 0; index < samples.length; index += 1) view.setInt16(44 + index * 2, sampleToPcm16(samples[index]), true)
  return new Blob([buffer], { type: 'audio/wav' })
}

export function encodeCapturedPcm(chunks: readonly Float32Array[], sourceRate: number): Blob {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  if (total === 0) throw new Error('empty_audio')
  const samples = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    samples.set(chunk, offset)
    offset += chunk.length
  }
  return encodePcm16Wav(resampleMono(samples, sourceRate), 16_000)
}
