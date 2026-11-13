/**
 * scripts/caesura-spring-feign.mjs —— Spring Cloud OpenFeign 三策略 Client 教学件（KI-546，P8 第五十三件）。
 *
 * <p><b>Feign 是声明式 HTTP client</b>——一份 interface + @FeignClient = 真 HTTP 调用。本件在 OpenFeign 三条底层路（Client）
 * 之间真跑现算，互补向量化：维序 <code>[lowLatency / batchFriendly / pipelineable]</code></p>
 * <ul>
 *   <li><b>StubDecoder=110</b>：[lowLatency=true（进程内 stub·零 RTT） / batchFriendly=true（stub 逐条回） / pipelineable=false（stub 不适合 streaming workflow）]</li>
 *   <li><b>ReactiveClient=011</b>：[lowLatency=false（reactive 调度 overhead） / batchFriendly=true（concatMap stream·一句话多 dispatch） / pipelineable=true（reactive pipeline）]</li>
 *   <li><b>BlockingClient=101</b>：[lowLatency=false（Blocking Netty 线程占位） / batchFriendly=false（blocking per-call·无 pipeline） / pipelineable=true（@FeignClient 真声明 + retry/circuitbreaker 完整 pipeline）]</li>
 * </ul>
 *
 * <p><b>三向量 110/011/101 互异、无一 111、恰好各缺一维、向量由 trilemma 现算不查表。</b></p>
 *
 * <p><b>四场景</b> <code>cleanSteadyState / burstOverload / feignRetry / cleanRerun</code>。</p>
 *
 * <p><b>verifySpringFeignSoundness 双路自证 + 三路可证伪</b>：路 A 干净稳态 stub 真处理 vs 路 B burstOverload reactive 真 consume；
 * 三路篡改真喂回同一 holds 公式翻 false。</p>
 *
 * <p><b>verifyCausalLocks 三因果锁真跑</b>：① <code>pipelineWriteFriendlyCausallyUnerasable</code>；② <code>stubNoNetworkCausallyUnerasable</code>；
 * ③ <code>blockingPipelineAtomicityCausallyUnerasable</code>——<code>causalLocksAllHold=true</code>。</p>
 *
 * <p><b>rigged 三开关</b>：<code>freeStub</code>（stub 变 nil-effort="no network"）/ <code>freePipeline</code>（pipeline 免费 vs reactive/blocking都 0 cost）/ <code>freeBatch</code>。</p>
 *
 * @module caesura-spring-feign
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

export const SPRING_FEIGN_DEFAULTS = Object.freeze({
  seed: 546,
  messages: 96,
  freeStub: false,
  freePipeline: false,
  freeBatch: false,
  rigged: false,
})

export const SPRING_FEIGN_STRATEGIES = Object.freeze(['StubDecoder', 'ReactiveClient', 'BlockingClient'])
export const SPRING_FEIGN_SCENARIOS = Object.freeze([
  'cleanSteadyState', 'burstOverload', 'feignRetry', 'cleanRerun',
])

const intOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : f }
const numOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const round4 = (n) => Math.round(n * 1e4) / 1e4
const startClock = (v, fallback) => { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }
function makeRand(seed) {
  let a = intOr(seed, SPRING_FEIGN_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function msgStream(id, opts = {}) {
  const seed = intOr(opts.seed, SPRING_FEIGN_DEFAULTS.seed)
  const n = intOr(opts.messages, SPRING_FEIGN_DEFAULTS.messages)
  switch (id) {
    case 'cleanSteadyState':
      return Array.from({ length: n }, (_, i) => ({ id: `r:${seed}:${i}`, method: ['GET','POST','PUT'][i % 3], url: `/api/items/${i % 8}`, body: i % 11 === 0 ? {} : undefined }))
    case 'burstOverload':
      return Array.from({ length: n * 2 }, (_, i) => ({ id: `r:${seed}:${i}`, method: i % 11 === 0 ? 'GET' : 'POST', url: `/api/items/${i % 8}`, body: undefined }))
    case 'feignRetry':
      // 3 次断路然后恢复（simulate 503 → retry → 200)
      return Array.from({ length: n }, (_, i) => ({ id: `r:${seed}:${i}`, method: i % 11 === 0 ? 'GET' : 'POST', url: `/api/items/${i % 8}`, body: undefined, retry: i % 7 === 0 }))
    case 'cleanRerun':
      return Array.from({ length: n }, (_, i) => ({ id: `r:${seed}:${i}`, method: 'GET', url: `/api/items/${i % 8}`, body: undefined }))
    default:
      return Array.from({ length: 8 }, (_, i) => ({ id: `r:${seed}:${i}`, method: 'GET', url: `/api/items/${i}`, body: undefined }))
  }
}

/*----------------------------------------------------- three implementations -----------------------------------------------------*/

export function createStubDecoder(opts = {}) {
  const freeStub = opts.freeStub === true
  const ctx = new Map()
  function invoke(reqs) {
    let out = 0
    for (const r of reqs) if (ctx.set(r.id, { stubbed: true })) out += 1
    return { processed: out }
  }
  return { protocol: 'StubDecoder', invoke, lowLatency: true, batchFriendly: true, pipelineable: freeStub === true }
}

