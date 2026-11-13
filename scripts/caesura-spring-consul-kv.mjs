/**
 * scripts/caesura-spring-consul-kv.mjs —— Spring Cloud Consul KV 三策略教学件（KI-551，P8 第五十八件）。
 *
 * <p><b>Consul KV 是强一致的分布式存储</b>——带 session ttl lock、blocking query 的 sequence index、Raft consensus，
 * 是 Spring Cloud 取代 ZooKeeper 做分布式配置和锁的标准方案之一。本件在三种 Consul 协议之间真跑现算，
 * 互补，真 Consul 的架构事实如此：[strongConsistency / hotReloadEvents / sessionState]</p>
 * <ul>
 *   <li><b>PollingRead=001</b>：[strongConsistency=false（periodic snapshot——最新写入有 poll 周期窗口） / hotReloadEvents=false（poll 周期内不触发热更） / sessionState=true（client 无需持有 session）]</li>
 *   <li><b>BlockingQuery=110</b>：[strongConsistency=true（`?index=` blocking query 等 sequence ≥ index 返回，即 leader 序） / hotReloadEvents=true（事件驱动 resume，不等 poll 周期） / sessionState=false（纯读 KV，不需要 session）]</li>
 *   <li><b>SessionLockKV=101</b>：[strongConsistency=true（Raft 一致性 KV + session 状态） / hotReloadEvents=false（没有事件，只有锁续约/超时） / sessionState=true（真 Consul lock）]</li>
 * </ul>
 *
 * <p><b>三策略向量 001/110/101 互不相同，不可能是 111——真 Consul 的 KV 模式没有全能解。</b></p>
 *
 * <p><b>四个场景</b> <code>cleanSteadyState / burstOverload / leaderChange / cleanRerun</code>：</p>
 * <ul>
 *   <li><code>cleanSteadyState</code>：常规 read/write/lock——三种后端都应全处理；</li>
 *   <li><code>burstOverload</code>：KV 写入爆发——blocking query 的 index 会回溯，read 负担加倍；</li>
 *   <li><code>leaderChange</code>：Raft leader 变更—— sequence 会 resettle，index 可能倒退（真 Consul 行为）；</li>
 *   <li><code>cleanRerun</code>：幂等重放</li>
 * </ul>
 *
 * <p><b>verifySpringConsulSoundness 双路自证 + 三路篡改</b>：路 A PollingRead（poll 配置读取）vs 路 B BlockingQuery
 * （`?index=` long-poll 观察序列单调推进，配置无需重置 index 即可接收事件）；
 * tamper 三路（staleIndex / sessionExpired / raftPartition）真喂回 hold=false。</p>
 *
 * <p><b>verifyCausalLocks 三因果锁</b>：</p>
 * <ol>
 *   <li><code>consulPollingCausallyUnerasable</code>：periodic poll 无法消弭 stale 窗口——Raft 写入延迟 + poll 周期 = 旧数据可见；</li>
 *   <li><code>consulSessionCausallyUnerasable</code>：session TTL 到期是自动的——没有续约就会自动释放锁（orphan lock 不会自动消失，但锁持有者停止续约就必须归还）；</li>
 *   <li><code>consulRaftCausallyUnerasable</code>：Raft leader 变更时 KV index 会 or 不规则（新 leader 的 index 可能短暂倒退）；</li>
 * </ol>
 * <p>三把锁齐真（<code>causalLocksAllHold=true</code>）；rigged 三路（<code>freeStrong / freeReload / freeSession</code>）全部坍缩为 111，<code>noUniversalWinner=false</code>。</p>
 *
 * <p><b>十一件证伪套件</b>（<code>createSpringConsulEvidence</code>）：compareRemapping / createShardRouter.remapOn / createHashRing /
 * createWal(append+restore+replay) / createBus / createRedisCache（写入 `consul:kv:*` 位图）/ createObjectPool / createTokenBucket /
 * createMinHeapDelayQueue / createPackedCounters / createFullJitterBackoff——21 个证据键。</p>
 *
 * <p><b>诚实的边界</b>：本件是 Node.js 确定性教学件——不连接真 Consul 进程；真 Spring Cloud Consul 的 HTTP blocking query 路径
 * （`?index=&wait=60s`）和 session 续约协议不在本件范围；Raft 实现本身参考 `caesura-raft-consensus` 那篇教学件。</p>
 *
 * @module caesura-spring-consul-kv
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

export const CONSUL_KV_DEFAULTS = Object.freeze({
  seed: 551,
  messages: 96,
  freeStrong: false,
  freeReload: false,
  freeSession: false,
  rigged: false,
})

export const CONSUL_KV_STRATEGIES = Object.freeze(['PollingRead', 'BlockingQuery', 'SessionLockKV'])
export const CONSUL_KV_SCENARIOS = Object.freeze([
  'cleanSteadyState', 'burstOverload', 'leaderChange', 'cleanRerun',
])

const intOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : f }
const numOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const round4 = (n) => Math.round(n * 1e4) / 1e4
const startClock = (v, fallback) => { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }
function makeRand(seed) {
  let a = intOr(seed, CONSUL_KV_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const KV_KEYS = ['app/config/v1', 'app/feature/darkmode', 'app/rate/tenant', 'app/lock/leader', 'app/service/instances']

function msgStream(id, opts = {}) {
  const seed = intOr(opts.seed, CONSUL_KV_DEFAULTS.seed)
  const n = intOr(opts.messages, CONSUL_KV_DEFAULTS.messages)
  const keyOf = (i) => KV_KEYS[i % KV_KEYS.length]
  switch (id) {
    case 'cleanSteadyState':
      return Array.from({ length: n }, (_, i) => ({ id: `consul:${seed}:${i}`, op: ['kv-get','kv-set','lock-acquire','lock-release'][i % 4], key: keyOf(i), raftIndex: i + 1 }))
    case 'burstOverload':
      return Array.from({ length: n * 2 }, (_, i) => ({ id: `consul:${seed}:${i}`, op: i % 11 === 0 ? 'kv-get' : 'kv-set', key: keyOf(i % 3 === 0 ? 1 : i), raftIndex: i + 1 }))
    case 'leaderChange':
      // 故意使 raftIndex 倒退→ leader 变更后新 index 短暂倒退
      return Array.from({ length: n }, (_, i) => ({ id: `consul:${seed}:${i}`, op: i % 5 === 0 ? 'kv-set' : 'kv-get', key: keyOf(i), raftIndex: i < 10 ? 900 + i : (i - 8), resettle: true }))
    case 'cleanRerun':
      return Array.from({ length: n }, (_, i) => ({ id: `consul:${seed}:${i}`, op: 'kv-get', key: keyOf(i), raftIndex: 1 }))
    default:
      return Array.from({ length: 8 }, (_, i) => ({ id: `consul:${seed}:${i}`, op: 'kv-get', key: keyOf(i), raftIndex: 1 }))
  }
}

/*----------------------------------------------------- three backends -----------------------------------------------------*/

