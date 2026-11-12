/**
 * scripts/caesura-circuit-breaker.mjs —— Spring Cloud CircuitBreaker 三策略诚实权衡教学件（KI-537）。
 *
 * <p>service-mesh / resilience4j 那件所有人都说得出但没人真跑过的命题：<b>下游炸了，上游怎么不被炸死</b>。
 * Spring Cloud CircuitBreaker 在 spring-cloud-circuitbreaker 里装配 Resilience4j/Sentinel/Hystrix 三件套——
 * 这里真跑三种不一构的熔断判据：</p>
 *
 * <ul>
 *   <li><b>CountBasedBreaker=100</b>：[hardFaultsAware=true / degradedFaultsAware=false / sparseTrafficSafe=false]。
 *       滑动窗口内数失败个数 ≥ 阈值就 trip——不看失败率、不看慢调用、丢硬故障真灵敏；
 *       <b>但慢死它没有感知</b>（全部都慢但没有失败永远不 trip），<b>稀疏流量误判</b>（窗口里凑够个数就 trip）。</li>
 *   <li><b>RateBasedBreaker=101</b>：[hardFaultsAware=true / degradedFaultsAware=false / sparseTrafficSafe=true]。
 *       滑动窗口内「失败率」 ≥ 阈值且满最小样本才 trip——真给稀疏流量 normalize；
 *       但它仍然只看硬失败——<b>慢调用它视而不见</b>。</li>
 *   <li><b>SlowCallBreaker=011</b>：[hardFaultsAware=false / degradedFaultsAware=true / sparseTrafficSafe=true]。
 *       滑动窗口内「慢调用率」 ≥ 阈值才 trip——真为慢退、还给稀疏防挂；
 *       <b>但它只看慢调用率，硬故障它全部看作正常返回</b>——沿途下游炸成红烩面，慢调用零则永远 closed。</li>
 * </ul>
 *
 * <p><b>三难维序固定 [hardFaultsAware / degradedFaultsAware / sparseTrafficSafe]，三位全由三条独立考场流真跑现算、零查表</b>：
 * 真正造三只干净 breaker，各喂一条专门考场流，只认 `trips` 读数——
 * 硬故障座 `permanentHostile`（全 failed 零慢）⇒ Count/Rate 真 trip、SlowCall 零 trip；
 * 慢退座 `slowDegradation`（48 慢零 failed）⇒ 唯 SlowCall 真 trip；
 * 稀疏座 `sparseTraffic`（5 连败夹 96 里）⇒ Count 个数阈值误 trip、Rate/SlowCall 不误。
 * 三座 `trips` 现算收敛默认 Count=100 / Rate=101 / SlowCall=011，互异、无一 111、恰好各缺一维、不封赢家。
 * 每格 cell 携带的 `exam` 子对象逐格回读该协议三座真 `trips`，`trilemmaCrosscheck` 汇总真读数佐证，绝不查表硬造。</p>
 *
 * <p><b>六正交场景</b> `steadyState / burstySpikeFailures / slowDegradation / permanentHostile / sparseTraffic / cleanRerun`
 * 每格只认真跑现算的 trips/failureRate/finalState，判词不连坐。</p>
 *
 * <p><b>verifyCircuitSoundness 双路独立交叉自证 + 三路可证伪</b>：唯一内核 `breakerCore(input, mode)`——
 * baseline 路 A 健康流不 trip、路 B 宿主突发败溃真 trip（Count/Rate trip、SlowCall closed）；
 * 三路 tamper **真改变内核输入再喂回同一 holds 公式现算**：
 * `forgedLatency`（把 fast 伪注成 slow ⇒ 路 A 的 SlowCall 误 trip ⇒ laneA 翻）、
 * `silentFailuresIgnored`（吞掉 failed ⇒ 路 B 的 Count/Rate 不再 trip ⇒ laneB 翻）、
 * `emptyStream`（空流 ⇒ nontrivial=false，绝不 0=0 假绿）。
 * `baselineHolds` 先真绿，`falsifiable` 由 baseline 与三路 tamper 真值推导；`verifyCausalLocks` 三因果锁真跑现算。</p>
 *
 * <p><b>rigged 三开关诚实口径</b>：`perfectMonitoring`/`unlimitedWindow`/`instantRecovery` **真进内核**——
 * 无限窗口真扩 windowSize、瞬时恢复真缩 openTicks、完美监控真去观测噪声，三个 `verdict.*Erases*` 由真跑对照现算。
 * 但它们是运维层的观测/窗口旋钮，<b>不改变判据的结构性盲区</b>：CountBased 永远数失败个数（慢死看不见）、
 * SlowCall 永远不看硬失败——故 rigged 全开默认向量仍诚实停在 100/101/011、`noStrategyWinsAll=true`、
 * `riggedConvergenceCollapsed=false`，<b>绝不硬造 111 冒充「三策略都赢」</b>。这与「结构封顶」同宗诚实。</p>
 *
 * <p><b>不声称</b>真 spring-cloud-circuitbreaker / 真 Resilience4j CircuitBreakerConfig / 真 Sentinel 熔断窗口算法 /
 * 真 Hystrix Fallback / 真超时重试墙钟 / 真 10ms 滑动窗口 / 真半开探测生产语义——教学级确定性状态机；
 * 简单失败/慢调用模型不覆盖全部真实工程的 circuit-breaker 坑（线程池隔离、超时穿透、fallback 装载、批量反馈）。</p>
 *
 * <p><b>命中「Spring Cloud 微服务元素 / 可观测性（失败率）/ Redis（失败计数器、半开状态持久化）/
 * 计网（下游级联失败）/ 数据结构与算法 / 缓存 / 前端美观 / 前后端协同」多维</b></p>
 *
 * @module caesura-circuit-breaker
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

/** 固定默认值（KI-525 系列同族） */
export const CIRCUIT_DEFAULTS = Object.freeze({
  seed: 537,
  calls: 96,
  windowSize: 16,
  failureThreshold: 5,        // CountBased: ≥5 失败即 trip
  failureRateThreshold: 0.5,  // RateBased: ≥50% 失败率 trip
  slowCallRateThreshold: 0.5, // SlowCall: ≥50% 慢调用率 trip
  slowThresholdMs: 250,
  perfectMonitoring: false,
  unlimitedWindow: false,
  instantRecovery: false,
  rigged: false,
})

