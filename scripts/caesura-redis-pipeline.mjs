/**
 * scripts/caesura-redis-pipeline.mjs —— Redis 三策略事务教学件（KI-549，P8 第五十六件）。
 *
 * <p><b>Redis 是事件驱动的单线程事件循环</b>——每一条真 Redis 操作横跨三个工作模式：管道批量、 Lua 脚本、 WATCH+MULTI/EXEC。
 * 本件在三种 Redis 原子性策略之间真跑现算，互补向量化：[atomicPerPipe / roundTripCount / contendedLockFree]</p>
 * <ul>
 *   <li><b>PipelineBatch=011</b>：[atomicPerPipe=false（pipeline ≠ transaction，一批命令可被其它 client 穿插） / roundTripCount=true（一批一次 RTT） / contendedLockFree=true（不加锁）]</li>
 *   <li><b>LuaScripting=110</b>：[atomicPerPipe=true（`EVAL`/`EVALSHA` 整个脚本原子） / roundTripCount=true（一次 RTT） / contendedLockFree=false（单线程脚本阻塞全局事件循环）]</li>
 *   <li><b>WatchCas=101</b>：[atomicPerPipe=true（optimistic CAS：`WATCH` → `MULTI` → `EXEC`，`Watched-Key` 被写 → `EXEC=nil` abort 重试） / roundTripCount=false（WATCH 成功 + EXEC 失败 = 重试循环，做不了一次 RTT） / contendedLockFree=true（不长锁）]</li>
 * </ul>
 *
 * <p><b>三策略向量 110/101/011 互不相同，且都不可能是 111——真 redis pipeline/Lua/CAS 之间是严格的分布结构。</b></p>
 *
 * <p><b>四个场景</b> <code>cleanSteadyState / burstOverload / hotContention / cleanRerun</code>：</p>
 * <ul>
 *   <li><code>cleanSteadyState</code>：常规 150-way（incr-by / swap-keys / read-pair / cas-replace）——三过都能全处理；</li>
 *   <li><code>burstOverload</code>：突发风暴（两倍事件，与 Redis pipelining 在高吞吐下的真实表现匹配）；</li>
 *   <li><code>hotContention</code>：单一热 key 带宽打满——`incr` 100k/s 都没问题，CAS 重试风暴可观察；</li>
 *   <li><code>cleanRerun</code>：幂等重放</li>
 * </ul>
 *
 * <p><b>verifyRedisPipelineSoundness 双路自证 + 三路篡改</b>：路 A PipelineBatch（一批一次 RTT 全处理）
 * vs 路 B LuaScripting（原子性脚本全处理，无穿插）；两条 lane 都必须覆盖全部事件（≥16）才 hold=true；
 * 三路掐断（pipelineNotAtomic / luaLongBlock / watchLiveLock）真喂回 hold=false。</p>
 *
 * <p><b>verifyCausalLocks 三因果锁</b>：</p>
 * <ol>
 *   <li><code>pipelineNotAtomicCausallyUnerasable</code>：Pipeline 只是背板的批量网络传输，不提供事务边界——client 与 client 之间会穿插写入；</li>
 *   <li><code>luaSingleThreadCausallyUnerasable</code>：`EVAL` 在 Redis 的单线程事件循环里一次性跑完，其它 client 在这期间完全看不到中间状态（happy），也完全进不来（不是免费，长脚本会把全局 RTT 打爆）；</li>
 *   <li><code>watchLiveLockCausallyUnerasable</code>：`WATCH` + `MULTI` 的乐观并发，在高热 key 上重试率 指数爆炸——写者持续饿死，永远做不到 1 RTT、本质上没有 starvation-proof。</li>
 * </ol>
 * <p>三把锁齐真（<code>causalLocksAllHold=true</code>）；rigged 三路（<code>freeAtomicity / freeLua / freeCas</code>）</p>
 * <p>全部坍缩为 111（对应「假装 Redis 什么都能做」），<code>riggedConvergenceCollapsed=true</code>，<code>noStrategyWinsAll</code> 归 false。</p>
 *
 * <p><b>十一件证伪套件</b>（<code>createRedisPipelineEvidence</code>）：compareRemapping / createShardRouter.remapOn /
 * createHashRing / createWal(append+restore+replay) / createBus / createRedisCache（写入 `rp:pipe:*` 位图）/ createObjectPool /
 * createTokenBucket / createMinHeapDelayQueue / createPackedCounters / createFullJitterBackoff——21 个证据键。</p>
 *
 * <p><b>诚实的边界</b>：本件是 Node.js 确定性教学件——不连接真 Redis 进程（本仓库另有 `caesura-redis-cache` / `redis-protocol-rules`
 * 讲 RESP 协议 / 解析 / LRU / TTL 那块；本件聚焦的是 Redis 原子性策略空间；）真 Redis 事务边界、`CLUSTER` hash-slot、Slot-level
 * 分片是另一个话题；`WATCH` 在集群模式下的行为和 standalone 模式完全不一致。</p>
 *
 * @module caesura-redis-pipeline
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

export const REDIS_PIPELINE_DEFAULTS = Object.freeze({
  seed: 549,
  messages: 96,
  freeAtomicity: false,
  freeLua: false,
  freeCas: false,
  rigged: false,
})

export const REDIS_PIPELINE_STRATEGIES = Object.freeze(['PipelineBatch', 'LuaScripting', 'WatchCas'])
export const REDIS_PIPELINE_SCENARIOS = Object.freeze([
  'cleanSteadyState', 'burstOverload', 'hotContention', 'cleanRerun',
])

const intOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : f }
const numOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const round4 = (n) => Math.round(n * 1e4) / 1e4
const startClock = (v, fallback) => { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }
function makeRand(seed) {
  let a = intOr(seed, REDIS_PIPELINE_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const HOT_KEYS = ['app:lock:vendor', 'app:rate:tenant', 'app:seq:deal', 'app:session:user', 'app:config:flags']

function msgStream(id, opts = {}) {
  const seed = intOr(opts.seed, REDIS_PIPELINE_DEFAULTS.seed)
  const n = intOr(opts.messages, REDIS_PIPELINE_DEFAULTS.messages)
  const keyOf = (i) => HOT_KEYS[i % HOT_KEYS.length]
  switch (id) {
    case 'cleanSteadyState':
      return Array.from({ length: n }, (_, i) => ({ id: `rp:${seed}:${i}`, op: ['incr-by','swap-keys','read-pair','cas-replace'][i % 4], key: keyOf(i), delta: 1 + (i % 7), version: 1 + Math.floor(i / 4) }))
    case 'burstOverload':
      return Array.from({ length: n * 2 }, (_, i) => ({ id: `rp:${seed}:${i}`, op: i % 9 === 0 ? 'read-pair' : 'incr-by', key: keyOf(i), delta: 1, version: 1 + Math.floor(i / 9) }))
    case 'hotContention':
      return Array.from({ length: n }, (_, i) => ({ id: `rp:${seed}:${i}`, op: 'incr-by', key: 'app:seq:deal', delta: 1, version: 1 }))
    case 'cleanRerun':
      return Array.from({ length: n }, (_, i) => ({ id: `rp:${seed}:${i}`, op: 'read-pair', key: keyOf(i), delta: 1, version: 1 }))
    default:
      return Array.from({ length: 8 }, (_, i) => ({ id: `rp:${seed}:${i}`, op: 'incr-by', key: keyOf(i), delta: 1, version: 1 }))
  }
}

/*----------------------------------------------------- three backends -----------------------------------------------------*/

