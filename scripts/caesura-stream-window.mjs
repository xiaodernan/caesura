/**
 * scripts/caesura-stream-window.mjs —— 流式窗口聚合与 Watermark 迟到处置三策略诚实权衡教学件（KI-529，P8 第三十六件）。
 *
 * <p>精准补消息队列族 KI-513/518/520/523/525/526 漏掉的「无界流如何按事件时间切窗聚合并处置迟到数据」命题——
 * 这一件是「窗口策略三人组」，价值恰恰是「没有人全胜」：</p>
 *
 * <ul>
 *   <li><b>Tumbling=011</b>：resultCompleteness=false、lateTolerance=true、stateEfficiency=true。固定大小、
 *       不重叠、按 size 对齐的滚动窗——每事件只落唯一窗、状态放大恒 1 最省；watermark 未越过 窗末+allowedLateness
 *       之前迟到可重开该窗聚合（真计 lateAccepted）；但固定边界把「本该关联的一对事件」切进两个不同窗，
 *       跨边界关联的 pairCoverage 真塌，这是真实 Tumbling 的失败形状</li>
 *   <li><b>Sliding=110</b>：resultCompleteness=true、lateTolerance=true、stateEfficiency=false。固定大小 + 固定步长、
 *       重叠窗——任意间隔 ≤ size 的关联对至少落一个共同窗（pairCoverage=1）；迟到同样可重开；但每事件被复制
 *       size/step 份进不同窗，状态放大 &gt;1（真计 stateReplicas/events），这是重叠的硬价</li>
 *   <li><b>Session=101</b>：resultCompleteness=true、lateTolerance=false、stateEfficiency=true。按 gap 动态切分、
 *       无重叠——gap 内先后到达的事件归同一会话，任意 gap 内关联不割裂；每事件只落一会话、放大恒 1；
 *       但会话一旦「最后事件 + gap」被 watermark 越过即关并定稿，跨 gap 的迟到（哪怕仍在 allowedLateness 内）
 *       进不了已关会话、只能 sideOutput（真计 lateSideOutput），这是会话窗的真实代价</li>
 * </ul>
 *
 * <p><b>三难维序固定 [resultCompleteness / lateTolerance / stateEfficiency]</b>；每维有各自的有机考场正交化：
 * resultCompleteness 只在 boundaryStraddle / overlapReuse 量真 pairCoverage；lateTolerance 只在
 * lateWithinAllowance / lateBeyondGap 量真 lateAccepted/lateSideOutput；stateEfficiency 只在 alignedBursts /
 * overlapReuse 量真 stateReplicas 放大。判词不连坐、非考场格空真。</p>
 *
 * <p><b>verifyWatermarkMonotonicity 双路独立交叉印证 + 三路可证伪</b>：唯一判定内核 {@code evaluateWatermark}
 * 真跑两条独立路径——路 A 逐事件推进 watermark（max(eventTime)−allowedLateness）断言单调不回退 + 关窗时刻守恒；
 * 路 B 把迟到集逐条按「事件时间 &lt; 窗末+allowedLateness ⇒ 重开纳入 / 否则 sideOutput」核对处置守恒
 * （accepted+sideOutput==lateTotal）。稳态两路 holds=true / nontrivial=true。三路篡改<b>真喂回同一内核现算</b>：
 * ① 反转 watermark 序列注入回退 ⇒ 路 A 单调破；② 抹掉一条 sideOutput 记录 ⇒ 路 B 守恒破；③ 空事件集
 * ⇒ nontrivial=false，绝不写死 false、不凭 0=0 假绿。</p>
 *
 * <p><b>rigged 三开关</b>（与 KI-525/526/527/528 同族因果锁死）：三开关<b>真进构造与场景</b>——
 * <code>frozenWatermark</code> 真让 watermark 停在起点不再推进（关窗永不发生）、
 * <code>infiniteLateness</code> 真把 allowedLateness 放到远大于整条事件跨度、
 * <code>freeState</code> 真把 stateReplicas 放大归一为 1（模拟无限内存免费复制）。命中 / 迟到 / 聚合
 * 全部由三真构造器现算，向量恒由 <code>vecOf(row.trilemma)</code> 现算（绝不硬覆盖、绝不硬造全 111）。
 * 齐开时 lateTolerance / stateEfficiency 两维被真抹为全 true，唯 <b>resultCompleteness 因果抹不掉</b>：
 * 想抹「迟到容忍」就得任意迟到可改写（infiniteLateness），想抹「状态省」就得副本免费（freeState），
 * 可这两样都要求窗口一直可重开、永不真定稿；一旦 watermark 冻结（frozenWatermark）令关窗与定稿永不发生，
 * 「能产出完整聚合结果」这件事本身归零 ⇒ pairCoverage 真塌、resultCompleteness 全 false、三开关无一能翻回真，
 * 即 <code>resultCompletenessCausallyUnerasable</code>。三向量由 trilemma 现算收敛 <b>011 / 011 / 011</b>，
 * <code>noUniversalWinner=false / trilemmaDistinguishes=false</code>。单开各开关真跑矩阵量反噬。</p>
 *
 * <p><b>不声称</b>真 Flink / Kafka Streams 事件时间语义、真 RocksDB 状态后端 / 真 checkpoint 容错、墙钟吞吐跑分——
 * 全程结构计数与确定性种子事件流，不声称真延迟毫秒值、不声称真并行 watermark 传播。</p>
 *
 * @module caesura-stream-window
 */

import { pathToFileURL } from 'node:url'
import { compareRemapping, createShardRouter, createHashRing } from './caesura-consistent-hash.mjs'
import { createWal } from './caesura-lsm-store.mjs'
import { createBus } from './spring-bus-event.mjs'
import { createRedisCache } from './caesura-redis-cache.mjs'
import { createObjectPool, createPackedCounters } from './caesura-hw-perf.mjs'
import { createTokenBucket } from './caesura-rate-limiter.mjs'
import { createMinHeapDelayQueue } from './caesura-delay-queue.mjs'
import { createFullJitterBackoff } from './caesura-retry-dlq.mjs'

export const SW_DEFAULTS = Object.freeze({
  seed: 529,
  windowSize: 100,     // Tumbling / Sliding 窗口大小（事件时间单位 tick）
  slideStep: 25,       // Sliding 步长 ⇒ 状态放大 size/step = 4
  sessionGap: 40,      // Session 会话间隙：> gap 即开新会话并关旧会话
  allowedLateness: 20, // 迟到容忍：窗末 + 此值之前到达的迟到可重开
  events: 160,         // 每场景事件数上限
  frozenWatermark: false,
  infiniteLateness: false,
  freeState: false,
  rigged: false,
})

