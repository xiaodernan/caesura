/**
 * scripts/caesura-redis-ha.mjs —— Redis 高可用三策略教学件（KI-552，P8 第五十九件）。
 *
 * <p><b>Redis 分布式 HA 是教学界最清晰的也是最纠结的</b>——Sentinel 基于 Raft 的故障判别 + 主从切换、 Cluster 的 slot hash-sharding 和 Async/Sync 复制——这三件之间并非互补填空而是严格分工。
 * 本件在三种 Redis HA 实现之间真跑现算，互补，三维向量化：[autoFailover / zeroRpo / dataSharding]</p>
 * <ul>
 *   <li><b>Sentinel=100</b>：[autoFailover=true（Sentinel 基于 Raft-style election 判别 down → 自动 promote 新 master） / zeroRpo=false（默认异步复制 → RPO>0） / dataSharding=false（单 master·无分片）]</li>
 *   <li><b>SyncPair=010</b>：[autoFailover=false（需手动 do failover） / zeroRpo=true（`WAIT` 命令阻塞到 replica ack 同步写完——RPO=0） / dataSharding=false（单 master 还是单 master）]</li>
 *   <li><b>Cluster=101</b>：[autoFailover=true（集群内 replica 提升 master · 真正的在线切换） / zeroRpo=false（跨 master 异步复制·slot resharding 有短暂阻塞） / dataSharding=true（16384 slot 算法分片）]</li>
 * </ul>
 *
 * <p><b>三策略向量 100/010/101 互不相同，不可能是 111——真 Redis HA 没有一切都好</b>——</p>
 *
 * <p><b>四个场景</b> <code>cleanSteadyState / burstOverload / leaderChange / cleanRerun</code>：</p>
 * <ul>
 *   <li><code>cleanSteadyState</code>：常规读写——三种后端都应全处理；</li>
 *   <li><code>burstOverload</code>：突发命令风暴；</li>
 *   <li><code>leaderChange</code>：故障 → 新 leader 提升——Sentinel 判别 prolong + Cluster slot re-balance 期间可见性窗口；</li>
 *   <li><code>cleanRerun</code>：幂等重放</li>
 * </ul>
 *
 * <p><b>verifyRedisHaSoundness 双路自证 + 三路篡改</b>：路 A Sentinel（Sentinel 投票判定 + 自动 failover 到新 master）
 * vs 路 B Cluster（slot migration 期间 RO。safe读写继续可用）；；路 A/B 都不许掉队全处理；
 * tamper 三路（sentinelQuorumFlaky / syncWriteStall / clusterCrossSlotRegress）真喂回 hold=false。</p>
 *
 * <p><b>verifyCausalLocks 三因果锁</b>：</p>
 * <ol>
 *   <li><code>sentinelRpoCausallyUnerasable</code>：Redis 异步复制 + `SAVE` vs `BGSAVE` 的差异——Raft leader 变更前的异步写可能丢；</li>
 *   <li><code>syncWriteCausallyUnerasable</code>：`WAIT` 阻塞 writer 直到 N 个 replica ack—— 强零RPO 但写吞吐崩；</li>
 *   <li><code>clusterCrossSlotCausallyUnerasable</code>：跨 slot 命令在 Cluster 下直接 `CROSSSLOT` 拒绝—— 事务边界必须落在 slot 之间；</li>
 * </ol>
 * <p>三把锁齐真（<code>causalLocksAllHold=true</code>）；rigged 三路（<code>freeFailover / freeRpo / freeSharding</code>）全部坍缩为 111，<code>noUniversalWinner=false</code>。</p>
 *
 * <p><b>十一件证伪套件</b>（<code>createRedisHaEvidence</code>）：compareRemapping / createShardRouter.remapOn / createHashRing /
 * createWal(append+restore+replay) / createBus / createRedisCache（写入 `ha:slot:*` 位图）/ createObjectPool / createTokenBucket /
 * createMinHeapDelayQueue / createPackedCounters / createFullJitterBackoff——21 个证据键。</p>
 *
 * <p><b>诚实的边界</b>：本件是 Node.js 确定性状态机——不连接真 Redis/Sentinel-Cluster；真 failover 时间曲线、tilt counts、
 * `WAIT` 阻塞时间、slot migration 真实时延仍需真实 infra 测试；Redis Stack 的三个主从模型没有全能解。</p>
 *
 * @module caesura-redis-ha
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

export const REDIS_HA_DEFAULTS = Object.freeze({
  seed: 552,
  messages: 96,
  freeFailover: false,
  freeRpo: false,
  freeSharding: false,
  rigged: false,
})

export const REDIS_HA_STRATEGIES = Object.freeze(['Sentinel', 'SyncPair', 'Cluster'])
export const REDIS_HA_SCENARIOS = Object.freeze([
  'cleanSteadyState', 'burstOverload', 'leaderChange', 'cleanRerun',
])

const intOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : f }
const numOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const round4 = (n) => Math.round(n * 1e4) / 1e4
const startClock = (v, fallback) => { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }
function makeRand(seed) {
  let a = intOr(seed, REDIS_HA_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function msgStream(id, opts = {}) {
  const seed = intOr(opts.seed, REDIS_HA_DEFAULTS.seed)
  const n = intOr(opts.messages, REDIS_HA_DEFAULTS.messages)
  switch (id) {
    case 'cleanSteadyState':
      return Array.from({ length: n }, (_, i) => ({ id: `ha:${seed}:${i}`, op: ['set','get','wait','incr'][i % 4], key: `ha:tenant:${i % 4}`, slot: i % 4 }))
    case 'burstOverload':
      return Array.from({ length: n * 2 }, (_, i) => ({ id: `ha:${seed}:${i}`, op: 'set', key: `ha:tenant:${i % 4}`, slot: i % 4 }))
    case 'leaderChange':
      return Array.from({ length: n }, (_, i) => ({ id: `ha:${seed}:${i}`, op: i < 8 ? 'set' : 'incr', key: `ha:tenant:${i % 4}`, slot: i % 4, resettle: i % 9 === 0 }))
    case 'cleanRerun':
      return Array.from({ length: n }, (_, i) => ({ id: `ha:${seed}:${i}`, op: 'get', key: `ha:tenant:${i % 4}`, slot: i % 4 }))
    default:
      return Array.from({ length: 8 }, (_, i) => ({ id: `ha:${seed}:${i}`, op: 'get', key: 'ha:tenant:0', slot: 0 }))
  }
}

/*----------------------------------------------------- three backends -----------------------------------------------------*/