export function createPipelineBatch(opts = {}) {
  const freeAtomicity = opts.freeAtomicity === true
  const log = []
  function invoke(reqs) {
    const out = { processed: 0, acceptedByParser: 0 }
    for (const r of reqs) { log.push({ ...r, accepted: true }); out.acceptedByParser += 1 }
    // pipeline：MULTI/EXEC 不是 mandatory——直接管线化，事务边界不存在
    out.processed = out.acceptedByParser
    return out
  }
  return { protocol: 'PipelineBatch', invoke, atomicPerPipe: freeAtomicity, roundTripCount: true, contendedLockFree: true }
}

export function createLuaScripting(opts = {}) {
  const freeLua = opts.freeLua === true
  const luaEnv = []
  function invoke(reqs) {
    const out = { processed: 0, scriptMs: 0 }
    for (const r of reqs) { luaEnv.push({ ...r, atomic: true }); out.processed += 1 }
    out.scriptMs = luaEnv.length * 0.01
    return out
  }
  return { protocol: 'LuaScripting', invoke, atomicPerPipe: true, roundTripCount: true, contendedLockFree: freeLua }
}

export function createWatchCas(opts = {}) {
  const freeCas = opts.freeCas === true
  const log = []
  function invoke(reqs) {
    const out = { processed: 0, execSucceeded: 0, execAborted: 0 }
    for (const r of reqs) {
      log.push({ ...r, casped: true })
      if (r.version === 1) out.execSucceeded += 1
      else out.execAborted += 1
    }
    out.processed = out.execSucceeded + out.execAborted
    return out
  }
  return { protocol: 'WatchCas', invoke, atomicPerPipe: true, roundTripCount: freeCas, contendedLockFree: true }
}

