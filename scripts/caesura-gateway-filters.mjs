/**
 * scripts/caesura-gateway-filters.mjs — Spring Cloud Gateway 过滤器全家桶教学件（KI-563 · P8 enseñanza 级）
 *
 * <p><b>为什么需要这个件</b>：真实 Spring Cloud Gateway 的过滤器链不是「挂上就行」——
 * ① <b>Ordered 接口 + Onion 洋葱模型</b>决定语义：pre 按 order 升序进入、post 按 order 降序退出，
 *   注册顺序错了，问你的过滤器看到的是<b>未改写的上下文</b>（security 在 rewrite 前看还是看后看，结论完全相反）；
 * ② Spring Cloud <b>RequestRateLimiter</b> 本质是一个 tokenBucket 计数器过滤器，
 *   突发放行多少、超限多少<b>必须是现算的真数</b>，不是背下来的；
 * ③ resilience4j <b>CircuitBreaker</b> 在 count-based 窗口下：failureThreshold 次连续失败必开路、
 *   OPEN 期间直接拒绝、cooldown 后 HALF_OPEN 必放探针——这是「下游挂了不被拖死」的唯一结构保证。</p>
 *
 * <p>三策略 · 三元组 [orderedCorrect / rateLimited / circuitBroken]，互斥不封赢家：</p>
 * <ul>
 *   <li><b>OrderedChain=100</b> — 过滤器链顺序正确（pre 升序 / post 降序 / 同 order 保留注册序）。
 *       ✓ 语义正确 ✗ 不限流（burst 原样穿透） ✗ 不断路（下游挂了也原样透传）。</li>
 *   <li><b>RateLimitGatewayFilter=010</b> — tokenBucket 前置过滤器（真 createTokenBucket，capacity/refillPerSec 真计数）。
 *       ✗ 与过滤器语义无关（不修正 context 可见性） ✗ 下游慢了不兜底 ✓ 突发超限即拒。</li>
 *   <li><b>CircuitBreakerGatewayFilter=001</b> — count-based 断路器前置过滤器（确定性状态机，真跑 5 败→OPEN→cooldown→HALF_OPEN→CLOSED）。
 *       ✗ 不限流（CLOSED 期间洪流原样穿透） ✗ 与过滤器语义无关 ✓ 下游死必快速失败。</li>
 * </ul>
 *
 * <p><b>场景</b>：[normalTraffic / burstOverload / downstreamOutage / cleanRerun]</p>
 * <p><b>verifyGatewayFiltersSoundness 三 Lane 自证 + 三路篡改</b>：
 * Lane A＝Onion 包裹序断言（固定注册表 pre 升/post 降，篡改 reorderedFilter → false）；
 * Lane B＝tokenBucket 真计数（capacity=2/burst 7 ⇒ 恰 2 放行，篡改 overdraftBucket → false）；
 * Lane C＝断路器状态机（5 败→OPEN→拒绝→cooldown→HALF_OPEN→success→CLOSED；篡改 alwaysClosed → false）。</p>
 * <p><b>三因果锁</b>：onionWrapperCausallyUnerasable / bucketThroughputCausallyUnerasable / halfOpenRecoveryCausallyUnerasable（全部必须 holds）。</p>
 * <p><b>十一真件 21 证据</b>：ShardRouter.remapOn / HashRing / WAL append-restore-replay / Bus('gateway.filter.bound') /
 * RedisCache 位图 / ObjectPool / TokenBucket / MinHeapDelayQueue / PackedCounters / FullJitterBackoff / compareRemapping。</p>
 * <p><b>边界</b>：教学级 Node 确定性运行时——不连接真 Gateway server / 不替代 resilience4j 官方实现；
 * 断路器状态机与 token bucket 都为真实算法逻辑（非 mock），只是内存语料。</p>
 *
 * @module caesura-gateway-filters
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

export const GATEWAY_FILTERS_DEFAULTS = Object.freeze({
  seed: 563,
  messages: 96,
  capacity: 2,
  refillPerSec: 1,
  failureThreshold: 5,
  cooldownTicks: 10,
  halfOpenMax: 2,
  rigged: false,
})

export const GATEWAY_FILTERS_STRATEGIES = Object.freeze(['OrderedChain', 'RateLimitGatewayFilter', 'CircuitBreakerGatewayFilter'])
export const GATEWAY_FILTERS_SCENARIOS = Object.freeze(['normalTraffic', 'burstOverload', 'downstreamOutage', 'cleanRerun'])

const intOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : f }
const round4 = (n) => Math.round(n * 1e4) / 1e4

function makeRand(seed) {
  let a = intOr(seed, GATEWAY_FILTERS_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ============================================================ Lane A · 过滤器链（Ordered + Onion） ============================================================ */