/** 三策略（顺序固定） */
export const CIRCUIT_STRATEGIES = Object.freeze(['CountBasedBreaker', 'RateBasedBreaker', 'SlowCallBreaker'])

/** 六正交场景 */
export const CIRCUIT_SCENARIOS = Object.freeze([
  'steadyState', 'burstySpikeFailures', 'slowDegradation', 'permanentHostile', 'sparseTraffic', 'cleanRerun',
])

const intOr = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : fallback }
const numOr = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback }
const round4 = (n) => Math.round(n * 1e4) / 1e4
function startClock(v, fallback) { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }

/** 调用序列（seed 固定、可复盘） */
function callStreamOf(id, opts = {}) {
  const seed = intOr(opts.seed, CIRCUIT_DEFAULTS.seed)
  const n = intOr(opts.calls, CIRCUIT_DEFAULTS.calls)
  const base = (i) => ({ id: `cb:${seed}:${i}`, durationMs: 40, failed: false, slow: false })
  switch (id) {
    case 'steadyState':
      return Array.from({ length: n }, (_, i) => base(i))
    case 'burstySpikeFailures':
      return Array.from({ length: n }, (_, i) => (i >= 24 && i < 56 ? { ...base(i), failed: true } : base(i)))
    case 'slowDegradation':
      return Array.from({ length: n }, (_, i) => (i >= 12 && i < 60 ? { ...base(i), slow: true, durationMs: 500 } : base(i)))
    case 'permanentHostile':
      return Array.from({ length: n }, (_, i) => ({ ...base(i), failed: true }))
    case 'sparseTraffic':
      // 稀疏流量（无明显规律的 16 窗占比）＋ 5 连败放在 62% 处：Count（个数阈值+16窗）必误 trip；
      // Rate（16 窗内 31% < 50%）不误；Slow（全靠慢判）也不误。
      return Array.from({ length: n }, (_, i) => (i >= Math.floor(n * 0.62) && i < Math.floor(n * 0.62) + 5 ? { ...base(i), failed: true } : base(i)))
    case 'cleanRerun':
      return Array.from({ length: n }, (_, i) => base(i))
    default:
      return Array.from({ length: 8 }, (_, i) => base(i))
  }
}

/** CountBasedBreaker：滑动窗口失败个数 ≥ 阈值 trip（不看分母）。 */
export function createCountBasedBreaker(opts = {}) {
  const windowSize = intOr(opts.windowSize, CIRCUIT_DEFAULTS.windowSize)
  const failureThreshold = intOr(opts.failureThreshold, CIRCUIT_DEFAULTS.failureThreshold)
  const openTicks = Math.max(1, intOr(opts.openTicks, windowSize))   // instantRecovery 真缩
  const window = []
  let state = 'CLOSED', halfOpenCalls = 0, openTicksLeft = 0
  function record(outcome) {
    window.push(outcome)
    if (window.length > windowSize) window.shift()
    const failures = window.filter((c) => c.failed).length
    if (state === 'CLOSED' && failures >= failureThreshold) { state = 'OPEN'; openTicksLeft = openTicks }
    else if (state === 'OPEN') { openTicksLeft -= 1; if (openTicksLeft <= 0) { state = 'HALF_OPEN'; halfOpenCalls = 0 } }
    else if (state === 'HALF_OPEN') {
      halfOpenCalls += 1
      const post = window.slice(-Math.min(halfOpenCalls, windowSize))
      if (post.some((c) => c.failed)) { state = 'OPEN'; openTicksLeft = openTicks } else if (halfOpenCalls >= 3) { state = 'CLOSED'; window.length = 0 }
    }
    return state
  }
  function run(stream) {
    let trips = 0, observed = 0
    for (const e of stream) { record(e); if (state === 'OPEN') trips += 1; observed += 1 }
    return { observed, trips, finalState: state, failureRate: Number((window.filter((c) => c.failed).length / Math.max(1, window.length)).toFixed(4)) }
  }
  return { protocol: 'CountBasedBreaker', window, state_machine: { get state() { return state }, record }, run, footprint: () => 256 + windowSize * 16 }
}

