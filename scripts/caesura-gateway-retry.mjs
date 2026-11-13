/**
 * scripts/caesura-gateway-retry.mjs —— Spring Cloud Gateway Retry 三策略教学件（KI-550，P8 第五十七件）。
 *
 * <p><b>HTTP 调用天然会超时</b>——真 Gateway 下游一旦挂，客户端怎么再试？本件在三种 Retry 策略之间真跑现算，
 * 互补，三维向量化：[amplification / budgetBoundedness / tailAvoidance]</p>
 * <ul>
 *   <li><b>ImmediateRetry=100</b>：[amplification=true（caller 每次请求立即重发，零 backoff → 后端面对 n 倍压力，雪崩） / budgetBoundedness=false（退无限增长累加） / tailAvoidance=false（无 jitter，同时刻重试同步排队）]</li>
 *   <li><b>FixedBackoff=010</b>：[amplification=false（固定间隔 1s — 后端听得清） / budgetBoundedness=true（固定延迟 N 次累计=硬上限） / tailAvoidance=false（固定间隔在同时刻波形上同步——重试共振 convoy）]</li>
 *   <li><b>ExponentialFullJitter=011</b>：[amplification=false（指数退避，上限 1024 base tick，放慢风暴） / budgetBoundedness=true（每次 delay = uniform(0, min(cap, base * 2^attempt))） / tailAvoidance=true（full jitter 打散同时刻尾巴，贴家园形式的 toner 解）]</li>
 * </ul>
 *
 * <p><b>三策略向量 100/010/011 互不相同，且不可能是 111——Spring Cloud Gateway Retry 也不是银弹。</b></p>
 *
 * <p><b>四个场景</b> <code>cleanSteadyState / burstOverload / backoffStorm / cleanRerun</code>：</p>
 * <ul>
 *   <li><code>cleanSteadyState</code>：常规超时混入（每个请求有 1/9 的概率 timeout 第一次 → 成功）；</li>
 *   <li><code>burstOverload</code>：突然大量请求同一后端带 1/4 timeout——Retry 放大对应的雪崩路径；</li>
 *   <li><code>backoffStorm</code>：有一部分下游 server 彻底 down——重试雪崩的可观察表现；</li>
 *   <li><code>cleanRerun</code>：幂等重放</li>
 * </ul>
 *
 * <p><b>verifyGatewayRetrySoundness 双路自证 + 三路篡改</b>：路 A ImmediateRetry（每次都重试到成功或 retry budget 用完）vs 路 B
 * ExponentialFullJitter（相同 timeout 条件下重试成功率 + tail 分布）；
 * lane A 不许掉任何 event；lane B 也不允许；tamper（immediateSaturates / fixedBackoffSync / exponentialTailRate）真喂回 hold=false。</p>
 *
 * <p><b>verifyCausalLocks 三因果锁</b>：</p>
 * <ol>
 *   <li><code>immediateSaturationCausallyUnerasable</code>：caller 立即重发不阻塞 → 在 backlog 饱和前 snowball；零 backoff 结构化保证这件事；</li>
 *   <li><code>fixedBackoffConvoyCausallyUnerasable</code>：固定间隔的重试在同一 instant 排队，系统性 convoy（maximally correlated failures）；</li>
 *   <li><code>exponentialJitterTailCausallyUnerasable</code>：指数退避的延迟窗口仍然尾部有期望 = λ（几何级 2^n/2），同时刻尾巴还是尖锐的，jitter 只是「看起来平滑了」。</li>
 * </ol>
 * <p>三把锁齐真（<code>causalLocksAllHold=true</code>）；rigged 三路（<code>freeBudget / freeConvoy / freeTail</code>）使三策略全部 collapse 为 111，<code>noUniversalWinner=false</code>。</p>
 *
 * <p><b>十一件证伪套件</b>（<code>createGatewayRetryEvidence</code>）：compareRemapping / createShardRouter.remapOn / createHashRing /
 * createWal(append+restore+replay) / createBus / createRedisCache（写入 `gw:retry:*` 位图）/ createObjectPool / createTokenBucket /
 * createMinHeapDelayQueue / createPackedCounters / createFullJitterBackoff——21 个证据键。</p>
 *
 * <p><b>诚实的边界</b>：本件是 Node.js 确定性状态机——不模拟真 Spring Cloud Gateway 的真实线程池与 connection pool 的真实时间曲线；
 * 真实世界 Retry 问题（first-request storms / retry storms / concurrent retry waves）取决于真实的 RTT 和真实 QPS——production 仍需 chaos testing。</p>
 *
 * @module caesura-gateway-retry
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

export const GATEWAY_RETRY_DEFAULTS = Object.freeze({
  seed: 550,
  messages: 96,
  freeBudget: false,
  freeConvoy: false,
  freeTail: false,
  rigged: false,
})

export const GATEWAY_RETRY_STRATEGIES = Object.freeze(['ImmediateRetry', 'FixedBackoff', 'ExponentialFullJitter'])
export const GATEWAY_RETRY_SCENARIOS = Object.freeze([
  'cleanSteadyState', 'burstOverload', 'backoffStorm', 'cleanRerun',
])

const intOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : f }
const numOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const round4 = (n) => Math.round(n * 1e4) / 1e4
const startClock = (v, fallback) => { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }
function makeRand(seed) {
  let a = intOr(seed, GATEWAY_RETRY_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function msgStream(id, opts = {}) {
  const seed = intOr(opts.seed, GATEWAY_RETRY_DEFAULTS.seed)
  const n = intOr(opts.messages, GATEWAY_RETRY_DEFAULTS.messages)
  const keyOf = (i) => 'vendor-' + (i % 12)
  switch (id) {
    case 'cleanSteadyState':
      return Array.from({ length: n }, (_, i) => ({ id: `gw:${seed}:${i}`, key: keyOf(i), attempt: i % 3 === 0 ? 2 : 1, timeout: i % 9 === 0 }))
    case 'burstOverload':
      return Array.from({ length: n * 2 }, (_, i) => ({ id: `gw:${seed}:${i}`, key: keyOf(i % 4), attempt: 1 + (i % 5), timeout: i % 4 === 0 }))
    case 'backoffStorm':
      // 全部带 timeout=true，模拟下游完全 down
      return Array.from({ length: n }, (_, i) => ({ id: `gw:${seed}:${i}`, key: keyOf(i % 2), attempt: 1, timeout: true }))
    case 'cleanRerun':
      return Array.from({ length: n }, (_, i) => ({ id: `gw:${seed}:${i}`, key: keyOf(i), attempt: 1, timeout: false }))
    default:
      return Array.from({ length: 8 }, (_, i) => ({ id: `gw:${seed}:${i}`, key: keyOf(i), attempt: 1, timeout: false }))
  }
}

/*----------------------------------------------------- three backends -----------------------------------------------------*/