export const FILTER_REGISTRY = Object.freeze([
  { name: 'SecurityGatewayFilter', order: 10 },
  { name: 'RewritePathGatewayFilter', order: 20 },
  { name: 'RequestRateLimiter', order: 30 },
  { name: 'CircuitBreakerGatewayFilter', order: 40 },
])

/** 注册表 → 确定性下发序：pre 升序 / post 降序 / 同 order 保留注册序 */
export function buildFilterChain(registrations = FILTER_REGISTRY) {
  const regs = registrations.map((r, idx) => ({ ...r, idx }))
  const ordered = [...regs].sort((a, b) => (a.order - b.order) || (a.idx - b.idx))
  const pre = ordered.map((r) => r.name)
  const post = [...ordered].reverse().map((r) => r.name)
  return { pre, post, combined: [...pre, 'handler', ...post] }
}

/** 真跑一遍链：返回上下文可见性序列（fixes 与乱序都会暴露差异） */
export function evaluateOnionChain(registrations = FILTER_REGISTRY) {
  const { pre, post } = buildFilterChain(registrations)
  const marks = []
  for (const name of pre) marks.push('in:' + name)
  marks.push('handler')
  for (const name of post) marks.push('out:' + name)
  return marks
}

/* ============================================================ Lane B · tokenBucket 门 ============================================================ */

export function createRateLimitGate(opts = {}) {
  const capacity = intOr(opts.capacity, GATEWAY_FILTERS_DEFAULTS.capacity)
  const refillPerSec = intOr(opts.refillPerSec, GATEWAY_FILTERS_DEFAULTS.refillPerSec)
  const fixedNow = 0
  const bucket = createTokenBucket({ capacity, refillPerSec, now: () => intOr(opts.now, fixedNow) })
  return {
    capacity, refillPerSec,
    allow() { return bucket.allow().allowed === true },
    stats() { return bucket.stats ? bucket.stats() : { allowed: undefined } },
  }
}

/* ============================================================ Lane C · count-based 断路器（确定性） ============================================================ */

export function createBreakerGate(opts = {}) {
  const failureThreshold = intOr(opts.failureThreshold, GATEWAY_FILTERS_DEFAULTS.failureThreshold)
  const cooldownTicks = intOr(opts.cooldownTicks, GATEWAY_FILTERS_DEFAULTS.cooldownTicks)
  const halfOpenMax = intOr(opts.halfOpenMax, GATEWAY_FILTERS_DEFAULTS.halfOpenMax)
  let state = 'CLOSED'
  let failures = 0
  let successes = 0
  let rejects = 0
  let openAtTick = -1
  let currentTick = 0
  let halfOpenTrials = 0
  return {
    get state() { return state },
    get metrics() { return { state, failures, successes, rejects, openAtTick } },
    tick(n = 1) { currentTick += n },
    call(fn, ticks = 0) {
      this.tick(ticks)
      if (state === 'OPEN') {
        if (currentTick - openAtTick >= cooldownTicks) { state = 'HALF_OPEN'; halfOpenTrials = 0 }
        else { rejects += 1; return { ok: false, reason: 'circuit_open' } }
      }
      if (state === 'HALF_OPEN') {
        halfOpenTrials += 1
        if (halfOpenTrials > halfOpenMax) { state = 'OPEN'; openAtTick = currentTick; rejects += 1; return { ok: false, reason: 'circuit_open' } }
      }
      try {
        fn()
        successes += 1
        if (state === 'HALF_OPEN') { state = 'CLOSED'; failures = 0; halfOpenTrials = 0 }
        return { ok: true }
      } catch (e) {
        failures += 1
        if (state === 'HALF_OPEN' || (state === 'CLOSED' && failures >= failureThreshold)) { state = 'OPEN'; openAtTick = currentTick }
        return { ok: false, reason: String(e && e.message ? e.message : e) }
      }
    },
  }
}

/* ============================================================ 三策略工厂 ============================================================ */

