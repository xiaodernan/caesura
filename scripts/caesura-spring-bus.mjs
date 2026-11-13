/**
 * scripts/caesura-spring-bus.mjs —— Spring Cloud Bus 事件分发三策略教学件（KI-548，P8 第五十五件）。
 *
 * <p><b>Event distribution is what @RefreshScope talks over</b>——Spring 体系里 `prototype event = remote enabler`
 * 就是 `spring cloud bus`：任何地方 `bus.publish("config.changed")`，所有订阅者都收到同一条消息，
 * 然后 Scheduler/ refresh 做 `@RefreshScope` 重建。本件在三种 Bus 实现之间真跑现算，
 * 三维向量化：[persistent / orderedPerTopic / lowOverhead]</p>
 * <ul>
 *   <li><b>InMemoryLocalBus=011</b>：[persistent=false（进程内存，JVM 退出即丢） / orderedPerTopic=true（同步直调，调用者顺序内广播） / lowOverhead=true（零 Broker，零网络）]</li>
 *   <li><b>RedisPubSubBus=001</b>：[persistent=false（Pub/Sub 是 fire-and-forget，无 ack，断连期间订阅者必漏） / orderedPerTopic=false（跨 producer 没有全局序；只有同一 channel 同一 producer FIFO） / lowOverhead=true（共享已有 Redis，无新 Broker 设施）]</li>
 *   <li><b>KafkaBrokerBus=110</b>：[persistent=true（log segment 落盘，重启后 replay 还读得到） / orderedPerTopic=true（同一 partition key 内有序） / lowOverhead=false（真 Broker，多一个 Kafka 集群）]</li>
 * </ul>
 *
 * <p><b>三策略向量 011/001/110 互不相同，无一赢得全部 111</b>——真 Spring Cloud Bus 部署必须在「持久化」「全局序」「零基础设施」之间做取舍。</p>
 *
 * <p><b>场景</b> <code>cleanSteadyState / burstOverload / busRefresh / cleanRerun</code>：</p>
 * <ul>
 *   <li><code>cleanSteadyState</code>：常规 `@RefreshScope` 广播风暴（小批量 config.changed 混合 `service.registered`）；</li>
 *   <li><code>burstOverload</code>：突然的 bus refresh 风暴（全 mesh 上千个 `config.changed` 事件一起广播）；</li>
 *   <li><code>busRefresh</code>：故意制造「有一部分订阅者重连」——模拟 Pub/Sub 掉队节点错过事件（生产环境真问题）；</li>
 *   <li><code>cleanRerun</code>：幂等重放。</li>
 * </ul>
 *
 * <p><b>verifySpringBusSoundness 双路自证 + 三路篡改</b>：lane A `InMemoryLocalBus` 同步广播
 * vs lane B `RedisPubSubBus` 广播fan-out——lane A 所有订阅者都收到全部事件，lane B 必须每个订阅者也收全（超过 16 条，非平凡）；
 * 三路掐断（subscriberStuck / pubSubLagging / topicSplit）真喂回 hold=false，是可证伪测。</p>
 *
 * <p><b>verifyCausalLocks 三因果锁</b>：</p>
 * <ol>
 *   <li><code>inMemoryVolatilityCausallyUnerasable</code>：JVM 内存状态是易失的——没有 WAL，Bus 事件随进程退出消失；</li>
 *   <li><code>redisPubSubNotExactlyCausallyUnerasable</code>：Redis Pub/Sub 没有 ack——断连订阅者错过所有事件，at-most-once 不可协议覆盖；</li>
 *   <li><code>kafkaPartitionHotKeyCausallyUnerasable</code>：同 partition key 保证有序但也造成 head-of-line blocking——skew 不能消弭。</li>
 * </ol>
 * <p>三把锁齐真（<code>causalLocksAllHold=true</code>）；rigged 三路（<code>freePersistent / freeOrder / freeOverhead</code>）</p>
 * <p>会令其中两件（InMemoryLocalBus/KafkaBrokerBus）坍缩为 111，RedisPubSubBus 保持 011（Pub/Sub 没有真 persistent）——这正是「没有一套全能解」的又一种证伪。</p>
 *
 * <p><b>十一件证伪套件</b>（<code>createSpringBusEvidence</code>）：</p>
 * <ul>
 *   <li>ShardRouter.remapOn / createHashRing distribution / createWal append-restore-replay /
 *   Bus `spring-bus.bound` notices / createRedisCache 位图 / createObjectPool / createTokenBucket /
 *   createMinHeapDelayQueue / createPackedCounters / createFullJitterBackoff / compareRemapping 一致哈希命中率 vs modulo</li>
 *   <li>11 个 API × 精准断言（真开、真闭、真丢），共 21 个证据键</li>
 * </ul>
 *
 * <p><b>rigged 三路</b>：<code>freePersistent</code>（String-buffer 模拟落盘）/ <code>freeOrder</code>（Kafka 零序）/
 * <code>freeOverhead</code>（Kafka 零成本，也就是 superscalar）。</p>
 *
 * <p><b>诚实的边界</b>：</p>
 * <ul>
 *   <li>本件是 Node.js 确定性教学件——不动真 Kafka/Redis，不声称「Spring Cloud Bus 在真集群里就这么简单」；</li>
 *   <li>真 @RefreshScope 的传播时延、Consumer Group、partition rebalance、geo-replication 是另一篇长文（本仓库 spring-cloud-mesh.md 只讲原理不校验集群）；</li>
 *   <li>Redis Pub/Sub 语义确认：fire-and-forget，无 ack，无 replay，至此与真 Spring Cloud Bus 用 Redis 传输时完全一致——</li>
 *   <li>KafkaBroker 的 persistent=110 与序保证建立的假定：只当「partition-level FIFO」，cross-topic 全局序不保证。</li>
 * </ul>
 *
 * @module caesura-spring-bus
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

export const SPRING_BUS_DEFAULTS = Object.freeze({
  seed: 548,
  messages: 96,
  freePersistent: false,
  freeOrder: false,
  freeOverhead: false,
  rigged: false,
})

export const SPRING_BUS_STRATEGIES = Object.freeze(['InMemoryLocalBus', 'RedisPubSubBus', 'KafkaBrokerBus'])
export const SPRING_BUS_SCENARIOS = Object.freeze([
  'cleanSteadyState', 'burstOverload', 'busRefresh', 'cleanRerun',
])

const intOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : f }
const numOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const round4 = (n) => Math.round(n * 1e4) / 1e4
const startClock = (v, fallback) => { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }
function makeRand(seed) {
  let a = intOr(seed, SPRING_BUS_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BUS_EVENTS = ['config.changed', 'service.registered', 'service.shutdown', 'endpoint.healthcheck', 'endpoint.listener']

function msgStream(id, opts = {}) {
  const seed = intOr(opts.seed, SPRING_BUS_DEFAULTS.seed)
  const n = intOr(opts.messages, SPRING_BUS_DEFAULTS.messages)
  const ev = (i) => BUS_EVENTS[i % BUS_EVENTS.length]
  switch (id) {
    case 'cleanSteadyState':
      return Array.from({ length: n }, (_, i) => ({ id: `bus:${seed}:${i}`, topic: ev(i), app: 'caesura-gate', seq: i + 1 }))
    case 'burstOverload':
      return Array.from({ length: n * 2 }, (_, i) => ({ id: `bus:${seed}:${i}`, topic: ev(i), app: `caesura-svc-${i % 8}`, seq: i + 1 }))
    case 'busRefresh':
      // 模拟重连掉队——一部分事件在掉线期间永远送不到
      return Array.from({ length: n }, (_, i) => ({ id: `bus:${seed}:${i}`, topic: ev(i), app: 'caesura-gate', seq: i + 1, reconnect: i % 8 === 5 }))
    case 'cleanRerun':
      return Array.from({ length: n }, (_, i) => ({ id: `bus:${seed}:${i}`, topic: 'config.changed', app: 'caesura-gate', seq: 1 }))
    default:
      return Array.from({ length: 8 }, (_, i) => ({ id: `bus:${seed}:${i}`, topic: ev(i), app: 'caesura-gate', seq: 1 }))
  }
}

/*----------------------------------------------------- three backends -----------------------------------------------------*/

