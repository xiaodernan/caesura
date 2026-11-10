/**
 * scripts/spring-family-mesh-e2e.mjs —— 集大成家族端到端证据（headless 可证）。
 *
 * <p>把前几轮的积木真正串成一条可跑的链：用 `createGameCloud` 拉起「游戏云」，发现源同时挂
 * Eureka（内存）与 Spring Cloud Kubernetes 客户端（`spring-cloud-kubernetes-client`，演示 KI-479 真用在流程里）；
 * 加一条网关路由；随后：注册游戏实例 → 经「网关 predicate 匹配 → filter 链（Retry 等） → 负载均衡选实例 →
 * 起 span → 进程内熔断」的 proxyCall 调到 caesura-gate → 查 mesh 状态（应含 self/eureka/k8s 三来源）→ 关停注销。</p>
 *
 * <p><b>KI-488 主链扩展</b>：一趟 run 里同时证明三件新积木真在主链上跑——
 *   ① 事件总线（KI-484）：订阅 `game.started`/`game.stopped`，随结果回 `events`；
 *   ② 鉴权守卫（KI-485）：调用前用 `gc.auth` 校验一个带 scope 的 Bearer，缺域/过期则短路拒调；
 *   ③ filter 链（KI-486/487）：`opts.retryAttempts` 挂 Retry filter，注入 flaky transport 可在结果 `filterStats.retries` 读到真重试。</p>
 *
 * <p>默认用内存 transport 全 headless 跑通（CLI 直接 `node scripts/spring-family-mesh-e2e.mjs` 即得 JSON 证据）；
 * 注入 `transport`/`cloud`/`tracer`/`bearer` 可在测试里接管。判词仍由 Node 侧持有（决策原则①）。</p>
 */
import { createGameCloud } from './caesura-game-cloud.mjs'
import { createKubernetesClient } from './spring-cloud-kubernetes-client.mjs'
import { createTracer } from './spring-sleuth-tracer.mjs'
import { pathToFileURL } from 'node:url'

/** 造一枚仅用于 headless 证据的 Bearer（不验签；auth 守卫只解析 claims/过期/作用域）。 */
function demoBearer(sub = 'caesura-e2e', scope = 'game:call', ttlSec = 3600) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const header = enc({ alg: 'none', typ: 'JWT' })
  const payload = enc({ sub, scope, exp: Math.floor(Date.now() / 1000) + ttlSec })
  return `Bearer ${header}.${payload}.sig`
}

/**
 * 跑一趟集大成家族端到端。
 * @param {object} [opts]
 */
