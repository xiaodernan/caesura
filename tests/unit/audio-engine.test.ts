import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { bus, type GameEvents } from '@/core/EventBus'
import { AudioEngine } from '@/audio/AudioEngine'
import { ambienceBeds, battleScores, exploreScores, regions } from '@/data'
import type { AmbienceBed, ExploreScore, ExploreTonal } from '@/data/schema'
import { BELL_CENTS } from '@/audio/synth'
import { spatialize } from '@/audio/spatial'
import { FakeAudioContext, FakeNode, fakeWindow, fakeWindowWebkitOnly, type FakeWindow } from '../support/fakeAudio'

/**
 * `AudioEngine` 的行为面第一次可断言（KI-065 / TD-006 第一腿）。
 *
 * 全部走假 `window` + 假 `AudioContext`（`tests/support/fakeAudio.ts`）：这个替身只保证
 * **图形状与调度可断言**，不保证"好听"——后者要人戴耳机实机评审（与 KI-010 同因，本机没有可听的输出）。
 *
 * 每条用例装一只自己的假 window：`AudioEngine` 构造时把 pointerdown/keydown 挂在**当时的** `window` 上，
 * 所以换掉 window 就等于把上一批引擎的手势监听关在门外（否则一次 dispatch 会把所有历史引擎的图都建出来）。
 * `bus` 是进程全局的，所以每条用例结束都在 `afterEach` 里把本文件建过的每一只引擎 `dispose()` 掉
 * （TD-006 第二腿①，2026-10-08 落地；消费方是 `main.ts` 挂上 `__caesura` 的 `audioEngine`）：
 * 摘线之后历史引擎连事件都收不到，于是本文件的用例**不再依赖执行顺序**——
 * 头一条「未知 key 只 warn 一次」从前必须排在最前（老引擎还活着时会各报一遍），现在不需要了。
 */

const live: Array<() => void> = []
let made: FakeAudioContext[] = []
let w: FakeWindow = null as unknown as FakeWindow

/** 装上这一条用例自己的假 window；`ctor:false` = 这台机器根本没有 WebAudio，`webkit:true` = 只有带前缀的那一个 */
function installWindow(opts: { ctor?: boolean; webkit?: boolean; suspended?: boolean; resumeStalls?: boolean } = {}): void {
  // 必须是一只**类**：引擎里是 `new Ctor()`，箭头函数当构造器会直接 TypeError
  class Spy extends FakeAudioContext {
    constructor() {
      super()
      if (opts.suspended) this.state = 'suspended'
      // 真机上 autoplay 策略拒绝时 resume() 也会兑现，但 state 仍是 suspended：这就是那条 if 的第二侧
      if (opts.resumeStalls) this.resume = (): Promise<void> => Promise.resolve()
      made.push(this)
    }
  }
  w = opts.webkit ? fakeWindowWebkitOnly(Spy) : fakeWindow(opts.ctor === false ? null : Spy)
  w.install()
}

const LAST = (): FakeAudioContext => made[made.length - 1]

/** 本文件建过的每一只引擎（TD-006 第二腿①：`afterEach` 逐只摘线，用例之间因此没有顺序依赖） */
let engineCount = 0
const engines: AudioEngine[] = []
const mkEngine = (): AudioEngine => { engineCount++; const e = new AudioEngine(); engines.push(e); return e }

/** 图上那条常驻低通（消音用的就是它） */
const muffleOf = (ctx: FakeAudioContext): FakeNode => {
  const n = ctx.nodes.find((x) => x.kind === 'biquad')
  expect(n, '图里没有低通 = 消音没有落点').toBeTruthy()
  return n as FakeNode
}
/** 按响度认总线（master .85 / sfx .9 / music .5 / ambience .45 / ui .8，五个数互不相同） */
function busAt(ctx: FakeAudioContext, level: number): FakeNode {
  const n = ctx.nodes.find((x) => x.kind === 'gain' && Math.abs(x.params.gain.value - level) < 1e-9)
  expect(n, `找不到电平 ${level} 的那条总线`).toBeTruthy()
  return n as FakeNode
}

/**
 * 出生区（`rg_resthold`）那一行的声床。两个 describe 共用它：KI-083 那边证"id→行 解析出来的那一行
 * 真的走到了声景层上"，§5.9.33③ 那边证"同一行上面还挂着天气增益"。合成床量不到前一件事，
 * 所以这里刻意**用真表里的床**——只有它同时踩得住两条链。
 */
const openBed = (): AmbienceBed => {
  const rg = regions.find((r) => r.id === 'rg_resthold')
  if (!rg) throw new Error('regions.json 里没有出生区 rg_resthold：这一份测试的输入要跟着数据走')
  const b = ambienceBeds.find((x) => x.id === rg.music.ambience)
  if (!b) throw new Error('出生区指的声床不在 ambience.json 里')
  return b
}

beforeEach(() => { made = [] })

afterEach(() => {
  // 先摘线再卸 window：引擎活着时下一次 dispatch 会把它自己的图建出来（那是上一批用例的幽灵）
  while (engines.length) engines.pop()!.dispose()
  while (live.length) live.pop()!()
  w?.uninstall()
})

describe('未知 key 的可见性（拼错要说，但只说一次）', () => {
  it('拼错的名字：不响，但 log 里恰好一条 warn（同一个 key 第二次不再刷）', () => {
    // 曾经这一条必须排在全文件最前：老引擎没有 dispose，都活着，会对同一个拼错的名字各报一遍。
    // TD-006 第二腿① 之后 `afterEach` 逐只摘线，所以这里不再有顺序前提——下面那行只是留个读数。
    expect(engineCount, '本文件建过的引擎数（这一条仍是第一个跑的）').toBe(0)
    const msgs: string[] = []
    live.push(bus.on('log', (p) => { if (p.msg.includes('nope')) msgs.push(p.msg) }))
    installWindow()
    const engine = mkEngine()
    w.dispatch('pointerdown')
    bus.emit('audio.sfx', { key: 'nope_not_a_voice', gain: 1 })
    bus.emit('audio.sfx', { key: 'nope_not_a_voice', gain: 1 })
    expect(msgs.length, '一次拼错只该说一遍，但必须说一遍').toBe(1)
    expect(msgs[0]).toContain('nope_not_a_voice')
    void engine
  })
})

describe('建图（master → 低通 → 压缩器 → destination + 四条总线）', () => {
  it('构造时不建图，首次 pointerdown 才建：AudioContext 必须由用户手势开', () => {
    installWindow()
    mkEngine()
    expect(made.length, '构造函数就 new 了 AudioContext = 浏览器会拒绝并永远静音').toBe(0)
    w.dispatch('pointerdown')
    expect(made.length).toBe(1)
    const ctx = LAST()
    expect(ctx.count('compressor')).toBe(1)
    expect(ctx.count('panner'), '建图阶段不该有空间化节点').toBe(0)

    const master = busAt(ctx, 0.85)
    const comp = ctx.nodes.find((n) => n.kind === 'compressor') as FakeNode
    const muffle = muffleOf(ctx)
    expect(ctx.edgesTo(muffle).some((e) => e.from === master), 'master 没接到低通').toBe(true)
    expect(ctx.edgesTo(comp).some((e) => e.from === muffle), '低通没接到压缩器').toBe(true)
    expect(ctx.edgesTo(ctx.destination).some((e) => e.from === comp), '压缩器没接到 destination').toBe(true)
    for (const level of [0.9, 0.5, 0.45, 0.8]) {
      expect(ctx.edgesTo(master).some((e) => e.from === busAt(ctx, level)), `总线 ${level} 没汇到 master`).toBe(true)
    }
    expect(muffle.frequency.value, '低通默认必须是全开，否则一开局就闷').toBe(20000)
  })

  it('这台机器没有 AudioContext：不炸、也不假装建好了图', () => {
    installWindow({ ctor: false })
    const engine = mkEngine()
    w.dispatch('pointerdown')
    expect(made.length).toBe(0)
    bus.emit('audio.sfx', { key: 'hit_flesh', gain: 1 })
    bus.emit('audio.muffle', { on: true })
    expect(made.length, '没有 AudioContext 却冒出了图 = 假绿').toBe(0)
    void engine
  })

  it('只有 webkitAudioContext 前缀的老浏览器也认（引擎里那句 ?? 不是装饰）', () => {
    installWindow({ webkit: true })
    const engine = mkEngine()
    w.dispatch('pointerdown')
    expect(made.length, 'webkit 那条 fallback 没走通').toBe(1)
    expect(LAST().count('compressor')).toBe(1)
    void engine
  })

  it('ctx 还在 suspended：声音一律丢掉，而不是排进一个永不响的队列', () => {
    installWindow()
    const engine = mkEngine()
    w.dispatch('pointerdown')
    const ctx = LAST()
    ctx.state = 'suspended'
    const n0 = ctx.nodes.length
    bus.emit('audio.sfx', { key: 'hit_flesh', gain: 1 })
    bus.emit('audio.muffle', { on: true })
    expect(ctx.nodes.length, '挂起状态还建节点 = 一堆永远不会响的垃圾').toBe(n0)
    ctx.state = 'running'
    bus.emit('audio.sfx', { key: 'hit_flesh', gain: 1 })
    expect(ctx.nodes.length, '恢复之后同一件事就该响').toBeGreaterThan(n0)
    void engine
  })

  it('手势把挂起的 ctx 拉回 running：resume 落定之后两只一次性监听要摘掉', async () => {
    installWindow({ suspended: true })
    const engine = mkEngine()
    expect(w.dom.handlers['pointerdown']?.length ?? 0, '构造时就该挂好一次性手势').toBe(1)
    w.dispatch('pointerdown')
    const ctx = LAST()
    expect(ctx.resumes, 'suspended 却没调 resume = 这个玩家永远不会有声音').toBe(1)
    expect(w.dom.handlers['pointerdown']?.length ?? 0, 'resume 是一句话回来的，落定之前不该提前摘').toBe(1)
    await Promise.resolve() // 兑现 resume().then(...) 那一格
    expect(w.dom.handlers['pointerdown'] ?? [], '恢复之后还挂着手势 = 图建好了还每次点击重跑一遍判断').toEqual([])
    expect(w.dom.handlers['keydown'] ?? [], '两只监听要一起摘，摘一半等于没摘').toEqual([])
    void engine
  })

  it('反过来：resume 兑现了但状态没起来（策略仍拒绝）时监听必须还挂着，等下一次手势', async () => {
    installWindow({ suspended: true, resumeStalls: true })
    const engine = mkEngine()
    w.dispatch('pointerdown')
    const ctx = LAST()
    expect(ctx.state, '这条用例的前提：resume 之后还是 suspended').toBe('suspended')
    await Promise.resolve()
    expect(w.dom.handlers['pointerdown']?.length ?? 0, '没恢复就摘监听 = 这一次点击把音频永久关在门外').toBe(1)
    void engine
  })
})