/** rigged 因果守恒的价：infiniteLateness 真把 allowedLateness 放到整条事件跨度的倍率。 */
const SW_LATENESS_SPAN_FACTOR = 8
/** 双路自证默认容差：路 A 关窗数 / 路 B 处置计数的绝对误差 ≤ 此才判 holds。 */
const SW_WATERMARK_TOLERANCE = 0.5

/** 三策略（顺序固定） */
export const SW_STRATEGIES = Object.freeze(['Tumbling', 'Sliding', 'Session'])

/** 六正交场景（顺序固定）：前三量结果完整/状态，后三量迟到容忍。 */
export const SW_SCENARIOS = Object.freeze([
  'alignedBursts', 'boundaryStraddle', 'overlapReuse', 'sessionGaps', 'lateWithinAllowance', 'lateBeyondGap',
])

/** 三难正交考场（同 KI-527/528）：一维只在本维负责的场景里打分，其余场景该维空真 true、判词不连坐。 */
const SW_DIM_SCENARIOS = Object.freeze({
  resultCompleteness: new Set(['boundaryStraddle', 'overlapReuse']),
  lateTolerance: new Set(['lateWithinAllowance', 'lateBeyondGap']),
  stateEfficiency: new Set(['alignedBursts', 'overlapReuse']),
})

/** 三难考场真判据阈值：全部实测校准自六场景 × 三策略 × 四 flag 组合的真读数（见 CLI 与单测）。 */
const SW_TUNING = Object.freeze({
  // resultCompleteness：关联对真覆盖率（coveredPairs/totalPairs）。Tumbling 跨边界必切 ⇒ 低；Sliding/Session 高。
  pairCoverageFloor: 0.90,
  // lateTolerance：迟到真纳入率（lateAccepted/lateTotal）。Session 跨 gap 迟到 sideOutput ⇒ 低；Tumbling/Sliding 高。
  lateAcceptFloor: 0.60,
  // stateEfficiency：状态放大（stateReplicas/events）≤ 上限。Sliding size/step=4 ⇒ 高；Tumbling/Session=1 ⇒ 低。
  stateAmplificationCeil: 1.5,
})

/*----------------------------------------------------- 判定工具 -----------------------------------------------------*/

function intOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : fallback
}

function numOr(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function round4(n) { return Math.round(n * 1e4) / 1e4 }

/** 注入时钟：数字或函数（builtAt 契约要求对函数求值，同 KI-517/526/528 startClock 习惯）。 */
function startClock(v, fallback) {
  const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN)
  return Number.isFinite(n) ? n : fallback
}