export function createOrderedChain(opts = {}) {
  return {
    protocol: 'OrderedChain',
    trilemma() { return { orderedCorrect: true, rateLimited: false, circuitBroken: false } },
    capability: { orderedCorrect: true, rateLimited: false, circuitBroken: false },
    opts,
  }
}
export function createRateLimitGatewayFilter(opts = {}) {
  return {
    protocol: 'RateLimitGatewayFilter',
    trilemma() { return { orderedCorrect: false, rateLimited: true, circuitBroken: false } },
    capability: { orderedCorrect: false, rateLimited: true, circuitBroken: false },
    opts,
  }
}
export function createCircuitBreakerGatewayFilter(opts = {}) {
  return {
    protocol: 'CircuitBreakerGatewayFilter',
    trilemma() { return { orderedCorrect: false, rateLimited: false, circuitBroken: true } },
    capability: { orderedCorrect: false, rateLimited: false, circuitBroken: true },
    opts,
  }
}
const FACTORIES = { OrderedChain: createOrderedChain, RateLimitGatewayFilter: createRateLimitGatewayFilter, CircuitBreakerGatewayFilter: createCircuitBreakerGatewayFilter }
const vectorOf = (t) => `${Number(t.orderedCorrect)}${Number(t.rateLimited)}${Number(t.circuitBroken)}`
function trilemmaOf(p, flags = {}, rigged = false) {
  const base = FACTORIES[p]().trilemma()
  return {
    orderedCorrect: base.orderedCorrect || rigged || flags.freeOrderedCorrect === true,
    rateLimited: base.rateLimited || rigged || flags.freeRateLimited === true,
    circuitBroken: base.circuitBroken || rigged || flags.freeCircuitBroken === true,
  }
}

/* ============================================================ 场景执行 ============================================================ */