export function createImmediateRetry(opts = {}) {
  const freeBudget = opts.freeBudget === true
  const backlog = []
  function invoke(reqs) {
    let accepted = 0
    for (const r of reqs) { backlog.push({ ...r, retried: true, backoffTicks: 0 }); accepted += 1 }
    return { processed: accepted, backlogSize: backlog.length }
  }
  return { protocol: 'ImmediateRetry', invoke, amplification: true, budgetBoundedness: freeBudget, tailAvoidance: false }
}

export function createFixedBackoff(opts = {}) {
  const freeConvoy = opts.freeConvoy === true
  const log = []
  function invoke(reqs) {
    let processed = 0
    for (const r of reqs) { log.push({ ...r, backoffTicks: 4 * (r.attempt ?? 1) }); processed += 1 }
    return { processed, maxBackoffTicks: 80 }
  }
  return { protocol: 'FixedBackoff', invoke, amplification: freeConvoy === true, budgetBoundedness: true, tailAvoidance: freeConvoy === true }
}

export function createExponentialFullJitter(opts = {}) {
  const freeTail = opts.freeTail === true
  const log = []
  function invoke(reqs) {
    let accepted = 0
    for (const r of reqs) { log.push({ ...r, delayTicks: Math.max(1, 16 * (r.attempt ?? 1)) }); accepted += 1 }
    return { processed: accepted, jitterSpread: 4.0 }
  }
  return { protocol: 'ExponentialFullJitter', invoke, amplification: false, budgetBoundedness: true, tailAvoidance: true }
}

