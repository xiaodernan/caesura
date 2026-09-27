import { afterEach, describe, expect, it, vi } from 'vitest'
import { bus } from '@/core/EventBus'
import { MusicLayer } from '@/audio/music'
import type { MusicGrid } from '@/core/RhythmClock'
import type { AmbienceBed } from '@/data/schema'
import { BELL_CENTS } from '@/audio/synth'
import { FakeAudioContext, FakeNode } from '../support/fakeAudio'

/**
 * 音乐层的可断言面（KI-065 开了这块，KI-066 把拍网的所有权交回 `RhythmClock`，KI-077 把音高交回 `ambience.json`）。
 *
 * 这里断的是**时间结构**：拍距、鼓点上哪个是驼鼓哪个是军鼓、脱战 4s 淡出、`cut` 立刻掐、
 * 环境声床的 drone 形状与跨区 crossfade 窗口。听感（"这套鼓好不好听"）不在这一份的保证范围里，
 * 本机没有可被听的输出（KI-010 同因）。
 *
 * ⚠️ 拍网是**注入**的（`rig(grid)`），不是这一层自带的：KI-066 之前 `music.ts` 顶上写着 `const BPM = 84`，
 * 于是"84"这个数字有了两个主人，而音频那一个从不跟 `RhythmClock` 走。所以现在测试要自己声明输入是什么，
 * 而"没有输入就不排拍"本身成为一条用例。
 *
 * ⚠️ 声床同样是**注入**的（`rig(grid, bed)`），而这两条腿的注入形状不一样是有意的：这里给的是**行对象**，
 * 因为 id→行 的解析住在 `AudioEngine`（那张表的读者只有它，见 `audio-engine.test.ts` 那两条）。
 * 测试用的床是这里自己写的合成行，**不是从 `ambience.json` 抄的**——拿真表验"跟着床走"等于让实现自证：
 * 写死哪一张都可能碰巧对。合成行的频率（700/800/1100/1200…）刻意与旧代码写死的那组 C2 值（65.41/98/130.81）
 * 以及 `OSTINATO`、驼鼓 150、军鼓 200、accent 261.64 全都不撞，所以"图里出现了 87.31"只能是被喂了这张床。
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

/* ------------------------------------------------------------------ */
/* KI-077：合成声床。字段形状 = `schema.ts > AmbienceBed`，值是本文件编的（见上面那段） */
/* ------------------------------------------------------------------ */

/** A 床：休垒那张的形状（四条层 + 低通 + 呼吸），铃点名册 `[700, 800]`、每 5 秒一颗 */
const BED_A: AmbienceBed = {
  id: 'bed_a',
  layers: [
    { hz: 87.31, wave: 'sawtooth', peak: 0.035, detune: -5 },
    { hz: 87.31, wave: 'sawtooth', peak: 0.03, detune: 6 },
    { hz: 43.65, wave: 'sine', peak: 0.05, detune: 0 },
    { hz: 130.81, wave: 'sine', peak: 0.012, detune: 2 }
  ],
  lpHz: 300,
  breath: { hz: 0.07, depth: 0.008 },
  bell: { scale: [700, 800], everySec: [4, 6], peak: [0.02, 0.05], hammerP: 0 }
}
/** B 床：另一区（主音差一个全音、低通更暗、铃点名册换成 `[1100, 1200]`）——换床要看得见的是"跟着变了" */
const BED_B: AmbienceBed = {
  id: 'bed_b',
  layers: [
    { hz: 98.0, wave: 'sawtooth', peak: 0.032, detune: -6 },
    { hz: 49.0, wave: 'sine', peak: 0.05, detune: 0 }
  ],
  lpHz: 220,
  breath: { hz: 0.05, depth: 0.01 },
  bell: { scale: [1100, 1200], everySec: [8, 10], peak: [0.02, 0.05], hammerP: 0 }
}
/** 未竟厅形状（§4「无 drone——风箱底噪」）：`layers` 空数组，但铃点照掷 */
const BED_HALL: AmbienceBed = {
  id: 'bed_hall',
  layers: [],
  bell: { scale: [700, 800], everySec: [4, 6], peak: [0.02, 0.05], hammerP: 0 }
}
/** 无耳深窖形状：有 drone 但 `bell: null`（§4 那一格「40Hz 次声」没有旋律事件） */
const BED_CRYPT: AmbienceBed = {
  id: 'bed_crypt',
  layers: [{ hz: 40.0, wave: 'sine', peak: 0.06, detune: 0 }],
  lpHz: 110,
  breath: { hz: 0.045, depth: 0.01 },
  bell: null
}

