import { afterEach, describe, expect, it, vi } from 'vitest'
import { bus } from '@/core/EventBus'
import { MusicLayer, MOTIF_R1, battleOstinatoHz, motifDegrees } from '@/audio/music'
import type { MusicGrid } from '@/core/RhythmClock'
import type { AmbienceBed, BattleScore, ExploreScore } from '@/data/schema'
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

/* ------------------------------------------------------------------ */
/* KI-079：合成探索曲。形状 = `schema.ts > ExploreScore`，值同样是这里编的      */
/* ------------------------------------------------------------------ */

/**
 * 与上面那批床同一条纪律：**不抄 `explore.json`**，因为这一层要验的是"跟着喂进来的那一行走"，
 * 拿真表验等于让实现自证。`rootHz` 一律挑在名册之外的数（下面三种变形的音高全部落在 69.59…1140.9，
 * 与合成床的 drone（87.31/49/43.65/130.81/40）、驼鼓 150、军鼓 200、`OSTINATO` 那八个数、
 * 以及两张床的铃点名册（700/800、1100/1200）都不重合，所以"图里出现 147.46"只可能是旋律。
 */
const SONG_PRIME: ExploreScore = { id: 'song_prime', form: 'prime', rootHz: 31, beatsPerNote: 1, wave: 'triangle', peak: 0.02 }
const SONG_INVERSION: ExploreScore = { id: 'song_inversion', form: 'inversion', rootHz: 31, beatsPerNote: 1, wave: 'triangle', peak: 0.02 }
const SONG_RETROGRADE: ExploreScore = { id: 'song_retrograde', form: 'retrograde', rootHz: 31, beatsPerNote: 1, wave: 'triangle', peak: 0.02 }
/** 未竟厅那一区（§1.2「C→无调」）：有 id 却没音高参数，读侧要能接住这一格 */
const SONG_ATONAL: ExploreScore = { id: 'song_atonal', form: null }
/** 换区那一行的新曲：主音与顺行那三行差得远（640…1140.35），所以"图上出现 1140.35"只可能是新行开口 */
const SONG_FELL: ExploreScore = { id: 'song_fell', form: 'retrograde', rootHz: 160, beatsPerNote: 1, wave: 'sine', peak: 0.015 }
/** 窗口里第二次换曲（后一张说话那条用例）：又一个不撞任何名册的主音 */
const SONG_LATEST: ExploreScore = { id: 'song_latest', form: 'inversion', rootHz: 210, beatsPerNote: 1, wave: 'sine', peak: 0.015 }

/**
 * 探索曲用例的拍网：**75/4 而不是休垒真值那 84/4**，是有意选的测量条件。
 * 75 ⇒ 一拍 = 0.8 秒，于是 `beatsPerNote` 的三档（0.5/1/2）都是帧步（0.05s）的整数倍，
 * 音距读数不掺帧粒度误差。网格是**注入**的输入（KI-066 之后这一层没有自己的 BPM），
 * 这几条量的是"间隔跟着 `beatsPerNote` 走"，与某个区的表值是不是 75 无关；
 * 84 那份留给上面那批拍距用例，它们钉的正是"跟着注入的那张网格走"。
 */
const SONG_GRID: MusicGrid = { bpm: 75, beatsPerBar: 4 }
const SONG_BEAT = 60 / SONG_GRID.bpm

/* ------------------------------------------------------------------ */
/* KI-080：合成战斗档。形状 = `schema.ts > BattleScore`，值同样是这里编的       */
/* ------------------------------------------------------------------ */

/**
 * `pattern` 那一个格子写的是「动机第几音 × 第几档八度」折成的整数（解码住在 `music.ts > battleOstinatoHz`，
 * 步长 = `MOTIF_R1.length` = 4）。下面这八个展开**是本批用那条算式量出来的**，用例认的就是这些 Hz：
 *  · 0 → C2 65.410 · 1 → Eb2 77.786 · 2 → G2 98.004 · 3 → Bb2 116.547
 *  · 4 → C3 130.820（**别拿它当换行的记号**：它的反拍短音 261.640 与钟 accent 的基频是同一个数）
 *  · 5 → Eb3 155.572 · 6 → G3 196.009 · 7 → Bb3 233.095
 *
 * ⚠️ 八度档 0 的那四个音**反拍都要抬一个八度**，所以 130.82 / 155.572 / 196.009 / 233.095 这些数在默认行里
 * 本来就以"反拍短音"的身份存在。因此"换了一行"的读数不能只问"图上有没有 196.009"（默认行第 3 拍的反拍就是它），
 * 要问一个**只有新行才做得出的数**——cell 6 当本音时反拍 = 196.009×2 = **392.017**，默认行八格里没有它。
 */
const BATTLE_LINE: BattleScore = { id: 'battle_line', pattern: [0, 0, 2, 5, 3, 0, 1, 2], bellEveryBars: 2 }
/**
 * 十二平均律：战斗主音 C2 = 65.41Hz 之上 `n` 个半音。**抄在测试这一侧而不是调 `battleOstinatoHz`** ——
 * 与被测函数共用一条算式就等于让实现自证（与那条"八个音抄在这里而不是 import"的理由同一句）。
 * `battleOstinatoHz` 自己另有两条用例钉着（八度关系、步长跟着动机音数走）。
 */
const ET = (semi: number): number => 65.41 * 2 ** (semi / 12)
/** 手抄的那份 `R-1` 度数；有一条用例把它与主人 `motifDegrees('prime')` 逐格对账（KI-074 的纪律） */
const R1_SEMI = [0, 3, 7, 10]
/** 一个格子展开成半音数：低位是"动机第几音"，高位是"第几档八度" */
const cellSemi = (cell: number): number => R1_SEMI[cell % R1_SEMI.length] + 12 * Math.floor(cell / R1_SEMI.length)
const cellHz = (cell: number): number => ET(cellSemi(cell))
/**
 * 换行要看得见的那一行：整条线只有 cell 6（G3），于是每一拍的反拍都是 **392.0** —— 默认行做不出这个数；
 * 钟的周期也换成 4 小节，于是第 8 拍那记 accent（默认行的）消失了、改在第 16 拍。两维都不同（KI-077 的夹具纪律）。
 */
const BATTLE_WIDE: BattleScore = { id: 'battle_wide', pattern: [6], bellEveryBars: 4 }
/** §6.3 万籁那一档：数据说的安静。它与"这条腿没接"（`null`）必须分得开 —— 一个不吱声，一个要吱声 */
const BATTLE_SILENT: BattleScore = { id: 'battle_silent', noMusic: true }

