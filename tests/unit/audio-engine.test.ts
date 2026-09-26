import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { bus } from '@/core/EventBus'
import { AudioEngine } from '@/audio/AudioEngine'
import { FakeAudioContext, FakeNode, fakeWindow, fakeWindowWebkitOnly, type FakeWindow } from '../support/fakeAudio'

/**
 * `AudioEngine` 的行为面第一次可断言（KI-065 / TD-006 第一腿）。
 *
 * 全部走假 `window` + 假 `AudioContext`（`tests/support/fakeAudio.ts`）：这个替身只保证
 * **图形状与调度可断言**，不保证"好听"——后者要人戴耳机实机评审（与 KI-010 同因，本机没有可听的输出）。
 *
 * 每条用例装一只自己的假 window：`AudioEngine` 构造时把 pointerdown/keydown 挂在**当时的** `window` 上，
 * 所以换掉 window 就等于把上一批引擎的手势监听关在门外（否则一次 dispatch 会把所有历史引擎的图都建出来）。
 * 但 `bus` 是进程全局的、而 `AudioEngine` 没有 dispose —— 历史引擎仍会收到本用例的 `audio.sfx`，
 * 只是写进它们自己的 ctx，不动本用例的读数。这条账要记着：**它没有 dispose 是 TD-006 的第二腿**，
 * 不是这里可以顺手补的 API（补了没有生产消费方就是 §55 违例）。
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

/** `AudioEngine` 没有 dispose，而 `bus` 是进程全局的：数一数本文件建过几只，顺序依赖靠这个数说话 */
let engineCount = 0
const mkEngine = (): AudioEngine => { engineCount++; return new AudioEngine() }

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

beforeEach(() => { made = [] })

afterEach(() => {
  while (live.length) live.pop()!()
  w?.uninstall()
})

describe('未知 key 的可见性（必须排在本文件最前，见下面的 engineCount）', () => {
  it('拼错的名字：不响，但 log 里恰好一条 warn（同一个 key 第二次不再刷）', () => {
    // 历史引擎各自有 `warned` 集合，都会对同一个拼错的名字报一遍 ⇒ 这一条要在还没有别的引擎时量
    expect(engineCount, '这条判据依赖"本文件里我是第一只引擎"，挪动顺序就会变成 N 条').toBe(0)
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

describe('start()：把音乐层接上', () => {
  it('start 建图 + 起 drone + 把 ambience 在 3 秒内推起来', () => {
    installWindow()
    const engine = mkEngine()
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
    expect(ctx.count('osc'), 'drone 一层都没有').toBeGreaterThanOrEqual(5)
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