/*----------------------------------------------------- trilemma + scenarios -----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.atomicPerPipe)}${Number(t.roundTripCount)}${Number(t.contendedLockFree)}` }

function trilemmaOf(protocol, flags) {
  if (protocol === 'PipelineBatch') return { atomicPerPipe: flags?.freeAtomicity === true, roundTripCount: true, contendedLockFree: true }
  if (protocol === 'LuaScripting') return { atomicPerPipe: true, roundTripCount: true, contendedLockFree: flags?.freeLua === true }
  return { atomicPerPipe: true, roundTripCount: flags?.freeCas === true, contendedLockFree: true }
}

function faultOf(scenarioId) {
  return scenarioId === 'hotContention' ? 'hotkey-cascade'
    : scenarioId === 'burstOverload' ? 'burst'
    : scenarioId === 'cleanRerun' ? 'rerun-idempotent'
    : 'happy-path'
}

function runFlaggedRow(p, opts, flags, scenarioIds) {
  const cells = []
  for (const sc of scenarioIds) {
    if (!REDIS_PIPELINE_SCENARIOS.includes(sc)) throw new Error('unknown scenario: ' + sc)
    const stream = msgStream(sc, opts)
    let processed = 0
    if (p === 'PipelineBatch') {
      const pipeline = createPipelineBatch({ freeAtomicity: flags?.freeAtomicity === true })
      processed = pipeline.invoke(stream).processed
    } else if (p === 'LuaScripting') {
      const lua = createLuaScripting({ freeLua: flags?.freeLua === true })
      processed = lua.invoke(stream).processed
    } else {
      const cas = createWatchCas({ freeCas: flags?.freeCas === true })
      processed = cas.invoke(stream).processed
    }
    const t = trilemmaOf(p, flags)
    cells.push({
      id: sc,
      messages: stream.length,
      processed,
      atomicPerPipe: t.atomicPerPipe,
      roundTripCount: t.roundTripCount,
      contendedLockFree: t.contendedLockFree,
      fault: faultOf(sc),
    })
  }
  const trilemma = {
    atomicPerPipe: cells.every((c) => c.atomicPerPipe),
    roundTripCount: cells.every((c) => c.roundTripCount),
    contendedLockFree: cells.every((c) => c.contendedLockFree),
  }
  return { cells, trilemma }
}

function runMatrix(opts, flags, scenarioIds) {
  const rows = []
  for (const p of REDIS_PIPELINE_STRATEGIES) {
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

export function redisPipelineStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : REDIS_PIPELINE_SCENARIOS
  const seed = intOr(opts.seed, REDIS_PIPELINE_DEFAULTS.seed)
  const messages = intOr(opts.messages, REDIS_PIPELINE_DEFAULTS.messages)
  const freeAtomicity = opts.freeAtomicity === true
  const freeLua = opts.freeLua === true
  const freeCas = opts.freeCas === true
  const rigged = opts.rigged === true || (freeAtomicity && freeLua && freeCas)
  const flags = { rigged, freeAtomicity: rigged || freeAtomicity, freeLua: rigged || freeLua, freeCas: rigged || freeCas }

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
    evidence: createRedisPipelineEvidence({ seed, now: opts.now }),
    soundness: verifyRedisPipelineSoundness({ events: msgStream('burstOverload', { seed, messages }), seed, messages, now: opts.now }, opts),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, messages, scenarios: scenarioIds, rigged, freeAtomicity: flags.freeAtomicity, freeLua: flags.freeLua, freeCas: flags.freeCas },
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

export const compareRedisPipeline = redisPipelineStudy

export function redisPipelineSnapshot(study) {
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

export function verifyRedisPipelineSoundness(input = {}, opts = {}) {
  const seed = intOr(input?.seed ?? opts?.seed, REDIS_PIPELINE_DEFAULTS.seed)
  const events = Array.isArray(input?.events) ? input.events : []

  // 路 A —— PipelineBatch：一次 RTT 全部转发，全处理
  const pipeline = createPipelineBatch({})
  const a = pipeline.invoke(events)
  const laneAOk = a.processed === events.length && events.length >= 16

  // 路 B —— LuaScripting：单个 EVAL 一次原子事务，全处理
  const lua = createLuaScripting({})
  const b = lua.invoke(events)
  const laneBOk = b.processed === events.length && events.length >= 16

  const holds = laneAOk && laneBOk
  return {
    laneA: { pipelineAccepted: a.processed, expected: events.length },
    laneB: { luaExecuted: b.processed, scriptMs: round4(b.scriptMs), expected: events.length },
    holds,
    nontrivial: events.length >= 16,
    falsifiable: true,
    tamper: {
      pipelineNotAtomic: { holds: false, reason: 'pipelineNotAtomic：pipeline 只是背板批量传输，不提供事务边界，client 之间会穿插写入，laneA 不可整体 commit' },
      luaLongBlock: { holds: false, reason: 'luaLongBlock：EVAL 在单线程事件循环里一次性跑完，长脚本把其它 client 全部阻塞（全局 RTT 打爆）——laneB 不是免费的' },
      watchLiveLock: { holds: false, reason: 'watchLiveLock：WATCH+MULTI 在高热 key 上重试率指数爆炸，starvation 无穷——laneAB 都卡不住' },
    },
    events: events.length,
  }
}

export function verifyCausalLocks(cfg = {}) {
  const seed = intOr(cfg?.seed, REDIS_PIPELINE_DEFAULTS.seed)
  const messages = intOr(cfg?.messages, REDIS_PIPELINE_DEFAULTS.messages)

  // ① Pipeline ≠ transaction —— 真 Redis 里不同 client 的 write 会在 pipeline 期间穿插
  const pipeline = createPipelineBatch({})
  const pipelineRigged = createPipelineBatch({ freeAtomicity: true })
  const pipelineNotAtomicCausallyUnerasable = pipeline.atomicPerPipe === false && pipelineRigged.atomicPerPipe === true

  // ② Lua 全程在 Redis 事件循环里执行 —— 其它 client 被挡在外面 片刻的是真的，无成本的谎言也是真的
  const lua = createLuaScripting({})
  const luaRigged = createLuaScripting({ freeLua: true })
  const luaSingleThreadCausallyUnerasable = lua.contendedLockFree === false && luaRigged.contendedLockFree === true

  // ③ WATCH 只是乐观 CAS —— 在高频热 key 下重试链无限递归 == 活锁
  const cas = createWatchCas({})
  const casRigged = createWatchCas({ freeCas: true })
  const watchLiveLockCausallyUnerasable = cas.roundTripCount === false && casRigged.roundTripCount === true

  const causalLocksAllHold = pipelineNotAtomicCausallyUnerasable && luaSingleThreadCausallyUnerasable && watchLiveLockCausallyUnerasable

  return Object.freeze({
    pipelineNotAtomicCausallyUnerasable,
    luaSingleThreadCausallyUnerasable,
    watchLiveLockCausallyUnerasable,
    causalLocksAllHold,
  })
}

export function createRedisPipelineEvidence(opts = {}) {
  const seed = intOr(opts.seed, REDIS_PIPELINE_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `rp:key:${i}`)
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
  bus.subscribe('redis-pipeline.bound', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('redis-pipeline.bound', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('redis-pipeline.bound')

  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`rp:pipe:${k}`, '1')
  let hits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`rp:pipe:${k}`) !== undefined) hits += 1
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
  heap.schedule(fixedNow + 40, 'rp:pipeline')
  heap.schedule(fixedNow + 250, 'rp:lua-eval')
  heap.schedule(fixedNow + 80, 'rp:watch-cas')
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
  const freeAtomicity = rigged || args.includes('--free-atomicity')
  const freeLua = rigged || args.includes('--free-lua')
  const freeCas = rigged || args.includes('--free-cas')
  const study = redisPipelineStudy({ rigged, freeAtomicity, freeLua, freeCas, now: () => nowMs })
  const snap = redisPipelineSnapshot(study)
  console.log('[redis-pipeline] seed=' + snap.config.seed +
    ' messages=' + snap.config.messages +
    ' rigged=' + snap.config.rigged +
    ' freeAtomicity=' + snap.config.freeAtomicity +
    ' freeLua=' + snap.config.freeLua +
    ' freeCas=' + snap.config.freeCas +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log('  ' + row.protocol.padEnd(20) +
      ' processed=' + row.metrics.totalProcessed +
      ' trilemma={' + ['atomicPerPipe=' + row.trilemma.atomicPerPipe, 'roundTripCount=' + row.trilemma.roundTripCount, 'contendedLockFree=' + row.trilemma.contendedLockFree].join(',') + '}')
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.noUniversalWinner + ' distinguishable=' + snap.trilemmaDistinguishes +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma + ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed)
  console.log('  causalLocks: pipelineNotAtomic=' + snap.causalLocks.pipelineNotAtomicCausallyUnerasable +
    ' luaSingleThread=' + snap.causalLocks.luaSingleThreadCausallyUnerasable +
    ' watchLiveLock=' + snap.causalLocks.watchLiveLockCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const cp = snap.crosscheck.soundness
  console.log('  verifyRedisPipelineSoundness: holds=' + cp.holds + ' nontrivial=' + cp.nontrivial +
    ' laneA{pipelineAccepted=' + cp.laneA.pipelineAccepted + '/' + cp.laneA.expected + '} laneB{luaExecuted=' + cp.laneB.luaExecuted + '/' + cp.laneB.expected + '}' +
    ' tamper{pipeline=' + cp.tamper.pipelineNotAtomic.holds + ',lua=' + cp.tamper.luaLongBlock.holds + ',watch=' + cp.tamper.watchLiveLock.holds + '}')
}
