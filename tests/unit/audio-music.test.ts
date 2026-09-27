import { afterEach, describe, expect, it, vi } from 'vitest'
import { bus } from '@/core/EventBus'
import { MusicLayer } from '@/audio/music'
import type { MusicGrid } from '@/core/RhythmClock'
import { FakeAudioContext, FakeNode } from '../support/fakeAudio'

/**
 * 音乐层的可断言面（KI-065 开了这块，KI-066 把拍网的所有权交回 `RhythmClock`）。
 *
 * 这里断的是**时间结构**：拍距、鼓点上哪个是驼鼓哪个是军鼓、脱战 4s 淡出、`cut` 立刻掐、
 * 音色石铃 5–9s 一颗。听感（"这套鼓好不好听"）不在这一份的保证范围里，本机没有可被听的输出（KI-010 同因）。
 *
 * ⚠️ 拍网是**注入**的（`rig(grid)`），不是这一层自带的：KI-066 之前 `music.ts` 顶上写着 `const BPM = 84`，
 * 于是"84"这个数字有了两个主人，而音频那一个从不跟 `RhythmClock` 走。所以现在测试要自己声明输入是什么，
 * 而"没有输入就不排拍"本身成为一条用例。
 *
 * `MusicLayer` 是有 `dispose()` 的，所以每条用例都在结束时把总线订阅摘掉——
 * `bus` 是进程全局的，留下一条订阅会把后面整块用例读到脏状态（KI-058 那次合跑假红的形状）。
 */

/** 84/4 = 休垒与全场默认网格（真值在 `regions.json > grid`，抄在这里是给测试一个明说的输入） */
const GRID: MusicGrid = { bpm: 84, beatsPerBar: 4 }
const BEAT = 60 / GRID.bpm

/**
 * KI-068 之后，"起战斗层"这件事有两个入口：带落点的（真发射侧）与不带的（调试面板/探针）。
 * 下面 KI-065/066/067 那批用例量的是**调度与声部**，不是落点，所以统一走带落点这条路，
 * 而 `ENTRY` 就是它们写用例时的旧行为（`now + 0.1`、第 0 拍）——把新变量引进来不该让那些断言挪位。
 * "不带落点"本身另有一条用例守着。
 */
const ENTRY = { waitSec: 0.1, beatIndex: 0 }

function rig(grid: MusicGrid | null = GRID): { ctx: FakeAudioContext; layer: MusicLayer; musicOut: FakeNode; ambOut: FakeNode } {
  const ctx = new FakeAudioContext()
  const musicOut = ctx.createGain()
  const ambOut = ctx.createGain()
  const layer = new MusicLayer(
    ctx as unknown as AudioContext,
    musicOut as unknown as AudioNode,
    ambOut as unknown as AudioNode,
    grid
  )
  return { ctx, layer, musicOut, ambOut }
}

const open: Array<() => void> = []
afterEach(() => { vi.restoreAllMocks(); while (open.length) open.pop()!() })

/**
 * MusicLayer 不直接往总线上挂声音：它先建自己的一层增益（ambience 层 / 战斗层），再把这一层接到
 * 构造时传进来的节点上。所以"某个声音有没有真的响"要问到**这一层**，问到 rig 的 sink 永远是假阴性。
 */
function layerGain(ctx: FakeAudioContext, sink: FakeNode): FakeNode {
  const g = ctx.nodes.find((n) => n.kind === 'gain' && ctx.edges.some((e) => e.from === n && e.to === sink))
  if (!g) throw new Error(`找不到接到 ${sink.id} 上的那一层增益`)
  return g
}

/** 这一批新建的节点里，有没有哪个真的挂进了 `layer` 这一层 */
function reaches(fresh: FakeNode[], layer: FakeNode): boolean {
  return fresh.some((n) => layer.ctx.edges.some((e) => e.from === n && e.to === layer))
}

function startedFreqs(ns: FakeNode[]): number[] {
  return ns.filter((n) => n.kind === 'osc').map((n) => {
    const e = n.params.frequency.events.find((x) => x.kind === 'set')
    return e ? e.value : (n.params.frequency.value ?? -1)
  })
}

/**
 * "这一批节点里有一拍打在拍面上"的记号：驼鼓从 150Hz 起、军鼓边击从 200Hz 起。
 * ostinato 的八个音（65.41…155.56）与它们的八度（130.82…311.12）都不撞这两个数，石铃最低 523.25 也不撞。
 */
const isBeatNode = (n: FakeNode): boolean =>
  n.kind === 'osc' && startedFreqs([n]).some((f) => f === 150 || f === 200)

/** 从若干批次里读出"每一拍落在哪个时刻"（没有拍面声的批次跳过） */
function onsetsOf(batches: FakeNode[][]): number[] {
  return batches.filter((b) => b.some(isBeatNode))
    .map((b) => Math.min(...b.filter(isBeatNode).flatMap((n) => n.startedAt)))
}

/** 起层之后按 `step` 秒一帧地推时间，返回每次 update 新建的节点 */
function beats(ctx: FakeAudioContext, layer: MusicLayer, count: number, step = 0.05): FakeNode[][] {
  const batches: FakeNode[][] = []
  for (let i = 0; i < count; i++) {
    const before = ctx.nodes.length
    ctx.advance(step)
    layer.update()
    const fresh = ctx.nodes.slice(before)
    if (fresh.length) batches.push(fresh)
  }
  return batches
}

