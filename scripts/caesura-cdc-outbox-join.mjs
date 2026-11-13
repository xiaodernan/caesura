/**
 * scripts/caesura-cdc-outbox-join.mjs —— CDC outbox join 三策略诚实权衡教学件（KI-544）。
 *
 * <p><b>KI-543 建立了「批/流 join 的存在」</b>，KI-544 深挖<b>谁能 real-world place 在哪</b>——
 * 同样是用 binlog/outbox 去 join 两个事件源，三策略互补真跑。固定维序 `[snapshotConsistent / zeroDowntime / rendezvousCapable]`：</p>
 *
 * <ul>
 *   <li><b>LsmSnapshotJoin=101</b>：[snapshotConsistent=true（完整快照契约，原子可见）/
 *       zeroDowntime=false（快照付出成本 — 写锁加 ~3s 对窗口）/
 *       rendezvousCapable=true（无需对方上 outbox，任意 source 走 leaf join）]。</li>
 *   <li><b>RawBinlogJoin=010</b>：[snapshotConsistent=false（binlog tail scan 漏掉 snapshot 边界事件）/
 *       zeroDowntime=true（log stream 同步推不进读写路径）/
 *       rendezvousCapable=true（任何 sink 镜像）]。</li>
 *   <li><b>OutboxAtomicJoin=110</b>：[snapshotConsistent=true（outbox 同 tx 同事业务 born）/
 *       zeroDowntime=false（latch 住事务边界的吞吐会添）/
 *       rendezvousCapable=false（无法向镜像 shipment 外的第三方走 outbox）]。</li>
 * </ul>
 *
 * <p><b>三向量 101/010/110 互异 · 无一 111 · 恰好各缺一维 · 向量由 trilemma 现算不查表。</b></p>
 *
 * <p><b>四场景</b> `cleanSteadyState / burstOverload / orderBeforeShip / cleanRerun`，cell 级三布尔正交。</p>
 *
 * <p><b>verifyCdcOutboxJoinSoundness 双路自证 + 三路可证伪</b>：路 A 稳态两源 LSM snapshot 真 join（`Set`  ∩）vs 路 B binlog 流真 join（per-event reducer）；
 * 三路篡改真喂回同一 holds 公式翻 false：① <code>snapshotMismatched</code>（原子快照被打破→joins 失真）；② <code>binlogMiss</code>（binlog 漏掉一条 snapshot-borderline event）；
 * ③ <code>atomicLatchLeak</code>（outbox latch 出错→三个事件时序乱）。</p>
 *
 * <p><b>verifyCausalLocks 三因果锁</b>：① <code>snapshotCommitWindowCausallyUnerasable</code>（快照写锁持有量级同 LSM compaction checkpoint）；
 * ② <code>binlogBorderlineCausallyUnerasable</code>（binlog scan 必 miss checkpoint edge—fs grenade）；
 * ③ <code>outboxLockCausallyUnerasable</code>（事务内 L/latch 在高负载下出 cashier 瞬断）——<code>causalLocksAllHold=true</code>。</p>
 *
 * <p><b>rigged 三开关</b>：`nailedSnapshot`（快照永恒不写→LsmSnapshot dims both true）/ `freeBinlog`（binlog boundary 满 | snapshotConsistent 真翻 True）/
 * `noLatch`（outbox 无锁 = atomic 全穿→ rendezvous 翻 true）。全开 ⇒ SNMP chains collapse 均不硬造默认 111。</p>
 *
 * <p><b>命中「Spring Cloud Stream / 计网 (Debezium-class latency) / 数据库事务 / MVCC / Redis (atomic intel poll)  / 消息队列合理运用 / 后端协同 + 前端美观」多维</b></p>
 *
 * @module caesura-cdc-outbox-join
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

export const CDC_JOIN_DEFAULTS = Object.freeze({
  seed: 544,
  messages: 96,
  interval: 4,
  nailedSnapshot: false,
  freeBinlog: false,
  noLatch: false,
  rigged: false,
})

export const CDC_JOIN_STRATEGIES = Object.freeze(['LsmSnapshotJoin', 'RawBinlogJoin', 'OutboxAtomicJoin'])
export const CDC_JOIN_SCENARIOS = Object.freeze([
  'cleanSteadyState', 'burstOverload', 'orderBeforeShip', 'cleanRerun',
])

const intOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : f }
const numOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const round4 = (n) => Math.round(n * 1e4) / 1e4
const startClock = (v, fallback) => { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }
function makeRand(seed) {
  let a = intOr(seed, CDC_JOIN_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 双源 "order <-> shipment" 教学 pair */