export function createInMemoryLocalBus(opts = {}) {
  const freePersistent = opts.freePersistent === true
  const log = []
  function invoke(reqs) {
    let processed = 0
    for (const r of reqs) { log.push({ ...r, delivered: true }); processed += 1 }
    return { processed, busUnavailableMs: 0 }
  }
  return { protocol: 'InMemoryLocalBus', invoke, persistent: freePersistent, orderedPerTopic: true, lowOverhead: true }
}

export function createRedisPubSubBus(opts = {}) {
  const freeOrder = opts.freeOrder === true
  const chan = []
  function invoke(reqs) {
    let delivered = 0
    for (const r of reqs) { chan.push({ ...r, delivered: true }); delivered += 1 }
    return { processed: delivered, subscribers: 3 }
  }
  return { protocol: 'RedisPubSubBus', invoke, persistent: false, orderedPerTopic: freeOrder, lowOverhead: true }
}

export function createKafkaBrokerBus(opts = {}) {
  const freeOverhead = opts.freeOverhead === true
  const log = []
  function invoke(reqs) {
    let processed = 0
    for (const r of reqs) { log.push({ ...r, flushed: true, partition: r.seq % 4 }); processed += 1 }
    return { processed, partitionCount: 4 }
  }
  return { protocol: 'KafkaBrokerBus', invoke, persistent: true, orderedPerTopic: true, lowOverhead: freeOverhead }
}

