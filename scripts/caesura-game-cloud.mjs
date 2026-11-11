/**
 * scripts/caesura-game-cloud.mjs —— 游戏侧「开箱即用」云入口（集大成最终收口）。
 *
 * <p>把前几轮的积木（facade / mesh-registry / 网关可用化 / load-balancer / 游戏适配层 / 进程内熔断 / sleuth tracer / service-proxy）
 * 收口成游戏本体只需一行就能拉起的一朵云：</p>
 *
 * ```js
 * const gc = createGameCloud({ gameId: 'caesura-game', gamePort: 7700, sources: { eureka: () => discoverEureka() } })
 * await gc.start()                 // 注册游戏实例、广播 lifecycle/runtime 事件、起 tracer/gateway
 * const data = await gc.proxyCall('caesura-gate', '/api/x')  // 负载均衡 + 进程内熔断 + 调用链追踪
 * await gc.shutdown()              // 注销 + 广播 stopped
 * ```
 *
 * <p>判词仍由 Node 侧持有（决策原则①）：本件只做编排与默认值收口，不写任何业务阈值；阈值经 opts 注入。</p>
 */
import { createCloudRuntime } from './caesura-cloud-runtime.mjs'
import { createServiceProxy } from './caesura-service-proxy.mjs'
import { createGameEventBus } from './caesura-event-bus.mjs'
import { createAuthGuard } from './caesura-auth-guard.mjs'
import { createGameEventBridge } from './caesura-game-event-bridge.mjs'
import { createRedisCache } from './caesura-redis-cache.mjs'
import { createLsmStore } from './caesura-lsm-store.mjs'
import { allocationStudy, compareLayouts, createCacheLinePadder, createPackedCounters } from './caesura-hw-perf.mjs'
import { createHashRing, compareRemapping, createShardRouter } from './caesura-consistent-hash.mjs'
import { createShardedCache, compareHitRetention } from './caesura-sharded-cache.mjs'
import { cacheGuardStudy, guardSnapshot } from './caesura-cache-guard.mjs'
import { rateLimiterStudy, rlSnapshot } from './caesura-rate-limiter.mjs'
import { failureDetectorStudy, fdSnapshot } from './caesura-failure-detector.mjs'
import { bplusStudy, bpSnapshot } from './caesura-bplus-tree.mjs'
import { mvccStudy, mvSnapshot } from './caesura-mvcc-txn.mjs'
import { distributedTxnStudy, dtSnapshot } from './caesura-distributed-txn.mjs'
import { raftConsensusStudy, rcSnapshot } from './caesura-raft-consensus.mjs'
import { distributedLockStudy, dlSnapshot } from './caesura-distributed-lock.mjs'
import { idGenStudy, igSnapshot } from './caesura-idgen.mjs'
import { distributedRateLimitStudy, drlSnapshot } from './caesura-distributed-ratelimit.mjs'
import { configConsistencyStudy, dccSnapshot } from './caesura-config-consistency.mjs'
import { cacheCoherencyStudy, cccSnapshot } from './caesura-cache-coherency.mjs'
import { messageDeliveryStudy, mmdSnapshot } from './caesura-message-delivery.mjs'
import { delayQueueStudy, delayQueueSnapshot } from './caesura-delay-queue.mjs'
import { retryDlqStudy, retryDlqSnapshot } from './caesura-retry-dlq.mjs'
import { consumerGroupStudy, consumerGroupSnapshot } from './caesura-consumer-group.mjs'
import { backpressureStudy, backpressureSnapshot } from './caesura-backpressure.mjs'
import { logCompactionStudy, logCompactionSnapshot } from './caesura-log-compaction.mjs'
import { bloomFilterStudy, bloomFilterSnapshot } from './caesura-bloom-filter.mjs'
import { cacheReplacementStudy, cacheReplacementSnapshot } from './caesura-cache-replacement.mjs'
import { streamWindowStudy, streamWindowSnapshot } from './caesura-stream-window.mjs'
import {
  createAimdCongestion,
  createCubicCongestion,
  createRtoEstimator,
  createSlidingWindow,
  createSessionTickets,
  createHttpCache,
} from './caesura-net-stack.mjs'

/**
 * KI-494：计网算法可观测包（opt-in，opts.net===true 才建）。用真 proxyCall 的时延与成败喂
 * RTO 估计/AIMD+CUBIC 窗口/滑动窗口，HTTP 缓存与 0-RTT 票据随包暴露供运行时与前端读快照。
 * 阈值全在 cfg（判定权 Node 侧），本件只编排、不写死任何协议参数。
 */
function createNetBundle(cfg = {}) {
  const aimd = createAimdCongestion(cfg.aimd)
  const cubic = createCubicCongestion(cfg.cubic)
  const rto = createRtoEstimator(cfg.rto)
  const window = createSlidingWindow(cfg.window)
  const tickets = createSessionTickets(cfg.tickets)
  const http = createHttpCache(cfg.http)
  const now = typeof cfg.now === 'function' ? cfg.now : () => Date.now()
  let observes = 0

  /** 拿一次真实调用的结果喂算法：成功 ACK + RTO 样本，失败按超时/重传统计。 */
  function observeOutcome(sig = {}) {
    observes++
    const ok = sig.ok !== false
    const rttMs = Number(sig.rttMs ?? 0)
    const sent = window.send({ seq: observes, ok, rttMs })
    const seq = sent.seq
    if (ok) {
      aimd.onAck()
      cubic.onAck()
      rto.sample(rttMs, !!sig.retransmitted)
      window.ack(seq) // 累计确认本段，释放在途位
      http.put('/api/net-observe', { ok, rttMs }, `e${seq}`, 60, 30)
    } else if (sig.retransmitted) {
      aimd.onDupAck()
      window.ack(seq) // 重传成功也算确认
    } else {
      aimd.onTimeout()
      rto.onTimeout()
      // 丢包不 ACK：该段留在在途位，模拟发送端等重传（连续丢包会把窗口填满，正反映滑窗背压）。
    }
    return { seq, ok, cwnd: aimd.cwnd, rto: rto.rto, inFlight: window.inFlight }
  }

  function snapshot() {
    return {
      observes,
      aimd: aimd.state(), cubic: cubic.state(), rto: rto.current(),
      window: window.state(), tickets: tickets.stats(), http: http.stats(),
    }
  }

  return { aimd, cubic, rto, window, tickets, http, observeOutcome, snapshot }
}

/**
 * 创建一只游戏侧开箱即用云。
 * @param {object} [opts] 透传给 createCloudRuntime 的全部选项，并可附 gameName/gameAddress/breakerOpts；
 *   以及 P7 扩展：eventsChannel/eventsTransport/eventBinder（事件总线）、requiredScopes（鉴权守卫）。
 */
