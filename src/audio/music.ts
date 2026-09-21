/**
 * music.ts — 极简音乐层（Phase 1）
 *  · 休垒 ambience：C Dorian 持续低音 drone + 随机"音色石铃"泛音（5–9s 一颗，docs §4）
 *  · 战斗层：进入战斗淡入 84BPM 脉冲鼓 + 低音 ostinato（R-1 派生），脱战 4s 淡出
 * 事件驱动：订阅 bus 'audio.music.encounter'（本文件 declare module 扩展 GameEvents，勿改 EventBus.ts）。
 */
import { bus } from '../core/EventBus'
import { playBell, playNoise, playSweep } from './synth'

declare module '../core/EventBus' {
  interface GameEvents {
    // 与 src/combat/CombatManager.ts 的发射契约一致：{ start: boolean }
    'audio.music.encounter': { start: boolean }
  }
}

const BPM = 84
const BEAT_SEC = 60 / BPM
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

  constructor(private ctx: AudioContext, musicOut: AudioNode, ambOut: AudioNode) {
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

  /** 启动 ambience + 订阅遭遇事件（AudioEngine 建图后调用一次） */
  start(): void {
    const now = this.ctx.currentTime
    this.startDrone(now)
    this.ambGain.gain.setValueAtTime(0, now)
    this.ambGain.gain.linearRampToValueAtTime(0.6, now + 3)
    this.nextChime = now + 4
    if (!this.offEncounter) {
      this.offEncounter = bus.on('audio.music.encounter', (p) => this.onEncounter(p.start))
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

  /** 遭遇事件入口：start=true 淡入战斗层；false 4s 淡出 */
  onEncounter(start: boolean): void {
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
      g.linearRampToValueAtTime(0.9, now + 1.2) // 淡入（重拍对齐交给 RhythmClock 层，Phase 1 简化）
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
    if (this.nextBeat === 0) this.nextBeat = now + 0.05
    while (this.nextBeat < now + 0.25 && (!this.battleStopAt || this.nextBeat < this.battleStopAt)) {
      this.scheduleBeat(Math.max(this.nextBeat, now + 0.02), this.beatIdx)
      this.nextBeat += BEAT_SEC
      this.beatIdx++
    }
    if (!this.battleOn && this.battleStopAt && now >= this.battleStopAt) {
      this.battleStopAt = 0
      this.nextBeat = 0
    }
  }

  /** 84BPM 脉冲鼓 + ostinato：鼓点按小节 4/4（kick 1/3 拍、军鼓边击 2/4 拍） */
  private scheduleBeat(t: number, i: number): void {
    const ctx = this.ctx
    const pos = i % 4
    if (pos === 0 || pos === 2) {
      playSweep(ctx, this.battleGain, t, { f0: 150, f1: 46, dur: 0.28, peak: 0.42 }) // 驼鼓
      playNoise(ctx, this.battleGain, t, { type: 'lowpass', f0: 300, decay: 0.02, peak: 0.2 })
    }
    if (pos === 1 || pos === 3) {
      playNoise(ctx, this.battleGain, t, { type: 'highpass', f0: 1400, decay: 0.08, peak: 0.09 }) // 军鼓/边击
      playSweep(ctx, this.battleGain, t, { f0: 200, f1: 170, dur: 0.05, peak: 0.12 })
    }
    // 低音 ostinato（八分推进感：每拍 + 反拍短音）
    const root = OSTINATO[i % OSTINATO.length]
    playSweep(ctx, this.bassLp, t, { f0: root, dur: 0.22, peak: 0.24, type: 'sawtooth' })
    playSweep(ctx, this.bassLp, t + BEAT_SEC * 0.5, { f0: root * 2, dur: 0.1, peak: 0.08, type: 'sawtooth' })
    // 每两小节一次钟 accent（奥斯塔拉"节拍即机制"底色）
    if (i % 8 === 0) playBell(ctx, this.battleGain, t, 65.41 * 4, { dur: 2.4, peak: 0.06, hammer: false })
  }
}

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a)
}
