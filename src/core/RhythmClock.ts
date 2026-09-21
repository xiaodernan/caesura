import { bus } from './EventBus'
import { TICK_HZ } from './Time'

export interface BeatInfo {
  beatIndex: number
  beatInBar: number
  bar: number
  isBarStart: boolean
  phase: number
}

/**
 * Beat grid clock advanced by logic ticks so AI quantization stays deterministic
 * and headless-testable; the audio layer phase-locks WebAudio to this clock
 * (docs/KNOWN_ISSUES TD note: deviation from combat.md §17 audio-authoritative design).
 */
export class RhythmClock {
  bpm = 84
  beatsPerBar = 4
  private beatAccum = 0
  private lastBeat = -1
  paused = false
  drift = 0

  setBpm(bpm: number, beatsPerBar = this.beatsPerBar): void {
    this.bpm = bpm
    this.beatsPerBar = beatsPerBar
  }

  get beat(): number { return this.beatAccum }

  /** seconds until next integer beat (for telegraph alignment) */
  get toNextBeatSec(): number {
    const beatSec = 60 / this.bpm
    return (Math.floor(this.beatAccum) + 1 - this.beatAccum) * beatSec
  }

  info(): BeatInfo {
    const beatIndex = Math.floor(this.beatAccum)
    return {
      beatIndex,
      beatInBar: ((beatIndex % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar + 1,
      bar: Math.floor(beatIndex / this.beatsPerBar),
      isBarStart: beatIndex % this.beatsPerBar === 0,
      phase: this.beatAccum - beatIndex
    }
  }

  /** true if current time within +/- ms of a beat point */
  onBeat(toleranceMs = 50): boolean {
    const p = this.beatAccum % 1
    const tol = (toleranceMs / 1000) * (this.bpm / 60)
    return p < tol || p > 1 - tol
  }

  update(dt: number): void {
    if (this.paused) return
    this.beatAccum += dt * (this.bpm / 60) * (1 + this.drift)
    const b = Math.floor(this.beatAccum)
    if (b !== this.lastBeat) {
      this.lastBeat = b
      bus.emit('rhythm.beat', this.info())
    }
  }

  /** how many ticks until the beat lands on one of given beatInBar values (1-based) */
  ticksUntilBeatOn(beatNumbers: number[]): number {
    const info = this.info()
    for (let i = 0; i <= this.beatsPerBar * 2; i++) {
      const candidate = ((info.beatInBar - 1 + i) % this.beatsPerBar) + 1
      if (beatNumbers.includes(candidate)) {
        const beatSec = 60 / this.bpm
        const ticks = (i - info.phase) * beatSec * TICK_HZ
        return Math.max(0, Math.round(ticks))
      }
    }
    return 0
  }
}

declare module './EventBus' {
  interface GameEvents {
    'rhythm.beat': BeatInfo
  }
}