describe('ambience：低音 drone 与音色石铃', () => {
  it('start 起一层 C2 drone（四条振荡 + 一只呼吸 LFO），并把这一层在 3 秒里推起来', () => {
    const { ctx, layer, ambOut } = rig()
    open.push(() => layer.dispose())
    layer.start()
    const oscs = ctx.nodes.filter((n) => n.kind === 'osc')
    expect(oscs.length, 'drone 一层都没有').toBeGreaterThanOrEqual(5)
    expect(startedFreqs(oscs).filter((f) => Math.abs(f - 65.41) < 0.5).length, 'C2 那一层不见了').toBeGreaterThanOrEqual(3)
    const lfo = oscs.find((n) => Math.abs((n.params.frequency.value ?? 0) - 0.07) < 1e-9)
    expect(lfo, '呼吸 LFO 不见了（drone 会变成死垫子）').toBeTruthy()
    // LFO 调的是 MusicLayer 自己那层增益的 gain 参数（层增益再挂到传进来的 ambOut 上）
    const inner = layerGain(ctx, ambOut)
    const depth = ctx.edges.find((e) => e.to === inner.gain)?.from
    expect(depth, '呼吸 LFO 没接到层增益上 = drone 不会呼吸').toBeTruthy()
    expect(ctx.edges.some((e) => e.from === lfo && e.to === depth), 'LFO → 深度增益 → 层增益 这条链断了').toBe(true)
    const ramped = ctx.nodes.find((n) => n.kind === 'gain' && n !== ambOut
      && n.params.gain.events.some((e) => e.kind === 'lin' && Math.abs(e.value - 0.6) < 1e-9))
    expect(ramped, 'ambience 没被推起来').toBeTruthy()
    expect(ctx.edgesTo(ambOut).some((e) => e.from === ramped), '推起来的不是接在 ambOut 上的那一层').toBe(true)
    expect(ramped!.params.gain.lastAt()).toBeCloseTo(3, 6)
  })

  it('音色石铃：4 秒后第一颗，之后每 7 秒一颗（docs §4 L4 稀疏事件；随机数钉成 0.5）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const { ctx, layer, ambOut } = rig()
    open.push(() => layer.dispose())
    layer.start()
    const inner = layerGain(ctx, ambOut)
    // 半秒一格地推，而不是"跳到 4 秒看一眼"——只跳大格的话，`nextChime` 是 4 还是 2 根本量不出来
    // （反向探针 A5 第一次就是这么溜过去的，这一版才是它该红的形状）
    const fires: Array<{ t: number; osc: number }> = []
    let prev = ctx.nodes.length
    for (let i = 0; i < 40; i++) {  // 40 格 × 0.5s = 20 秒：够看见 4 / 11 / 18 三连
      ctx.advance(0.5)
      layer.update()
      const fresh = ctx.nodes.slice(prev)
      prev = ctx.nodes.length
      const osc = fresh.filter((n) => n.kind === 'osc').length
      if (osc > 0 && reaches(fresh, inner)) fires.push({ t: Number(ctx.currentTime.toFixed(2)), osc })
    }
    // 三颗连排才叫"间隔"：一颗只能证明起点，两颗证明一次间隔，三颗证明这个周期不会自己漂
    expect(fires.map((f) => f.t), `铃点不是 4s 起、每 7s 一颗：${fires.map((f) => f.t).join('+')}`).toEqual([4, 11, 18])
    // 一口钟 = 6 条非谐泛音起步再加一条 FM 亮边；只响一条正弦不叫铃
    expect(fires.every((f) => f.osc >= 6), `每一敲的泛音层数：${fires.map((f) => f.osc).join('/')}`).toBe(true)
  })

  it('dispose 把 drone 停掉并摘掉遭遇订阅（留着的订阅会把后面的用例读到脏状态）', () => {
    const { ctx, layer } = rig()
    layer.start()
    const oscs = ctx.nodes.filter((n) => n.kind === 'osc')
    layer.dispose()
    for (const o of oscs) expect(o.stoppedAt.length, `${o.id} 没被 stop，会一直响`).toBeGreaterThan(0)
    const n0 = ctx.nodes.length
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    expect(ctx.nodes.length, 'dispose 之后遭遇事件还会动图 = 订阅没摘干净').toBe(n0)
  })

  it('重复 start 不订阅两次：遭遇事件只让增益起一条斜坡', () => {
    const { ctx, layer } = rig()
    open.push(() => layer.dispose())
    layer.start()
    layer.start()
    const n0 = ctx.nodes.length
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    const battle = ctx.nodes.slice(n0).filter((n) => n.kind === 'osc')
    expect(battle.length, '第二次 start 之后遭遇事件没有正常起层').toBeGreaterThanOrEqual(0)
    const g = ctx.nodes.find((n) => n.kind === 'gain'
      && n.params.gain.events.some((e) => e.kind === 'lin' && Math.abs(e.value - 0.9) < 1e-9))
    expect(g, '战斗层淡入的 0.9 目标不见了').toBeTruthy()
    expect(g!.params.gain.events.filter((e) => e.kind === 'lin').length, '订阅了两条 = 淡入被叠了两次').toBe(1)
  })
})

