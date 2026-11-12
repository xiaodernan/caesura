/**
 * scripts/caesura-trace-sampling.mjs —— 可观测性分布式追踪采样三策略诚实权衡教学件（KI-533，P8 第四十件）。
 *
 * <p>把 OpenTelemetry / Spring Cloud Sleuth / Micrometer Tracing 的「到底采哪些 span、丢哪些 trace、
 * 突发流量怎么调率」精准搬到 Node.js 侧，三组零依赖确定性纯 JS 教学状态机：</p>
 *
 * <ul>
 *   <li><b>HeadBasedSampler</b>：root span 一到达即 O(1) 哈希决策，整条 trace 全采或全丢、trace flags 向
 *       下游传播；零 span 缓冲、采样率固定不反馈。<b>决策时点早于 error 发生</b> ⇒ 含 error 的 trace 会被
 *       哈希盲丢（anomalyCapture=false）；不缓冲 ⇒ lowOverhead=true；率固定 ⇒ loadAdaptive=false ⇒ 向量 <b>100</b>。</li>
 *   <li><b>TailBasedSampler</b>：缓冲整条 trace 的所有 span 直到 trace 结束，再按「有 error span ⇒ 必留，
 *       否则按率」整体决策。<b>看完才决策</b> ⇒ 确定性 100% 留 error trace（anomalyCapture=true）；但缓冲整条
 *       ⇒ lowOverhead=false；率固定 ⇒ loadAdaptive=false ⇒ 向量 <b>010</b>。</li>
 *   <li><b>AdaptiveSampler</b>：仍在头部 O(1) 哈希决策（只滑动窗口计数、不缓冲 span），按已过窗口的
 *       负载/错误率反馈环动态调采样率。零 span 缓冲 ⇒ lowOverhead=true；突发下真调率 ⇒ loadAdaptive=true；
 *       但决策依旧<b>不读单条 trace 的 error</b> ⇒ anomalyCapture=false ⇒ 向量 <b>101</b>。</li>
 * </ul>
 *
 * <p><b>三难维序固定 [lowOverhead / anomalyCapture / loadAdaptive]</b>，三位全部真跑现算、不查协议名表：
 * `lowOverhead` ⇔ `peakBufferedSpans===0`；`anomalyCapture` ⇔ 含 error 流上 `errorTracesRetained===errorTracesTotal`；
 * `loadAdaptive` ⇔ 突发场景 `rateChanges>0`。默认向量 **HeadBased=100 / TailBased=010 / Adaptive=101**，
 * 三向量互异、无一 111、不封赢家。<b>核心因果结构</b>：`anomalyCapture ⇔ 缓冲整条 ⇔ ¬lowOverhead`
 * ——要确定性留异常必须看完 trace，必牺牲低开销，与 KI-532 的 chk 权衡同构、真跑现算零查表。</p>
 *
 * <p><b>为什么不用草案的 traceCompleteness 维</b>：trace-level 采样三策略在「被保留 trace 的 span 完整性」
 * 上天然全真（都是整条决策、无半采断链），该维恒真会退化、无区分度。按可真跑现算的区分度改为
 * 低开销 / 异常保真 / 负载自适应——同 KI-531 因 add-wins 撞向量而改维序的诚实修正。</p>
 *
 * <p><b>verifySamplingSoundness 双路独立交叉印证 + 三路可证伪（真喂回同一内核现算）</b>：路 A 在无 error
 * 干净流真跑 TailBased，验「缓冲守恒（spansIn=spansKept+spansDropped）且 span 无重复」；路 B 在含 error 流
 * 真跑，用四个**观测量**判定「ground-truth error trace 全保留 ∧ span 无重复 ∧ span 完整无断链 ∧ 正常 trace
 * 按率筛（非全留非全丢）」；空 traces `nontrivial=false`。三路篡改**真改变内核输入/行为、再用同一个 holds
 * 公式现算翻 false**：① forgedErrorSpan 真把「哈希最大、本靠 hasError 才留」的 error trace 篡改漏判 ⇒ 被哈希
 * 丢 ⇒ errorAllRetained 翻 false；② duplicateRelease 真重复释放一条 kept trace ⇒ noDuplicateSpans 翻 false；
 * ③ emptyTraceSet 空 traces ⇒ nontrivial 翻 false 且 normalByRate 翻 false（绝不 0=0 假绿）。</p>
 *
 * <p><b>三条因果结构锁</b>（真喂回内核现算、与 rigged 输入无关、在同一含 error raw 流上验）：
 * `anomalyRequiresBufferingCausallyUnerasable`（真跑穷举：不缓冲者无选择性保异常，唯一靠 rate=1.0 全留是
 * 「放弃采样」的退化态）、`headBlindnessCausallyUnerasable`（构造翻转 hasError 标签的平行流真跑两遍、逐 id
 * 比对决策恒同 ⇒ 决策只吃哈希不读 error，零统计噪声、与样本量无关、可证伪；绝不用「保留率差 < 阈值」那种
 * 哈希抽样统计量当结构锁——大小样本都会假红）、`adaptiveLagCannotGuaranteeAnomalyCausallyUnerasable`
 * （完美反馈版 Adaptive 在 errorBurst 当前窗口仍丢 error trace——反馈基于已过窗口，滞后客观存在）。
 * `causalLocksAllHold=true`。</p>
 *
 * <p><b>诚实 rigged 标定</b>：三开关 `oracleHead`（头部能预知单条 error，现实中不可能）/ `infiniteBuffer`
 * （缓冲零成本）/ `perfectFeedback`（负载预测完美、反馈零滞后）各自是**分策略反事实探针**，不是全局真理：
 * ① oracleHead 只给纯 HeadBased ⇒ 补 anomaly 维 `100→110`；② infiniteBuffer 只给 TailBased ⇒ 补 lowOverhead 维
 * `010→110`；③ perfectFeedback 只给 Adaptive ⇒ 降低 errorBurst 丢失**质量**、但因 `maxRate=0.75` 封顶
 * （仍留 25% 误差流被哈希丢）补不上 anomaly 维 ⇒ 恒 `101`。全开收敛 `110/110/101`，Head≡Tail 区分度
 * 诚实塌缩（`riggedConvergenceCollapsed=true`），无一 111（`noStrategyWinsAll=true`），三锁在同一含 error
 * raw 流上仍 allHold。教学结论：<b>给头部采样单条预知 ⇔ 给尾部采样免费缓冲</b>，二者殊途同归到「既省又全」
 * 却仍拿不到负载自适应；而 Adaptive 即使负载预测完美，也补不上「决策早于 error 发生」的信息时序软肋。</p>
 *
 * <p><b>不声称</b>真 OpenTelemetry SDK / 真 Micrometer Tracer / 真墙钟 QPS 与采样性能；全程结构计数、
 * 不声称生产级采样器，默认 `traceSampling:false` 非破坏。</p>
 *
 * @module caesura-trace-sampling
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

export const TRACE_DEFAULTS = Object.freeze({
  seed: 533,
  items: 64,
  rate: 0.5,
  minRate: 0.25,
  maxRate: 0.75,
  windowSize: 16,
  oracleHead: false,
  infiniteBuffer: false,
  perfectFeedback: false,
  rigged: false,
})

export const TRACE_STRATEGIES = Object.freeze(['HeadBasedSampler', 'TailBasedSampler', 'AdaptiveSampler'])
export const TRACE_SCENARIOS = Object.freeze(['steadyLoad', 'errorBurst', 'spikeLoad', 'bufferPressure', 'coldStart', 'cleanRerun'])
export const TRACE_DIMS = Object.freeze(['lowOverhead', 'anomalyCapture', 'loadAdaptive'])

const ANOMALY_SCENARIOS = Object.freeze(['steadyLoad', 'errorBurst', 'coldStart', 'bufferPressure'])
const OVERHEAD_SCENARIOS = Object.freeze(['bufferPressure', 'spikeLoad'])
const ADAPTIVE_SCENARIOS = Object.freeze(['spikeLoad', 'errorBurst', 'coldStart', 'bufferPressure'])

const intOr = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : fallback }
const numOr = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback }
const clamp01 = (n) => Math.max(0, Math.min(1, n))
const round4 = (n) => Math.round(n * 1e4) / 1e4
function startClock(v, fallback) { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }

/** 稳定 0..1 哈希：只吃 trace.id 与 seed，不受遍历顺序影响，保证确定性可复现。 */
function hash01(id, seed) {
  let h = (Number(id) ^ (seed | 0)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h / 4294967296
}

/*----------------------------------------------------- 场景 / trace 流 -----------------------------------------------------*/

/** 每条 trace = { id, loadFactor, spans, hasError, errorSpans }；span = { id, traceId, service, isError, durationMs }。 */
function makeTrace(idx, seed, spanCount, withError, loadFactor) {
  const spans = Array.from({ length: spanCount }, (_, s) => ({
    id: `${idx}:${s}`,
    traceId: idx,
    service: ['gateway', 'cart', 'pricing', 'inventory'][(idx + s) % 4],
    isError: withError && s === Math.floor(spanCount / 2),
    durationMs: 4 + ((idx * 7 + s * 13 + seed) % 40),
  }))
  return {
    id: idx,
    loadFactor,
    spans,
    hasError: spans.some((sp) => sp.isError),
    errorSpans: spans.filter((sp) => sp.isError).length,
  }
}

/**
 * 六场景正交 trace 流：
 * steadyLoad（稳定低错误）/ errorBurst（中段连续 error 突发）/ spikeLoad（trace 数×3 负载突增）/
 * bufferPressure（大 trace 多 span 压缓冲）/ coldStart（前段 error 密集验反馈冷启动）/ cleanRerun（确定性重跑）。
 */
export function traceStreamOf(id, opts = {}) {
  const seed = intOr(opts.seed, TRACE_DEFAULTS.seed)
  const n = Math.max(16, intOr(opts.items, TRACE_DEFAULTS.items))
  const spanFor = (i) => 3 + ((i * 5 + seed) % 4)
  switch (id) {
    case 'steadyLoad':
      return Array.from({ length: n }, (_, i) => makeTrace(i, seed, spanFor(i), i % 17 === 9, 1.0))
    case 'errorBurst':
      return Array.from({ length: n }, (_, i) => makeTrace(i, seed, spanFor(i), i >= Math.floor(n * 0.4) && i < Math.floor(n * 0.7), 1.0))
    case 'spikeLoad':
      return Array.from({ length: n * 3 }, (_, i) => makeTrace(i, seed, spanFor(i), i % 23 === 11, 2.6))
    case 'bufferPressure':
      return Array.from({ length: n }, (_, i) => makeTrace(i, seed, 12 + ((i * 3) % 13), i % 19 === 7, 1.8))
    case 'coldStart':
      return Array.from({ length: n }, (_, i) => makeTrace(i, seed, spanFor(i), i < Math.floor(n * 0.3), 1.2))
    case 'cleanRerun':
      return Array.from({ length: n }, (_, i) => makeTrace(i, seed, spanFor(i), i % 17 === 9, 1.0))
    default:
      return Array.from({ length: 16 }, (_, i) => makeTrace(i, seed, 4, i % 7 === 3, 1.0))
  }
}

/*----------------------------------------------------- 三真采样实现 -----------------------------------------------------*/

function blankStats(rate) {
  return {
    rate,
    rateChanges: 0,
    peakBufferedSpans: 0,
    errorTracesTotal: 0,
    errorTracesRetained: 0,
    normalTracesTotal: 0,
    normalTracesRetained: 0,
    spansIn: 0,
    spansKept: 0,
    spansDropped: 0,
    tracesTotal: 0,
    tracesKept: 0,
  }
}

function tally(stats, trace, keep) {
  stats.tracesTotal += 1
  stats.spansIn += trace.spans.length
  if (trace.hasError) {
    stats.errorTracesTotal += 1
    if (keep) stats.errorTracesRetained += 1
  } else {
    stats.normalTracesTotal += 1
    if (keep) stats.normalTracesRetained += 1
  }
  if (keep) { stats.tracesKept += 1; stats.spansKept += trace.spans.length } else stats.spansDropped += trace.spans.length
}

/** 头部 O(1) 决策：root 即按哈希定整条 trace 命运；零 span 缓冲、率固定。oracleHead 是 rigged 单条预知。 */
export function createHeadBasedSampler(opts = {}) {
  const seed = intOr(opts.seed, TRACE_DEFAULTS.seed)
  const baseRate = clamp01(numOr(opts.rate, TRACE_DEFAULTS.rate))
  const oracleHead = opts.oracleHead === true
  const stats = blankStats(baseRate)
  function run(traces) {
    const kept = [], dropped = []
    Object.assign(stats, blankStats(baseRate))
    for (const t of traces) {
      const keep = (oracleHead && t.hasError) ? true : (hash01(t.id, seed) < baseRate)
      tally(stats, t, keep)
      ;(keep ? kept : dropped).push(t)
    }
    return { kept, dropped, stats: { ...stats } }
  }
  return { protocol: 'HeadBasedSampler', run, stats: () => ({ ...stats }), oracleHead: () => oracleHead }
}

/**
 * 尾部采样：逐 span 进缓冲，trace 结束后整体决策；有 error span ⇒ 必留，否则按率。
 * infiniteBuffer（rigged）令 peakBufferedSpans 观测量记 0（"缓冲免费"），但缓冲行为本身不变。
 */
export function createTailBasedSampler(opts = {}) {
  const seed = intOr(opts.seed, TRACE_DEFAULTS.seed)
  const baseRate = clamp01(numOr(opts.rate, TRACE_DEFAULTS.rate))
  const infiniteBuffer = opts.infiniteBuffer === true
  const stats = blankStats(baseRate)
  function run(traces) {
    const kept = [], dropped = []
    Object.assign(stats, blankStats(baseRate))
    let buffered = 0
    for (const t of traces) {
      for (const sp of t.spans) { buffered += 1; void sp }
      stats.peakBufferedSpans = Math.max(stats.peakBufferedSpans, buffered)
      const keep = t.hasError ? true : (hash01(t.id, seed) < baseRate)
      buffered -= t.spans.length
      tally(stats, t, keep)
      ;(keep ? kept : dropped).push(t)
    }
    if (infiniteBuffer) stats.peakBufferedSpans = 0 // 反事实：内存/延迟预算无限，缓冲不计开销
    return { kept, dropped, stats: { ...stats } }
  }
  return { protocol: 'TailBasedSampler', run, stats: () => ({ ...stats }), infiniteBuffer: () => infiniteBuffer }
}

/**
 * 自适应采样：头部 O(1) 决策（只维护滑动窗口计数、不缓冲 span），按已过窗口的负载/错误率反馈调率。
 * perfectFeedback（rigged）：窗口开始时用「本窗口真值」预调（零滞后+预测完美），基线只能在窗口末用已过统计滞后调；
 * 但 maxRate 封顶（默认 0.75）⇒ 突发 error 流仍有 1-maxRate 被哈希丢，anomaly 维补不上，只改善丢失质量。
 */
export function createAdaptiveSampler(opts = {}) {
  const seed = intOr(opts.seed, TRACE_DEFAULTS.seed)
  const baseRate = clamp01(numOr(opts.rate, TRACE_DEFAULTS.rate))
  const minRate = clamp01(numOr(opts.minRate, TRACE_DEFAULTS.minRate))
  const maxRate = clamp01(numOr(opts.maxRate, TRACE_DEFAULTS.maxRate))
  const windowSize = Math.max(4, intOr(opts.windowSize, TRACE_DEFAULTS.windowSize))
  const perfectFeedback = opts.perfectFeedback === true
  const stats = blankStats(baseRate)
  function adjust(curRate, avgLoad, errorRatio, advance) {
    let next = curRate
    if (avgLoad > 1.4) next = Math.max(minRate, curRate - (perfectFeedback ? 0.2 : 0.1))
    else if (errorRatio > 0.3) next = Math.min(maxRate, curRate + (perfectFeedback ? 0.2 : 0.05))
    else if (avgLoad < 0.8) next = Math.min(maxRate, curRate + 0.05)
    if (next !== curRate) stats.rateChanges += 1
    return advance ? next : curRate // 基线：本窗口仍用旧率（滞后）；perfectFeedback：提前用新率
  }
  function run(traces) {
    const kept = [], dropped = []
    Object.assign(stats, blankStats(baseRate))
    let curRate = baseRate
    let wCount = 0, wErrors = 0, wLoad = 0
    for (let i = 0; i < traces.length; i++) {
      const t = traces[i]
      // 窗口切换：用上一窗口统计调率（perfectFeedback 用本窗口真值提前调）
      if (wCount > 0 && wCount % windowSize === 0) {
        const avgLoad = wLoad / wCount
        const errorRatio = wErrors / wCount
        curRate = adjust(curRate, avgLoad, errorRatio, perfectFeedback)
        wCount = 0; wErrors = 0; wLoad = 0
      }
      if (perfectFeedback && wCount === 0) {
        // 零滞后：窗口开始即用本窗口真值预调（现状工程做不到，rigged 反事实）
        const upcoming = traces.slice(i, i + windowSize)
        const avgLoad = upcoming.reduce((a, x) => a + x.loadFactor, 0) / Math.max(1, upcoming.length)
        const errorRatio = upcoming.filter((x) => x.hasError).length / Math.max(1, upcoming.length)
        curRate = adjust(curRate, avgLoad, errorRatio, true)
      }
      const keep = hash01(t.id, seed) < curRate // 头部盲：不读单条 t.hasError
      tally(stats, t, keep)
      ;(keep ? kept : dropped).push(t)
      wCount += 1; wLoad += t.loadFactor; if (t.hasError) wErrors += 1
    }
    stats.rate = round4(curRate)
    return { kept, dropped, stats: { ...stats } }
  }
  return { protocol: 'AdaptiveSampler', run, stats: () => ({ ...stats }), perfectFeedback: () => perfectFeedback }
}

export function createSampler(protocol, opts = {}) {
  if (protocol === 'HeadBasedSampler') return createHeadBasedSampler(opts)
  if (protocol === 'TailBasedSampler') return createTailBasedSampler(opts)
  if (protocol === 'AdaptiveSampler') return createAdaptiveSampler(opts)
  throw new Error(`未知采样策略：${protocol}`)
}

/*----------------------------------------------------- 矩阵 + 三难现算（全真跑、不查表）-----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.lowOverhead)}${Number(t.anomalyCapture)}${Number(t.loadAdaptive)}` }

function runFlaggedRow(protocol, cfg, flags, scenarioIds) {
  const cells = scenarioIds.map((sc) => {
    const sampler = createSampler(protocol, { ...cfg, oracleHead: flags.oracleHead && protocol === 'HeadBasedSampler', infiniteBuffer: flags.infiniteBuffer && protocol === 'TailBasedSampler', perfectFeedback: flags.perfectFeedback && protocol === 'AdaptiveSampler' })
    const stream = traceStreamOf(sc, cfg)
    const { stats } = sampler.run(stream)
    const c = {
      id: sc,
      ...stats,
      // 逐格三布尔：用本格真观测量现算（非查表、非写死），供前端矩阵状态字与 mesh ladder 逐格显示；
      // 与 row.trilemma 的跨场景聚合判定同源但语义更局部（cell=单场景读数，trilemma=考场聚合判定）。
      lowOverhead: stats.peakBufferedSpans === 0,
      anomalyCapture: stats.errorTracesTotal > 0 ? stats.errorTracesRetained === stats.errorTracesTotal : true,
      loadAdaptive: stats.rateChanges > 0,
      errorRetainedRate: stats.errorTracesTotal ? round4(stats.errorTracesRetained / stats.errorTracesTotal) : 1,
      normalRetainedRate: stats.normalTracesTotal ? round4(stats.normalTracesRetained / stats.normalTracesTotal) : 1,
      fault: faultOf(sc),
      inAnomalyExam: ANOMALY_SCENARIOS.includes(sc),
      inOverheadExam: OVERHEAD_SCENARIOS.includes(sc),
      inAdaptiveExam: ADAPTIVE_SCENARIOS.includes(sc),
    }
    return c
  })
  // 三位全部从真观测量现算，不查协议名表
  const peakBuf = Math.max(0, ...cells.map((c) => c.peakBufferedSpans))
  const anomalyCells = cells.filter((c) => c.inAnomalyExam && c.errorTracesTotal > 0)
  const lowOverhead = peakBuf === 0
  const anomalyCapture = anomalyCells.length > 0 && anomalyCells.every((c) => c.errorTracesRetained === c.errorTracesTotal)
  const loadAdaptive = cells.some((c) => c.rateChanges > 0)
  const trilemma = { lowOverhead, anomalyCapture, loadAdaptive }
  const metrics = {
    peakBufferedSpans: peakBuf,
    errorTracesTotal: cells.reduce((a, c) => a + c.errorTracesTotal, 0),
    errorTracesRetained: cells.reduce((a, c) => a + c.errorTracesRetained, 0),
    errorTracesLost: cells.reduce((a, c) => a + c.errorTracesTotal - c.errorTracesRetained, 0),
    spansIn: cells.reduce((a, c) => a + c.spansIn, 0),
    spansKept: cells.reduce((a, c) => a + c.spansKept, 0),
    rateChanges: cells.reduce((a, c) => a + c.rateChanges, 0),
  }
  return { cells, trilemma, metrics, debug: {} }
}

function faultOf(scenarioId) {
  return scenarioId === 'errorBurst' ? 'error-burst'
    : scenarioId === 'spikeLoad' ? 'load-spike'
    : scenarioId === 'bufferPressure' ? 'buffer-pressure'
    : scenarioId === 'coldStart' ? 'cold-start'
    : scenarioId === 'cleanRerun' ? 'rerun-idempotent'
    : 'happy-path'
}

function runMatrix(cfg, flags, scenarioIds) {
  return TRACE_STRATEGIES.map((p) => {
    const { cells, trilemma, metrics } = runFlaggedRow(p, cfg, flags, scenarioIds)
    return { protocol: p, scenarios: cells, trilemma, metrics }
  })
}

/*----------------------------------------------------- 三条因果结构锁（真喂回内核现算、与 rigged 输入无关）-----------------------------------------------------*/

/**
 * 在同一含 error raw 流上真跑三采样器，钉死三条「任何 rigged 开关都救不了」的结构属性。
 * 这里故意不看 flags —— 因果锁针对信息时序结构，与是否开预言机/免费缓冲/完美反馈的输入前提无关。
 */
export function verifyCausalLocks(cfg) {
  // 因果锁验的是「头部决策不读 error」这一**结构属性**；保留率差是哈希抽样统计量，小样本会假红。
  // 故锁内部用足够大的样本下限现算，与调用方 items 解耦（"与规模无关"的诚实含义），不靠放宽阈值。
  const lockItems = Math.max(96, intOr(cfg.items, TRACE_DEFAULTS.items))
  const raw = traceStreamOf('errorBurst', { ...cfg, items: lockItems })
  const burst = traceStreamOf('errorBurst', { ...cfg, items: Math.max(128, lockItems) })
  const seed = cfg.seed

  // 锁 1：不缓冲者无「选择性」保异常——穷举 rate 档，凡 peakBuf=0 必丢 error；唯一全留是 rate=1.0 全采退化态
  const rates = [0.1, 0.25, 0.5, 0.75, 0.9]
  const headByRate = rates.map((rate) => {
    const s = createHeadBasedSampler({ seed, rate }).run(raw).stats
    return { rate, lost: s.errorTracesTotal - s.errorTracesRetained, peak: s.peakBufferedSpans }
  })
  const adaptiveStats = createAdaptiveSampler({ ...cfg, rate: 0.5 }).run(burst).stats
  const tailStats = createTailBasedSampler({ seed, rate: 0.5 }).run(raw).stats
  const fullCapture = createHeadBasedSampler({ seed, rate: 1.0 }).run(raw).stats
  const anomalyRequiresBufferingCausallyUnerasable =
    headByRate.every((x) => x.peak === 0 && x.lost > 0) &&
    adaptiveStats.peakBufferedSpans === 0 && adaptiveStats.errorTracesRetained < adaptiveStats.errorTracesTotal &&
    tailStats.peakBufferedSpans > 0 && tailStats.errorTracesRetained === tailStats.errorTracesTotal &&
    // rate=1.0 全留是「放弃采样」退化态：正常 trace 也 100% 留，不构成选择性保异常
    fullCapture.errorTracesRetained === fullCapture.errorTracesTotal && fullCapture.normalTracesRetained === fullCapture.normalTracesTotal

  // 锁 2：头部盲——同一 id 无论 hasError 真假，决策恒同（决策只吃哈希、完全不读 error）。
  // 用「翻转 error 标签的平行流」真跑两遍逐 id 比对：零统计噪声、可证伪（任何偷读 error 的实现必破）、
  // 与样本量完全无关。绝不再拿「error/normal 保留率差 < 阈值」当结构锁——那是哈希抽样统计量，
  // 大小样本都会假红（error id 集中区间的分布偏差），只能作诚实展示读数。
  const probe = raw.map((t) => ({ ...t }))
  const flipped = raw.map((t) => ({
    ...t,
    hasError: !t.hasError,
    spans: t.spans.map((sp) => ({ ...sp, isError: !sp.isError })),
  }))
  const decisionInvariant = rates.every((rate) => {
    const a = createHeadBasedSampler({ seed, rate }).run(probe).kept.map((t) => t.id).join(',')
    const b = createHeadBasedSampler({ seed, rate }).run(flipped).kept.map((t) => t.id).join(',')
    return a === b
  })
  // 辅助读数：保留率随 rate 单调升、rate<1 必丢 error（唯一多留 error 的办法是整体调率，无选择性）
  const sweep = rates.map((rate) => {
    const s = createHeadBasedSampler({ seed, rate }).run(raw).stats
    return {
      rate,
      errorRate: s.errorTracesTotal ? s.errorTracesRetained / s.errorTracesTotal : 1,
      normalRate: s.normalTracesTotal ? s.normalTracesRetained / s.normalTracesTotal : 1,
    }
  })
  const maxBlindnessGap = round4(Math.max(...sweep.map((x) => Math.abs(x.errorRate - x.normalRate))))
  const monotonic = sweep.every((x, i) => i === 0 || x.errorRate >= sweep[i - 1].errorRate - 1e-9)
  const headBlindnessCausallyUnerasable = decisionInvariant && monotonic && sweep.some((x) => x.errorRate < 1)

  // 锁 3：完美反馈也救不了突发当前窗口——滞后客观存在，errorBurst 上仍丢 error trace
  const adaptivePerfect = createAdaptiveSampler({ ...cfg, rate: 0.5, perfectFeedback: true }).run(burst).stats
  const adaptiveBase = createAdaptiveSampler({ ...cfg, rate: 0.5, perfectFeedback: false }).run(burst).stats
  const adaptiveLagCannotGuaranteeAnomalyCausallyUnerasable =
    adaptivePerfect.rateChanges > 0 &&
    adaptivePerfect.errorTracesRetained < adaptivePerfect.errorTracesTotal &&
    // 完美反馈只降低丢失数量（质量），绝不归零、绝不反超到全留
    adaptivePerfect.errorTracesRetained >= adaptiveBase.errorTracesRetained &&
    adaptivePerfect.errorTracesRetained < adaptivePerfect.errorTracesTotal

  const causalLocksAllHold =
    anomalyRequiresBufferingCausallyUnerasable &&
    headBlindnessCausallyUnerasable &&
    adaptiveLagCannotGuaranteeAnomalyCausallyUnerasable
  return {
    anomalyRequiresBufferingCausallyUnerasable,
    headBlindnessCausallyUnerasable,
    adaptiveLagCannotGuaranteeAnomalyCausallyUnerasable,
    causalLocksAllHold,
    decisionInvariant,
    maxBlindnessGap,
    rateSweep: sweep.map((x) => ({ rate: x.rate, errorRate: round4(x.errorRate), normalRate: round4(x.normalRate) })),
    adaptivePerfectLost: adaptivePerfect.errorTracesTotal - adaptivePerfect.errorTracesRetained,
    adaptiveBaseLost: adaptiveBase.errorTracesTotal - adaptiveBase.errorTracesRetained,
  }
}

/*----------------------------------------------------- study -----------------------------------------------------*/

export function traceSamplingStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? [...opts.scenarios] : [...TRACE_SCENARIOS]
  const cfg = {
    seed: intOr(opts.seed, TRACE_DEFAULTS.seed),
    items: Math.max(16, intOr(opts.items, TRACE_DEFAULTS.items)),
    rate: clamp01(numOr(opts.rate, TRACE_DEFAULTS.rate)),
    minRate: clamp01(numOr(opts.minRate, TRACE_DEFAULTS.minRate)),
    maxRate: clamp01(numOr(opts.maxRate, TRACE_DEFAULTS.maxRate)),
    windowSize: Math.max(4, intOr(opts.windowSize, TRACE_DEFAULTS.windowSize)),
  }
  const oracleHead = opts.oracleHead === true
  const infiniteBuffer = opts.infiniteBuffer === true
  const perfectFeedback = opts.perfectFeedback === true
  const rigged = opts.rigged === true || (oracleHead && infiniteBuffer && perfectFeedback)
  const flags = {
    rigged,
    oracleHead: rigged || oracleHead,
    infiniteBuffer: rigged || infiniteBuffer,
    perfectFeedback: rigged || perfectFeedback,
  }

  const rows = runMatrix(cfg, flags, scenarioIds)
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const values = Object.values(vectors)
  const distinct = new Set(values).size === rows.length
  const noStrategyWinsAll = !values.some((v) => v === '111')
  const noUniversalWinner = distinct && noStrategyWinsAll
  const trilemmaDistinguishes = distinct
  const vectorFromTrilemma = rows.every((r) => vectors[r.protocol] === vectorOf(r.trilemma))
  const riggedConvergenceCollapsed = !distinct   // rigged 下 Head≡Tail=110，诚实标注

  // 单开反噬：恒以「无开关纯净基线」作对照（因果锁另在同一 raw 流现算，不靠这里）
  const baseRows = runMatrix(cfg, { oracleHead: false, infiniteBuffer: false, perfectFeedback: false, rigged: false }, scenarioIds)
  const baseHead = baseRows.find((r) => r.protocol === 'HeadBasedSampler')
  const baseTail = baseRows.find((r) => r.protocol === 'TailBasedSampler')
  const baseAdaptive = baseRows.find((r) => r.protocol === 'AdaptiveSampler')
  const mOracle = runMatrix(cfg, { oracleHead: true, infiniteBuffer: false, perfectFeedback: false, rigged: false }, scenarioIds)
  const mBuffer = runMatrix(cfg, { oracleHead: false, infiniteBuffer: true, perfectFeedback: false, rigged: false }, scenarioIds)
  const mFeedback = runMatrix(cfg, { oracleHead: false, infiniteBuffer: false, perfectFeedback: true, rigged: false }, scenarioIds)
  const oracleHeadErasesHeadBlindness =
    mOracle.find((r) => r.protocol === 'HeadBasedSampler').trilemma.anomalyCapture === true && baseHead.trilemma.anomalyCapture === false
  const infiniteBufferErasesOverhead =
    mBuffer.find((r) => r.protocol === 'TailBasedSampler').trilemma.lowOverhead === true && baseTail.trilemma.lowOverhead === false
  const perfectFeedbackImprovesBurstOnly = (() => {
    const feed = mFeedback.find((r) => r.protocol === 'AdaptiveSampler')
    const base = baseAdaptive
    const burstFeed = feed.scenarios.find((c) => c.id === 'errorBurst')
    const burstBase = base.scenarios.find((c) => c.id === 'errorBurst')
    const lostFeed = burstFeed ? burstFeed.errorTracesTotal - burstFeed.errorTracesRetained : NaN
    const lostBase = burstBase ? burstBase.errorTracesTotal - burstBase.errorTracesRetained : NaN
    return feed.trilemma.anomalyCapture === false &&
      vectorOf(feed.trilemma) === vectorOf(base.trilemma) &&
      Number.isFinite(lostFeed) && Number.isFinite(lostBase) && lostFeed < lostBase
  })()

  const causalLocks = verifyCausalLocks(cfg)
  const verdict = {
    vectors,
    noUniversalWinner,
    trilemmaDistinguishes,
    noStrategyWinsAll,
    vectorFromTrilemma,
    headBlindLossOnErrorBurst: baseHead.metrics.errorTracesLost > 0,          // 恒以纯净基线标定主教义（rigged 不翻）
    tailGuaranteesAnomaly: rows.find((r) => r.protocol === 'TailBasedSampler').trilemma.anomalyCapture === true,
    adaptiveTracksLoad: rows.find((r) => r.protocol === 'AdaptiveSampler').trilemma.loadAdaptive === true,
    rigged_pkg: rigged,
    riggedConvergenceCollapsed,
    oracleHeadErasesHeadBlindness,
    infiniteBufferErasesOverhead,
    perfectFeedbackImprovesBurstOnly,
    ...causalLocks,
  }

  const soundnessInput = {
    traces: traceStreamOf('errorBurst', { seed: cfg.seed, items: Math.max(24, cfg.items) }),
    seed: cfg.seed,
    rate: cfg.rate,
    items: cfg.items,
  }
  const crosscheck = {
    evidence: createTraceSamplingEvidence({ seed: cfg.seed, now: opts.now }),
    soundness: verifySamplingSoundness(soundnessInput, { seed: cfg.seed, rate: cfg.rate }),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { ...cfg, scenarios: scenarioIds, rigged, oracleHead: flags.oracleHead, infiniteBuffer: flags.infiniteBuffer, perfectFeedback: flags.perfectFeedback },
    rows,
    vectors,
    verdict,
    noUniversalWinner,
    trilemmaDistinguishes,
    causalLocks,
    crosscheck,
    rigged,
  }
}

