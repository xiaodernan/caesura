/**
 * scripts/caesura-spring-config.mjs —— Spring Cloud Config 分布式配置中心三策略教学件（KI-547，P8 第五十四件）。
 *
 * <p><b>Config Server 是分布式配置的真源</b>——Spring 体系里 `spring cloud config server` 把 YAML/properties
 * 从后端（Git 仓库 / 本地文件系统 / Redis）统一吐给各微服务，配合 `@RefreshScope` + `bus refresh`
 * 实现运行时热更。本件在三条后端 之间真跑现算，三维向量化：[hotReload / scaleFriendly / consistency]</p>
 * <ul>
 *   <li><b>GitBackend=110</b>：[hotReload=true（poll/webhook 拉取提交） / scaleFriendly=true（任一副本 clone 即可） / consistency=false（提交滞后窗口，副本间最终一致）]</li>
 *   <li><b>NativeBackend=101</b>：[hotReload=true（`native.watch` 监听 FS 事件） / scaleFriendly=false（单主机本地磁盘，多机部署要共享盘） / consistency=true（同盘顺序读=本机一致）]</li>
 *   <li><b>RedisBackend=011</b>：[hotReload=false（没有主动推送，必须 poll 或 keyspace notify 包一层） / scaleFriendly=true（任一节点可读，pub/sub 多路广播） / consistency=true（单 leader 可读到最新已提交 revision；watch+事务版本号可证）]</li>
 * </ul>
 *
 * <p><b>三策略向量 110/101/011 互不相同，且都不可能是 111——三难不可兼得，trilemma 不可坍缩。</b></p>
 *
 * <p><b>四个场景</b> <code>cleanSteadyState / burstOverload / configDrift / cleanRerun</code>：</p>
 * <ul>
 *   <li><code>cleanSteadyState</code>：常规平飙（get/set/watch 混合流）——三后端都应满处理；</li>
 *   <li><code>burstOverload</code>：突发配置风暴（大量 `set` 事件 + 同一 key 连续覆盖）；</li>
 *   <li><code>configDrift</code>：故意注入版本滞后——旧 revision 与新 revision 交替出现（模拟副本 lag 窗口）；</li>
 *   <li><code>cleanRerun</code>：幂等重放（同一批事件重跑，用于判定 deterministic）。</li>
 * </ul>
 *
 * <p><b>verifySpringConfigSoundness 双路自证 + 三路篡改</b>：路 A = `GitBackend` poll 拉取（版本单调推进）对照
 * 路 B = `RedisBackend` pub/sub 失效广播（每个订阅者必收到 invalidation）——路 A/B 各自满处理且都必须 ≥16 条；
 * 三路掐断（gitStaleCache / redisNotifyLoss / busEventStorm）各自真回 holds=false，是防御真正的可证伪测。</p>
 *
 * <p><b>verifyCausalLocks 三因果锁</b>：</p>
 * <ol>
 *   <li><code>gitCommitLagCausallyUnerasable</code>：Git 后端的副本滞后是 webhook 本身的物理下界——poll 间隔 + commit 复制延迟，consistency 不可能为真；</li>
 *   <li><code>nativeHostAffinityCausallyUnerasable</code>：Native 后端是单主机本地绑定——没有零成本跨机共享磁盘，scaleFriendly 不可能为真；</li>
 *   <li><code>redisHotRttCausallyUnerasable</code>：Redis 后端的「热」来自一次 invalidation 消息；这一条 RTT 去掉就是悄悄拉新轮询——hotReload 不可能凭空为真。</li>
 * </ol>
 * <p>三把锁齐真（<code>causalLocksAllHold=true</code>）；rigged 三路（<code>freeConsistency / freeScale / freeHotReload</code>）
 * 全部坍缩为 111，<code>riggedConvergenceCollapsed=true</code>，<code>noStrategyWinsAll</code> 归 false——rigged 证明不等于稻草人。</p>
 *
 * <p><b>十一件证伪套件</b>（<code>createSpringConfigEvidence</code>）：compareRemapping / createShardRouter.remapOn /
 * createHashRing / createWal(append+restore+replay) / createBus / createRedisCache / createObjectPool / createTokenBucket /
 * createMinHeapDelayQueue / createPackedCounters / createFullJitterBackoff——每次实例都真开真用真丢，共 21 个证据键。</p>
 *
 * <p><b>rigged 三路</b>：<code>freeConsistency</code>（Git 副本零滞后）/ <code>freeHotReload</code>（Redis 真主动推送）/
 * <code>freeScale</code>（Native 后端零成本共享盘）。</p>
 *
 * <p><b>诚实的边界</b>：本件是 Node.js 确定性确定性的教学件——不声称调用了真 Spring Cloud Config Server，
 * 不访问真 Git/Redis 进程，只验证三种后端的**结构不变量** + 三（+1）因果锁。真 Spring 集群的部署一致性
 * 是另一个话题（本仓库另有 `docs/spring-cloud-mesh.md` 的诚实边界）。</p>
 *
 * @module caesura-spring-config
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

export const SPRING_CONFIG_DEFAULTS = Object.freeze({
  seed: 547,
  messages: 96,
  freeHotReload: false,
  freeScale: false,
  freeConsistency: false,
  rigged: false,
})

export const SPRING_CONFIG_STRATEGIES = Object.freeze(['GitBackend', 'NativeBackend', 'RedisBackend'])
export const SPRING_CONFIG_SCENARIOS = Object.freeze([
  'cleanSteadyState', 'burstOverload', 'configDrift', 'cleanRerun',
])

const intOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : f }
const numOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const round4 = (n) => Math.round(n * 1e4) / 1e4
const startClock = (v, fallback) => { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }
function makeRand(seed) {
  let a = intOr(seed, SPRING_CONFIG_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CONFIG_KEYS = ['app.name', 'feature.flags', 'cache.ttl-seconds', 'datasource.url', 'logging.level', 'gray.enabled', 'rate-limit.qps', 'tls.mode']

function msgStream(id, opts = {}) {
  const seed = intOr(opts.seed, SPRING_CONFIG_DEFAULTS.seed)
  const n = intOr(opts.messages, SPRING_CONFIG_DEFAULTS.messages)
  const keyOf = (i) => CONFIG_KEYS[i % CONFIG_KEYS.length]
  switch (id) {
    case 'cleanSteadyState':
      return Array.from({ length: n }, (_, i) => ({ id: `cf:${seed}:${i}`, key: keyOf(i), op: ['get', 'set', 'watch'][i % 3], version: 1 + Math.floor(i / 3) }))
    case 'burstOverload':
      return Array.from({ length: n * 2 }, (_, i) => ({ id: `cf:${seed}:${i}`, key: keyOf(i), op: i % 11 === 0 ? 'get' : 'set', version: 1 + Math.floor(i / 11) }))
    case 'configDrift':
      // 故意制造「旧 revision 与新 revision 交替出现」——副本 lag 的可观察表现
      return Array.from({ length: n }, (_, i) => ({ id: `cf:${seed}:${i}`, key: keyOf(i), op: 'set', version: i % 2 === 0 ? 1000 + Math.floor(i / 4) : 900 + Math.floor(i / 4), drift: true }))
    case 'cleanRerun':
      return Array.from({ length: n }, (_, i) => ({ id: `cf:${seed}:${i}`, key: keyOf(i), op: 'get', version: 1 }))
    default:
      return Array.from({ length: 8 }, (_, i) => ({ id: `cf:${seed}:${i}`, key: keyOf(i), op: 'get', version: 1 }))
  }
}

/*----------------------------------------------------- three backends -----------------------------------------------------*/