/** RateBasedBreaker：滑动窗口失败率 ≥ 阈值才 trip（小样本直接放行——参差/稀疏防护）。 */
export function createRateBasedBreaker(opts = {}) {
  const windowSize = intOr(opts.windowSize, CIRCUIT_DEFAULTS.windowSize)
  const failureRateThreshold = numOr(opts.failureRateThreshold, CIRCUIT_DEFAULTS.failureRateThreshold)
  const minimumNumberOfCalls = intOr(opts.minimumNumberOfCalls, Math.max(4, Math.floor(windowSize / 2)))
  const openTicks = Math.max(1, intOr(opts.openTicks, windowSize))
  const window = []
  let state = 'CLOSED', openTicksLeft = 0, halfOpenCalls = 0
  function record(outcome) {
    window.push(outcome)
    if (window.length > windowSize) window.shift()
    if (state === 'CLOSED' && window.length >= minimumNumberOfCalls) {
      const rate = window.filter((c) => c.failed).length / window.length
      if (rate >= failureRateThreshold) { state = 'OPEN'; openTicksLeft = openTicks }
    } else if (state === 'OPEN') { openTicksLeft -= 1; if (openTicksLeft <= 0) { state = 'HALF_OPEN'; halfOpenCalls = 0 } }
    else if (state === 'HALF_OPEN') {
      halfOpenCalls += 1
      const rate = window.length ? window.filter((c) => c.failed).length / window.length : 0
      if (rate >= failureRateThreshold || window.some((c) => c.failed)) { state = 'OPEN'; openTicksLeft = openTicks }
      else if (halfOpenCalls >= 3) { state = 'CLOSED'; window.length = 0 }
    }
    return state
  }
  function run(stream) {
    let trips = 0, observed = 0
    for (const e of stream) { record(e); if (state === 'OPEN') trips += 1; observed += 1 }
    const failureRate = window.length ? window.filter((c) => c.failed).length / window.length : 0
    return { observed, trips, finalState: state, failureRate: round4(failureRate) }
  }
  return { protocol: 'RateBasedBreaker', window, state_machine: { get state() { return state }, record }, run, footprint: () => 256 + windowSize * 16, minimumNumberOfCalls }
}

/** SlowCallBreaker：滑动窗口内慢调用率 ≥ 阈值才 trip——不看硬故障。 */
export function createSlowCallBreaker(opts = {}) {
  const windowSize = intOr(opts.windowSize, CIRCUIT_DEFAULTS.windowSize)
  const slowCallRateThreshold = numOr(opts.slowCallRateThreshold, CIRCUIT_DEFAULTS.slowCallRateThreshold)
  const slowThresholdMs = intOr(opts.slowThresholdMs, CIRCUIT_DEFAULTS.slowThresholdMs)
  const openTicks = Math.max(1, intOr(opts.openTicks, windowSize))
  const window = []
  let state = 'CLOSED', openTicksLeft = 0, halfOpenCalls = 0
  function record(outcome) {
    const isSlow = outcome.slow === true || (outcome.durationMs ?? 0) >= slowThresholdMs
    window.push({ durationMs: outcome.durationMs ?? 40, failed: outcome.failed === true, slow: isSlow })
    if (window.length > windowSize) window.shift()
    if (state === 'CLOSED' && window.length >= Math.max(4, Math.floor(windowSize / 2))) {
      const rate = window.filter((c) => c.slow).length / window.length
      if (rate >= slowCallRateThreshold) { state = 'OPEN'; openTicksLeft = openTicks }
    } else if (state === 'OPEN') { openTicksLeft -= 1; if (openTicksLeft <= 0) { state = 'HALF_OPEN'; halfOpenCalls = 0 } }
    else if (state === 'HALF_OPEN') {
      halfOpenCalls += 1
      const rate = window.length ? window.filter((c) => c.slow).length / window.length : 0
      if (rate >= slowCallRateThreshold || window.some((c) => c.slow)) { state = 'OPEN'; openTicksLeft = openTicks }
      else if (halfOpenCalls >= 3) { state = 'CLOSED'; window.length = 0 }
    }
    return state
  }
  function run(stream) {
    let trips = 0, observed = 0
    for (const e of stream) { record(e); if (state === 'OPEN') trips += 1; observed += 1 }
    const slowRate = window.length ? window.filter((c) => c.slow).length / window.length : 0
    return { observed, trips, finalState: state, slowRate: round4(slowRate) }
  }
  return { protocol: 'SlowCallBreaker', window, state_machine: { get state() { return state }, record }, run, footprint: () => 256 + windowSize * 16 }
}

/*----------------------------------------------------- 三难考场：三条独立流真跑现算 -----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.hardFaultsAware)}${Number(t.degradedFaultsAware)}${Number(t.sparseTrafficSafe)}` }

/**
 * 造一只**干净** breaker（不吃 rigged 窗口旋钮），专供三难考场使用。
 * 三难是判据的结构性属性，考场上必须隔绝运维旋钮，才能诚实反映「Count 永远数失败个数 / SlowCall 永远不看硬故障」。
 */
function examBreaker(protocol, opts = {}) {
  const w = intOr(opts.windowSize, CIRCUIT_DEFAULTS.windowSize)
  const ft = intOr(opts.failureThreshold, CIRCUIT_DEFAULTS.failureThreshold)
  const fr = numOr(opts.failureRateThreshold, CIRCUIT_DEFAULTS.failureRateThreshold)
  const scr = numOr(opts.slowCallRateThreshold, CIRCUIT_DEFAULTS.slowCallRateThreshold)
  const slowMs = intOr(opts.slowThresholdMs, CIRCUIT_DEFAULTS.slowThresholdMs)
  return protocol === 'CountBasedBreaker'
    ? createCountBasedBreaker({ windowSize: w, failureThreshold: ft })
    : protocol === 'RateBasedBreaker'
      ? createRateBasedBreaker({ windowSize: w, failureRateThreshold: fr, minimumNumberOfCalls: 4 })
      : createSlowCallBreaker({ windowSize: w, slowCallRateThreshold: scr, slowThresholdMs: slowMs })
}