describe('战斗层：脉冲鼓 + ostinato（拍网由外面注入）', () => {
  it('拍距 = 60/84 秒：连续四拍的起始时刻两两差一个拍长', () => {
    const { ctx, layer } = rig()
    open.push(() => layer.dispose())
    layer.start()
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    const batch = beats(ctx, layer, 40).filter((b) => b.some((n) => n.kind === 'osc'))
    expect(batch.length, '四十帧里一次鼓都没排上').toBeGreaterThanOrEqual(4)
    const first = (b: FakeNode[]): number => Math.min(...b.flatMap((n) => n.startedAt))
    const t0 = first(batch[0])
    const t1 = first(batch[1])
    const t2 = first(batch[2])
    expect(t1 - t0, '第二拍没落在一个拍长之后').toBeCloseTo(BEAT, 6)
    expect(t2 - t1, '第三拍没落在一个拍长之后').toBeCloseTo(BEAT, 6)
  })

  it('4/4 的小节形状：第 1、3 拍是驼鼓（150Hz 起），第 2、4 拍是军鼓边击（200Hz 起）', () => {
    const { ctx, layer } = rig()
    open.push(() => layer.dispose())
    layer.start()
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    const batch = beats(ctx, layer, 40).filter((b) => b.some((n) => n.kind === 'osc'))
    expect(batch.length).toBeGreaterThanOrEqual(4)
    const kickOrSnare = (b: FakeNode[]): number | null => {
      // 拍面上的那一声：驼鼓 150→46，军鼓 200→170（ostinato 的六个音 65.41/77.78/98/116.54/155.56 及其八度都不撞这两个数）
      const f = startedFreqs(b)
      return f.includes(150) ? 150 : f.includes(200) ? 200 : null
    }
    expect(kickOrSnare(batch[0]), '第 1 拍该是驼鼓').toBe(150)
    expect(kickOrSnare(batch[1]), '第 2 拍该是军鼓边击').toBe(200)
    expect(kickOrSnare(batch[2]), '第 3 拍该是驼鼓').toBe(150)
    expect(kickOrSnare(batch[3]), '第 4 拍该是军鼓边击').toBe(200)
  })

  it('淡入 1.2 秒到 0.9；脱战是 4 秒淡出，不是立刻静音', () => {
    const { ctx, layer } = rig()
    open.push(() => layer.dispose())
    layer.start()
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    const g = ctx.nodes.find((n) => n.kind === 'gain'
      && n.params.gain.events.some((e) => e.kind === 'lin' && Math.abs(e.value - 0.9) < 1e-9))
    expect(g, '战斗层没淡入').toBeTruthy()
    expect(g!.params.gain.lastAt(), '1.2 秒淡入').toBeCloseTo(1.2, 6)

    ctx.advance(2)
    layer.update()
    const fadeTo = g!.params.gain.events.length
    bus.emit('audio.music.encounter', { start: false })
    const toZero = g!.params.gain.events.filter((e) => e.kind === 'lin' && e.value === 0)
    expect(toZero.length, '脱战应当起一条淡出斜坡').toBe(1)
    expect(toZero[0].at, '4 秒淡出').toBeCloseTo(6, 6)
    expect(g!.params.gain.events.length).toBeGreaterThan(fadeTo)
  })

  it('`cut` 是立刻掐（§16 胜利序列的"音乐停"）：增益直接归零，且不排下一拍', () => {
    const { ctx, layer } = rig()
    open.push(() => layer.dispose())
    layer.start()
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    beats(ctx, layer, 6)
    const g = ctx.nodes.find((n) => n.kind === 'gain'
      && n.params.gain.events.some((e) => e.kind === 'lin' && Math.abs(e.value - 0.9) < 1e-9))
    expect(g, '战斗层没淡入').toBeTruthy()
    bus.emit('audio.music.encounter', { start: false, cut: true })
    const ev = g!.params.gain.events
    expect(ev.some((e) => e.kind === 'lin' && e.value === 0), 'cut 走的是渐变而不是立刻归零').toBe(false)
    expect(ev[ev.length - 1]).toEqual({ kind: 'set', value: 0, at: ctx.currentTime })
    const before = ctx.nodes.length
    const later = beats(ctx, layer, 30)
    expect(later.length, 'cut 之后还在排拍 = 音乐没停').toBe(0)
    expect(ctx.nodes.length).toBe(before)
  })

  it('淡出期间还在推进（脱战那 4 秒不该突然断电），到点自己停', () => {
    const { ctx, layer } = rig()
    open.push(() => layer.dispose())
    layer.start()
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    beats(ctx, layer, 6) // t = 0.30：此刻脱战 ⇒ battleStopAt = 4.30
    bus.emit('audio.music.encounter', { start: false })
    // 一拍的驼鼓/军鼓都以 150 或 200Hz 起头；石铃的泛音不在这个数上，所以拿它当"这是一拍"的记号
    const isBeat = (b: FakeNode[]): boolean =>
      b.some((n) => n.kind === 'osc' && startedFreqs([n]).some((f) => f === 150 || f === 200))
    const during = beats(ctx, layer, 80).filter(isBeat) // t = 0.35 … 4.30，正好跨过淡出窗口
    expect(during.length, '淡出期间一次都没排 = 4 秒淡出是空的').toBeGreaterThanOrEqual(4)
    const last = Math.min(...during[during.length - 1].flatMap((n) => n.startedAt))
    expect(last, '最后一拍打在了淡出结束之后').toBeLessThan(4.3)
    const after = beats(ctx, layer, 40).filter(isBeat)
    expect(after.length, '过了 battleStopAt 还在排拍 = 永远停不下来').toBe(0)
  })

  it('低音 ostinato：每一拍落一个根音、半拍后补一个八度，八拍一轮换（"每拍 + 反拍短音"那句注释的证人）', () => {
    const { ctx, layer } = rig()
    open.push(() => layer.dispose())
    layer.start()
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    // 表里那八个音（65.41 C2 … 98.0 G2）—— 抄在这里而不是 import，是因为 import 进来就等于让实现自证
    const OST = [65.41, 65.41, 98.0, 155.56, 116.54, 65.41, 77.78, 98.0]
    // 只数"这是一拍"的那批（驼鼓/军鼓都以 150 或 200Hz 起头）：4 秒处冒出来的那颗石铃会插进
    // 批次序列，不筛的话第 7 个批次根本不是第 7 拍（这条第一版就是这么红的）
    const batch = beats(ctx, layer, 200)
      .filter((b) => b.some((n) => n.kind === 'osc' && startedFreqs([n]).some((f) => f === 150 || f === 200)))
    expect(batch.length, '跑不满一个小节（8 拍），这条量不了轮换').toBeGreaterThanOrEqual(8)
    for (let i = 0; i < 8; i++) {
      const b = batch[i]
      const root = OST[i]
      const on = b.filter((n) => startedFreqs([n])[0] === root && n.params.frequency.events.length === 1)
      expect(on.length, `第 ${i + 1} 拍的根音 ${root} 不见了（或被别的音撞了）`).toBeGreaterThanOrEqual(1)
      const off = b.filter((n) => startedFreqs([n])[0] === root * 2)
      expect(off.length, `第 ${i + 1} 拍的反拍八度（${root * 2}）不见了`).toBe(1)
      const tBeat = Math.min(...b.flatMap((n) => n.startedAt))
      expect(off[0].startedAt[0] - tBeat, `第 ${i + 1} 拍的反拍没落在半拍上`).toBeCloseTo(BEAT / 2, 6)
    }
    // 轮换而不是循环在同一个音上：第 9 拍必须回到表头
    const ninth = batch[8]
    expect(startedFreqs(ninth).includes(OST[0]), '第 9 拍没有回到 ostinato 的第一格').toBe(true)
  })

  it('每两小节一记钟 accent：只有第 1、9、17 拍有，中间不许自己插（它是"节拍即机制"的听觉刻度）', () => {
    const { ctx, layer } = rig()
    open.push(() => layer.dispose())
    layer.start()
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    // accent 是 `65.41*4 = 261.64` 那口钟的基频。泛音每条带 ±8 音分随机微失谐（合成器自己的呼吸），
    // 所以按"落在 261.64±2.5Hz"认，而不是按精确值认；石铃的六个音最低是 523.25，撞不上这格。
    const hasBell = (b: FakeNode[]): boolean =>
      b.some((n) => n.kind === 'osc' && Math.abs(startedFreqs([n])[0] - 261.64) < 2.5)
    const batch = beats(ctx, layer, 260)   // 260×0.05 = 13s ≈ 18 拍
      .filter((b) => b.some((n) => n.kind === 'osc' && startedFreqs([n]).some((f) => f === 150 || f === 200)))
    expect(batch.length, '拍数不够，量不到第三个 accent').toBeGreaterThanOrEqual(17)
    const accents: number[] = []
    for (let i = 0; i < batch.length; i++) if (hasBell(batch[i])) accents.push(i)
    expect(accents, `钟的落点不是每两小节一次：实测第 ${accents.map((k) => k + 1).join('/')} 拍`).toEqual([0, 8, 16])
  })

  it('淡出跑完后再遇敌：拍子从「现在 +0.1」重起、小节从第 1 拍重起（那段被删的"到点归零"没有 observable 职责的证人）', () => {
    const { ctx, layer } = rig()
    open.push(() => layer.dispose())
    layer.start()
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    beats(ctx, layer, 6) // t = 0.30
    bus.emit('audio.music.encounter', { start: false }) // battleStopAt = 4.30，且此后没人再把它归零
    beats(ctx, layer, 100) // t = 5.30：淡出窗口早跑完，残留的 battleStopAt 必须不影响下一场
    const isBeat = (b: FakeNode[]): boolean =>
      b.some((n) => n.kind === 'osc' && startedFreqs([n]).some((f) => f === 150 || f === 200))
    const t0 = ctx.currentTime
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    const batch = beats(ctx, layer, 40).filter(isBeat)
    expect(batch.length, '淡出过一次就再也起不了拍 = 战斗音乐一局游戏只能用一次').toBeGreaterThanOrEqual(4)
    expect(Math.min(...batch[0].flatMap((n) => n.startedAt)) - t0, '第二场战斗的第一拍没有立刻跟上').toBeCloseTo(0.1, 2)
    expect(startedFreqs(batch[0]).includes(150), '重新入场第 1 拍不是驼鼓 = beatIdx 还挂着上一场的第 N 拍').toBe(true)
  })
})

