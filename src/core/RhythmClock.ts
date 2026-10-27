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
 * 对外发布的**当前网格**（KI-066）：拍网的原样快照，不是给听的那一层的第二份配置。
 * `bpm/beatsPerBar` 是听众唯一读的那两个数——"此刻是谁的拍"另有 `clockOwner`（F4 面板直接读它），
 * 塞进这条事件就是一个没有消费者的字段（§55）。
 *
 * `enter`（KI-069）只在网格**真的变了**那一次出现，内容是发布那一刻的 `barEntry()`：
 * 消费方是 `MusicLayer` 的"小节位置跟过去"。第一次发布也带上它（那一刻战斗层还没起，读了也无害），
 * 而同值重算不发（KI-066 那条纪律）——所以 `beatIndex` 每 tick 都在走这件事，不会把总线刷成流水账。
 */
export interface MusicGrid {
  bpm: number
  beatsPerBar: number
  enter?: { waitSec: number; beatIndex: number }
}

/**
 * Beat grid clock advanced by logic ticks so AI quantization stays deterministic
 * and headless-testable; the audio layer phase-locks WebAudio to this clock
 * (docs/KNOWN_ISSUES TD note: deviation from combat.md §17 audio-authoritative design).
 *
 * ⚠️ 上面那句 "the audio layer phase-locks WebAudio to this clock" 在 KI-066 之前只是**意图**：
 * 音频侧自己养了一份 `BPM = 84`，从不跟这里走。现在它是事实——网格变化（含第一次发布）由本类
 * 经 `audio.music.grid` 发布，`AudioEngine` 是唯一订阅者。
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

  /**
   * 最后一次**被听见**的网格。`null` = 还没喊过。
   * 之所以要记这个而不是每次改完就喊：`AISystem.syncClock` 每 tick 都会重算一次接管状态，
   * 幂等重算不该在总线上刷出 60 条/秒的同一个网格。
   */
  private published: MusicGrid | null = null

  /**
   * 只在网格**真的变了**（含第一次）时发布。**唯一调用点是 `update()`**，写在这里的三个改网格方法都不直接喊——
   * 因为"发布过"必须是"**被听见**过"：`main.ts` 的次序是「建钟 → `setBpm(84,4)` → 建 `AudioEngine`」，
   * 中间那次 `setBpm` 如果算作"已发布"，全场的战斗音乐就永远等不到拍网
   * （这一条不是推演：headless 探针按 main.ts 的顺序建钟→订阅→步进，实测 `grids: []` 加一条"没收到拍网"的 warn）。
   * 交给 `update()` 还有一个好处：只有循环在跑的时候才可能有耳朵。
   *
   * KI-069：载荷里从此还带 `enter`（发布那一刻的落点），但**变化判断只看 `bpm/beatsPerBar`**——
   * `enter.beatIndex` 每 tick 都在往前走，把它算进比较就等于每 tick 发一条（上面②那条纪律当场作废）。
   */
  private publishGrid(): void {
    const p = this.published
    if (p && p.bpm === this.bpm && p.beatsPerBar === this.beatsPerBar) return
    const g: MusicGrid = { bpm: this.bpm, beatsPerBar: this.beatsPerBar, enter: this.barEntry() }
    this.published = g
    bus.emit('audio.music.grid', g)
  }

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

  /**
   * §2.1「EncounterTrigger → `BeatClock.snapToNextBar()`（≤2 拍内进战斗曲）」——**只读查询**，
   * 不是字面那句"把钟 snap 过去"：移钟会连带挪走场上所有在飞招式的 hit-frame 量化（同一节给敌人的
   * 那条约束），为了音乐的落点去动玩法的拍，代价方向反了。所以这里只回答"该落在哪一拍、还要等多久"，
   * 由 `CombatManager` 在遭遇事件里交给音乐层。
   *
   * 两支：小节头在 `maxWaitBeats` 预算内 ⇒ 等小节头；够不着 ⇒ 夹到**下一拍点**，并且报的是那一拍的真拍号
   * （不假装是小节头）。这一条夹子是必需的，不是偷懒：4/4 下有一半时刻离小节头 >2 拍，
   * 「踩小节头」与「≤2 拍内进曲」在纯 next-bar 语义下不可能同时恒成立。
   *
   * 用的是**当前**网格（含 Boss 接管后的 `bpm/beatsPerBar`）——KI-066 那条所有权在这句话上继续成立。
   */
  barEntry(maxWaitBeats = 2): { waitSec: number; beatIndex: number } {
    const info = this.info()
    const beatSec = 60 / this.bpm
    const pos = info.beatInBar - 1 + info.phase // 小节内第几拍（0 起，含相位）
    if (pos === 0) return { waitSec: 0, beatIndex: info.beatIndex } // 正踩在小节头上
    const toHead = this.beatsPerBar - pos
    if (toHead <= maxWaitBeats) return { waitSec: toHead * beatSec, beatIndex: (info.bar + 1) * this.beatsPerBar }
    return { waitSec: (1 - info.phase) * beatSec, beatIndex: info.beatIndex + 1 }
  }

  update(dt: number): void {
    // 拍网的唯一发布点（暂停中也发：网格是"现在是多少"，不是"走没走"）
    this.publishGrid()
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
    /**
     * KI-066：拍网的原样快照（区域 `regions.json > grid` 或 Boss 接管后的当前值）。
     * 由本类独家发布、`AudioEngine` 独家消费 ⇒ 声明写在**主人**这里，不在 EventBus.ts 上开第二份。
     * 刻意不含 `drift`：那是 §15.2「拍寄生」给逻辑拍的亚拍级摆动，若把它灌进调度，
     * 每 tick 都在变的拍长会让 lookahead 里已排的拍与下一拍的间距不单调（听着就是乱拍）。
     */
    'audio.music.grid': MusicGrid
  }
}
