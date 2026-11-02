// Synthetic silent test recording only; production never imports this module.
export function syntheticWav(seconds = 0.5): Blob {
  const dataBytes = Math.round(seconds * 16000) * 2
  const bytes = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(bytes)
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
  }
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE')
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, dataBytes, true)
  return new Blob([bytes], { type: 'audio/wav' })
}
