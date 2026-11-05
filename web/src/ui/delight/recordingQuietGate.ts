export type QuietGateRelease = () => void
export type QuietGateListener = (locked: boolean) => void

type QuietMediaElement = HTMLAudioElement | HTMLVideoElement

function isQuietMediaElement(target: EventTarget | null): target is QuietMediaElement {
  return target instanceof Element && (target.tagName === 'AUDIO' || target.tagName === 'VIDEO')
}

class RecordingQuietGate {
  private activeRecordings = 0
  private readonly listeners = new Set<QuietGateListener>()
  private mediaListenerAttached = false

  get locked(): boolean {
    return this.activeRecordings > 0
  }

  acquire(): QuietGateRelease {
    const wasLocked = this.locked
    this.activeRecordings += 1
    if (!wasLocked) {
      this.quietExistingMedia()
      this.attachMediaListener()
      this.notify(true)
    }

    let released = false
    return () => {
      if (released) return
      released = true
      this.activeRecordings = Math.max(0, this.activeRecordings - 1)
      if (this.activeRecordings === 0) {
        this.detachMediaListener()
        this.notify(false)
      }
    }
  }

  subscribe(listener: QuietGateListener): QuietGateRelease {
    this.listeners.add(listener)
    if (this.locked) listener(true)
    return () => this.listeners.delete(listener)
  }

  private readonly handleMediaPlay = (event: Event): void => {
    if (!this.locked || !isQuietMediaElement(event.target)) return
    try { event.target.pause() } catch { /* A detached media element may already be unavailable. */ }
  }

  private quietExistingMedia(): void {
    if (typeof document === 'undefined') return
    for (const media of document.querySelectorAll<QuietMediaElement>('audio, video')) {
      if (media.paused) continue
      try { media.pause() } catch { /* A detached media element may already be unavailable. */ }
    }
  }

  private attachMediaListener(): void {
    if (this.mediaListenerAttached || typeof document === 'undefined') return
    document.addEventListener('play', this.handleMediaPlay, true)
    this.mediaListenerAttached = true
  }

  private detachMediaListener(): void {
    if (!this.mediaListenerAttached || typeof document === 'undefined') return
    document.removeEventListener('play', this.handleMediaPlay, true)
    this.mediaListenerAttached = false
  }

  private notify(locked: boolean): void {
    for (const listener of this.listeners) listener(locked)
  }
}

export const recordingQuietGate = new RecordingQuietGate()
