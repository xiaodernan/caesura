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
    this.home.bpm = bpm
    this.home.beatsPerBar = beatsPerBar
    if (this.overridden) return // 正被 Boss 接管时，改的是基准，不是当前网格
    this.bpm = bpm
    this.beatsPerBar = beatsPerBar
  }

  /**
   * §15.2「区域网格由他接管」：Boss 的私有拍速是**叠在区域基准之上**的临时接管，
   * 必须还得回去——所以基准存在 `home` 里，接管只改当前值。
   * `overrideTo` 幂等（同值返回 false），让 AISystem 可以每 tick 重算而不抖动。
   */
  private home = { bpm: 84, beatsPerBar: 4 }
  private overridden = false
  get clockOwner(): 'region' | 'boss' { return this.overridden ? 'boss' : 'region' }

  overrideTo(bpm: number, beatsPerBar: number): boolean {
    if (this.overridden && this.bpm === bpm && this.beatsPerBar === beatsPerBar) return false
    this.overridden = true
    this.bpm = bpm
    this.beatsPerBar = beatsPerBar
    return true
  }

  restoreHome(): boolean {
    if (!this.overridden) return false
    this.overridden = false
    this.bpm = this.home.bpm
    this.beatsPerBar = this.home.beatsPerBar
    return true
  }

  get beat(): number { return this.beatAccum }

  /**
   * 当前网格的一拍有多长（tick）。凡是要把「N 拍」换算成逻辑帧的地方都用这一句，
   * 不再各自手写 `60/bpm*TICK_HZ`——被 Boss 接管时它就是 Boss 的拍长（§16 入场演出按她的拍演）。
   */
  get beatTicks(): number { return (60 / this.bpm) * TICK_HZ }

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
   * 命中帧量化（§2.1「敌人所有攻击的**命中帧**必须落在拍点或半拍点」）：
   * 还要等多少 tick 才会落到这些拍位上。拍位**允许小数**——1.5 = 第 1 拍的 "and"，
   * §14.5 幽灵八用 [1.5,2.5,3.5,4.5] 把自己写成「与全场反相」的一列数据。
   * 取所有目标拍位里最近的一个将来时刻（旧实现允许「本拍已过就打」，会让命中帧
   * 漂到拍间，正好毁掉反相读感；现在严格向前量化）。
   *
   * `leadTicks` = 这一招从起手到命中帧要走多少 tick。§2.1 约束的是**命中帧**而不是起手，
   * 所以要挑「来得及演完前摇」的那一拍：不足就整圈顺延到下一小节。传 0 = 旧语义（对齐起手）。
   */
  /**
   * 「此刻离这条拍网格有多远」（tick，无符号）。§2.1 写的 ±50ms 容差能不能信，
   * 就是拿这一句去量敌人命中帧那一 tick，而不是靠人眼看动画。
   */
  offsetFromBeatGrid(beatNumbers: number[]): number {
    const beatTicks = (60 / this.bpm) * TICK_HZ
    const now = this.info().beatInBar - 1 + this.info().phase
    let best = Infinity
    for (const t of beatNumbers) {
      let d = Math.abs(wrap(now - (t - 1), this.beatsPerBar))
      d = Math.min(d, this.beatsPerBar - d)
      if (d * beatTicks < best) best = d * beatTicks
    }
    return best
  }

  ticksUntilBeatOn(beatNumbers: number[], leadTicks = 0): number {
    const info = this.info()
    const beatTicks = (60 / this.bpm) * TICK_HZ
    const barTicks = this.beatsPerBar * beatTicks
    const now = info.beatInBar - 1 + info.phase
    let best = Infinity
    for (const t of beatNumbers) {
      let delta = wrap(t - 1 - now, this.beatsPerBar) * beatTicks
      while (delta < leadTicks - 0.5) delta += barTicks
      if (delta < best) best = delta
    }
    return Number.isFinite(best) ? Math.round(best) : 0
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