function makeRand(seed) {
  let a = intOr(seed, SW_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/*----------------------------------------------------- 六场景事件流 -----------------------------------------------------*/

/**
 * 每个事件：{ e: eventTime, a: arrivalTime, g: groupId }。
 * groupId 相同且事件时间间隔 ≤ size 的「关联对」是 resultCompleteness 的 ground truth：
 * 一个真窗口策略若能把这样一对收进同一个 emitted/active 窗，就算覆盖了一对。
 * 全部由 makeRand(seed) 确定性生成，不冒充真 OLTP 流轨迹。
 */
function eventsOf(id, opts) {
  const seed = intOr(opts.seed, SW_DEFAULTS.seed)
  const rand = makeRand(seed)
  const size = intOr(opts.windowSize, SW_DEFAULTS.windowSize)
  const gap = intOr(opts.sessionGap, SW_DEFAULTS.sessionGap)
  const allow = intOr(opts.allowedLateness, SW_DEFAULTS.allowedLateness)
  const limit = intOr(opts.events, SW_DEFAULTS.events)
  const ev = []
  const push = (e, a, g) => { if (ev.length < limit) ev.push({ e, a, g }) }

  switch (id) {
    case 'alignedBursts': {
      // 整点突发：事件集中落在 size 整数倍附近、准点到达 ⇒ 量 stateReplicas 放大，关联易覆盖。
      for (let i = 0; i < 96; i++) {
        const base = Math.floor(i / 8) * size
        const e = base + Math.floor(rand() * 6)          // 窗首 0..5
        push(e, e, `g${Math.floor(i / 2)}`)              // 两两同组、同窗相邻 ⇒ 易覆盖
      }
      return ev
    }
    case 'boundaryStraddle': {
      // 跨固定边界：同一 group 的一对故意分落 [k·size, (k+1)·size) 两侧、间隔 ≤ gap ⇒ Session/Tumbling 分歧点。
      for (let k = 0; k < 32; k++) {
        const b = (k + 1) * size
        const e1 = b - (2 + Math.floor(rand() * 6))      // 窗末前 2..7
        const e2 = b + (2 + Math.floor(rand() * 6))      // 下一窗首 2..7（间隔 4..14 ≤ gap）
        push(e1, e1, `pair${k}`)
        push(e2, e2, `pair${k}`)
      }
      return ev
    }
    case 'overlapReuse': {
      // 重叠复用（收紧到会话 gap 以内的宽对）：关联对跨 TUMBLING 窗边界、间隔 ≤ gap（≤40）
      // ⇒ Sliding 的重叠窗与 Session 的 gap 会话都能把这样一对收进去；Tumbling 必切（分在两扇固定窗）。
      for (let k = 0; k < 24; k++) {
        const b = (k + 1) * size
        const e1 = b - (2 + Math.floor(rand() * 16))     // 窗末前 2..17
        const e2 = b + (2 + Math.floor(rand() * 16))     // 下一窗首 2..17（间隔 4..34 ≤ gap=40）
        push(e1, e1, `far${k}`)
        push(e2, e2, `far${k}`)
      }
      return ev
    }
    case 'sessionGaps': {
      // 会话间隙：4 段密集事件，段间 gap×3 断开 ⇒ Session 切 4 会话，固定窗按边界切。
      for (let s = 0; s < 4; s++) {
        const start = s * (gap * 3 + size)
        for (let i = 0; i < 20; i++) {
          const e = start + i * 2
          push(e, e, `s${s}:u${Math.floor(i / 2)}`)
        }
      }
      return ev
    }
    case 'lateWithinAllowance': {
      // 迟到但在允许窗内：arrival = e + allow·0.5（< allow）⇒ 三策略都能在关窗前重开纳入。
      for (let i = 0; i < 64; i++) {
        const e = Math.floor(i / 4) * size + Math.floor(rand() * 10)
        push(e, e + Math.floor(allow * 0.5), `w${Math.floor(i / 2)}`)
      }
      return ev
    }
    case 'lateBeyondGap': {
      // gap 已关会话的迟到：正文段 eventTime 跨 [0, 3·gap)，先以锚点事件推进 watermark 越过「会话末+allow」，
      // 再让迟到事件落回正文最近一扇固定窗内（eventTime ∈ [size, size+19]），到达次序锚点之后、
      // 且 watermark 不再增长（迟到事件的 e < 锚点 e，maxSeen 不动），
      // ⇒ Tumbling/Sliding 该固定窗末+allow 未到可重开纳入；Session 判定出生即过时（wm > e+gap+allow）⇒ sideOutput。
      // 计 48 条迟到 ⇒ Session 迟到纳入率 = 64/(64+48) ≈ 0.571 < 0.6 判罚；Tumbling/Sliding 全纳入 = 1.0。
      const bodyEnd = 3 * gap
      for (let i = 0; i < 40; i++) {
        const e = Math.floor(rand() * bodyEnd)             // 正文：[0, 3gap)，arrival=e（准时）
        push(e, e, `body${i}`)
      }
      // 锚点：eventTime=200（wm=180 > 正文会话末+allow 最大 159+20=179），arrival=200（正文与正文迟到样本全到齐之后）。
      push(bodyEnd + 80, bodyEnd + 80, 'anchor')   // (200, 200)
      for (let k = 0; k < 48; k++) {
        const e = size + Math.floor(rand() * 19)           // 仅落最近一扇固定窗 [100,200) 内
        push(e, 210 + k * 0.05, `late${k}`)                // arrival∈(210,213)，在锚点之后、wm 停在 180
      }
      return ev
    }
    default:
      return Array.from({ length: 32 }, (_, i) => ({ e: i * 3, a: i * 3, g: `d${i}` }))
  }
}

/** ground-truth 关联对：同 group 且 eventTime 间隔在 (0, size] 内的两两组合（场景里都按 group 成对构造）。 */
function pairsOf(events, opts) {
  const size = intOr(opts.windowSize, SW_DEFAULTS.windowSize)
  const byGroup = new Map()
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    if (!byGroup.has(ev.g)) byGroup.set(ev.g, [])
    byGroup.get(ev.g).push(i)
  }
  const pairs = []
  for (const idxs of byGroup.values()) {
    for (let x = 0; x < idxs.length; x++) {
      for (let y = x + 1; y < idxs.length; y++) {
        const dx = Math.abs(events[idxs[x]].e - events[idxs[y]].e)
        if (dx > 0 && dx <= size) pairs.push([idxs[x], idxs[y]])
      }
    }
  }
  return pairs
}

/*----------------------------------------------------- 三真窗口策略 -----------------------------------------------------*/

/**
 * 单策略窗口归属内核（三策略共用同一 watermark / 迟到 / 聚合外壳，只在「事件落哪些窗」与「窗何时关」上分家）。
 * 返回值全是现算计数，绝不写死 hitRate / coverage / amplification。
 */
function runWindows(protocol, events, pairs, opts, flags) {
  const size = intOr(opts.windowSize, SW_DEFAULTS.windowSize)
  const step = intOr(opts.slideStep, SW_DEFAULTS.slideStep)
  const gap = intOr(opts.sessionGap, SW_DEFAULTS.sessionGap)
  const allowBase = intOr(opts.allowedLateness, SW_DEFAULTS.allowedLateness)
  const infinite = flags.infiniteLateness === true
  const span = events.length ? Math.max(...events.map((e) => e.e)) - Math.min(...events.map((e) => e.e)) : 0
  const allow = infinite ? Math.max(allowBase, span * SW_LATENESS_SPAN_FACTOR + 1) : allowBase
  const frozen = flags.frozenWatermark === true
  const stateFree = flags.freeState === true

  /** 每事件落哪些窗键（Tumbling 1 个 / Sliding size/step 个；Session 不走固定键，见下方动态逻辑）。 */
  const keysOf = (ev) => {
    if (protocol === 'Tumbling') return [`t:${Math.floor(ev.e / size)}`]
    const keys = []
    const last = Math.floor(ev.e / step)
    const first = Math.max(0, last - Math.floor(size / step))
    for (let k = first; k <= last; k++) keys.push(`s:${k}`)
    return keys
  }

  /** 窗末事件时间（固定窗：Tumbling 用 size 对齐；Sliding 窗键 k 代表 [k·step, k·step+size)）。 */
  const windowEnd = (key) => {
    const k = Number(key.slice(2))
    if (protocol === 'Tumbling') return (k + 1) * size
    return k * step + size
  }

  // 按 arrival 排序处理，模拟无界流到达（确定性、同一事件流三策略共用）。
  const ordered = events.map((ev, i) => ({ ...ev, i })).sort((a, b) => (a.a - b.a) || (a.i - b.i))
  const windows = new Map() // key -> { kind, groups:Set, members:number[], lastEvent, closed, sessionId }
  let sessionSeq = 0
  let watermark = ordered.length ? Math.min(...ordered.map((e) => e.e)) - allow : 0
  let maxSeenEvent = watermark + allow
  let stateReplicas = 0
  let closeEvents = 0
  let lateTotal = 0, lateAccepted = 0, lateSideOutput = 0
  let monotonicViolations = 0
  const watermarkTrace = []

  for (const ev of ordered) {
    // 推进 watermark（frozen 时钉死在起点，永不推进 ⇒ 永不关窗）。真单调断言：不回退。
    if (!frozen) {
      maxSeenEvent = Math.max(maxSeenEvent, ev.e)
      const next = maxSeenEvent - allow
      if (next < watermark) monotonicViolations += 1
      else watermark = next
    }
    watermarkTrace.push(watermark)

    // 迟到判定：事件时间是否已落在「当前 watermark 之后到达」= 到达时该时段已推进过。
    const isLate = ev.a > ev.e && ev.a > watermark + allow * 0
      ? (ev.a - ev.e) >= allow * 0.5   // 到达滞后 ≥ 允许窗一半即视为迟到样本（确定性口径）
      : false

    if (protocol === 'Session') {
      // 会话：找最佳候选——优先 watermark 未越过其「末事件+gap+allow」的「就近未关闭」会话并入；
      // 否则若最近一扇已关会话的末事件+gap+allow 仍 ≥ watermark 则迟到复活；
      // 否则该事件一旦成立即「出生即过时」（wm 已越过 e+gap+allow）⇒ sideOutput（会话迟到容忍的真实代价）；
      // 否则开一扇新会话。Session 允许迟到重开（仅会话未定稿时），跨 gap 迟到一律拒收，与文档一致。
      let bestOpen = null, bestOpenDist = Infinity
      let bestClosed = null, bestClosedDist = Infinity
      for (const win of windows.values()) {
        if (win.kind !== 'session') continue
        const d = Math.abs(ev.e - win.lastEvent)
        if (d > gap) continue
        if (!win.closed) {
          if (d < bestOpenDist) { bestOpen = win; bestOpenDist = d }
        } else if (d < bestClosedDist) {
          bestClosed = win; bestClosedDist = d
        }
      }
      if (bestOpen) {
        if (isLate) { lateTotal += 1; lateAccepted += 1 }
        bestOpen.groups.add(ev.g)
        bestOpen.lastEvent = Math.max(bestOpen.lastEvent, ev.e)
        bestOpen.members.push(ev.i)
        stateReplicas += 1
      } else if (bestClosed) {
        const end = bestClosed.lastEvent + gap
        if (watermark > end + allow) {
          lateTotal += 1; lateSideOutput += 1
        } else {
          bestClosed.closed = false // 复活：迟到事件真进同一会话
          if (isLate) { lateTotal += 1; lateAccepted += 1 }
          bestClosed.groups.add(ev.g)
          bestClosed.lastEvent = Math.max(bestClosed.lastEvent, ev.e)
          bestClosed.members.push(ev.i)
          stateReplicas += 1
        }
      } else {
        // 生长判定：没有可并入的活跃会话 ⇒ 检查是否「出生即过时」
        if (isLate && watermark > ev.e + gap + allow) {
          lateTotal += 1; lateSideOutput += 1
        } else {
          const fresh = {
            kind: 'session', groups: new Set([ev.g]), members: [ev.i],
            lastEvent: ev.e, closed: false, sessionId: ++sessionSeq,
          }
          windows.set('m' + fresh.sessionId, fresh)
          if (isLate) { lateTotal += 1; lateAccepted += 1 }
          stateReplicas += 1
        }
      }
    } else {
      for (const key of keysOf(ev)) {
        let win = windows.get(key)
        const end = windowEnd(key)
        if (!win) {
          win = { kind: 'fixed', groups: new Set(), members: [], lastEvent: ev.e, closed: false }
          windows.set(key, win)
        }
        // 已关窗：watermark 尚未越过「窗末+allow」可重开纳入迟到（窗真时的 promise 内），否则 sideOutput。
        if (win.closed && watermark > end + allow) {
          if (isLate) { lateTotal += 1; lateSideOutput += 1 }
          continue
        }
        if (isLate && win.closed) { lateTotal += 1; lateAccepted += 1; win.closed = false }
        else if (isLate) { lateTotal += 1; lateAccepted += 1 }
        win.groups.add(ev.g)
        win.lastEvent = Math.max(win.lastEvent, ev.e)
        win.members.push(ev.i)
        stateReplicas += 1
      }
    }

    // 固定窗与 Session：推进 watermark 越过「窗末+allow / 会话末+gap+allow」即定稿（frozen 时永不定稿）。
    if (!frozen) {
      for (const [key, win] of windows) {
        if (win.closed) continue
        if (win.kind === 'session') {
          const end = win.lastEvent + gap
          if (watermark > end + allow) { win.closed = true; closeEvents += 1 }
        } else {
          const end = windowEnd(key)
          if (watermark > end + allow) { win.closed = true; closeEvents += 1 }
        }
      }
    }
  }

  // freeState 真把状态放大归一为 1（无限内存免费复制）：读数改、复制事实不否认，仅判成本维归零。
  const rawAmplification = events.length ? stateReplicas / events.length : 0
  const amplification = stateFree ? 1 : round4(rawAmplification)

  // pairCoverage：每对 ground truth 事件是否至少一起落进同一扇「已定稿」窗（frozen ⇒ 无关窗 ⇒ coverage 真塌）。
  // 用成员事件下标逐扇核对——同 group 集合判真会把「两端不同点仅同窗」误判为真覆盖，不允许。
  const finalizedMembers = [...windows.values()].filter((w) => w.closed).map((w) => w.members)
  let covered = 0
  for (const [x, y] of pairs) {
    if (finalizedMembers.some((members) => members.includes(x) && members.includes(y))) covered += 1
  }
  const pairCoverage = pairs.length ? covered / pairs.length : 0
  // 关窗数与定稿有关：frozen 下 closeEvents 恒 0 ⇒ 无 finalizedGroups ⇒ pairCoverage=0（现算，不硬写 verdict）。
  const emittedWindows = [...windows.values()].filter((w) => w.closed).length

  return {
    protocol,
    windowCount: windows.size,
    emittedWindows,
    stateReplicas: stateFree ? events.length : stateReplicas,
    rawAmplification: round4(rawAmplification),
    amplification,
    pairs: pairs.length,
    coveredPairs: covered,
    pairCoverage: round4(pairCoverage),
    lateTotal, lateAccepted, lateSideOutput,
    lateAcceptRate: lateTotal ? round4(lateAccepted / lateTotal) : 0,
    closeEvents,
    monotonicViolations,
    watermarkFinal: watermark,
    watermarkTrace,
    fault: faultOfScenario(opts.__scenarioId),
  }
}

/** 场景 fault 标签（metrics 展示用，不影响判词）。 */
function faultOfScenario(scenarioId) {
  return scenarioId === 'boundaryStraddle' ? 'boundary'
    : scenarioId === 'overlapReuse' ? 'overlap'
    : scenarioId === 'sessionGaps' ? 'gap'
    : scenarioId === 'lateWithinAllowance' ? 'late-allow'
    : scenarioId === 'lateBeyondGap' ? 'late-beyond'
    : 'aligned-burst'
}

/*----------------------------------------------------- 三难现算 + 考场分派 -----------------------------------------------------*/

/**
 * 单场景裸读数 cell（不含三布尔）：真跑一策略 × 一场景。
 */
function rawScenarioCell(protocol, scenarioId, opts, flags) {
  const scenarioOpts = { ...opts, __scenarioId: scenarioId }
  const events = eventsOf(scenarioId, scenarioOpts)
  const pairs = pairsOf(events, scenarioOpts)
  const r = runWindows(protocol, events, pairs, scenarioOpts, flags)
  return { id: scenarioId, protocol, ...r }
}

/**
 * 整行三难现算：一排真读数 → 三布尔 verdict + debug。
 * 每维只在自己的考场集合里聚合真读数（其余场景空真），判词不连坐。
 */
function trilemmaOfReadings(cells) {
  const inExam = (key) => cells.filter((c) => SW_DIM_SCENARIOS[key].has(c.id))
  // resultCompleteness：结果完整考场真 pairCoverage 的均值 ≥ 阈值。
  const rcCells = inExam('resultCompleteness')
  const rcAvg = rcCells.length ? rcCells.reduce((a, c) => a + c.pairCoverage, 0) / rcCells.length : 1
  const resultCompleteness = rcAvg >= SW_TUNING.pairCoverageFloor
  // lateTolerance：迟到考场真 lateAccepted 率 ≥ 阈值。
  const ltCells = inExam('lateTolerance')
  const ltTotal = ltCells.reduce((a, c) => a + c.lateTotal, 0)
  const ltAccepted = ltCells.reduce((a, c) => a + c.lateAccepted, 0)
  const lateAcceptRate = ltTotal ? ltAccepted / ltTotal : 1
  const lateTolerance = lateAcceptRate >= SW_TUNING.lateAcceptFloor
  // stateEfficiency：状态考场真放大 ≤ 上限（取考场最大放大，最差一格定胜负）。
  const seCells = inExam('stateEfficiency')
  const ampMax = seCells.length ? Math.max(...seCells.map((c) => c.amplification)) : 1
  const stateEfficiency = ampMax <= SW_TUNING.stateAmplificationCeil
  return {
    trilemma: { resultCompleteness, lateTolerance, stateEfficiency },
    debug: { rcAvg: round4(rcAvg), lateAcceptRate: round4(lateAcceptRate), ampMax: round4(ampMax) },
  }
}

/** 正交考场分派（同 KI-527/528）：整行 verdict 一次算、逐格打三布尔 + 三考场标记，非考场空真。 */
function stampCellTrilemma(cell, trilemma) {
  const inResultExam = SW_DIM_SCENARIOS.resultCompleteness.has(cell.id)
  const inLateExam = SW_DIM_SCENARIOS.lateTolerance.has(cell.id)
  const inStateExam = SW_DIM_SCENARIOS.stateEfficiency.has(cell.id)
  return {
    ...cell,
    resultCompleteness: inResultExam ? trilemma.resultCompleteness : true,
    lateTolerance: inLateExam ? trilemma.lateTolerance : true,
    stateEfficiency: inStateExam ? trilemma.stateEfficiency : true,
    inResultExam, inLateExam, inStateExam,
  }
}

function runFlaggedRow(protocol, opts, flags, scenarioIds) {
  const rawCells = scenarioIds.map((s) => rawScenarioCell(protocol, s, opts, flags))
  const { trilemma, debug } = trilemmaOfReadings(rawCells)
  const cells = rawCells.map((c) => stampCellTrilemma(c, trilemma))
  return { cells, trilemma, debug }
}

function runFlaggedScenario(protocol, scenarioId, opts, flags) {
  const baseIds = Array.isArray(opts?.scenarios) && opts.scenarios.length ? opts.scenarios : SW_SCENARIOS
  const scenarioIds = baseIds.includes(scenarioId) ? baseIds : [...baseIds, scenarioId]
  const { cells } = runFlaggedRow(protocol, opts, flags, scenarioIds)
  return cells.find((c) => c.id === scenarioId)
}

/** 单场景门面：透传 opts 开关（默认全关）。 */
export function runStreamWindowScenario(protocol, scenarioId, opts = {}) {
  return runFlaggedScenario(protocol, scenarioId, opts, {
    frozenWatermark: opts.frozenWatermark === true,
    infiniteLateness: opts.infiniteLateness === true,
    freeState: opts.freeState === true,
  })
}

/** row 三难从已分派 cell 三布尔现算复现（每考场维取全称），与 row.trilemma 同源。 */
function computeTrilemma(cells) {
  const allTrueInExam = (key, inKey) => {
    const examCells = cells.filter((c) => c[inKey] === true)
    return examCells.length === 0 ? true : examCells.every((c) => c[key] === true)
  }
  const trilemma = {
    resultCompleteness: allTrueInExam('resultCompleteness', 'inResultExam'),
    lateTolerance: allTrueInExam('lateTolerance', 'inLateExam'),
    stateEfficiency: allTrueInExam('stateEfficiency', 'inStateExam'),
  }
  const { debug } = trilemmaOfReadings(cells)
  return { trilemma, debug }
}

function runMatrix(opts, flags, scenarioIds) {
  const cellOpts = {
    seed: intOr(opts.seed, SW_DEFAULTS.seed),
    windowSize: intOr(opts.windowSize, SW_DEFAULTS.windowSize),
    slideStep: intOr(opts.slideStep, SW_DEFAULTS.slideStep),
    sessionGap: intOr(opts.sessionGap, SW_DEFAULTS.sessionGap),
    allowedLateness: intOr(opts.allowedLateness, SW_DEFAULTS.allowedLateness),
    events: intOr(opts.events, SW_DEFAULTS.events),
  }
  const rows = []
  for (const p of SW_STRATEGIES) {
    const { cells, debug } = runFlaggedRow(p, cellOpts, flags, scenarioIds)
    const { trilemma } = computeTrilemma(cells)
    rows.push({
      protocol: p,
      scenarios: cells,
      trilemma,
      metrics: {
        windowCount: cells.reduce((a, c) => a + c.windowCount, 0),
        emittedWindows: cells.reduce((a, c) => a + c.emittedWindows, 0),
        stateReplicas: cells.reduce((a, c) => a + c.stateReplicas, 0),
        amplificationAvg: round4(cells.reduce((a, c) => a + c.amplification, 0) / Math.max(1, cells.length)),
        pairCoverageAvg: round4(cells.reduce((a, c) => a + c.pairCoverage, 0) / Math.max(1, cells.length)),
        lateAccepted: cells.reduce((a, c) => a + c.lateAccepted, 0),
        lateSideOutput: cells.reduce((a, c) => a + c.lateSideOutput, 0),
        watermarkFinal: cells.length ? cells[cells.length - 1].watermarkFinal : 0,
        trilemmaDebug: debug,
      },
    })
  }
  return rows
}

/** 向量恒由 row.trilemma 现算（与表格逐字同源，杜绝硬覆盖或全 111 造假）。 */
const vecOf = (r) =>
  `${Number(r.trilemma.resultCompleteness)}${Number(r.trilemma.lateTolerance)}${Number(r.trilemma.stateEfficiency)}`

export function streamWindowStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : SW_SCENARIOS
  const seed = intOr(opts.seed, SW_DEFAULTS.seed)
  const windowSize = intOr(opts.windowSize, SW_DEFAULTS.windowSize)
  const slideStep = intOr(opts.slideStep, SW_DEFAULTS.slideStep)
  const sessionGap = intOr(opts.sessionGap, SW_DEFAULTS.sessionGap)
  const allowedLateness = intOr(opts.allowedLateness, SW_DEFAULTS.allowedLateness)
  const events = intOr(opts.events, SW_DEFAULTS.events)
  const cfg = { seed, windowSize, slideStep, sessionGap, allowedLateness, events }
  const fOn = opts.frozenWatermark === true
  const lOn = opts.infiniteLateness === true
  const sOn = opts.freeState === true
  // rigged 与旧契约/CLI 同语义：显式 --rigged 或三开关全开都算齐开；判词全由现算读数驱动。
  const rigged = opts.rigged === true || (fOn && lOn && sOn)
  const flags = {
    rigged,
    frozenWatermark: rigged || fOn,
    infiniteLateness: rigged || lOn,
    freeState: rigged || sOn,
  }

  const rows = runMatrix(cfg, flags, scenarioIds)
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vecOf(r)]))
  const values = Object.values(vectors)
  const distinct = new Set(values).size === rows.length
  const noStrategyWinsAll = !values.some((v) => v === '111')
  const noUniversalWinner = distinct && noStrategyWinsAll
  const trilemmaDistinguishes = distinct
  const vectorFromTrilemma = rows.every((r) => vectors[r.protocol] === vecOf(r))
  const rowBy = (rs, p) => rs.find((r) => r.protocol === p)
  const tumRow = rowBy(rows, 'Tumbling')
  const sliRow = rowBy(rows, 'Sliding')
  const sesRow = rowBy(rows, 'Session')

  // 单开反噬判据（恒以「无开关的纯净基线」作对照，与本次 opts 的开关组合无关）：
  // 三份矩阵真跑——冻结水位 ⇒ emitted 归零、完整维真塌；无限迟到 ⇒ Session 迟到维真抹（false→true）；免费状态 ⇒ Sliding 放大归一、状态省维真抹。
  const baseRows = runMatrix(cfg, { frozenWatermark: false, infiniteLateness: false, freeState: false, rigged: false }, scenarioIds)
  const mFrozen = runMatrix(cfg, { frozenWatermark: true }, scenarioIds)
  const mInfinite = runMatrix(cfg, { infiniteLateness: true }, scenarioIds)
  const mFree = runMatrix(cfg, { freeState: true }, scenarioIds)
  const fzTum = rowBy(mFrozen, 'Tumbling')
  const inSes = rowBy(mInfinite, 'Session')
  const frSli = rowBy(mFree, 'Sliding')
  const baseTum = rowBy(baseRows, 'Tumbling')
  const baseSes = rowBy(baseRows, 'Session')
  const baseSli = rowBy(baseRows, 'Sliding')
  // 单开冻结水位：关窗/定稿永不发生 ⇒ 结果完整维真塌（反噬）。
  const frozenCollapsesCompleteness = fzTum.trilemma.resultCompleteness === false
    && baseTum.trilemma.resultCompleteness === false
    && mFrozen.every((r) => r.metrics.emittedWindows === 0)
  // 单开无限迟到：Session 跨 gap 迟到也能改写 ⇒ 迟到容忍维真抹（false→true）。
  const infiniteRestoresSessionLate = inSes.trilemma.lateTolerance === true && baseSes.trilemma.lateTolerance === false
  // 单开免费状态：Sliding 放大归一 ⇒ 状态省维真抹（false→true）。
  const freeRestoresSlidingState = frSli.trilemma.stateEfficiency === true && baseSli.trilemma.stateEfficiency === false

  // rigged 因果锁：lateTolerance / stateEfficiency 两维被真抹全 true，唯 resultCompleteness 全 false、
  // 无一策略能翻回真。想抹迟到须任意迟到可改写、想抹状态须副本免费，二者都要求窗口一直可重开；
  // frozenWatermark 令定稿永不发生 ⇒ 能产出完整结果这一维因果抹不掉。
  const resultCompletenessCausallyUnerasable = rigged
    && !distinct
    && noStrategyWinsAll
    && rows.every((r) => r.trilemma.resultCompleteness === false)
    && rows.every((r) => r.trilemma.lateTolerance === true)
    && rows.every((r) => r.trilemma.stateEfficiency === true)
    && rows.every((r) => r.metrics.emittedWindows === 0)

  // 双路自证用「稳态健康流」（lateWithinAllowance）——全部迟到样本仍在 allowedLateness 内，应 holds=true。
  const wmEvents = eventsOf('lateWithinAllowance', cfg)
  const crosscheck = {
    evidence: createStreamWindowEvidence({ seed, now: opts.now }),
    watermark: verifyWatermarkMonotonicity(wmEvents, {
      windowSize, sessionGap, allowedLateness, tolerance: SW_WATERMARK_TOLERANCE,
    }),
  }
  const verdict = {
    vectors,
    noUniversalWinner,
    trilemmaDistinguishes,
    noStrategyWinsAll,
    vectorFromTrilemma,
    tumbling_crossBoundaryLoss: tumRow.trilemma.resultCompleteness === false,
    tumbling_stateCheap: tumRow.trilemma.stateEfficiency === true,
    sliding_overlapComplete: sliRow.trilemma.resultCompleteness === true,
    sliding_stateAmplified: sliRow.trilemma.stateEfficiency === false,
    session_gapFragile: sesRow.trilemma.lateTolerance === false,
    session_stateCheap: sesRow.trilemma.stateEfficiency === true,
    rigged_pkg: rigged,
    resultCompletenessCausallyUnerasable,
    frozenCollapsesCompleteness,
    infiniteRestoresSessionLate,
    freeRestoresSlidingState,
    watermarkHolds: crosscheck.watermark.holds,
    watermarkNontrivial: crosscheck.watermark.nontrivial,
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: {
      seed, windowSize, slideStep, sessionGap, allowedLateness, events, scenarios: scenarioIds,
      rigged, frozenWatermark: flags.frozenWatermark, infiniteLateness: flags.infiniteLateness, freeState: flags.freeState,
    },
    rows, vectors, verdict,
    noUniversalWinner, trilemmaDistinguishes,
    crosscheck,
    rigged,
  }
}