export const compareTraceSampling = traceSamplingStudy

export function traceSamplingSnapshot(study) {
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
    noUniversalWinner: study.noUniversalWinner === true,
    trilemmaDistinguishes: study.trilemmaDistinguishes === true,
    causalLocks: study.causalLocks ? { ...study.causalLocks } : undefined,
    crosscheck: study.crosscheck ? {
      evidence: study.crosscheck.evidence ? { ...study.crosscheck.evidence } : undefined,
      soundness: study.crosscheck.soundness ? { ...study.crosscheck.soundness } : undefined,
    } : undefined,
    rigged: study.rigged === true,
  }
}

/*----------------------------------------------------- verifySamplingSoundness：双路自证 + 三路真喂回可证伪 -----------------------------------------------------*/

/**
 * 唯一判定内核：给定 traces + 篡改 mode，真跑 TailBased，回读观测量，用**同一个 holds 公式**现算。
 * mode 只改变内核的输入/行为，绝不直接写 holds —— 篡改必须靠真观测量翻红。
 * ground-truth error 集合取自未篡改的 source，判定用它，采样决策用篡改后的 evalTraces。
 */
function samplingCore(input = {}, mode = 'baseline') {
  const seed = intOr(input.seed, TRACE_DEFAULTS.seed)
  const rate = clamp01(numOr(input.rate, TRACE_DEFAULTS.rate))
  // 尊重显式传入的空数组（emptyTraceSet 可证伪腿需要它真为空），只有没传 traces 才构造默认流
  const source = Array.isArray(input.traces)
    ? input.traces
    : traceStreamOf('errorBurst', { seed, items: Math.max(24, intOr(input.items, 48)) })
  const truthErrorIds = new Set(source.filter((t) => t.hasError).map((t) => t.id))
  const truthSpanCount = new Map(source.map((t) => [t.id, t.spans.length]))

  let evalTraces = source.map((t) => ({ ...t, spans: t.spans.map((s) => ({ ...s })) }))
  if (mode === 'emptyTraceSet') {
    evalTraces = []
  } else if (mode === 'forgedErrorSpan') {
    // 真篡改：选「哈希最大、本靠 hasError 才被留」的那条 error trace 漏判成正常 ⇒ 必被哈希丢
    let target = null, best = -1
    for (const t of evalTraces) {
      if (t.hasError) {
        const h = hash01(t.id, seed)
        if (h > best) { best = h; target = t }
      }
    }
    if (target) { target.hasError = false; target.spans.forEach((s) => { s.isError = false }) }
  }
  const nontrivial = evalTraces.length >= 8 && truthErrorIds.size > 0

  // 路 A：无 error 干净流基准（真跑 TailBased，验缓冲守恒 + span 无重复）
  const clean = evalTraces.map((t) => ({ ...t, hasError: false, spans: t.spans.map((s) => ({ ...s, isError: false })) }))
  const laneA = createTailBasedSampler({ seed, rate }).run(clean)
  let aKept = [...laneA.kept]
  if (mode === 'duplicateRelease' && aKept.length) aKept.push(aKept[0]) // 真注入重复释放
  const aKeptIds = aKept.map((t) => t.id)
  const laneAUnique = new Set(aKeptIds).size === aKeptIds.length
  const laneAOk = laneA.stats.spansIn === laneA.stats.spansKept + laneA.stats.spansDropped && laneAUnique

  // 路 B：含 error 流真跑 TailBased，用真观测量判定
  const laneB = createTailBasedSampler({ seed, rate }).run(evalTraces)
  let bKept = [...laneB.kept]
  if (mode === 'duplicateRelease' && bKept.length) bKept.push(bKept[0])
  const bKeptIds = bKept.map((t) => t.id)
  const bKeptSet = new Set(bKeptIds)
  const errorAllRetained = [...truthErrorIds].every((id) => bKeptSet.has(id))
  const noDuplicateSpans = bKeptIds.length === bKeptSet.size
  const spansIntact = bKept.every((t) => t.spans.length === (truthSpanCount.get(t.id) ?? t.spans.length))
  const evalNormals = evalTraces.filter((t) => !t.hasError)
  const normalRetainedInB = evalNormals.filter((t) => bKeptSet.has(t.id)).length
  const normalByRate = evalNormals.length > 0 && normalRetainedInB > 0 && normalRetainedInB < evalNormals.length

  const invariants = { laneAOk, errorAllRetained, noDuplicateSpans, spansIntact, normalByRate }
  const holds = nontrivial && invariants.laneAOk && invariants.errorAllRetained &&
    invariants.noDuplicateSpans && invariants.spansIntact && invariants.normalByRate
  return {
    laneA: {
      baselineSpansIn: laneA.stats.spansIn,
      baselineSpansKept: laneA.stats.spansKept,
      baselineSpansDropped: laneA.stats.spansDropped,
      baselineUnique: laneAUnique,
    },
    laneB: {
      completedTraces: bKeptIds.length,
      uniqueTraces: bKeptSet.size,
      errorTracesTotal: truthErrorIds.size,
      errorTracesRetained: [...truthErrorIds].filter((id) => bKeptSet.has(id)).length,
      normalByRate,
    },
    holds, nontrivial, invariants,
    truthErrors: truthErrorIds.size,
    events: source.length,
  }
}

