/**
 * AudioEngine.ts — WebAudio 音频引擎（Phase 1 战斗原型，零采样纯合成）
 * 图结构：master → DynamicsCompressor → destination；master 前置总线 { sfx / music / ambience / ui }。
 * 3D：按 listener 位置算声像（StereoPanner）+ 距离衰减（listener 经 setListener 更新）。
 * 事件：订阅 bus 'audio.sfx' { key, pos?, gain? }、'audio.music.grid'（拍网，KI-066）、
 * 'combat.parried'（§8.2 侧链的触发，KI-092）与
 * 'audio.music.ambience'（环境声床 id → 行，KI-077）、'audio.music.explore'（探索曲 id → 行，KI-079）；
 * 音乐遭遇由 music.ts 自行订阅。这两条 id→行 的解析都住在本类：它是"表 + 图"两头都看得见的那一层。
 * AudioContext 必须在用户手势后 resume —— start() 于首次手势调用；
 * 若构造后即处 suspended，会挂一次性 pointerdown/keydown 自动恢复。
 */
import { bus, type GameEvents } from '../core/EventBus'
import type { MusicGrid } from '../core/RhythmClock'
import { ambienceBeds, battleScores, duckingRows, exploreScores } from '../data'
import type { AmbienceBed, BattleScore, ExploreScore } from '../data/schema'
import { triggerSfx } from './synth'
import { MusicLayer } from './music'
// KI-083：声源→听者那一步的唯一主人（一次性 SFX 与 §4 的 L2／L3 声景层两条读者共用同一份数学）
import { AUDIBLE_FLOOR, spatialize, type ListenerPose } from './spatial'
// KI-092：§8.2 侧链的数学与总线名册（dB→增益、叠压取最深、四条总线的基准电平都只在这里列一次）
import { BUS_BASE, DUCK_TC_SEC, activeDucks, deepestFactor, duckFactor, type DuckBusName, type DuckRequest } from './ducking'

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
  /**
   * 四条前置总线，名字与基准电平都由 `ducking.ts > BUS_BASE` 一家管（KI-092）。
   * 这里原来是 `sfx/music/ambience/ui` 四个字段配四次 `mk(0.9)`——那份电平数在侧链要"弹回基准"
   * 时就必须有第二份读数，收成一格一名之后侧链不需要抄任何数。
   */
  buses: Record<DuckBusName, GainNode>
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private graph: Graph | null = null
  private musicLayer: MusicLayer | null = null
  /**
   * 最后收到的拍网（KI-066）。要在这里缓存是因为**建层比建引擎晚**：`RhythmClock` 第一次发布发生在
   * 逻辑循环的第一 tick，而 `MusicLayer` 要等首次用户手势建图才存在。缓存 = 那中间的变化不丢。
   */
  private grid: MusicGrid | null = null
  /**
   * 最后收到的环境声床**行**（KI-077）。缓存理由与上面那一条**一字不差**：建层比建引擎晚，
   * 而 `main.ts` 开局那一句 `'audio.music.ambience'` 正是在建图之前发的（首次手势之前）。
   *
   * 存的是行而不是 id：解析只发生一次、就在这层（它同时看得见 `ambienceBeds` 与 `MusicLayer`），
   * 音乐层只接收形状，不认表。id 认不出时**保留上一张床**并说一次——换区失败不该让底噪断掉。
   */
  private bed: AmbienceBed | null = null
  /**
   * 最后收到的探索曲**行**（KI-079）。缓存与解析的理由与上面那一条完全相同——
   * 而建图那一刻要把两支一起交给 `MusicLayer`：只给床不给曲，开局那一区就永远没有旋律
   * （`main.ts` 的那两句都在首次手势之前发，之后不会再发，直到玩家真的跨区为止）。
   */
  private song: ExploreScore | null = null
  /**
   * 最后收到的战斗档**行**（KI-080）。缓存与解析的理由与上面两条一字不差，而它多一条自己的理由：
   * 战斗层只在交战时才响，若开局那一句不缓存，第一次进战斗就没有行 ⇒ 音乐层那句"没收到战斗档"
   * 会在每次新档的开局各响一次，而它本来只该在**装配断了**的时候响。
   */
  private battle: BattleScore | null = null
  /** 认不出的声床 id 每个只说一次（与 `warned` 那本 SFX 名册同一口径：刷屏会把真信号埋掉） */
  private warnedBed = new Set<string>()
  /** 认不出的探索曲 id 同上（单独一本：与上面那本共用会让先说话的那条静音另一条） */
  private warnedSong = new Set<string>()
  /** 认不出的战斗档 id 同上，第三本（同一句话的三个主人各自记账） */
  private warnedBattle = new Set<string>()
  private started = false
  private voices = 0
  private warned = new Set<string>()
  /**
   * 听者位姿（世界坐标 + 朝向 yaw，弧度）。KI-083 起它是一个对象而不是四个散字段：它现在有
   * **两个读者**——一次性 SFX（`onSfx`）与 §4 的 L2／L3 声景层（`MusicLayer` 转交给 `AmbienceField`）。
   * 位姿的主人仍然只有这里：`main.ts` 每帧调 `setListener`，别人只读。
   */
  private pose: ListenerPose = { x: 0, y: 0, z: 0, yaw: 0 }
  /**
   * 在场的侧链请求（§8.2，KI-092）。它挂在引擎上而不是算完就走，是因为**到期要自己发生**：
   * 表里的 `holdSec` 说的是"压住 300ms"，300ms 之后必须有人在那条总线上把电平写回基准。
   * `onMuffle` 不需要这份状态，因为那一格的开与关都由发射方各说一次（`{ on: boolean }`）。
   */
  private ducks: DuckRequest[] = []
  /** 上一次写给每条总线的那一格。只有它变了才再排一次自动化——每帧重贴会把同一条斜坡不断往后推 */
  private duckApplied: Record<string, number> = {}

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
    // KI-092（docs §8.2「弹反成功 | MUSIC+AMB | -6dB / 300ms」那一行）：触发口的合法名单**主人就是
    // 这里 `onDuckTrigger('…')` 的那个字面量**——校验器从本文件现推它，所以加一行表却不接这一句，
    // 数据门禁会直接红（那一行没有执行口），而只接这一句却不给行，白订阅同样红。
    bus.on('combat.parried', () => this.onDuckTrigger('combat.parried'))
    // KI-066：拍网向唯一主人领，不再由音乐层自己猜一份。订阅摘不掉这件事与上面两条同账（TD-006 第二腿）。
    bus.on('audio.music.grid', (g) => {
      this.grid = g
      this.musicLayer?.setGrid(g)
    })
    // KI-077（docs §1.2 + §4）：区域环境声床。发射方是组合根（`main.ts` 的进区那一处 + 开局那一句），
    // 这里把它从 id 翻成表里的行再注给音乐层——音乐层认形状，不认 `ambience.json`。
    bus.on('audio.music.ambience', (p) => {
      const bed = ambienceBeds.find((b) => b.id === p.id) ?? null
      if (!bed && !this.warnedBed.has(p.id)) {
        this.warnedBed.add(p.id)
        bus.emit('log', { level: 'warn', msg: `AudioEngine: 未知环境声床 id "${p.id}"（regions.music.ambience 与 ambience.json 对不上），保留上一张床` })
      }
      if (!bed) return
      this.bed = bed
      this.musicLayer?.setAmbience(bed)
    })
    // KI-079（docs §1.2 世界音乐层）：同一只手把 id 翻成行，音乐层只认形状、不认 `explore.json`。
    // 认不出时**保留上一张曲**：换区失败不该把正在奏的旋律掐掉（与上面那条同口径）。
    bus.on('audio.music.explore', (p) => {
      const song = exploreScores.find((s) => s.id === p.id) ?? null
      if (!song && !this.warnedSong.has(p.id)) {
        this.warnedSong.add(p.id)
        bus.emit('log', { level: 'warn', msg: `AudioEngine: 未知探索曲 id "${p.id}"（regions.music.explore 与 explore.json 对不上），保留上一张曲` })
      }
      if (!song) return
      this.song = song
      this.musicLayer?.setExplore(song)
    })
    // KI-080（docs §1.1 + §2.2 的遭遇层）：第三条同一只手。认不出时保留上一档，并说一次（单独一本账）。
    bus.on('audio.music.battle', (p) => {
      const row = battleScores.find((s) => s.id === p.id) ?? null
      if (!row && !this.warnedBattle.has(p.id)) {
        this.warnedBattle.add(p.id)
        bus.emit('log', { level: 'warn', msg: `AudioEngine: 未知战斗档 id "${p.id}"（regions.music.battle 与 battle.json 对不上），保留上一档` })
      }
      if (!row) return
      this.battle = row
      this.musicLayer?.setBattle(row)
    })
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

  /**
   * §8.2 侧链的入口：一个触发口 → 表里所有以它为 `trigger` 的行 → 每条被压总线一条请求。
   * 图还没建（首次手势前）时**一条都不留**：那时没有总线可压，也没有声音要让位；把它记下来
   * 反而会在建图之后突然压一次——那是一次没人听见的历史事件在说话。
   */
  private onDuckTrigger(trigger: string): void {
    const ctx = this.ctx
    if (!ctx || !this.graph || ctx.state !== 'running') return
    const now = ctx.currentTime
    for (const row of duckingRows) {
      if (row.trigger !== trigger) continue
      for (const b of row.targets) this.ducks.push({ bus: b, factor: duckFactor(row.db), until: now + row.holdSec })
    }
    this.reconcileDucks()
  }

  /**
   * 把在场请求折成"每条总线一个系数"，只给**变了**的那几条排自动化。
   * 目标电平 = `BUS_BASE[name] * factor`：基准电平只有一个主人，所以表里那一行的 dB 是**相对量**——
   * 改 `BUS_BASE` 那一格，侧链自己跟着走，不需要谁记得再同步一份电平数。
   */
  private reconcileDucks(): void {
    const ctx = this.ctx
    const graph = this.graph
    if (!ctx || !graph || ctx.state !== 'running') return
    const now = ctx.currentTime
    this.ducks = activeDucks(this.ducks, now)
    const factors = deepestFactor(this.ducks)
    for (const name of Object.keys(BUS_BASE) as DuckBusName[]) {
      const f = factors[name] ?? 1
      if (this.duckApplied[name] === f) continue
      this.duckApplied[name] = f
      graph.buses[name].gain.setTargetAtTime(BUS_BASE[name] * f, now, DUCK_TC_SEC)
    }
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
    this.musicLayer = new MusicLayer(ctx, this.graph.buses.music, this.graph.buses.ambience, this.grid, this.bed, this.song, this.battle)
    // KI-083：位姿也要补一次——首次手势之前 `main.ts` 的每一帧都只落在上面那个缓存里（见 `setListener`）
    this.musicLayer.setListener(this.pose)
    this.musicLayer.start()
  }

  /** 每帧调用（真实秒时步；调度内部以 ctx.currentTime 为准，dtReal 仅作调用节奏） */
  update(dtReal: number): void {
    if (dtReal < 0) return
    this.musicLayer?.update()
    // §8.2 的到期就在这一帧兑现：请求自己会过期，但没有这一句没人把电平写回基准（压住 ≠ 压死）
    this.reconcileDucks()
  }

  /** 更新听者位置与朝向（yaw：绕 Y 轴弧度，0 = 面向 -Z） */
  setListener(x: number, y: number, z: number, facingYaw: number): void {
    this.pose.x = x; this.pose.y = y; this.pose.z = z; this.pose.yaw = facingYaw
    // 建层比建引擎晚（与那三条 id→行 的缓存同一条理由）：首次手势之前的每一帧都到不了音乐层，
    // 所以 `start()` 里还要再补一次；这里这一句管的是"层已经建好"之后的每一帧。
    this.musicLayer?.setListener(this.pose)
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
    const buses = {} as Record<DuckBusName, GainNode>
    for (const k of Object.keys(BUS_BASE) as DuckBusName[]) {
      buses[k] = mk(BUS_BASE[k])
      // 建图时每条总线上写的就是这个数 ⇒ 侧链的"没被压"记为 1，第一次 reconcile 不会多排四条没人要的斜坡
      this.duckApplied[k] = 1
    }
    this.graph = { master, muffle, comp, buses }
  }

  private onSfx(p: GameEvents['audio.sfx']): void {
    const ctx = this.ctx
    const graph = this.graph
    if (!ctx || !graph || ctx.state !== 'running') return
    const base = p.gain ?? 1

    // UI / 无位置事件：直通对应总线，不空间化
    if (UI_KEYS.has(p.key) || !p.pos) {
      const busNode = UI_KEYS.has(p.key) ? graph.buses.ui : graph.buses.sfx
      this.play(ctx, busNode, p.key, base)
      return
    }

    // 3D：距离衰减 + 声像。KI-083 起这段数学住在 `spatial.ts`（第二个读者是 §4 的 L2／L3 声景层），
    // 常数与算式一字未改——"两条读者读同一个位置得到同一个声像"由共用同一份代码保证。
    const { att, pan } = spatialize(p.pos, this.pose)
    if (att < AUDIBLE_FLOOR) return

    const vg = ctx.createGain()
    vg.gain.value = att
    const sp = ctx.createStereoPanner()
    sp.pan.value = pan
    vg.connect(sp).connect(graph.buses.sfx)
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