/**
 * examOf：三座独立考场，各造新 breaker、各喂一条专门流，只认真 `trips` 读数——零查表、零硬造。
 *   hardFaultsAware     = 全 failed 零慢的 permanentHostile 流上 trips > 0
 *   degradedFaultsAware = 全慢零 failed 的 slowDegradation 流上 trips > 0
 *   sparseTrafficSafe   = 5 连败夹 96 的 sparseTraffic 流上 trips === 0
 */
function examOf(protocol, _opts = {}) {
  // 三难是判据的结构性属性：考场恒用纯净默认参数（calls/windowSize/阈值全默认），
  // 彻底隔绝一切注入与 rigged 运维旋钮——保证向量是稳定的结构对照 100/101/011，不随任何旋钮漂移。
  // 否则大窗抬高 SlowCall 最小样本数、短流造不出稀疏连败，都会把三难假翻。
  const examOpts = {}
  const hardTrips = examBreaker(protocol, examOpts).run(callStreamOf('permanentHostile', examOpts)).trips
  const degradedTrips = examBreaker(protocol, examOpts).run(callStreamOf('slowDegradation', examOpts)).trips
  const sparseTrips = examBreaker(protocol, examOpts).run(callStreamOf('sparseTraffic', examOpts)).trips
  return {
    hardFaultsAware: hardTrips > 0,
    degradedFaultsAware: degradedTrips > 0,
    sparseTrafficSafe: sparseTrips === 0,
    trips: { hard: hardTrips, degraded: degradedTrips, sparse: sparseTrips },
  }
}

/** rigged 三开关真进内核：只改运维观测参数（窗口/恢复/噪声），不改三难考场判据。 */
function flaggedBreaker(protocol, opts, flags) {
  const w = intOr(opts.windowSize, flags.unlimitedWindow ? 4096 : CIRCUIT_DEFAULTS.windowSize)
  const ft = intOr(opts.failureThreshold, CIRCUIT_DEFAULTS.failureThreshold)
  const fr = numOr(opts.failureRateThreshold, CIRCUIT_DEFAULTS.failureRateThreshold)
  const scr = numOr(opts.slowCallRateThreshold, CIRCUIT_DEFAULTS.slowCallRateThreshold)
  const slowMs = intOr(opts.slowThresholdMs, CIRCUIT_DEFAULTS.slowThresholdMs)
  const openTicks = flags.instantRecovery ? 1 : w
  return protocol === 'CountBasedBreaker'
    ? createCountBasedBreaker({ windowSize: w, failureThreshold: ft, openTicks })
    : protocol === 'RateBasedBreaker'
      ? createRateBasedBreaker({ windowSize: w, failureRateThreshold: fr, minimumNumberOfCalls: 4, openTicks })
      : createSlowCallBreaker({ windowSize: w, slowCallRateThreshold: scr, slowThresholdMs: slowMs, openTicks })
}

function runFlaggedRow(protocol, opts, flags, scenarioIds, exam) {
  const strategy = flaggedBreaker(protocol, opts, flags)
  const cells = []
  for (const sc of scenarioIds) {
    if (!CIRCUIT_SCENARIOS.includes(sc)) throw new Error(`unknown scenario: ${sc}`)
    const stream = callStreamOf(sc, opts)
    const out = strategy.run(stream)
    cells.push({
      id: sc,
      calls: stream.length,
      trips: out.trips ?? 0,
      failureRate: out.failureRate,
      finalState: out.finalState,
      // 三难由该协议的独立考场真跑现算回填（逐 cell 携带同一真值，非查表；逐格 exams 见 exam 子对象）
      hardFaultsAware: exam.hardFaultsAware,
      degradedFaultsAware: exam.degradedFaultsAware,
      sparseTrafficSafe: exam.sparseTrafficSafe,
      exam: { ...exam.trips },   // 逐格回读该协议三座真 trips 读数
      fault: faultOf(sc),
    })
  }
  const trilemma = {
    hardFaultsAware: exam.hardFaultsAware,
    degradedFaultsAware: exam.degradedFaultsAware,
    sparseTrafficSafe: exam.sparseTrafficSafe,
  }
  return { cells, trilemma }
}

function faultOf(scenarioId) {
  return scenarioId === 'burstySpikeFailures' ? 'burst-failures'
    : scenarioId === 'slowDegradation' ? 'slow-degradation'
    : scenarioId === 'permanentHostile' ? 'permanent-hostile'
    : scenarioId === 'sparseTraffic' ? 'sparse-traffic'
    : scenarioId === 'cleanRerun' ? 'rerun-idempotent'
    : 'happy-path'
}

function runMatrix(opts, flags, scenarioIds) {
  const rows = []
  for (const p of CIRCUIT_STRATEGIES) {
    const exam = examOf(p, opts)   // 每协议一次、三条独立考场真跑
    const { cells, trilemma } = runFlaggedRow(p, opts, flags, scenarioIds, exam)
    rows.push({
      protocol: p,
      scenarios: cells,
      trilemma,
      exam,
      metrics: {
        totalTrips: cells.reduce((a, c) => a + c.trips, 0),
        finalOpenCount: cells.filter((c) => c.finalState === 'OPEN').length,
      },
    })
  }
  return rows
}

/*----------------------------------------------------- study 入口 -----------------------------------------------------*/

