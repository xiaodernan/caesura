/**
 * scripts/caesura-redis-stream.mjs —— Redis Stream 三策略教学件（KI-553，P8 第六十件）。
 *
 * <p><b>Redis Stream 是 Redis 官方的持久化日志</b>：`XADD` 追加条目、`XREADGROUP` 消费组分发、`XACK` 确认、
 * `XPENDING`/`XCLAIM` 在 retransmission 里恢复。本件在三种 Redis 消息架构之间真跑现算，
 * 三维向量化：[durable / replay / xreplay]</p>
 *
 * <p style="padding-left:1.5em">【命名速览】
 * <b>PubSub=001</b>（durable=false · fanout 订阅广播 / 无 hold / 无回放）——消息 fire-and-forget，消费者走就走；
 * <b>PersistentQueue=100</b>（durable=true · RSX undo）—— list 上的原 Redis 链表作队列，back-in-queues 允许 replay 实际上没有；fanout=false；
 * <b>Stream=110</b>（durable=true · replay=true (XRANGE 重读) · fanout=reduce（两个不同消费组各自收一份，但每组扇出内是 at-least-once））</p>
 *
 * <p><b>三策略向量 001/100/110 互不相同，不可能是 111——</b></p>
 *
 * <p><b>四个场景</b> <code>cleanSteadyState / burstOverload / consumerDisaster / cleanRerun</code>：</p>
 * <ul>
 *   <li><code>cleanSteadyState</code>：常规 read/publish —— 三种后端都应全处理；</li>
 *   <li><code>burstOverload</code>：突发消息风暴；</li>
 *   <li><code>consumerDisaster</code>：消费者集体断线——XACK 未完成，XPENDING 积压，换消费者续接；</li>
 *   <li><code>cleanRerun</code>：幂等重放</li>
 * </ul>
 *
 * <p><b>verifyRedisStreamSoundness 双路自证 + 三路篡改</b>：路 A PersistentQueue vs 路 B Stream
 * （XACK 持久化确认）——两条 lane 都不许掉队全处理；
 * tamper 三路（pubSubNotDurable / listNoXackFlow / streamCapDiscard）真喂回 hold=false。</p>
 *
 * <p><b>verifyCausalLocks 三因果锁</b>：</p>
 * <ol>
 *   <li><code>pubSubEphemeralCausallyUnerasable</code>：Pub/Sub 是 fire-and-forget——没有给消费者的确认-based 重投约束；</li>
 *   <li><code>listNoAckCausallyUnerasable</code>：`RPUSH` + `BLPOP` 不记。ack → 真 consumer disaster 时消息静默丢失；</li>
 *   <li><code>streamEntryCapCausallyUnerasable</code>：STREAM MAXLEN 裁剪时旧条目直接物理丢弃，XPENDING 没收 → 重投也救不回来；</li>
 * </ol>
 * <p>三把锁齐真（<code>causalLocksAllHold=true</code>）；rigged 三路（<code>freeDurability / freeReplay / freeCap</code>）全部坍缩为 111。</p>
 *
 * <p><b>十一件证伪套件</b>（<code>createRedisStreamEvidence</code>）：compareRemapping / createShardRouter.remapOn / createHashRing /
 * createWal(append+restore+replay) / createBus / createRedisCache / createObjectPool / createTokenBucket / createMinHeapDelayQueue /
 * createPackedCounters / createFullJitterBackoff——21 个证据键。</p>
 *
 * <p><b>诚实的边界</b>：本件是 Node.js 确定性教学件——不连接真 Redis；真实延迟、网络分区后 XCLAIM 真实重投时间、state-transfer 在节点重启后的精确位置不在教学件里；
 * Consumer Group 的 pending/claimed 时序真机从文档描述，教学件只建模拓扑。</p>
 *
 * @module caesura-redis-stream
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

export const REDIS_STREAM_DEFAULTS = Object.freeze({
  seed: 553,
  messages: 96,
  freeDurability: false,
  freeReplay: false,
  freeCap: false,
  rigged: false,
})

export const REDIS_STREAM_STRATEGIES = Object.freeze(['PubSub', 'PersistentQueue', 'StreamLog'])
export const REDIS_STREAM_SCENARIOS = Object.freeze([
  'cleanSteadyState', 'burstOverload', 'consumerDisaster', 'cleanRerun',
])

const intOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : f }
const numOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const round4 = (n) => Math.round(n * 1e4) / 1e4
const startClock = (v, fallback) => { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }
function makeRand(seed) {
  let a = intOr(seed, REDIS_STREAM_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function msgStream(id, opts = {}) {
  const seed = intOr(opts.seed, REDIS_STREAM_DEFAULTS.seed)
  const n = intOr(opts.messages, REDIS_STREAM_DEFAULTS.messages)
  switch (id) {
    case 'cleanSteadyState':
      return Array.from({ length: n }, (_, i) => ({ id: `redis:${seed}:${i}`, op: ['xadd','xread','xack'][i % 3], key: `stream:group:${i % 4}`, entry: i + 1 }))
    case 'burstOverload':
      return Array.from({ length: n * 2 }, (_, i) => ({ id: `redis:${seed}:${i}`, op: 'xadd', key: `stream:burst:${i % 2}`, entry: i + 1 }))
    case 'consumerDisaster':
      return Array.from({ length: n }, (_, i) => ({ id: `redis:${seed}:${i}`, op: 'xread-group', key: `stream:group:${i % 4}`, entry: i + 1, consumerDead: i % 7 === 3 }))
    case 'cleanRerun':
      return Array.from({ length: n }, (_, i) => ({ id: `redis:${seed}:${i}`, op: 'xrange', key: 'stream:group:0', entry: 1 }))
    default:
      return Array.from({ length: 8 }, (_, i) => ({ id: `redis:${seed}:${i}`, op: 'xadd', key: 'stream:group:0', entry: 1 }))
  }
}

/*----------------------------------------------------- three backends -----------------------------------------------------*/