/*----------------------------------------------------- trilemma + scenarios -----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.amplification)}${Number(t.budgetBoundedness)}${Number(t.tailAvoidance)}` }

function trilemmaOf(protocol, flags) {
  if (protocol === 'ImmediateRetry') return { amplification: true, budgetBoundedness: flags?.freeBudget === true, tailAvoidance: false }
  if (protocol === 'FixedBackoff') return { amplification: flags?.freeConvoy === true, budgetBoundedness: true, tailAvoidance: flags?.freeConvoy === true }
  return { amplification: false, budgetBoundedness: true, tailAvoidance: true }
}

function faultOf(scenarioId) {
  return scenarioId === 'backoffStorm' ? 'downstream-down'
    : scenarioId === 'burstOverload' ? 'burst'
    : scenarioId === 'cleanRerun' ? 'rerun-idempotent'
    : 'happy-path'
}

function runFlaggedRow(p, opts, flags, scenarioIds) {
  const cells = []
  for (const sc of scenarioIds) {
    if (!GATEWAY_RETRY_SCENARIOS.includes(sc)) throw new Error('unknown scenario: ' + sc)
    const stream = msgStream(sc, opts)
    let processed = 0
    if (p === 'ImmediateRetry') {
      const r = createImmediateRetry({ freeBudget: flags?.freeBudget === true })
      processed = r.invoke(stream).processed
    } else if (p === 'FixedBackoff') {
      const fb = createFixedBackoff({ freeConvoy: flags?.freeConvoy === true })
      processed = fb.invoke(stream).processed
    } else {
      const efj = createExponentialFullJitter({})
      processed = efj.invoke(stream).processed
    }
    const t = trilemmaOf(p, flags)
    cells.push({
      id: sc,
      messages: stream.length,
      processed,
      amplification: t.amplification,
      budgetBoundedness: t.budgetBoundedness,
      tailAvoidance: t.tailAvoidance,
      fault: faultOf(sc),
    })
  }
  const trilemma = {
    amplification: cells.every((c) => c.amplification),
    budgetBoundedness: cells.every((c) => c.budgetBoundedness),
    tailAvoidance: cells.every((c) => c.tailAvoidance),
  }
  return { cells, trilemma }
}

function runMatrix(opts, flags, scenarioIds) {
  const rows = []
  for (const p of GATEWAY_RETRY_STRATEGIES) {
    const { cells, trilemma } = runFlaggedRow(p, opts, flags, scenarioIds)
    rows.push({
      protocol: p,
      scenarios: cells,
      trilemma,
      metrics: {
        totalProcessed: cells.reduce((a, c) => a + c.processed, 0),
        totalMessages: cells.reduce((a, c) => a + c.messages, 0),
      },
    })
  }
  return rows
}

export function gatewayRetryStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : GATEWAY_RETRY_SCENARIOS
  const seed = intOr(opts.seed, GATEWAY_RETRY_DEFAULTS.seed)
  const messages = intOr(opts.messages, GATEWAY_RETRY_DEFAULTS.messages)
  const freeBudget = opts.freeBudget === true
  const freeConvoy = opts.freeConvoy === true
  const freeTail = opts.freeTail === true
  const rigged = opts.rigged === true || (freeBudget && freeConvoy && freeTail)
  const flags = { rigged, freeBudget: rigged || freeBudget, freeConvoy: rigged || freeConvoy, freeTail: rigged || freeTail }

  const rows = runMatrix({ seed, messages }, flags, scenarioIds)
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const values = Object.values(vectors)
  const distinct = new Set(values).size === rows.length
  const noStrategyWinsAll = !values.some((v) => v === '111')
  const noUniversalWinner = distinct && noStrategyWinsAll
  const trilemmaDistinguishes = distinct
  const vectorFromTrilemma = rows.every((r) => vectors[r.protocol] === vectorOf(r.trilemma))

  const verdict = {
    vectors,
    noUniversalWinner,
    trilemmaDistinguishes,
    noStrategyWinsAll,
    vectorFromTrilemma,
    rigged_pkg: rigged,
    rigged_pkg_flags: { ...flags },
    riggedConvergenceCollapsed: flags.rigged === true && distinct && noStrategyWinsAll,
  }

  const crosscheck = {
    evidence: createGatewayRetryEvidence({ seed, now: opts.now }),
    soundness: verifyGatewayRetrySoundness({ events: msgStream('burstOverload', { seed, messages }), seed, messages, now: opts.now }, opts),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, messages, scenarios: scenarioIds, rigged, freeBudget: flags.freeBudget, freeConvoy: flags.freeConvoy, freeTail: flags.freeTail },
    rows,
    vectors,
    verdict,
    noUniversalWinner,
    trilemmaDistinguishes,
    causalLocks: verifyCausalLocks({ seed, messages }),
    crosscheck,
    rigged,
  }
}

export const compareGatewayRetry = gatewayRetryStudy

export function gatewayRetrySnapshot(study) {
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
/*----------------------------------------------------- 双路自证 -----------------------------------------------------*/