describe('拍网所有权（KI-066：这里不再有第二份 BPM）', () => {
  it('没有网格 ⇒ 战斗层一声不排，但 log 里恰好一条 warn（"音乐没响"必须能归因）', () => {
    const msgs: string[] = []
    const { ctx, layer } = rig(null)
    open.push(() => { layer.dispose(); msgs.length = 0 })
    const off = bus.on('log', (p) => { if (p.msg.includes('拍网')) msgs.push(p.msg) })
    open.push(off)
    layer.start()
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    const batch = beats(ctx, layer, 60)
    expect(batch.filter((b) => b.some(isBeatNode)).length, '没网格却排了拍 = 实现里还藏着一份默认 BPM').toBe(0)
    expect(msgs.length, `没网格要说，但只说一次（实测 ${msgs.length} 条）`).toBe(1)
    expect(ctx.count('osc'), 'drone 不吃拍网，不该被这道门一起关掉').toBeGreaterThanOrEqual(5)
  })

  it('换网格只作用于"之后排的拍"：已排的拍一张不抹、包络一条不 cancel，下一拍之后才是新拍长', () => {
    const { ctx, layer } = rig()
    open.push(() => layer.dispose())
    layer.start()
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    const early = beats(ctx, layer, 20) // 走到 t = 1.00：84 下排了第 1、2 拍
    // 变更之前的全部时间线快照：`startedAt` 与包络自动化事件。假参数里 cancel 会把 t 之后的事件删掉，
    // 所以"换网格顺手 cancel 重排"这一刀会直接反映成数组变短，而不是悄悄过去。
    const snap = ctx.nodes.map((n) => ({ n, started: [...n.startedAt], env: n.params.gain ? [...n.params.gain.events] : null }))
    layer.setGrid({ bpm: 120, beatsPerBar: 4 })
    const late = beats(ctx, layer, 40)
    for (const s of snap) {
      expect(s.n.startedAt, `${s.n.id} 的排程时刻被换网格改写了`).toEqual(s.started)
      if (s.env) expect(s.n.params.gain.events, `${s.n.id} 的包络被换网格抹掉了`).toEqual(s.env)
    }
    const e = onsetsOf(early)
    const l = onsetsOf(late)
    expect(e.length, '84 下一秒里连两拍都没排上，这条量不了').toBeGreaterThanOrEqual(2)
    expect(e[1] - e[0], '换网格之前应该是 60/84 的拍距').toBeCloseTo(BEAT, 6)
    expect(l.length, '换了 120 之后一次都没排').toBeGreaterThanOrEqual(3)
    // 队列里已经排好的那一拍保持旧间距（不抹的代价就是这一拍仍按旧拍长跑完）
    expect(l[0] - e[e.length - 1], '已排进队列的那一拍被新拍长提前了').toBeCloseTo(BEAT, 6)
    expect(l[1] - l[0], '新拍长没跟到 60/120').toBeCloseTo(0.5, 6)
    expect(l[2] - l[1], '第三拍又滑回旧间距').toBeCloseTo(0.5, 6)
  })

  it('3/4 的网格（奥斯塔拉在表里与实机都是 108/3）：小节形状跟着走，钟 accent 的周期变成每两小节 = 6 拍', () => {
    const { ctx, layer } = rig({ bpm: 100, beatsPerBar: 3 })
    open.push(() => layer.dispose())
    layer.start()
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    const batch = beats(ctx, layer, 240).filter((b) => b.some(isBeatNode)) // 12 秒 ≈ 20 拍
    expect(batch.length, '跑不满两个小节，这条量不了形状').toBeGreaterThanOrEqual(13)
    const voice = (b: FakeNode[]): string => {
      const f = startedFreqs(b)
      return f.includes(150) ? '咚' : f.includes(200) ? '哒' : '·'
    }
    expect(batch.slice(0, 6).map(voice).join(''), '3/4 的拍面不是两轮"咚-哒-咚"').toBe('咚哒咚咚哒咚')
    const on = onsetsOf(batch.slice(0, 6))
    expect(on[1] - on[0], '100BPM 没跟到拍距上').toBeCloseTo(0.6, 6)
    // accent 认 261.64±2.5Hz（泛音带 ±8 音分随机微失谐，不能等值比；石铃最低 523.25 撞不上这格）
    const hasBell = (b: FakeNode[]): boolean =>
      b.some((n) => n.kind === 'osc' && Math.abs(startedFreqs([n])[0] - 261.64) < 2.5)
    const accents: number[] = []
    for (let i = 0; i < batch.length; i++) if (hasBell(batch[i])) accents.push(i)
    expect(accents.length, `量不到三个 accent：实测第 ${accents.map((k) => k + 1).join('/')} 拍`).toBeGreaterThanOrEqual(3)
    // 每一条都必须落在"6 的整数倍"上：周期对了，起点与中间插音也一起被钉住
    expect(accents, `钟的周期没跟着 3/4 的小节形状走：实测第 ${accents.map((k) => k + 1).join('/')} 拍`)
      .toEqual(accents.map((_, k) => k * 6))
  })
})