export function runMeshE2E(opts = {}) {
  const k8s = createKubernetesClient({
    namespace: 'game',
    endpoints: { 'caesura-gate': [{ ip: '10.1.0.1', port: 8099 }] },
  })

  let tracer = null
  if (opts.tracer !== false) {
    tracer = (opts.tracer && typeof opts.tracer === 'object') ? opts.tracer : createTracer({ serviceName: 'e2e' })
  }

  const transport = opts.transport ?? (async (t, p) => ({ url: t.url, serviceName: t.serviceName, path: p }))

  // KI-488③：retryAttempts 有值才给路由挂 Retry filter（默认不挂 ⇒ 老 5 条断言的 calls.length=1 不变）。
  const filters = []
  if (opts.retryAttempts) filters.push({ name: 'Retry', args: { attempts: opts.retryAttempts, backoffMs: opts.retryBackoffMs ?? 0 } })
  // KI-492：可注入任意额外 filter（如 Bulkhead/TimeLimiter），不配则老证据逐字不变。
  if (Array.isArray(opts.filters)) filters.push(...opts.filters)

  const gc = createGameCloud({
    gameId: opts.gameId ?? 'caesura-game',
    gamePort: opts.gamePort ?? 7700,
    cloud: opts.cloud,
    tracer,
    transport,
    // KI-491：灰度/金丝雀决策器透传（true 或缺省 0%；对象注入阈值/亲和键/selector）+ LB 策略。
    gray: opts.gray,
    lbStrategy: opts.lbStrategy,
    // KI-493：鉴权 introspection 缓存（authCache=true 用默认预算建一只），配 onlineAuth 可证只打一次端点。
    authCache: opts.authCache,
    authCacheTtlMs: opts.authCacheTtlMs,
    authNegativeTtlMs: opts.authNegativeTtlMs,
    // KI-494：计网算法可观测包（net=true 装配；proxyCall 用真实耗时/成败喂 AIMD/RTO/滑窗）。
    net: opts.net,
    netNow: opts.netNow,
    // KI-499：一致性哈希环 + 缓存分片（hashRing=true 装配；只读环快照 + 扩容最小重映射证据，不改调用路径）。
    hashRing: opts.hashRing,
    hashNow: opts.hashNow,
    // KI-500：分片缓存客户端（shardedCache=true 装配；只读命中率保留率对照证据，不改调用路径）。
    shardedCache: opts.shardedCache,
    cacheNow: opts.cacheNow,
    // KI-501：缓存防护三件套（cacheGuard=true 装配；只读击穿/穿透/雪崩对照读数，不改调用路径）。
    cacheGuard: opts.cacheGuard,
    guardNow: opts.guardNow,
    // KI-502：限流算法族 + Redis 原子令牌桶（rateLimit=true 装配；只读五算法突发对照 + 原子/非原子超发证据，不改调用路径）。
    rateLimit: opts.rateLimit,
    rlNow: opts.rlNow,
    // KI-503：服务故障检测器（failureDetector=true 装配；只读固定超时 vs φ 对照 + SWIM 三态 + 健康视图缓存证据，不改调用路径）。
    failureDetector: opts.failureDetector,
    fdNow: opts.fdNow,
    // KI-504：B+ 树索引引擎 + LSM 三笔账（bplusIndex=true 装配；只读点查比较数/范围叶链顺序扫/写放大对照证据，不改调用路径）。
    bplusIndex: opts.bplusIndex,
    bpNow: opts.bpNow,
    // KI-505：事务与并发控制（mvccTxn=true 装配；只读五档隔离异常矩阵/死锁环检测/gc 水位对照证据，不改调用路径）。
    mvccTxn: opts.mvccTxn,
    txnNow: opts.txnNow,
    sources: {
      eureka: () => (opts.svcA ?? [{ id: 'svc-a:1', name: 'svc-a', address: '10.0.0.1', port: 8080, healthy: true }]),
      k8s: () => k8s.discover('caesura-gate'),
      // KI-491：注入带 metadata（canary/weight/version）的实例，验灰度分池+会话亲和+空池回退。
      ...(opts.grayInstances ? { graySrc: () => opts.grayInstances } : {}),
    },
  })

  // 一条网关路由：/api/** 打到 caesura-gate（可带 Retry filter）。
  gc.runtime.routes.add({
    id: 'r-gate', uri: 'lb://caesura-gate', order: 0,
    predicates: [{ name: 'Path', args: { patterns: '/api/**' } }],
    filters,
  })

  // KI-489：注入 gameBus（duck-typed 真 EventBus 形状）时，把游戏事件按白名单桥进云事件总线。
  let bridge = null
  if (opts.gameBus) {
    const routes = opts.gameBridgeRoutes ?? [
      { from: 'game', key: 'boss.phase', type: 'game.boss.phase' },
      { from: 'cloud', type: 'remote.notice', key: 'ui.notify' },
    ]
    bridge = { routes, installed: gc.connectGameBus(opts.gameBus, routes) }
  }

  return {
    gc,
    k8s,
    tracer,
    async run() {
      // KI-488①：在 start 之前订阅游戏事件总线，一路收到 shutdown 之后。
      const gameEvents = []
      const offStarted = gc.events.onGameEvent('game.started', (p) => gameEvents.push({ type: 'game.started', payload: p }))
      const offStopped = gc.events.onGameEvent('game.stopped', (p) => gameEvents.push({ type: 'game.stopped', payload: p }))

      // KI-488② / KI-490：调用前经鉴权守卫校验 Bearer；缺域/过期/在线判拒则短路，不发起下游调用。
      //   opts.onlineAuth 给了就走 RFC 7662 在线校验（可注入 fetch/policy），否则纯本地快速路径。
      let auth = null
      if (opts.bearer !== null) {
        const bearer = opts.bearer ?? demoBearer()
        const requiredScope = opts.requiredScope ?? 'game:call'
        if (opts.onlineAuth) {
          const v = await gc.auth.authorizeOnline(bearer, { requiredScopes: [requiredScope], ...opts.onlineAuth })
          auth = {
            ok: v.ok, allowed: v.ok, source: v.source, degraded: !!v.degraded, reason: v.reason,
            sub: v.claims?.sub, scope: v.claims?.scope, requiredScope,
          }
        } else {
          try {
            const claims = gc.auth.authenticate(bearer)
            auth = { ok: true, source: 'local', sub: claims.sub, scope: claims.scope, allowed: gc.auth.canAccess(claims, requiredScope), requiredScope }
          } catch (e) {
            auth = { ok: false, source: 'local', reason: e.message, allowed: false, requiredScope }
          }
        }
      }

      // KI-493：缓存探针——同一在线令牌连打两次 authorizeOnline，证第二次 source='cache' 且端点只被调一次。
      //   opts.cacheProbe 给 { bearer?, requiredScope?, onlineAuth? }；缓存由 opts.authCache 装配。
      let cacheProbe = null
      if (opts.cacheProbe && gc.authCache) {
        const cp = opts.cacheProbe
        const bearer = cp.bearer ?? opts.bearer ?? demoBearer()
        const requiredScope = cp.requiredScope ?? opts.requiredScope ?? 'game:call'
        const callOpts = { requiredScopes: [requiredScope], ...(cp.onlineAuth ?? opts.onlineAuth ?? {}) }
        const v1 = await gc.auth.authorizeOnline(bearer, callOpts)
        const v2 = await gc.auth.authorizeOnline(bearer, callOpts)
        cacheProbe = {
          firstSource: v1.source, secondSource: v2.source, secondCacheHit: !!v2.cacheHit,
          firstOk: v1.ok, secondOk: v2.ok, stats: gc.auth.cacheStats(),
        }
      }

      const boot = await gc.start()

      // KI-489：桥装好后，若注入了 gameBus，模拟一次真游戏事件 emit，看它是否过桥到云总线。
      let crossed = null
      if (bridge?.installed?.installed && typeof opts.gameBus?.emit === 'function') {
        const offCross = gc.events.onGameEvent('game.boss.phase', (p) => { crossed = p })
        opts.gameBus.emit('boss.phase', { id: 'e2e-boss', phase: 2, phases: 3, nameKey: 'boss.x' })
        await Promise.resolve() // publishGameEvent 是异步 fire-and-forget
        offCross()
      }

      let callRes
      if (auth && !auth.allowed) {
        callRes = { ok: false, reason: 'forbidden', error: new Error(`auth: missing scope ${auth.requiredScope}`) }
      } else {
        callRes = await gc.proxyCall('caesura-gate', '/api/health')
      }

      // KI-491：灰度探针——一趟 run 发多次带不同亲和 key 的调用，证「同 key 稳定落同池」「阈值生效」
      // 「空金丝雀池诚实回退」。探针直接走 gc.call（不经 e2e 的 auth 短路），service/path/headers/canaryPercent
      // 均可逐次注入；结果回带每次的 lane/fallback/命中实例。
      const grayProbes = []
      if (Array.isArray(opts.grayProbes)) {
        for (const probe of opts.grayProbes) {
          const r = await gc.call(probe.service ?? 'gray-svc', probe.path ?? '/api/health', {
            method: probe.method,
            canaryPercent: probe.canaryPercent,
            headers: probe.headers,
          })
          grayProbes.push({
            key: r.gray?.key, lane: r.gray?.lane, fallback: !!r.gray?.fallback,
            canaryPercent: r.gray?.canaryPercent, ok: r.ok, reason: r.reason,
            instanceId: r.target?.instanceId,
          })
        }
      }
      const status = await gc.status()
      const shut = await gc.shutdown()
      offStarted()
      offStopped()
      const spans = tracer ? tracer.spans() : []
      const filterStats = gc.runtime.filters.stats()
      return {
        started: boot.started, callRes, status, stopped: shut.stopped, spans, services: status.services,
        events: gameEvents, auth, filterStats, grayProbes, grayStats: gc.gray?.stats() ?? null,
        cacheProbe, authCacheStats: gc.auth.cacheStats(),
        netSnapshot: gc.net ? gc.net.snapshot() : null,
        hashRingSnapshot: status.hashRing ?? null,
        shardedCacheSnapshot: status.shardedCache ?? null,
        cacheGuardSnapshot: status.cacheGuard ?? null,
        rateLimitSnapshot: status.rateLimit ?? null,
        failureDetectorSnapshot: status.failureDetector ?? null,
        bplusIndexSnapshot: status.bplusIndex ?? null,
        mvccTxnSnapshot: status.mvccTxn ?? null,
        gameBridge: bridge ? { installed: bridge.installed, stats: gc.bridge()?.stats(), crossed } : null,
        bridgeOff: shut.bridgeOff ?? null,
      }
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMeshE2E().run().then((r) => {
    console.log(JSON.stringify({
      registered: r.started?.registered,
      callOk: r.callRes?.ok,
      callData: r.callRes?.result,
      services: r.services,
      spanCount: r.spans.length,
      eventTypes: r.events.map((e) => e.type),
      authOK: r.auth?.ok,
      authAllowed: r.auth?.allowed,
      retryCount: r.filterStats.retries,
      grayLanes: r.grayProbes.map((p) => `${p.key}:${p.lane}${p.fallback ? '(fallback)' : ''}`),
      grayStats: r.grayStats,
      cacheProbe: r.cacheProbe,
      netSnapshot: r.netSnapshot ? { observes: r.netSnapshot.observes, cwnd: r.netSnapshot.aimd.cwnd, rto: r.netSnapshot.rto.rto } : null,
      hashRing: r.hashRingSnapshot ? { nodes: r.hashRingSnapshot.ring.nodes, virtualPoints: r.hashRingSnapshot.ring.virtualPoints, growConsistentRate: r.hashRingSnapshot.grow.consistentRate, growModuloRate: r.hashRingSnapshot.grow.moduloRate } : null,
      shardedCache: r.shardedCacheSnapshot ? { shards: r.shardedCacheSnapshot.cache.shards, consistentRetention: r.shardedCacheSnapshot.retention.consistentRetention, moduloRetention: r.shardedCacheSnapshot.retention.moduloRetention } : null,
      cacheGuard: r.cacheGuardSnapshot ? {
        stampede: { naiveLoads: r.cacheGuardSnapshot.stampede.naiveLoads, singleflightLoads: r.cacheGuardSnapshot.stampede.singleflightLoads, savedLoads: r.cacheGuardSnapshot.stampede.savedLoads, amplification: r.cacheGuardSnapshot.stampede.amplification },
        penetration: { naiveDbHits: r.cacheGuardSnapshot.penetration.naiveDbHits, negativeDbHits: r.cacheGuardSnapshot.penetration.negativeDbHits, bloomDbHits: r.cacheGuardSnapshot.penetration.bloomDbHits, bloomRejected: r.cacheGuardSnapshot.penetration.bloomRejected },
        avalanche: { uniformPeak: r.cacheGuardSnapshot.avalanche.uniformPeak, jitterPeak: r.cacheGuardSnapshot.avalanche.jitterPeak, peakReduction: r.cacheGuardSnapshot.avalanche.peakReduction },
      } : null,
      rateLimit: r.rateLimitSnapshot ? {
        fixedWindowBurstRatio: r.rateLimitSnapshot.strategies.fixedWindow.burstRatio,
        slidingBurstRatio: r.rateLimitSnapshot.strategies.slidingLog.burstRatio,
        atomicAllowed: r.rateLimitSnapshot.redis.atomicAllowed,
        nonAtomicAllowed: r.rateLimitSnapshot.redis.nonAtomicAllowed,
        overshoot: r.rateLimitSnapshot.redis.overshoot,
        sharedConsistent: r.rateLimitSnapshot.redis.shared.consistent,
      } : null,
      failureDetector: r.failureDetectorSnapshot ? {
        fixedFalsePositives: r.failureDetectorSnapshot.fixed.falsePositives,
        phiFalsePositives: r.failureDetectorSnapshot.phi.falsePositives,
        fixedDetectionMs: r.failureDetectorSnapshot.fixed.detectionLatencyMs,
        phiDetectionMs: r.failureDetectorSnapshot.phi.detectionLatencyMs,
        verdict: r.failureDetectorSnapshot.verdict,
        swim: r.failureDetectorSnapshot.swim.counts,
        healthNodes: r.failureDetectorSnapshot.health.nodes,
      } : null,
      bplusIndex: r.bplusIndexSnapshot ? {
        bplusHeight: r.bplusIndexSnapshot.structure.height,
        bplusHeightEstimate: r.bplusIndexSnapshot.structure.heightEstimate,
        leafCount: r.bplusIndexSnapshot.structure.leafCount,
        fanout: r.bplusIndexSnapshot.structure.fanout,
        invariants: r.bplusIndexSnapshot.structure.invariants,
        pointFavors: r.bplusIndexSnapshot.point.favors,
        bplusPointComparisons: r.bplusIndexSnapshot.point.bplusComparisons,
        lsmPointComparisons: r.bplusIndexSnapshot.point.lsmComparisons,
        rangeFavors: r.bplusIndexSnapshot.range.favors,
        writeFavors: r.bplusIndexSnapshot.write.favors,
        bplusPageRewrites: r.bplusIndexSnapshot.write.bplusPageRewrites,
        lsmSeqWriteUnits: r.bplusIndexSnapshot.write.lsmSeqWriteUnits,
        bothAgree: r.bplusIndexSnapshot.agreement.bothAgree,
        verdict: r.bplusIndexSnapshot.verdict,
      } : null,
      mvccTxn: r.mvccTxnSnapshot ? {
        levels: r.mvccTxnSnapshot.levels.map((l) => ({ short: l.short, observedCount: l.observedCount, aborted: l.aborted })),
        siLeaksWriteSkew: r.mvccTxnSnapshot.levels.find((l) => l.short === 'SI')?.anomalies.writeSkew.observed ?? null,
        deadlockDetected: r.mvccTxnSnapshot.deadlock.detected,
        deadlockResolved: r.mvccTxnSnapshot.deadlock.resolved,
        deadlockVictim: r.mvccTxnSnapshot.deadlock.victim,
        twoPhaseLockEnforced: r.mvccTxnSnapshot.twoPhaseLock.lateAcquireBlocked,
        longTxnRetainsVersions: r.mvccTxnSnapshot.gc.longTxnRetainsMoreVersions,
        verdict: r.mvccTxnSnapshot.verdict,
      } : null,
      stoppedRegistered: r.stopped?.registered,
    }, null, 2))
    process.exit(0)
  }).catch((e) => { console.error(e.message); process.exit(1) })
}