/**
 * 战斗层的默认夹具行 = KI-080 之前写死在 `music.ts > OSTINATO` 的那八个数（65.41/65.41/98/155.56/
 * 116.54/65.41/77.78/98）换成格子记法**重写一遍**，钟的周期也照旧（2 小节）。
 * 所以那批"拍距 / 鼓型 / 低音轮换 / 钟 accent"的老用例读数一位都不该动 —— 它们从"钉住代码里那八个数"
 * 变成"钉住喂进来的这一行被照着奏出来"。它与真表 `mus_shared_battle` 的逐格相同由
 * `tests/unit/battle-table.test.ts` 那条迁移对账用例钉着（这里是合成行，不 import 真表）。
 */

function rig(
  grid: MusicGrid | null = GRID,
  bed: AmbienceBed | null = null,
  /** KI-079：开局那一区的探索曲。给 `null` 就是"这条腿没接"的形状，与真引擎在收到事件之前的状态一致 */
  song: ExploreScore | null = null,
  /**
   * KI-080：开局那一区的战斗档。默认给 `BATTLE_LINE`（就是 KI-080 之前代码里那份 `OSTINATO`，
   * 换成数据那套记法重写一遍），所以那批"拍距/鼓型/低音轮换/钟 accent"的用例读数一位都不该动——
   * **它们现在是这位默认值的证人**：这份合成行与真表 `mus_shared_battle` 逐格解码相同，那条对账用例在下面。
   */
  battle: BattleScore | null = BATTLE_LINE
): { ctx: FakeAudioContext; layer: MusicLayer; musicOut: FakeNode; ambOut: FakeNode } {
  const ctx = new FakeAudioContext()
  const musicOut = ctx.createGain()
  const ambOut = ctx.createGain()
  const layer = new MusicLayer(
    ctx as unknown as AudioContext,
    musicOut as unknown as AudioNode,
    ambOut as unknown as AudioNode,
    grid,
    bed,
    song,
    battle
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

/**
 * KI-079：从批次里认出"这就是探索曲的一个音"。认法 = **挂在 ambience 总层上、且整批只有一条振荡**。
 *
 * 这条判据为什么够用：旋律音走 `playSweep`（一条振荡 + 一只包络把手），而同一层上唯一的另一种声音是石铃——
 * 一敲至少 8 条振荡（6 条非谐泛音 + FM 载波与调制），永远不会被读成"一个音"。换床时旧床那组 drone 也接在
 * 总层上，但它们是**构造那一瞬**建的，不会落进任何一帧的"新建批次"里。
 *
 * 每个音取四样：`t` = 决定要排它的那一帧（与铃点同一口径，不掺前瞻的 0.02），`hz`/`wave`/`peak` = 表里那三格
 * 是否真的落到了图上，`start`/`span` = 这个音被排的时刻与它自己响了多长。
 */
interface MelodyNote { t: number; hz: number; wave: string; peak: number; start: number; span: number }
function melodyNotes(frames: Array<{ t: number; nodes: FakeNode[] }>, inner: FakeNode): MelodyNote[] {
  return frames
    .filter((f) => f.nodes.filter((n) => n.kind === 'osc').length === 1 && reaches(f.nodes, inner))
    .map((f) => {
      const osc = f.nodes.find((n) => n.kind === 'osc')!
      const env = f.nodes.find((n) => n.kind === 'gain')!
      return {
        t: f.t,
        hz: startedFreqs([osc])[0],
        wave: osc.type,
        peak: env.params.gain.peakValue(),
        start: osc.startedAt[0],
        span: osc.stoppedAt.length ? osc.stoppedAt[0] - osc.startedAt[0] : -1,
      }
    })
}

/** 推时间并直接读出旋律音（上面那两条 helper 的组合，KI-079 那批用例每帧都在用） */
function songOf(ctx: FakeAudioContext, layer: MusicLayer, inner: FakeNode, count: number, step = 0.05): MelodyNote[] {
  return melodyNotes(beatFrames(ctx, layer, count, step), inner)
}

/**
 * 「逐音读数」那批用例的版本：先证明这一段窗口里**一记铃都没有**，再把音交给 `melodyNotes`。
 *
 * 为什么需要这道栅栏（不是美化）：`melodyNotes` 认一个音靠的是"这一批节点只有一条振荡"，而一记石铃
 * 是同一帧里 ≥7 条振荡——铃与某个旋律音撞上同一帧，那个音就从读数里**消失**，表现是音距凭空翻倍、
 * 序列少一格。KI-079 第一版就在 A 床上红过一次（「0.5 拍/音的理想音距 0.400s，实测 0.900s」——少认一个音
 * 的双倍间距 0.800s 再加帧格与调度前瞻的零头）。红在栅栏这一句里说的是"测量床不合格"，红在下面那些断言里会被读成
 * "生产少排了一个音"——两者必须分得开，否则修好床的人不知道该改哪一边。机制本身不靠"我记得红过一次"，
 * 那次随机红的概率我也没量到（只把 `beatsPerNote` 那一条换回带铃 A 床、去掉栅栏连跑 8 遍，0 红）：钉住它的是
 * 下面那条「把铃钉成每帧一颗」的对照。
 */
function songOfQuiet(ctx: FakeAudioContext, layer: MusicLayer, inner: FakeNode, count: number, step = 0.05): MelodyNote[] {
  const frames = beatFrames(ctx, layer, count, step)
  const bells = chimeFrames(frames, inner).length
  expect(bells, `这一段窗口里出现 ${bells} 记石铃 ⇒ "一批只有一条振荡"那个认法会把同帧的旋律音吞掉：`
    + '逐音读数的床要 `bell: null`（理由见 KI-079 那个 describe 顶部，与 `melodyNotes` 上面那段）').toBe(0)
  return melodyNotes(frames, inner)
}

/**
 * 间隔读数的上界为什么是「理想音距 + 一帧」而不是精确值：生产排的是 `Math.max(nextNote, now + 0.02)`
 * （前瞻，防调度落在过去），于是每个音都被抬到"决定那一帧 + 0.02"，落在帧网格上就比理想值多出不到一帧。
 * 下界仍是理想值——这一条才是判据：**音符不许比表说的更密**。
 * 容差不从生产的 0.02 抄（那是 `synth`/调度的裕量，不是这里的被测量），从测试自己声明的 `step` 推。
 */
const inBand = (gap: number, ideal: number, step: number): boolean => gap >= ideal - 1e-9 && gap <= ideal + step + 1e-9

/**
 * "这个音高属于那一名册"的认法。容差 0.6Hz：合成行之间**最窄**的两个音也差 5Hz 以上
 * （旧行 124…220.94 / 新行 640…1140.35 / 第三行 471.43…840），而生产算的是同一个浮点式子，
 * 所以 0.6 既不会把邻行认进来，也不会因为取整自己红。
 */
const inSet = (hz: number, set: number[]): boolean => set.some((x) => Math.abs(hz - x) <= 0.6)


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
    // 那一行八个格展开之后的那八个音（65.41 C2 … 98.00 G2）—— 用测试自己那套 `cellHz` 算，
    // 而不是 import 被测的解码：抄在这里是因为 import 进来就等于让实现自证。
    const OST = [0, 0, 2, 5, 3, 0, 1, 2].map(cellHz)
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
      const layer = new MusicLayer(ctx as unknown as AudioContext, musicOut as unknown as AudioNode, ambOut as unknown as AudioNode, GRID, BED_A, null, BATTLE_LINE)
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
    // 期望值按**派生**的数写（`cellHz`），不是 KI-080 之前那张手抄表里的四位数：那串是把 116.5416…
    // 四舍五入到两位的抄本，与 `65.41 × 2^(10/12)` 差 0.0074Hz ≈ 0.11 音分。差的不是音，是抄表的精度。
    expect(root(12), `第 12 拍（4/4 的小节头、行里第 4 格 = cell 3 → Bb）的低音不是 ${cellHz(3).toFixed(3)}`).toBeCloseTo(cellHz(3), 6)
    expect(root(11), `第 11 拍（行里第 3 格 = cell 5 → Eb 抬一个八度）的低音不是 ${cellHz(5).toFixed(3)}`).toBeCloseTo(cellHz(5), 6)
    expect(root(13), `第 13 拍（行里第 5 格 = cell 0 → 主音）的低音不是 65.41`).toBeCloseTo(65.41, 6)
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

/**
 * KI-079：探索曲（docs §1.2「世界音乐层」那一半 + 音乐宪法「一切旋律只许派生自 R-1 及其四种变形」）。
 *
 * 这一层此前**根本没有世界音乐层**：`regions.json > music.explore` 那 7 个 id 指向一张不存在的表，
 * 校验器只看它"是不是字符串"所以永远不红。现在表有了（`explore.json`）、读者有了（下面这些用例），
 * 那句宪法第一次成为可校验的东西——所以这几条量的不是"有没有声音"，而是**音高到底是从哪儿来的**：
 *  ① 度数：只许 `MOTIF_R1` 那四个数（0/3/7/10 半音）与它的倒影/逆行，写不出第六个音；
 *  ② 节奏：`beatsPerNote` 三档（0.5/1/2）= §1.2 的"压缩/原形/扩张"，同时管音距与音长；
 *  ③ 音色：`wave`/`peak` 两格进了图，不是读侧写死；
 *  ④ 转场：`form: null` 那一区不唱旋律而铃点照掷，以及「旋律层最后」那一半句（与 KI-077 的铃点腿同一个窗口）。
 *
 * ⚠️ 与合成床同一条纪律：这里的行是**编的**，不抄 `explore.json`。拿真表验"跟着行走"等于让实现自证。
 * `id→行` 那一条腿（真表能不能走到图上）在 `audio-engine.test.ts`，与本文件的分工同 KI-077。
 *
 * ⚠️ **逐音读数的这几条用 `BED_CRYPT`（`bell: null`）并走 `songOfQuiet` 那道栅栏，这是测量条件不是省事**：
 * 旋律音的认法是"这一批节点里只有一条振荡"（见 `melodyNotes`），而一记石铃也是 `playSweep` 起的一条条振荡——
 * 铃与某个音落进同一帧，那个音就从读数里**消失**，音距当场翻倍。KI-079 第一版带着 A 床跑这些条时红过
 * 一次（同一份树连跑两遍可以一遍绿一遍红，红话正是「0.5 拍/音的理想音距 0.400s，实测 0.900s」；
 * 0.900 ≈ 少认一个音后的双倍间距 0.800 再加帧格与调度前瞻的零头，判据的上沿 0.450 与它不是一个数，别把这条读成"整倍")。
 * **这句成因不是靠那次随机红撑住的**：把 `beatsPerNote` 那一条单独换回带铃的 A 床、去掉栅栏连跑 8 遍是 0 红
 * （6 秒窗口里每 4–6 秒掷一记铃，撞上一帧旋律音的机会本来就薄），所以"带铃的床必然吞音"这句话我没量到，不许照着写。
 * 真正钉住机制的是下面
 * 「把铃钉成每帧一颗」那条对照：它让 `melodyNotes` 只剩首音，而图上一条音不少，
 * 所以该改的是测量床，不是 `music.ts`。铃与旋律共存由 `form: null` 与"没收到拍网"那两条量，
 * 它们吃的是**铃那一侧**的认法（一敲 ≥6 条振荡，容得下多出来的那一条），所以那两条仍用带铃的 A 床。
 */
describe('探索曲（KI-079）：R-1 的三种形态、每音占几拍、以及"旋律层最后"', () => {
  /**
   * R-1 = C–Eb–G–Bb ⇒ 度数 0/3/7/10。顺行那一串是把 31Hz 抬两个八度（×4 = 124）后逐度数推半音：
   * 124、+3 = 147.46、+7 = 185.79、+10 = 220.94。**这四个数是手算的**，不从 `music.ts` import——
   * import 过来比就只能证明"代码等于代码"，而这一条要证的是"代码等于 docs §1.2 那四个音"。
   */
  const PRIME = [124, 147.46, 185.79, 220.94]
  const INVERSION = [124, 104.27, 82.76, 69.59]
  const RETROGRADE = [220.94, 185.79, 147.46, 124]
  const FELL = [1140.35, 958.92, 761.09, 640]
  const LATEST = [840, 706.35, 560.63, 471.43]

  it('顺行（prime）：四个度数按表推开，念完回到第一个音（动机是循环，不是一次性的四音）', () => {
    const { ctx, layer, ambOut } = rig(SONG_GRID, BED_CRYPT, SONG_PRIME)
    open.push(() => layer.dispose())
    const notes = songOfQuiet(ctx, layer, layerGain(ctx, ambOut), 130, 0.05)   // 6.5 秒 ÷ 每音 0.8 秒 ⇒ 8 个音
    expect(notes.length, `只排了 ${notes.length} 个音，量不了"念完回到第一个音"（要 ≥8）`).toBeGreaterThanOrEqual(8)
    expect(notes.slice(0, 8).map((n) => +n.hz.toFixed(2)), '旋律不是 R-1 那四个数、或者没循环回去')
      .toEqual([...PRIME, ...PRIME])
  })

  it('倒影（inversion）：同一个起点向下走，四个度数取负——与顺行只差一个符号', () => {
    const { ctx, layer, ambOut } = rig(SONG_GRID, BED_CRYPT, SONG_INVERSION)
    open.push(() => layer.dispose())
    const notes = songOfQuiet(ctx, layer, layerGain(ctx, ambOut), 60, 0.05)
    expect(notes.length, `只排了 ${notes.length} 个音`).toBeGreaterThanOrEqual(4)
    expect(notes.slice(0, 4).map((n) => +n.hz.toFixed(2)), '倒影不是"向下念的那一串"')
      .toEqual(INVERSION)
    // 与顺行共用第一个音（= 主音），这是"派生"而不是"另起一首"的形状
    expect(notes[0].hz, '倒影的起点不等于本区主音 ⇒ 那不是倒影，是另一张表').toBeCloseTo(PRIME[0], 2)
  })

  it('逆行（retrograde）：同一批音高倒着念，第一个音是顺行的最后一个', () => {
    const { ctx, layer, ambOut } = rig(SONG_GRID, BED_CRYPT, SONG_RETROGRADE)
    open.push(() => layer.dispose())
    const notes = songOfQuiet(ctx, layer, layerGain(ctx, ambOut), 60, 0.05)
    expect(notes.length, `只排了 ${notes.length} 个音`).toBeGreaterThanOrEqual(4)
    expect(notes.slice(0, 4).map((n) => +n.hz.toFixed(2)), '逆行不是顺行的倒序')
      .toEqual(RETROGRADE)
    // 三种形态吃的必须是**同一批**音高（只是顺序与方向不同）：名册整体对账
    expect([...notes.slice(0, 4).map((n) => +n.hz.toFixed(2))].sort((a, b) => a - b), '逆行用的是另一批音高（不是 R-1 的变形）')
      .toEqual([...PRIME].sort((a, b) => a - b))
  })

  it('`beatsPerNote` 三档（0.5/1/2）：音距按拍走，音长也按拍走（§1.2 的"扩张/压缩"）', () => {
    const run = (bn: number): { gap: number; span: number } => {
      const { ctx, layer, ambOut } = rig(SONG_GRID, BED_CRYPT, { ...SONG_PRIME, beatsPerNote: bn })
      open.push(() => layer.dispose())
      const notes = songOfQuiet(ctx, layer, layerGain(ctx, ambOut), 120, 0.05)   // 6 秒
      expect(notes.length, `每音 ${bn} 拍时只排了 ${notes.length} 个音，量不了音距`).toBeGreaterThanOrEqual(3)
      const gaps = notes.slice(1).map((n, i) => n.t - notes[i].t)
      for (const g of gaps) {
        expect(inBand(g, bn * SONG_BEAT, 0.05),
          `${bn} 拍/音的理想音距 ${(bn * SONG_BEAT).toFixed(3)}s，实测 ${g.toFixed(3)}s（判据 = [理想, 理想+一帧]，多出的那点来自调度前瞻 + 帧网格，见 inBand 上面那段`)
          .toBe(true)
      }
      expect(new Set(gaps.map((g) => +g.toFixed(4))).size, `同一张曲里音距不稳：${gaps.map((g) => g.toFixed(3)).join('/')}`).toBe(1)
      return { gap: gaps[0], span: notes[1].span }
    }
    const half = run(0.5)
    const one = run(1)
    const two = run(2)
    // 音长（`playSweep` 的 dur）也必须跟 `beatsPerNote`：读侧写死一个 dur 时上面三条断言一条都不红
    // 比值取 1.8~2.2 而不是等号：`span` 里掺着合成侧的 attack 与尾音裕量，那两个数属于 `synth.ts`，不在这里抄。
    const doubles = (a: number, b: number): boolean => b > a * 1.8 && b < a * 2.2
    expect(doubles(half.span, one.span), `音长没随拍数翻倍：${half.span}→${one.span}`)
      .toBe(true)
    expect(doubles(one.span, two.span), `音长没随拍数翻倍：${one.span}→${two.span}`)
      .toBe(true)
    expect(doubles(half.gap, one.gap), `音距没随拍数翻倍：${half.gap}→${one.gap}`).toBe(true)
    expect(doubles(one.gap, two.gap), `音距没随拍数翻倍：${one.gap}→${two.gap}`).toBe(true)
  })

  /**
   * KI-079 的**反向对照**：上面那些条为什么不许带铃的床，这一条让它响一次给大家看。
   *
   * 把铃的间隔钉成 0.05 秒 = 帧步，于是**除第一帧外每一帧**都有一颗铃，而第一帧之后的每一个旋律音都必然
   * 与一颗铃同帧（第一帧没铃的机制在下面 ① 之前那段：床的窗口恰好在那一帧兑现，`nextChime` 被当场推后一格）。
   * 判据的形状是"两个读者读同一件事"：
   *  ① **逐帧收下所有新建节点**再数名册音——频率落在 `PRIME` 那四个数上的振荡，一条 `playSweep` 就是一条，
   *    这是"生产排了多少音"；
   *  ② **按帧认**——`melodyNotes` 那句"这一批只有一条振荡"，这是"我的读数看见了多少"。
   * ① 站得住而 ② 塌成一个 ⇒ 吞音的是认法，不是调度。所以修的是测量床（`BED_CRYPT` + `songOfQuiet`），
   * 不是 `music.ts`——这一条也就是那条改动唯一的、不靠"我记得红过一次"的凭据。
   * 实测读数（跑出来的，不是推算的）：120 帧里 119 帧有铃、唯一没铃的是第一帧；图上有 8 条名册音，
   * 而 `melodyNotes` 只认回 1 个（首音）。
   */
  it('把铃钉成每帧一颗 ⇒ 图上一条音不少、读数只剩首音（吞音的是认法，不是调度）', () => {
    /** 与 A 床同一组 drone，只把铃的间隔钉死成一帧：`rnd(a, a)` 与 `Math.random` 无关，不需要伪造随机数 */
    const bell = BED_A.bell
    if (!bell) throw new Error('A 床本来就该带铃，这条对照没有主体')
    const BED_EVERY_FRAME: AmbienceBed = { ...BED_A, id: 'bed_bell_every_frame', bell: { ...bell, everySec: [0.05, 0.05] } }
    const { ctx, layer, ambOut } = rig(SONG_GRID, BED_EVERY_FRAME, SONG_PRIME)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    const frames = beatFrames(ctx, layer, 120, 0.05)   // 6 秒：一拍/音 = 0.8s 一个 ⇒ 七个音上下
    // 主体先到场：铃除了**第一帧**之外每一帧都在响。第一帧没铃的机制是量过的（不是猜）：`applyBed(bed, 0)`
    // 把窗口排在 0，而第一帧的 `now` 已经是 0.05，于是那一帧先走进兑现分支、把 `nextChime` 重掷成
    // `now + 0.05 = 0.1`（`music.ts:417`），同一帧末尾那道 `now >= nextChime` 就不成立了。
    // 偏偏就是这一帧让下面 ② 认出首音，所以"没铃的只有第一帧"不是容差，而是这条对照的形状本身。
    const bellFree = frames.filter((f) => chimeBatches([f.nodes], inner).length === 0)
    expect(bellFree.map((f) => f.t), `没铃的帧是 [${bellFree.map((f) => f.t).join(',')}]（共 ${frames.length} 帧）——不是"只有第一帧"，铃就没盖满窗口，这一条什么都没对照`)
      .toEqual([frames[0].t])
    // ① 逐帧收下所有新建节点再数名册音：一次 `playSweep` 一条振荡，与"这一批有几条"的切分无关。
    //    （不能问 `ctx.nodes` 的总账——KI-071 之后排完就停的节点会被回收，末尾清点天然少一截。）
    const scheduled = frames.flatMap((f) => f.nodes).filter((n) => n.kind === 'osc' && inSet(startedFreqs([n])[0], PRIME)).length
    expect(scheduled, '六秒里图上一条旋律音都没排 = 这一条量的不是"认法吞音"').toBeGreaterThanOrEqual(6)
    // ② 按帧认：只剩第一个音（那一帧还没有铃），其余全被同帧的铃盖掉
    const recognized = melodyNotes(frames, inner)
    expect(recognized.length, `带铃的窗口里认法只该剩首音，实测认到 ${recognized.length} 个 ⇒ 铃与音没有同帧，对照不成立`).toBe(1)
    expect(+recognized[0].hz.toFixed(2), '认到的那一个不是首音 = 第一帧也有铃，对照的形状与上面那段说不上')
      .toBe(PRIME[0])
    expect(scheduled - recognized.length, `排了 ${scheduled} 条、认到 ${recognized.length} 个，差不足 5 ⇒ 吞得不够多，这条读不出名堂`).toBeGreaterThanOrEqual(5)
    // 栅栏用的就是"这一窗有几记铃"这一个数：它先红，红话说的是"床不合格"而不是"生产少排音"
    expect(chimeFrames(frames, inner).length > 0, '`songOfQuiet` 那道栅栏读的数在这里，栅栏没道理不响').toBe(true)
  })

  it('`wave` 与 `peak` 两格进了图，不是读侧写死一个音色（0.0137 这种非整数才叫读数）', () => {
    const song: ExploreScore = { id: 'song_sq', form: 'prime', rootHz: 31, beatsPerNote: 1, wave: 'square', peak: 0.0137 }
    const { ctx, layer, ambOut } = rig(SONG_GRID, BED_CRYPT, song)
    open.push(() => layer.dispose())
    const notes = songOfQuiet(ctx, layer, layerGain(ctx, ambOut), 30, 0.05)
    expect(notes.length, '一个音都没排，波形/音量无从谈起').toBeGreaterThanOrEqual(2)
    // `playSweep` 不传 type 时默认 sine ⇒ 读到 square 只可能是那一格被吃了
    expect(notes.every((n) => n.wave === 'square'), `波形没跟着表：${notes.map((n) => n.wave).join('/')}`).toBe(true)
    expect(notes.every((n) => Math.abs(n.peak - song.peak) < 1e-9), `峰值没跟着表：${notes.map((n) => n.peak).join('/')}`).toBe(true)
  })

  it('`form: null` 的那一区（§1.2 未竟厅「C→无调」）：一个旋律音都不排，但铃点照掷', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)   // A 床间隔 = 5s，铃点时刻可预算
    const { ctx, layer, ambOut } = rig(SONG_GRID, BED_A, SONG_ATONAL)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    const frames = beatFrames(ctx, layer, 30, 0.5)   // 15 秒 ⇒ 无调那一行什么旋律都不该有
    expect(melodyNotes(frames, inner).length, '无调那一行却排出了旋律音 = `form: null` 被当成了 prime').toBe(0)
    expect(chimeFrames(frames, inner).length, '没有旋律却连铃点也一起哑了（两件事各有一道门）').toBeGreaterThanOrEqual(2)
    expect(ctx.count('osc'), 'drone 也被带走了（无调只表示无旋律）').toBeGreaterThan(BED_A.layers.length)
  })

  it('没收到拍网 ⇒ 探索曲一个音都不排，而那句话说一次（铃点不吃网格，照掷）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const msgs: string[] = []
    open.push(bus.on('log', (l) => { if (l.msg.includes('探索曲')) msgs.push(l.msg) }))
    const { ctx, layer, ambOut } = rig(null, BED_A, SONG_PRIME)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    const frames = beatFrames(ctx, layer, 40, 0.5)   // 20 秒：够排 25 个音，如果它吃网格的话
    expect(melodyNotes(frames, inner).length, '没有拍网却排了旋律（`beatSec === 0` 那道门没生效）').toBe(0)
    expect(msgs.length, `没拍网这件事要说，但实测 ${msgs.length} 句 = 每帧都在喊`).toBe(1)
    expect(chimeFrames(frames, inner).length, '探索曲那道门把铃点一起带走了（间隔是按秒掷的）').toBeGreaterThanOrEqual(2)
  })

  it('调度晾 10 秒 ⇒ 只起**一个**音，排在"现在"而不是过去，之后回到正常音距（KI-067 的旋律腿）', () => {
    // `BED_CRYPT` 的理由见本文件顶部那段（逐音测量的六条共用同一条测量条件）：这一条还要再过一次
    // "一记 10 秒的跳跃"，旧床那颗**过期**的铃与旋律音必定挤进同一批节点。
    const { ctx, layer, ambOut } = rig(SONG_GRID, BED_CRYPT, SONG_PRIME)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    expect(songOfQuiet(ctx, layer, inner, 4, 0.05).length, '前 0.2 秒连一个音都没排，后面量不了"欠账"').toBe(1)
    ctx.advance(10)
    const before = ctx.nodes.length
    layer.update()
    const afterHitch = melodyNotes([{ t: Number(ctx.currentTime.toFixed(6)), nodes: ctx.nodes.slice(before) }], inner)
    expect(afterHitch.length, `晾了 10 秒之后一帧排出 ${afterHitch.length} 个音 = 把欠的旋律砸进现在（机枪）`).toBe(1)
    expect(afterHitch[0].start, `那个音排在 ${afterHitch[0].start}，而钟在 ${ctx.currentTime} = 往过去调度`).toBeGreaterThan(ctx.currentTime)
    // 重新锚定之后音距回到拍长（不是继续把过去十秒摊平）：两拍 + 一点余量，才数得出"第二个音"
    const later = songOfQuiet(ctx, layer, inner, 45, 0.05)
    expect(later.length, `重锚之后 2.25 秒只排了 ${later.length} 个音（一拍/音该有两个）`).toBeGreaterThanOrEqual(2)
    const gap = later[1].t - later[0].t
    expect(inBand(gap, SONG_BEAT, 0.05),
      `重锚后的音距该落在 ${SONG_BEAT}~${(SONG_BEAT + 0.05).toFixed(2)}s（一拍/音），实测 ${gap.toFixed(3)}s`).toBe(true)
  })

  it('同一张曲重发 ⇒ 乐句位置一格都不动（区域 tick 的重复噪声不许把句子拽回开头）', () => {
    const { ctx, layer, ambOut } = rig(SONG_GRID, BED_CRYPT, SONG_PRIME)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    const a = songOfQuiet(ctx, layer, inner, 20, 0.05)   // 1.0 秒 ⇒ 前两个音（度数 0、3）
    expect(a.map((n) => +n.hz.toFixed(2)), `前两个音不是动机的开头（实测 ${a.map((n) => n.hz).join('/')}）`).toEqual([PRIME[0], PRIME[1]])
    layer.setExplore(SONG_PRIME)                   // 同一张曲、同一个对象重发
    const b = songOfQuiet(ctx, layer, inner, 40, 0.05)  // 接下来 2 秒
    expect(b.length, '重发之后干脆不排了').toBeGreaterThanOrEqual(2)
    expect(+b[0].hz.toFixed(2), '重发把 `noteIdx` 拽回 0 = 每帧重发一次就永远念不完第二个音')
      .toBe(+PRIME[2].toFixed(2))
  })

  it('只换曲、不换床 ⇒ 当场换（押着不动的唯一理由是"旧区还在淡"，那个理由不在场时不许等）', () => {
    const { ctx, layer, ambOut } = rig(SONG_GRID, BED_A, SONG_PRIME)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    layer.setExplore(SONG_FELL)
    const notes = songOf(ctx, layer, inner, 40, 0.05)
    expect(notes.length, '换曲之后一个音都没排').toBeGreaterThanOrEqual(1)
    expect(inSet(notes[0].hz, FELL), `没有窗口在走却押着不换（第一个音 ${notes[0].hz} 仍属旧行）`).toBe(true)
  })

  /**
   * 上面那条只覆盖到"开局那次窗口还没兑现之前"的形状（`bedSwapAt` 那时还是个有限数）。
   * **窗口兑现之后**换曲才是装配里真正常见的那一条（走了一段路、进新区），而它是这份代码的真缺陷：
   * `update()` 把窗口收在哨兵 `Infinity` 上，`Infinity > now` 恒真，于是用"比此刻晚"当"窗口在走"的读法
   * 会把此后每一次换曲都押进 `songPending`——那里再没有东西来兑现它，新区永远不出旋律。
   */
  it('开局那次窗口兑现之后再换曲 ⇒ 仍然当场换（`Infinity` 是"没有窗口"的哨兵，不是"窗口永远走不完"）', () => {
    const { ctx, layer, ambOut } = rig(SONG_GRID, BED_A, SONG_PRIME)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    const old = songOf(ctx, layer, inner, 8, 0.05)   // 推过 `update()`：窗口的兑现处跑过了
    expect(old.length, '开局那一行一个音都没排，这条量不了"换曲之后当场不当场"').toBeGreaterThanOrEqual(1)
    expect(old.every((n) => inSet(n.hz, PRIME)), '开局那一行唱的不是自己的名册').toBe(true)
    layer.setExplore(SONG_FELL)
    const next = songOf(ctx, layer, inner, 8, 0.05)
    expect(next.length, '换曲之后一个音都不排 = 那一行被押进了一个永远走不完的窗口').toBeGreaterThanOrEqual(1)
    expect(inSet(next[0].hz, FELL), `没有窗口在走却押着不换（第一个音 ${next[0].hz} 仍属旧行）`).toBe(true)
  })

  it('「旋律层最后」的旋律腿：窗口里仍唱旧那一行，兑现那一帧换新行、并从动机第一个音重新开始', () => {
    const G120: MusicGrid = { bpm: 120, beatsPerBar: 4 }
    const XF = 8 * G120.beatsPerBar * (60 / G120.bpm)   // 8 小节 = 16s：与 KI-077 那批用例同一测量条件
    const { ctx, layer, ambOut } = rig(G120, BED_A, SONG_PRIME)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    const before = songOf(ctx, layer, inner, 8, 0.25)   // 走到 t = 2.0
    expect(before.length, '换床之前连三个音都没唱，量不了"什么时候换行"').toBeGreaterThanOrEqual(3)
    expect(before.every((n) => inSet(n.hz, PRIME)), '开局那一行没唱自己的名册').toBe(true)
    layer.setAmbience(BED_B)                            // bedSwapAt = 2 + 16 = 18
    layer.setExplore(SONG_FELL)                         // 同一次换区带来的新曲：必须押着
    const seen: Array<{ t: number; hz: number }> = []
    for (let guard = 0; guard < 60 && !seen.some((n) => inSet(n.hz, FELL)); guard++) {
      seen.push(...songOf(ctx, layer, inner, 4, 0.25))
    }
    const firstNew = seen.findIndex((n) => inSet(n.hz, FELL))
    expect(firstNew, `推到 t=${seen.length ? seen[seen.length - 1].t : '?'} 新行也没开口 = 窗口兑现处没接探索曲`).toBeGreaterThan(-1)
    const inWindow = seen.slice(0, firstNew)
    expect(inWindow.length, `窗口里只唱了 ${inWindow.length} 个旧音就换了行 = 旋律抢在和声淡变前面（§1.2 那句反了）`)
      .toBeGreaterThanOrEqual(4)
    expect(inWindow.every((n) => inSet(n.hz, PRIME)), `窗口里出现别的行：${inWindow.map((n) => n.hz).join('/')}`).toBe(true)
    // 兑现那一帧重新开始念：逆行形态的第一个音 = 顺行的最后一个（1140.35），不是接着上一句的位置
    expect(+seen[firstNew].hz.toFixed(2), '换行之后没有从动机第一个音重新开始（`applyExplore` 没重置 `noteIdx`）')
      .toBe(+FELL[0].toFixed(2))
    const after = songOf(ctx, layer, inner, 30, 0.25)   // 兑现之后再唱 7.5 秒
    expect(after.length, '换行之后唱不满四个音').toBeGreaterThanOrEqual(4)
    expect(after.every((n) => inSet(n.hz, FELL)), `兑现之后又唱回旧行：${after.filter((n) => !inSet(n.hz, FELL)).map((n) => n.hz).join('/')}`).toBe(true)
    expect(XF, '上面那条推帧预算是照 8 小节 = 16s 写的；窗口长度变了这一条会先假红').toBe(16)
  })

  it('窗口里连换两张曲 ⇒ 后一张说话（`songPending` 是单格，不是队列）', () => {
    const G120: MusicGrid = { bpm: 120, beatsPerBar: 4 }
    const { ctx, layer, ambOut } = rig(G120, BED_A, SONG_PRIME)
    open.push(() => layer.dispose())
    const inner = layerGain(ctx, ambOut)
    layer.setAmbience(BED_B)
    layer.setExplore(SONG_FELL)
    layer.setExplore(SONG_LATEST)   // 两次换区挤进同一个窗口（区域 tick 很快）
    const seen: Array<{ t: number; hz: number }> = []
    for (let guard = 0; guard < 80 && !seen.some((n) => inSet(n.hz, LATEST)); guard++) {
      seen.push(...songOf(ctx, layer, inner, 4, 0.25))
    }
    const opened = seen.findIndex((n) => inSet(n.hz, LATEST))
    expect(opened, '押着的那两张都没开口').toBeGreaterThan(-1)
    expect(seen.slice(0, opened).some((n) => inSet(n.hz, FELL)), '中间那张也唱了一遍（押注被当成了队列）').toBe(false)
  })

  it('`motifDegrees` 是那张表的唯一主人：三行度数各是它自己，交出的是副本', () => {
    expect(motifDegrees('prime'), '顺行 = R-1 本形（C–Eb–G–Bb ⇒ 0/3/7/10）').toEqual([0, 3, 7, 10])
    expect(motifDegrees('inversion'), '倒影 = 度数取负（音程上下翻转）').toEqual([0, -3, -7, -10])
    expect(motifDegrees('retrograde'), '逆行 = 顺序倒过来（度数不变）').toEqual([10, 7, 3, 0])
    const a = motifDegrees('prime')
    a[0] = 999
    expect(motifDegrees('prime')[0], '交出去的是 `MOTIF_R1` 本身：调用方一改就把全表改了')
      .toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* KI-080：区域战斗档第一次有读者（那一行走哪条线、钟隔几小节，都是数据说的）   */
/* ------------------------------------------------------------------ */

describe('战斗档那一行（KI-080：`battle.json` 的形状进了耳朵）', () => {
  /** 只有"这一批里有一拍打在拍面上"才算一拍（石铃与 drone 的批次不算） */
  const beatBatches = (ctx: FakeAudioContext, layer: MusicLayer, n: number): FakeNode[][] =>
    beats(ctx, layer, n).filter((b) => b.some(isBeatNode))
  /**
   * 那一拍的低音本音：一条拍面上的音 = 本音 + 反拍高八度那一对，两者都只被 set 过一次频率，
   * 所以取这批里"只 set 一次"的那些振荡里最低的那个（与 KI-065 那批用例同一认法）。
   */
  const bassRoot = (b: FakeNode[]): number => {
    const on = b.filter((n) => n.kind === 'osc' && n.params.frequency.events.length === 1)
    return Math.min(...startedFreqs(on))
  }
  /** 钟 accent 的记号：基频 261.64（= 战斗主音 65.41×4）±2.5Hz（泛音带 ±8 音分，容差不许写死成等值） */
  const accentAt = (b: FakeNode[]): boolean =>
    b.some((n) => n.kind === 'osc' && Math.abs(startedFreqs([n])[0] - 261.64) < 2.5)
  /** 交战 20 秒之后按 `step` 推帧，返回拍面批次 */
  function fight(row: BattleScore | null, frames: number): { ctx: FakeAudioContext; batches: FakeNode[][]; logs: string[] } {
    const { ctx, layer } = rig(GRID, null, null, row)
    open.push(() => layer.dispose())
    const logs: string[] = []
    open.push(bus.on('log', (p) => { if (p.msg.includes('战斗档')) logs.push(p.msg) }))
    layer.start()
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    return { ctx, batches: beatBatches(ctx, layer, frames), logs }
  }

  it('手抄的那份动机度数与主人对得上：`R1_SEMI` == `MOTIF_R1`', () => {
    expect(R1_SEMI, '测试这一侧抄的度数与代码里那份不是同一串 ⇒ 下面那些 `cellHz` 期望值全在说别的事')
      .toEqual([...MOTIF_R1])
    expect(R1_SEMI, `顺行的度数就是 \`motifDegrees("prime")\`（两个主人会在这条用例上打架）`)
      .toEqual([...motifDegrees('prime')])
  })

  it('一格一格解：0 = 战斗主音本音，往上三格是 R-1 的另外三个音，第 5 格起抬一个八度', () => {
    expect(battleOstinatoHz(0), '第 0 格不是主音本身（§1.1 那个不变的 C2 = 65.41）').toBeCloseTo(65.41, 9)
    for (let c = 1; c < 4; c++) {
      expect(battleOstinatoHz(c), `第 ${c} 格不是主音之上第 ${R1_SEMI[c]} 半音`).toBeCloseTo(ET(R1_SEMI[c]), 9)
    }
    // 八度档：这一维必须**恰好**是 2 倍，不是"高一点"
    for (let c = 0; c < 4; c++) {
      expect(battleOstinatoHz(c + 4) / battleOstinatoHz(c), `第 ${c + 4} 格不是第 ${c} 格的八度`).toBeCloseTo(2, 9)
    }
    expect(battleOstinatoHz(MOTIF_R1.length), '走完**动机自己的音数**那一格就该抬一个八度（步长的主人是动机，不是写死的 4）')
      .toBeCloseTo(65.41 * 2, 9)
  })

  it('换一行 ⇒ 每一拍的低音都换成那一行的格，一个音都不留在旧线上', () => {
    const line = fight(BATTLE_LINE, 60)
    expect(line.batches.length, '60 帧（3 秒 ≈ 4 拍 @84BPM）里凑不齐四拍 = 场景没搭起来，这条量不了换行').toBeGreaterThanOrEqual(4)
    // 默认行的头四拍：C2 C2 G2 Eb3。⚠️ 用的是**根音**而不是它的反拍八度：默认行 98 的反拍就是 196，
    // 而新行 cell 6 的本音也是 196 —— 只问"图上有没有 196"会两头都通过（KI-079 那条"判据不许假设参数形状"同族）。
    expect(bassRoot(line.batches[0]), '第 1 拍的低音不是 C2').toBeCloseTo(cellHz(0), 9)
    expect(bassRoot(line.batches[2]), '第 3 拍的低音不是 G2').toBeCloseTo(cellHz(2), 9)
    expect(bassRoot(line.batches[3]), '第 4 拍的低音不是 Eb3').toBeCloseTo(cellHz(5), 9)

    const wide = fight(BATTLE_WIDE, 60)
    expect(wide.batches.length, '换行之后一拍都没排').toBeGreaterThanOrEqual(4)
    for (let i = 0; i < Math.min(4, wide.batches.length); i++) {
      expect(bassRoot(wide.batches[i]), `换行之后第 ${i + 1} 拍还唱旧线（${bassRoot(wide.batches[i])} ≠ G3 ${cellHz(6)}）`)
        .toBeCloseTo(cellHz(6), 9)
    }
  })

  it('钟隔几小节是那一行说的：`bellEveryBars` 2→4 ⇒ 第 9 拍那记消失、改在第 17 拍（双向判别）', () => {
    // 4/4 @84BPM：2 小节 = 8 拍 ⇒ accent 落在第 1/9/17 拍；4 小节 = 16 拍 ⇒ 落在第 1/17 拍。
    // 这一条要**两侧都有证人**：只断言"旧的没了"会被"整段不打钟"骗过去，只断言"新的有"会被"周期写死"骗过去。
    const two = fight(BATTLE_LINE, 260)
    expect(two.batches.length, '拍数不够（要跨过第 17 拍）').toBeGreaterThanOrEqual(17)
    const atTwo: number[] = []
    two.batches.forEach((b, i) => { if (accentAt(b)) atTwo.push(i) })
    expect(atTwo, `每两小节一记钟读出来的不是第 1/9/17 拍：${atTwo.map((k) => k + 1).join('/')}`).toEqual([0, 8, 16])

    const four = fight(BATTLE_WIDE, 260)
    expect(four.batches.length, '拍数不够').toBeGreaterThanOrEqual(17)
    const atFour: number[] = []
    four.batches.forEach((b, i) => { if (accentAt(b)) atFour.push(i) })
    expect(atFour, `这一行写的是每 4 小节一记钟，读出来的不是第 1/17 拍：${atFour.map((k) => k + 1).join('/')}`).toEqual([0, 16])
  })

  it('战斗主音不跟着区域那张床走（§1.1「主音不变、色彩变暗」）：换床之后低音一位都不动', () => {
    // 这一条防的是"顺手把战斗层也接到区域主音上"——那一句抹掉的就是 §1.1 那一格。
    // 床换成 B 床（主音差一个全音、低通更暗、铃点名册完全不同），低音线必须一格都没变。
    const { layer } = rig(GRID, BED_B, null, BATTLE_LINE)
    open.push(() => layer.dispose())
    const a = fight(BATTLE_LINE, 60)
    expect(bassRoot(a.batches[0]), '第 1 拍的低音不是 C2').toBeCloseTo(cellHz(0), 9)
    // 上面那一句用的是同一个 rig 形状（床=null），这里再把"喂了一张完全不同的床"这条路走一遍：
    const { ctx, layer: withBed } = rig(GRID, BED_B, null, BATTLE_LINE)
    open.push(() => withBed.dispose())
    withBed.start()
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    const b = beatBatches(ctx, withBed, 60)
    expect(b.length, '带床的世界一拍都没排（床把战斗层带走了？）').toBeGreaterThanOrEqual(4)
    expect(bassRoot(b[0]), '换了区域床，战斗低音就跟过去了 = §1.1 那句"主音不变"是假的')
      .toBeCloseTo(cellHz(0), 9)
    expect(bassRoot(b[1])).toBeCloseTo(cellHz(0), 9)
    expect(bassRoot(b[2]), '第 3 拍不再是那一行的第 3 格').toBeCloseTo(cellHz(2), 9)
    void layer
  })

  it('`noMusic` 那一档 ⇒ 音乐总线上一条振荡都不排，而那句"没收到战斗档"不许响（§6.3：安静是数据说的）', () => {
    const { ctx, batches, logs } = fight(BATTLE_SILENT, 120)
    expect(batches.length, '这一档本该什么都不排').toBe(0)
    expect(ctx.nodes.filter((n) => n.kind === 'osc').length, '无配乐那一档还是建了振荡器').toBe(0)
    expect(logs.length, `数据说的安静却喊了装配：${logs.join(' | ')}`).toBe(0)
    // 增益仍然淡入：§16 那句"音乐停"要的是这条腿在，只是没有声音挂在它上面
    const g = ctx.nodes.find((n) => n.kind === 'gain'
      && n.params.gain.events.some((e) => e.kind === 'lin' && Math.abs(e.value - 0.9) < 1e-9))
    expect(g, '无配乐那一档连淡入都跳了 = 战斗层的门被这一行带走了').toBeTruthy()
  })

  it('没有那一行 ⇒ 一声不排、说一次，之后每帧重发都不刷屏（装配缺腿与数据安静是两件事）', () => {
    const { ctx, batches, logs } = fight(null, 200)
    expect(batches.length, '没接上战斗档却还在排拍').toBe(0)
    expect(ctx.nodes.filter((n) => n.kind === 'osc').length).toBe(0)
    expect(logs.length, `那句话该恰好说一次，实测 ${logs.length} 次`).toBe(1)
    // 接上之后立刻有声（同一条腿的两个方向都要有证人）
    const back = fight(BATTLE_LINE, 60)
    expect(back.batches.length, '给了一行还是不出声 = 上面那条红其实是装配本身断了').toBeGreaterThanOrEqual(4)
    expect(back.logs.length, `给了行之后那句装配读数还在响：${back.logs.join(' | ')}`).toBe(0)
  })

  it('`setBattle(null)` 不许把正在演的那条线掐掉（与 `setExplore(null)` 同一条口径）', () => {
    const { ctx, layer } = rig(GRID, null, null, BATTLE_LINE)
    open.push(() => layer.dispose())
    layer.start()
    bus.emit('audio.music.encounter', { start: true, enter: ENTRY })
    const before = beatBatches(ctx, layer, 40).length
    layer.setBattle(null)
    const after = beatBatches(ctx, layer, 40).length
    expect(before, '这一段一拍都没排，后面那个"没被掐掉"没有可比的东西').toBeGreaterThan(0)
    expect(after, '发了一条 null 就把战斗层噤了 = 上一档没保住（未知 id / 事件缺失该保留上一行）')
      .toBeGreaterThan(0)
  })
})