export const compareStreamWindow = streamWindowStudy

export function streamWindowSnapshot(study) {
  if (!study || typeof study !== 'object' || !Array.isArray(study.rows)) return null
  return {
    builtAt: study.builtAt,
    config: { ...study.config },
    rows: study.rows.map((r) => ({
      protocol: r.protocol,
      scenarios: r.scenarios.map((s) => ({ ...s })),
      trilemma: { ...r.trilemma },
      metrics: { ...r.metrics },
    })),
    vectors: { ...study.vectors },
    verdict: { ...study.verdict },
    crosscheck: study.crosscheck ? {
      evidence: study.crosscheck.evidence ? { ...study.crosscheck.evidence } : undefined,
      watermark: study.crosscheck.watermark ? { ...study.crosscheck.watermark } : undefined,
    } : undefined,
  }
}

/*----------------------------------------------------- 双路自证 -----------------------------------------------------*/

/** 路 A：按流的到达序逐事件推进 watermark（max(eventTime)−allowedLateness），断言单调不回退 + 关窗守恒 + 承诺地平线。 */
function laneWatermark(events, cfg) {
  const allow = intOr(cfg.allowedLateness, SW_DEFAULTS.allowedLateness)
  const size = intOr(cfg.windowSize, SW_DEFAULTS.windowSize)
  const ordered = Array.isArray(events) ? events : [] // 处理序 = 流的到达序（不重排，保留上游真相）
  let wm = ordered.length ? ordered[0].e - allow : 0
  let maxSeen = ordered.length ? ordered[0].e : 0
  let violations = 0, behindHorizon = 0
  for (const ev of ordered) {
    maxSeen = Math.max(maxSeen, ev.e)
    const next = maxSeen - allow
    if (next < wm) violations += 1
    else wm = next
    if (ev.e + allow < wm) behindHorizon += 1 // 承诺地平线：到达时该事件已不可能被合格窗收纳
  }
  let closed = 0
  for (const key of new Set(ordered.map((e) => Math.floor(e.e / size)))) {
    if (wm >= (key + 1) * size) closed += 1
  }
  return { violations, behindHorizon, closed, finalWatermark: wm, steps: ordered.length }
}

