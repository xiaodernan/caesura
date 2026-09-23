/**
 * AudioEngine.ts — WebAudio 音频引擎（Phase 1 战斗原型，零采样纯合成）
 * 图结构：master → DynamicsCompressor → destination；master 前置总线 { sfx / music / ambience / ui }。
 * 3D：按 listener 位置算声像（StereoPanner）+ 距离衰减（listener 经 setListener 更新）。
 * 事件：订阅 bus 'audio.sfx' { key, pos?, gain? }；音乐遭遇由 music.ts 自行订阅。
 * AudioContext 必须在用户手势后 resume —— start() 于首次手势调用；
 * 若构造后即处 suspended，会挂一次性 pointerdown/keydown 自动恢复。
 */
import { bus, type GameEvents } from '../core/EventBus'
import { triggerSfx } from './synth'
import { MusicLayer } from './music'

/** 走 UI 总线、无空间化的按键类音色 */
const UI_KEYS = new Set(['ui_move', 'ui_select', 'lockon_on', 'lockon_off'])
/** 常驻瞬态并发上限（docs §9 性能红线的保守子集） */
const MAX_VOICES = 24
/** audio.md §破处决：一切声音 80ms 内塌向 100Hz；出来用 180ms（§5 休止出入的出侧同一个数） */
const MUFFLE_HZ = 100
const MUFFLE_FULL = 20000
const MUFFLE_IN = 0.08
const MUFFLE_OUT = 0.18

/**
 * 消音的目标频率与斜坡时长，单独抽出来是因为这几个数**是 spec 的读数**（audio.md §破处决 / §5），
 * 而 AudioEngine 本体要一个真的 AudioContext 才跑得动、在 node 里没法测。抽成纯函数后，
 * "塌到 100Hz / 80ms 进 / 180ms 出回全开"这件事第一次有断言钉着。
 */
export function muffleRamp(on: boolean): { hz: number; seconds: number } {
  return on ? { hz: MUFFLE_HZ, seconds: MUFFLE_IN } : { hz: MUFFLE_FULL, seconds: MUFFLE_OUT }
}

interface Graph {
  master: GainNode
  /** §5.4 处决演出的全频低通：常开在 20kHz（听不见它），塌下去时只剩低频残振 */
  muffle: BiquadFilterNode
  comp: DynamicsCompressorNode
  sfx: GainNode
  music: GainNode
  ambience: GainNode
  ui: GainNode
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private graph: Graph | null = null
  private musicLayer: MusicLayer | null = null
  private started = false
  private voices = 0
  private warned = new Set<string>()
  // listener 状态（世界坐标 + 朝向 yaw，弧度）
  private lx = 0
  private ly = 0
  private lz = 0
  private yaw = 0

  /** 一次性手势恢复：ctx suspended 时等待 pointerdown/keydown */
  private gesture = (): void => {
    this.ensureGraph()
    const ctx = this.ctx
    if (!ctx) return
    if (ctx.state === 'suspended') {
      void ctx.resume().then(() => { if (ctx.state === 'running') this.detachGesture() })
    } else {
      this.detachGesture()
    }
  }

  constructor() {
    bus.on('audio.sfx', (p) => this.onSfx(p))
    bus.on('audio.muffle', (p) => this.onMuffle(p.on))
    window.addEventListener('pointerdown', this.gesture)
    window.addEventListener('keydown', this.gesture)
  }

  /**
   * §5.4 处决演出的消音。挂在总线上的低通而不是逐个音源：设计说的是「一切声音塌下去」，
   * 一个个源去改等于给每类声音各写一遍豁免（漏一类就是一次听感 bug）。
   * 图还没建（首次手势前）时不处理——那时本来没有声音可闷，而建图后频率初值就是全开。
   */
  private onMuffle(on: boolean): void {
    const ctx = this.ctx
    const g = this.graph
    if (!ctx || !g || ctx.state !== 'running') return
    const now = ctx.currentTime
    const f = g.muffle.frequency
    f.cancelScheduledValues(now)
    f.setValueAtTime(f.value, now)
    const r = muffleRamp(on)
    f.exponentialRampToValueAtTime(r.hz, now + r.seconds)
  }