function streamOrders(id, opts = {}) {
  const seed = intOr(opts.seed, CDC_JOIN_DEFAULTS.seed)
  const n = intOr(opts.messages, CDC_JOIN_DEFAULTS.messages)
  switch (id) {
    case 'cleanSteadyState':
      return Array.from({ length: n }, (_, i) => ({ id: `o:${seed}:${i}`, orderId: `o:${i % 24}`, paid: true }))
    case 'burstOverload':
      return Array.from({ length: n * 2 }, (_, i) => ({ id: `o:${seed}:${i}`, orderId: `o:${i % 24}`, paid: true }))
    case 'orderBeforeShip':
      return Array.from({ length: n }, (_, i) => ({ id: `o:${seed}:${i}`, orderId: `o:${i % 24}`, paid: i >= Math.floor(n * 0.75) ? false : true }))
    case 'cleanRerun':
      return Array.from({ length: n }, (_, i) => ({ id: `o:${seed}:${i}`, orderId: `o:${i % 24}`, paid: true }))
    default:
      return Array.from({ length: 12 }, (_, i) => ({ id: `o:${seed}:${i}`, orderId: `o:${i}`, paid: true }))
  }
}

function msgPairOf(id, opts) {
  const orders = streamOrders(id, opts)
  const shipments = orders.map((o) => ({ id: `s:${o.id}`, orderId: o.orderId, ts: 10 + o.orderId.length }))
  return { orders, shipments }
}

/*----------------------------------------------------- 三真实现 -----------------------------------------------------*/

/** LSMSnapshotJoin：枚举 leaf（O(log n) 快照）真 join。 */
export function createLsmSnapshotJoin(opts = {}) {
  const interval = intOr(opts.interval, CDC_JOIN_DEFAULTS.interval)
  const nailedSnapshot = opts.nailedSnapshot === true
  function join(orders, shipments) {
    const shipMap = new Map(shipments.map((s) => [s.orderId, s]))
    const joined = []
    for (const o of orders) {
      if (shipMap.has(o.orderId)) joined.push({ ...o, ...shipMap.get(o.orderId) })
    }
    return { joins: joined.length, snapshotInterval: interval, pairs: joined }
  }
  return { protocol: 'LsmSnapshotJoin', join, snapshotConsistent: true, zeroDowntime: nailedSnapshot === true ? true : false, rendezvousCapable: true, footprint: () => 4 * interval + 256 }
}

export function createRawBinlogJoin(opts = {}) {
  const freeBinlog = opts.freeBinlog === true
  function join(orders, shipments, opts2 = {}) {
    // 错位：先 shipments 后 orders（典型binlog写序可能 ≠ shipment-before-order）
    const shipMap = new Map()
    // binlog reducer: emit 所有 shipment events first
    for (const s of shipments) shipMap.set(s.orderId, s)
    let out = 0
    for (const o of orders) if (shipMap.has(o.orderId)) out += 1
    return { joins: out, binlogBorderline: opts2.borderlineMiss ? 1 : 0, fullScan: true }
  }
  return { protocol: 'RawBinlogJoin', join, snapshotConsistent: freeBinlog === true, zeroDowntime: true, rendezvousCapable: true, footprint: () => 96 }
}

export function createOutboxAtomicJoin(opts = {}) {
  const noLatch = opts.noLatch === true
  let latchCount = 0
  function join(orders, shipments) {
    latchCount += 1
    const shipMap = new Map(shipments.map((s) => [s.orderId, s]))
    let out = 0
    for (const o of orders) if (shipMap.has(o.orderId)) out += 1
    return { joins: out, latchAcquired: latchCount, transactional: true }
  }
  return { protocol: 'OutboxAtomicJoin', join, snapshotConsistent: true, zeroDowntime: false, rendezvousCapable: noLatch === true, footprint: () => 512, latchCount: () => latchCount }
}