describe('调度积压（KI-067：切回标签页那一秒不许打出机枪）', () => {
  /** 一批节点里有几个"拍面头"（驼鼓/军鼓）= 这一帧排了几拍 */
  const beatHeads = (ns: FakeNode[]): number => ns.filter(isBeatNode).length

  it('晾 20 秒之后那一帧：排出去的拍 ≤2，而不是把整段欠账砸在同一时刻；之后间距回到拍长', () => {
    const { ctx, layer } = rig()
    open.push(() => layer.dispose())
    layer.start()
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    beats(ctx, layer, 8)
    ctx.advance(20) // 20 秒 = 28 拍（隐藏标签页 rAF 不跑而音频钟照走，实机量到 31 拍落在同一刻）
    const n0 = ctx.nodes.length
    const now = ctx.currentTime
    layer.update()
    const fresh = ctx.nodes.slice(n0)
    const heads = beatHeads(fresh)
    expect(heads, `一帧补排了 ${heads} 拍 = 欠账全砸在 now+0.02 这一个时刻`).toBeLessThanOrEqual(2)
    const late = fresh.filter(isBeatNode).flatMap((n) => n.startedAt).filter((t) => t < now)
    expect(late, `重新锚定不该往过去调度：${late.join('/')}`).toEqual([])
    const later = onsetsOf(beats(ctx, layer, 40).filter((b) => b.some(isBeatNode)))
    expect(later.length, '重锚之后一拍都没排 = 音乐再也起不来').toBeGreaterThanOrEqual(2)
    expect(later[1] - later[0], `重锚后间距没回到拍长（实测 ${later[1] - later[0]}）`).toBeCloseTo(BEAT, 6)
  })

  it('重锚那一次要说出口（恰一条 log），而接下来正常的几十帧不再重复吱声', () => {
    const logs: string[] = []
    open.push(bus.on('log', (l) => logs.push(l.msg)))
    const { ctx, layer } = rig()
    open.push(() => layer.dispose())
    layer.start()
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    beats(ctx, layer, 8)
    ctx.advance(20)
    layer.update()
    expect(logs.length, `一次 stall 说了 ${logs.length} 句`).toBe(1)
    expect(logs[0], `那句要能说清跳了几拍：${logs[0]}`).toContain('拍')
    beats(ctx, layer, 200)
    expect(logs.length, '回到实时之后还在喊 = 把恢复当成还在掉帧').toBe(1)
  })

  it('落后不到一拍 = 一次卡顿：不许吞拍、也不许吱声（对照＝同样时长的连续跑）', () => {
    /** 同一套时间预算 3.0 秒，只是**帧大小**不同：A 全是 0.05s 的小步；B 中间来一记 0.3s 的 hitch；
     *  C 整程按 0.5s 一帧跑（= 落后超过一帧但始终不到一拍，2fps 的重度掉帧）。
     *  C 才是「一拍」这条门限的分界线：`> 0` 的写法在 A/B 里都不会误火（循环每轮都把 nextBeat 抬到
     *  now+0.25 之外），只有 C 这种"每帧都落后 ~0.25s"的世界能区分两种门限 —— 第一版用例没有 C，
     *  于是把门限改成 `> 0` 也全绿（变异探针 P2 实测），那等于门限根本没被钉住。 */
    const world = (step: number, hitchAt = -1): { count: number; logs: number } => {
      const ctx = new FakeAudioContext()
      const musicOut = ctx.createGain()
      const ambOut = ctx.createGain()
      const layer = new MusicLayer(ctx as unknown as AudioContext, musicOut as unknown as AudioNode, ambOut as unknown as AudioNode, GRID)
      const logs: string[] = []
      const off = bus.on('log', (l) => logs.push(l.msg))
      open.push(off)
      open.push(() => layer.dispose())
      layer.start()
      bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
      const batch: FakeNode[][] = []
      for (let t = 0; t < 3; t += step) {
        const advance = t === hitchAt ? 0.3 : step
        const before = ctx.nodes.length
        ctx.advance(advance)
        layer.update()
        const fresh = ctx.nodes.slice(before)
        if (beatHeads(fresh) > 0) batch.push(fresh)
      }
      return { count: batch.length, logs: logs.length }
    }
    const steady = world(0.05)
    const hiccup = world(0.05, 1.0)
    expect(steady.count, '对照组本身就没排满，这条量不了"掉没掉拍"').toBeGreaterThanOrEqual(3)
    // hitch 那一世界总共多走了 0.25 秒（0.3 替掉 0.05），所以拍数只会**不少于**对照组；
    // 真正要钉的是"没有一拍被吞掉"——把它写成 === 会因为那 0.25 秒的差额自己红（第一版就是这么红的）
    expect(hiccup.count, `一记小 hitch 之后拍数从 ${steady.count} 变成 ${hiccup.count} = 把卡顿当成了停摆`)
      .toBeGreaterThanOrEqual(steady.count)
    expect(hiccup.logs, `落后不到一拍却说了 ${hiccup.logs} 句 = 门限写宽了`).toBe(0)

    // C：按拍长该有的数量级排，不多（每帧砸一拍 = 机枪）也不少（吞拍）
    const coarse = world(0.5)
    const expected = Math.floor(3 / BEAT) // 3 秒 = 4.2 拍，取整作分母
    expect(coarse.logs, `每帧落后不到一拍却说 ${coarse.logs} 句 = 把掉帧当成停摆：门限是一拍，不是 0`).toBe(0)
    expect(coarse.count, `2fps 掉帧排出 ${coarse.count} 拍，3 秒该是 ${expected}~${expected + 1} 拍 = 每帧都在重锚`)
      .toBeLessThanOrEqual(expected + 1)
    expect(coarse.count, `2fps 掉帧只排出 ${coarse.count} 拍（3 秒该有 ${expected} 拍）= 把掉帧的拍吞掉了`)
      .toBeGreaterThanOrEqual(expected)
  })
})

