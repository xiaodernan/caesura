/**
 * music.ts — 极简音乐层（Phase 1）
 *  · 休垒 ambience：C Dorian 持续低音 drone + 随机"音色石铃"泛音（5–9s 一颗，docs §4）
 *  · 战斗层：进入战斗淡入脉冲鼓 + 低音 ostinato（R-1 派生），脱战 4s 淡出
 * 事件驱动：订阅 bus 'audio.music.encounter'（本文件 declare module 扩展 GameEvents，勿改 EventBus.ts）。
 *
 * **拍网不是这里的东西**（KI-066）：这一层曾经自带 `const BPM = 84`，于是全场有了两个主人——
 * `RhythmClock` 吃 `regions.json > grid` 与 Boss 的 `overrideTo`，而战斗曲永远按 84/4 演。
 * 结果 docs/audio.md §2.1「音乐重拍与敌人主攻击对齐」在奥斯塔拉（表里 108BPM、3/4，实机量到同一对数）身上是假的。
 * 现在拍长与小节形状由 `setGrid()` 注入（`AudioEngine` 转发 `audio.music.grid`），这里不再留副本。
 */
import { bus } from '../core/EventBus'
import type { MusicGrid } from '../core/RhythmClock'
import { playBell, playNoise, playSweep } from './synth'

declare module '../core/EventBus' {
  interface GameEvents {
    // 与 src/combat/CombatManager.ts 的发射契约一致：{ start: boolean }
    // `cut`（§16 胜利序列）：start=false 时**立刻**掐掉战斗层，不走脱战那条 4s 淡出
    'audio.music.encounter': { start: boolean; cut?: boolean }
  }
}

/** C Dorian 五声音阶化铃点（C5 Eb5 F5 G5 A5 Bb5） */
const CHIME_PITCHES = [523.25, 622.25, 698.46, 783.99, 880, 932.33]
/** 低音 ostinato：R-1 动机 C-Eb-G-Bb 的低八度节奏化（docs §1.2 音乐宪法） */
const OSTINATO = [65.41, 65.41, 98.0, 155.56, 116.54, 65.41, 77.78, 98.0]

export class MusicLayer {
  private ambGain: GainNode
  private battleGain: GainNode
  private bassLp: BiquadFilterNode
  private droneNodes: AudioNode[] = []
  private nextBeat = 0
  private beatIdx = 0
  private nextChime = 0
  private battleOn = false
  private battleStopAt = 0
  private offEncounter: (() => void) | null = null
  /** 0 = 还没收到网格。收到之前不排拍：这里猜一个 BPM 就是 KI-066 要删掉的那份副本 */
  private bpm = 0
  private beatsPerBar = 0
  private warnedNoGrid = false

  constructor(
    private ctx: AudioContext,
    musicOut: AudioNode,
    ambOut: AudioNode,
    grid: MusicGrid | null
  ) {
    this.setGrid(grid)
    this.ambGain = ctx.createGain()
    this.ambGain.gain.value = 0
    this.ambGain.connect(ambOut)
    this.battleGain = ctx.createGain()
    this.battleGain.gain.value = 0
    this.battleGain.connect(musicOut)
    this.bassLp = ctx.createBiquadFilter()
    this.bassLp.type = 'lowpass'
    this.bassLp.frequency.value = 320
    this.bassLp.Q.value = 0.7
    this.bassLp.connect(this.battleGain)
  }

  /**
   * 换网格只改**下一拍之后**的拍长：已经排进 WebAudio 时间线的拍一张都不抹
   * （抹 = 听觉上的 glitch，而 docs §2.1 要的是"进出只在乐句边界"那种可预期的变化）。
   * `beatIdx` 也不归零——小节形状变了就让它在新的模上继续走，重排小节头会打断正在演的那一拍。
   */
  setGrid(grid: MusicGrid | null): void {
    if (!grid) return
    this.bpm = grid.bpm
    this.beatsPerBar = grid.beatsPerBar
  }

  /** 一拍有多长（秒）；没有网格 = 0，`update` 用它当"能不能排"的门 */
  private get beatSec(): number {
    return this.bpm > 0 ? 60 / this.bpm : 0
  }

  /** 启动 ambience + 订阅遭遇事件（AudioEngine 建图后调用一次） */
  start(): void {
    const now = this.ctx.currentTime
    this.startDrone(now)
    this.ambGain.gain.setValueAtTime(0, now)
    this.ambGain.gain.linearRampToValueAtTime(0.6, now + 3)
    this.nextChime = now + 4
    if (!this.offEncounter) {
      this.offEncounter = bus.on('audio.music.encounter', (p) => this.onEncounter(p.start, p.cut ?? false))
    }
  }