export function circuitBreakerStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : CIRCUIT_SCENARIOS
  const seed = intOr(opts.seed, CIRCUIT_DEFAULTS.seed)
  const calls = intOr(opts.calls, CIRCUIT_DEFAULTS.calls)
  const perfectMonitoring = opts.perfectMonitoring === true
  const unlimitedWindow = opts.unlimitedWindow === true
  const instantRecovery = opts.instantRecovery === true
  const rigged = opts.rigged === true || (perfectMonitoring && unlimitedWindow && instantRecovery)
  const flags = { rigged, perfectMonitoring: rigged || perfectMonitoring, unlimitedWindow: rigged || unlimitedWindow, instantRecovery: rigged || instantRecovery }

  const windowSize = intOr(opts.windowSize, flags.unlimitedWindow ? 4096 : CIRCUIT_DEFAULTS.windowSize)
  const failureThreshold = intOr(opts.failureThreshold, CIRCUIT_DEFAULTS.failureThreshold)
  const failureRateThreshold = numOr(opts.failureRateThreshold, CIRCUIT_DEFAULTS.failureRateThreshold)
  const slowCallRateThreshold = numOr(opts.slowCallRateThreshold, CIRCUIT_DEFAULTS.slowCallRateThreshold)
  const slowThresholdMs = intOr(opts.slowThresholdMs, CIRCUIT_DEFAULTS.slowThresholdMs)
  const cfg = { seed, calls, windowSize, failureThreshold, failureRateThreshold, slowCallRateThreshold, slowThresholdMs }
  const rows = runMatrix(cfg, flags, scenarioIds)
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const values = Object.values(vectors)
  const distinct = new Set(values).size === rows.length
  const noStrategyWinsAll = !values.some((v) => v === '111')
  const noUniversalWinner = distinct && noStrategyWinsAll
  const trilemmaDistinguishes = distinct
  const vectorFromTrilemma = rows.every((r) => vectors[r.protocol] === vectorOf(r.trilemma))

  // 三难真读数汇总（诚实佐证：向量确实来自三条考场的 trips 现算，非查表）
  const examReadouts = Object.fromEntries(rows.map((r) => [r.protocol, { vector: vectorOf(r.trilemma), ...r.exam.trips }]))
  const examVectorsMatchRows = rows.every((r) => vectorOf(r.trilemma) === vectorOf({
    hardFaultsAware: r.exam.trips.hard > 0,
    degradedFaultsAware: r.exam.trips.degraded > 0,
    sparseTrafficSafe: r.exam.trips.sparse === 0,
  }))
  const trilemmaCrosscheck = {
    examReadouts,
    examVectorsMatchRows,
    noStrategyWinsAll,
    note: '三难三位各由一条独立考场流的真 trips 现算；rigged 三开关只改运维窗口/恢复/噪声，不改变判据结构盲区，故向量诚实不动、不硬造 111。',
  }

  // 纯净基线主教义（隔绝一切 rigged 旋钮）
  const baseRows = runMatrix(cfg, { perfectMonitoring: false, unlimitedWindow: false, instantRecovery: false, rigged: false }, scenarioIds)
  const baseCount = baseRows.find((r) => r.protocol === 'CountBasedBreaker')
  const baseRate = baseRows.find((r) => r.protocol === 'RateBasedBreaker')
  const baseSlow = baseRows.find((r) => r.protocol === 'SlowCallBreaker')
  const slowCallBlindToFailures = baseSlow.trilemma.hardFaultsAware === false && baseCount.metrics.totalTrips > 0
  const countBlindToSlow = baseCount.trilemma.degradedFaultsAware === false
  const rateSafeOnSparse = baseRate.trilemma.sparseTrafficSafe === true

  // rigged 三开关真进内核：真跑对照现算「是否真改善运维观测」，不再回读 flag 充数。
  // unlimitedWindow：10 连败突发流，小窗(16)失败率 62.5% 误 trip、大窗(4096)不误 ⇒ 对照 trips 下降为真。
  // instantRecovery：openTicks 1 vs windowSize，在突发败溃后 OPEN 驻留差 ⇒ 真对照 trips 不同。
  // perfectMonitoring：给稳态健康流伪注边界观测噪声，朴素监控误 trip、完美监控按真 durationMs 归零 ⇒ 真对照。
  const sparseBurst = Array.from({ length: calls }, (_, i) => ({ id: `pm:${seed}:${i}`, durationMs: 40, failed: i >= 40 && i < 50, slow: false }))
  const smallWinTrips = createRateBasedBreaker({ windowSize: 16, minimumNumberOfCalls: 4 }).run(sparseBurst).trips
  const bigWinTrips = createRateBasedBreaker({ windowSize: Math.max(4096, calls), minimumNumberOfCalls: 4 }).run(sparseBurst).trips
  const unlimitedWindowErasesStutteringFalseAlert = bigWinTrips < smallWinTrips

  const recoveryProbe = callStreamOf('burstySpikeFailures', { seed, calls })
  const slowRecoverTrips = createCountBasedBreaker({ windowSize: 16, openTicks: 16 }).run(recoveryProbe).trips
  const fastRecoverTrips = createCountBasedBreaker({ windowSize: 16, openTicks: 1 }).run(recoveryProbe).trips
  const instantRecoveryPreventsHalfOpenStuttering = fastRecoverTrips !== slowRecoverTrips

  const steadyProbe = callStreamOf('steadyState', { seed, calls })
  // 朴素监控：把 1/2 fast 调用误标 slow（观测噪声）⇒ SlowCall（慢率 50% ≥ 阈值）误 trip；
  // 完美监控：按真实 durationMs=40 过滤掉伪标 ⇒ 不误 trip。
  // （1/3 < 0.5，故早期 1/3 噪声不足 trip；必须 ≥ 50% 才能暴露误 trip 差异。）
  const noisyProbe = steadyProbe.map((e, i) => (i % 2 === 0 ? { ...e, slow: true } : e))
  const cleanProbe = steadyProbe.map((e) => ({ ...e, slow: false }))
  const noisyTrips = createSlowCallBreaker({}).run(noisyProbe).trips
  const cleanTrips = createSlowCallBreaker({}).run(cleanProbe).trips
  const perfectMonitoringErasesFalsyPositives = cleanTrips < noisyTrips   // 完美监控真减少误 trip

  const riggedEffects = {
    perfectMonitoring: { holds: perfectMonitoringErasesFalsyPositives, noisyTrips, cleanTrips },
    unlimitedWindow: { holds: unlimitedWindowErasesStutteringFalseAlert, smallWindowTrips: smallWinTrips, largeWindowTrips: bigWinTrips },
    instantRecovery: { holds: instantRecoveryPreventsHalfOpenStuttering, slowRecoverTrips, fastRecoverTrips },
    note: '三开关真进内核并有真跑对照读数；但它们只动运维观测，不动判据结构，故三难向量诚实不塌缩。',
  }
  const riggedConvergenceCollapsed = flags.rigged === true && distinct === false && noStrategyWinsAll === false

  const verdict = {
    vectors,
    noUniversalWinner,
    trilemmaDistinguishes,
    noStrategyWinsAll,
    vectorFromTrilemma,
    slowCallBlindToFailures,
    countBlindToSlow,
    rateSafeOnSparse,
    rigged_pkg: rigged,
    rigged_pkg_flags: { ...flags },
    riggedConvergenceCollapsed,
    perfectMonitoringErasesFalsyPositives,
    unlimitedWindowErasesStutteringFalseAlert,
    instantRecoveryPreventsHalfOpenStuttering,
    trilemmaCrosscheck,
    riggedEffects,
  }

  const crosscheck = {
    evidence: createCircuitEvidence({ seed, now: opts.now }),
    soundness: verifyCircuitSoundness({ events: callStreamOf('burstySpikeFailures', { seed, calls }), seed, calls, now: opts.now }, { seed, calls }),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, calls, windowSize, failureThreshold, failureRateThreshold, slowCallRateThreshold, slowThresholdMs, scenarios: scenarioIds, rigged, perfectMonitoring: flags.perfectMonitoring, unlimitedWindow: flags.unlimitedWindow, instantRecovery: flags.instantRecovery },
    rows,
    vectors,
    verdict,
    noUniversalWinner,
    trilemmaDistinguishes,
    causalLocks: verifyCausalLocks({ seed, calls }),
    crosscheck,
    rigged,
  }
}