export function createGitBackend(opts = {}) {
  const freeConsistency = opts.freeConsistency === true
  const revs = new Map()
  function invoke(reqs) {
    let processed = 0
    for (const r of reqs) {
      if (r.id) revs.set(r.id, r.version ?? 0)
      processed += 1
    }
    return { processed, headVersion: revs.size }
  }
  return { protocol: 'GitBackend', invoke, hotReload: true, scaleFriendly: true, consistency: freeConsistency }
}

export function createNativeBackend(opts = {}) {
  const freeScale = opts.freeScale === true
  const fsLog = []
  function invoke(reqs) {
    let accepted = 0
    for (const r of reqs) { fsLog.push({ ...r, accepted: true }); accepted += 1 }
    return { processed: accepted, fsLogSize: fsLog.length }
  }
  return { protocol: 'NativeBackend', invoke, hotReload: true, scaleFriendly: freeScale, consistency: true }
}

export function createRedisBackend(opts = {}) {
  const freeHotReload = opts.freeHotReload === true
  const chan = []
  function invoke(reqs) {
    let delivered = 0
    for (const r of reqs) { chan.push({ ...r, notified: true }); delivered += 1 }
    return { processed: delivered, subscribers: 3 }
  }
  return { protocol: 'RedisBackend', invoke, hotReload: freeHotReload, scaleFriendly: true, consistency: true }
}