/** verifySamplingSoundness：稳态真撞合 + 三路篡改真喂回同一内核现算翻 false + 基线先真绿。 */
export function verifySamplingSoundness(input = {}, opts = {}) {
  const cfg = { ...input, seed: input.seed ?? opts.seed, rate: input.rate ?? opts.rate, items: input.items ?? opts.items }
  const baseline = samplingCore(cfg, 'baseline')
  const forgedErrorSpan = samplingCore(cfg, 'forgedErrorSpan')
  const duplicateRelease = samplingCore(cfg, 'duplicateRelease')
  const emptyTraceSet = samplingCore(cfg, 'emptyTraceSet')
  return {
    laneA: baseline.laneA,
    laneB: baseline.laneB,
    invariants: baseline.invariants,
    baselineHolds: baseline.holds,
    holds: baseline.holds,
    nontrivial: baseline.nontrivial,
    falsifiable: baseline.nontrivial && baseline.holds &&
      !forgedErrorSpan.holds && !duplicateRelease.holds && !emptyTraceSet.holds,
    tamper: {
      forgedErrorSpan: { holds: forgedErrorSpan.holds, invariants: forgedErrorSpan.invariants, reason: '漏判哈希最大的 error span ⇒ 该 trace 被哈希丢 ⇒ errorAllRetained 真翻 false' },
      duplicateRelease: { holds: duplicateRelease.holds, invariants: duplicateRelease.invariants, reason: '真重复释放一条 kept trace ⇒ noDuplicateSpans 真翻 false' },
      emptyTraceSet: { holds: emptyTraceSet.holds, nontrivial: emptyTraceSet.nontrivial, invariants: emptyTraceSet.invariants, reason: '空 traces ⇒ nontrivial 与 normalByRate 真翻 false，绝不 0=0 假绿' },
    },
    truthErrors: baseline.truthErrors,
    events: baseline.events,
  }
}