export function createGameCloud(opts = {}) {
  const gameId = opts.gameId ?? 'caesura-game'
  const gameName = opts.gameName ?? gameId

  const runtime = createCloudRuntime({
    gameId,
    gameName,
    gameAddress: opts.gameAddress,
    gamePort: opts.gamePort,
    gameHealth: opts.gameHealth,
    sources: opts.sources,
    gateway: opts.gateway ?? true,
    tracer: opts.tracer ?? true,
    breakerOpts: opts.breakerOpts,
    transport: opts.transport,
    cloud: opts.cloud,
    bus: opts.bus,
    // KI-491：灰度/金丝雀加权路由（true 用缺省 0% / 对象逐项注入阈值/亲和键/selector）与 LB 策略透传。
    gray: opts.gray,
    lbStrategy: opts.lbStrategy,
  })

  const proxy = createServiceProxy(runtime, { breaker: opts.breakerOpts })

  // P7 扩展：游戏事件总线（Spring Cloud Stream 收口）与鉴权守卫（Spring Cloud Security 收口）。
  const events = createGameEventBus({
    channel: opts.eventsChannel,
    transport: opts.eventsTransport,
    binder: opts.eventBinder,
  })
  // KI-493：鉴权缓存可选装配。opts.authCache=true 用默认预算建一只；也可直接塞一只现成 cache（窑口注入）。
  const authCache = opts.authCache === true
    ? createRedisCache({ maxEntries: opts.authCacheMaxEntries, maxBytes: opts.authCacheMaxBytes, ttlMs: opts.authCacheTtlMs })
    : (opts.authCache ?? null)
  const auth = createAuthGuard({
    requiredScopes: opts.requiredScopes,
    cache: authCache,
    cacheTtlMs: opts.authCacheTtlMs,
    negativeTtlMs: opts.authNegativeTtlMs,
  })

  // KI-494：计网算法可观测包（opt-in）。opts.net===true 用缺省阈值建一只；传对象逐项注入阈值。
  const net = opts.net === true
    ? createNetBundle({ now: opts.netNow })
    : (opts.net && typeof opts.net === 'object' ? createNetBundle({ ...opts.net, now: opts.netNow ?? opts.net.now }) : null)
  const netClock = opts.netNow ?? (() => Date.now())

  // KI-496：LSM 风格存储引擎（opt-in）。opts.store===true 用缺省阈值建一只；传对象逐项注入
  // （memtableMax/levelMultiplier/compare/rand/...）；也可直接塞一只现成 store（窑口注入）。
  // 与真存储引擎无桥接、不改任何调用路径——只把结构读数挂到 status 供 E2E/前端控制台取。
  const store = opts.store === true
    ? createLsmStore({ now: opts.storeNow })
    : (opts.store && typeof opts.store === 'object' && typeof opts.store.put === 'function'
      ? opts.store
      : (opts.store && typeof opts.store === 'object' ? createLsmStore({ ...opts.store, now: opts.storeNow ?? opts.store.now }) : null))

  // KI-497：OS/硬件适配对照包（opt-in）。opts.hw===true 用缺省规模建；传对象逐项注入规模/阈值。
  // 三件都是确定性离线对照（对象池分配次数 / cache line 假共享 / AoS→SoA LRU miss），不改任何
  // 调用路径、不实测墙钟时间；snapshot() 现跑一遍给 status.hw / E2E / 前端控制台取结构读数。
  const hwCfg = opts.hw === true ? {} : (opts.hw && typeof opts.hw === 'object' ? opts.hw : null)
  // 三件都是确定性离线对照，跑一次即定；惰性缓存快照，避免 status() 被轮询时反复跑 benchmark
  // （这正是本件自己讲的「别在热路径反复付成本」）。要重算可由调用方重建 cloud 或注入新 hwNow。
  let hwCached = null
  const hw = hwCfg === null ? null : {
    snapshot() {
      if (hwCached) return hwCached
      const pool = allocationStudy({ accesses: hwCfg.poolAccesses ?? 10000, maxSize: hwCfg.poolMaxSize ?? 64,
        factory: hwCfg.factory ?? (() => ({ x: 0, y: 0, z: 0 })), reset: hwCfg.reset ?? ((o) => { o.x = o.y = o.z = 0 }) })
      const counters = hwCfg.counterCount ?? 8
      const padded = createCacheLinePadder(counters, hwCfg).stats()
      const packed = createPackedCounters(counters, hwCfg).stats()
      const seq = compareLayouts({ ...hwCfg, stride: 1 })
      const jump = compareLayouts({ ...hwCfg, stride: hwCfg.jumpStride ?? 16 })
      hwCached = {
        allocation: { accesses: pool.accesses, naiveCreated: pool.naiveCreated, poolCreated: pool.poolCreated, saved: pool.saved, reuseRate: pool.reuseRate },
        cacheLine: { paddedFalseSharing: padded.falseSharingPairs, packedFalseSharing: packed.falseSharingPairs, paddingOverhead: padded.spanBytes / packed.spanBytes },
        layout: {
          sequential: { aosMisses: seq.aos.misses, soaMisses: seq.soa.misses, speedup: seq.speedup },
          strided: { stride: jump.stride, aosMisses: jump.aos.misses, soaMisses: jump.soa.misses, speedup: jump.speedup },
        },
        builtAt: (opts.hwNow ?? (() => Date.now()))(),
      }
      return hwCached
    },
  }

  // KI-499：一致性哈希环 + 缓存分片（opt-in）。opts.hashRing===true 用缺省节点集建一只；传对象
  // 逐项注入（nodes/virtualNodes/hashFn/weightOf/salt）；也可直接塞一只现成 ring（窑口注入）。
  // 默认 hashRing:false 不装配、不改任何调用路径（LB 三策略与灰度路由语义逐字不动）——只把环快照与
  // 「扩容最小重映射 vs 取模」结构计数挂到 status.hashRing 供 E2E/前端控制台取。
  const hashCfg = opts.hashRing === true ? {} : (opts.hashRing && typeof opts.hashRing === 'object' ? opts.hashRing : null)
  const hashRing = hashCfg === null
    ? null
    : (typeof opts.hashRing === 'object' && typeof opts.hashRing.lookup === 'function'
      ? opts.hashRing
      : createHashRing({ ...hashCfg }))
  // 快照惰性缓存：compareRemapping 会跑 remappingKeys×(before+after lookup)，status 轮询不该反复付成本。
  let hashCached = null
  function hashSnapshot() {
    if (!hashRing) return null
    if (hashCached) return hashCached
    const nodes = hashRing.nodeIds()
    const remapKeys = hashCfg?.remappingKeys ?? 2048
    const keys = Array.from({ length: remapKeys }, (_, i) => `key:${i}`)
    const grow = compareRemapping({
      nodes, addNodes: hashCfg?.probeAddNodes ?? ['node:probe'], keys,
      hashFn: hashRing.hashFn, salt: hashRing.salt, virtualNodes: hashRing.virtualNodes,
    })
    const dist = hashRing.distribution(keys)
    hashCached = {
      ring: hashRing.snapshot({ ring: false }),
      grow: { consistentRate: grow.consistent.rate, moduloRate: grow.modulo.rate, theoreticalRate: grow.theoreticalRate, savedRate: grow.savedRate, delta: grow.delta },
      distribution: { balanceRatio: dist.balanceRatio, emptyNodes: dist.emptyNodes, perNode: dist.perNode },
      builtAt: (opts.hashNow ?? (() => Date.now()))(),
    }
    return hashCached
  }

  // KI-500：分片缓存客户端（opt-in）。opts.shardedCache===true 用缺省三片建；传对象逐项注入
  // （shards/ring/cacheFactory/cacheOpts/virtualNodes/hashFn/salt/retentionKeys/...），或直接塞一只现成实例。
  // 组合 KI-493 进程内缓存 + KI-499 一致性哈希环，证明扩缩容时命中率保留率的一致性哈希 vs 取模对照。
  // 默认 shardedCache:false 不装配、不改任何调用路径（KI-493 缓存 / KI-491 灰度路由语义逐字不动）。
  const shardedCfg = opts.shardedCache === true ? {} : (opts.shardedCache && typeof opts.shardedCache === 'object' ? opts.shardedCache : null)
  const shardedCache = shardedCfg === null
    ? null
    : (typeof opts.shardedCache === 'object' && typeof opts.shardedCache.shardOf === 'function'
      ? opts.shardedCache
      : createShardedCache({ ...shardedCfg }))
  let shardedCached = null
  function shardedSnapshot() {
    if (!shardedCache) return null
    if (shardedCached) return shardedCached
    const shards = shardedCache.shards
    const keys = Array.from({ length: shardedCfg?.retentionKeys ?? 2048 }, (_, i) => `key:${i}`)
    const next = shardedCfg?.retentionNextShards ?? [...shards, 'shard:probe']
    const retention = compareHitRetention({ shards, nextShards: next, keys,
      virtualNodes: shardedCfg?.virtualNodes, hashFn: shardedCfg?.hashFn, salt: shardedCfg?.salt })
    shardedCached = {
      cache: shardedCache.snapshot({ ring: false }),
      retention: {
        delta: retention.consistent.delta,
        consistentRetention: retention.consistent.retentionRate,
        moduloRetention: retention.modulo.retentionRate,
        theoretical: retention.theoreticalConsistent,
        savedRate: retention.savedRate,
      },
      builtAt: (opts.cacheNow ?? (() => Date.now()))(),
    }
    return shardedCached
  }

  // KI-501：缓存防护三件套（opt-in）。opts.cacheGuard===true 用缺省规模建；传对象逐项注入
  // （concurrency/keys/ttlMs/beta/jitterRatio/buckets/rounds/queryKeys/...），或直接塞一只现成 study 实例
  // （duck-typed：带 stampede/penetration/avalanche 三块）。对照击穿/穿透/雪崩三件套的结构计数。
  // 默认 cacheGuard:false 不装配、不改任何调用路径（KI-493 缓存 / KI-500 分片 / KI-491 灰度路由语义逐字不动）。
  const guardCfg = opts.cacheGuard === true ? {} : (opts.cacheGuard && typeof opts.cacheGuard === 'object' ? opts.cacheGuard : null)
  const guardInjected = guardCfg !== null && opts.cacheGuard &&
    typeof opts.cacheGuard === 'object' && typeof opts.cacheGuard.stampede === 'object'
  let guardCached = null
  async function guardSnapshotForStatus() {
    if (guardCfg === null) return null
    if (guardCached) return guardCached
    // 注入现成 study 直接用（不重跑）；否则真跑一次汇总，惰性缓存不反复付对照成本。
    const study = guardInjected
      ? opts.cacheGuard
      : await cacheGuardStudy({ ...guardCfg, now: opts.guardNow ?? guardCfg.now })
    guardCached = guardSnapshot(study)
    return guardCached
  }

  // KI-502：网关限流算法族 + Redis 原子令牌桶（opt-in）。opts.rateLimit===true 用缺省规模建；
  // 传对象逐项注入（limit/windowMs/capacity/refillPerSec/leakPerSec/arrivals/concurrency/
  // redisCapacity/redisRefillPerSec/backend/yield/...），或直接塞一只现成 study
  // （duck-typed：带 algorithms/redis 两块）。对照五算法边界突发 + Redis 原子 vs 非原子超发。
  // 默认 rateLimit:false 不装配、不改任何调用路径（KI-486 handler / KI-493 缓存 / KI-491 灰度语义逐字不动）。
  const rlCfg = opts.rateLimit === true ? {} : (opts.rateLimit && typeof opts.rateLimit === 'object' ? opts.rateLimit : null)
  const rlInjected = rlCfg !== null && opts.rateLimit &&
    typeof opts.rateLimit === 'object' && typeof opts.rateLimit.algorithms === 'object'
  let rlCached = null
  async function rlSnapshotForStatus() {
    if (rlCfg === null) return null
    if (rlCached) return rlCached
    // 注入现成 study 直接用（不重跑）；否则真跑一次汇总，惰性缓存不反复付对照成本。
    const study = rlInjected
      ? opts.rateLimit
      : await rateLimiterStudy({ ...rlCfg, now: opts.rlNow ?? rlCfg.now })
    rlCached = rlSnapshot(study)
    return rlCached
  }

  // KI-503：服务故障检测器（opt-in）。opts.failureDetector===true 用缺省规模建；传对象逐项注入
  // （threshold/fixedTimeoutMs/windowSize/spikeCount/probeIntervalMs/suspicionMult/healthTtlMs/...），
  // 或直接塞一只现成 study（duck-typed：带 comparison/swim/health 三块）。φ 累积风险 + SWIM 成员协议 +
  // 健康视图缓存的结构计数对照。默认 failureDetector:false 不装配、不改任何调用路径（KI-486/493/501/502 语义逐字不动）。
  const fdCfg = opts.failureDetector === true ? {} : (opts.failureDetector && typeof opts.failureDetector === 'object' ? opts.failureDetector : null)
  const fdInjected = fdCfg !== null && opts.failureDetector &&
    typeof opts.failureDetector === 'object' && typeof opts.failureDetector.comparison === 'object'
  let fdCached = null
  async function fdSnapshotForStatus() {
    if (fdCfg === null) return null
    if (fdCached) return fdCached
    // 注入现成 study 直接用（不重跑）；否则真跑一次汇总，惰性缓存不反复付对照成本。
    const study = fdInjected
      ? opts.failureDetector
      : await failureDetectorStudy({ ...fdCfg, now: opts.fdNow ?? fdCfg.now })
    fdCached = fdSnapshot(study)
    return fdCached
  }

  // KI-504：B+ 树索引引擎 + 与 LSM 三笔账诚实对照（opt-in）。opts.bplusIndex===true 用缺省规模建；
  // 传对象逐项注入（keyCount/order/leafCapacity/overwriteEvery/lsmMemtableMax/heightLadder/...），
  // 或直接塞一只现成 study（duck-typed：带 comparison/heightLadder/verdict 三块）。B+ 点查比较数 /
  // 范围叶链顺序扫 / 写放大 vs LSM 顺序追加+compaction 的结构计数对照。默认 bplusIndex:false 不装配、
  // 不改任何调用路径（KI-486/493/496/501/502/503 语义逐字不动）。
  const bpCfg = opts.bplusIndex === true ? {} : (opts.bplusIndex && typeof opts.bplusIndex === 'object' ? opts.bplusIndex : null)
  const bpInjected = bpCfg !== null && opts.bplusIndex &&
    typeof opts.bplusIndex === 'object' && typeof opts.bplusIndex.comparison === 'object'
  let bpCached = null
  async function bpSnapshotForStatus() {
    if (bpCfg === null) return null
    if (bpCached) return bpCached
    // 注入现成 study 直接用（不重跑）；否则真跑一次汇总，惰性缓存不反复付对照成本。
    const study = bpInjected
      ? opts.bplusIndex
      : await bplusStudy({ ...bpCfg, now: opts.bpNow ?? bpCfg.now })
    bpCached = bpSnapshot(study)
    return bpCached
  }

  // KI-505：事务与并发控制（MVCC 多版本可见性 + 五档隔离异常矩阵 + 行锁 2PL 死锁检测，opt-in）。
  // opts.mvccTxn===true 用缺省规模；传对象逐项注入（now/schedules/victim/gcVersions/gcLongWaterMark/
  // gcCleanWaterMark/...），或直接塞一只现成 study（duck-typed：带 comparison/deadlock/gc/verdict 四块）。
  // 默认 mvccTxn:false 不装配、不改任何调用路径（KI-486/493/496/501/502/503/504 语义逐字不动）。
  const mvCfg = opts.mvccTxn === true ? {} : (opts.mvccTxn && typeof opts.mvccTxn === 'object' ? opts.mvccTxn : null)
  const mvInjected = mvCfg !== null && opts.mvccTxn &&
    typeof opts.mvccTxn === 'object' && typeof opts.mvccTxn.comparison === 'object' &&
    typeof opts.mvccTxn.deadlock === 'object' && typeof opts.mvccTxn.gc === 'object'
  let mvCached = null
  async function mvSnapshotForStatus() {
    if (mvCfg === null) return null
    if (mvCached) return mvCached
    // 注入现成 study 直接用（不重跑）；否则真跑一次汇总，惰性缓存不反复付对照成本。
    const study = mvInjected
      ? opts.mvccTxn
      : await mvccStudy({ ...mvCfg, now: opts.txnNow ?? mvCfg.now })
    mvCached = mvSnapshot(study)
    return mvCached
  }

  // KI-506：分布式事务三协议诚实权衡（2PC 阻塞 / Saga 补偿留脏 / TCC 幂等重试，opt-in）。
  // opts.distributedTxn===true 用缺省规模；传对象逐项注入（now/participants/sagaSteps/tccSteps/
  // failIndex/compensateFailIndex/confirmFlakyIndex/confirmFailTimes/maxRetries/...），或直接塞一只
  // 现成 study（duck-typed：带 comparison/idempotency/sagaOrder/tccRetry/verdict 五块）。
  // 默认 distributedTxn:false 不装配、不改任何调用路径（KI-486/493/496/501/502/503/504/505 语义逐字不动）。
  const dtCfg = opts.distributedTxn === true ? {} : (opts.distributedTxn && typeof opts.distributedTxn === 'object' ? opts.distributedTxn : null)
  const dtInjected = dtCfg !== null && opts.distributedTxn &&
    typeof opts.distributedTxn === 'object' && typeof opts.distributedTxn.comparison === 'object' &&
    typeof opts.distributedTxn.idempotency === 'object' && typeof opts.distributedTxn.tccRetry === 'object'
  let dtCached = null
  async function dtSnapshotForStatus() {
    if (dtCfg === null) return null
    if (dtCached) return dtCached
    // 注入现成 study 直接用（不重跑）；否则真跑一次汇总，惰性缓存不反复付对照成本。
    const study = dtInjected
      ? opts.distributedTxn
      : await distributedTxnStudy({ ...dtCfg, now: opts.dtxnNow ?? dtCfg.now })
    dtCached = dtSnapshot(study)
    return dtCached
  }

  // KI-507：Raft 共识与复制状态机三协议诚实权衡（Raft 单 leader / 多主复制 / Gossip 反熵，opt-in）。
  // opts.raftConsensus===true 用缺省规模；传对象逐项注入（now/nodes/seed/rand/antiEntropyRounds/
  // replicationRounds/skipRounds/...），或直接塞一只现成 study（duck-typed：带 comparison/election/
  // replication/safety/gossip/verdict 六块）。默认 raftConsensus:false 不装配、不改任何调用路径
  // （KI-486/493/496/501/502/503/504/505/506 语义逐字不动）。
  const rcCfg = opts.raftConsensus === true ? {} : (opts.raftConsensus && typeof opts.raftConsensus === 'object' ? opts.raftConsensus : null)
  const rcInjected = rcCfg !== null && opts.raftConsensus &&
    typeof opts.raftConsensus === 'object' && typeof opts.raftConsensus.comparison === 'object' &&
    typeof opts.raftConsensus.election === 'object' && typeof opts.raftConsensus.gossip === 'object'
  let rcCached = null
  async function rcSnapshotForStatus() {
    if (rcCfg === null) return null
    if (rcCached) return rcCached
    // 注入现成 study 直接用（不重跑，builtAt 原样带出）；否则真跑一次汇总，惰性缓存不反复付对照成本。
    const study = rcInjected
      ? opts.raftConsensus
      : await raftConsensusStudy({ ...rcCfg, now: opts.raftNow ?? rcCfg.now })
    rcCached = rcSnapshot(study)
    return rcCached
  }

  // KI-508：分布式锁与租约三协议诚实权衡（单 Redis SETNX+TTL / Redlock 多数派 / etcd Lease+Fencing，opt-in）。
  // opts.distributedLock===true 用缺省规模；传对象逐项注入（now/instances/nodes/seed/rand/ttlMs/...），
  // 或直接塞一只现成 study（duck-typed：带 comparison/setnx/redlock/fencing/verdict 五块）。默认
  // distributedLock:false 不装配、不改任何调用路径（KI-486/493/496/501/502/503/504/505/506/507 语义逐字不动）。
  const dlCfg = opts.distributedLock === true ? {} : (opts.distributedLock && typeof opts.distributedLock === 'object' ? opts.distributedLock : null)
  const dlInjected = dlCfg !== null && opts.distributedLock &&
    typeof opts.distributedLock === 'object' && typeof opts.distributedLock.comparison === 'object' &&
    typeof opts.distributedLock.setnx === 'object' && typeof opts.distributedLock.fencing === 'object'
  let dlCached = null
  async function dlSnapshotForStatus() {
    if (dlCfg === null) return null
    if (dlCached) return dlCached
    // 注入现成 study 直接用（不重跑，builtAt 原样带出）；否则真跑一次汇总，惰性缓存不反复付对照成本。
    const study = dlInjected
      ? opts.distributedLock
      : await distributedLockStudy({ ...dlCfg, now: opts.dlockNow ?? dlCfg.now })
    dlCached = dlSnapshot(study)
    return dlCached
  }

  // KI-509：分布式 ID 生成三协议诚实权衡（UUIDv4 / Snowflake / Redis 号段，opt-in）。
  // opts.idGen===true 用缺省规模；传对象逐项注入（now/rand/seed/keyCount/segmentSize/treeOrder/...），
  // 或直接塞一只现成 study（duck-typed：带 comparison/uuid/snowflake/segment 四块）。默认
  // idGen:false 不装配、不改任何调用路径（KI-486/493/496/501/502/503/504/505/506/507/508 语义逐字不动）。
  const igCfg = opts.idGen === true ? {} : (opts.idGen && typeof opts.idGen === 'object' ? opts.idGen : null)
  const igInjected = igCfg !== null && opts.idGen &&
    typeof opts.idGen === 'object' && typeof opts.idGen.comparison === 'object' &&
    typeof opts.idGen.uuid === 'object' && typeof opts.idGen.snowflake === 'object' &&
    typeof opts.idGen.segment === 'object'
  let igCached = null
  async function igSnapshotForStatus() {
    if (igCfg === null) return null
    if (igCached) return igCached
    // 注入现成 study 直接用（不重跑，builtAt 原样带出）；否则真跑一次汇总，惰性缓存不反复付真树对照成本。
    const study = igInjected
      ? opts.idGen
      : await idGenStudy({ ...igCfg, now: opts.idGenNow ?? igCfg.now })
    igCached = igSnapshot(study)
    return igCached
  }

  // KI-510：分布式限流的分布式化三协议诚实权衡（本地桶 / Redis 中心桶 / 一致性哈希分片桶，opt-in）。
  // opts.distributedRateLimit===true 用缺省规模；传对象逐项注入（now/seed/instances/shards/capacity/...），
  // 或直接塞一只现成 study（duck-typed：带 rows/vectors/verdict/crosscheck 四块）。默认
  // distributedRateLimit:false 不装配、不改任何调用路径（含 KI-509 在内前述语义逐字不动）。
  const drlCfg = opts.distributedRateLimit === true ? {} : (opts.distributedRateLimit && typeof opts.distributedRateLimit === 'object' ? opts.distributedRateLimit : null)
  const drlInjected = drlCfg !== null && opts.distributedRateLimit &&
    typeof opts.distributedRateLimit === 'object' && Array.isArray(opts.distributedRateLimit.rows) &&
    opts.distributedRateLimit.vectors && opts.distributedRateLimit.verdict && opts.distributedRateLimit.crosscheck
  let drlCached = null
  async function drlSnapshotForStatus() {
    if (drlCfg === null) return null
    if (drlCached) return drlCached
    // 注入现成 study 直接用（不重跑，builtAt 原样带出）；否则真跑一次汇总，惰性缓存不反复付真环/原子桶交叉印证成本。
    const study = drlInjected
      ? opts.distributedRateLimit
      : await distributedRateLimitStudy({ ...drlCfg, now: opts.drNow ?? drlCfg.now })
    drlCached = drlSnapshot(study)
    return drlCached
  }

  // KI-511：分布式配置一致性三协议诚实权衡（客户端轮询 / 长轮询 / watch 服务端推送，opt-in）。
  // opts.configConsistency===true 用缺省规模；传对象逐项注入（now/seed/clients/pollIntervalMs/burstChanges/...），
  // 或直接塞一只现成 study（duck-typed：带 rows/vectors/verdict/crosscheck 四块）。默认
  // configConsistency:false 不装配、不改任何调用路径（含 KI-510 在内前述语义逐字不动）。
  const dccCfg = opts.configConsistency === true ? {} : (opts.configConsistency && typeof opts.configConsistency === 'object' ? opts.configConsistency : null)
  const dccInjected = dccCfg !== null && opts.configConsistency &&
    typeof opts.configConsistency === 'object' && Array.isArray(opts.configConsistency.rows) &&
    opts.configConsistency.vectors && opts.configConsistency.verdict && opts.configConsistency.crosscheck
  let dccCached = null
  async function dccSnapshotForStatus() {
    if (dccCfg === null) return null
    if (dccCached) return dccCached
    // 注入现成 study 直接用（不重跑，builtAt 原样带出）；否则真跑一次汇总，惰性缓存不反复付真 watcher/bus/环交叉印证成本。
    const study = dccInjected
      ? opts.configConsistency
      : await configConsistencyStudy({ ...dccCfg, now: opts.dccNow ?? dccCfg.now })
    dccCached = dccSnapshot(study)
    return dccCached
  }

  // KI-512：分布式缓存读写一致性三协议诚实权衡（Cache-Aside / Write-Through / Write-Behind，opt-in）。
  // opts.cacheCoherency===true 用缺省规模；传对象逐项注入（now/seed/writes/manyKeys/backendRttMs/...
  // 或 walEnabled 单开关探针），或直接塞一只现成 study（duck-typed：带 rows/vectors/verdict/crosscheck/topology）。
  // 默认 cacheCoherency:false 不装配、不改任何调用路径（含 KI-511 在内前述语义逐字不动）。
  const cccCfg = opts.cacheCoherency === true ? {} : (opts.cacheCoherency && typeof opts.cacheCoherency === 'object' ? opts.cacheCoherency : null)
  const cccInjected = cccCfg !== null && opts.cacheCoherency &&
    typeof opts.cacheCoherency === 'object' && Array.isArray(opts.cacheCoherency.rows) &&
    opts.cacheCoherency.vectors && opts.cacheCoherency.verdict && opts.cacheCoherency.crosscheck
  let cccCached = null
  async function cccSnapshotForStatus() {
    if (cccCfg === null) return null
    if (cccCached) return cccCached
    // 注入现成 study 直接用（不重跑，builtAt 原样带出）；否则真跑一次汇总，惰性缓存不反复付七枚真件交叉印证成本。
    const study = cccInjected
      ? opts.cacheCoherency
      : await cacheCoherencyStudy({ ...cccCfg, now: opts.cccNow ?? cccCfg.now })
    cccCached = cccSnapshot(study)
    return cccCached
  }

  // KI-518 延迟消息队列调度三协议诚实权衡（时间轮 / 最小堆 / Redis ZSET；opt-in）。
  // opts.delayQueue===true 走钳制默认参数（可覆盖 now/seed/tickMs/wheelSlots/pollIntervalMs/tasks/...）；
  // opts.delayQueue 为对象且 rows/vectors/verdict/crosscheck 齐全时当已构形 study 直接注入；
  // 默认 delayQueue:false 非破坏（同 KI-513 法），显式开才接；不声称真 MQ/真 Redis/真 Lua/真跨机持久化。
  const dqCfg = opts.delayQueue === true ? {} : (opts.delayQueue && typeof opts.delayQueue === 'object' ? opts.delayQueue : null)
  const dqInjected = dqCfg !== null && opts.delayQueue &&
    typeof opts.delayQueue === 'object' && Array.isArray(opts.delayQueue.rows) &&
    opts.delayQueue.vectors && opts.delayQueue.verdict && opts.delayQueue.crosscheck
  let dqCached = null
  async function dqSnapshotForStatus() {
    if (dqCfg === null) return null
    if (dqCached) return dqCached
    const study = dqInjected
      ? opts.delayQueue
      : await delayQueueStudy({ ...dqCfg, now: opts.dqNow ?? dqCfg.now })
    dqCached = delayQueueSnapshot(study)
    return dqCached
  }

  // KI-520 消息重试退避与死信队列三协议诚实权衡（立刻重试 / 纯指数退避 / 指数退避+全抖动；opt-in）。
  // opts.retryDlq===true 走钳制默认参数（可覆盖 now/seed/messages/maxAttempts/baseTicks/... ）；
  // opts.retryDlq 为对象且 rows/vectors/verdict/crosscheck 齐全时当已构形 study 直接注入；
  // 默认 retryDlq:false 非破坏（同 KI-518 法），显式开才接；不声称真 MQ/真 Redis DLQ/真跨机持久化。
  const rdlCfg = opts.retryDlq === true ? {} : (opts.retryDlq && typeof opts.retryDlq === 'object' ? opts.retryDlq : null)
  const rdlInjected = rdlCfg !== null && opts.retryDlq &&
    typeof opts.retryDlq === 'object' && Array.isArray(opts.retryDlq.rows) &&
    opts.retryDlq.vectors && opts.retryDlq.verdict && opts.retryDlq.crosscheck
  let rdlCached = null
  async function rdlSnapshotForStatus() {
    if (rdlCfg === null) return null
    if (rdlCached) return rdlCached
    const study = rdlInjected
      ? opts.retryDlq
      : await retryDlqStudy({ ...rdlCfg, now: opts.rdlNow ?? rdlCfg.now })
    rdlCached = retryDlqSnapshot(study)
    return rdlCached
  }

  // KI-523 消费者组 rebalance / 分区所有权三协议诚实权衡（Range / RoundRobin / Sticky；opt-in）。
  // opts.consumerGroup===true 走钳制默认参数（可覆盖 now/seed/consumers/partitionsPerTopic/bigPartitions/... ）；
  // opts.consumerGroup 为对象且 rows/vectors/verdict/crosscheck 齐全时当已构形 study 直接注入；
  // 默认 consumerGroup:false 非破坏（同 KI-513/518/520 法），显式开才接；不声称真 Kafka broker/真协调者/真跨机迁移。
  const cgpCfg = opts.consumerGroup === true ? {} : (opts.consumerGroup && typeof opts.consumerGroup === 'object' ? opts.consumerGroup : null)
  const cgpInjected = cgpCfg !== null && opts.consumerGroup &&
    typeof opts.consumerGroup === 'object' && Array.isArray(opts.consumerGroup.rows) &&
    opts.consumerGroup.vectors && opts.consumerGroup.verdict && opts.consumerGroup.crosscheck
  let cgpCached = null
  async function cgpSnapshotForStatus() {
    if (cgpCfg === null) return null
    if (cgpCached) return cgpCached
    const study = cgpInjected
      ? opts.consumerGroup
      : await consumerGroupStudy({ ...cgpCfg, now: opts.cgpNow ?? cgpCfg.now })
    cgpCached = consumerGroupSnapshot(study)
    return cgpCached
  }

  // KI-525 消费者组积压背压 / 流量削峰四策略诚实权衡（Backpressure / Buffering / Shedding / Scaling；opt-in）。
  // opts.backpressure===true 走钳制默认参数（可覆盖 now/seed/steps/mu/acceptBudget/latencyBudget/bufferCap/memoryCap
  // /zeroLoss/boundedLatency/unlimitedBuffer/rigged 等）；传对象且 rows/vectors/verdict/crosscheck 齐全时当现成 study 注入；
  // 默认 backpressure:false 非破坏（同 KI-513/518/520/523 法），显式开才接；不声称真 broker / 真 HPA / 真压测吞吐。
  // 注意：bp* 缩写已被 KI-504 B+ 树（bplusIndex）占用，本件统一用 bpc*（backpressure）避免撞名。
  const bpcCfg = opts.backpressure === true ? {} : (opts.backpressure && typeof opts.backpressure === 'object' ? opts.backpressure : null)
  const bpcInjected = bpcCfg !== null && opts.backpressure &&
    typeof opts.backpressure === 'object' && Array.isArray(opts.backpressure.rows) &&
    opts.backpressure.vectors && opts.backpressure.verdict && opts.backpressure.crosscheck
  let bpcCached = null
  async function bpcSnapshotForStatus() {
    if (bpcCfg === null) return null
    if (bpcCached) return bpcCached
    const study = bpcInjected
      ? opts.backpressure
      : await backpressureStudy({ ...bpcCfg, now: opts.bpcNow ?? bpcCfg.now })
    bpcCached = backpressureSnapshot(study)
    return bpcCached
  }

  // KI-526 append-only 日志压缩 / 回放边界三策略诚实权衡（SizeTimeRetention / KeyCompaction / SnapshotPlusWal；opt-in）。
  // opts.logCompaction===true 走钳制默认参数（可覆盖 now/seed/ops/keySpace/retentionOps/deleteRetention/snapshotAt
  // /footprintBudget/replayBudget/unlimitedRetention/instantSnapshot/zeroReplayCost/rigged 等）；传对象且
  // rows/vectors/verdict/crosscheck 齐全时当现成 study 注入；默认 logCompaction:false 非破坏（同 KI-513/518/520/523/525 法），
  // 显式开才接；不声称真 Kafka log cleaner / 真 RocksDB compaction / 真快照分发 / 真墙钟恢复毫秒。
  // 注意命名：lc*（log compaction），避开 bp*（B+ 树）/bpc*（积压背压）/cgp*（消费者组）/rdq*/dld* 已占用前缀。
  const lcCfg = opts.logCompaction === true ? {} : (opts.logCompaction && typeof opts.logCompaction === 'object' ? opts.logCompaction : null)
  const lcInjected = lcCfg !== null && opts.logCompaction &&
    typeof opts.logCompaction === 'object' && Array.isArray(opts.logCompaction.rows) &&
    opts.logCompaction.vectors && opts.logCompaction.verdict && opts.logCompaction.crosscheck
  let lcCached = null
  async function lcSnapshotForStatus() {
    if (lcCfg === null) return null
    if (lcCached) return lcCached
    const study = lcInjected
      ? opts.logCompaction
      : await logCompactionStudy({ ...lcCfg, now: opts.lcNow ?? lcCfg.now })
    lcCached = logCompactionSnapshot(study)
    return lcCached
  }

  // KI-527 布隆/布谷鸟/计数布隆三过滤器诚实权衡（Bloom / CountingBloom / Cuckoo；opt-in、status/ bf* ）。
  // opts.bloomFilter===true 走钳制默认参数（可覆盖 now/seed/capacity/bitsPerKey/bits/counterWidth/tableCount/bucketSize/maxKicks/benchKeys/maxLoadFactor
  // /unlimitedRoom/eternalStasis/noDeletesNeeded/rigged 等）；传对象且 rows/vectors/verdict 齐全时当现成 study 注入；默认 bloomFilter:false 非破坏
  //（同 KI-513/518/520/523/525/526 法），显式开才接；不声称真 RocksDB Bloom / 真 RedisBloom / 真 Cuckoo 论文规格实现 / 真墙钟压测毫秒。
  // 注意命名：bf*（Bloom Filter），避开 bp*/bpc*/cgp*/lc* 等已占用前缀。
  const bfCfg = opts.bloomFilter === true ? {} : (opts.bloomFilter && typeof opts.bloomFilter === 'object' ? opts.bloomFilter : null)
  const bfInjected = bfCfg !== null && opts.bloomFilter &&
    typeof opts.bloomFilter === 'object' && Array.isArray(opts.bloomFilter.rows) &&
    opts.bloomFilter.vectors && opts.bloomFilter.verdict
  let bfCached = null
  async function bfSnapshotForStatus() {
    if (bfCfg === null) return null
    if (bfCached) return bfCached
    const study = bfInjected
      ? opts.bloomFilter
      : await bloomFilterStudy({ ...bfCfg, now: opts.bfNow ?? bfCfg.now })
    bfCached = bloomFilterSnapshot(study)
    return bfCached
  }

  // KI-528 LRU / 2Q / ARC 三替换策略诚实权衡（page-race LRU / segQ² / megiddo ARC；opt-in、status/ cr*）。
  // opts.cacheReplacement===true 走钳制默认参数（可覆盖 now/seed/capacity/accesses/perfectFuture/unlimitedRoom/scenarios/rigged 等）；
  // 传对象且 rows/vectors/verdict 齐全时当现成 study 注入；默认 cacheReplacement:false 非破坏（同 KI-513/518/520/523/525/526/527 法），
  // 显式开才接；不声称真 Megiddo-Modha ACL 字节码 / 真 Buffer Pool / 真 RocksDB db-buffer.cpp / 真 BloomFilter 基准分数 / 真墙钟延迟毫秒。
  // 注意命名：cr*（cache replacement），避开 bp*/bpc*/cgp*/lc*/bf* 等已占用前缀。
  const crCfg = opts.cacheReplacement === true ? {} : (opts.cacheReplacement && typeof opts.cacheReplacement === 'object' ? opts.cacheReplacement : null)
  const crInjected = crCfg !== null && opts.cacheReplacement &&
    typeof opts.cacheReplacement === 'object' && Array.isArray(opts.cacheReplacement.rows) &&
    opts.cacheReplacement.vectors && opts.cacheReplacement.verdict
  let crCached = null
  async function crSnapshotForStatus() {
    if (crCfg === null) return null
    if (crCached) return crCached
    const study = crInjected
      ? opts.cacheReplacement
      : await cacheReplacementStudy({ ...crCfg, now: opts.crNow ?? crCfg.now })
    crCached = cacheReplacementSnapshot(study)
    return crCached
  }

  // KI-529 流式窗口聚合与 Watermark 迟到处置三策略诚实权衡（Tumbling/Sliding/Session；opt-in、status/ sw*）。
  // opts.streamWindow===true 走钳制默认参数（可覆盖 now/seed/windowSize/slideStep/sessionGap/allowedLateness/events/frozenWatermark/infiniteLateness/freeState/rigged 等）；
  // 传对象且 rows/vectors/verdict 齐全时当现成 study 注入；默认 streamWindow:false 非破坏（同 KI-513/518/520/523/525/526/527/528 法），
  // 显式开才接；不声称真 Flink / Kafka Streams 事件时间语义 / 真 RocksDB 状态后端 / 真 checkpoint 容错 / 真并行 watermark 传播 / 真墙钟吞吐跑分。
  // 注意命名：sw*（stream window），避开 bp*/bpc*/cgp*/lc*/bf*/cr* 等已占用前缀。
  const swCfg = opts.streamWindow === true ? {} : (opts.streamWindow && typeof opts.streamWindow === 'object' ? opts.streamWindow : null)
  const swInjected = swCfg !== null && opts.streamWindow &&
    typeof opts.streamWindow === 'object' && Array.isArray(opts.streamWindow.rows) &&
    opts.streamWindow.vectors && opts.streamWindow.verdict
  let swCached = null
  async function swSnapshotForStatus() {
    if (swCfg === null) return null
    if (swCached) return swCached
    const study = swInjected
      ? opts.streamWindow
      : await streamWindowStudy({ ...swCfg, now: opts.swNow ?? swCfg.now })
    swCached = streamWindowSnapshot(study)
    return swCached
  }

  // KI-513：分布式消息投递语义三协议诚实权衡（At-Most-Once / At-Least-Once / Exactly-Once，opt-in）。
  // opts.messageDelivery===true 用缺省规模；传对象逐项注入（now/seed/messages/manyKeys/retryLimit/...
  // 或 noCrash/ackReliable/freeIdempotency 单开关探针），或直接塞一只现成 study（duck-typed：带 rows/vectors/verdict/crosscheck/topology）。
  // 默认 messageDelivery:false 不装配、不改任何调用路径（含 KI-512 在内前述语义逐字不动）。
  const mmdCfg = opts.messageDelivery === true ? {} : (opts.messageDelivery && typeof opts.messageDelivery === 'object' ? opts.messageDelivery : null)
  const mmdInjected = mmdCfg !== null && opts.messageDelivery &&
    typeof opts.messageDelivery === 'object' && Array.isArray(opts.messageDelivery.rows) &&
    opts.messageDelivery.vectors && opts.messageDelivery.verdict && opts.messageDelivery.crosscheck
  let mmdCached = null
  async function mmdSnapshotForStatus() {
    if (mmdCfg === null) return null
    if (mmdCached) return mmdCached
    // 注入现成 study 直接用（不重跑，builtAt 原样带出）；否则真跑一次汇总，惰性缓存不反复付七枚真件交叉印证成本。
    const study = mmdInjected
      ? opts.messageDelivery
      : await messageDeliveryStudy({ ...mmdCfg, now: opts.mmdNow ?? mmdCfg.now })
    mmdCached = mmdSnapshot(study)
    return mmdCached
  }

  /** 包住一次调用，用真实耗时/成败喂 net 包（未启用则原样返回，零开销）。 */
  async function observeCall(promise) {
    if (!net) return promise
    const t0 = netClock()
    let res
    try {
      res = await promise
    } catch (e) {
      net.observeOutcome({ ok: false, rttMs: netClock() - t0 })
      throw e
    }
    net.observeOutcome({ ok: !!res?.ok, rttMs: netClock() - t0, retransmitted: (res?.filterStats?.retries ?? 0) > 0 })
    return res
  }

  // KI-489 游戏真 EventBus ↔ 云事件总线桥：gameBridgeRoutes 给了才建；shutdown 自动退桥，避免悬挂订阅。
  let bridge = null
  function connectGameBus(gameBus, routes) {
    if (bridge) bridge.uninstall()
    bridge = createGameEventBridge({ gameBus, cloudBus: events, routes, onEvent: opts.onBridgeEvent })
    return bridge.install()
  }

  return {
    runtime,
    proxy,
    events,
    auth,
    /** KI-493：鉴权 introspection 缓存实例（未配 opts.authCache 时为 null）。 */
    authCache,
    /** KI-494：计网算法可观测包（未配 opts.net 时为 null）；可直接 observeOutcome/snapshot。 */
    net,
    /** KI-496：LSM 存储引擎实例（未配 opts.store 时为 null）；可直接 put/get/flush/compact/stats。 */
    store,
    /** KI-497：OS/硬件适配对照包（未配 opts.hw 时为 null）；snapshot() 现跑三件确定性对照。 */
    hw,
    /** KI-499：一致性哈希环实例（未配 opts.hashRing 时为 null）；可直接 addNode/removeNode/lookup/distribution。 */
    hashRing,
    /** KI-499：造一只缓存分片路由（同 key 恒落同分片/同槽）；无环时回 null，不改调用路径。 */
    shardRouter: hashRing ? () => createShardRouter({ ring: hashRing }) : null,
    /** KI-500：分片缓存客户端实例（未配 opts.shardedCache 时为 null）；shardOf/get/set/load/remapOn/stats。 */
    shardedCache,
    /** KI-501：缓存防护三件套汇总的现算入口（未配 opts.cacheGuard 时为 null）；调一次真跑击穿/穿透/雪崩对照。 */
    runCacheGuardStudy: guardCfg === null ? null : () => cacheGuardStudy({ ...guardCfg, now: opts.guardNow ?? guardCfg.now }),
    /** KI-502：限流算法族 + Redis 原子性汇总的现算入口（未配 opts.rateLimit 时为 null）；调一次真跑五算法突发对照 + Redis 原子/非原子。 */
    runRateLimiterStudy: rlCfg === null ? null : () => rateLimiterStudy({ ...rlCfg, now: opts.rlNow ?? rlCfg.now }),
    /** KI-503：服务故障检测器汇总的现算入口（未配 opts.failureDetector 时为 null）；调一次真跑固定超时 vs φ 对照 + SWIM 脚本 + 健康视图读数。 */
    runFailureDetectorStudy: fdCfg === null ? null : () => failureDetectorStudy({ ...fdCfg, now: opts.fdNow ?? fdCfg.now }),
    /** KI-504：B+ 树索引引擎 + LSM 三笔账汇总的现算入口（未配 opts.bplusIndex 时为 null）；调一次真跑点查比较数 / 范围叶链顺序扫 / 写放大对照。 */
    runBplusStudy: bpCfg === null ? null : () => bplusStudy({ ...bpCfg, now: opts.bpNow ?? bpCfg.now }),
    /** KI-505：事务并发控制汇总的现算入口（未配 opts.mvccTxn 时为 null）；调一次真跑五档隔离异常矩阵 + 死锁检测 + gc 水位对照。 */
    runMvccTxnStudy: mvCfg === null ? null : () => mvccStudy({ ...mvCfg, now: opts.txnNow ?? mvCfg.now }),
    /** KI-506：分布式事务三协议汇总的现算入口（未配 opts.distributedTxn 时为 null）；调一次真跑 2PC/Saga/TCC × 六场景矩阵 + 三难判词。 */
    runDistributedTxnStudy: dtCfg === null ? null : () => distributedTxnStudy({ ...dtCfg, now: opts.dtxnNow ?? dtCfg.now }),
    /** KI-507：Raft 共识三协议汇总的现算入口（未配 opts.raftConsensus 时为 null）；调一次真跑 Raft/MultiMaster/Gossip × 六场景矩阵 + 三难判词。 */
    runRaftConsensusStudy: rcCfg === null ? null : () => raftConsensusStudy({ ...rcCfg, now: opts.raftNow ?? rcCfg.now }),
    /** KI-508：分布式锁三协议汇总的现算入口（未配 opts.distributedLock 时为 null）；调一次真跑 SETNX/Redlock/etcd × 六场景矩阵 + 三难判词。 */
    runDistributedLockStudy: dlCfg === null ? null : () => distributedLockStudy({ ...dlCfg, now: opts.dlockNow ?? dlCfg.now }),
    /** KI-509：分布式 ID 三协议汇总的现算入口（未配 opts.idGen 时为 null）；调一次真跑 UUID/Snowflake/号段 × 六场景矩阵 + 三难判词 + KI-504 真树交叉印证。 */
    runIdGenStudy: igCfg === null ? null : () => idGenStudy({ ...igCfg, now: opts.idGenNow ?? igCfg.now }),
    /** KI-510：分布式限流三协议汇总的现算入口（未配 opts.distributedRateLimit 时为 null）；调一次真跑 本地桶/中心桶/分片桶 × 六场景矩阵 + 三难判词 + 真 Redis 原子桶/真一致性哈希环交叉印证。 */
    runDistributedRateLimitStudy: drlCfg === null ? null : () => distributedRateLimitStudy({ ...drlCfg, now: opts.drNow ?? drlCfg.now }),
    /** KI-511：分布式配置一致性三协议汇总的现算入口（未配 opts.configConsistency 时为 null）；调一次真跑 轮询/长轮询/watch 推送 × 六场景矩阵 + 三难判词 + 真 Config响应/watcher/bus/hashSelector/XFetch/RedisTTL/环 交叉印证。 */
    runConfigConsistencyStudy: dccCfg === null ? null : () => configConsistencyStudy({ ...dccCfg, now: opts.dccNow ?? dccCfg.now }),
    /** KI-512：分布式缓存读写一致性三协议汇总的现算入口（未配 opts.cacheCoherency 时为 null）；调一次真跑 Cache-Aside/Write-Through/Write-Behind × 六场景矩阵 + 三难判词 + 真 Redis写后读/WAL崩溃恢复/MVCC/2PC/环 交叉印证。 */
    runCacheCoherencyStudy: cccCfg === null ? null : () => cacheCoherencyStudy({ ...cccCfg, now: opts.cccNow ?? cccCfg.now }),
    /** KI-513：分布式消息投递语义三协议汇总的现算入口（未配 opts.messageDelivery 时为 null）；调一次真跑 At-Most-Once/At-Least-Once/Exactly-Once × 六场景矩阵 + 三难判词 + 真 Bus/GameEventBus/Bridge/2PC/WAL/Redis/环 交叉印证。 */
    runMessageDeliveryStudy: mmdCfg === null ? null : () => messageDeliveryStudy({ ...mmdCfg, now: opts.mmdNow ?? mmdCfg.now }),
    /** KI-518 延迟消息队列三协议诚实权衡研究件；缺 opts.delayQueue 时为 null；时间轮/最小堆/RedisZset × 六场景矩阵 + 三难向量 + 真件交叉印证（ring/Redis INCR/WAL/Bus/TokenBucket/B+树/对象池）。 */
    runDelayQueueStudy: dqCfg === null ? null : () => delayQueueStudy({ ...dqCfg, now: opts.dqNow ?? dqCfg.now }),
    /** KI-520 消息重试退避与死信队列三协议诚实权衡研究件；缺 opts.retryDlq 时为 null；立刻重试/纯指数退避/指数退避+全抖动 × 六场景矩阵 + 三难向量（rigged 101/101/101 不硬造全 111）+ 七枚真件交叉印证（最小堆/令牌桶/WAL/哈希环/幂等缓存/死信总线/对象池）。 */
    runRetryDlqStudy: rdlCfg === null ? null : () => retryDlqStudy({ ...rdlCfg, now: opts.rdlNow ?? rdlCfg.now }),
    /** KI-523 消费者组 rebalance / 分区所有权三协议诚实权衡研究件；缺 opts.consumerGroup 时为 null；Range/RoundRobin/Sticky × 六场景矩阵 + 三难向量（rigged 101/101/101 不硬造全 111）+ 九枚真件交叉印证（compareRemapping/shardRouter/hashRing/WAL/Bus/Redis/ObjectPool/TokenBucket/MinHeap）。 */
    runConsumerGroupStudy: cgpCfg === null ? null : () => consumerGroupStudy({ ...cgpCfg, now: opts.cgpNow ?? cgpCfg.now }),
    /** KI-525 积压背压 / 流量削峰四策略诚实权衡研究件；缺 opts.backpressure 时为 null；Backpressure/Buffering/Shedding/Scaling × 六场景矩阵 + 三难向量（rigged 110/110/110/110 因果锁死 highThroughput、不硬造全 111）+ Little's Law 双路自证 + 十一枚真件交叉印证。 */
    runBackpressureStudy: bpcCfg === null ? null : () => backpressureStudy({ ...bpcCfg, now: opts.bpcNow ?? bpcCfg.now }),
    /** KI-526 日志压缩 / 回放边界三策略诚实权衡研究件；缺 opts.logCompaction 时为 null；SizeTimeRetention/KeyCompaction/SnapshotPlusWal × 六场景矩阵 + 三难向量（rigged 110/110/110 因果锁死 fastRecovery、不硬造全 111）+ verifyReplayBoundary 双路守恒自证（篡改重放成本/抹 WAL 段/早清 tombstone 三路可证伪）+ 十一枚真件交叉印证。 */
    runLogCompactionStudy: lcCfg === null ? null : () => logCompactionStudy({ ...lcCfg, now: opts.lcNow ?? lcCfg.now }),
    /** KI-527 布隆/布谷鸟/计数布隆三过滤器诚实权衡研究件；缺 opts.bloomFilter 时为 null；Bloom/CountingBloom/Cuckoo × 六场景矩阵 + 三难向量（默认 110/011/101 互异不封赢家；rigged 011/011/011 由 unlimitedRoom 真算因果锁死 compactFootprint、绝不硬造全 111）+ verifyFalsePositiveCeiling 双路自证（理论 ε vs 实测 FP 率真读数 + 三路篡改真喂回现算翻 false）+ 十一枚真件 21 键交叉印证。 */
    runBloomFilterStudy: bfCfg === null ? null : () => bloomFilterStudy({ ...bfCfg, now: opts.bfNow ?? bfCfg.now }),
    /** KI-528 LRU/2Q/ARC 三替换策略诚实权衡研究件；缺 opts.cacheReplacement 时为 null；LRU/2Q/ARC × 六场景矩阵 + 三难向量（默认 010/110/101 互异不封赢家；rigged 两开关 unlimitedRoom+perfectFuture 真进构造 ⇒ 向量现算收敛 110/110/110、adaptiveBalanceCausallyUnerasable 因果锁死自适应维、绝不硬造全 111）+ verifyDualSweep 双路交叉印证（真 trace 两路独立重放 + 三路篡改真喂回现算翻 false）+ 十一真件 21 键交叉印证。 */
    runCacheReplacementStudy: crCfg === null ? null : () => cacheReplacementStudy({ ...crCfg, now: opts.crNow ?? crCfg.now }),
    /** KI-529 流式窗口聚合与 Watermark 迟到处置三策略诚实权衡研究件；缺 opts.streamWindow 时为 null；Tumbling/Sliding/Session × 六场景矩阵 + 三难向量（默认 011/110/101 互异不封赢家；rigged 三开关 frozenWatermark+infiniteLateness+freeState 真进构造 ⇒ 向量现算收敛 011/011/011、resultCompletenessCausallyUnerasable 因果锁死结果维、绝不硬造全 111）+ verifyWatermarkMonotonicity 双路自证（到达序 watermark 单调 + 承诺地平线 behindHorizon / 处置守恒 accepted+sideOutput==lateTotal，三路篡改真喂回现算翻 false）+ 十一枚真件 21 键交叉印证。 */
    runStreamWindowStudy: swCfg === null ? null : () => streamWindowStudy({ ...swCfg, now: opts.swNow ?? swCfg.now }),
    /** KI-491：灰度/金丝雀决策器（未配 opts.gray 时为 null）；可直接 decide/select/stats。 */
    gray: runtime.gray,
    /** 把游戏真 EventBus 按白名单routes 接进云事件总线（游戏侧一行：gc.connectGameBus(bus, routes)）。 */
    connectGameBus,
    bridge: () => bridge,
    /** 拉起：注册游戏实例、广播 lifecycle/runtime 事件、启用网关与追踪、发 game.started 事件。 */
    async start() {
      const r = await runtime.bootstrap()
      await events.publishGameEvent('game.started', { gameId, gameName })
      return r
    },
    /** 裸调用（负载均衡 + 网关匹配 + 追踪 + CB filter）；配 net 时用真实结果喂计网算法。 */
    async call(serviceName, path, init) { return observeCall(runtime.call(serviceName, path, init)) },
    /** 韧性调用（runtime.call + 按服务隔离的进程内熔断）；配 net 时用真实结果喂计网算法。 */
    async proxyCall(serviceName, path, init) { return observeCall(proxy.call(serviceName, path, init)) },
    /** 关停：退桥 + 注销游戏实例 + 广播 stopped + 发 game.stopped 事件。 */
    async shutdown() {
      const bridgeOff = bridge ? bridge.uninstall() : null
      const r = await runtime.shutdown()
      await events.publishGameEvent('game.stopped', { gameId, gameName })
      return { ...r, bridgeOff }
    },
    /** 汇总：游戏状态 + 已聚合服务 + 路由数 + 事件频道 + 鉴权作用域 + 缓存/计网/存储读数。 */
    async status() {
      const s = await runtime.status()
      return {
        ...s, eventChannel: events.channel, authScopes: auth.requiredScopes,
        authCache: auth.cacheStats(), net: net ? net.snapshot() : null,
        store: store ? store.snapshot() : null,
        hw: hw ? hw.snapshot() : null,
        hashRing: hashSnapshot(),
        shardedCache: shardedSnapshot(),
        cacheGuard: await guardSnapshotForStatus(),
        rateLimit: await rlSnapshotForStatus(),
        failureDetector: await fdSnapshotForStatus(),
        bplusIndex: await bpSnapshotForStatus(),
        mvccTxn: await mvSnapshotForStatus(),
        distributedTxn: await dtSnapshotForStatus(),
        raftConsensus: await rcSnapshotForStatus(),
        distributedLock: await dlSnapshotForStatus(),
        idGen: await igSnapshotForStatus(),
        distributedRateLimit: await drlSnapshotForStatus(),
        configConsistency: await dccSnapshotForStatus(),
        cacheCoherency: await cccSnapshotForStatus(),
        messageDelivery: await mmdSnapshotForStatus(),
        delayQueue: await dqSnapshotForStatus(),
        retryDlq: await rdlSnapshotForStatus(),
        consumerGroup: await cgpSnapshotForStatus(),
        backpressure: await bpcSnapshotForStatus(),
        logCompaction: await lcSnapshotForStatus(),
        bloomFilter: await bfSnapshotForStatus(),
        cacheReplacement: await crSnapshotForStatus(),
        streamWindow: await swSnapshotForStatus(),
      }
    },
  }
}