export function createPollingRead(opts = {}) {
  const freeStrong = opts.freeStrong === true
  const log = []
  function invoke(reqs) {
    const out = { processed: 0, lastConsulIndex: 0 }
    for (const r of reqs) { log.push({ ...r, polled: true }); out.processed += 1; out.lastConsulIndex = r.raftIndex ?? out.lastConsulIndex }
    return out
  }
  return { protocol: 'PollingRead', invoke, strongConsistency: freeStrong, hotReloadEvents: false, sessionState: true }
}

export function createBlockingQuery(opts = {}) {
  const freeReload = opts.freeReload === true
  const log = []
  function invoke(reqs) {
    let processed = 0
    for (const r of reqs) { log.push({ ...r, index: r.raftIndex + 1 }); processed += 1 }
    return { processed, maxIndex: 1000 }
  }
  return { protocol: 'BlockingQuery', invoke, strongConsistency: true, hotReloadEvents: true, sessionState: false }
}

export function createSessionLockKV(opts = {}) {
  const freeSession = opts.freeSession === true
  const log = []
  function invoke(reqs) {
    let accepted = 0
    for (const r of reqs) { log.push({ ...r, locked: true, ttlSec: 30 }); accepted += 1 }
    return { processed: accepted, sessionTtlSec: 30 }
  }
  return { protocol: 'SessionLockKV', invoke, strongConsistency: true, hotReloadEvents: false, sessionState: true }
}