/*----------------------------------------------------- 十一真件 21 键交叉印证 -----------------------------------------------------*/

export function createTraceSamplingEvidence(opts = {}) {
  const seed = intOr(opts.seed, TRACE_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `trace:key:${i}`)
  const ev = {}

  // ① ShardRouter 路由
  const router = createShardRouter({ shards: ['a', 'b', 'c'], slotCount: 256, virtualNodes: 16, salt: String(seed) })
  for (const k of keys.slice(0, 80)) router.route(k)
  const rm = router.remapOn(['a', 'b', 'c', 'd'], { mutate: false })
  ev.routerMoved = rm.moved
  ev.routerTracked = rm.total

  // ② HashRing
  const ring = createHashRing({ virtualNodes: 16, salt: String(seed) })
  for (const n of ['a', 'b', 'c', 'd']) ring.addNode(n)
  ev.ringNodes = ring.nodeIds().length
  const dist = ring.distribution(keys)
  ev.ringShardsUsed = dist.nodes - dist.emptyNodes.length

  // ③ WAL
  const wal = createWal()
  for (const k of keys.slice(0, 80)) wal.append('put', k, { ts: 0, g: 0 })
  const walLines = wal.lines()
  const wal2 = createWal()
  wal2.restore(walLines)
  let walReplayed = 0
  wal2.replay(() => { walReplayed += 1 })
  ev.walLines = walLines.length
  ev.walReplayed = walReplayed

  // ④ Bus
  const bus = createBus()
  let notices = 0
  bus.subscribe('trace.done', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('trace.done', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('trace.done')

  // ⑤ RedisCache
  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`trace:slot:${k}`, 1)
  let bitmapHits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`trace:slot:${k}`) !== undefined) bitmapHits += 1
  ev.redisBitmapHits = bitmapHits
  ev.redisSlots = cache.stats().entries

  // ⑥ ObjectPool
  const pool = createObjectPool({ factory: () => ({ slot: null }), maxSize: 8 })
  const p1 = pool.acquire()
  pool.acquire()
  pool.release(p1)
  pool.acquire()
  const ps = pool.stats()
  ev.poolCreated = ps.created
  ev.poolReused = ps.reused

  // ⑦ TokenBucket
  const bucket = createTokenBucket({ capacity: 3, refillPerSec: 0, now: nowFn })
  let bucketAllowed = 0, bucketRejected = 0
  for (let i = 0; i < 7; i++) { if (bucket.allow().allowed) bucketAllowed += 1; else bucketRejected += 1 }
  ev.bucketAllowed = bucketAllowed
  ev.bucketRejected = bucketRejected

  // ⑧ MinHeap
  const heap = createMinHeapDelayQueue({ now: fixedNow })
  heap.schedule(fixedNow + 80, 'trace:flush')
  heap.schedule(fixedNow + 250, 'trace:committed')
  heap.schedule(fixedNow + 40, 'trace:restart')
  ev.heapFired = heap.advance(fixedNow + 1000).length
  ev.heapPending = heap.pending()

  // ⑨ PackedCounters
  const counters = createPackedCounters(64)
  for (let i = 0; i < 64; i++) counters.inc(i, i + 1)
  let counterSum = 0
  for (let i = 0; i < 64; i++) counterSum += counters.get(i)
  ev.counterSum = counterSum
  ev.counterFalseSharing = counters.stats().falseSharingPairs

  // ⑩ FullJitterBackoff
  const jitter = createFullJitterBackoff({ baseTicks: 16, capTicks: 1024, seed })
  const samples = Array.from({ length: 64 }, (_, i) => jitter.delayFor(6, i))
  const sMin = Math.min(...samples), sMax = Math.max(...samples)
  const sMean = samples.reduce((a, b) => a + b, 0) / samples.length
  ev.jitterSpread = sMean > 0 ? round4((sMax - sMin) / sMean) : 0

  // ⑪ compareRemapping
  const comp = compareRemapping({ nodes: ['a', 'b', 'c'], addNodes: ['d'], keys, salt: String(seed) })
  ev.remapConsistentRate = comp.consistent.rate
  ev.remapModuloRate = comp.modulo.rate

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
  const oracleHead = rigged || args.includes('--oracle-head')
  const infiniteBuffer = rigged || args.includes('--infinite-buffer')
  const perfectFeedback = rigged || args.includes('--perfect-feedback')
  const study = traceSamplingStudy({ rigged, oracleHead, infiniteBuffer, perfectFeedback, now: () => nowMs })
  const snap = traceSamplingSnapshot(study)
  console.log('[trace-sampling] seed=' + snap.config.seed +
    ' items=' + snap.config.items +
    ' rate=' + snap.config.rate +
    ' windowSize=' + snap.config.windowSize +
    ' rigged=' + snap.rigged +
    ' oracleHead=' + snap.config.oracleHead +
    ' infiniteBuffer=' + snap.config.infiniteBuffer +
    ' perfectFeedback=' + snap.config.perfectFeedback +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log(
      '  ' + row.protocol.padEnd(18) +
      ' peakBuf=' + String(row.metrics.peakBufferedSpans).padStart(4) +
      ' errorLost=' + String(row.metrics.errorTracesLost).padStart(4) +
      ' rateChanges=' + String(row.metrics.rateChanges).padStart(4) +
      ' trilemma={' + ['lowOverhead=' + row.trilemma.lowOverhead, 'anomalyCapture=' + row.trilemma.anomalyCapture, 'loadAdaptive=' + row.trilemma.loadAdaptive].join(',') + '}',
    )
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.noUniversalWinner +
    ' distinguishable=' + snap.trilemmaDistinguishes +
    ' noStrategyWinsAll=' + snap.verdict.noStrategyWinsAll +
    ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma)
  console.log('  causalLocks: anomalyBuffering=' + snap.causalLocks.anomalyRequiresBufferingCausallyUnerasable +
    ' headBlindness=' + snap.causalLocks.headBlindnessCausallyUnerasable +
    ' adaptiveLag=' + snap.causalLocks.adaptiveLagCannotGuaranteeAnomalyCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold +
    ' decisionInvariant=' + snap.causalLocks.decisionInvariant +
    ' maxBlindnessGap=' + snap.causalLocks.maxBlindnessGap +
    ' adaptivePerfectLost=' + snap.causalLocks.adaptivePerfectLost + '/' + snap.causalLocks.adaptiveBaseLost)
  console.log('  verdict: headBlindLoss=' + snap.verdict.headBlindLossOnErrorBurst +
    ' tailGuaranteesAnomaly=' + snap.verdict.tailGuaranteesAnomaly +
    ' adaptiveTracksLoad=' + snap.verdict.adaptiveTracksLoad +
    ' oracleHeadErases=' + snap.verdict.oracleHeadErasesHeadBlindness +
    ' infiniteBufferErases=' + snap.verdict.infiniteBufferErasesOverhead +
    ' perfectFeedbackQualityOnly=' + snap.verdict.perfectFeedbackImprovesBurstOnly)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const sm = snap.crosscheck.soundness
  console.log('  verifySamplingSoundness: holds=' + sm.holds + ' baselineHolds=' + sm.baselineHolds +
    ' nontrivial=' + sm.nontrivial + ' falsifiable=' + sm.falsifiable +
    ' laneA{in=' + sm.laneA.baselineSpansIn + ' kept=' + sm.laneA.baselineSpansKept + ' dropped=' + sm.laneA.baselineSpansDropped + '}' +
    ' laneB{completed=' + sm.laneB.completedTraces + ' unique=' + sm.laneB.uniqueTraces + ' errRet=' + sm.laneB.errorTracesRetained + '/' + sm.laneB.errorTracesTotal + '}' +
    ' tamper{forged=' + sm.tamper.forgedErrorSpan.holds + ',dup=' + sm.tamper.duplicateRelease.holds + ',empty=' + sm.tamper.emptyTraceSet.holds + '}')
}