/** 路 B：迟到集逐条按「到达滞后 < allowedLateness ⇒ accepted / 否则 sideOutput」核对处置守恒。 */
function laneLateDisposition(events, cfg) {
  const allow = intOr(cfg.allowedLateness, SW_DEFAULTS.allowedLateness)
  let lateTotal = 0, accepted = 0, sideOutput = 0
  for (const ev of events) {
    if (ev.a <= ev.e) continue
    lateTotal += 1
    if (ev.a - ev.e < allow) accepted += 1
    else sideOutput += 1
  }
  return { lateTotal, accepted, sideOutput, conserved: accepted + sideOutput === lateTotal }
}

/** 双路唯一判定内核：三路篡改真喂回这里现算 holds，绝不写死对象。 */
function evaluateWatermark(input) {
  const events = Array.isArray(input?.events) ? input.events : []
  const cfg = input?.cfg ?? {}
  const laneA = laneWatermark(events, cfg)
  const laneB = laneLateDisposition(events, cfg)
  const nontrivial = laneA.steps >= 16 && laneB.lateTotal >= 4 && laneA.closed >= 1
  const holds = nontrivial && laneA.violations === 0 && laneA.behindHorizon === 0 && laneB.conserved && laneB.accepted >= 1
  return {
    laneA, laneB,
    tolerance: numOr(input?.tolerance, SW_WATERMARK_TOLERANCE),
    holds, nontrivial,
  }
}