  dispose(): void {
    this.offEncounter?.()
    this.offEncounter = null
    for (const n of this.droneNodes) {
      if ('stop' in n && typeof (n as OscillatorNode).stop === 'function') {
        try { (n as OscillatorNode).stop() } catch { /* ok */ }
      }
      n.disconnect()
    }
    this.droneNodes = []
  }

  /** L1 drone：C2 锯齿暖底（-24dB 级）+ 正弦sub + 五度泛音，缓慢呼吸 */
  private startDrone(now: number): void {
    const ctx = this.ctx
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 240
    lp.connect(this.ambGain)
    const spec: Array<{ f: number; type: OscillatorType; peak: number; detune: number }> = [
      { f: 65.41, type: 'sawtooth', peak: 0.035, detune: -5 },
      { f: 65.41, type: 'sawtooth', peak: 0.03, detune: 6 },
      { f: 65.41, type: 'sine', peak: 0.05, detune: 0 },
      { f: 98.0, type: 'sine', peak: 0.012, detune: 2 }
    ]
    for (const s of spec) {
      const osc = ctx.createOscillator()
      osc.type = s.type
      osc.frequency.value = s.f
      osc.detune.value = s.detune
      const g = ctx.createGain()
      g.gain.value = s.peak
      osc.connect(g).connect(lp)
      osc.start(now)
      this.droneNodes.push(osc, g)
    }
    // 风箱呼吸 LFO 0.07Hz ±10%
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.07
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.008
    lfo.connect(lfoGain).connect(this.ambGain.gain)
    lfo.start(now)
    this.droneNodes.push(lfo, lfoGain, lp)
  }

  /** 遭遇事件入口：start=true 淡入战斗层；false 淡出（`cut` ⇒ 立刻切，§16 胜利序列的"音乐停"） */
  onEncounter(start: boolean, cut = false): void {
    const now = this.ctx.currentTime
    const g = this.battleGain.gain
    if (start) {
      if (!this.battleOn) {
        this.beatIdx = 0
        this.nextBeat = now + 0.1
      }
      this.battleOn = true
      this.battleStopAt = 0
      g.cancelScheduledValues(now)
      g.setValueAtTime(g.value, now)
      g.linearRampToValueAtTime(0.9, now + 1.2) // 淡入。拍长已跟网格（KI-066），**相位**仍未锁：入战第一拍是 `now+0.1`，不是 §2.1 的 snapToNextBar
    } else if (cut) {
      // §16「音乐停=世界屏息」：0.5s 的安静要被听得出来，所以这里没有渐变的余地。
      this.battleOn = false
      this.battleStopAt = 0
      this.nextBeat = 0
      g.cancelScheduledValues(now)
      g.setValueAtTime(0, now)
    } else if (this.battleOn) {
      this.battleOn = false
      this.battleStopAt = now + 4
      g.cancelScheduledValues(now)
      g.setValueAtTime(g.value, now)
      g.linearRampToValueAtTime(0, now + 4)     // 脱战 4s 淡出
    }
  }