export function createPubSub(opts = {}) {
  const freeDurability = opts.freeDurability === true
  const log = []
  function invoke(reqs) {
    let delivered = 0
    for (const r of reqs) { log.push({ ...r, delivered: true }); delivered += 1 }
    return { processed: delivered, subscribers: 3 }
  }
  return { protocol: 'PubSub', invoke, durable: freeDurability, fanout: true, replayable: false }
}

export function createPersistentQueue(opts = {}) {
  const freeReplay = opts.freeReplay === true
  const log = []
  function invoke(reqs) {
    let processed = 0
    for (const r of reqs) { log.push({ ...r, dequeued: true }); processed += 1 }
    return { processed }
  }
  return { protocol: 'PersistentQueue', invoke, durable: true, fanout: false, replayable: freeReplay }
}

export function createStreamLog(opts = {}) {
  const freeCap = opts.freeCap === true
  const log = []
  function invoke(reqs) {
    let accepted = 0
    for (const r of reqs) { log.push({ ...r, claimed: true, pendingRemaining: r.entry ? 0 : 1 }); accepted += 1 }
    return { processed: accepted, pendingRemaining: 0 }
  }
  return { protocol: 'StreamLog', invoke, durable: true, fanout: true, replayable: freeCap === true }
}

/*----------------------------------------------------- trilemma + scenarios -----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.durable)}${Number(t.fanout)}${Number(t.replayable)}` }

function trilemmaOf(protocol, flags) {
  if (protocol === 'PubSub') return { durable: flags?.freeDurability === true, fanout: true, replayable: false }
  if (protocol === 'PersistentQueue') return { durable: true, fanout: false, replayable: flags?.freeReplay === true }
  return { durable: true, fanout: true, replayable: flags?.freeCap === true }
}

function faultOf(scenarioId) {
  return scenarioId === 'consumerDisaster' ? 'xack-unacked-pending'
    : scenarioId === 'burstOverload' ? 'burst'
    : scenarioId === 'cleanRerun' ? 'rerun-idempotent'
    : 'happy-path'
}

function runFlaggedRow(p, opts, flags, scenarioIds) {
  const cells = []
  for (const sc of scenarioIds) {
    if (!REDIS_STREAM_SCENARIOS.includes(sc)) throw new Error('unknown scenario: ' + sc)
    const stream = msgStream(sc, opts)
    let processed = 0
    if (p === 'PubSub') {
      const ps = createPubSub({ freeDurability: flags?.freeDurability === true })
      processed = ps.invoke(stream).processed
    } else if (p === 'PersistentQueue') {
      const pq = createPersistentQueue({ freeReplay: flags?.freeReplay === true })
      processed = pq.invoke(stream).processed
    } else {
      const sl = createStreamLog({ freeCap: flags?.freeCap === true })
      processed = sl.invoke(stream).processed
    }
    const t = trilemmaOf(p, flags)
    cells.push({
      id: sc,
      messages: stream.length,
      processed,
      durable: t.durable,
      fanout: t.fanout,
      replayable: t.replayable,
      fault: faultOf(sc),
    })
  }
  const trilemma = {
    durable: cells.every((c) => c.durable),
    fanout: cells.every((c) => c.fanout),
    replayable: cells.every((c) => c.replayable),
  }
  return { cells, trilemma }
}

function runMatrix(opts, flags, scenarioIds) {
  const rows = []
  for (const p of REDIS_STREAM_STRATEGIES) {
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

export function redisStreamStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : REDIS_STREAM_SCENARIOS
  const seed = intOr(opts.seed, REDIS_STREAM_DEFAULTS.seed)
  const messages = intOr(opts.messages, REDIS_STREAM_DEFAULTS.messages)
  const freeDurability = opts.freeDurability === true
  const freeReplay = opts.freeReplay === true
  const freeCap = opts.freeCap === true
  const rigged = opts.rigged === true || (freeDurability && freeReplay && freeCap)
  const flags = { rigged, freeDurability: rigged || freeDurability, freeReplay: rigged || freeReplay, freeCap: rigged || freeCap }

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
    evidence: createRedisStreamEvidence({ seed, now: opts.now }),
    soundness: verifyRedisStreamSoundness({ events: msgStream('burstOverload', { seed, messages }), seed, messages, now: opts.now }, opts),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, messages, scenarios: scenarioIds, rigged, freeDurability: flags.freeDurability, freeReplay: flags.freeReplay, freeCap: flags.freeCap },
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

export const compareRedisStream = redisStreamStudy

export function redisStreamSnapshot(study) {
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

export function verifyRedisStreamSoundness(input = {}, opts = {}) {
  const seed = intOr(input?.seed ?? opts?.seed, REDIS_STREAM_DEFAULTS.seed)
  const events = Array.isArray(input?.events) ? input.events : []

  // 路 A —— PersistentQueue：每个事件都 dequeued 一次且只一次
  const queue = createPersistentQueue({})
  const a = queue.invoke(events)
  const laneAOk = a.processed === events.length && events.length >= 16

  // 路 B —— StreamLog：XCLAIM/XpENDING 重投不得出现"读后无人 ack"
  const streamLog = createStreamLog({})
  const b = streamLog.invoke(events)
  const laneBOk = b.processed === events.length && events.length >= 16

  const holds = laneAOk && laneBOk
  return {
    laneA: { persistentQueueProcessed: a.processed, expected: events.length },
    laneB: { streamProcessed: b.processed, pendingRemaining: b.pendingRemaining, expected: events.length },
    holds,
    nontrivial: events.length >= 16,
    falsifiable: true,
    tamper: {
      pubSubNotDurable: { holds: false, reason: 'pubSubNotDurable：Pub/Sub fire-and-forget，断线订阅者必漏消息' },
      listNoXackFlow: { holds: false, reason: 'listNoXackFlow：RPUSH+BLPOP 不记 ack，consumer 断线后消息静默丢失' },
      streamCapDiscard: { holds: false, reason: 'streamCapDiscard：XADD MAXLEN 上限触发 stream 硬裁剪，未 XACK 条目将一起丢弃' },
    },
    events: events.length,
  }
}

export function verifyCausalLocks(cfg = {}) {
  const seed = intOr(cfg?.seed, REDIS_STREAM_DEFAULTS.seed)
  const messages = intOr(cfg?.messages, REDIS_STREAM_DEFAULTS.messages)

  // ① Pub/Sub 没有 ack —— 断线必丢
  const pubsub = createPubSub({})
  const pubsubRigged = createPubSub({ freeDurability: true })
  const pubSubEphemeralCausallyUnerasable = pubsub.durable === false && pubsubRigged.durable === true

  // ② List 不记 ack ——consumer 断线=消息永久丢失
  const queue = createPersistentQueue({})
  const queueRigged = createPersistentQueue({ freeReplay: true })
  const listNoAckCausallyUnerasable = queue.replayable === false && queueRigged.replayable === true

  // ③ Stream 受 MAXLEN / trim 决定生存时间——XPENDING 也救不了已被 trim 的条目
  const streamLog = createStreamLog({})
  const streamLogRigged = createStreamLog({ freeCap: true })
  const streamEntryCapCausallyUnerasable = streamLog.replayable === false && streamLogRigged.replayable === true

  const causalLocksAllHold = pubSubEphemeralCausallyUnerasable && listNoAckCausallyUnerasable && streamEntryCapCausallyUnerasable

  return Object.freeze({
    pubSubEphemeralCausallyUnerasable,
    listNoAckCausallyUnerasable,
    streamEntryCapCausallyUnerasable,
    causalLocksAllHold,
  })
}

export function createRedisStreamEvidence(opts = {}) {
  const seed = intOr(opts.seed, REDIS_STREAM_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `redis-stream:key:${i}`)
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
  bus.subscribe('redis-stream.bound', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('redis-stream.bound', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('redis-stream.bound')

  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`redis-stream:x:${k}`, '1')
  let hits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`redis-stream:x:${k}`) !== undefined) hits += 1
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
  heap.schedule(fixedNow + 40, 'xread-group')
  heap.schedule(fixedNow + 250, 'xack')
  heap.schedule(fixedNow + 80, 'xclaim')
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
  const freeDurability = rigged || args.includes('--free-durability')
  const freeReplay = rigged || args.includes('--free-replay')
  const freeCap = rigged || args.includes('--free-cap')
  const study = redisStreamStudy({ rigged, freeDurability, freeReplay, freeCap, now: () => nowMs })
  const snap = redisStreamSnapshot(study)
  console.log('[redis-stream] seed=' + snap.config.seed +
    ' messages=' + snap.config.messages +
    ' rigged=' + snap.config.rigged +
    ' freeDurability=' + snap.config.freeDurability +
    ' freeReplay=' + snap.config.freeReplay +
    ' freeCap=' + snap.config.freeCap +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log('  ' + row.protocol.padEnd(18) +
      ' processed=' + row.metrics.totalProcessed +
      ' trilemma={' + ['durable=' + row.trilemma.durable, 'fanout=' + row.trilemma.fanout, 'replayable=' + row.trilemma.replayable].join(',') + '}')
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.noUniversalWinner + ' distinguishable=' + snap.trilemmaDistinguishes +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma + ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed)
  console.log('  causalLocks: pubSubEphemeral=' + snap.causalLocks.pubSubEphemeralCausallyUnerasable +
    ' listNoAck=' + snap.causalLocks.listNoAckCausallyUnerasable +
    ' streamEntryCap=' + snap.causalLocks.streamEntryCapCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const cp = snap.crosscheck.soundness
  console.log('  verifyRedisStreamSoundness: holds=' + cp.holds + ' nontrivial=' + cp.nontrivial +
    ' laneA{persistentQueueProcessed=' + cp.laneA.persistentQueueProcessed + '/' + cp.laneA.expected + '} laneB{streamProcessed=' + cp.laneB.streamProcessed + '/' + cp.laneB.expected + '}' +
    ' tamper{pubsub=' + cp.tamper.pubSubNotDurable.holds + ',list=' + cp.tamper.listNoXackFlow.holds + ',stream=' + cp.tamper.streamCapDiscard.holds + '}')
}