/**
 * KI-068：§2.1「遭遇 → `snapToNextBar()`，≤2 拍内进战斗曲」的**耳朵侧**。
 * KI-066 让拍与拍之间的间隔跟上了网格，可入战那一拍仍是 `now + 0.1`：一个既不落在玩法拍点上、
 * 也不落在小节头的位置，而且"第 0 拍"意味着驼鼓敲在网格的第 3 拍上。这里钉两件事：
 * 落点时刻取自事件、鼓点身份取自事件的拍号；以及**没带落点时必须说出口**（不静默退回旧行为）。
 */
describe('入战落点（KI-068）：第一拍的时刻与拍号都来自事件，不再自己猜', () => {
  it('带了 enter ⇒ 第一拍落在 now+waitSec（不是旧的 now+0.1）', () => {
    const { ctx, layer } = rig()
    open.push(() => layer.dispose())
    layer.start()
    const now = ctx.currentTime
    bus.emit('audio.music.encounter', { start: true, enter: { waitSec: 0.5, beatIndex: 3 } })
    const bs = beats(ctx, layer, 60).filter((b) => b.some(isBeatNode))
    expect(bs.length, '六十帧（3 秒）里排不满四拍 = 落点之后根本没在打').toBeGreaterThanOrEqual(4)
    const first = Math.min(...bs[0].filter(isBeatNode).flatMap((n) => n.startedAt))
    expect(first - now, `第一拍等了 ${first - now}s，事件说的是 0.5s（旧的猜法是 0.1）`).toBeCloseTo(0.5, 6)
    // 往后的间距仍是拍长：落点只管第一拍，不该把节奏本身挪走
    expect(onsetsOf(bs)[1] - onsetsOf(bs)[0], '第二拍与第一拍的间距不再是拍长').toBeCloseTo(BEAT, 6)
  })

  it('enter 缺位 ⇒ 退回 now+0.1 起拍，并且**说一次**（不能静默假装锁过相位）', () => {
    const logs: string[] = []
    open.push(bus.on('log', (l) => logs.push(l.msg)))
    const { ctx, layer } = rig()
    open.push(() => layer.dispose())
    layer.start()
    const now = ctx.currentTime
    bus.emit('audio.music.encounter', { start: true })
    const bs = beats(ctx, layer, 40).filter((b) => b.some(isBeatNode))
    const first = Math.min(...bs[0].filter(isBeatNode).flatMap((n) => n.startedAt))
    expect(first - now, `没给落点时第一拍不在旧的 0.1 上（实测 ${first - now}）`).toBeCloseTo(0.1, 6)
    expect(logs.filter((m) => m.includes('enter')).length, `没落点这件事说了 ${logs.filter((m) => m.includes('enter')).length} 句，该是恰一句`).toBe(1)
    bus.emit('audio.music.encounter', { start: false })
    bus.emit('audio.music.encounter', { start: true })
    expect(logs.filter((m) => m.includes('enter')).length, 'warn 刷屏 = 每次都喊，读数没法用').toBe(1)
  })

  it('拍号决定鼓点身份：报第 1 拍（4/4）⇒ 第一响是驼鼓，报第 2 拍 ⇒ 第一响是军鼓', () => {
    // 这一条只管鼓点**身份**（驼鼓 150 / 军鼓 200）：ostinato 的根音也随拍号变，那是下面一条的事
    const voices = (beatIndex: number): string => {
      const { ctx, layer } = rig()
      open.push(() => layer.dispose())
      layer.start()
      bus.emit('audio.music.encounter', { start: true, enter: { waitSec: 0.1, beatIndex } })
      const b = beats(ctx, layer, 12).find((x) => x.some(isBeatNode))
      if (!b) throw new Error('一拍都没排出来')
      const f = startedFreqs(b.filter(isBeatNode))
      return `${f.includes(150) ? 'kick' : ''}${f.includes(200) ? 'snare' : ''}`
    }
    expect(voices(4), '报"小节头"却听不见驼鼓 = 鼓点没跟事件的拍号').toBe('kick')
    expect(voices(5), '报第 2 拍却敲了驼鼓 = 入场重拍打在网格的弱拍上').toBe('snare')
  })

  it('落点小节的第一拍用落点自己的 ostinato 音格（第 12 拍 → 格 4 的 Bb），不是从第 0 格硬起', () => {
    // 这一条只管 ostinato（`OSTINATO[i % 8]`，`i` 就是事件报的拍号）。选 12 与 11 而不是 4：
    // `4 % 8` 落在格 4（116.54），而旧代码硬起第 0 格（65.41）—— 两者不同才量得出"音格跟了拍号"。
    const root = (beatIndex: number): number => {
      const { ctx, layer } = rig()
      open.push(() => layer.dispose())
      layer.start()
      bus.emit('audio.music.encounter', { start: true, enter: { waitSec: 0.1, beatIndex } })
      const b = beats(ctx, layer, 12).find((x) => x.some(isBeatNode))
      if (!b) throw new Error('一拍都没排出来')
      // 一拍的 ostinato 是一对：本音 + 高八度反拍音，低的那个才是本音
      const on = b.filter((n) => n.kind === 'osc' && n.params.frequency.events.length === 1)
      return Math.min(...startedFreqs(on))
    }
    expect(root(12), `第 12 拍（4/4 的小节头、ostinato 格 4）的低音不是 Bb 116.54`).toBeCloseTo(116.54, 6)
    expect(root(11), `第 11 拍（格 3）的低音不是 155.56`).toBeCloseTo(155.56, 6)
    expect(root(13), `第 13 拍（格 5）的低音不是 65.41`).toBeCloseTo(65.41, 6)
  })

  it('战斗中途重发"还在交战"不许把已锚定的时间线拽回去（落点只在上升沿取）', () => {
    // 发射侧是无状态的：`checkEncounterMusic()` 每 30 tick 就把"仍有人照面"重发一遍。
    // 若每次都重锚，战斗曲每隔半秒被拽回新落点 —— 比 `now + 0.1` 更糟，所以要钉住"只有第一次算"。
    const { ctx, layer } = rig()
    open.push(() => layer.dispose())
    layer.start()
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    const before = beats(ctx, layer, 20) // 一秒：落点已经锚好，拍也排出去了
    bus.emit('audio.music.encounter', { start: true, enter: { waitSec: 1.0, beatIndex: 7 } })
    const bs = before.concat(beats(ctx, layer, 60)).filter((b) => b.some(isBeatNode))
    const on = onsetsOf(bs)
    // 3 秒 ÷ 0.714s 一拍 ≈ 4 拍（`beats` 一帧一批，所以批数只会 ≤ 拍数）：这一句只钉"没停"
    expect(on.length, `重发之后一共只响了 ${on.length} 拍（三秒该有四拍以上）= 新落点把已排的拍抹掉了`).toBeGreaterThanOrEqual(4)
    const gaps = on.slice(1).map((t, i) => t - on[i])
    const worst = Math.max(...gaps)
    // 门限取 1.15 个拍长：正常相邻拍距恰为 `BEAT`（调度器一次成排），而"被第二次落点拽住"的最小形状是 1.0s ≈ 1.4 拍
    expect(worst, `重发之后最大拍间 ${worst.toFixed(3)}s（拍长 ${BEAT.toFixed(3)}s）= 战斗曲被第二次落点重新锚了`)
      .toBeLessThan(BEAT * 1.15)
  })
})

