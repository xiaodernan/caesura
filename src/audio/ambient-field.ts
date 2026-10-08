/**
 * ambient-field.ts — docs/audio.md §4 的 L2（颗粒声纹）／L3（物理动源）第一次有读者（KI-083）。
 *
 * 这一层与 `music.ts` 里那几层的关系：
 *  · L1 drone 与 L4 铃点是**持续音乐层**（挂在 `ambGain` 上、随 8 小节 crossfade 换区）；
 *  · L2／L3 是**声景层**：一条源 = 一个真位置 + 一次带通噪声爆发，**不参与 crossfade**——
 *    换区只是"下一声属于新区"，已经掷出去的那一声不抹（与 KI-066 那条"不篡改时间线"同源）。
 *
 * 位置是它存在的全部理由（§4「真位置」：走两步就换边），所以这里复用 `spatial.ts > spatialize`
 * 那条与 SFX 完全相同的数学；音色则全部由 `synth.playNoise` + 数据里那四格现推
 * （`hz` = 带通中心、`attackSec`/`durSec` = 包络、`peak` = 峰值）——**没有一样音色参数写在这里**。
 *
 * 两层在听感上怎么分（这一句是本实现的音色口径，不是文档的原文）：
 *  · `texture`（L2 颗粒声纹）= 窄带（高 Q）里的一颗 ⇒ 是"这个场所的质地"；
 *  · `motion`（L3 物理动源）= 宽带（低 Q）且一声之内边扫 ⇒ 是"有什么在动"。
 *
 * 与 §4 原文的差异记账：位置是真的（`spatialize` 按世界坐标算斜距与声像），但走的是
 * `StereoPanner` 而不是 `PannerNode + HRTF`——那一条与 SFX 共用，换就是两支读者整体换。
 */
import type { AmbienceBed, AmbienceSource } from '../data/schema'
import { disposeAfter, playNoise } from './synth'
import { AUDIBLE_FLOOR, spatialize, type ListenerPose } from './spatial'

/** L2 颗粒的带通 Q：窄 ⇒ 一颗"有音高的脆点" */
const TEXTURE_Q = 2.5
/** L3 动源的带通 Q：宽 ⇒ 有粗糙的"物体在动"感 */
const MOTION_Q = 0.8
/** 动源一声之内滑到中心频率的几成：`hz` 在数据里，"扫多少"是这一层的音色口径 */
const MOTION_SWEEP = 0.62
/** 收尾余量（秒）：`playNoise` 的链在 `end + 0.02` 才断，这只把手必须活得比它长 */
const TAIL_SEC = 0.1
/** 排到"此刻之后一点点"：`currentTime` 上调度是往过去排（WebAudio 会当场兑现，听感上是一次咔哒） */
const LOOKAHEAD_SEC = 0.02

/** 一条源 + 它下一次该响的时刻。间隔每次响完现掷（与 L4 铃点同一口径："到点再掷下一颗"） */
interface Live {
  src: AmbienceSource
  nextAt: number
}

/** [最短, 最长] 里现掷一个数。与 `music.ts > rnd` 同一个三行惯用法，各自本地实现 */
function pick(range: [number, number]): number {
  return range[0] + Math.random() * (range[1] - range[0])
}

/**
 * 一区的 L2／L3。生命周期与**床**一致（`MusicLayer` 建一只、随床换），
 * 但图上的东西是"一次一声、响完即弃"，所以没有常驻节点、也没有 `dispose()` 要收的尾巴：
 * 每一条链的回收挂在 `playNoise` 的 `onended` 与 `disposeAfter` 的哑源上（KI-071 那本账）。
 */
export class AmbienceField {
  private bed: AmbienceBed | null = null
  private live: Live[] = []
  /** 听者位姿。没有它就算不出声像，所以开局给原点（`AudioEngine` 每帧都会覆盖） */
  private pose: ListenerPose = { x: 0, y: 0, z: 0, yaw: 0 }
  /**
   * §5.9.33③ 声景增益腿：`weather.json > gameplay.ambienceGain`，每一声的距离衰减再乘它。
   * 1 = 这一格天气不放大 L2／L3（今天五张床里只有钟坠院那一格会在风暴期变成 1.5）。
   * ≤0 按 1 收：校验器（判据 G3）不许表里出现 0，这里守的是直接调用的一条退路。
   */
  private weatherGain = 1

  constructor(private ctx: AudioContext, private out: AudioNode) {}

  /**
   * 换床。同一张床重发一次都不动（与 `applyBed` 的"同一张床重发不动图"同一口径）。
   * 换床时**下一声的时刻重掷**：旧床那一颗在飞的不抹，但"下一次什么时候来"从此属于新区。
   */
  setBed(bed: AmbienceBed | null): void {
    if (bed === this.bed) return
    this.bed = bed
    const now = this.ctx.currentTime
    this.live = (bed?.sources ?? []).map((src) => ({ src, nextAt: now + pick(src.everySec) }))
  }

  setListener(pose: ListenerPose): void {
    this.pose = pose
  }

  /**
   * 换天气增益（§5.9.33③）。与 `setListener` 同一条理由：这里只**存读数**，不算画面——
   * 已经在飞的那一声不抹（KI-066 那条"不篡改时间线"），新乘数从下一声起生效。
   */
  setWeatherGain(mul: number): void {
    this.weatherGain = mul > 0 ? mul : 1
  }

  /**
   * 每帧调用。**每条源每帧最多响一声**：调度落后（标签页被节流，KI-067 量过的那种）时把欠的补回来，
   * 在这里听感上是"把过去十秒的声景砸进这一帧"——而这一层没有拍点要对齐，代价只是少响几声。
   */
  update(): void {
    const now = this.ctx.currentTime
    for (const l of this.live) {
      if (now < l.nextAt) continue
      this.spawn(l.src, now + LOOKAHEAD_SEC)
      l.nextAt = now + pick(l.src.everySec)
    }
  }

  /** 掷一声：算位置 → 建两只把手 → 交给 `playNoise` */
  private spawn(src: AmbienceSource, t: number): void {
    const { att, pan } = spatialize(src.pos, this.pose)
    // 听不见的源**不建节点**：省下的不是音量，是一条噪声链 + 一只声像（§9 的声部账）
    if (att < AUDIBLE_FLOOR) return
    const motion = src.layer === 'motion'
    const gain = this.ctx.createGain()
    // 天气乘数乘在**距离衰减之后**：`spatialize` 那条数学是全部 SFX 共用的唯一主人（KI-083），
    // 在这里改它就等于给一次性音效也加上天气脾气。要放大的是"这一格天气的声景"，不是整个距离模型。
    gain.gain.value = att * this.weatherGain
    const panner = this.ctx.createStereoPanner()
    panner.pan.value = pan
    gain.connect(panner).connect(this.out)
    const end = playNoise(this.ctx, gain, t, {
      type: 'bandpass',
      f0: src.hz,
      f1: motion ? src.hz * MOTION_SWEEP : undefined,
      Q: motion ? MOTION_Q : TEXTURE_Q,
      attack: src.attackSec,
      decay: src.durSec,
      peak: src.peak,
    })
    // 这两只把手不是 `playNoise` 的链里的一员（它只收自己建的三只），所以要自己收尾：
    // 走哑源那条路（音频时间轴）而不是墙钟——KI-071 记的就是这两条时间轴不是同一条。
    disposeAfter(this.ctx, this.out, end + TAIL_SEC, [gain, panner])
  }
}