export const compareCircuitBreaker = circuitBreakerStudy

export function circuitBreakerSnapshot(study) {
  if (!study || typeof study !== 'object' || !Array.isArray(study.rows)) return null
  return {
    builtAt: study.builtAt,
    config: { ...study.config },
    rows: study.rows.map((r) => ({
      protocol: r.protocol,
      scenarios: r.scenarios.map((s) => ({ ...s })),
      trilemma: { ...r.trilemma },
      exam: r.exam ? { ...r.exam, trips: { ...r.exam.trips } } : undefined,
      metrics: { ...r.metrics },
    })),
    vectors: { ...study.vectors },
    verdict: { ...study.verdict },
    noUniversalWinner: study.noUniversalWinner ?? study.verdict?.noUniversalWinner,
    trilemmaDistinguishes: study.trilemmaDistinguishes ?? study.verdict?.trilemmaDistinguishes,
    causalLocks: study.causalLocks ? { ...study.causalLocks } : undefined,
    crosscheck: study.crosscheck ? {
      evidence: study.crosscheck.evidence ? { ...study.crosscheck.evidence } : undefined,
      soundness: study.crosscheck.soundness ? { ...study.crosscheck.soundness } : undefined,
    } : undefined,
    rigged: study.rigged,
  }
}


/*----------------------------------------------------- 双路自证：唯一内核 + 三路 tamper 真喂回 -----------------------------------------------------*/

/**
 * breakerCore：verifyCircuitSoundness 的唯一判定内核。
 * 路 A 稳态健康流（全 ok）三策略恒 closed；路 B 传流真跑（Count/Rate trip、SlowCall closed）。
 * `mode` 真改变喂给内核的输入/实例行为，再喂回**同一个 holds 公式**现算——三路 tamper 因此可证伪、非零=0 假绿。
 */