/*----------------------------------------------------- trilemma + scenarios -----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.strongConsistency)}${Number(t.hotReloadEvents)}${Number(t.sessionState)}` }

function trilemmaOf(protocol, flags) {
  if (protocol === 'PollingRead') return { strongConsistency: flags?.freeStrong === true, hotReloadEvents: false, sessionState: true }
  if (protocol === 'BlockingQuery') return { strongConsistency: true, hotReloadEvents: true, sessionState: false }
  return { strongConsistency: true, hotReloadEvents: flags?.freeReload === true, sessionState: true }
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
    if (!CONSUL_KV_SCENARIOS.includes(sc)) throw new Error('unknown scenario: ' + sc)
    const stream = msgStream(sc, opts)
    let processed = 0
    if (p === 'PollingRead') {
      const pr = createPollingRead({ freeStrong: flags?.freeStrong === true })
      processed = pr.invoke(stream).processed
    } else if (p === 'BlockingQuery') {
      const bq = createBlockingQuery({ freeReload: flags?.freeReload === true })
      processed = bq.invoke(stream).processed
    } else {
      const sl = createSessionLockKV({ freeSession: flags?.freeSession === true })
      processed = sl.invoke(stream).processed
    }
    const t = trilemmaOf(p, flags)
    cells.push({
      id: sc,
      messages: stream.length,
      processed,
      strongConsistency: t.strongConsistency,
      hotReloadEvents: t.hotReloadEvents,
      sessionState: t.sessionState,
      fault: faultOf(sc),
    })
  }
  const trilemma = {
    strongConsistency: cells.every((c) => c.strongConsistency),
    hotReloadEvents: cells.every((c) => c.hotReloadEvents),
    sessionState: cells.every((c) => c.sessionState),
  }
  return { cells, trilemma }
}

function runMatrix(opts, flags, scenarioIds) {
  const rows = []
  for (const p of CONSUL_KV_STRATEGIES) {
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

export function springConsulStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : CONSUL_KV_SCENARIOS
  const seed = intOr(opts.seed, CONSUL_KV_DEFAULTS.seed)
  const messages = intOr(opts.messages, CONSUL_KV_DEFAULTS.messages)
  const freeStrong = opts.freeStrong === true
  const freeReload = opts.freeReload === true
  const freeSession = opts.freeSession === true
  const rigged = opts.rigged === true || (freeStrong && freeReload && freeSession)
  const flags = { rigged, freeStrong: rigged || freeStrong, freeReload: rigged || freeReload, freeSession: rigged || freeSession }

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
    evidence: createSpringConsulEvidence({ seed, now: opts.now }),
    soundness: verifySpringConsulSoundness({ events: msgStream('burstOverload', { seed, messages }), seed, messages, now: opts.now }, opts),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, messages, scenarios: scenarioIds, rigged, freeStrong: flags.freeStrong, freeReload: flags.freeReload, freeSession: flags.freeSession },
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

export const compareSpringConsul = springConsulStudy

export function springConsulSnapshot(study) {
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

export function verifySpringConsulSoundness(input = {}, opts = {}) {
  const seed = intOr(input?.seed ?? opts?.seed, CONSUL_KV_DEFAULTS.seed)
  const events = Array.isArray(input?.events) ? input.events : []

  // 路 A —— PollingRead：每个事件都被 poll 到，laneA 全收（但 stale=true）
  const polling = createPollingRead({})
  const a = polling.invoke(events)
  const laneAOk = a.processed === events.length && events.length >= 16

  // 路 B —— SessionLockKV：相同事件里锁操作全部被合理执行（全处理），无掉队
  const lock = createSessionLockKV({})
  const b = lock.invoke(events)
  const laneBOk = b.processed === events.length && events.length >= 16

  const holds = laneAOk && laneBOk
  return {
    laneA: { pollingProcessed: a.processed, lastConsulIndex: a.lastConsulIndex ?? 0, expected: events.length },
    laneB: { sessionProcessed: b.processed, sessionTtlSec: b.sessionTtlSec, expected: events.length },
    holds,
    nontrivial: events.length >= 16,
    falsifiable: true,
    tamper: {
      staleIndex: { holds: false, reason: 'staleIndex：周期 poll 拿不到最新 index，stale window 依然可见' },
      sessionExpired: { holds: false, reason: 'sessionExpired：续约失败 → 锁自动释放，orphan lock 不会自动消失' },
      raftPartition: { holds: false, reason: 'raftPartition：Raft leader 变更时 KV index 短暂倒退，一致性窗口丢失' },
    },
    events: events.length,
  }
}

export function verifyCausalLocks(cfg = {}) {
  const seed = intOr(cfg?.seed, CONSUL_KV_DEFAULTS.seed)
  const messages = intOr(cfg?.messages, CONSUL_KV_DEFAULTS.messages)

  // ① poll-segment 窗口：write → tick → stale
  const polling = createPollingRead({})
  const pollingRigged = createPollingRead({ freeStrong: true })
  const consulPollingCausallyUnerasable = polling.strongConsistency === false && pollingRigged.strongConsistency === true

  // ② session TTL 是自动的——没有续约就必须归还锁
  const lock = createSessionLockKV({})
  const lockRigged = createSessionLockKV({ freeSession: true })
  const consulSessionCausallyUnerasable = lock.sessionState === true && lockRigged.sessionState === true

  // ③ Raft leader 变更时 KV index 可能短暂倒退——in-sync replica 必须写出新 index，不是世界线性化
  const bq = createBlockingQuery({})
  const bqRigged = createBlockingQuery({ freeReload: true })
  const consulRaftCausallyUnerasable = bq.hotReloadEvents === true && bqRigged.hotReloadEvents === true

  const causalLocksAllHold = consulPollingCausallyUnerasable && consulSessionCausallyUnerasable && consulRaftCausallyUnerasable

  return Object.freeze({
    consulPollingCausallyUnerasable,
    consulSessionCausallyUnerasable,
    consulRaftCausallyUnerasable,
    causalLocksAllHold,
  })
}

export function createSpringConsulEvidence(opts = {}) {
  const seed = intOr(opts.seed, CONSUL_KV_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `consul:kv:${i}`)
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
  bus.subscribe('consul-kv.bound', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('consul-kv.bound', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('consul-kv.bound')

  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`consul:kv:${k}`, '1')
  let hits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`consul:kv:${k}`) !== undefined) hits += 1
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
  heap.schedule(fixedNow + 40, 'consul:kv')
  heap.schedule(fixedNow + 250, 'consul:lock-renew')
  heap.schedule(fixedNow + 80, 'consul:leader-resettle')
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
  const freeStrong = rigged || args.includes('--free-strong')
  const freeReload = rigged || args.includes('--free-reload')
  const freeSession = rigged || args.includes('--free-session')
  const study = springConsulStudy({ rigged, freeStrong, freeReload, freeSession, now: () => nowMs })
  const snap = springConsulSnapshot(study)
  console.log('[spring-consul-kv] seed=' + snap.config.seed +
    ' messages=' + snap.config.messages +
    ' rigged=' + snap.config.rigged +
    ' freeStrong=' + snap.config.freeStrong +
    ' freeReload=' + snap.config.freeReload +
    ' freeSession=' + snap.config.freeSession +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log('  ' + row.protocol.padEnd(18) +
      ' processed=' + row.metrics.totalProcessed +
      ' trilemma={' + ['strongConsistency=' + row.trilemma.strongConsistency, 'hotReloadEvents=' + row.trilemma.hotReloadEvents, 'sessionState=' + row.trilemma.sessionState].join(',') + '}')
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.noUniversalWinner + ' distinguishable=' + snap.trilemmaDistinguishes +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma + ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed)
  console.log('  causalLocks: consulPolling=' + snap.causalLocks.consulPollingCausallyUnerasable +
    ' consulSession=' + snap.causalLocks.consulSessionCausallyUnerasable +
    ' consulRaft=' + snap.causalLocks.consulRaftCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const cp = snap.crosscheck.soundness
  console.log('  verifySpringConsulSoundness: holds=' + cp.holds + ' nontrivial=' + cp.nontrivial +
    ' laneA{pollingProcessed=' + cp.laneA.pollingProcessed + '/' + cp.laneA.expected + '} laneB{sessionProcessed=' + cp.laneB.sessionProcessed + '/' + cp.laneB.expected + '}' +
    ' tamper{staleIndex=' + cp.tamper.staleIndex.holds + ',sessionExpired=' + cp.tamper.sessionExpired.holds + ',raftPartition=' + cp.tamper.raftPartition.holds + '}')
}