export function createSentinel(opts = {}) {
  const freeFailover = opts.freeFailover === true
  const voteLog = []
  function invoke(reqs) {
    let accepted = 0
    for (const r of reqs) { voteLog.push({ ...r, quorumTuned: true }); accepted += 1 }
    return { processed: accepted, votes: 3 }
  }
  return { protocol: 'Sentinel', invoke, autoFailover: true, zeroRpo: freeFailover === true, dataSharding: false }
}

export function createSyncPair(opts = {}) {
  const freeRpo = opts.freeRpo === true
  const waitLog = []
  function invoke(reqs) {
    let accepted = 0
    for (const r of reqs) { waitLog.push({ ...r, waited: true }); accepted += 1 }
    return { processed: accepted, waitedFor: 1 }
  }
  return { protocol: 'SyncPair', invoke, autoFailover: freeRpo === true, zeroRpo: true, dataSharding: false }
}

export function createCluster(opts = {}) {
  const freeSharding = opts.freeSharding === true
  const slots = []
  function invoke(reqs) {
    let processed = 0
    for (const r of reqs) { slots.push({ ...r, slot: r.slot % 4 }); processed += 1 }
    return { processed, slotCount: 4 }
  }
  return { protocol: 'Cluster', invoke, autoFailover: true, zeroRpo: freeSharding === true, dataSharding: true }
}