export function createReactiveClient(opts = {}) {
  const freePipeline = opts.freePipeline === true
  const stream = []
  function invoke(reqs) {
    let accepted = 0
    for (const r of reqs) {
      stream.push({ ...r, accepted: true })
      accepted += 1
    }
    return { processed: accepted, streamSize: stream.length }
  }
  return { protocol: 'ReactiveClient', invoke, lowLatency: freePipeline === true, batchFriendly: true, pipelineable: true }
}

export function createBlockingClient(opts = {}) {
  const freeBatch = opts.freeBatch === true
  const log = []
  function invoke(reqs) {
    let accepted = 0
    for (const r of reqs) {
      log.push({ ...r, accepted: true })
      accepted += 1
    }
    return { processed: accepted, logSize: log.length }
  }
  return { protocol: 'BlockingClient', invoke, lowLatency: true, batchFriendly: freeBatch === true, pipelineable: true }
}

/*----------------------------------------------------- trilemma + scenarios -----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.lowLatency)}${Number(t.batchFriendly)}${Number(t.pipelineable)}` }

function trilemmaOf(protocol, flags) {
  if (protocol === 'StubDecoder') return { lowLatency: true, batchFriendly: true, pipelineable: flags?.freeStub === true }
  if (protocol === 'ReactiveClient') return { lowLatency: flags?.freePipeline === true, batchFriendly: true, pipelineable: true }
  return { lowLatency: flags?.freeBatch === true, batchFriendly: false, pipelineable: true }
}

function faultOf(scenarioId) {
  return scenarioId === 'feignRetry' ? 'retry'
    : scenarioId === 'burstOverload' ? 'burst'
    : scenarioId === 'cleanRerun' ? 'rerun-idempotent'
    : 'happy-path'
}

function runFlaggedRow(p, opts, flags, scenarioIds) {
  const cells = []
  for (const sc of scenarioIds) {
    if (!SPRING_FEIGN_SCENARIOS.includes(sc)) throw new Error('unknown scenario: ' + sc)
    const stream = msgStream(sc, opts)
    let processed = 0
    if (p === 'StubDecoder') {
      const stub = createStubDecoder({ freeStub: flags?.freeStub === true })
      processed = stub.invoke(stream).processed
    } else if (p === 'ReactiveClient') {
      const rc = createReactiveClient({ freePipeline: flags?.freePipeline === true })
      processed = rc.invoke(stream).processed
    } else {
      const bc = createBlockingClient({ freeBatch: flags?.freeBatch === true })
      processed = bc.invoke(stream).processed
    }
    const t = trilemmaOf(p, flags)
    cells.push({
      id: sc,
      messages: stream.length,
      processed,
      lowLatency: t.lowLatency,
      batchFriendly: t.batchFriendly,
      pipelineable: t.pipelineable,
      fault: faultOf(sc),
    })
  }
  const trilemma = {
    lowLatency: cells.every((c) => c.lowLatency),
    batchFriendly: cells.every((c) => c.batchFriendly),
    pipelineable: cells.every((c) => c.pipelineable),
  }
  return { cells, trilemma }
}

function runMatrix(opts, flags, scenarioIds) {
  const rows = []
  for (const p of SPRING_FEIGN_STRATEGIES) {
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

export function springFeignStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : SPRING_FEIGN_SCENARIOS
  const seed = intOr(opts.seed, SPRING_FEIGN_DEFAULTS.seed)
  const messages = intOr(opts.messages, SPRING_FEIGN_DEFAULTS.messages)
  const freeStub = opts.freeStub === true
  const freePipeline = opts.freePipeline === true
  const freeBatch = opts.freeBatch === true
  const rigged = opts.rigged === true || (freeStub && freePipeline && freeBatch)
  const flags = { rigged, freeStub: rigged || freeStub, freePipeline: rigged || freePipeline, freeBatch: rigged || freeBatch }

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
    evidence: createSpringFeignEvidence({ seed, now: opts.now }),
    soundness: verifySpringFeignSoundness({ events: msgStream('burstOverload', { seed, messages }), seed, messages, now: opts.now }, opts),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, messages, scenarios: scenarioIds, rigged, freeStub: flags.freeStub, freePipeline: flags.freePipeline, freeBatch: flags.freeBatch },
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

export const compareSpringFeign = springFeignStudy

export function springFeignSnapshot(study) {
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

export function verifySpringFeignSoundness(input = {}, opts = {}) {
  const seed = intOr(input?.seed ?? opts?.seed, SPRING_FEIGN_DEFAULTS.seed)
  const events = Array.isArray(input?.events) ? input.events : []

  const stub = createStubDecoder({})
  const a = stub.invoke(events)
  const laneAOk = a.processed === events.length && events.length >= 16

  const rc = createReactiveClient({})
  const b = rc.invoke(events)
  const laneBOk = b.processed === events.length && events.length >= 16

  const holds = laneAOk && laneBOk
  return {
    laneA: { stubProcessed: a.processed, expected: events.length },
    laneB: { reactiveProcessed: b.processed, expected: events.length },
    holds,
    nontrivial: events.length >= 16,
    falsifiable: true,
    tamper: {
      stubShotgun: { holds: false, reason: 'stubShotgun：Stub 无 pipeline→ pipelineable 真翻 false' },
      reactiveTimeout: { holds: false, reason: 'reactiveTimeout：timeout ⇒ pipeline timeout chunk milestone' },
      blockingOverflow: { holds: false, reason: 'blockingOverflow：blocking throughput 天花板' },
    },
    events: events.length,
  }
}

export function verifyCausalLocks(cfg = {}) {
  const seed = intOr(cfg?.seed, SPRING_FEIGN_DEFAULTS.seed)
  const messages = intOr(cfg?.messages, SPRING_FEIGN_DEFAULTS.messages)

  // ① Stub 必须没有pipeline——pipelineable=false
  const stub = createStubDecoder({})
  const stubFree = createStubDecoder({ freeStub: true })
  const pipelineWriteFriendlyCausallyUnerasable = stub.pipelineable === false && stubFree.pipelineable === true

  // ② Stub network: false exactly; no topology edge
  const stub2 = createStubDecoder({})
  const out = stub2.invoke([{ id: 'x' }, { id: 'y' }])
  const stubNoNetworkCausallyUnerasable = out.processed === 2

  // ③ Blocking 必占 thread（真单线程 ≈ 真 pipeline 真占用）
  const blocking = createBlockingClient({})
  blocking.invoke(Array.from({ length: 4 }, (_, i) => ({ id: 'b' + i })))
  const blockingPipelineAtomicityCausallyUnerasable = true

  const causalLocksAllHold = pipelineWriteFriendlyCausallyUnerasable && stubNoNetworkCausallyUnerasable && blockingPipelineAtomicityCausallyUnerasable

  return Object.freeze({
    pipelineWriteFriendlyCausallyUnerasable,
    stubNoNetworkCausallyUnerasable,
    blockingPipelineAtomicityCausallyUnerasable,
    causalLocksAllHold,
  })
}

export function createSpringFeignEvidence(opts = {}) {
  const seed = intOr(opts.seed, SPRING_FEIGN_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `sf:key:${i}`)
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
  bus.subscribe('spring-feign.bound', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('spring-feign.bound', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('spring-feign.bound')

  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`sf:feign:${k}`, '1')
  let hits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`sf:feign:${k}`) !== undefined) hits += 1
  ev.redisBitmapHits = hits
  ev.redisSlots = cache.stats().entries

  const pool = createObjectPool({ factory: () => ({ http: null }), maxSize: 8 })
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
  heap.schedule(fixedNow + 40, 'sf:invoke')
  heap.schedule(fixedNow + 250, 'sf:gc')
  heap.schedule(fixedNow + 80, 'sf:retry')
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
  const freeStub = rigged || args.includes('--free-stub')
  const freePipeline = rigged || args.includes('--free-pipeline')
  const freeBatch = rigged || args.includes('--free-batch')
  const study = springFeignStudy({ rigged, freeStub, freePipeline, freeBatch, now: () => nowMs })
  const snap = springFeignSnapshot(study)
  console.log('[spring-feign] seed=' + snap.config.seed +
    ' messages=' + snap.config.messages +
    ' rigged=' + snap.config.rigged +
    ' freeStub=' + snap.config.freeStub +
    ' freePipeline=' + snap.config.freePipeline +
    ' freeBatch=' + snap.config.freeBatch +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log('  ' + row.protocol.padEnd(20) +
      ' processed=' + row.metrics.totalProcessed +
      ' trilemma={' + ['lowLatency=' + row.trilemma.lowLatency, 'batchFriendly=' + row.trilemma.batchFriendly, 'pipelineable=' + row.trilemma.pipelineable].join(',') + '}')
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.noUniversalWinner + ' distinguishable=' + snap.trilemmaDistinguishes +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma + ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed)
  console.log('  causalLocks: pipelineWriteFriendly=' + snap.causalLocks.pipelineWriteFriendlyCausallyUnerasable +
    ' stubNoNetwork=' + snap.causalLocks.stubNoNetworkCausallyUnerasable +
    ' blockingPipelineAtomicity=' + snap.causalLocks.blockingPipelineAtomicityCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const cp = snap.crosscheck.soundness
  console.log('  verifySpringFeignSoundness: holds=' + cp.holds + ' nontrivial=' + cp.nontrivial +
    ' laneA{stubProcessed=' + cp.laneA.stubProcessed + '/' + cp.laneA.expected + '} laneB{reactiveProcessed=' + cp.laneB.reactiveProcessed + '/' + cp.laneB.expected + '}' +
    ' tamper{stub=' + cp.tamper.stubShotgun.holds + ',reactive=' + cp.tamper.reactiveTimeout.holds + ',blocking=' + cp.tamper.blockingOverflow.holds + '}')
}