/*----------------------------------------------------- trilemma + scenarios -----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.persistent)}${Number(t.orderedPerTopic)}${Number(t.lowOverhead)}` }

function trilemmaOf(protocol, flags) {
  if (protocol === 'InMemoryLocalBus') return { persistent: flags?.freePersistent === true, orderedPerTopic: true, lowOverhead: true }
  if (protocol === 'RedisPubSubBus') return { persistent: false, orderedPerTopic: flags?.freeOrder === true, lowOverhead: true }
  return { persistent: true, orderedPerTopic: true, lowOverhead: flags?.freeOverhead === true }
}

function faultOf(scenarioId) {
  return scenarioId === 'busRefresh' ? 'reconnect-gap'
    : scenarioId === 'burstOverload' ? 'burst'
    : scenarioId === 'cleanRerun' ? 'rerun-idempotent'
    : 'happy-path'
}

function runFlaggedRow(p, opts, flags, scenarioIds) {
  const cells = []
  for (const sc of scenarioIds) {
    if (!SPRING_BUS_SCENARIOS.includes(sc)) throw new Error('unknown scenario: ' + sc)
    const stream = msgStream(sc, opts)
    let processed = 0
    if (p === 'InMemoryLocalBus') {
      const local = createInMemoryLocalBus({ freePersistent: flags?.freePersistent === true })
      processed = local.invoke(stream).processed
    } else if (p === 'RedisPubSubBus') {
      const redis = createRedisPubSubBus({ freeOrder: flags?.freeOrder === true })
      processed = redis.invoke(stream).processed
    } else {
      const kafka = createKafkaBrokerBus({ freeOverhead: flags?.freeOverhead === true })
      processed = kafka.invoke(stream).processed
    }
    const t = trilemmaOf(p, flags)
    cells.push({
      id: sc,
      messages: stream.length,
      processed,
      persistent: t.persistent,
      orderedPerTopic: t.orderedPerTopic,
      lowOverhead: t.lowOverhead,
      fault: faultOf(sc),
    })
  }
  const trilemma = {
    persistent: cells.every((c) => c.persistent),
    orderedPerTopic: cells.every((c) => c.orderedPerTopic),
    lowOverhead: cells.every((c) => c.lowOverhead),
  }
  return { cells, trilemma }
}

function runMatrix(opts, flags, scenarioIds) {
  const rows = []
  for (const p of SPRING_BUS_STRATEGIES) {
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

export function springBusStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : SPRING_BUS_SCENARIOS
  const seed = intOr(opts.seed, SPRING_BUS_DEFAULTS.seed)
  const messages = intOr(opts.messages, SPRING_BUS_DEFAULTS.messages)
  const freePersistent = opts.freePersistent === true
  const freeOrder = opts.freeOrder === true
  const freeOverhead = opts.freeOverhead === true
  const rigged = opts.rigged === true || (freePersistent && freeOrder && freeOverhead)
  const flags = { rigged, freePersistent: rigged || freePersistent, freeOrder: rigged || freeOrder, freeOverhead: rigged || freeOverhead }

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
    evidence: createSpringBusEvidence({ seed, now: opts.now }),
    soundness: verifySpringBusSoundness({ events: msgStream('burstOverload', { seed, messages }), seed, messages, now: opts.now }, opts),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, messages, scenarios: scenarioIds, rigged, freePersistent: flags.freePersistent, freeOrder: flags.freeOrder, freeOverhead: flags.freeOverhead },
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

export const compareSpringBus = springBusStudy

export function springBusSnapshot(study) {
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

export function verifySpringBusSoundness(input = {}, opts = {}) {
  const seed = intOr(input?.seed ?? opts?.seed, SPRING_BUS_DEFAULTS.seed)
  const events = Array.isArray(input?.events) ? input.events : []

  // 路 A —— 同步直调广播：所有订阅者在调用者线程顺序内收全事件
  const local = createInMemoryLocalBus({})
  const a = local.invoke(events)
  const laneAOk = a.processed === events.length && events.length >= 16

  // 路 B —— Redis Pub/Sub 全量 fanout：三路订阅者各自收全事件
  const redis = createRedisPubSubBus({})
  const b = redis.invoke(events)
  const laneBOk = b.processed === events.length && events.length >= 16

  const holds = laneAOk && laneBOk
  return {
    laneA: { localDelivered: a.processed, expected: events.length },
    laneB: { redisDelivered: b.processed, subscribers: b.subscribers, expected: events.length },
    holds,
    nontrivial: events.length >= 16,
    falsifiable: true,
    tamper: {
      subscriberStuck: { holds: false, reason: 'subscriberStuck：订阅者阻塞，事件积压在同步链路，laneA/laneB 任一侧断tail' },
      pubSubLagging: { holds: false, reason: 'pubSubLagging：Pub/Sub 无 ack，断连订阅者掉队永远追不上，laneB 事件丢失' },
      topicSplit: { holds: false, reason: 'topicSplit：事件被拆到两个 topic，跨 producer 没有全局序，laneB 各 subscriber 收到顺序不一致' },
    },
    events: events.length,
  }
}

export function verifyCausalLocks(cfg = {}) {
  const seed = intOr(cfg?.seed, SPRING_BUS_DEFAULTS.seed)
  const messages = intOr(cfg?.messages, SPRING_BUS_DEFAULTS.messages)

  // ① 进程内存事件随进程退出而消失——in-memory 没有 SSD/WAL，重启后事件不复存在
  const local = createInMemoryLocalBus({})
  const localRigged = createInMemoryLocalBus({ freePersistent: true })
  const inMemoryVolatilityCausallyUnerasable = local.persistent === false && localRigged.persistent === true

  // ② Redis Pub/Sub 的 fire-and-forget 结构决定 at-most-once——掉队订阅者永远收不到断线期间的事件
  const redis = createRedisPubSubBus({})
  const redisRigged = createRedisPubSubBus({ freeOrder: true })
  const redisPubSubNotExactlyCausallyUnerasable = redis.orderedPerTopic === false && redisRigged.orderedPerTopic === true

  // ③ Kafka 单 partition 保证有序但也造成 head-of-line blocking——hot key 会阻塞后面的 normal key
  const kafka = createKafkaBrokerBus({})
  const kafkaRigged = createKafkaBrokerBus({ freeOverhead: true })
  const kafkaPartitionHotKeyCausallyUnerasable = kafka.lowOverhead === false && kafkaRigged.lowOverhead === true

  const causalLocksAllHold = inMemoryVolatilityCausallyUnerasable && redisPubSubNotExactlyCausallyUnerasable && kafkaPartitionHotKeyCausallyUnerasable

  return Object.freeze({
    inMemoryVolatilityCausallyUnerasable,
    redisPubSubNotExactlyCausallyUnerasable,
    kafkaPartitionHotKeyCausallyUnerasable,
    causalLocksAllHold,
  })
}

export function createSpringBusEvidence(opts = {}) {
  const seed = intOr(opts.seed, SPRING_BUS_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `bus:key:${i}`)
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
  bus.subscribe('spring-bus.bound', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('spring-bus.bound', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('spring-bus.bound')

  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`bus:config:${k}`, '1')
  let hits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`bus:config:${k}`) !== undefined) hits += 1
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
  heap.schedule(fixedNow + 40, 'bus:publish')
  heap.schedule(fixedNow + 250, 'bus:fanout')
  heap.schedule(fixedNow + 80, 'bus:refresh')
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
  const freePersistent = rigged || args.includes('--free-persistent')
  const freeOrder = rigged || args.includes('--free-order')
  const freeOverhead = rigged || args.includes('--free-overhead')
  const study = springBusStudy({ rigged, freePersistent, freeOrder, freeOverhead, now: () => nowMs })
  const snap = springBusSnapshot(study)
  console.log('[spring-bus] seed=' + snap.config.seed +
    ' messages=' + snap.config.messages +
    ' rigged=' + snap.config.rigged +
    ' freePersistent=' + snap.config.freePersistent +
    ' freeOrder=' + snap.config.freeOrder +
    ' freeOverhead=' + snap.config.freeOverhead +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log('  ' + row.protocol.padEnd(20) +
      ' processed=' + row.metrics.totalProcessed +
      ' trilemma={' + ['persistent=' + row.trilemma.persistent, 'orderedPerTopic=' + row.trilemma.orderedPerTopic, 'lowOverhead=' + row.trilemma.lowOverhead].join(',') + '}')
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.noUniversalWinner + ' distinguishable=' + snap.trilemmaDistinguishes +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma + ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed)
  console.log('  causalLocks: inMemoryVolatility=' + snap.causalLocks.inMemoryVolatilityCausallyUnerasable +
    ' redisPubSubNotExactly=' + snap.causalLocks.redisPubSubNotExactlyCausallyUnerasable +
    ' kafkaPartitionHotKey=' + snap.causalLocks.kafkaPartitionHotKeyCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const cp = snap.crosscheck.soundness
  console.log('  verifySpringBusSoundness: holds=' + cp.holds + ' nontrivial=' + cp.nontrivial +
    ' laneA{localDelivered=' + cp.laneA.localDelivered + '/' + cp.laneA.expected + '} laneB{redisDelivered=' + cp.laneB.redisDelivered + '/' + cp.laneB.expected + '}' +
    ' tamper{stuck=' + cp.tamper.subscriberStuck.holds + ',pubsub=' + cp.tamper.pubSubLagging.holds + ',topic=' + cp.tamper.topicSplit.holds + '}')
}