describe('路由：UI 直通 / 无位置走 sfx / 有位置才 3D', () => {
  it('UI 直通名单是那张表的每一个，不是被测过的那一个（名单加一个就漏一个：该走 ui 的声音被 3D 化不会报错，只会听着不对）', () => {
    // 名单从 AudioEngine.ts 的源码里切出来，不在测试里抄第二份 —— 抄了就要靠人记得同步
    const decl = /const UI_KEYS = new Set\(\[([\s\S]*?)\]\)/.exec(
      readFileSync(new URL('../../src/audio/AudioEngine.ts', import.meta.url), 'utf8'))
    expect(decl, 'UI_KEYS 那张表换了形状：这条判据要跟着换').not.toBeNull()
    const keys = [...(decl?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(keys.length, '名单空了等于没有 UI 直通').toBeGreaterThanOrEqual(4)

    installWindow()
    const engine = mkEngine()
    w.dispatch('pointerdown')
    const ctx = LAST()
    const ui = busAt(ctx, 0.8)
    const sfx = busAt(ctx, 0.9)
    for (const key of keys) {
      const before = ctx.edgesTo(ui).length
      const leaked = ctx.edgesTo(sfx).length
      // 每一把都带 pos：空间化的诱惑必须一直在，否则"不空间化"这条判据没被压力测过
      bus.emit('audio.sfx', { key, pos: { x: 12, y: 0, z: -12 }, gain: 1 })
      expect(ctx.edgesTo(ui).length, `${key} 没接到 ui 总线`).toBeGreaterThan(before)
      expect(ctx.edgesTo(sfx).length, `${key} 串门到 sfx 总线`).toBe(leaked)
      expect(ctx.count('panner'), `${key} 被空间化了 = 面板里每点一下都在耳边飘`).toBe(0)
    }
    void engine
  })

  it('没有位置的普通音色走 sfx 总线，同样不空间化', () => {
    installWindow()
    const engine = mkEngine()
    w.dispatch('pointerdown')
    const ctx = LAST()
    bus.emit('audio.sfx', { key: 'hit_flesh', gain: 1 })
    expect(ctx.count('panner')).toBe(0)
    expect(ctx.edgesTo(busAt(ctx, 0.9)).length).toBeGreaterThan(0)
    expect(ctx.edgesTo(busAt(ctx, 0.8)).length, '打击音串到 ui 总线').toBe(0)
    void engine
  })

  it('3D：距离衰减写进这条声音的增益，右侧得到正声像，正前方得到 0', () => {
    installWindow()
    const engine = mkEngine()
    w.dispatch('pointerdown')
    const ctx = LAST()
    engine.setListener(0, 0, 0, 0)

    bus.emit('audio.sfx', { key: 'hit_flesh', pos: { x: 20, y: 0, z: 0 }, gain: 1 })
    const sp = ctx.nodes.find((n) => n.kind === 'panner') as FakeNode
    expect(sp, '有位置的音色没被空间化').toBeTruthy()
    const vg = ctx.nodes.find((n) => ctx.edges.some((e) => e.from === n && e.to instanceof FakeNode && e.to.kind === 'panner')) as FakeNode
    expect(vg, '声像链前面没有那条衰减增益').toBeTruthy()
    // att = 1/(1+(20/16)^1.8) ≈ 0.4033；side/dist = 1 ⇒ pan = 0.85（钳位上限）
    expect(vg.params.gain.value).toBeCloseTo(1 / (1 + Math.pow(20 / 16, 1.8)), 6)
    expect(sp.params.pan.value).toBeCloseTo(0.85, 6)

    const before = ctx.nodes.length
    engine.setListener(0, 0, 0, Math.PI / 2)
    bus.emit('audio.sfx', { key: 'hit_flesh', pos: { x: 0, y: 0, z: -20 }, gain: 1 })
    const sp2 = ctx.nodes.slice(before).find((n) => n.kind === 'panner') as FakeNode
    expect(sp2, '换朝向之后第二次发声没建声像链').toBeTruthy()
    expect(sp2.params.pan.value, '面向 +90° 时正前方的声源在右手边').toBeCloseTo(0.85, 6)

    const b2 = ctx.nodes.length
    engine.setListener(0, 0, 0, 0)
    bus.emit('audio.sfx', { key: 'hit_flesh', pos: { x: 0, y: 0, z: -20 }, gain: 1 })
    const sp3 = ctx.nodes.slice(b2).find((n) => n.kind === 'panner') as FakeNode
    expect(sp3.params.pan.value, '正前方不该偏耳').toBeCloseTo(0, 6)
    void engine
  })

  it('太远就不响：att < 0.02 的那一枪连节点都不建（不是建了再乘 0）', () => {
    installWindow()
    const engine = mkEngine()
    w.dispatch('pointerdown')
    const ctx = LAST()
    engine.setListener(0, 0, 0, 0)
    const n0 = ctx.nodes.length
    bus.emit('audio.sfx', { key: 'hit_flesh', pos: { x: 0, y: 0, z: -400 }, gain: 1 })
    expect(ctx.nodes.length, '140 格外的声音照样建图 = 白烧 CPU').toBe(n0)
    void engine
  })

  it('3D 那条链到点自己拆：定时回调兑现后衰减增益与声像都断开', () => {
    installWindow()
    const engine = mkEngine()
    w.dispatch('pointerdown')
    const ctx = LAST()
    engine.setListener(0, 0, 0, 0)
    bus.emit('audio.sfx', { key: 'hit_metal', pos: { x: 6, y: 0, z: -6 }, gain: 1 })
    const sp = ctx.nodes.find((n) => n.kind === 'panner') as FakeNode
    const vg = ctx.nodes.find((n) => ctx.edges.some((e) => e.from === n && e.to === sp)) as FakeNode
    expect(vg, '找不到接在声像前面的增益').toBeTruthy()
    expect(vg.disconnected).toBe(0)
    w.runTimers()
    expect(vg.disconnected, '用完没断开 = 每次发声留一对节点').toBe(1)
    expect(sp.disconnected, '声像没断开').toBe(1)
    void engine
  })
})

describe('KI-083：§4 的 L2／L3 声景层（真位置声源）', () => {
  /** 这段读数之后建起来的声像名册（声景层每一颗都有一只，一次性 SFX 也各有一只） */
  const pansSince = (ctx: FakeAudioContext, from: number): number[] =>
    ctx.nodes.slice(from).filter((n) => n.kind === 'panner').map((n) => n.params.pan.value).sort((a, b) => a - b)

  it('开局缓存的那张床 + 那一份位姿：两手都要补到声景层上（少一句，声景就按原点算）', () => {
    installWindow()
    const engine = mkEngine()
    const bed = openBed()
    const pose = { x: 14, y: 1, z: 16, yaw: 0 }   // 炉火边：这张床的第一条源就在这个点上
    engine.setListener(pose.x, pose.y, pose.z, pose.yaw)   // 手势之前：位姿先落进引擎的缓存
    bus.emit('audio.music.ambience', { id: bed.id })       // 手势之前：床也先落进缓存（main.ts 就是这个顺序）
    engine.start()
    const ctx = LAST()
    const before = ctx.nodes.length
    ctx.advance(60)   // 超过这张床里最长的那一格间隔（数据里最大 40s），让三条源全到点
    engine.update(1 / 60)
    const pans = pansSince(ctx, before)
    expect(pans.length, '三条真位置声源该各掷一声').toBe(bed.sources.length)
    /**
     * 逐条按**它自己的真位置**算：期望值从 `spatialize` 现推（那一位是两条读者的共同主人），
     * 所以这一条同时钉住"位置进得来"与"数学是同一份"。位姿没补进声景层时这一组读数会整体偏掉。
     */
    const want = bed.sources.map((s) => spatialize(s.pos, pose).pan).sort((a, b) => a - b)
    expect(pans).toEqual(want)
    // 第一颗（炉火）就在听者脚下 ⇒ 满衰减。少了这一条，上面那组数可能只是"碰巧排对了"
    const att = spatialize(bed.sources[0].pos, pose).att
    expect(att, '这一条的前提是脚下那颗的衰减恰为 1').toBe(1)
    expect(ctx.nodes.slice(before).some((n) => n.kind === 'gain' && n.params.gain.value === att), '距离衰减没写进这一声的增益').toBe(true)
    void engine
  })

  it('听不见的那一区：位姿离得远 ⇒ 一条源都不建（不是建了再乘 0）', () => {
    installWindow()
    const engine = mkEngine()
    const bed = openBed()
    engine.setListener(0, 200, 0, 0)
    bus.emit('audio.music.ambience', { id: bed.id })
    engine.start()
    const ctx = LAST()
    const before = ctx.nodes.length
    ctx.advance(60)
    engine.update(1 / 60)
    expect(pansSince(ctx, before).length, '200 米外的声景照样建图 = 白烧一个声部').toBe(0)
    void engine
  })

  it('两条读者同源：同一个位置的一次性 SFX 与声景层得到同一个声像', () => {
    installWindow()
    const engine = mkEngine()
    const bed = openBed()
    const pose = { x: 14, y: 1, z: 16, yaw: 0 }
    const at = bed.sources[1].pos       // 铁砧那一颗：离听者 28 米，声像明显偏一侧
    engine.setListener(pose.x, pose.y, pose.z, pose.yaw)
    bus.emit('audio.music.ambience', { id: bed.id })
    engine.start()
    const ctx = LAST()
    const before = ctx.nodes.length
    ctx.advance(60)
    engine.update(1 / 60)
    const fieldPans = pansSince(ctx, before)
    const mid = ctx.nodes.length
    bus.emit('audio.sfx', { key: 'hit_flesh', pos: at, gain: 1 })
    const sfxPans = pansSince(ctx, mid)
    expect(sfxPans.length, '一次性 SFX 那条链没建声像').toBe(1)
    const want = spatialize(at, pose).pan
    expect(sfxPans[0], 'SFX 那条读者算出的声像变了').toBeCloseTo(want, 6)
    expect(fieldPans.some((p) => Math.abs(p - want) < 1e-12), '声景层那条读者与 SFX 不是同一份数学').toBe(true)
    void engine
  })
})

/**
 * §5.9.33③ 声景增益腿（`weather.json > gameplay.ambienceGain`）在**引擎这一层**的三件事：
 * 缓存（首次手势之前）、补发（`start()` 里）、以及 dispose 之后不再说话。
 *
 * 读数与"乘在距离衰减之后"那两条判据住在 `tests/unit/ambience-field.test.ts`（数学的主人那边），
 * 这里只盯引擎作为**缓存与转交者**的身份——少了它，开局那一格天气要等玩家手动换一次区才生效。
 */
describe('§5.9.33③ 声景增益腿：引擎层的缓存、补发与退场', () => {
  /** 这一段之后新建的、接在声像前面的那条增益（声景层每条源一只） */
  const gainsOf = (ctx: FakeAudioContext, from: number): number[] =>
    ctx.nodes.slice(from).filter((n) => n.kind === 'panner')
      .map((p) => (ctx.edges.find((e) => e.to === p)?.from as FakeNode | undefined)?.params.gain.value)
      .filter((v): v is number => typeof v === 'number')

  it('手势之前设的增益被缓存，start() 补发到声景层（少了补发，开局那一格天气要等换一次区才生效）', () => {
    installWindow()
    const engine = mkEngine()
    const bed = openBed()
    const pose = { x: 14, y: 1, z: 16, yaw: 0 }
    engine.setListener(pose.x, pose.y, pose.z, pose.yaw)
    bus.emit('audio.music.ambience', { id: bed.id })
    engine.setWeatherGain(1.5)          // 手势之前：这一句只该落进引擎的缓存
    engine.start()
    const ctx = LAST()
    const before = ctx.nodes.length
    ctx.advance(60)
    engine.update(1 / 60)
    const got = gainsOf(ctx, before).sort((a, b) => a - b)
    const want = bed.sources.map((s) => spatialize(s.pos, pose).att * 1.5).sort((a, b) => a - b)
    expect(got, 'start() 没把缓存的增益补发给声景层').toEqual(want)
  })

  it('start() 之后现设的增益从下一声起生效；已经在飞的那一声不回头改', () => {
    installWindow()
    const engine = mkEngine()
    const bed = openBed()
    const pose = { x: 14, y: 1, z: 16, yaw: 0 }
    engine.setListener(pose.x, pose.y, pose.z, pose.yaw)
    bus.emit('audio.music.ambience', { id: bed.id })
    engine.start()
    const ctx = LAST()
    const before = ctx.nodes.length
    ctx.advance(60)
    engine.update(1 / 60)
    const first = gainsOf(ctx, before)
    const att = bed.sources.map((s) => spatialize(s.pos, pose).att)
    expect(first.sort((a, b) => a - b), '没设增益时该是距离衰减本身').toEqual([...att].sort((a, b) => a - b))
    const mid = ctx.nodes.length
    engine.setWeatherGain(2)
    ctx.advance(60)
    engine.update(1 / 60)
    expect(gainsOf(ctx, mid).sort((a, b) => a - b), '新增益没转交给正在跑的声景层').toEqual(att.map((a) => a * 2).sort((a, b) => a - b))
    // 只看**第一批**那几只（`before` 之后的节点是按创建顺序排的）：第二批进来之后第一批的值必须原样不动
    expect(gainsOf(ctx, before).slice(0, first.length).sort((a, b) => a - b), '已经排出去的那一声被回头改了（KI-066 不篡改时间线）').toEqual([...first].sort((a, b) => a - b))
  })

  it('dispose 之后再设：不抛，也不再产生新的声景声', () => {
    installWindow()
    const engine = mkEngine()
    const bed = openBed()
    engine.setListener(14, 1, 16, 0)
    bus.emit('audio.music.ambience', { id: bed.id })
    engine.start()
    const ctx = LAST()
    const before = ctx.nodes.length
    ctx.advance(60)
    engine.update(1 / 60)
    const seen = ctx.nodes.slice(before).filter((n) => n.kind === 'panner').length
    engine.dispose()
    expect(() => engine.setWeatherGain(9)).not.toThrow()
    ctx.advance(60)
    engine.update(1 / 60)
    expect(ctx.nodes.slice(before).filter((n) => n.kind === 'panner').length, 'dispose 之后还在响 = 缓存那条路没被堵住').toBe(seen)
  })
})

describe('并发配额 MAX_VOICES = 24', () => {
  it('第 25 声不建任何东西，配额到点归还后才继续响', () => {
    installWindow()
    const engine = mkEngine()
    w.dispatch('pointerdown')
    const ctx = LAST()
    const base = ctx.nodes.length
    for (let i = 0; i < 24; i++) bus.emit('audio.sfx', { key: 'ui_move', gain: 1 })
    const perVoice = (ctx.nodes.length - base) / 24
    expect(perVoice, 'ui_move 一条声音的节点数（噪声源 + 带通 + 包络增益）').toBe(3)
    const capped = ctx.nodes.length
    for (let i = 0; i < 6; i++) bus.emit('audio.sfx', { key: 'ui_move', gain: 1 })
    expect(ctx.nodes.length, '超过 24 声还在建节点 = 红线没了').toBe(capped)
    w.runTimers()
    bus.emit('audio.sfx', { key: 'ui_move', gain: 1 })
    expect(ctx.nodes.length, '到点之后配额必须归还，否则游戏会慢慢哑掉').toBe(capped + perVoice)
    void engine
  })
})

describe('消音（§5.4 处决演出：一切声音塌向 100Hz）', () => {
  it('开：先 cancel，再从现值指数斜降到 100Hz，80ms 内到底（audio.md §破处决的读数）', () => {
    installWindow()
    const engine = mkEngine()
    w.dispatch('pointerdown')
    const ctx = LAST()
    const f = muffleOf(ctx).frequency
    bus.emit('audio.muffle', { on: true })
    expect(f.cancelCount, '不先 cancel 会把上一次演出的斜坡叠进来').toBe(1)
    expect(f.events.map((e) => e.kind)).toEqual(['set', 'exp'])
    expect(f.events[0].value, '从当前值出发，不是从 0').toBe(20000)
    expect(f.events[1].value).toBe(100)
    expect(f.events[1].at).toBeCloseTo(0.08, 6)
    void engine
  })

  it('关：那一记 100Hz 的斜降被作废，回扫到全开用 180ms（比进来慢：恢复要听得出来）', () => {
    installWindow()
    const engine = mkEngine()
    w.dispatch('pointerdown')
    const ctx = LAST()
    const f = muffleOf(ctx).frequency
    bus.emit('audio.muffle', { on: true })
    bus.emit('audio.muffle', { on: false })
    expect(f.cancelCount, '两次开关 = 两次作废').toBe(2)
    expect(f.events.some((e) => e.value === 100), '塌向 100Hz 那次自动化应当已经作废，不然会一直闷着').toBe(false)
    expect(f.events.map((e) => e.kind)).toEqual(['set', 'exp'])
    expect(f.events[1].value, '出路回到全开').toBe(20000)
    expect(f.events[1].at, '同一时刻重新起坡（ctx 时钟在这里没走）').toBeCloseTo(0.18, 6)
    void engine
  })

  it('图还没建（首次手势之前）时消音事件不许凭空建图', () => {
    installWindow()
    const engine = mkEngine()
    bus.emit('audio.muffle', { on: true })
    bus.emit('audio.muffle', { on: false })
    expect(made.length, '那时本来没有声音可闷，建图等于把启动时机抢跑').toBe(0)
    void engine
  })
})

describe('start()：把音乐层接上（KI-077：id→行 的解析住在这一层）', () => {
  /**
   * 这一层用**真表里的行**，而 `audio-music.test.ts` 用合成床 —— 是分工不是重复：
   * 音乐层那半边证"跟着喂进来的床走"（写死一张真表就成了实现自证），这一半边证"`ambience.json` 的那一行
   * 真的能走到图上"（只用合成床就永远量不到 id→行 这一步，而那一步正是 KI-077 补的缺口）。
   */
  const row = (id: string): AmbienceBed => {
    const b = ambienceBeds.find((x) => x.id === id)
    if (!b) throw new Error(`ambience.json 里没有 '${id}'：表改过 id，这一份测试的输入要跟着改（红的是测试，不是引擎）`)
    return b
  }
  const OPEN = row('mus_resthold_amb')       // 开局那一区（休垒）
  const NEXT = row('mus_fellcarillon_amb')   // 换区那一区：与 OPEN 四条层没有一个频率相同
  /** 图上此刻的振荡频率名册（drone 声部 + 呼吸 LFO；LFO 是小数 hz，不会与音高撞） */
  const oscHz = (ctx: FakeAudioContext): number[] =>
    ctx.nodes.filter((n) => n.kind === 'osc').map((n) => n.params.frequency.value).sort((a, b) => a - b)
  /** 一张床应该留下的那一名册 */
  const bedHz = (b: AmbienceBed): number[] => [...b.layers.map((l) => l.hz), b.breath!.hz].sort((x, y) => x - y)
  /** 一敲铃的记号：某条泛音落在名册某一格上（容差 = 生产自己的 `BELL_CENTS`） */
  const rangOn = (ctx: FakeAudioContext, scale: number[]): boolean =>
    oscHz(ctx).some((f) => scale.some((s) => Math.abs(f - s) <= (BELL_CENTS / 1200) * s + 0.01))

  it('开局：床事件在图**之前**也不丢（`main.ts` 的真实顺序），start 建图并按那一行起 drone', () => {
    installWindow()
    const engine = mkEngine()
    bus.emit('audio.music.ambience', { id: OPEN.id })   // 图还没有：这一句必须缓存住，不能像 KI-066 之前那样漏
    engine.start()
    const ctx = LAST()
    expect(ctx.count('compressor'), 'start 没建图').toBe(1)
    // 淡入的不是 ambience 总线本身，而是音乐层自己那只 gain（它接到总线上）——认边而不是认电平数
    const ambBus = busAt(ctx, 0.45)
    const layer = ctx.nodes.find((n) => n.kind === 'gain'
      && n.params.gain.events.some((e) => e.kind === 'lin' && Math.abs(e.value - 0.6) < 1e-9))
    expect(layer, 'ambience 层没被推起来').toBeTruthy()
    expect(ctx.edgesTo(ambBus).some((e) => e.from === layer), '推起来的那一层没接到 ambience 总线').toBe(true)
    expect(layer!.params.gain.lastAt(), '3 秒淡入').toBeCloseTo(3, 6)
    // 相等而不是"至少几条"：多出来的那一条就是"表外还留着一份写死的底噪"或者起了两遍
    expect(oscHz(ctx), 'drone 不是 `ambience.json` 里那一行（声部 + 呼吸 LFO 的名册整体对账）').toEqual(bedHz(OPEN))
    void engine
  })

  it('一张床都没收到时仍然建图、仍然淡入总层，但一架 drone 都不建，并且说一次', () => {
    installWindow()
    const engine = mkEngine()
    const msgs: string[] = []
    live.push(bus.on('log', (p) => { if (p.msg.includes('声床')) msgs.push(p.msg) }))
    engine.start()
    const ctx = LAST()
    expect(ctx.count('compressor'), '没有床也不该把建图这件事一起跳过').toBe(1)
    expect(ctx.count('osc'), '表外还有写死的底噪（没床却建了振荡）').toBe(0)
    expect(msgs.length, `没床要说，但每只引擎各说一次（实测 ${msgs.length} 句）`).toBe(1)
    void engine
  })

  it('图建好之后再发床：走 `setAmbience`，换区那一行的声部真的落到图上', () => {
    installWindow()
    const engine = mkEngine()
    bus.emit('audio.music.ambience', { id: OPEN.id })
    engine.start()
    const ctx = LAST()
    expect(oscHz(ctx)).toEqual(bedHz(OPEN))
    bus.emit('audio.music.ambience', { id: NEXT.id })
    // crossfade 窗口里新旧两套并存（旧的那套在淡，回收由 `update()` 到点兑现——那半边在 music.test 量）
    expect(oscHz(ctx), '换区之后图上的声部名册 ≠ 新旧两张床之和')
      .toEqual([...bedHz(OPEN), ...bedHz(NEXT)].sort((a, b) => a - b))
    // 重复发同一张床不建第二套（区域 tick 每帧都在发，那是 §1.2 之外的噪声）
    const n0 = ctx.nodes.length
    bus.emit('audio.music.ambience', { id: NEXT.id })
    expect(ctx.nodes.length, '同一张床重发又起了一套 drone').toBe(n0)
    void engine
  })

  it('未知 id：每只引擎恰好一句 warn，而且**上一张床还在响**（既不清空也不换成别的行）', () => {
    installWindow()
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5)   // ⇒ 间隔取中值、泛音零失谐，铃点可预算
    live.push(() => spy.mockRestore())
    const msgs: string[] = []
    live.push(bus.on('log', (p) => { if (p.msg.includes('未知环境声床')) msgs.push(p.msg) }))
    const engine = mkEngine()
    // 分母是"本文件此刻活着的引擎数"而不是 1：`afterEach` 会把上一批引擎 dispose 掉，但**同一批用例之内**
    // 所有还活着的引擎都订阅着这一条事件，各自按自己的 `warnedBed` 说一句。被量的两件事是"**同一个 id 只说一句**"
    // 与"说过之后不再每帧说"，写成 ===1 会把这本账读成缺陷。
    const said = engines.length
    bus.emit('audio.music.ambience', { id: OPEN.id })
    engine.start()
    const ctx = LAST()
    // 先让开局那张床真的敲过一颗铃（否则下面"仍然响在 OPEN 名册上"可以因为一颗都没响而恒真）
    for (let i = 0; i < 20; i++) { ctx.advance(0.5); engine.update(0.5) }   // 10 秒 > 中值间隔 7s
    expect(rangOn(ctx, OPEN.bell!.scale), '开局那张床连一颗铃都没掷出去，这条量不了"保留上一张床"').toBe(true)
    const n0 = ctx.count('osc')
    bus.emit('audio.music.ambience', { id: 'mus_typo_not_in_table' })
    expect(msgs.length, `未知 id 要说一次，但实测 ${msgs.length} 句 / ${said} 只引擎 = 同一只引擎说了不止一句（或者 warn 挂在每帧上）`).toBe(said)
    // 同一个 id 再发一次：去重的那只 Set 只有敲第二次才看得见（第一次说过了还说 = 它没记账）
    bus.emit('audio.music.ambience', { id: 'mus_typo_not_in_table' })
    expect(msgs.length, `同一个未知 id 重发又说了一轮（实测 ${msgs.length}）= warn-once 没落地`).toBe(said)
    expect(ctx.count('osc'), '未知 id 却建了第二套 drone = 那句 warn 之外还偷偷换了床').toBe(n0)
    for (let i = 0; i < 20; i++) { ctx.advance(0.5); engine.update(0.5) }
    expect(rangOn(ctx, OPEN.bell!.scale), '未知 id 之后不再掷上一张床的铃 = `this.bed` 被清成了 null（读侧静默失效）').toBe(true)
    expect(msgs.length, '同一个未知 id 之后每帧又喊 = 把没配好当成常态噪声，读数没法用').toBe(said)
    void engine
  })

  it('重复 start 不把音乐层起两遍', () => {
    installWindow()
    const engine = mkEngine()
    engine.start()
    const ctx = LAST()
    const n0 = ctx.nodes.length
    engine.start()
    expect(ctx.nodes.length, '第二次 start 又起了一套 drone').toBe(n0)
    expect(made.length, '重复 start 不该再开一个 AudioContext（浏览器只给一个）').toBe(1)
    void engine
  })

  it('update 对负数时步不作声，对未 start 的引擎也不炸', () => {
    installWindow({ ctor: false })
    const engine = mkEngine()
    expect(() => engine.update(-1)).not.toThrow()
    expect(() => engine.update(0.016)).not.toThrow()
    expect(made.length).toBe(0)
  })
})

/**
 * KI-079 的引擎侧：`explore.json` 的那一行**真的**走到图上。
 *
 * 分工与 KI-077 那一层一模一样：`audio-music.test.ts` 用**合成行**证"跟着喂进来的行走"（写死一张真表
 * 就成了实现自证），这一份用**真表里的行**证"id→行 的解析在真表上还走得通"。后者只用合成行就永远量不到，
 * 而那一步正是 KI-079 补的缺口——`regions.json > music.explore` 那 7 个 id 之前指向一张不存在的表。
 *
 * ⚠️ 这里的每一行都配一张 `bell: null` 的床（`mus_silence_amb`／无 drone 的 `mus_unfinished_hall_amb`），
 * 这不是巧合而是**测量条件**：旋律音与石铃泛音在图上长得一样（都是 `playSweep` 起的一条振荡），
 * 只有把铃点从名册里请出去，"图上带 `set` 事件的振荡"才只可能是探索曲排出去的（认法见 `melodyHz`）。
 * 换床时"旋律层最后"那一半由音乐层那份测试量，这里不重复。
 */
describe('探索曲的 id→行（KI-079）', () => {
  const song = (id: string): ExploreScore => {
    const s = exploreScores.find((x) => x.id === id)
    if (!s) throw new Error(`explore.json 里没有 '${id}'：表改过 id，这一份测试的输入要跟着改（红的是测试，不是引擎）`)
    return s
  }
  const bed = (id: string): AmbienceBed => {
    const b = ambienceBeds.find((x) => x.id === id)
    if (!b) throw new Error(`ambience.json 里没有 '${id}'`)
    return b
  }
  /** 有调那两支：把行取出来并要求它真的带 form（红在取行这一处，而不是在每条断言里补 `!`） */
  const tonal = (id: string): ExploreTonal => {
    const s = song(id)
    if (s.form === null) throw new Error(`'${id}' 在表里是无调那一行，这几条用例把它当有调行喂了：表改过要跟着改测试`)
    return s
  }
  const DEEPS = tonal('mus_earless_deeps_explore')   // 倒影，主音 73.42，每音 2 拍
  const FELL = tonal('mus_fellcarillon_explore')     // 逆行，主音 98，每音 1 拍
  const HALL = song('mus_unfinished_hall_explore')    // `form: null`（§1.2「C→无调」）
  const DEEPS_BED = bed('mus_silence_amb')            // 三条 40Hz 层，`bell: null`
  const HALL_BED = bed('mus_unfinished_hall_amb')     // 无 drone，铃点 40–50s 一颗
  /** 深窖那一区表的网格（`regions.json > rg_earless_deeps.grid`）：一拍 = 1 秒，量起来不必跟小数较劲 */
  const GRID60 = { bpm: 60, beatsPerBar: 1 }

  /**
   * R-1 = C–Eb–G–Bb ⇒ 度数 0/3/7/10；倒影即取负，再抬两个八度（数据里那个主音记在 L1 同音高，旋律要盖在之上）。
   * **这四个数是手算的**：`audio-music.test.ts` 已经钉过 `motifDegrees` 交出的就是这份度数表，
   * 这里再 import 一次就只能证明"代码等于代码"，而这一条要证的是"表里那一行走到了图上"。
   */
  const DEEPS_HZ = [293.68, 246.95, 196.01, 164.82]      // 73.42 ×4，然后 −3/−7/−10 半音
  const FELL_HZ = [698.46, 587.34, 466.17, 392]          // 98 ×4 之后从 +10 倒着念回 0

  /**
   * 旋律音的记号：`playSweep` 用 `setValueAtTime` 起音，drone 与呼吸 LFO 是直接写 `.value`（没有这条事件）。
   * 认法只在"这一床没有铃点"时成立（见文件头那段），所以每条用例都点名了自己配的那张床。
   */
  const melodyHz = (ctx: FakeAudioContext): number[] => ctx.nodes
    .filter((n) => n.kind === 'osc' && n.startedAt.length)
    .map((n) => {
      const e = n.params.frequency.events.find((x) => x.kind === 'set')
      return e ? Number(e.value.toFixed(2)) : null
    })
    .filter((f): f is number => f !== null)
    .sort((a, b) => a - b)
  /**
   * "此刻在唱哪一行"= 名册去重后整体比。用去重而不是整条序列，是因为这一层要钉的是**行的身份**，
   * 而动机按 `beatsPerNote` 循环念：时间推得越久，序列里同一个音出现得越多（序列本身那一半在音乐层那份测试里钉）。
   */
  const songSet = (ctx: FakeAudioContext): number[] => [...new Set(melodyHz(ctx))].sort((a, b) => a - b)

  /** 只走引擎的公开面推进时间（`start` + `update`），一帧半秒 */
  function run(ctx: FakeAudioContext, engine: AudioEngine, frames: number, dt = 0.5): void {
    for (let i = 0; i < frames; i++) { ctx.advance(dt); engine.update(dt) }
  }

  it('开局：explore 事件在建图**之前**也不丢，start 之后按表里那一行排出倒影四个音', () => {
    installWindow()
    const engine = mkEngine()
    bus.emit('audio.music.grid', GRID60)
    bus.emit('audio.music.ambience', { id: DEEPS_BED.id })
    bus.emit('audio.music.explore', { id: DEEPS.id })
    engine.start()
    const ctx = LAST()
    // 前提证人：那张没有铃的床真的落了图（否则下面的"旋律是这一行的"可以因为整层没起而恒真）
    expect(melodyHz(ctx).length, '一个旋律音都还没排，先量 drone：图上有带 `set` 事件的振荡 = 底噪不来自那张床')
      .toBe(0)
    expect(ctx.nodes.filter((n) => n.kind === 'osc').map((n) => n.params.frequency.value).sort((a, b) => a - b),
      '深窖那张床的 drone 没落到图上 = 前提断了')
      .toEqual([DEEPS_BED.breath!.hz, ...DEEPS_BED.layers.map((l) => l.hz)].sort((a, b) => a - b))
    run(ctx, engine, 20)   // 10 秒 ÷ 每音 2 拍（=2s）⇒ 恰好一轮四个音，一格不多一格不少（多了就是补排欠账）
    expect(melodyHz(ctx).length, `10 秒里排了 ${melodyHz(ctx).length} 个音，一轮该是四个（每音 2 拍）`)
      .toBe(DEEPS_HZ.length)
    expect(songSet(ctx), `深窖那一行唱出的不是倒影那四个音（主音 ${DEEPS.rootHz}，每音 ${DEEPS.beatsPerNote} 拍）`)
      .toEqual([...DEEPS_HZ].sort((a, b) => a - b))
    void engine
  })

  it('图建好之后再发曲：走 `setExplore`，新区那一行的音高真的换上图（且不顺手换床）', () => {
    installWindow()
    const engine = mkEngine()
    bus.emit('audio.music.grid', GRID60)
    bus.emit('audio.music.ambience', { id: DEEPS_BED.id })
    engine.start()
    const ctx = LAST()
    run(ctx, engine, 20)
    expect(songSet(ctx), '还没发过探索曲，图上就有了旋律音 = 表外写死了一条曲子').toEqual([])
    const lp0 = ctx.count('biquad')   // 只换曲不换床：低通名册一格都不许动
    bus.emit('audio.music.explore', { id: FELL.id })
    run(ctx, engine, 20)   // 每音 1 拍 = 1s，10 秒排满两圈半
    expect(songSet(ctx), `换曲之后图上的名册 ≠ 逆行那一行（${FELL_HZ.join('/')}`)
      .toEqual([...FELL_HZ].sort((a, b) => a - b))
    expect(melodyHz(ctx).some((h) => DEEPS_HZ.includes(h)), '换曲之后还在唱上一行的音').toBe(false)
    expect(ctx.count('biquad'), '只换曲却建了新的低通 = 顺手换了一张床').toBe(lp0)
    void engine
  })

  it('`form: null` 的那一行（未竟厅）：一个旋律音都不排，而那句"未知 id"也没有说（说明确实解析到了这一行）', () => {
    installWindow()
    const engine = mkEngine()
    const msgs: string[] = []
    live.push(bus.on('log', (p) => { if (p.msg.includes('探索曲')) msgs.push(p.msg) }))
    bus.emit('audio.music.grid', { bpm: 92, beatsPerBar: 4 })
    bus.emit('audio.music.ambience', { id: HALL_BED.id })
    bus.emit('audio.music.explore', { id: HALL.id })
    engine.start()
    const ctx = LAST()
    expect(ctx.count('compressor'), '没有床也没有曲就把建图跳过了').toBe(1)
    run(ctx, engine, 20)   // 10 秒：这张床的铃最快也要 40s，drone 一条都没有
    expect(melodyHz(ctx), '`form: null` 被当成了顺行，或者表外那条写死的底噪还在').toEqual([])
    expect(ctx.count('osc'), '未竟厅按 §4 是「无 drone」，图上却起了振荡').toBe(0)
    expect(msgs.length, `解析到了行却还说"未知探索曲"（实测 ${msgs.length} 句）= id→行 那一步在骗人`).toBe(0)
    void engine
  })

  it('未知 id：每只引擎恰好一句 warn，而且上一张曲继续唱（既不清空也不换成别的行）', () => {
    installWindow()
    const msgs: string[] = []
    live.push(bus.on('log', (p) => { if (p.msg.includes('未知探索曲')) msgs.push(p.msg) }))
    const engine = mkEngine()
    const said = engines.length   // 与 KI-077 那条同一本账：只有**还活着**的引擎订阅着这一条（其余已被 afterEach dispose）
    bus.emit('audio.music.grid', GRID60)
    bus.emit('audio.music.ambience', { id: DEEPS_BED.id })
    bus.emit('audio.music.explore', { id: DEEPS.id })
    engine.start()
    const ctx = LAST()
    run(ctx, engine, 8)   // 先让上一张曲真的唱出来（否则"仍然唱在深窖名册上"可以因为一颗都没响而恒真）
    expect(songSet(ctx), '开局那一行一个音都没排，这条量不了"保留上一张曲"')
      .toEqual([...DEEPS_HZ.slice(0, 2)].sort((a, b) => a - b))
    const lp0 = ctx.count('biquad')
    bus.emit('audio.music.explore', { id: 'mus_typo_not_in_table' })
    expect(msgs.length, `未知 id 要说一次，但实测 ${msgs.length} 句 / ${said} 只引擎 = 同一只说了不止一句`).toBe(said)
    bus.emit('audio.music.explore', { id: 'mus_typo_not_in_table' })   // 重发：记账那只 Set 只有第二次看得见
    expect(msgs.length, `同一个未知 id 重发又说了一轮（实测 ${msgs.length}）`).toBe(said)
    expect(ctx.count('biquad'), '未知 id 却建了第二套 drone = 那句 warn 之外还偷偷换了床').toBe(lp0)
    run(ctx, engine, 20)
    expect(songSet(ctx), '未知 id 之后不再唱上一张曲 = `this.song` 被清成了 null（读侧静默失效）')
      .toEqual([...DEEPS_HZ].sort((a, b) => a - b))
    expect(msgs.length, '之后每帧又喊 = 把没配好当成常态噪声').toBe(said)
    void engine
  })

  it('没收到拍网 ⇒ 探索曲一个音都不排（drone 不受影响，它也不吃网格），而那句话说一次', () => {
    installWindow()
    const engine = mkEngine()
    const msgs: string[] = []
    live.push(bus.on('log', (p) => { if (p.msg.includes('探索曲不起音')) msgs.push(p.msg) }))
    bus.emit('audio.music.ambience', { id: DEEPS_BED.id })
    bus.emit('audio.music.explore', { id: DEEPS.id })
    engine.start()          // 一条网格都没发：`RhythmClock` 那条腿断了就是这个形状
    const ctx = LAST()
    run(ctx, engine, 20)
    expect(melodyHz(ctx), '没有拍网却排了旋律 = 音乐层自己又猜了一个 BPM（KI-066 那份副本回归）').toEqual([])
    // 这一条的分子是 1 而不是 `engineCount`：那句 warn 住在音乐层的 `update()` 里，而历史引擎没人替它们推时间
    expect(msgs.length, `没网格要说一次，但这条只该本用例那只引擎说（实测 ${msgs.length}）`).toBe(1)
    expect(ctx.count('osc'), 'drone 也被那道门带走了（它不吃网格）').toBe(DEEPS_BED.layers.length + 1)
    void engine
  })

  /**
   * 组合根那条顺序（源码门，KI-058 那套"那一行是代码不是注释"的写法）。
   * `main.ts` 发这两句的**顺序**就是 §1.2「旋律层最后」能不能实现的全部：ambience 先开发窗口，
   * 紧随的探索曲才被押到窗口走完；反过来写两句都不报错，只是旋律抢跑——自动面上今天量不到，
   * 所以这一格只能由源码钉住（与视线闸门那条同一手法）。
   */
  it('main.ts 两处发射点都是"先声床后探索曲"，而且全场只有这两处', () => {
    const src = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8').split(/\r?\n/)
    const emits = src.filter((l) => /bus\.emit\('audio\.music\.(ambience|explore|battle)'/.test(l) && !l.trim().startsWith('//'))
    expect(emits.length, `audio.music.{ambience,explore,battle} 在组合根里应有恰好两组三行发射点，实测 ${emits.length} 行`)
      .toBe(6)
    expect(emits.map((l) => /audio\.music\.(\w+)/.exec(l)?.[1]), '每一组里声床都排在探索曲之前（顺序就是那句"旋律层最后"）')
      .toEqual(['ambience', 'explore', 'battle', 'ambience', 'explore', 'battle'])
    // KI-080 的另一半：那三行取的必须是**同一条 `music` 上的三个字段**，不许有两行都写 `ambience`
    expect(emits.map((l) => /\.music\.(\w+)/.exec(l)?.[1]), '发射点吃的字段名与事件名不对齐（复制粘贴漏改就是这个形状）')
      .toEqual(['ambience', 'explore', 'battle', 'ambience', 'explore', 'battle'])
  })
})

describe('拍网交接（KI-066：音乐层不再自带 BPM）', () => {
  /**
   * KI-080 之后，战斗层要**先有 `battle.json` 的那一行**才排得出拍（代码里那份 `OSTINATO` 已经拆了）。
   * 这两条量的是拍距与转交，所以随手把真表里第一行有配乐的发上——用真表的 id 而不是编一个，
   * 因为这一条走的就是"引擎解析表 + 音乐层奏行"那条真链。
   */
  const ARM = battleScores.find((r) => 'pattern' in r)?.id ?? '(表里没有一行有配乐)'
  /** 拍面声的记号：驼鼓从 150Hz 起、军鼓边击从 200Hz 起（与 audio-music.test.ts 同一口径） */
  const beatAt = (n: FakeNode): number | null => {
    if (n.kind !== 'osc' || !n.startedAt.length) return null
    const e = n.params.frequency.events.find((x) => x.kind === 'set')
    const f = e ? e.value : n.params.frequency.value
    return f === 150 || f === 200 ? Math.min(...n.startedAt) : null
  }
  /** 只走引擎的公开面（`start`/`update`）推进时间，读出每一拍的起始时刻 */
  function onsets(ctx: FakeAudioContext, engine: AudioEngine, frames: number): number[] {
    const out: number[] = []
    for (let i = 0; i < frames; i++) {
      const n0 = ctx.nodes.length
      ctx.advance(0.05)
      engine.update(0.05)
      const t = ctx.nodes.slice(n0).map(beatAt).filter((x): x is number => x !== null)
      if (t.length) out.push(Math.min(...t))
    }
    return out
  }

  it('网格先到、图后建：缓存住，`start` 建层时兑现（建层比建引擎晚是这里的常态）', () => {
    installWindow()
    const engine = mkEngine()
    bus.emit('audio.music.grid', { bpm: 120, beatsPerBar: 4 })
    bus.emit('audio.music.battle', { id: ARM })
    engine.start()
    const ctx = LAST()
    bus.emit('audio.music.encounter', { start: true })
    const on = onsets(ctx, engine, 40)
    expect(on.length, '两秒里一次都没排 = 缓存的网格没交出去').toBeGreaterThanOrEqual(3)
    expect(on[1] - on[0], '拍距不是缓存里那份 60/120 = 建层时把网格丢了').toBeCloseTo(0.5, 6)
    void engine
  })

  it('层已经在跑：后来的网格只改之后的拍距（转交腿）', () => {
    installWindow()
    const engine = mkEngine()
    bus.emit('audio.music.grid', { bpm: 84, beatsPerBar: 4 })
    bus.emit('audio.music.battle', { id: ARM })
    engine.start()
    const ctx = LAST()
    bus.emit('audio.music.encounter', { start: true })
    const early = onsets(ctx, engine, 20)
    bus.emit('audio.music.grid', { bpm: 120, beatsPerBar: 4 })
    const late = onsets(ctx, engine, 40)
    expect(early.length, '84 下连两拍都没排上，这条量不了间距').toBeGreaterThanOrEqual(2)
    expect(early[1] - early[0], '建层时缓存的 84 没生效').toBeCloseTo(60 / 84, 6)
    expect(late.length, '换网格之后停了 = 转交把调度打断了').toBeGreaterThanOrEqual(3)
    expect(late[1] - late[0], '后来的网格没转交给正在跑的音乐层').toBeCloseTo(0.5, 6)
    void engine
  })
})

/* ------------------------------------------------------------------ */
/* KI-080：战斗档 id → 行（`battle.json` 那一侧的解析仍住在这只引擎里）    */
/* ------------------------------------------------------------------ */

describe('战斗档：id→行 的解析与转交（KI-080）', () => {
  /** 真表里那三行了望台：默认线（休垒等三区共用）/ 下行线（未竟厅）/ 无配乐（无耳深窖，§6.3） */
  const SHARED = 'mus_shared_battle'
  const HERSIL = 'mus_boss_hersil'
  const MYRIAD = 'mus_hidden_battle_myriad'
  const isDrum = (n: FakeNode): boolean =>
    n.kind === 'osc' && (n.params.frequency.events.find((e) => e.kind === 'set')?.value ?? -1) === 150
      || (n.params.frequency.events.find((e) => e.kind === 'set')?.value ?? -1) === 200
  /** 一批节点里"那一拍的低音本音"：不是鼓、也不是钟那一族（≥261.6）的那些里最低的一个 */
  const rootOf = (nodes: FakeNode[]): number | null => {
    const f = nodes
      .filter((n) => n.kind === 'osc' && n.params.frequency.events.length === 1)
      .map((n) => Number(n.params.frequency.events.find((e) => e.kind === 'set')?.value ?? -1))
      .filter((x) => x > 0 && x !== 150 && x !== 200 && x < 261.6)
    return f.length ? Math.min(...f) : null
  }
  /**
   * 走到**第一个拍面**为止，返回那一拍的低音本音（`null` = 一直没排过拍）。
   * ⚠️ 只读第一拍：`beatIdx` 是全场拍号，往后每一拍都在换那一行的下一格，
   * 拿"全部节点里最低的那个"当读数会把整行读成一个数（这一条第一版就是这么假绿的）。
   */
  function firstRoot(ctx: FakeAudioContext, engine: AudioEngine, cap = 80): number | null {
    for (let i = 0; i < cap; i++) {
      const n0 = ctx.nodes.length
      ctx.advance(0.05)
      engine.update(0.05)
      const fresh = ctx.nodes.slice(n0)
      if (fresh.some(isDrum)) return rootOf(fresh)
    }
    return null
  }
  /** 只走公开面推进时间 */
  function fight(ctx: FakeAudioContext, engine: AudioEngine, frames: number): void {
    for (let i = 0; i < frames; i++) { ctx.advance(0.05); engine.update(0.05) }
  }
  const battleOscs = (ctx: FakeAudioContext): number => ctx.nodes.filter((n) => n.kind === 'osc').length
  /** 重新入战：`cut` 先把这一场掐干净，再发一条 `start` ⇒ `beatIdx` 归零，第一拍就是那一行的第 0 格 */
  const reEngage = (): void => {
    bus.emit('audio.music.encounter', { start: false, cut: true })
    bus.emit('audio.music.encounter', { start: true })
  }

  it('开局那条 id 在**建图之前**发也不丢：`start` 建层时兑现，第一次交战第一拍就奏这一行', () => {
    installWindow()
    const engine = mkEngine()
    bus.emit('audio.music.grid', { bpm: 84, beatsPerBar: 4 })
    bus.emit('audio.music.battle', { id: HERSIL })   // 图还没有：这一句必须缓存住
    engine.start()
    const ctx = LAST()
    expect(battleOscs(ctx), '建层之前就该有图？这条的前提是"发在 start 之前"').toBe(0)
    bus.emit('audio.music.encounter', { start: true })
    // 这一行第 0 格是 cell 3（Bb2 = 65.41×2^(10/12) ≈ 116.55），而默认那一行第 0 格是主音本身 65.41 ——
    // 两个数不同才量得出"兑现的正是缓存的那一行"，而不是"随便有一行"。
    expect(firstRoot(ctx, engine), '缓存的战斗档没兑现：第一拍唱的是别的行（或压根没有行）').toBeCloseTo(116.547, 2)
    void engine
  })

  it('层已经在跑：后来那一条转交给它，下一次入战的第一拍就是新那一行', () => {
    installWindow()
    const engine = mkEngine()
    bus.emit('audio.music.grid', { bpm: 84, beatsPerBar: 4 })
    engine.start()
    const ctx = LAST()
    bus.emit('audio.music.encounter', { start: true })
    fight(ctx, engine, 20)
    expect(battleOscs(ctx), '还没发战斗档就排了拍 = 音乐层自己又留了一份抄本（KI-080 拆的就是它）').toBe(0)
    bus.emit('audio.music.battle', { id: SHARED })
    reEngage()
    expect(firstRoot(ctx, engine), '发了默认那一行，第一拍却不是主音').toBeCloseTo(65.41, 6)
    bus.emit('audio.music.battle', { id: HERSIL })                  // 换区那一格：层活着，走的是 `setBattle`
    reEngage()
    expect(firstRoot(ctx, engine), '第一拍还是 65.41 = `musicLayer?.setBattle` 那一转交没走到正在跑的层')
      .toBeCloseTo(116.547, 2)
    void engine
  })

  it('认不出的 id：每一只活着的引擎恰好说一句、上一档继续奏、一个节点都不建', () => {
    installWindow()
    const engine = mkEngine()
    const msgs: string[] = []
    live.push(bus.on('log', (p) => { if (p.msg.includes('未知战斗档')) msgs.push(p.msg) }))
    bus.emit('audio.music.grid', { bpm: 84, beatsPerBar: 4 })
    bus.emit('audio.music.battle', { id: SHARED })
    engine.start()
    const ctx = LAST()
    bus.emit('audio.music.encounter', { start: true })
    fight(ctx, engine, 40)
    // 分母是"本文件此刻活着的引擎数"而不是 1：`AudioEngine` 没有 dispose（TD-006 第二腿，文件头那本账），
    // 历史引擎也都订阅着这一条事件，各自按自己的那本 `warnedBattle` 说一句。被量的是"同一个 id 只说一句"。
    const said = engines.length
    const n0 = ctx.nodes.length
    const osc0 = battleOscs(ctx)
    expect(osc0, '上一档一个音都没排，这条量不了"保留"').toBeGreaterThan(0)
    bus.emit('audio.music.battle', { id: 'mus_typo_not_in_table' })
    expect(msgs.length, `未知 id 要说一次，但实测 ${msgs.length} 句 / ${said} 只引擎 = 同一只说了不止一句`)
      .toBe(said)
    bus.emit('audio.music.battle', { id: 'mus_typo_not_in_table' })
    expect(msgs.length, `同一个未知 id 重发又说了一轮（实测 ${msgs.length}）`).toBe(said)
    expect(ctx.nodes.length, `认不出 id 却建了 ${ctx.nodes.length - n0} 个节点 = 那句 warn 之外还偷偷换了档`).toBe(n0)
    fight(ctx, engine, 40)
    expect(battleOscs(ctx), '未知 id 之后上一档停了 = 解析侧把 `battle` 清成了 null（读侧静默失效）')
      .toBeGreaterThan(osc0)
    void engine
  })

  it('`noMusic: true` 那一档经过引擎 ⇒ 交战全程零条振荡，而"没收到战斗档"那句不说（§6.3 的安静是数据说的）', () => {
    installWindow()
    const engine = mkEngine()
    const msgs: string[] = []
    live.push(bus.on('log', (p) => { if (p.msg.includes('没收到战斗档')) msgs.push(p.msg) }))
    bus.emit('audio.music.grid', { bpm: 84, beatsPerBar: 4 })
    bus.emit('audio.music.battle', { id: MYRIAD })
    engine.start()
    const ctx = LAST()
    bus.emit('audio.music.encounter', { start: true })
    fight(ctx, engine, 80)
    expect(battleOscs(ctx), '无配乐那一档还是排了振荡').toBe(0)
    expect(msgs.length, `这一条 id 明明解析到了（表里有这一行），装配读数不该响：${msgs.join(' | ')}`).toBe(0)
    void engine
  })

  it('真表里那五行与七个区域双向对得上（KI-079 那条 WARN 的销账判据）', () => {
    // 计数由 `regions.json` 与 `battle.json` 现算，这里一张名单都不抄。
    const referenced = new Set(regions.map((r) => r.music.battle))
    const authored = new Set(battleScores.map((b) => b.id))
    expect([...referenced].filter((id) => !authored.has(id)), '有区域指了一张不存在的战斗档').toEqual([])
    expect([...authored].filter((id) => !referenced.has(id)), '表里有一行永远不会被奏出来（§55 死数据）').toEqual([])
    expect([referenced.size, authored.size, regions.length], '五个 id / 五行 / 七个区——变了就要重看上面两条比的是同一件事')
      .toEqual([5, 5, 7])
  })
})

/* ---------------------------------------------------------------------------
 * TD-006 第二腿①：`dispose()`。这一族用例回答同一件事——**这只引擎死掉之后，全局总线上还留不留它的线**。
 * `bus` 是进程全局的、订阅是匿名闭包，所以「摘掉了没有」只能靠读数：`listenerCount` 在构造前后各数一次，
 * 要求**回到原值**（不是"大概没了"）。名字册从源码现推（`this.subscribe('…')` 的字面量），不手抄。
 * --------------------------------------------------------------------------- */
describe('dispose()：摘下每一根线（TD-006 第二腿①）', () => {
  /** 引擎源码里 `this.subscribe('…')` 的每一次 key——名单从源码现推，手抄就是第二份账 */
  const subscribedKeys = (): string[] => {
    const src = readFileSync(new URL('../../src/audio/AudioEngine.ts', import.meta.url), 'utf8')
    return [...src.matchAll(/this\.subscribe\('([^']+)'/g)].map((m) => m[1] as string)
  }

  it('源码里真实的 `bus.on(` 只有 helper 里那一处（漏走 subscribe 的订阅，dispose 摘不掉）', () => {
    const src = readFileSync(new URL('../../src/audio/AudioEngine.ts', import.meta.url), 'utf8')
    const real = src.split('\n').filter((l) => {
      const s = l.trim()
      return s.includes('bus.on(') && !s.startsWith('*') && !s.startsWith('//')
    })
    expect(real, `每一处订阅都必须走 subscribe()；这几行是漏的：${real.join(' | ')}`).toHaveLength(1)
    expect(real[0]).toContain('this.subs.push(bus.on(key, fn))')
    // 反向：helper 真的被用了八次，不是写了个没人走的空壳
    expect(subscribedKeys().length).toBe(9)
  })

  it('构造时每一条订阅都挂上，dispose 后逐条归零（读数回到原值）', () => {
    const keys = subscribedKeys()
    expect(keys.length).toBeGreaterThan(0)
    const before = keys.map((k) => bus.listenerCount(k as keyof GameEvents))
    installWindow()
    const engine = mkEngine()
    keys.forEach((k, i) => {
      expect(bus.listenerCount(k as keyof GameEvents), `${k} 构造后应该多一个听众`).toBe(before[i] + 1)
    })
    engine.dispose()
    expect(keys.map((k) => bus.listenerCount(k as keyof GameEvents)), 'dispose 之后每一条都要回到构造前的读数').toEqual(before)
  })

  it('dispose 之后引擎不再应声：再发 `audio.sfx` 一条 warn 都没有（行为上看得见的「线没了」）', () => {
    installWindow()
    const engine = mkEngine()
    engine.start()
    const msgs: string[] = []
    live.push(bus.on('log', (p) => { if (p.msg.includes('nope_after_dispose')) msgs.push(p.msg) }))
    engine.dispose()
    bus.emit('audio.sfx', { key: 'nope_after_dispose', gain: 1 })
    bus.emit('audio.sfx', { key: 'nope_after_dispose', gain: 1 })
    expect(msgs, 'dispose 之后还报 warn ⇒ 订阅还挂在总线上').toEqual([])
  })

  it('dispose 之后手势监听也摘了：再 dispatch 不会给这只引擎建出图来', () => {
    installWindow()
    const engine = mkEngine()
    engine.dispose()
    const before = made.length
    w.dispatch('pointerdown')
    w.dispatch('keydown')
    expect(made.length, 'dispose 之后 gesture 还在 = window 上的两根监听没摘').toBe(before)
  })

  it('幂等：连调两次不炸也不多做（收尾路径常被叫两遍），且写入口从此不再动作', () => {
    installWindow()
    const engine = mkEngine()
    engine.start()
    const ctx = LAST()
    engine.dispose()
    expect(ctx.closes, 'dispose 要关掉自己的 AudioContext，不然只摘线不关硬件').toBe(1)
    engine.dispose()
    expect(ctx.closes, '第二次 dispose 不该再关一次').toBe(1)
    // 写入口一律静默：调用方常常是收尾路径，抛异常会把真错误埋掉
    expect(() => engine.update(0.016)).not.toThrow()
    expect(() => engine.setListener(1, 2, 3, 0)).not.toThrow()
    expect(() => engine.setVolume('sfx', 0.5)).not.toThrow()
    expect(() => engine.setWeatherGain(1.5)).not.toThrow()
    expect(() => engine.start()).not.toThrow()
    expect(engine.getVolume('sfx'), 'setVolume 被 dispose 挡掉了 ⇒ 读数保持缺省 1').toBe(1)
    expect(made.length, 'dispose 之后 start() 不许再建一个新 ctx').toBe(1)
  })

  it('`muffleHz` 读数：没图时 null、建好时全开、dispose 后回到 null（TD-006 第二腿⑤ 的实机腿读它）', () => {
    installWindow()
    const engine = mkEngine()
    expect(engine.muffleHz, '首次手势之前没有图').toBeNull()
    engine.start()
    expect(engine.muffleHz).toBe(20000)
    bus.emit('audio.muffle', { on: true })
    bus.emit('audio.muffle', { on: false })
    // headless 只承诺「图形状与参数调度」：指数斜坡不生效FeedbackParam.value，所以这里读到的仍是
    // 最后一次 set 的 20000；斜坡本身由上面「消音」那一族用例断（events 里 exp→100）。真机上
    // `frequency.value` 由音频线程推进，这一格才读得出中间态——那句话要在这里说清，别当成 bug。
    expect(engine.muffleHz).toBe(20000)
    // 注意 cancel 的语义：t=0 时「t 及之后排的一切」= 全部，所以两轮开关之后**只剩第二轮那两条**
    // （set + exp），第一组的 exp→100 已被作废——这正是上面「关」那条用例量的同一件事。
    const ev = muffleOf(LAST()).frequency.events
    expect(ev.map((e) => e.kind)).toEqual(['set', 'exp'])
    expect(ev[1].value, '出路回到全开').toBe(20000)
    engine.dispose()
    expect(engine.muffleHz, 'dispose 把图也放下了').toBeNull()
  })
})
