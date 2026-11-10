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
      }
    },
  }
}