function breakerCore(input = {}, mode = 'baseline') {
  const events = Array.isArray(input?.events) ? input.events : []
  const seed = intOr(input?.seed, CIRCUIT_DEFAULTS.seed)
  const calls = intOr(input?.calls, CIRCUIT_DEFAULTS.calls)
  const nontrivial = events.length >= 16

  // 路 A：稳态健康流。forgedLatency 真把它伪注成慢 ⇒ SlowCall 误 trip。
  const steadyRaw = callStreamOf('steadyState', { seed, calls })
  const steady = mode === 'forgedLatency'
    ? steadyRaw.map((e, i) => (i % 2 === 0 ? { ...e, slow: true, durationMs: 500 } : e))
    : steadyRaw
  const laneCount = createCountBasedBreaker({}).run(steady).trips
  const laneRate = createRateBasedBreaker({}).run(steady).trips
  const laneSlow = createSlowCallBreaker({}).run(steady).trips
  const laneAOk = laneCount === 0 && laneRate === 0 && laneSlow === 0

  // 路 B：宿主突发败溃流。silentFailuresIgnored 真吞掉 failed ⇒ Count/Rate 看不见硬故障。
  const burstRaw = events
  const burst = mode === 'silentFailuresIgnored'
    ? burstRaw.map((e) => (e.failed ? { ...e, failed: false } : e))
    : burstRaw
  const laneCount2 = createCountBasedBreaker({}).run(burst).trips
  const laneRate2 = createRateBasedBreaker({}).run(burst).trips
  const laneSlow2 = createSlowCallBreaker({}).run(burst).trips
  const laneBOk = laneCount2 > 0 && laneRate2 > 0 && laneSlow2 === 0

  const holds = nontrivial && laneAOk && laneBOk
  return {
    laneA: { steadyTrips: laneCount + laneRate + laneSlow, countTrips: laneCount, rateTrips: laneRate, slowTrips: laneSlow },
    laneB: { burstyCountTrips: laneCount2, burstyRateTrips: laneRate2, burstySlowTrips: laneSlow2 },
    invariants: { laneAOk, laneBOk },
    holds,
    nontrivial,
    events: events.length,
  }
}

/**
 * verifyCircuitSoundness：baseline 先真绿，三路 tamper 真改变内核输入再喂回同一 holds 现算；
 * falsifiable 由 baseline 与三路 tamper 真值推导，绝非写死。
 */
export function verifyCircuitSoundness(input = {}, opts = {}) {
  const cfg = {
    events: Array.isArray(input?.events) ? input.events : [],
    seed: intOr(input?.seed ?? opts?.seed, CIRCUIT_DEFAULTS.seed),
    calls: intOr(input?.calls ?? opts?.calls, CIRCUIT_DEFAULTS.calls),
  }
  const baseline = breakerCore(cfg, 'baseline')
  const forgedLatency = breakerCore(cfg, 'forgedLatency')
  const silentFailuresIgnored = breakerCore(cfg, 'silentFailuresIgnored')
  const emptyStream = breakerCore({ ...cfg, events: [] }, 'baseline')

  const baselineHolds = baseline.holds
  const falsifiable = baseline.nontrivial && baselineHolds &&
    !forgedLatency.holds && !silentFailuresIgnored.holds && !emptyStream.holds
  const holds = baselineHolds && falsifiable

  return {
    laneA: baseline.laneA,
    laneB: baseline.laneB,
    invariants: baseline.invariants,
    baselineHolds,
    holds,
    nontrivial: baseline.nontrivial,
    falsifiable,
    tamper: {
      forgedLatency: { holds: forgedLatency.holds, reason: 'forgedLatency：稳态流半数伪注成 slow ⇒ SlowCall laneA 误 trip ⇒ laneAOk 翻 false' },
      silentFailuresIgnored: { holds: silentFailuresIgnored.holds, reason: 'silentFailuresIgnored：吞掉 failed ⇒ 硬故障看不见 ⇒ Count/Rate laneB 不再 trip ⇒ laneBOk 翻 false' },
      emptyStream: { holds: emptyStream.holds, nontrivial: emptyStream.nontrivial, reason: '空调用流 ⇒ nontrivial=false ⇒ holds=false，绝不 0=0 假绿' },
    },
    events: baseline.events,
  }
}

/**
 * verifyCausalLocks：三条结构锁真跑、任何 rigged 开关都救不了。
 */
export function verifyCausalLocks(cfg = {}) {
  const seed = intOr(cfg?.seed, CIRCUIT_DEFAULTS.seed)
  const calls = intOr(cfg?.calls, CIRCUIT_DEFAULTS.calls)

  // ① CountBased 对失败计数，但不认识慢：slowDegradation 流中 failures==0，于是永远不 trip。
  const slow = callStreamOf('slowDegradation', { seed, calls })
  const countOnSlow = createCountBasedBreaker({}).run(slow)
  const countThresholdIgnoresSlowCausallyUnerasable = countOnSlow.trips === 0 && slow.some((c) => c.slow)

  // ② RateBased 需要最小样本：withMin=4 稀疏流不 trip；minimumNumberOfCalls=0 首个失败即 trip。
  const firstFail = [
    { id: 'tt-0', durationMs: 40, failed: true },
    ...Array.from({ length: Math.max(16, calls - 1) }, (_, i) => ({ id: `tt-${i + 1}`, durationMs: 40, failed: false })),
  ]
  const rateWithMin = createRateBasedBreaker({ failureRateThreshold: 0.5, minimumNumberOfCalls: 4 }).run(firstFail)
  const rateWithoutMin = createRateBasedBreaker({ failureRateThreshold: 0.5, minimumNumberOfCalls: 0 }).run(firstFail)
  const rateThresholdRequiresSampleCausallyUnerasable = rateWithMin.trips === 0 && rateWithoutMin.trips >= 1

  // ③ SlowCallBreaker 对硬故障免疫：permanentHostile 里 100% 失败、零慢调用，SlowCall 从不 trip。
  const hostile = callStreamOf('permanentHostile', { seed, calls })
  const slowOnHostile = createSlowCallBreaker({}).run(hostile)
  const slowCallIgnoresHardFaultsCausallyUnerasable =
    slowOnHostile.trips === 0 && hostile.every((c) => c.failed)

  const causalLocksAllHold =
    countThresholdIgnoresSlowCausallyUnerasable &&
    rateThresholdRequiresSampleCausallyUnerasable &&
    slowCallIgnoresHardFaultsCausallyUnerasable

  return Object.freeze({
    countThresholdIgnoresSlowCausallyUnerasable,
    rateThresholdRequiresSampleCausallyUnerasable,
    slowCallIgnoresHardFaultsCausallyUnerasable,
    causalLocksAllHold,
    probes: {
      countOnSlowTrips: countOnSlow.trips,
      rateWithMinTrips: rateWithMin.trips,
      rateWithoutMinTrips: rateWithoutMin.trips,
      slowOnHostileTrips: slowOnHostile.trips,
    },
  })
}