  /** 每帧调用（AudioEngine.update 驱动）：lookahead 调度，节点即用即弃 */
  update(): void {
    const now = this.ctx.currentTime
    // 音色石铃：5–9s 一颗（docs §4 L4 稀疏事件）
    if (now >= this.nextChime) {
      const f = CHIME_PITCHES[Math.floor(Math.random() * CHIME_PITCHES.length)]
      playBell(this.ctx, this.ambGain, now + 0.02, f, { dur: rnd(3.5, 6), peak: rnd(0.02, 0.05), hammer: Math.random() < 0.4 })
      this.nextChime = now + rnd(5, 9)
    }
    // 战斗层调度
    const scheduling = this.battleOn || (this.battleStopAt > 0 && now < this.battleStopAt)
    if (!scheduling) return
    if (this.beatSec === 0) {
      // 没有网格就一声都不排，并且**说出来**：静悄悄地没有战斗音乐会被读成"引擎坏了"，
      // 而真实原因是 RhythmClock 的 `audio.music.grid` 没接到这一层（装配腿回归时第一时间要看得见）。
      if (!this.warnedNoGrid) {
        this.warnedNoGrid = true
        bus.emit('log', { level: 'warn', msg: 'music: 没收到拍网（audio.music.grid），战斗层不排拍' })
      }
      return
    }
    if (this.nextBeat === 0) this.nextBeat = now + 0.05
    /**
     * KI-067：落后超过**一拍**时重新锚定，不补排欠账。下面那道 `while` 的循环条件是
     * `nextBeat < now + 0.25`，而每次排出去的时刻都被 `Math.max(nextBeat, now + 0.02)` 抬到"现在"——
     * 于是 `update()` 一旦长时间没跑（标签页被切走、后台节流：rAF 停了而 WebAudio 钟照走），
     * 回来那一帧会把整段欠账砸在同一个时刻。这不是推演：实机晾 22 秒之后读到 **31 拍全落在
     * `ctx.currentTime = 53.372`**，听感等价于一记机枪（headless 同一形状的复现是一帧 28 拍）。
     *
     * 门限为什么是「一拍」而不是「N 秒」：落后不到一拍本来就在这道循环的**吸收范围**里
     * （它一轮最多排 `ceil(0.25/拍长)+1` 个，一次卡顿该补的拍要补上，不然掉拍是听得出来的）；
     * 超过一拍就说明这段时间根本没在演，补排等于把历史砸进现在。
     * 这条边界有对照用例钉着，而**能**钉住它的只有"整程按 0.5s 一帧"那个世界：一记 0.3s 的轻 hitch
     * 够不到门限边上（循环每轮都把 `nextBeat` 抬到 `now+0.25` 之外），所以把门限写成 `> 0`
     * 在轻 hitch 里读数完全一样 —— 这是变异探针 P2 第一次不咬时量出来的（见 §5.9.10）。
     */
    const behind = now - this.nextBeat
    if (behind > this.beatSec) {
      this.nextBeat = now + 0.05
      bus.emit('log', { level: 'warn', msg: `music: 调度落后 ${behind.toFixed(2)}s，跳过 ${Math.round(behind / this.beatSec)} 拍重新锚定（不补排欠账）` })
    }
    while (this.nextBeat < now + 0.25 && (!this.battleStopAt || this.nextBeat < this.battleStopAt)) {
      this.scheduleBeat(Math.max(this.nextBeat, now + 0.02), this.beatIdx)
      this.nextBeat += this.beatSec
      this.beatIdx++
    }
    // 这里原有四行"淡出到点把 battleStopAt/nextBeat 归零"，被 KI-065 的覆盖率读数证明永远跑不到：
    // 上面那句 `scheduling` 要求 `now < battleStopAt` 才会往下走，而那段的前提是 `now >= battleStopAt`。
  }

  /**
   * 脉冲鼓 + ostinato：鼓点按**当前网格的小节形状**走（区域 4/4、奥斯塔拉 3/4）。
   * 第 1、3 拍驼鼓，其余拍军鼓边击 —— 4/4 下就是原来的 1/3 驼鼓、2/4 军鼓；
   * 3/4 下成为"咚-哒-咚"的玛祖卡低音（§6.1 的弹反重拍落在第 1 拍）。
   */
  private scheduleBeat(t: number, i: number): void {
    const ctx = this.ctx
    const pos = i % this.beatsPerBar
    const kick = pos === 0 || pos === 2
    if (kick) {
      playSweep(ctx, this.battleGain, t, { f0: 150, f1: 46, dur: 0.28, peak: 0.42 }) // 驼鼓
      playNoise(ctx, this.battleGain, t, { type: 'lowpass', f0: 300, decay: 0.02, peak: 0.2 })
    } else {
      playNoise(ctx, this.battleGain, t, { type: 'highpass', f0: 1400, decay: 0.08, peak: 0.09 }) // 军鼓/边击
      playSweep(ctx, this.battleGain, t, { f0: 200, f1: 170, dur: 0.05, peak: 0.12 })
    }
    // 低音 ostinato（八分推进感：每拍 + 反拍短音）
    const root = OSTINATO[i % OSTINATO.length]
    playSweep(ctx, this.bassLp, t, { f0: root, dur: 0.22, peak: 0.24, type: 'sawtooth' })
    playSweep(ctx, this.bassLp, t + this.beatSec * 0.5, { f0: root * 2, dur: 0.1, peak: 0.08, type: 'sawtooth' })
    // 每两小节一次钟 accent（奥斯塔拉"节拍即机制"底色）：周期跟着小节形状走，不是固定的 8 拍
    if (i % (2 * this.beatsPerBar) === 0) playBell(ctx, this.battleGain, t, 65.41 * 4, { dur: 2.4, peak: 0.06, hammer: false })
  }
}

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a)
}
