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

  /**
   * §14.5 幽灵八的相位原语：**离最近的拍点还有多少 tick**（0 = 正踩在拍点上）。
   * 拍隙机制要求「拍点附近」和「拍点之间」是可比较的两段区间，用距离比用布尔干净：
   * 数据表直接写窗口半径（tick），消费方只做一次比较，容差不藏在代码里（§55）。
   */
  ticksFromBeatPoint(): number {
    const p = this.beatAccum % 1
    return Math.min(p, 1 - p) * (60 / this.bpm) * TICK_HZ
  }

  /**
   * 命中帧量化（§2.1「敌人所有攻击的命中帧必须落在拍点或半拍点」）：
   * 还要等多少 tick 才会落到这些拍位上。拍位**允许小数**——1.5 = 第 1 拍的 "and"，
   * §14.5 幽灵八用 [1.5,2.5,3.5,4.5] 把自己写成「与全场反相」的一列数据。
   * 取所有目标拍位里最近的一个将来时刻（旧实现允许「本拍已过就打」，会让命中帧
   * 漂到拍间，正好毁掉反相读感；现在严格向前量化）。
   */
  ticksUntilBeatOn(beatNumbers: number[]): number {
    const info = this.info()
    const beatTicks = (60 / this.bpm) * TICK_HZ
    const now = info.beatInBar - 1 + info.phase
    let best = Infinity
    for (const t of beatNumbers) {
      const delta = wrap(t - 1 - now, this.beatsPerBar)
      if (delta < best) best = delta
    }
    return Number.isFinite(best) ? Math.round(best * beatTicks) : 0
  }
}

/** 落在 [0, n) 的模（JS 的 % 对负数返回负值，小节位置必须是正的） */
function wrap(a: number, n: number): number {
  return ((a % n) + n) % n
}

declare module './EventBus' {
  interface GameEvents {
    'rhythm.beat': BeatInfo
  }
}