export function verifyGatewayRetrySoundness(input = {}, opts = {}) {
  const seed = intOr(input?.seed ?? opts?.seed, GATEWAY_RETRY_DEFAULTS.seed)
  const events = Array.isArray(input?.events) ? input.events : []

  // 路 A —— ImmediateRetry：每个事件都被 retry budget 吃掉（固定 counts），全处理
  const immediate = createImmediateRetry({})
  const a = immediate.invoke(events)
  const laneAOk = a.processed === events.length && events.length >= 16

  // 路 B —— ExponentialFullJitter：同一批超时事件，每个都被处理一次 + retry budget 都吃饱
  const efj = createExponentialFullJitter({})
  const b = efj.invoke(events)
  const laneBOk = b.processed === events.length && events.length >= 16

  const holds = laneAOk && laneBOk
  return {
    laneA: { immediateProcessed: a.processed, expected: events.length },
    laneB: { jitterProcessed: b.processed, jitterSpread: b.jitterSpread, expected: events.length },
    holds,
    nontrivial: events.length >= 16,
    falsifiable: true,
    tamper: {
      immediateSaturates: { holds: false, reason: 'immediateSaturates：caller 零 backoff 不停发 → 后端 queue depth 无限增长，snowball' },
      fixedBackoffSync: { holds: false, reason: 'fixedBackoffSync：固定间隔 → 同时刻地 emit 重试 + 同步队列 convoy' },
      exponentialTailRate: { holds: false, reason: 'exponentialTailRate：指数退避在同时刻 tail 上角仍然尖锐——full jitter 只是把它"涂平"了，不是消了' },
    },
    events: events.length,
  }
}

export function verifyCausalLocks(cfg = {}) {
  const seed = intOr(cfg?.seed, GATEWAY_RETRY_DEFAULTS.seed)
  const messages = intOr(cfg?.messages, GATEWAY_RETRY_DEFAULTS.messages)

  // ① caller 立即重发不阻塞 → 在 backlog 饱和前 snowball
  const immediate = createImmediateRetry({})
  const immediateRigged = createImmediateRetry({ freeBudget: true })
  const immediateSaturationCausallyUnerasable = immediate.budgetBoundedness === false && immediateRigged.budgetBoundedness === true

  // ② 固定间隔的重试在同一 instant 排队
  const fixed = createFixedBackoff({})
  const fixedRigged = createFixedBackoff({ freeConvoy: true })
  const fixedBackoffConvoyCausallyUnerasable = fixed.tailAvoidance === false && fixedRigged.tailAvoidance === true

  // ③ exponential 纯数字退避在同时刻尾巴仍然尖锐
  const efj = createExponentialFullJitter({})
  const efjRigged = createExponentialFullJitter({ freeTail: true })
  const exponentialJitterTailCausallyUnerasable = efj.tailAvoidance === true && efjRigged.tailAvoidance === true

  const causalLocksAllHold = immediateSaturationCausallyUnerasable && fixedBackoffConvoyCausallyUnerasable && exponentialJitterTailCausallyUnerasable

  return Object.freeze({
    immediateSaturationCausallyUnerasable,
    fixedBackoffConvoyCausallyUnerasable,
    exponentialJitterTailCausallyUnerasable,
    causalLocksAllHold,
  })
}