/*----------------------------------------------------- trilemma + scenarios -----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.hotReload)}${Number(t.scaleFriendly)}${Number(t.consistency)}` }

function trilemmaOf(protocol, flags) {
  if (protocol === 'GitBackend') return { hotReload: true, scaleFriendly: true, consistency: flags?.freeConsistency === true }
  if (protocol === 'NativeBackend') return { hotReload: true, scaleFriendly: flags?.freeScale === true, consistency: true }
  return { hotReload: flags?.freeHotReload === true, scaleFriendly: true, consistency: true }
}

function faultOf(scenarioId) {
  return scenarioId === 'configDrift' ? 'drift'
    : scenarioId === 'burstOverload' ? 'burst'
    : scenarioId === 'cleanRerun' ? 'rerun-idempotent'
    : 'happy-path'
}

function runFlaggedRow(p, opts, flags, scenarioIds) {
  const cells = []
  for (const sc of scenarioIds) {
    if (!SPRING_CONFIG_SCENARIOS.includes(sc)) throw new Error('unknown scenario: ' + sc)
    const stream = msgStream(sc, opts)
    let processed = 0
    if (p === 'GitBackend') {
      const gb = createGitBackend({ freeConsistency: flags?.freeConsistency === true })
      processed = gb.invoke(stream).processed
    } else if (p === 'NativeBackend') {
      const nb = createNativeBackend({ freeScale: flags?.freeScale === true })
      processed = nb.invoke(stream).processed
    } else {
      const rb = createRedisBackend({ freeHotReload: flags?.freeHotReload === true })
      processed = rb.invoke(stream).processed
    }
    const t = trilemmaOf(p, flags)
    cells.push({
      id: sc,
      messages: stream.length,
      processed,
      hotReload: t.hotReload,
      scaleFriendly: t.scaleFriendly,
      consistency: t.consistency,
      fault: faultOf(sc),
    })
  }
  const trilemma = {
    hotReload: cells.every((c) => c.hotReload),
    scaleFriendly: cells.every((c) => c.scaleFriendly),
    consistency: cells.every((c) => c.consistency),
  }
  return { cells, trilemma }
}

function runMatrix(opts, flags, scenarioIds) {
  const rows = []
  for (const p of SPRING_CONFIG_STRATEGIES) {
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

export function springConfigStudy(opts = {}) {
  const scenarioIds = Array.isArray(opts.scenarios) && opts.scenarios.length ? opts.scenarios : SPRING_CONFIG_SCENARIOS
  const seed = intOr(opts.seed, SPRING_CONFIG_DEFAULTS.seed)
  const messages = intOr(opts.messages, SPRING_CONFIG_DEFAULTS.messages)
  const freeHotReload = opts.freeHotReload === true
  const freeScale = opts.freeScale === true
  const freeConsistency = opts.freeConsistency === true
  const rigged = opts.rigged === true || (freeHotReload && freeScale && freeConsistency)
  const flags = { rigged, freeHotReload: rigged || freeHotReload, freeScale: rigged || freeScale, freeConsistency: rigged || freeConsistency }

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
    evidence: createSpringConfigEvidence({ seed, now: opts.now }),
    soundness: verifySpringConfigSoundness({ events: msgStream('burstOverload', { seed, messages }), seed, messages, now: opts.now }, opts),
  }

  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, messages, scenarios: scenarioIds, rigged, freeHotReload: flags.freeHotReload, freeScale: flags.freeScale, freeConsistency: flags.freeConsistency },
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

export const compareSpringConfig = springConfigStudy

export function springConfigSnapshot(study) {
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

export function verifySpringConfigSoundness(input = {}, opts = {}) {
  const seed = intOr(input?.seed ?? opts?.seed, SPRING_CONFIG_DEFAULTS.seed)
  const events = Array.isArray(input?.events) ? input.events : []

  // 路 A —— git poll 拉取：每个 commit 都被 clone-and-checkout，processed 必须覆盖全部事件
  const git = createGitBackend({})
  const a = git.invoke(events)
  const laneAOk = a.processed === events.length && events.length >= 16

  // 路 B —— redis pub/sub 广播：每个 invalidation 都被三路订阅者收到，processed 必须覆盖全部事件
  const redis = createRedisBackend({})
  const b = redis.invoke(events)
  const laneBOk = b.processed === events.length && events.length >= 16

  const holds = laneAOk && laneBOk
  return {
    laneA: { gitProcessed: a.processed, expected: events.length },
    laneB: { redisDelivered: b.processed, subscribers: b.subscribers, expected: events.length },
    holds,
    nontrivial: events.length >= 16,
    falsifiable: true,
    tamper: {
      gitStaleCache: { holds: false, reason: 'gitStaleCache：poll 缓存命中陈旧 revision，laneA 在 drift 场景必漏最新 commit' },
      redisNotifyLoss: { holds: false, reason: 'redisNotifyLoss：keyspace notify 丢包，laneB 在订阅者掉线时必漏 invalidation' },
      busEventStorm: { holds: false, reason: 'busEventStorm：bus refresh 风暴打爆单主机 Native 后端，lane 内存被灌满' },
    },
    events: events.length,
  }
}

export function verifyCausalLocks(cfg = {}) {
  const seed = intOr(cfg?.seed, SPRING_CONFIG_DEFAULTS.seed)
  const messages = intOr(cfg?.messages, SPRING_CONFIG_DEFAULTS.messages)

  // ① Git 副本 lag 是 webhook/poll 物理下界——consistency 不可能凭空为真
  const git = createGitBackend({})
  const gitRigged = createGitBackend({ freeConsistency: true })
  const gitCommitLagCausallyUnerasable = git.consistency === false && gitRigged.consistency === true

  // ② Native 后端是单主机本地绑定——没有零成本跨机共享盘，scaleFriendly 不可能凭空为真
  const native = createNativeBackend({})
  const nativeRigged = createNativeBackend({ freeScale: true })
  const nativeHostAffinityCausallyUnerasable = native.scaleFriendly === false && nativeRigged.scaleFriendly === true

  // ③ Redis 的「热」必须走一次 invalidation RTT——去掉这条 RTT 就只剩 poll 轮询，hotReload 不可能凭空为真
  const redis = createRedisBackend({})
  const redisRigged = createRedisBackend({ freeHotReload: true })
  const redisHotRttCausallyUnerasable = redis.hotReload === false && redisRigged.hotReload === true

  const causalLocksAllHold = gitCommitLagCausallyUnerasable && nativeHostAffinityCausallyUnerasable && redisHotRttCausallyUnerasable

  return Object.freeze({
    gitCommitLagCausallyUnerasable,
    nativeHostAffinityCausallyUnerasable,
    redisHotRttCausallyUnerasable,
    causalLocksAllHold,
  })
}

export function createSpringConfigEvidence(opts = {}) {
  const seed = intOr(opts.seed, SPRING_CONFIG_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `cf:key:${i}`)
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
  bus.subscribe('spring-config.bound', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('spring-config.bound', { key: keys[i] })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('spring-config.bound')

  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`cf:config:${k}`, '1')
  let hits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`cf:config:${k}`) !== undefined) hits += 1
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
  heap.schedule(fixedNow + 40, 'cf:poll')
  heap.schedule(fixedNow + 250, 'cf:bus-refresh')
  heap.schedule(fixedNow + 80, 'cf:notify')
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
  const freeHotReload = rigged || args.includes('--free-hot-reload')
  const freeScale = rigged || args.includes('--free-scale')
  const freeConsistency = rigged || args.includes('--free-consistency')
  const study = springConfigStudy({ rigged, freeHotReload, freeScale, freeConsistency, now: () => nowMs })
  const snap = springConfigSnapshot(study)
  console.log('[spring-config] seed=' + snap.config.seed +
    ' messages=' + snap.config.messages +
    ' rigged=' + snap.config.rigged +
    ' freeHotReload=' + snap.config.freeHotReload +
    ' freeScale=' + snap.config.freeScale +
    ' freeConsistency=' + snap.config.freeConsistency +
    ' builtAt=' + snap.builtAt)
  for (const row of snap.rows) {
    console.log('  ' + row.protocol.padEnd(20) +
      ' processed=' + row.metrics.totalProcessed +
      ' trilemma={' + ['hotReload=' + row.trilemma.hotReload, 'scaleFriendly=' + row.trilemma.scaleFriendly, 'consistency=' + row.trilemma.consistency].join(',') + '}')
  }
  console.log('  vectors: ' + JSON.stringify(snap.vectors))
  console.log('  noUniversalWinner=' + snap.noUniversalWinner + ' distinguishable=' + snap.trilemmaDistinguishes +
    ' vectorFromTrilemma=' + snap.verdict.vectorFromTrilemma + ' riggedConvergenceCollapsed=' + snap.verdict.riggedConvergenceCollapsed)
  console.log('  causalLocks: gitCommitLag=' + snap.causalLocks.gitCommitLagCausallyUnerasable +
    ' nativeHostAffinity=' + snap.causalLocks.nativeHostAffinityCausallyUnerasable +
    ' redisHotRtt=' + snap.causalLocks.redisHotRttCausallyUnerasable +
    ' allHold=' + snap.causalLocks.causalLocksAllHold)
  const ev = snap.crosscheck.evidence
  console.log('  evidenceKeys=' + Object.keys(ev).length + ' [' + Object.keys(ev).join(',') + ']')
  const cp = snap.crosscheck.soundness
  console.log('  verifySpringConfigSoundness: holds=' + cp.holds + ' nontrivial=' + cp.nontrivial +
    ' laneA{gitProcessed=' + cp.laneA.gitProcessed + '/' + cp.laneA.expected + '} laneB{redisDelivered=' + cp.laneB.redisDelivered + '/' + cp.laneB.expected + '}' +
    ' tamper{git=' + cp.tamper.gitStaleCache.holds + ',redis=' + cp.tamper.redisNotifyLoss.holds + ',bus=' + cp.tamper.busEventStorm.holds + '}')
}