  /** 首次用户手势时调用：建图、resume、启动音乐层 */
  start(): void {
    this.ensureGraph()
    const ctx = this.ctx
    if (!ctx || !this.graph) return
    if (ctx.state === 'suspended') void ctx.resume()
    this.detachGesture()
    if (this.started) return
    this.started = true
    this.musicLayer = new MusicLayer(ctx, this.graph.music, this.graph.ambience)
    this.musicLayer.start()
  }

  /** 每帧调用（真实秒时步；调度内部以 ctx.currentTime 为准，dtReal 仅作调用节奏） */
  update(dtReal: number): void {
    if (dtReal < 0) return
    this.musicLayer?.update()
  }

  /** 更新听者位置与朝向（yaw：绕 Y 轴弧度，0 = 面向 -Z） */
  setListener(x: number, y: number, z: number, facingYaw: number): void {
    this.lx = x; this.ly = y; this.lz = z; this.yaw = facingYaw
  }

  /* ------------------------------------------------------------ */

  private detachGesture(): void {
    window.removeEventListener('pointerdown', this.gesture)
    window.removeEventListener('keydown', this.gesture)
  }

  private ensureGraph(): void {
    if (this.ctx) return
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    this.ctx = ctx

    const master = ctx.createGain()
    master.gain.value = 0.85
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.knee.value = 10
    comp.ratio.value = 3.5
    comp.attack.value = 0.004
    comp.release.value = 0.18
    const muffle = ctx.createBiquadFilter()
    muffle.type = 'lowpass'
    muffle.frequency.value = MUFFLE_FULL
    muffle.Q.value = 0.0001
    master.connect(muffle).connect(comp).connect(ctx.destination)

    const mk = (level: number): GainNode => {
      const g = ctx.createGain()
      g.gain.value = level
      g.connect(master)
      return g
    }
    this.graph = {
      master, muffle, comp,
      sfx: mk(0.9),
      music: mk(0.5),
      ambience: mk(0.45),
      ui: mk(0.8)
    }
  }

  private onSfx(p: GameEvents['audio.sfx']): void {
    const ctx = this.ctx
    const graph = this.graph
    if (!ctx || !graph || ctx.state !== 'running') return
    const base = p.gain ?? 1

    // UI / 无位置事件：直通对应总线，不空间化
    if (UI_KEYS.has(p.key) || !p.pos) {
      const busNode = UI_KEYS.has(p.key) ? graph.ui : graph.sfx
      this.play(ctx, busNode, p.key, base)
      return
    }

    // 3D：距离衰减 + 声像
    const rx = p.pos.x - this.lx
    const ry = p.pos.y - this.ly
    const rz = p.pos.z - this.lz
    const dist = Math.sqrt(rx * rx + ry * ry + rz * rz)
    const att = Math.min(1, 1 / (1 + Math.pow(dist / 16, 1.8)))
    if (att < 0.02) return
    const side = rx * Math.cos(this.yaw) - rz * Math.sin(this.yaw)
    const pan = Math.max(-1, Math.min(1, side / Math.max(2, dist))) * 0.85

    const vg = ctx.createGain()
    vg.gain.value = att
    const sp = ctx.createStereoPanner()
    sp.pan.value = pan
    vg.connect(sp).connect(graph.sfx)
    const dur = this.play(ctx, vg, p.key, base)
    window.setTimeout(() => { vg.disconnect(); sp.disconnect() }, (dur + 0.5) * 1000)
  }

  /** 触发合成并管理并发配额；返回发声时长（秒） */
  private play(ctx: AudioContext, out: AudioNode, key: string, gain: number): number {
    if (this.voices >= MAX_VOICES) return 0
    const dur = triggerSfx(ctx, out, key, ctx.currentTime, gain)
    if (dur <= 0 && !this.warned.has(key)) {
      this.warned.add(key)
      bus.emit('log', { level: 'warn', msg: `AudioEngine: 未知 SFX key "${key}"` })
    }
    this.voices++
    window.setTimeout(() => { this.voices-- }, Math.max(50, dur * 1000))
    return dur
  }
}