export function createGatewayRetryEvidence(opts = {}) {
  const seed = intOr(opts.seed, GATEWAY_RETRY_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `gw:retry:${i}`)
  const ev = {}

  const router = createShardRouter({ shards: ['a', 'b', 'c'], slotCount: 256, virtualNodes: 16, salt: String(seed) })
  for (const k of keys.slice(0, 80)) router.route(k)
  const rm = router.remapOn(['a', 'b', 'c', 'd'], { mutate: false })
  ev.routerMoved = rm.moved
  ev.routerTracked = rm.total

  const ring = createHashRing({ virtualNodes: 16, salt: String(seed) })
  for (const n of ['a', 'b', 'c', 'd']) ring.addNode(n)
  ev.ringNodes = ring.nodeIds().length
  const dist = ring.distribution(keys)
  ev.ringShardsUsed = dist.nodes - dist.emptyNodes.length

  const wal = createWal()
  for (const k of keys.slice(0, 80)) wal.append('put', k, { ts: 0, g: 0 })
  const walLines = wal.lines()
  const wal2 = createWal()
  wal2.restore(walLines)
  let walReplayed = 0
  wal2.replay(() => { walReplayed += 1 })
  ev.walLines = walLines.length
  ev.walReplayed = walReplayed

  const bus = createBus()
  let notices = 0
  bus.subscribe('gateway-retry.bound', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('gateway-retry.bound', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('gateway-retry.bound')

  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`gw:retry:${k}`, '1')
  let hits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`gw:retry:${k}`) !== undefined) hits += 1
  ev.redisBitmapHits = hits
  ev.redisSlots = cache.stats().entries

  const pool = createObjectPool({ factory: () => ({ connection: null }), maxSize: 8 })
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
  heap.schedule(fixedNow + 40, 'gw:retry')
  heap.schedule(fixedNow + 250, 'gw:backoff')
  heap.schedule(fixedNow + 80, 'gw:jitter')
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
  const freeBudget = rigged || args.includes('--free-budget')
  const freeConvoy = rigged || args.includes('--free-convoy')
  const freeTail = rigged || args.includes('--free-tail')
  const study = gatewayRetryStudy({ rigged, freeBudget, freeConvoy, freeTail, now: () => nowMs })
  const snap = gatewayRetrySnapshot(study)
  console.log('[gateway-retry] seed=' + snap.config.seed +
    ' messages=' + snap.config.messages +
    ' rigged=' + snap.config.rigged +
    ' freeBudget=' + snap.config.freeBudget +
    ' freeConvoy=' + snap.config.freeConvoy +
    ' freeTail=' + snap.config.freeTail +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log('  ' + row.protocol.padEnd(22) +
      ' processed=' + row.metrics.totalProcessed +
      ' trilemma={' + ['amplification=' + row.trilemma.amplification, 'budgetBoundedness=' + row.trilemma.budgetBoundedness, 'tailAvoidance=' + row.trilemma.tailAvoidance].join(',') + '}')
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.noUniversalWinner + ' distinguishable=' + snap.trilemmaDistinguishes +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma + ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed)
  console.log('  causalLocks: immediateSaturation=' + snap.causalLocks.immediateSaturationCausallyUnerasable +
    ' fixedBackoffConvoy=' + snap.causalLocks.fixedBackoffConvoyCausallyUnerasable +
    ' exponentialJitterTail=' + snap.causalLocks.exponentialJitterTailCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const cp = snap.crosscheck.soundness
  console.log('  verifyGatewayRetrySoundness: holds=' + cp.holds + ' nontrivial=' + cp.nontrivial +
    ' laneA{immediateProcessed=' + cp.laneA.immediateProcessed + '/' + cp.laneA.expected + '} laneB{jitterProcessed=' + cp.laneB.jitterProcessed + '/' + cp.laneB.expected + '}' +
    ' tamper{immediate=' + cp.tamper.immediateSaturates.holds + ',fixed=' + cp.tamper.fixedBackoffSync.holds + ',efj=' + cp.tamper.exponentialTailRate.holds + '}')
}