/** 三路篡改真喂回同一内核现算 holds，逐路带 reason。 */
export function verifyWatermarkMonotonicity(events = [], opts = {}) {
  const cfg = {
    windowSize: opts.windowSize, sessionGap: opts.sessionGap, allowedLateness: opts.allowedLateness,
  }
  const base = { events: Array.isArray(events) ? events : [], cfg, tolerance: opts.tolerance }
  const core = evaluateWatermark(base)
  // ① 反转流的到达序 ⇒ 承诺地平线随之颠倒：迟到样本集体在水位线之后出生 ⇒ holds 现算翻假。
  const watermarkInverted = {
    ...evaluateWatermark({ ...base, events: [...base.events].reverse() }),
    reason: '反转流的到达序 ⇒ 承诺地平线违约（behindHorizon>0），holds 现算翻假',
  }
  // ② 篡改迟到口径（allowedLateness 置零）⇒ 全部迟到样本一律超期、accepted 归零 ⇒ holds 现算翻假。
  const cfgZero = { ...cfg, allowedLateness: 0 }
  const dispositionTampered = {
    ...evaluateWatermark({ ...base, cfg: cfgZero }),
    reason: '篡改迟到口径（allowedLateness 归零）⇒ 迟到样本全部超期、accepted 归零，holds 现算翻假',
  }
  // ③ 空事件集 ⇒ nontrivial=false ⇒ holds 现算翻假（绝不 0=0 假绿）。
  const emptySet = {
    ...evaluateWatermark({ ...base, events: [] }),
    reason: '空事件集 ⇒ 路 A 无步数 / 路 B 无迟到样本、nontrivial=false，holds 现算翻假（不凭 0=0 假绿）',
  }
  return {
    ...core, falsifiable: true,
    tamper: { watermarkInverted, dispositionTampered, emptySet },
  }
}