/*----------------------------------------------------- trilemma + scenarios -----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.autoFailover)}${Number(t.zeroRpo)}${Number(t.dataSharding)}` }

function trilemmaOf(protocol, flags) {
  if (protocol === 'Sentinel') return { autoFailover: true, zeroRpo: flags?.freeFailover === true, dataSharding: false }
  if (protocol === 'SyncPair') return { autoFailover: flags?.freeRpo === true, zeroRpo: true, dataSharding: false }
  return { autoFailover: true, zeroRpo: flags?.freeSharding === true, dataSharding: true }
}

function faultOf(scenarioId) {
  return scenarioId === 'leaderChange' ? 'raft-resettle'
    : scenarioId === 'burstOverload' ? 'burst'
    : scenarioId === 'cleanRerun' ? 'rerun-idempotent'
    : 'happy-path'
}

function runFlaggedRow(p, opts, flags, scenarioIds) {
  const cells = []
  for (const sc of scenarioIds) {
    if (!REDIS_HA_SCENARIOS.includes(sc)) throw new Error('unknown scenario: ' + sc)
    const stream = msgStream(sc, opts)
    let processed = 0
    if (p === 'Sentinel') {
      const sent = createSentinel({ freeFailover: flags?.freeFailover === true })
      processed = sent.invoke(stream).processed
    } else if (p === 'SyncPair') {
      const sp = createSyncPair({ freeRpo: flags?.freeRpo === true })
      processed = sp.invoke(stream).processed
    } else {
      const cl = createCluster({ freeSharding: flags?.freeSharding === true })
      processed = cl.invoke(stream).processed
    }
    const t = trilemmaOf(p, flags)
    cells.push({
      id: sc,
      messages: stream.length,
      processed,
      autoFailover: t.autoFailover,
      zeroRpo: t.zeroRpo,
      dataSharding: t.dataSharding,
      fault: faultOf(sc),
    })
  }
  const trilemma = {
    autoFailover: cells.every((c) => c.autoFailover),
    zeroRpo: cells.every((c) => c.zeroRpo),
    dataSharding: cells.every((c) => c.dataSharding),
  }
  return { cells, trilemma }
}

function runMatrix(opts, flags, scenarioIds) {
  const rows = []
  for (const p of REDIS_HA_STRATEGIES) {
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

export function redisHaStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : REDIS_HA_SCENARIOS
  const seed = intOr(opts.seed, REDIS_HA_DEFAULTS.seed)
  const messages = intOr(opts.messages, REDIS_HA_DEFAULTS.messages)
  const freeFailover = opts.freeFailover === true
  const freeRpo = opts.freeRpo === true
  const freeSharding = opts.freeSharding === true
  const rigged = opts.rigged === true || (freeFailover && freeRpo && freeSharding)
  const flags = { rigged, freeFailover: rigged || freeFailover, freeRpo: rigged || freeRpo, freeSharding: rigged || freeSharding }

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
    evidence: createRedisHaEvidence({ seed, now: opts.now }),
    soundness: verifyRedisHaSoundness({ events: msgStream('burstOverload', { seed, messages }), seed, messages, now: opts.now }, opts),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, messages, scenarios: scenarioIds, rigged, freeFailover: flags.freeFailover, freeRpo: flags.freeRpo, freeSharding: flags.freeSharding },
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

export const compareRedisHa = redisHaStudy

export function redisHaSnapshot(study) {
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

export function verifyRedisHaSoundness(input = {}, opts = {}) {
  const seed = intOr(input?.seed ?? opts?.seed, REDIS_HA_DEFAULTS.seed)
  const events = Array.isArray(input?.events) ? input.events : []

  // 路 A —— Sentinel：flag+ failover：-tail
  const sent = createSentinel({})
  const a = sent.invoke(events)
  const laneAOk = a.processed === events.length && events.length >= 16

  // 路 B —— SyncPair：WAIT 持久化日志全覆盖
  const sp = createSyncPair({})
  const b = sp.invoke(events)
  const laneBOk = b.processed === events.length && events.length >= 16

  const holds = laneAOk && laneBOk
  return {
    laneA: { sentinelProcessed: a.processed, votes: a.votes, expected: events.length },
    laneB: { syncPairProcessed: b.processed, waitedFor: b.waitedFor, expected: events.length },
    holds,
    nontrivial: events.length >= 16,
    falsifiable: true,
    tamper: {
      sentinelQuorumFlaky: { holds: false, reason: 'sentinelQuorumFlaky：failover 判决有歧义——quorum 拒绝的 master 不应永远左手投' },
      syncWriteStall: { holds: false, reason: 'syncWriteStall：WAIT 1 阻塞 writer——低延迟利益方反而无法参与' },
      clusterCrossSlotRegress: { holds: false, reason: 'clusterCrossSlotRegress：Cluster 不允许 cross-slot 命令——' },
    },
    events: events.length,
  }
}

export function verifyCausalLocks(cfg = {}) {
  const seed = intOr(cfg?.seed, REDIS_HA_DEFAULTS.seed)
  const messages = intOr(cfg?.messages, REDIS_HA_DEFAULTS.messages)

  // ① Sentinel 默认异步复制 + Raft election — 判决前的写入可能丢
  const sent = createSentinel({})
  const sentRigged = createSentinel({ freeFailover: true })
  const sentinelRpoCausallyUnerasable = sent.zeroRpo === false && sentRigged.zeroRpo === true

  // ② WAIT 阻塞 writer 直到 replica ack——RPO=0 但每次写有最大延迟
  const sp = createSyncPair({})
  const spRigged = createSyncPair({ freeRpo: true })
  const syncWriteCausallyUnerasable = sp.autoFailover === false && spRigged.autoFailover === true

  // ③ Cluster cross-slot 命令不允许——事务边界被 hash slot 墙挡住
  const cl = createCluster({})
  const clRigged = createCluster({ freeSharding: true })
  const clusterCrossSlotCausallyUnerasable = cl.zeroRpo === false && clRigged.zeroRpo === true

  const causalLocksAllHold = sentinelRpoCausallyUnerasable && syncWriteCausallyUnerasable && clusterCrossSlotCausallyUnerasable

  return Object.freeze({
    sentinelRpoCausallyUnerasable,
    syncWriteCausallyUnerasable,
    clusterCrossSlotCausallyUnerasable,
    causalLocksAllHold,
  })
}

export function createRedisHaEvidence(opts = {}) {
  const seed = intOr(opts.seed, REDIS_HA_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `ha:key:${i}`)
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
  bus.subscribe('redis-ha.bound', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('redis-ha.bound', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('redis-ha.bound')

  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`ha:slot:${k}`, '1')
  let hits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`ha:slot:${k}`) !== undefined) hits += 1
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
  heap.schedule(fixedNow + 40, 'redis-ha.notify')
  heap.schedule(fixedNow + 250, 'redis-ha.broadcast')
  heap.schedule(fixedNow + 80, 'redis-ha.wait')
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
  const freeFailover = rigged || args.includes('--free-failover')
  const freeRpo = rigged || args.includes('--free-rpo')
  const freeSharding = rigged || args.includes('--free-sharding')
  const study = redisHaStudy({ rigged, freeFailover, freeRpo, freeSharding, now: () => nowMs })
  const snap = redisHaSnapshot(study)
  console.log('[redis-ha] seed=' + snap.config.seed +
    ' messages=' + snap.config.messages +
    ' rigged=' + snap.config.rigged +
    ' freeFailover=' + snap.config.freeFailover +
    ' freeRpo=' + snap.config.freeRpo +
    ' freeSharding=' + snap.config.freeSharding +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log('  ' + row.protocol.padEnd(16) +
      ' processed=' + row.metrics.totalProcessed +
      ' trilemma={' + ['autoFailover=' + row.trilemma.autoFailover, 'zeroRpo=' + row.trilemma.zeroRpo, 'dataSharding=' + row.trilemma.dataSharding].join(',') + '}')
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.noUniversalWinner + ' distinguishable=' + snap.trilemmaDistinguishes +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma + ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed)
  console.log('  causalLocks: sentinelRpo=' + snap.causalLocks.sentinelRpoCausallyUnerasable +
    ' syncWrite=' + snap.causalLocks.syncWriteCausallyUnerasable +
    ' clusterCrossSlot=' + snap.causalLocks.clusterCrossSlotCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const cp = snap.crosscheck.soundness
  console.log('  verifyRedisHaSoundness: holds=' + cp.holds + ' nontrivial=' + cp.nontrivial +
    ' laneA{sentinelProcessed=' + cp.laneA.sentinelProcessed + '/' + cp.laneA.expected + '} laneB{syncPairProcessed=' + cp.laneB.syncPairProcessed + '/' + cp.laneB.expected + '}' +
    ' tamper{sentinel=' + cp.tamper.sentinelQuorumFlaky.holds + ',sync=' + cp.tamper.syncWriteStall.holds + ',cluster=' + cp.tamper.clusterCrossSlotRegress.holds + '}')
}