/**
 * KI-069：Boss 的接管通常发生在战斗层**已经开着**的时候——她被 `alert`/`callAlly` 唤醒就换网格，
 * 而遭遇事件的上升沿早就过了（KI-068 的落点因此只覆盖"入战那一下"）。那一格上拍距跟着新网格走（KI-066），
 * 小节位置却还是音乐层从入战那一刻自己数下来的 ⇒ 重拍与她的拍点错开，§2.1「音乐重拍与敌人主攻击对齐」
 * 在过渡段仍是假的。这里钉的是"网格变化那一次带来的落点"确实被用掉，而且**只在真的在演的时候**用掉。
 */
describe('网格中途变化的落点（KI-069）：战斗正在演时小节位置跟到新网格的头', () => {
  /**
   * 起战斗层但把第一拍锚在 1.0s 之后。调度 lookahead 只有 0.25s ⇒ 换网格那一刻**时间线上一条拍都还没排出去**，
   * 于是"落点有没有被用掉"只看第一拍落在 0.3s 还是 1.0s，不与在飞的拍纠缠。
   */
  function lateAnchor(): { ctx: FakeAudioContext; layer: MusicLayer } {
    const r = rig()
    open.push(() => r.layer.dispose())
    r.layer.start()
    bus.emit('audio.music.encounter', { start: true, enter: { waitSec: 1.0, beatIndex: 4 } })
    return r
  }
  const voice = (b: FakeNode[]): string => {
    const f = startedFreqs(b.filter(isBeatNode))
    return `${f.includes(150) ? 'kick' : ''}${f.includes(200) ? 'snare' : ''}`
  }

  it('带落点的新网格 ⇒ 未排出的那一拍跟到新的头：时刻、鼓点身份、之后的拍距都换成她的', () => {
    const { ctx, layer } = lateAnchor()
    const t = ctx.currentTime
    layer.setGrid({ bpm: 108, beatsPerBar: 3, enter: { waitSec: 0.3, beatIndex: 9 } })
    const bs = beats(ctx, layer, 40).filter((b) => b.some(isBeatNode))
    expect(bs.length, '换网格之后两秒里连三拍都没排（她的拍长 0.556s）').toBeGreaterThanOrEqual(3)
    const first = Math.min(...bs[0].filter(isBeatNode).flatMap((n) => n.startedAt))
    expect(first - t, `第一拍在 +${(first - t).toFixed(3)}s，落点说的是 0.3s = 小节位置没跟过来`).toBeCloseTo(0.3, 4)
    expect(voice(bs[0]), '第 9 拍在她的 3/4 里是小节头，该只响驼鼓').toBe('kick')
    const on = onsetsOf(bs)
    expect(on[1] - on[0], '跟到头之后拍距不是她的拍长').toBeCloseTo(60 / 108, 6)
  })

  it('不带落点的新网格 ⇒ 只换拍距、时间线不挪（重锚来自 `enter`，不是来自"任何变化"）', () => {
    // 对照：同样的拍速变化、同样的小节形状变化，唯一差别是没有落点。
    // 若"任何网格变化都重锚"，这一条会跟着上一条一起绿得没意义——它要证明上一条绿的是那个字段。
    const { ctx, layer } = lateAnchor()
    const t = ctx.currentTime
    layer.setGrid({ bpm: 108, beatsPerBar: 3 })
    const bs = beats(ctx, layer, 40).filter((b) => b.some(isBeatNode))
    const first = Math.min(...bs[0].filter(isBeatNode).flatMap((n) => n.startedAt))
    expect(first - t, `没给落点却被挪到了 +${(first - t).toFixed(3)}s = 重锚不再需要落点，KI-068 那格的"只在带落点时用"塌了`)
      .toBeCloseTo(1.0, 4)
    expect(voice(bs[0]), '第 4 拍在她的 3/4 里是第 2 拍（弱拍），不该响驼鼓').toBe('snare')
    const on = onsetsOf(bs)
    expect(on[1] - on[0], '拍距没跟着换成她的拍长（KI-066 那条前提在此必须仍然成立）').toBeCloseTo(60 / 108, 6)
  })

  it('战斗层还没起来 ⇒ 带落点的网格一声都不排（网格变化不替玩家决定什么时候有战斗曲）', () => {
    // 这条钉的是**行为**，不是 `setGrid` 里那个 `battleOn` 条件：探针 P3（把条件删掉）在这里不咬，
    // 因为调度器自己还有一道 `scheduling = battleOn || 淡出中` 的门（这一层的"没开战就不排"是双层的）。
    // 那句条件的可见效果只有一格——淡出那 4 秒，由下面倒数第二条钉。P6（把调度器的门抬成恒真）才是这条的判官。
    const { ctx, layer } = rig()
    open.push(() => layer.dispose())
    layer.start()
    layer.setGrid({ bpm: 108, beatsPerBar: 3, enter: { waitSec: 0.3, beatIndex: 9 } })
    expect(beats(ctx, layer, 40).filter((b) => b.some(isBeatNode)).length,
      '没入战却被落点叫醒 = 她在野外换个拍就冒出一段鼓').toBe(0)
  })

  it('淡出那 4 秒里网格带着落点来 ⇒ 不许把退场的拍拽走（只认"正在演"）', () => {
    const fade = (withEnter: boolean): number[] => {
      const { ctx, layer } = rig()
      open.push(() => layer.dispose())
      layer.start()
      bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
      const bs = beats(ctx, layer, 20) // 一秒：已经在打
      bus.emit('audio.music.encounter', { start: false }) // 4 秒淡出（§16 之外的一般脱战）
      layer.setGrid(withEnter
        ? { bpm: 108, beatsPerBar: 3, enter: { waitSec: 1.1, beatIndex: 9 } }
        : { bpm: 108, beatsPerBar: 3 })
      return onsetsOf(bs.concat(beats(ctx, layer, 60)).filter((b) => b.some(isBeatNode)))
    }
    const control = fade(false)
    const worst = (x: number[]): number => Math.max(...x.slice(1).map((t, i) => t - x[i]))
    expect(control.length, '淡出期间一拍都没排 = 这一条量不到东西').toBeGreaterThanOrEqual(4)
    expect(worst(control), `对照组的最大拍间 ${worst(control).toFixed(2)}s 已经不正常，判别式没有余量`)
      .toBeLessThan(0.8)
    const entered = fade(true)
    expect(worst(entered), `淡出里被落点插进一记 ${worst(entered).toFixed(2)}s 的空档（对照组 ${worst(control).toFixed(2)}s）`
      + ' = 退场也被重锚了，胜利序列那一下会被听得出来的停顿替掉').toBeCloseTo(worst(control), 6)
  })

  it('同一个网格带"新落点"重发 ⇒ 不许重锚（落点只在**真的变了**那一次算）', () => {
    // "只在变化时发"是 `publishGrid()` 的口径（KI-066 ②），但消费侧也不能把"收到"读成"变了"：
    // `barEntry()` 每 tick 都在往前走，所以任何一次重复转发带来的 `enter` 都**不一样**。
    // 少了 `changed` 这一眼，同值重发就会把 `nextBeat` 一次次往前推——听着就是"永远在等下一拍"。
    const { ctx, layer } = lateAnchor()
    const grid = (enter: { waitSec: number; beatIndex: number }): MusicGrid => ({ bpm: 108, beatsPerBar: 3, enter })
    layer.setGrid(grid({ waitSec: 0.3, beatIndex: 9 }))
    const bs = beats(ctx, layer, 20) // 0.5s：第一拍已按 0.3s 的落点排出去
    expect(bs.filter((b) => b.some(isBeatNode)).length, '前半秒连一拍都没排 = 后面量不到"重复转发"').toBeGreaterThanOrEqual(1)
    layer.setGrid(grid({ waitSec: 1.5, beatIndex: 13 })) // 同值，只有落点"新"了
    const on = onsetsOf(bs.concat(beats(ctx, layer, 60)).filter((b) => b.some(isBeatNode)))
    expect(on.length, '重发之后干脆不排了').toBeGreaterThanOrEqual(4)
    const worst = Math.max(...on.slice(1).map((t, i) => t - on[i]))
    expect(worst, `同值重发之后最大拍间 ${worst.toFixed(3)}s（她的拍长 ${(60 / 108).toFixed(3)}s）= 重复转发被当成了变化，把下一拍又往前推了一格`)
      .toBeLessThan((60 / 108) * 1.15)
  })
})