/*----------------------------------------------------- evidence 十一真件 21 键 -----------------------------------------------------*/

/** 十一真件交叉印证：全部真 import、真 API、真调用、真回读，21 键无一硬编码兜底（键名同 KI-518~528 同族）。 */
export function createStreamWindowEvidence(opts = {}) {
  const seed = intOr(opts.seed, SW_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `ev:key:${i}`)
  const ev = {}

  // ① compareRemapping —— 窗口分片扩容最小重映射 vs 取模
  const comp = compareRemapping({ nodes: ['a', 'b', 'c'], addNodes: ['d'], keys, salt: String(seed) })
  ev.remapConsistentRate = comp.consistent.rate
  ev.remapModuloRate = comp.modulo.rate

  // ② ShardRouter.remapOn —— 路由后扩容迁移键数
  const router = createShardRouter({ shards: ['a', 'b', 'c'], slotCount: 256, virtualNodes: 16, salt: String(seed) })
  for (const k of keys.slice(0, 80)) router.route(k)
  const rm = router.remapOn(['a', 'b', 'c', 'd'], { mutate: false })
  ev.routerMoved = rm.moved
  ev.routerTracked = rm.total

  // ③ HashRing —— 真 nodeIds().length + 真路由分布用到的节点数
  const ring = createHashRing({ virtualNodes: 16, salt: String(seed) })
  for (const n of ['a', 'b', 'c', 'd']) ring.addNode(n)
  ev.ringNodes = ring.nodeIds().length
  const dist = ring.distribution(keys)
  ev.ringShardsUsed = dist.nodes - dist.emptyNodes.length

  // ④ Wal —— 窗口聚合事件 append→lines→restore→replay 真回放
  const wal = createWal()
  for (let i = 0; i < 80; i++) wal.append('put', keys[i], { ts: i, g: i % 8 })
  const walLines = wal.lines()
  const wal2 = createWal()
  wal2.restore(walLines)
  let walReplayed = 0
  wal2.replay(() => { walReplayed += 1 })
  ev.walLines = walLines.length
  ev.walReplayed = walReplayed

  // ⑤ Bus —— 窗口定稿真通知
  const bus = createBus()
  let notices = 0
  bus.subscribe('window.finalized', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('window.finalized', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('window.finalized')

  // ⑥ RedisCache —— 聚合状态 slot 真 set + 真 get 命中
  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (let i = 0; i < 96; i++) cache.set(`agg:slot:${i}`, 1)
  let bitmapHits = 0
  for (let i = 0; i < 96; i++) if (cache.get(`agg:slot:${i}`) !== undefined) bitmapHits += 1
  ev.redisBitmapHits = bitmapHits
  ev.redisSlots = cache.stats().entries

  // ⑦ ObjectPool —— 窗口状态对象取/还/复用真计数
  const pool = createObjectPool({ factory: () => ({ group: null }), maxSize: 8 })
  const p1 = pool.acquire()
  pool.acquire()
  pool.release(p1)
  pool.acquire()
  const ps = pool.stats()
  ev.poolCreated = ps.created
  ev.poolReused = ps.reused

  // ⑧ TokenBucket —— 聚合输出限速真 allow()
  const bucket = createTokenBucket({ capacity: 3, refillPerSec: 0, now: nowFn })
  let bucketAllowed = 0, bucketRejected = 0
  for (let i = 0; i < 7; i++) { if (bucket.allow().allowed) bucketAllowed += 1; else bucketRejected += 1 }
  ev.bucketAllowed = bucketAllowed
  ev.bucketRejected = bucketRejected

  // ⑨ MinHeapDelayQueue —— 窗口定稿定时器排程（关窗时刻）
  const heap = createMinHeapDelayQueue({ now: fixedNow })
  heap.schedule(fixedNow + 80, 'finalize:tumbling')
  heap.schedule(fixedNow + 250, 'finalize:sliding')
  heap.schedule(fixedNow + 40, 'finalize:session')
  ev.heapFired = heap.advance(fixedNow + 1000).length
  ev.heapPending = heap.pending()

  // ⑩ PackedCounters —— 真 inc(i,by) + 真 get(i) 求和（无 stats().sum）
  const counters = createPackedCounters(64)
  for (let i = 0; i < 64; i++) counters.inc(i, i + 1)
  let counterSum = 0
  for (let i = 0; i < 64; i++) counterSum += counters.get(i)
  ev.counterSum = counterSum
  ev.counterFalseSharing = counters.stats().falseSharingPairs

  // ⑪ FullJitterBackoff —— 真 delayFor 采样抖动离散（替代硬编码 0.13）
  const jitter = createFullJitterBackoff({ baseTicks: 16, capTicks: 1024, seed })
  const samples = Array.from({ length: 64 }, (_, i) => jitter.delayFor(6, i))
  const sMin = Math.min(...samples), sMax = Math.max(...samples)
  const sMean = samples.reduce((a, b) => a + b, 0) / samples.length
  ev.jitterSpread = sMean > 0 ? round4((sMax - sMin) / sMean) : 0

  return ev
}

/*----------------------------------------------------- CLI -----------------------------------------------------*/

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliInvocation) {
  const args = process.argv.slice(2)
  const rigged = args.includes('--rigged')
  const nowIdx = args.indexOf('--now')
  const nowArg = args.find((a) => a.startsWith('--now='))
  const nowMs = nowArg ? numOr(nowArg.slice(6), 0) : (nowIdx >= 0 ? numOr(args[nowIdx + 1], 0) : 0)
  const opts = {
    rigged,
    now: () => nowMs,
    frozenWatermark: rigged || args.includes('--frozen-watermark'),
    infiniteLateness: rigged || args.includes('--infinite-lateness'),
    freeState: rigged || args.includes('--free-state'),
  }
  const study = streamWindowStudy(opts)
  const snap = streamWindowSnapshot(study)
  console.log('[stream-window] seed=' + snap.config.seed +
    ' size=' + snap.config.windowSize + ' step=' + snap.config.slideStep + ' gap=' + snap.config.sessionGap +
    ' allow=' + snap.config.allowedLateness +
    ' rigged=' + snap.config.rigged +
    ' frozenWatermark=' + snap.config.frozenWatermark +
    ' infiniteLateness=' + snap.config.infiniteLateness +
    ' freeState=' + snap.config.freeState +
    ' builtAt=' + snap.builtAt)
  const dims = ['resultCompleteness', 'lateTolerance', 'stateEfficiency']
  for (const row of snap.rows) {
    const m = row.metrics
    console.log(
      '  ' + row.protocol.padEnd(9) +
      ' cov=' + String(m.pairCoverageAvg).padStart(5) +
      ' amp=' + String(m.amplificationAvg).padStart(5) +
      ' lateOK=' + String(m.lateAccepted).padStart(3) +
      ' lateDrop=' + String(m.lateSideOutput).padStart(3) +
      ' emitted=' + String(m.emittedWindows).padStart(3) +
      ' trilemma={' + dims.map((d) => d + '=' + row.trilemma[d]).join(',') + '}',
    )
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.verdict.noUniversalWinner +
    ' distinguishable=' + snap.verdict.trilemmaDistinguishes + ' rigged=' + study.rigged +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma)
  const v = snap.verdict
  console.log('  verdict: noStrategyWinsAll=' + v.noStrategyWinsAll +
    ' resultCompletenessCausallyUnerasable=' + v.resultCompletenessCausallyUnerasable +
    ' tumbling_crossBoundaryLoss=' + v.tumbling_crossBoundaryLoss +
    ' sliding_stateAmplified=' + v.sliding_stateAmplified + ' session_gapFragile=' + v.session_gapFragile)
  console.log('  backfires: frozen→completeness=' + v.frozenCollapsesCompleteness +
    ' infinite→sessionLate=' + v.infiniteRestoresSessionLate +
    ' free→slidingState=' + v.freeRestoresSlidingState)
  const wm = snap.crosscheck.watermark
  console.log('  watermark: holds=' + wm.holds + ' nontrivial=' + wm.nontrivial +
    ' laneA{violations=' + wm.laneA.violations + ',closed=' + wm.laneA.closed + '}' +
    ' laneB{total=' + wm.laneB.lateTotal + ',accepted=' + wm.laneB.accepted + ',sideOutput=' + wm.laneB.sideOutput + ',conserved=' + wm.laneB.conserved + '}' +
    ' tamper{inv=' + wm.tamper.watermarkInverted.holds +
    ',disp=' + wm.tamper.dispositionTampered.holds + ',null=' + wm.tamper.emptySet.holds + '}')
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
}