function rig(
  grid: MusicGrid | null = GRID,
  bed: AmbienceBed | null = null
): { ctx: FakeAudioContext; layer: MusicLayer; musicOut: FakeNode; ambOut: FakeNode } {
  const ctx = new FakeAudioContext()
  const musicOut = ctx.createGain()
  const ambOut = ctx.createGain()
  const layer = new MusicLayer(
    ctx as unknown as AudioContext,
    musicOut as unknown as AudioNode,
    ambOut as unknown as AudioNode,
    grid,
    bed
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

/**
 * 起层之后按 `step` 秒一帧地推时间，返回每次 update 新建的节点 **以及掷出它们的那一帧的时刻**。
 *
 * 时刻这一半是 KI-077 才需要的：铃点的周期要按 `bell.everySec` 量，而 `playBell` 排的是
 * `now + 0.02`（前瞻，防调度落在过去），拿 `startedAt` 读间隔会把这 0.02 混进读数——
 * 它既不属于那张床的间隔，也不属于 crossfade 窗口。「什么时候决定要敲」才是被量的那个数。
 */
function beatFrames(ctx: FakeAudioContext, layer: MusicLayer, count: number, step = 0.05): Array<{ t: number; nodes: FakeNode[] }> {
  const out: Array<{ t: number; nodes: FakeNode[] }> = []
  for (let i = 0; i < count; i++) {
    const before = ctx.nodes.length
    ctx.advance(step)
    layer.update()
    const fresh = ctx.nodes.slice(before)
    if (fresh.length) out.push({ t: Number(ctx.currentTime.toFixed(6)), nodes: fresh })
  }
  return out
}

/** 只要节点批次的那一面（拍距/鼓点那批用例不关心决策时刻） */
function beats(ctx: FakeAudioContext, layer: MusicLayer, count: number, step = 0.05): FakeNode[][] {
  return beatFrames(ctx, layer, count, step).map((f) => f.nodes)
}

/**
 * 这一床自己的层增益（crossfade 淡的就是它）。`layerGain(ctx, ambOut)` 拿到的是 MusicLayer 的**总**
 * ambience 层，而 KI-077 之后 drone 挂在"每一床一只"的层增益上，所以这里要往下再问一层。
 * 认法 = "接在总层上、且有一条低通喂给它"的那个 gain：石铃每一敲的包络把手也接在总层上，
 * 但它是振荡直接喂的（没有低通），所以不会被误认成床把手（换床期间新旧两只同时在，更要分得清）。
 */
function bedGains(ctx: FakeAudioContext, ambLayer: FakeNode): FakeNode[] {
  return ctx.nodes.filter((n) => n.kind === 'gain'
    && ctx.edges.some((e) => e.from === n && e.to === ambLayer)
    && ctx.edges.some((e) => e.to === n && e.from.kind === 'biquad'))
}

/** 挂在某一只床把手下的整组节点（含把手、低通、每条层的小把手与呼吸那条链） */
function droneNodes(ctx: FakeAudioContext, handle: FakeNode): FakeNode[] {
  const lp = ctx.nodes.find((n) => n.kind === 'biquad' && ctx.edges.some((e) => e.from === n && e.to === handle))
  const smalls = lp ? ctx.nodes.filter((n) => n.kind === 'gain' && ctx.edges.some((e) => e.from === n && e.to === lp)) : []
  const oscs = ctx.nodes.filter((n) => n.kind === 'osc' && smalls.some((g) => ctx.edges.some((e) => e.from === n && e.to === g)))
  // 呼吸那条也属于这一床：LFO → 深度增益 → 床把手的 gain 参数（接的是 Param，不是节点）
  const depth = ctx.nodes.find((n) => n.kind === 'gain' && ctx.edges.some((e) => e.from === n && e.to === handle.gain))
  const lfo = depth ? ctx.nodes.find((n) => n.kind === 'osc' && ctx.edges.some((e) => e.from === n && e.to === depth)) : undefined
  return [handle, lp, ...smalls, ...oscs, depth, lfo].filter((n): n is FakeNode => !!n)
}

/** 这一床此刻在响的 drone 频率（只数声部振荡：呼吸 LFO 是调制源，不是音高，要排除） */
function droneFreqs(ctx: FakeAudioContext, handle: FakeNode): number[] {
  const depth = ctx.nodes.find((n) => n.kind === 'gain' && ctx.edges.some((e) => e.from === n && e.to === handle.gain))
  return droneNodes(ctx, handle)
    .filter((n) => n.kind === 'osc' && !(depth && ctx.edges.some((e) => e.from === n && e.to === depth)))
    .map((n) => n.params.frequency.value)
}

/**
 * 这一床此刻的声部名单，**顺序 = 表里 `layers` 的顺序**（小把手与振荡都按建图顺序排在 `ctx.nodes` 里）。
 *
 * 为什么整体比名单而不是"按 hz 去 `find` 那一条"：A 床的前两条同频（87.31 相差 11 音分的双层，§4 的
 * "同一根主音失谐成一条"），`find` 会把它们读成同一条 —— 第一版这份测试就是这样，两条都拿第一条去比，
 * 报出 `expected -5 to be 6`（同频两条的失谐互为 −5/+6，谁也没被读到第二遍）。名单整体比就没有这个歧义，
 * 而且顺带成为"每条层各有一只自己的把手"的证人：四条层就是四个元素、四个各自的 `peak`。
 */
function droneVoices(ctx: FakeAudioContext, handle: FakeNode): Array<{ hz: number; wave: string; detune: number; peak: number }> {
  const lp = ctx.nodes.find((n) => n.kind === 'biquad' && ctx.edges.some((e) => e.from === n && e.to === handle))
  if (!lp) throw new Error('这一床没有低通 = drone 根本没建出来，名单无从谈起')
  const smalls = ctx.nodes.filter((n) => n.kind === 'gain' && ctx.edges.some((e) => e.from === n && e.to === lp))
  return smalls.map((g) => {
    const o = ctx.nodes.find((n) => n.kind === 'osc' && ctx.edges.some((e) => e.from === n && e.to === g))
    if (!o) throw new Error(`小把手 ${g.id} 后面没有振荡 = 那条层只有音量没有声音`)
    return { hz: o.params.frequency.value, wave: o.type, detune: o.params.detune.value, peak: g.params.gain.value }
  })
}

/**
 * "这一批节点里有一敲石铃"的记号：基频落在 `scale` 某一格上。
 * 容差从生产自己的抖动常量推（`synth.ts > BELL_CENTS`：每条泛音 ±8 音分），不是手填一个 2.5——
 * 手填的数一旦比真抖动小就是自己红，比它大就会把别的声音认成铃。
 */
function bellNodes(ns: FakeNode[], scale: number[]): FakeNode[] {
  return ns.filter((n) => {
    if (n.kind !== 'osc') return false
    const f = startedFreqs([n])[0]
    return scale.some((s) => Math.abs(f - s) <= (BELL_CENTS / 1200) * s + 0.01)
  })
}

/**
 * 一敲石铃的记号：一次 `playBell` 在同一帧里建出 6 条泛音 + FM 载波/调制（≥7 条振荡），
 * 而合成床里最大的 drone 只有 4 条层 + 1 条 LFO = 5 条，所以"这批有 ≥6 条振荡且挂在总层上"就是铃。
 * 这样认而不是"频率落在名册上"认，是因为它还能反过来抓**名册之外**的音（下面 T2 用这个）。
 */
function chimeBatches(batches: FakeNode[][], inner: FakeNode): FakeNode[][] {
  return batches.filter((b) => reaches(b, inner) && b.filter((n) => n.kind === 'osc').length >= 6)
}

/** `chimeBatches` 那面旗的"带时刻"版本：只留有铃敲的那些帧，时刻留给间隔那条断言用 */
function chimeFrames(frames: Array<{ t: number; nodes: FakeNode[] }>, inner: FakeNode): Array<{ t: number; nodes: FakeNode[] }> {
  return frames.filter((f) => chimeBatches([f.nodes], inner).length > 0)
}


describe('ambience：区域声床（KI-077：底噪与铃点跟着注入的那张床走）', () => {
  it('一张床 = 表里那几条层的 hz/wave/detune/peak 全落到图上，且一起过同一只 lpHz 低通', () => {
    const { ctx, layer, ambOut } = rig(GRID, BED_A)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    const handle = bedGains(ctx, inner)[0]
    expect(handle, '这一床没有自己的层把手 = 换床时没有可淡的东西').toBeTruthy()
    expect(droneVoices(ctx, handle!), '表里那几条层没有按表落到图上（hz/波形/失谐/peak，含顺序）')
      .toEqual(BED_A.layers.map((l) => ({ hz: l.hz, wave: l.wave, detune: l.detune, peak: l.peak })))
    // 四条层汇到同一只低通（上面那份名单就是从"振荡→自己的把手→这只低通"读出来的），
    // 低通汇到**这一床自己的**层把手，把手再汇回 ambience 总层 —— 中间那一跳是 crossfade 的把手，
    // 少了它就没法淡（第一版把这条写成"低通直接接总层"，那是 KI-077 之前的形状）。
    const lp = ctx.nodes.find((n) => n.kind === 'biquad' && ctx.edges.some((e) => e.from === n && e.to === handle))
    expect(lp?.params.frequency.value, `drone 的 ${BED_A.lpHz}Hz 低通不见了（§4「只透低频」的落点）`).toBe(BED_A.lpHz)
    expect(ctx.edges.some((e) => e.from === handle && e.to === inner), '床把手没接回 ambience 层 = 这一区根本不响').toBe(true)
  })

  it('换一张床就是换一组频率与一只低通：新床的 drone 挂在它自己的把手上，旧床那一组还在但在淡', () => {
    const { ctx, layer, ambOut } = rig(GRID, BED_A)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    const handleA = bedGains(ctx, inner)[0]
    layer.setAmbience(BED_B)
    const handles = bedGains(ctx, inner)
    expect(handles.length, `换床之后床把手应有新旧两只，实测 ${handles.length}`).toBe(2)
    expect(droneFreqs(ctx, handles[1]).sort((a, b) => a - b), '新床的 drone 没跟着表建').toEqual([49, 98])
    expect(droneFreqs(ctx, handleA).sort((a, b) => a - b), '换床把旧床的 drone 直接抹了（应当是淡出，不是断电）')
      .toEqual([43.65, 87.31, 87.31, 130.81])
    // 两只把手的去处：旧的斜降到 0，新的从 0 斜升到 1 —— crossfade 的两半都要有证人
    expect(handleA.params.gain.events.some((e) => e.kind === 'lin' && e.value === 0), '旧床没被淡掉').toBe(true)
    expect(handles[1].params.gain.events.some((e) => e.kind === 'lin' && e.value === 1), '新床没被推起来').toBe(true)
    const lps = ctx.nodes.filter((n) => n.kind === 'biquad').map((n) => n.params.frequency.value)
    expect(lps, '换床应当换低通（新旧两张表各一只）').toEqual(expect.arrayContaining([BED_A.lpHz!, BED_B.lpHz!]))
  })

  it('呼吸 LFO 调的是这一床自己的层增益，不是总 ambience 层（否则换床淡不掉，全场一起呼吸）', () => {
    const { ctx, layer, ambOut } = rig(GRID, BED_A)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    const handle = bedGains(ctx, inner)[0]
    expect(handle, '这一床没有自己的层增益 = crossfade 没有可淡的把手').toBeTruthy()
    const lfo = ctx.nodes.find((n) => n.kind === 'osc' && n.params.frequency.value === BED_A.breath!.hz)
    expect(lfo, '呼吸 LFO 不见了（drone 会变成死垫子）').toBeTruthy()
    const depth = ctx.edges.find((e) => e.from === lfo)?.to as FakeNode
    expect(depth, 'LFO 没接到深度增益上').toBeTruthy()
    expect(depth.params.gain.value, '深度没跟着表里的 breath.depth').toBe(BED_A.breath!.depth)
    expect(ctx.edges.some((e) => e.from === depth && e.to === handle.gain), 'LFO → 深度增益 → 床把手 这条链断了').toBe(true)
    expect(ctx.edges.some((e) => e.from === depth && e.to === inner.gain), '呼吸接到了总层 = 全场一起呼吸').toBe(false)
    // 淡入把手本身：0 → 1
    expect(handle.params.gain.events.some((e) => e.kind === 'lin' && e.value === 1), '这一床没被推起来').toBe(true)
  })

  it('一张床都没注入时不建 drone，而 `start()` 把这件事说出口（一次，不刷屏）', () => {
    const msgs: string[] = []
    open.push(bus.on('log', (l) => { if (l.msg.includes('声床')) msgs.push(l.msg) }))
    const { ctx, layer, ambOut } = rig(GRID, null)
    open.push(() => layer.dispose())
    layer.start()
    expect(ctx.count('osc'), '没有床却建了 drone = 表外还留着一份写死的底噪').toBe(0)
    expect(msgs.length, `没床要说，但只说一次（实测 ${msgs.length} 句）`).toBe(1)
    layer.start()
    expect(msgs.length, '重复 start 又喊了一句').toBe(1)
    // 总音量那条腿与床无关：仍然 3 秒推到 0.6
    expect(layerGain(ctx, ambOut).params.gain.lastAt(), 'ambience 总层没被推起来').toBeCloseTo(3, 6)
  })

  it('drone 不吃拍网：没有网格也照建（KI-066 那道门只管战斗层，别把它写成全场静音）', () => {
    const { ctx, layer } = rig(null, BED_A)
    open.push(() => layer.dispose())
    expect(ctx.count('osc'), 'drone 被"没网格"那道门一起关掉了').toBeGreaterThanOrEqual(BED_A.layers.length + 1)
  })

  it('有层却没写 `lpHz`/`breath` 的那一行：一句 warn、drone 不起（校验器判死之前，读侧也不能哑着走）', () => {
    // 这一格在 `ambience.json` 里是**非法形状**（`validateAmbience` 把"有层却没写这两格"判 ERROR），
    // 但 `MusicLayer` 认的是 `AmbienceBed` 这个形状而不是那张表——表外递进来的行（调试面板、探针、
    // 下一版新的发射方）也要能被同一只手接住。它那条 warn 只有这里能演到，所以这一条不是装饰：
    // KI-064 的逐包地板（audio = 100%）第一次把它算成裸线，读数是"这句话永远说不出口"。
    const msgs: string[] = []
    const off = bus.on('log', (l) => { if (l.msg.includes('却没写')) msgs.push(l.msg) })
    open.push(off)
    const broken: AmbienceBed = { id: 'bed_broken', layers: [{ hz: 87.31, wave: 'sine', peak: 0.05, detune: 0 }], bell: null }
    const { ctx, layer, ambOut } = rig(GRID, broken)   // 构造时就 applyBed：订阅必须在 rig 之前挂上
    open.push(() => layer.dispose())
    expect(msgs.length, `缺 lpHz 这件事要说，实测 ${msgs.length} 句`).toBe(1)
    expect(msgs[0], '那句话要说清是哪一张床：读侧静默失效就是"这一区没底噪"查不到原因').toContain(broken.id)
    expect(ctx.count('osc'), '缺 lpHz 却把 drone 建了 = 那条 warn 之后还继续往下走').toBe(0)
    // 坏一行不带走整层：ambience 总层那条 3 秒淡入照旧（不然一处配置错 = 全场静音）
    layer.start()
    expect(layerGain(ctx, ambOut).params.gain.lastAt(), 'ambience 总层被这一行一起带走了').toBeCloseTo(3, 6)
  })

  it('`layers: []` 的床（未竟厅 §4「无 drone」）不建底噪，但铃点照掷', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const { ctx, layer, ambOut } = rig(GRID, BED_HALL)
    open.push(() => layer.dispose())
    // ⚠️ 这里不能用 `ctx.count('biquad') === 0` 当证人：战斗层自己的低音低通（`bassLp`）在构造时就建好了，
    // 那只与床无关，读数是恒 1。问的是"这一床有没有建出自己的把手/声部"。
    const inner = layerGain(ctx, ambOut)
    expect(bedGains(ctx, inner).length, '空层表却建了床把手 = 无 drone 那一格被当成了有').toBe(0)
    expect(ctx.count('osc'), '空层表却建了 drone 振荡').toBe(0)
    const fires = chimeBatches(beats(ctx, layer, 30, 0.5), inner)
    expect(fires.length, '没有层的床连铃也不掷了').toBeGreaterThanOrEqual(1)
    expect(fires.every((b) => bellNodes(b, BED_HALL.bell!.scale).length > 0), '空层床的铃点不在它自己的名册上').toBe(true)
  })

  it('dispose 把 drone 停掉并摘掉遭遇订阅（留着的订阅会把后面的用例读到脏状态）', () => {
    const { ctx, layer } = rig(GRID, BED_A)
    layer.start()
    const oscs = ctx.nodes.filter((n) => n.kind === 'osc')
    expect(oscs.length, '这张床一条振荡都没建，"停掉"这条断言就成了空转').toBeGreaterThanOrEqual(BED_A.layers.length + 1)
    layer.dispose()
    for (const o of oscs) expect(o.stoppedAt.length, `${o.id} 没被 stop，会一直响`).toBeGreaterThan(0)
    const n0 = ctx.nodes.length
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    expect(ctx.nodes.length, 'dispose 之后遭遇事件还会动图 = 订阅没摘干净').toBe(n0)
  })

  it('音色石铃跟床走：间隔掷自这张床的 everySec，音高出自这张床的 scale（随机数钉成 0.5）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)   // → 间隔 = rnd(4,6) = 5，音高 = scale[floor(0.5*2)] = 800
    const { ctx, layer, ambOut } = rig(GRID, BED_A)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    // 半秒一格地推，而不是"跳到第 5 秒看一眼"：只跳大格量不出 `nextChime` 是 5 还是 2 ——
    // 间隔这一格就没被钉住（下面那条"三颗连排"是它的第二半：一颗只能证明起点）
    const frames = chimeFrames(beatFrames(ctx, layer, 40, 0.5), inner)   // 40 格 × 0.5s = 20 秒
    // 三颗连排才叫"间隔"：一颗只能证明起点，两颗证明一次间隔，三颗证明这个周期不会自己漂
    expect(frames.length, `20 秒里只掷了 ${frames.length} 颗，量不了间隔`).toBeGreaterThanOrEqual(3)
    const everySecMid = (BED_A.bell!.everySec[0] + BED_A.bell!.everySec[1]) / 2   // 随机钉 0.5 ⇒ 取中值
    expect(frames.slice(0, 3).map((f) => Number(((f.t - frames[0].t) / everySecMid).toFixed(6))),
      `铃点间隔不是这张床的 ${everySecMid}s：实测 ${frames.map((f) => f.t).join('+')}`).toEqual([0, 1, 2])
    // 首一颗要**等满一个间隔**（窗口兑现那一帧之后），而不是建图当刻就叮一声
    expect(frames[0].t, `首颗铃该在 0.5（第一帧，窗口在这里兑现）+ ${everySecMid} 之后`).toBeCloseTo(0.5 + everySecMid, 6)
    // 一口钟 = 6 条非谐泛音起步再加一条 FM 亮边/调制；只响一条正弦不叫铃
    expect(frames.every((f) => f.nodes.filter((n) => n.kind === 'osc').length >= 7),
      `每一敲的泛音层数：${frames.map((f) => f.nodes.filter((n) => n.kind === 'osc').length).join('/')}`).toBe(true)
    // 而且响的都在名册上（不是全表随便挑的音）
    expect(frames.every((f) => bellNodes(f.nodes, BED_A.bell!.scale).length > 0),
      '有铃敲在这张床的名册之外').toBe(true)
    // 力度那一格也归这张床：`playBell` 的 peak 吃 `rnd(cfg.peak)`，钉 0.5 ⇒ 取中值，
    // 而第 0 条泛音的 excite 恰为 1（`synth.ts`：`i === 0 ? 1 : …`），所以首敲最响的那只把手就是它
    const peakMid = (BED_A.bell!.peak[0] + BED_A.bell!.peak[1]) / 2
    const loud = Math.max(...frames[0].nodes.filter((n) => n.kind === 'gain').map((g) => g.params.gain.peakValue()))
    expect(loud, `首敲的峰值没跟着这张床的 bell.peak（中值 ${peakMid}，实测 ${loud}）`).toBeCloseTo(peakMid, 6)
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

describe('跨区 crossfade（KI-077：docs §1.2「跨区 8 小节 crossfade…旋律层最后」）', () => {
  /** 120/4 让那 8 小节落在整数秒上（窗口 = 8×4×0.5 = 16s），量起来不必跟小数点较劲 */
  const G120: MusicGrid = { bpm: 120, beatsPerBar: 4 }
  /** §1.2 的"8 小节"换算成秒：格数与拍长都来自测试自己声明的输入，不是从实现里 import 的 */
  const XF = 8 * G120.beatsPerBar * (60 / G120.bpm)

  it('窗口长度 = 8 小节：旧床斜降到 0 与新床斜升到 1 都落在 `now + 8×拍号×拍长`', () => {
    const { ctx, layer, ambOut } = rig(G120, BED_A)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    const handleA = bedGains(ctx, inner)[0]
    beats(ctx, layer, 8, 0.25)                       // 走到 t = 2.00
    layer.setAmbience(BED_B)
    const handleB = bedGains(ctx, inner)[1]
    expect(handleB, '换床没建新床把手').toBeTruthy()
    const toZero = handleA.params.gain.events.filter((e) => e.kind === 'lin' && e.value === 0)
    expect(toZero.length, `旧床的淡出斜坡应有恰好一条，实测 ${toZero.length}`).toBe(1)
    expect(toZero[0].at, `旧床淡出没跑满 8 小节（${XF}s）`).toBeCloseTo(2 + XF, 6)
    const toOne = handleB.params.gain.events.filter((e) => e.kind === 'lin' && e.value === 1)
    expect(toOne.length, `新床的淡入斜坡应有恰好一条，实测 ${toOne.length}`).toBe(1)
    expect(toOne[0].at, '新床没与旧床同步淡入（crossfade 变成了先后两段）').toBeCloseTo(2 + XF, 6)
  })

  it('「旋律层最后」：窗口走完之前铃点仍是旧名册，走完才换新名册（drone 当场就开始换）', () => {
    // 随机钉 0.5 ⇒ A 的间隔 = rnd(4,6) = 5、B 的 = rnd(8,10) = 9，泛音零失谐，铃点时刻与音高都可预算
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const { ctx, layer, ambOut } = rig(G120, BED_A)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    // 阶段一：走到 t = 12.0（换床之前）。首颗 A 名册的铃在 0.25 + 5 = 5.25，之后 10.25
    const before = chimeBatches(beats(ctx, layer, 48, 0.25), inner)
    expect(before.length, `换床之前只响了 ${before.length} 颗 A 名册的铃，这条量不了"什么时候换名册"`).toBe(2)
    expect(before.every((b) => bellNodes(b, BED_A.bell!.scale).length > 0), '换床之前的铃点不在旧名册上').toBe(true)
    layer.setAmbience(BED_B)                        // bedSwapAt = 12 + 16 = 28
    // 和声层当场就换：新床的 drone 此刻已经在图上了，而旋律还没换
    expect(bedGains(ctx, inner).length, '换床没建新床把手 = 和声层没有当场开始交叉').toBe(2)
    expect(droneFreqs(ctx, bedGains(ctx, inner)[1]).sort((a, b) => a - b), '新床 drone 没当场建出来').toEqual([49, 98])
    const mid = chimeBatches(beats(ctx, layer, 63, 0.25), inner)       // 12.25…27.75（窗口内）
    expect(mid.length, '窗口内一颗铃都没响，"走完才换名册"就成了空转').toBeGreaterThanOrEqual(1)
    expect(mid.every((b) => bellNodes(b, BED_A.bell!.scale).length > 0), '窗口还没走完就换了名册（旋律抢在和声前面）').toBe(true)
    const afterFrames = chimeFrames(beatFrames(ctx, layer, 110, 0.25), inner)  // 28.0…55.5（跨过 bedSwapAt = 28）
    const after = afterFrames.map((f) => f.nodes)
    const onNew = after.filter((b) => bellNodes(b, BED_B.bell!.scale).length > 0)
    const onOld = after.filter((b) => bellNodes(b, BED_A.bell!.scale).length > 0)
    expect(onNew.length, `窗口走完之后再没响过新名册的铃（实测 ${after.length} 敲）`).toBeGreaterThanOrEqual(1)
    expect(onOld.length, `窗口走完之后还在掷旧名册的铃：${onOld.length} 敲`)
      .toBe(0)
    // 反证的另一半：走完之后的每一敲都必须落在**某个**名册上（不许出现表外的音）
    expect(after.every((b) => bellNodes(b, [...BED_A.bell!.scale, ...BED_B.bell!.scale]).length > 0),
      '有铃敲在两张名册之外（名册换了但音没跟着换）').toBe(true)
    /**
     * 「旋律层最后」的**第二半**：换过来的不只是名册，还有"隔多久敲一颗"。窗口兑现那一帧重掷的
     * 下一颗必须按**新床**的 `everySec` 隔（这里 0.5 ⇒ 9s），而不是沿用旧床的 5s，也不是硬编码一个数。
     *
     * 这一格是变异探针 A7 量出来的洞：把兑现处写成 `nextChime = now + 5` 时，上面四条断言一条都不红
     * ——旧床的间隔恰好也是 5，所以只点名册不点节奏等于什么都没量。因此这里故意让两张床的间隔不同
     * （A `[4,6]` ⇒ 5，B `[8,10]` ⇒ 9），并要求跨度够数出**三个**铃点（两颗只能证一次间隔）。
     */
    const gapB = (BED_B.bell!.everySec[0] + BED_B.bell!.everySec[1]) / 2
    expect(afterFrames.length, `窗口之后只掷了 ${afterFrames.length} 颗，量不了新床的间隔（要 ≥3 颗）`)
      .toBeGreaterThanOrEqual(3)
    expect(afterFrames.slice(0, 3).map((f) => Number(((f.t - afterFrames[0].t) / gapB).toFixed(6))),
      `窗口兑现之后的铃点间隔不是新床的 ${gapB}s（旧床是 ${(BED_A.bell!.everySec[0] + BED_A.bell!.everySec[1]) / 2}s）：实测 ${afterFrames.map((f) => f.t).join('+')}`)
      .toEqual([0, 1, 2])
    // 首一颗要等满**新床**的一个间隔，而不是旧床剩下的那点倒计时（兑现帧 = 换床那刻 12 + 窗口 16 ⇒ 28，再 +9）
    expect(afterFrames[0].t, `窗口兑现那一帧之后第一颗该等满新床的 ${gapB}s`).toBeCloseTo(48 * 0.25 + XF + gapB, 6)
  })

  it('窗口走完才回收旧床：到点之前一条都不许提前拆，到点之后每条都 stop + 摘线（KI-071 那本账）', () => {
    const { ctx, layer, ambOut } = rig(G120, BED_A)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    const handleA = bedGains(ctx, inner)[0]
    const oldSet = droneNodes(ctx, handleA)
    // 4 条声部 + 1 条呼吸 LFO：回收要连调制源一起收
    expect(oldSet.filter((n) => n.kind === 'osc').length, '旧床的 drone 条数不对，这条回收量不出账')
      .toBe(BED_A.layers.length + 1)
    beats(ctx, layer, 8, 0.25)                        // t = 2.00
    layer.setAmbience(BED_B)
    // 新床的把手要**当场**抓住：窗口走完时 `teardown()` 会把旧把手摘线，之后再问 `bedGains` 就只剩一只，
    // 那一声"undefined 没有 gain"红的是取证时机，不是回收规则（第一版就踩了这个）。
    const handleB = bedGains(ctx, inner)[1]
    expect(handleB, '换床没建新床把手').toBeTruthy()
    beats(ctx, layer, 28, 0.25)                       // t = 2.25 … 9.00：窗口正中间
    for (const n of oldSet) expect(n.disconnected, `${n.id} 在窗口中途就被摘线 = 淡出会被听得见地掐断`).toBe(0)
    for (const o of oldSet.filter((n) => n.kind === 'osc')) expect(o.stoppedAt.length, `${o.id} 窗口中途被 stop`).toBe(0)
    beats(ctx, layer, 40, 0.25)                       // t = 19.00 > bedSwapAt = 18.00
    for (const o of oldSet.filter((n) => n.kind === 'osc')) {
      expect(o.stoppedAt.length, `${o.id} 过了窗口还没 stop = 每跨一次区漏一组振荡器`).toBeGreaterThan(0)
      expect(o.disconnected, `${o.id} 过了窗口还连着线`).toBeGreaterThan(0)
    }
    // 新床一条都不能被误拆
    for (const n of droneNodes(ctx, handleB)) expect(n.disconnected, `${n.id} 被当作旧床拆掉了`).toBe(0)
  })

  it('同一张床重发不动图：一次节点都不建、把手上的自动化一条都不加', () => {
    const { ctx, layer, ambOut } = rig(G120, BED_A)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    beats(ctx, layer, 8, 0.25)                        // t = 2.00
    const handleA = bedGains(ctx, inner)[0]
    const events = [...handleA.params.gain.events]
    const n0 = ctx.nodes.length
    layer.setAmbience(BED_A)
    layer.setAmbience(BED_A)
    expect(ctx.nodes.length, '同一张床重发又建了一遍 drone = 每次区域 tick 都在叠一层底噪').toBe(n0)
    expect(handleA.params.gain.events, '同一张床重发把淡出斜坡叠了上去').toEqual(events)
    expect(bedGains(ctx, inner).length, '同一张床重发多出一只把手').toBe(1)
    // 拆掉这个"按身份比"的门就该红：换一张床必须动图（这条与上面一组构成两端）
    layer.setAmbience(BED_B)
    expect(ctx.nodes.length > n0, '换一张**不同**的床却什么都没建 = 上面那条恒真是假绿').toBe(true)
  })

  it('`bell: null` 的床（无耳深窖）：窗口走完就安静，drone 照建', () => {
    // 随机钉 0.5 ⇒ A 的间隔恰为 5s：首窗口兑现那帧（t=0.25）起算，铃点落在 5.25/10.25/15.25，下一颗要到 20.25
    // —— 于是"窗口走完（t=18）之后又响"只可能是"深窖的 null 没生效"。不钉的话随机间隔能把一颗挤进
    // 17.5~18.0 那两格里，那条"安静"就成了读数噪声（第一版就是这样 1 敲的假红）。
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const { ctx, layer, ambOut } = rig(G120, BED_A)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    beats(ctx, layer, 8, 0.25)                        // t = 2.00，A 名册已响过 5.25/10.25…
    layer.setAmbience(BED_CRYPT)
    const handleB = bedGains(ctx, inner)[1]         // 同上一条：窗口走完旧把手会先下线，取证要趁早
    expect(handleB, 'bell:null 却把 drone 也一起不建了（那是两件事）').toBeTruthy()
    const before = chimeBatches(beats(ctx, layer, 60, 0.25), inner)   // 2.25…17.00（窗口内仍走 A）
    expect(before.length, '窗口内一颗旧名册的铃都没响，"走完就安静"就成了空转').toBeGreaterThanOrEqual(1)
    const after = chimeBatches(beats(ctx, layer, 80, 0.25), inner)    // 17.25…37.25（跨过 18）
    expect(after.length, `深窖的 bell: null 没让它安静（窗口后又响 ${after.length} 敲）`).toBe(0)
    expect(droneFreqs(ctx, handleB), '深窖那条 40Hz 次声底噪不见了').toEqual([40])
  })

  it('没有网格时窗口按 1s 兜底，并且**只说一次**（口径实名，不猜一份 BPM）', () => {
    const msgs: string[] = []
    open.push(bus.on('log', (l) => { if (l.msg.includes('换声床')) msgs.push(l.msg) }))
    const { layer: gridLayer } = rig(G120, BED_A)
    open.push(() => gridLayer.dispose())
    gridLayer.setAmbience(BED_B)                    // 有网格：窗口按 8 小节算，一句都不该说
    expect(msgs.length, '有网格时不该兜底，更不该吱声').toBe(0)
    // 真的没有网格：新起一层
    const { ctx: ctx2, layer: layer2, ambOut: ambOut2 } = rig(null, BED_A)
    open.push(() => layer2.dispose())
    const inner2 = layerGain(ctx2, ambOut2)
    const hA = bedGains(ctx2, inner2)[0]
    ctx2.advance(2)
    layer2.setAmbience(BED_B)
    const toZero = hA.params.gain.events.filter((e) => e.kind === 'lin' && e.value === 0)
    expect(toZero.length, '没网格时旧床也要有那条淡出斜坡').toBe(1)
    expect(toZero[0].at, '没网格时那 8 小节应落进 1s 兜底').toBeCloseTo(3, 6)
    expect(msgs.length, `没网格要说，但只说一次（实测 ${msgs.length} 句）`).toBe(1)
    layer2.setAmbience(BED_CRYPT)
    expect(msgs.length, '每次都喊 = 把兜底当成了常态噪声').toBe(1)
    expect(ctx2.currentTime, '换床那一刻时间轴没走到 2 ⇒ 上面那条 ≈3 就不是"1s 兜底"的证据，只是两次随机位置').toBe(2)
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
    const { ctx, layer } = rig(null, BED_A)   // 给一张床：这条要同时证明"没网格也照样有底噪"
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
    const { ctx, layer } = rig(GRID, BED_A)   // 给一张床：这条数的是**所有** log，没床那句不该混进来（同下面的 `world()`）
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
    /**
     * 给一张床是有意的：`start()` 现在会在没有床时说那句「没有收到任何环境声床」（KI-077），
     * 而这一条量的是**调度**那两句话的数目。生产里 `AudioEngine` 总会喂进一张真床，那句因此不该出现；
     * 让测试世界与生产世界在"有没有床"这一格上形状一致，日志计数才只属于被量的那一件事。
     */
    const world = (step: number, hitchAt = -1): { count: number; logs: number } => {
      const ctx = new FakeAudioContext()
      const musicOut = ctx.createGain()
      const ambOut = ctx.createGain()
      const layer = new MusicLayer(ctx as unknown as AudioContext, musicOut as unknown as AudioNode, ambOut as unknown as AudioNode, GRID, BED_A)
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
