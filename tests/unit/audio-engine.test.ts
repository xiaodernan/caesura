import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { bus } from '@/core/EventBus'
import { AudioEngine } from '@/audio/AudioEngine'
import { ambienceBeds } from '@/data'
import type { AmbienceBed } from '@/data/schema'
import { BELL_CENTS } from '@/audio/synth'
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
    // 分母是"本文件此刻活着的引擎数"而不是 1：`AudioEngine` 没有 dispose（TD-006 第二腿，文件头那本账），
    // 历史引擎也都订阅着这一条事件，各自按自己的 `warnedBed` 说一句。被量的两件事是"**同一个 id 只说一句**"
    // 与"说过之后不再每帧说"，写成 ===1 会把这本账读成缺陷。
    const said = engineCount
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

describe('拍网交接（KI-066：音乐层不再自带 BPM）', () => {
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