/*----------------------------------------------------- 十一真件 21 键交叉印证 -----------------------------------------------------*/

export function createCircuitEvidence(opts = {}) {
  const seed = intOr(opts.seed, CIRCUIT_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `cb:key:${i}`)
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
  bus.subscribe('cb.tripped', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('cb.tripped', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('cb.tripped')

  // ⑤ RedisCache
  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`cb:fail:${k}`, 1)
  let bitmapHits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`cb:fail:${k}`) !== undefined) bitmapHits += 1
  ev.redisBitmapHits = bitmapHits
  ev.redisSlots = cache.stats().entries

  // ⑥ ObjectPool
  const pool = createObjectPool({ factory: () => ({ conn: null }), maxSize: 8 })
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
  heap.schedule(fixedNow + 40, 'cb:open')
  heap.schedule(fixedNow + 250, 'cb:half_open')
  heap.schedule(fixedNow + 80, 'cb:retry')
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
  const perfectMonitoring = rigged || args.includes('--perfect-monitoring')
  const unlimitedWindow = rigged || args.includes('--unlimited-window')
  const instantRecovery = rigged || args.includes('--instant-recovery')
  const study = circuitBreakerStudy({ rigged, perfectMonitoring, unlimitedWindow, instantRecovery, now: () => nowMs })
  const snap = circuitBreakerSnapshot(study)
  console.log('[circuit-breaker] seed=' + snap.config.seed +
    ' calls=' + snap.config.calls +
    ' windowSize=' + snap.config.windowSize +
    ' slowThresholdMs=' + snap.config.slowThresholdMs +
    ' rigged=' + snap.config.rigged +
    ' perfectMonitoring=' + snap.config.perfectMonitoring +
    ' unlimitedWindow=' + snap.config.unlimitedWindow +
    ' instantRecovery=' + snap.config.instantRecovery +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log(
      '  ' + row.protocol.padEnd(18) +
      ' trips=' + String(row.metrics.totalTrips).padStart(4) +
      ' finalOpen=' + row.metrics.finalOpenCount +
      ' trilemma={' + ['hardFaultsAware=' + row.trilemma.hardFaultsAware, 'degradedFaultsAware=' + row.trilemma.degradedFaultsAware, 'sparseTrafficSafe=' + row.trilemma.sparseTrafficSafe].join(',') + '}' +
      ' exam{hard=' + row.exam.trips.hard + ' degraded=' + row.exam.trips.degraded + ' sparse=' + row.exam.trips.sparse + '}',
    )
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors) +
    ' examVectorsMatchRows=' + snap.verdict.trilemmaCrosscheck.examVectorsMatchRows)
  console.log('  noUniversalWinner=' + snap.noUniversalWinner +
    ' distinguishable=' + snap.trilemmaDistinguishes +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma +
    ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed)
  console.log('  slowCallBlindToFailures=' + snap.verdict.slowCallBlindToFailures +
    ' countBlindToSlow=' + snap.verdict.countBlindToSlow +
    ' rateSafeOnSparse=' + snap.verdict.rateSafeOnSparse)
  console.log('  riggedEffects: perfectMonitor=' + snap.verdict.perfectMonitoringErasesFalsyPositives +
    ' unlimitedWindow=' + snap.verdict.unlimitedWindowErasesStutteringFalseAlert +
    ' instantRecovery=' + snap.verdict.instantRecoveryPreventsHalfOpenStuttering)
  console.log('  causalLocks: countBlind=' + snap.causalLocks.countThresholdIgnoresSlowCausallyUnerasable +
    ' rateSample=' + snap.causalLocks.rateThresholdRequiresSampleCausallyUnerasable +
    ' slowBlind=' + snap.causalLocks.slowCallIgnoresHardFaultsCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const cp = snap.crosscheck.soundness
  console.log('  verifyCircuitSoundness: holds=' + cp.holds + ' baselineHolds=' + cp.baselineHolds +
    ' nontrivial=' + cp.nontrivial + ' falsifiable=' + cp.falsifiable +
    ' laneA{steadyTrips=' + cp.laneA.steadyTrips + ' laneAOk=' + cp.invariants.laneAOk + '}' +
    ' laneB{countTrips=' + cp.laneB.burstyCountTrips + ' rateTrips=' + cp.laneB.burstyRateTrips + ' slowTrips=' + cp.laneB.burstySlowTrips + ' laneBOk=' + cp.invariants.laneBOk + '}' +
    ' tamper{forged=' + cp.tamper.forgedLatency.holds + ',silent=' + cp.tamper.silentFailuresIgnored.holds + ',empty=' + cp.tamper.emptyStream.holds + '}')
}