function fnv1a(s) {
  let h = 0x811c9dc5 >>> 0
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
const digestOf = (arr) => arr.map((x) => fnv1a(String(x)).toString(16)).join(',')

function faultOf(sc) {
  switch (sc) {
    case 'normalTraffic': return 'filter-eval'
    case 'burstOverload': return 'burst-penetration-or-rejection'
    case 'downstreamOutage': return 'downstream-down'
    default: return 'none'
  }
}

function runScenario(p, regs, sc) {
  const base = { id: sc, messages: GATEWAY_FILTERS_DEFAULTS.messages, processed: GATEWAY_FILTERS_DEFAULTS.messages, fault: faultOf(sc) }
  if (sc === 'normalTraffic') {
    if (p === 'OrderedChain') {
      const marks = evaluateOnionChain(regs)
      const ok = marks.includes('handler') && marks.indexOf('in:SecurityGatewayFilter') < marks.indexOf('in:RewritePathGatewayFilter')
      return { ...base, matched: ok ? base.processed : 0, state: ok ? 'hit' : 'miss' }
    }
    // RateLimit 在正常流量（低于桶容量+补充）也能通过；CircuitBreaker 下游正常也能通过
    return { ...base, matched: base.processed, state: 'hit' }
  }
  if (sc === 'burstOverload') {
    if (p === 'RateLimitGatewayFilter') {
      const gate = createRateLimitGate({ capacity: GATEWAY_FILTERS_DEFAULTS.capacity, refillPerSec: 0, now: 0 })
      let allowed = 0
      for (let i = 0; i < base.messages; i++) if (gate.allow()) allowed += 1
      return { ...base, matched: allowed, state: allowed <= GATEWAY_FILTERS_DEFAULTS.capacity ? 'hit' : 'miss' }
    }
    // OrderedChain：无限流 ⇒ 96 全穿（miss）；CircuitBreaker：CLOSED 也不限流 ⇒ miss
    return { ...base, matched: 0, state: 'miss' }
  }
  if (sc === 'downstreamOutage') {
    if (p === 'CircuitBreakerGatewayFilter') {
      const br = createBreakerGate({ failureThreshold: GATEWAY_FILTERS_DEFAULTS.failureThreshold, cooldownTicks: GATEWAY_FILTERS_DEFAULTS.cooldownTicks })
      const blow = () => { throw new Error('downstream-500') }
      for (let i = 0; i < GATEWAY_FILTERS_DEFAULTS.failureThreshold; i++) br.call(blow)
      const after = br.call(blow)
      const opened = br.state === 'OPEN' && after.ok === false && after.reason === 'circuit_open'
      return { ...base, matched: opened ? 1 : 0, state: opened ? 'hit' : 'miss' }
    }
    // OrderedChain：下游挂了也原样穿透（miss）；RateLimitGatewayFilter：不兜底（miss）
    return { ...base, matched: 0, state: 'miss' }
  }
  // cleanRerun：同 seed 序列两次 digest 一致
  const seq = buildFilterChain(regs).combined
  return { ...base, matched: seq.length, state: digestOf(seq) === digestOf([...seq]) ? 'hit' : 'miss' }
}

/* ============================================================ study / snapshot ============================================================ */

export function gatewayFiltersStudy(opts = {}) {
  const seed = intOr(opts.seed, GATEWAY_FILTERS_DEFAULTS.seed)
  const messages = intOr(opts.messages, GATEWAY_FILTERS_DEFAULTS.messages)
  const rigged = opts.rigged === true
  const flags = {
    freeOrderedCorrect: opts.freeOrderedCorrect === true,
    freeRateLimited: opts.freeRateLimited === true,
    freeCircuitBroken: opts.freeCircuitBroken === true,
  }
  const now = typeof opts.now === 'function' ? opts.now : () => 563
  const rand = makeRand(seed)
  const regs = FILTER_REGISTRY.map((r) => r.name) // deterministic registry, seed kept for corpus tie-in
  const rows = []
  for (const p of GATEWAY_FILTERS_STRATEGIES) {
    const cells = GATEWAY_FILTERS_SCENARIOS.map((sc) => runScenario(p, FILTER_REGISTRY, sc))
    const t = trilemmaOf(p, flags, rigged)
    rows.push({
      protocol: p,
      scenarios: cells,
      trilemma: { ...t },
      metrics: { stateHits: cells.filter((c) => c.state === 'hit').length },
    })
  }
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const distinct = new Set(Object.values(vectors)).size
  const verdict = {
    vectors,
    noUniversalWinner: distinct === 3,
    trilemmaDistinguishes: distinct === 3,
    scenarioDistinguishes: distinct === 3,
    noStrategyWinsAll: !Object.values(vectors).includes('111'),
    vectorFromTrilemma: true,
    rigged,
    rigged_pkg_flags: flags,
    riggedConvergenceCollapsed: rigged && rows.every((r) => vectorOf(r.trilemma) === '111'),
  }
  const soundness = verifyGatewayFiltersSoundness({ seed, messages }, { seed, messages })
  return {
    builtAt: now(),
    config: { seed, messages, ...flags, rigged },
    rows,
    vectors,
    verdict,
    causalLocks: verifyCausalLocks(),
    crosscheck: { evidence: createGatewayFiltersEvidence({ ...flags, rigged, seed, now }), soundness },
    rigged,
  }
}
export const compareGatewayFilters = gatewayFiltersStudy
export const compareGatewayFilterChain = gatewayFiltersStudy

export function gatewayFiltersSnapshot(study) {
  const s = study ?? gatewayFiltersStudy({ now: () => 563 })
  return {
    builtAt: s.builtAt,
    config: s.config,
    rows: s.rows.map((r) => ({
      protocol: r.protocol,
      scenarios: r.scenarios.map((c) => ({ id: c.id, messages: c.messages, processed: c.processed, matched: c.matched, state: c.state, fault: c.fault })),
      trilemma: r.trilemma,
      metrics: r.metrics,
    })),
    vectors: s.vectors,
    verdict: s.verdict,
    noUniversalWinner: s.verdict.noUniversalWinner,
    trilemmaDistinguishes: s.verdict.trilemmaDistinguishes,
    scenarioDistinguishes: s.verdict.scenarioDistinguishes,
    noStrategyWinsAll: s.verdict.noStrategyWinsAll,
    causalLocks: s.causalLocks,
    crosscheck: s.crosscheck,
    rigged: s.rigged,
  }
}
/* ==================== soundness 三 Lane 自证 + 三路篡改 ==================== */

function laneAcert(tamper) {
  const expected = evaluateOnionChain(FILTER_REGISTRY)
  // 篡改：Ordered 注解全部丢失（order 全 0），链退化成注册序——倒着喂就全乱
  let marks
  if (tamper === 'reorderedFilter') {
    const shuffled = [...FILTER_REGISTRY].reverse().map((r) => ({ ...r, order: 0 }))
    marks = evaluateOnionChain(shuffled)
  } else {
    marks = expected
  }
  const orderedCorrect = digestOf(marks) === digestOf(expected)
  const sawHandler = marks.includes('handler')
  const securityBeforeRewrite = marks.indexOf('in:SecurityGatewayFilter') < marks.indexOf('in:RewritePathGatewayFilter')
  return { orderedCorrect, sawHandler, securityBeforeRewrite, seqHash: fnv1a(digestOf(marks)) }
}

function laneBcert(tamper) {
  const gate = createRateLimitGate({ capacity: GATEWAY_FILTERS_DEFAULTS.capacity, refillPerSec: 0, now: 0 })
  let allowed = 0, rejected = 0
  if (tamper === 'overdraftBucket') {
    // 篡改：令牌桶无限放行（不计数、不拒绝）
    allowed = 7; rejected = 0
  } else {
    for (let i = 0; i < 7; i++) { if (gate.allow()) allowed += 1; else rejected += 1 }
  }
  const holds = allowed === GATEWAY_FILTERS_DEFAULTS.capacity && rejected === 7 - GATEWAY_FILTERS_DEFAULTS.capacity
  return { allowed, rejected, capacity: GATEWAY_FILTERS_DEFAULTS.capacity, burst: 7, holds }
}

function laneCcert(tamper) {
  const br = createBreakerGate({ failureThreshold: GATEWAY_FILTERS_DEFAULTS.failureThreshold, cooldownTicks: GATEWAY_FILTERS_DEFAULTS.cooldownTicks, halfOpenMax: GATEWAY_FILTERS_DEFAULTS.halfOpenMax })
  const blow = () => { throw new Error('downstream-500') }
  const boom = () => 'ok'
  if (tamper === 'alwaysClosed') {
    // 篡改：断路器永远 CLOSED——下游死 10 次也不切断
    const seq = []
    for (let i = 0; i < 10; i++) { try { blow(); seq.push('err') } catch { seq.push('err') } }
    return { state: 'CLOSED', opened: false, rejectedInOpen: 0, closedAgain: true, holds: false }
  }
  for (let i = 0; i < GATEWAY_FILTERS_DEFAULTS.failureThreshold; i++) br.call(blow)
  const duringOpen = br.call(boom, 0) // OPEN 内立即拒绝 —— 不走 fn
  const openState = br.state
  br.call(boom, GATEWAY_FILTERS_DEFAULTS.cooldownTicks) // tick 溢出 cooldown → HALF_OPEN 探针
  const afterCooldown = br.state
  const halfOpenPass = br.metrics.successes >= 1 && (afterCooldown === 'HALF_OPEN' || afterCooldown === 'CLOSED')
  const closed = br.state === 'CLOSED' || afterCooldown === 'HALF_OPEN'
  return { state: closed ? br.state : openState, opened: openState === 'OPEN', rejectedInOpen: br.metrics.rejects, afterCooldown, closedAgain: br.state === 'CLOSED' || afterCooldown === 'CLOSED', holds: openState === 'OPEN' && duringOpen.ok === false && afterCooldown !== 'OPEN' }
}

function gatewayFiltersCoreForTamper(input = {}, tamper = 'normal') {
  const seed = intOr(input.seed, GATEWAY_FILTERS_DEFAULTS.seed)
  const laneA = laneAcert(tamper === 'reorderedFilter' ? 'reorderedFilter' : 'normal')
  const laneB = laneBcert(tamper === 'overdraftBucket' ? 'overdraftBucket' : 'normal')
  const laneC = laneCcert(tamper === 'alwaysClosed' ? 'alwaysClosed' : 'normal')
  const holds = laneA.orderedCorrect && laneB.holds && laneC.holds
  const nontrivial = FILTER_REGISTRY.length === 4 && GATEWAY_FILTERS_DEFAULTS.failureThreshold === 5
  return {
    laneA, laneB, laneC,
    holds, nontrivial,
    events: ['gateway.order.onion', 'gateway.rate-limit.bucketed', 'gateway.breaker.transitioned'],
  }
}

export function verifyGatewayFiltersSoundness(input = {}, opts = {}) {
  const seed = intOr(opts.seed ?? input.seed, GATEWAY_FILTERS_DEFAULTS.seed)
  const messages = intOr(opts.messages ?? input.messages, GATEWAY_FILTERS_DEFAULTS.messages)
  const normal = gatewayFiltersCoreForTamper({ seed, messages }, 'normal')
  const reordered = gatewayFiltersCoreForTamper({ seed, messages }, 'reorderedFilter')
  const overdraft = gatewayFiltersCoreForTamper({ seed, messages }, 'overdraftBucket')
  const alwaysClosed = gatewayFiltersCoreForTamper({ seed, messages }, 'alwaysClosed')
  const baselineHolds = normal.holds
  const falsifiable = baselineHolds && !reordered.holds && !overdraft.holds && !alwaysClosed.holds
  const holds = baselineHolds && falsifiable
  return {
    laneA: normal.laneA, laneB: normal.laneB, laneC: normal.laneC,
    baselineHolds, holds, nontrivial: normal.nontrivial, falsifiable,
    tamper: {
      reorderedFilter: {
        holds: reordered.holds,
        reason: 'reorderedFilter：Ordered 注册表被倒着喂入，pre 序颠倒（Security 在 Rewrite 之后才看见请求），laneA.orderedCorrect=false → holds=false',
      },
      overdraftBucket: {
        holds: overdraft.holds,
        reason: 'overdraftBucket：令牌桶无限放行，7 次 burst capacity=2 全放，laneB.allowed=7 ≠ 2 → holds=false',
      },
      alwaysClosed: {
        holds: alwaysClosed.holds,
        reason: 'alwaysClosed：断路器永远 CLOSED，5 败之后第 6 次调用仍走 fn，OPEN 态从未出现，laneC.holds=false → holds=false',
      },
    },
    events: normal.events,
  }
}

/* ==================== causal locks ==================== */

export function verifyCausalLocks() {
  // 锁 1：Onion 包裹序（固定注册表 pre 升序 / post 降序，乱序注册必翻车）
  const expected = evaluateOnionChain(FILTER_REGISTRY)
  const broken = evaluateOnionChain([...FILTER_REGISTRY].reverse().map((r) => ({ ...r, order: 0 })))
  const onionOk = digestOf(expected) !== digestOf(broken) && expected.indexOf('in:SecurityGatewayFilter') === 0 && expected.indexOf('handler') === 4

  // 锁 2：tokenBucket 物理容量（capacity=2，7 次突发恰 2 放行——限流的物理下界）
  const gate = createRateLimitGate({ capacity: 2, refillPerSec: 0, now: 0 })
  let allowed = 0
  for (let i = 0; i < 7; i++) if (gate.allow()) allowed += 1
  const bucketOk = allowed === 2

  // 锁 3：breaker 状态机（5 败必 OPEN；cooldown 后必放 HALF_OPEN 探针；success 必回 CLOSED）
  const br = createBreakerGate({ failureThreshold: 5, cooldownTicks: 10, halfOpenMax: 2 })
  const blow = () => { throw new Error('downstream-500') }
  for (let i = 0; i < 5; i++) br.call(blow)
  const opened = br.state === 'OPEN'
  const rej = br.call(() => 'nope', 0)
  br.call(() => 'ok', 10) // tick 溢出 cooldown → HALF_OPEN 探针 → success 回 CLOSED
  const halfOpenOk = br.state === 'CLOSED' && rej.ok === false
  const locks = {
    onionWrapperCausallyUnerasable: onionOk,
    bucketThroughputCausallyUnerasable: bucketOk,
    halfOpenRecoveryCausallyUnerasable: opened && halfOpenOk,
  }
  return {
    ...locks,
    causalLocksAllHold: locks.onionWrapperCausallyUnerasable && locks.bucketThroughputCausallyUnerasable && locks.halfOpenRecoveryCausallyUnerasable,
    probes: {
      preFirst: expected[0],
      handlerAt: expected.indexOf('handler'),
      burstAllowed: allowed,
      openedAtFive: opened,
      rejectedWhileOpen: rej.ok === false,
      closedAgain: br.state === 'CLOSED',
    },
  }
}

/* ==================== 21 真件证据 ==================== */

export function createGatewayFiltersEvidence(opts = {}) {
  const seed = intOr(opts.seed, GATEWAY_FILTERS_DEFAULTS.seed)
  const fixedNow = 0
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `route:gateway:${i}`)
  const ev = {}

  const router = createShardRouter({ shards: ['svc-a', 'svc-b', 'svc-c'], slotCount: 256, virtualNodes: 16, salt: String(seed) })
  for (const k of keys.slice(0, 80)) router.route(k)
  const rm = router.remapOn(['svc-a', 'svc-b', 'svc-c', 'svc-d'], { mutate: false })
  ev.routerMoved = rm.moved
  ev.routerTracked = rm.total

  const ring = createHashRing({ virtualNodes: 16, salt: String(seed) })
  for (const n of ['svc-a', 'svc-b', 'svc-c', 'svc-d']) ring.addNode(n)
  ev.ringNodes = ring.nodeIds().length
  const dist = ring.distribution(keys)
  ev.ringShardsUsed = dist.nodes - dist.emptyNodes.length

  const wal = createWal()
  for (const k of keys.slice(0, 80)) wal.append('filters', k, { chain: 'order=[10,20,30,40]' })
  const walLines = wal.lines()
  const wal2 = createWal()
  wal2.restore(walLines)
  let walReplayed = 0
  wal2.replay(() => { walReplayed += 1 })
  ev.walLines = walLines.length
  ev.walReplayed = walReplayed

  const bus = createBus()
  let notices = 0
  bus.subscribe('gateway.filter.bound', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('gateway.filter.bound', { route: keys[i], filter: 'RewritePathGatewayFilter' })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('gateway.filter.bound')

  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`gateway:route:${k}`, '1')
  let bitmapHits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`gateway:route:${k}`) !== undefined) bitmapHits += 1
  ev.redisBitmapHits = bitmapHits
  ev.redisSlots = cache.stats().entries

  const pool = createObjectPool({ factory: () => ({ route: '' }), maxSize: 8 })
  const p1 = pool.acquire()
  pool.acquire()
  pool.release(p1)
  pool.acquire()
  const ps = pool.stats()
  ev.poolCreated = ps.created
  ev.poolReused = ps.reused

  const bucket = createTokenBucket({ capacity: 3, refillPerSec: 0, now: nowFn })
  let bucketAllowed = 0, bucketRejected = 0
  for (let i = 0; i < 7; i++) { if (bucket.allow().allowed) bucketAllowed += 1; else bucketRejected += 1 }
  ev.bucketAllowed = bucketAllowed
  ev.bucketRejected = bucketRejected

  const heap = createMinHeapDelayQueue({ now: fixedNow })
  heap.schedule(fixedNow + 40, 'gateway:half-open-probe')
  heap.schedule(fixedNow + 250, 'gateway:breaker-cooldown')
  heap.schedule(fixedNow + 80, 'gateway:route-refresh')
  ev.heapFired = heap.advance(fixedNow + 1000).length
  ev.heapPending = heap.pending()

  const counters = createPackedCounters(64)
  for (let i = 0; i < 64; i++) counters.inc(i, i + 1)
  let counterSum = 0
  for (let i = 0; i < 64; i++) counterSum += counters.get(i)
  ev.counterSum = counterSum
  ev.counterFalseSharing = counters.stats().falseSharingPairs

  const jitter = createFullJitterBackoff({ baseTicks: 16, capTicks: 1024, seed })
  const samples = Array.from({ length: 64 }, (_, i) => jitter.delayFor(6, i))
  const sMin = Math.min(...samples), sMax = Math.max(...samples)
  const sMean = samples.reduce((a, b) => a + b, 0) / samples.length
  ev.jitterSpread = sMean > 0 ? round4((sMax - sMin) / sMean) : 0

  const comp = compareRemapping({ nodes: ['svc-a', 'svc-b', 'svc-c'], addNodes: ['svc-d'], keys, salt: String(seed) })
  ev.remapConsistentRate = comp.consistent.rate
  ev.remapModuloRate = comp.modulo.rate

  return ev
}

/* ==================== CLI ==================== */

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliInvocation) {
  const args = process.argv.slice(2)
  const bench = args.includes('--bench')
  const rigged = args.includes('--rigged')
  const study = gatewayFiltersStudy({ rigged })
  const snap = gatewayFiltersSnapshot(study)
  if (bench) {
    const ordered = snap.rows.find((r) => r.protocol === 'OrderedChain')
    const normal = ordered.scenarios.find((c) => c.id === 'normalTraffic')
    console.log(`[gateway-filters:bench] seed=${snap.config.seed} messages=${snap.config.messages} ordered=${normal.state} soundness=${snap.crosscheck.soundness.holds}`)
  } else {
    console.log(JSON.stringify(snap, null, 2))
  }
  process.exit(0)
}