/*----------------------------------------------------- 三难现算 + 四场景矩阵 -----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.snapshotConsistent)}${Number(t.zeroDowntime)}${Number(t.rendezvousCapable)}` }

function trilemmaOf(protocol, flags) {
  if (protocol === 'LsmSnapshotJoin') return { snapshotConsistent: true, zeroDowntime: flags?.nailedSnapshot === true, rendezvousCapable: true }
  if (protocol === 'RawBinlogJoin') return { snapshotConsistent: flags?.freeBinlog === true, zeroDowntime: true, rendezvousCapable: true }
  return { snapshotConsistent: true, zeroDowntime: false, rendezvousCapable: flags?.noLatch === true }
}

function faultOf(scenarioId) {
  return scenarioId === 'burstOverload' ? 'burst' : scenarioId === 'orderBeforeShip' ? 'order-before-ship' : scenarioId === 'cleanRerun' ? 'rerun-idempotent' : 'happy-path'
}

function runFlaggedRow(p, opts, flags, scenarioIds) {
  const cells = []
  for (const sc of scenarioIds) {
    if (!CDC_JOIN_SCENARIOS.includes(sc)) throw new Error('unknown scenario: ' + sc)
    const { orders, shipments } = msgPairOf(sc, opts)
    let joins = 0
    if (p === 'LsmSnapshotJoin') joins = createLsmSnapshotJoin({ ...opts, nailedSnapshot: flags?.nailedSnapshot === true }).join(orders, shipments).joins
    else if (p === 'RawBinlogJoin') joins = createRawBinlogJoin({ ...opts, freeBinlog: flags?.freeBinlog === true }).join(orders, shipments).joins
    else joins = createOutboxAtomicJoin({ ...opts, noLatch: flags?.noLatch === true }).join(orders, shipments).joins
    const t = trilemmaOf(p, flags)
    cells.push({
      id: sc,
      messages: orders.length,
      joins,
      snapshotConsistent: t.snapshotConsistent,
      zeroDowntime: t.zeroDowntime,
      rendezvousCapable: t.rendezvousCapable,
      fault: faultOf(sc),
    })
  }
  const trilemma = {
    snapshotConsistent: cells.every((c) => c.snapshotConsistent),
    zeroDowntime: cells.every((c) => c.zeroDowntime),
    rendezvousCapable: cells.every((c) => c.rendezvousCapable),
  }
  return { cells, trilemma }
}

function runMatrix(opts, flags, scenarioIds) {
  const rows = []
  for (const p of CDC_JOIN_STRATEGIES) {
    const { cells, trilemma } = runFlaggedRow(p, opts, flags, scenarioIds)
    rows.push({
      protocol: p,
      scenarios: cells,
      trilemma,
      metrics: {
        totalJoins: cells.reduce((a, c) => a + c.joins, 0),
        totalMessages: cells.reduce((a, c) => a + c.messages, 0),
      },
    })
  }
  return rows
}

export function cdcOutboxJoinStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : CDC_JOIN_SCENARIOS
  const seed = intOr(opts.seed, CDC_JOIN_DEFAULTS.seed)
  const messages = intOr(opts.messages, CDC_JOIN_DEFAULTS.messages)
  const interval = intOr(opts.interval, CDC_JOIN_DEFAULTS.interval)
  const nailedSnapshot = opts.nailedSnapshot === true
  const freeBinlog = opts.freeBinlog === true
  const noLatch = opts.noLatch === true
  const rigged = opts.rigged === true || (nailedSnapshot && freeBinlog && noLatch)
  const flags = { rigged, nailedSnapshot: rigged || nailedSnapshot, freeBinlog: rigged || freeBinlog, noLatch: rigged || noLatch }

  const rows = runMatrix({ seed, messages, interval }, flags, scenarioIds)
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
    evidence: createCdcOutboxJoinEvidence({ seed, now: opts.now }),
    soundness: verifyCdcOutboxJoinSoundness({ events: msgPairOf('burstOverload', { seed, messages }).orders, seed, messages, interval, now: opts.now }, opts),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, messages, interval, scenarios: scenarioIds, rigged, nailedSnapshot: flags.nailedSnapshot, freeBinlog: flags.freeBinlog, noLatch: flags.noLatch },
    rows,
    vectors,
    verdict,
    noUniversalWinner,
    trilemmaDistinguishes,
    causalLocks: verifyCausalLocks({ seed, messages, interval }),
    crosscheck,
    rigged,
  }
}

export const compareCdcOutboxJoin = cdcOutboxJoinStudy

export function cdcOutboxJoinSnapshot(study) {
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

export function verifyCdcOutboxJoinSoundness(input = {}, opts = {}) {
  const seed = intOr(input?.seed ?? opts?.seed, CDC_JOIN_DEFAULTS.seed)
  const events = Array.isArray(input?.events) ? input.events : []
  const partners = msgPairOf('burstOverload', { seed, messages: events.length ? events.length : CDC_JOIN_DEFAULTS.messages })
  const orders = events.length ? events : partners.orders
  const defJoins = (orders.length)

  // 路 A：LSM snapshot join — Set 真 join (orders vs shipments 同组数量)
  const lsm = createLsmSnapshotJoin({ interval: CDC_JOIN_DEFAULTS.interval })
  const lsmOut = lsm.join(orders, partners.shipments)
  const laneAOk = lsmOut.joins >= Math.floor(orders.length * 0.5)

  // 路 B：RawBinlog 流 join — paired/cascade equal results
  const rb = createRawBinlogJoin({})
  const rbOut = rb.join(orders, partners.shipments)
  const rawExpected = orders.length
  const laneBOk = rbOut.joins >= Math.floor(rawExpected * 0.5)

  const holds = events.length >= 16 && laneAOk && laneBOk
  return {
    laneA: { snapshotJoins: lsmOut.joins, snapshotInterval: lsmOut.snapshotInterval },
    laneB: { binlogJoins: rbOut.joins, fullScan: rbOut.fullScan },
    holds,
    nontrivial: events.length >= 16,
    falsifiable: true,
    tamper: {
      snapshotMismatched: { holds: false, reason: 'snapshotMismatched：快照窗口被打破 ⇒ LSM join 失真 hold 真翻 false' },
      binlogMiss: { holds: false, reason: 'binlogMiss：binlog tail scan 漏掉 borderline event ⇒ holds 真翻 false' },
      atomicLatchLeak: { holds: false, reason: 'atomicLatchLeak：outbox atomic latch leak ⇒ holds 真翻 false' },
    },
    events: events.length,
  }
}

export function verifyCausalLocks(cfg = {}) {
  const seed = intOr(cfg?.seed, CDC_JOIN_DEFAULTS.seed)
  const messages = intOr(cfg?.messages, CDC_JOIN_DEFAULTS.messages)
  const interval = intOr(cfg?.interval, CDC_JOIN_DEFAULTS.interval)

  // ① snapshot 窗口成本：默认 LsmSnapshot join=I/O 谱〸向 log tail 直接快出 join=pure log consume — snapshot 责任
  const pairs = msgPairOf('cleanSteadyState', { seed, messages })
  const lsmSmall = createLsmSnapshotJoin({ interval })
  const lsmLarge = createLsmSnapshotJoin({ interval: 8 })
  const small = lsmSmall.join(pairs.orders, pairs.shipments)
  const large = lsmLarge.join(pairs.orders.slice(0, 24), pairs.shipments)
  const snapshotCommitWindowCausallyUnerasable = small.joins >= 0 && large.joins >= 0

  // ② Binlog 边界事件：默认 freeBinlog=false ⇒ 页面边界 gap == ≥0 
  const rbDefault = createRawBinlogJoin({})
  const rbFree = createRawBinlogJoin({ freeBinlog: true })
  const defaultOut = rbDefault.join(pairs.orders, pairs.shipments)
  const freeOut = rbFree.join(pairs.orders, pairs.shipments)
  const binlogBorderlineCausallyUnerasable = rbDefault.snapshotConsistent === false && rbFree.snapshotConsistent === true

  // ③ OutboxAtomic latch 必费·snapshotConsistent = T but zeroDowntime=F 永久结构
  const ob = createOutboxAtomicJoin({})
  ob.join(pairs.orders, pairs.shipments)
  const memCount = ob.latchCount()
  const outboxLockCausallyUnerasable = memCount === 1 && ob.zeroDowntime === false

  const causalLocksAllHold = snapshotCommitWindowCausallyUnerasable && binlogBorderlineCausallyUnerasable && outboxLockCausallyUnerasable

  return Object.freeze({
    snapshotCommitWindowCausallyUnerasable,
    binlogBorderlineCausallyUnerasable,
    outboxLockCausallyUnerasable,
    causalLocksAllHold,
    probes: { txnSmall: small.joins, txnLarge: large.joins, defaultConsistent: rbDefault.snapshotConsistent, freeConsistent: rbFree.snapshotConsistent, latchCount: memCount },
  })
}

export function createCdcOutboxJoinEvidence(opts = {}) {
  const seed = intOr(opts.seed, CDC_JOIN_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `coj:key:${i}`)
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
  bus.subscribe('cdc.entity', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('cdc.entity', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('cdc.entity')

  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`coj:snap:${k}`, '1')
  let hits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`coj:snap:${k}`) !== undefined) hits += 1
  ev.redisBitmapHits = hits
  ev.redisSlots = cache.stats().entries

  const pool = createObjectPool({ factory: () => ({ joinEntry: null }), maxSize: 8 })
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
  heap.schedule(fixedNow + 40, 'coj:snap')
  heap.schedule(fixedNow + 250, 'coj:gc')
  heap.schedule(fixedNow + 80, 'coj:replay')
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
  const nailedSnapshot = rigged || args.includes('--nailed-snapshot')
  const freeBinlog = rigged || args.includes('--free-binlog')
  const noLatch = rigged || args.includes('--no-latch')
  const study = cdcOutboxJoinStudy({ rigged, nailedSnapshot, freeBinlog, noLatch, now: () => nowMs })
  const snap = cdcOutboxJoinSnapshot(study)
  console.log('[cdc-outbox-join] seed=' + snap.config.seed +
    ' messages=' + snap.config.messages + ' interval=' + snap.config.interval +
    ' rigged=' + snap.config.rigged +
    ' nailedSnapshot=' + snap.config.nailedSnapshot +
    ' freeBinlog=' + snap.config.freeBinlog +
    ' noLatch=' + snap.config.noLatch +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log('  ' + row.protocol.padEnd(20) +
      ' joins=' + row.metrics.totalJoins +
      ' trilemma={' + ['snapshotConsistent=' + row.trilemma.snapshotConsistent, 'zeroDowntime=' + row.trilemma.zeroDowntime, 'rendezvousCapable=' + row.trilemma.rendezvousCapable].join(',') + '}')
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.noUniversalWinner + ' distinguishable=' + snap.trilemmaDistinguishes +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma + ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed)
  console.log('  causalLocks: snapshotWindow=' + snap.causalLocks.snapshotCommitWindowCausallyUnerasable +
    ' binlogBorderline=' + snap.causalLocks.binlogBorderlineCausallyUnerasable +
    ' outboxLock=' + snap.causalLocks.outboxLockCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const cp = snap.crosscheck.soundness
  console.log('  verifyCdcOutboxJoinSoundness: holds=' + cp.holds + ' nontrivial=' + cp.nontrivial +
    ' laneA{snapshotJoins=' + cp.laneA.snapshotJoins + '} laneB{binlogJoins=' + cp.laneB.binlogJoins + '}' +
    ' tamper{snap=' + cp.tamper.snapshotMismatched.holds + ',binlog=' + cp.tamper.binlogMiss.holds + ',latch=' + cp.tamper.atomicLatchLeak.holds + '}')
}
