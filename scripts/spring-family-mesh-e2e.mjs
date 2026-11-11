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
    // KI-506：分布式事务三协议（distributedTxn=true 装配；只读 2PC/Saga/TCC × 六场景矩阵 + 三难判词，不改调用路径）。
    distributedTxn: opts.distributedTxn,
    dtxnNow: opts.dtxnNow,
    // KI-507：Raft 共识三协议（raftConsensus=true 装配；只读 Raft/MultiMaster/Gossip × 六场景矩阵 + 三难判词，不改调用路径）。
    raftConsensus: opts.raftConsensus,
    raftNow: opts.raftNow,
    // KI-508：分布式锁三协议（distributedLock=true 装配；只读 SETNX/Redlock/etcd × 六场景矩阵 + 三难判词，不改调用路径）。
    distributedLock: opts.distributedLock,
    dlockNow: opts.dlockNow,
    // KI-509：分布式 ID 三协议（idGen=true 装配；只读 UUID/Snowflake/号段 × 六场景矩阵 + 三难判词 + KI-504 真树交叉印证，不改调用路径）。
    idGen: opts.idGen,
    idGenNow: opts.idGenNow,
    // KI-510：分布式限流三协议（distributedRateLimit=true 装配；只读 本地桶/中心桶/分片桶 × 六场景矩阵 + 三难判词 + 真 Redis 原子桶/真环交叉印证，不改调用路径）。
    distributedRateLimit: opts.distributedRateLimit,
    drNow: opts.drNow,
    // KI-511：分布式配置一致性三协议（configConsistency=true 装配；只读 轮询/长轮询/watch 推送 × 六场景矩阵 + 三难判词 + 真 Config响应/watcher/bus/环交叉印证，不改调用路径）。
    configConsistency: opts.configConsistency,
    dccNow: opts.dccNow,
    // KI-512：分布式缓存读写一致性三协议（cacheCoherency=true 装配；只读 Cache-Aside/Write-Through/Write-Behind × 六场景矩阵 + 三难判词 + 真 Redis写后读/WAL崩溃恢复/MVCC/2PC/环 交叉印证，不改调用路径）。
    cacheCoherency: opts.cacheCoherency,
    cccNow: opts.cccNow,
    // KI-513：分布式消息投递语义三协议（messageDelivery=true 装配；只读 At-Most-Once/At-Least-Once/Exactly-Once × 六场景矩阵 + 三难判词 + 真 Bus/GameEventBus/Bridge/2PC/WAL/Redis/环 交叉印证，不改调用路径）。
    messageDelivery: opts.messageDelivery,
    mmdNow: opts.mmdNow,
    // KI-518：延迟消息队列调度三协议（delayQueue=true 装配；只读 TimingWheel/MinHeap/RedisZset × 六场景矩阵 + 三难向量 + 七枚真件交叉印证，rigged 向量由 trilemma 现算不硬覆盖，不改调用路径）。
    delayQueue: opts.delayQueue,
    dqNow: opts.dqNow,
    // KI-520：消息重试退避与死信队列三协议（retryDlq=true 装配；只读 Immediate/Exponential/FullJitter × 六场景矩阵 + 三难向量 + 七枚真件交叉印证，rigged 101/101/101 因果锁死 noStorm、不硬造全 111，不改调用路径）。
    retryDlq: opts.retryDlq,
    rdlNow: opts.rdlNow,
    // KI-523：消费者组 rebalance / 分区所有权三协议（consumerGroup=true 装配；只读 Range/RoundRobin/Sticky × 六场景矩阵 + 三难向量 + 九枚真件交叉印证，rigged 101/101/101 因果锁死 minimalMovement、不硬造全 111，不改调用路径）。
    consumerGroup: opts.consumerGroup,
    cgpNow: opts.cgpNow,
    // KI-525：积压背压 / 流量削峰四策略（backpressure=true 装配；只读 Backpressure/Buffering/Shedding/Scaling × 六场景矩阵 + 三难向量 + Little's Law 双路自证 + 十一枚真件交叉印证，rigged 110/110/110/110 因果锁死 highThroughput、不硬造全 111，不改调用路径）。
    // 注入时钟用 bpcNow（bp* 已被 KI-504 B+ 树占用）。
    backpressure: opts.backpressure,
    bpcNow: opts.bpcNow,
    // KI-526：append-only 日志压缩 / 回放边界三策略（logCompaction=true 装配；只读 SizeTimeRetention/KeyCompaction/SnapshotPlusWal × 六场景矩阵 + 三难向量 + verifyReplayBoundary 双路守恒自证 + 十一枚真件交叉印证，rigged 110/110/110 因果锁死 fastRecovery、不硬造全 111，不改调用路径）。
    // 注入时钟用 lcNow（避开 lsm/bp/bpc/cgp/rdq/dld 已占用前缀）。
    logCompaction: opts.logCompaction,
    lcNow: opts.lcNow,
    // KI-527：布隆/布谷鸟/计数布隆三过滤器诚实权衡（bloomFilter=true 装配；只读 Bloom/CountingBloom/Cuckoo × 六场景矩阵 + 三难向量 110/011/101 + verifyFalsePositiveCeiling 双路自证 + 十一枚真件 21 键交叉印证，rigged 011/011/011 由 unlimitedRoom 真算因果锁死 compactFootprint、绝不硬造全 111，不改调用路径）。
    // 注入时钟用 bfNow（避开 bf* 分支与 lsm/bp/bpc/cgp/lc/rdq/dld 前缀）。
    bloomFilter: opts.bloomFilter,
    bfNow: opts.bfNow,
    // KI-528：LRU/2Q/ARC 三替换策略诚实权衡（cacheReplacement=true 装配；只读 LRU/2Q/ARC × 六场景矩阵 + 三难向量（默认 010/110/101 互异不封赢家）+ verifyDualSweep 双路交叉印证（真 trace 两路独立重放 + 三路篡改真喂回现算翻 false）+ 十一真件 21 键交叉印证，rigged 两开关真进构造 ⇒ 向量现算收敛 110/110/110、adaptiveBalanceCausallyUnerasable 因果锁死自适应维、绝不硬造全 111，不改调用路径）。
    // 注入时钟用 crNow（避开 cr* 分支与 lsm/bp/bpc/cgp/lc/bf/rdq/dld 已占用前缀）。
    cacheReplacement: opts.cacheReplacement,
    crNow: opts.crNow,
    // KI-529：流式窗口聚合与 Watermark 迟到处置三策略诚实权衡（streamWindow=true 装配；只读 Tumbling/Sliding/Session × 六场景矩阵 + 三难向量（默认 011/110/101 互异不封赢家）+ verifyWatermarkMonotonicity 双路交叉印证（到达序 watermark 单调 + 承诺地平线 / 处置守恒，三路篡改真喂回现算翻 false）+ 十一真件 21 键交叉印证，rigged 三开关真进构造 ⇒ 向量现算收敛 011/011/011、resultCompletenessCausallyUnerasable 因果锁死结果维、绝不硬造全 111，不改调用路径）。
    // 注入时钟用 swNow（避开 sw* 分支与 lsm/bp/bpc/cgp/lc/bf/cr/rdq/dld 已占用前缀）。
    streamWindow: opts.streamWindow,
    swNow: opts.swNow,
    // KI-530：基数估计算法族诚实权衡（hyperLogLog=true 装配；只读 ExactSet/HyperLogLog/LinearCounting × 六场景矩阵 + 三难向量（默认 101/110/010 互异不封赢家）+ verifySparseEstimate 双路交叉印证 + 十一真件 21 键交叉印证，rigged 双开关后 ExactSet 现算收敛 111 反事实、HLL=110、LC 位图饱和因果锁死仍 010、绝不硬造全策略 111，不改调用路径）。
    // 注入时钟用 hllNow（避开 hll* 分支与 lsm/bp/bpc/cgp/lc/bf/cr/sw/rdq/dld 已占用前缀）。
    hyperLogLog: opts.hyperLogLog,
    hllNow: opts.hllNow,
    // KI-531：CRDT 最终一致冲突消解三策略诚实权衡（crdt=true 装配；只读 LWWRegister/GCounter/OrSet(add-wins) × 六场景矩阵 +
    // 三难向量维序 [strongEventualConvergence/expressiveness/compactMetadata]（默认 011/100/110 互异不封赢家；
    // rigged 三开关 uniformClock/infiniteMetadata/coordinatedDelete 齐开后唯一翻 GCounter compact⇒101，另两条因果锁——
    // LWW 并发丢/OrSet tag 历史不可压——钉死，主教义 noUniversalWinner 仍真、绝不硬造 111）+ verifyConvergence 双路自证
    // （三副本乱序+重复 anti-entropy 后 value 逐字相等 + 真值不变量 + 三路篡改真喂回现算翻 false）+ 十一真件 21 键交叉印证，
    // 诚实口径：三者严格 SEC 全收敛、LWW 破在并发意图非副本分歧、OrSet 是 add-wins（observed-remove），不改调用路径）。
    // 注入时钟用 crdtNow（避开 lsm/bp/bpc/cgp/lc/bf/cr/sw/hll/rdq/dld 已占用前缀）。
    crdt: opts.crdt,
    crdtNow: opts.crdtNow,
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
        distributedTxnSnapshot: status.distributedTxn ?? null,
        raftConsensusSnapshot: status.raftConsensus ?? null,
        distributedLockSnapshot: status.distributedLock ?? null,
        idGenSnapshot: status.idGen ?? null,
        distributedRateLimitSnapshot: status.distributedRateLimit ?? null,
        configConsistencySnapshot: status.configConsistency ?? null,
        cacheCoherencySnapshot: status.cacheCoherency ?? null,
        messageDeliverySnapshot: status.messageDelivery ?? null,
        delayQueueSnapshot: status.delayQueue ?? null,
        retryDlqSnapshot: status.retryDlq ?? null,
        consumerGroupSnapshot: status.consumerGroup ?? null,
        backpressureSnapshot: status.backpressure ?? null,
        logCompactionSnapshot: status.logCompaction ?? null,
        bloomFilterSnapshot: status.bloomFilter ?? null,
        cacheReplacementSnapshot: status.cacheReplacement ?? null,
        streamWindowSnapshot: status.streamWindow ?? null,
        hyperLogLogSnapshot: status.hyperLogLog ?? null,
        crdtSnapshot: status.crdt ?? null,
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
      distributedTxn: r.distributedTxnSnapshot ? {
        protocols: r.distributedTxnSnapshot.rows.map((row) => ({
          protocol: row.protocol, intrusion: row.intrusion, isolation: row.isolation,
          ladder: row.scenarios.map((s) => s.id + ':' + (s.committed ? '成' : s.blocked > 0 ? '阻' : s.dirty > 0 ? '脏' : '止')).join(' → '),
          totals: row.totals, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.distributedTxnSnapshot.rows.map((row) => [row.protocol,
          `${Number(row.trilemma.noBlock)}${Number(row.trilemma.noDirty)}${Number(row.trilemma.lowIntrusion)}`])),
        noUniversalWinner: r.distributedTxnSnapshot.verdict.noUniversalWinner,
        verdict: r.distributedTxnSnapshot.verdict,
      } : null,
      raftConsensus: r.raftConsensusSnapshot ? {
        protocols: r.raftConsensusSnapshot.rows.map((row) => ({
          protocol: row.protocol,
          ladder: row.scenarios.map((s) => s.id + ':' + (s.blockedWrites > 0 ? '阻' : s.staleReads > 0 ? '陈' : s.conflicts > 0 ? '冲' : s.converged === false ? '散' : s.committed ? '成' : '?')).join(' → '),
          totals: row.totals, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.raftConsensusSnapshot.rows.map((row) => [row.protocol,
          `${Number(row.trilemma.linearizable)}${Number(row.trilemma.partitionAvailable)}${Number(row.trilemma.boundedConvergence)}`])),
        noUniversalWinner: r.raftConsensusSnapshot.verdict.noUniversalWinner,
        verdict: r.raftConsensusSnapshot.verdict,
      } : null,
      distributedLock: r.distributedLockSnapshot ? {
        protocols: r.distributedLockSnapshot.rows.map((row) => ({
          protocol: row.protocol,
          ladder: row.scenarios.map((s) => s.id + ':' + (s.doubleOwners > 0 ? '双' : s.staleWritesRejected > 0 ? '护' : s.dirtyWrites > 0 ? '脏' : s.blockedAcquires > 0 ? (row.protocol === 'SETNX' ? '阻' : '拒') : s.acquired ? '成' : '?')).join(' → '),
          totals: row.totals, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.distributedLockSnapshot.rows.map((row) => [row.protocol,
          `${Number(row.trilemma.mutualExclusion)}${Number(row.trilemma.partialFaultTolerance)}${Number(row.trilemma.lowLatency)}`])),
        noUniversalWinner: r.distributedLockSnapshot.verdict.noUniversalWinner,
        verdict: r.distributedLockSnapshot.verdict,
      } : null,
      idGen: r.idGenSnapshot ? {
        protocols: r.idGenSnapshot.rows.map((row) => ({
          protocol: row.protocol,
          ladder: row.scenarios.map((s) => s.id + ':' + (s.duplicates > 0 ? '重' : s.stalled > 0 ? '停' : s.indexFriendly === false ? '裂' : s.wastedIds > 0 ? '隙' : s.centerRounds > 0 ? '迟' : s.issued > 0 ? '成' : '?')).join(' → '),
          totals: row.totals, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.idGenSnapshot.rows.map((row) => [row.protocol,
          `${Number(row.trilemma.indexFriendly)}${Number(row.trilemma.decentralized)}${Number(row.trilemma.clockRobust)}`])),
        noUniversalWinner: r.idGenSnapshot.verdict.noUniversalWinner,
        btreeCrosscheck: {
          randomCmpGtSequential: r.idGenSnapshot.btree.randomCmpGtSequential,
          randomFewerSplits: r.idGenSnapshot.btree.randomFewerSplits,
          sequentialCmp: r.idGenSnapshot.btree.sequential.comparisons,
          randomCmp: r.idGenSnapshot.btree.random.comparisons,
        },
        verdict: r.idGenSnapshot.verdict,
      } : null,
      distributedRateLimit: r.distributedRateLimitSnapshot ? {
        protocols: r.distributedRateLimitSnapshot.rows.map((row) => ({
          protocol: row.protocol,
          ladder: row.scenarios.map((s) => s.id + ':' + (s.degradedShard > 0 ? '降' : s.fragmented > 0 ? '碎' : s.overAllowed > 0 ? '超' : s.centerRounds > 0 ? '迟' : s.allowed > 0 ? '成' : '?')).join(' → '),
          totals: row.totals, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.distributedRateLimitSnapshot.rows.map((row) => [row.protocol,
          `${Number(row.trilemma.globalExact)}${Number(row.trilemma.partialFaultTolerance)}${Number(row.trilemma.noCenterRTT)}`])),
        noUniversalWinner: r.distributedRateLimitSnapshot.verdict.noUniversalWinner,
        crosscheck: r.distributedRateLimitSnapshot.crosscheck,
        verdict: r.distributedRateLimitSnapshot.verdict,
      } : null,
      configConsistency: r.configConsistencySnapshot ? {
        protocols: r.configConsistencySnapshot.rows.map((row) => ({
          protocol: row.protocol,
          ladder: row.scenarios.map((s) => s.id + ':' + (s.centerBroken ? '断' : s.versionGaps > 0 ? '缺' : s.idleFetches > 0 ? '空' : s.perceivedDelay > 0 ? '迟' : s.connections > 0 ? '连' : '成')).join(' → '),
          totals: row.totals, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.configConsistencySnapshot.rows.map((row) => [row.protocol,
          `${Number(row.trilemma.degradeOnCenterDown)}${Number(row.trilemma.noIdleOverhead)}${Number(row.trilemma.instantPerceive)}`])),
        noUniversalWinner: r.configConsistencySnapshot.verdict.noUniversalWinner,
        crosscheck: r.configConsistencySnapshot.crosscheck,
        verdict: r.configConsistencySnapshot.verdict,
      } : null,
      cacheCoherency: r.cacheCoherencySnapshot ? {
        protocols: r.cacheCoherencySnapshot.rows.map((row) => ({
          protocol: row.protocol,
          ladder: row.scenarios.map((s) => s.id + ':' + (s.dirtyPagesLost > 0 ? '丢' : s.staleReads > 0 ? '旧' : s.writeBackendRounds > 0 ? '阻' : s.coalescedWrites > 0 ? '并' : '成')).join(' → '),
          totals: row.totals, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.cacheCoherencySnapshot.rows.map((row) => [row.protocol,
          `${Number(row.trilemma.readYourWrites)}${Number(row.trilemma.noWriteBlocking)}${Number(row.trilemma.durableOnCrash)}`])),
        noUniversalWinner: r.cacheCoherencySnapshot.verdict.noUniversalWinner,
        crosscheck: r.cacheCoherencySnapshot.crosscheck,
        verdict: r.cacheCoherencySnapshot.verdict,
      } : null,
      messageDelivery: r.messageDeliverySnapshot ? {
        protocols: r.messageDeliverySnapshot.rows.map((row) => ({
          protocol: row.protocol,
          ladder: row.scenarios.map((s) => s.id + ':' + (s.lost > 0 ? '丢' : s.duplicates > 0 ? '重' : !s.lowOverhead ? '贵' : s.idempotentHits > 0 ? '等' : '成')).join(' → '),
          totals: row.totals, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.messageDeliverySnapshot.rows.map((row) => [row.protocol,
          `${Number(row.trilemma.noLoss)}${Number(row.trilemma.noDup)}${Number(row.trilemma.lowOverhead)}`])),
        noUniversalWinner: r.messageDeliverySnapshot.verdict.noUniversalWinner,
        crosscheck: r.messageDeliverySnapshot.crosscheck,
        verdict: r.messageDeliverySnapshot.verdict,
      } : null,
      delayQueue: r.delayQueueSnapshot ? {
        protocols: r.delayQueueSnapshot.rows.map((row) => ({
          protocol: row.protocol,
          ladder: row.scenarios.map((s) => s.id + ':' + (s.lateMs > 0 ? '晚' : s.lostOnRestart > 0 ? '丢' : s.duplicatePickups > 0 ? '重' : !s.lowCost ? '贵' : s.punctual ? '准' : '稳')).join(' → '),
          totals: row.totals, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.delayQueueSnapshot.rows.map((row) => [row.protocol,
          `${Number(row.trilemma.lowCost)}${Number(row.trilemma.punctual)}${Number(row.trilemma.sharedDurable)}`])),
        noUniversalWinner: r.delayQueueSnapshot.verdict.noUniversalWinner,
        crosscheck: r.delayQueueSnapshot.crosscheck,
        verdict: r.delayQueueSnapshot.verdict,
      } : null,
      retryDlq: r.retryDlqSnapshot ? {
        protocols: r.retryDlqSnapshot.rows.map((row) => ({
          protocol: row.protocol,
          ladder: row.scenarios.map((s) => s.id + ':' + (s.deadLettered > 0 ? '死' : s.noStorm === false ? '暴' : s.noHerd === false ? '群' : s.fastRecovery === false ? '慢' : '稳')).join(' → '),
          totals: row.totals, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.retryDlqSnapshot.rows.map((row) => [row.protocol,
          `${Number(row.trilemma.fastRecovery)}${Number(row.trilemma.noStorm)}${Number(row.trilemma.noHerd)}`])),
        noUniversalWinner: r.retryDlqSnapshot.verdict.noUniversalWinner,
        crosscheck: r.retryDlqSnapshot.crosscheck,
        verdict: r.retryDlqSnapshot.verdict,
      } : null,
      consumerGroup: r.consumerGroupSnapshot ? {
        protocols: r.consumerGroupSnapshot.rows.map((row) => ({
          protocol: row.protocol,
          ladder: row.scenarios.map((s) => s.id + ':' + (s.starved ? '饥' : s.imbalance > 1 ? '斜' : s.moveRate > 0.5 ? '迁' : s.opPerPart > 2 ? '贵' : '稳')).join(' → '),
          metrics: row.metrics, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.consumerGroupSnapshot.rows.map((row) => [row.protocol,
          `${Number(row.trilemma.balanced)}${Number(row.trilemma.minimalMovement)}${Number(row.trilemma.cheap)}`])),
        noUniversalWinner: r.consumerGroupSnapshot.verdict.noUniversalWinner,
        crosscheck: r.consumerGroupSnapshot.crosscheck,
        verdict: r.consumerGroupSnapshot.verdict,
      } : null,
      backpressure: r.backpressureSnapshot ? {
        strategies: r.backpressureSnapshot.rows.map((row) => ({
          strategy: row.strategy,
          // 每格状态只认真件算好的三布尔，绝不拿阈值重算（六场景正交、其余维空真，与三难同源）。
          ladder: row.scenarios.map((s) => s.id + ':' + (s.noLoss === false ? '丢' : s.lowLatency === false ? '滞' : s.highThroughput === false ? '压' : '稳')).join(' → '),
          metrics: row.metrics, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.backpressureSnapshot.rows.map((row) => [row.strategy,
          `${Number(row.trilemma.noLoss)}${Number(row.trilemma.lowLatency)}${Number(row.trilemma.highThroughput)}`])),
        noUniversalWinner: r.backpressureSnapshot.verdict.noUniversalWinner,
        littleLaw: r.backpressureSnapshot.littleLaw,
        crosscheck: r.backpressureSnapshot.crosscheck,
        verdict: r.backpressureSnapshot.verdict,
      } : null,
      logCompaction: r.logCompactionSnapshot ? {
        strategies: r.logCompactionSnapshot.rows.map((row) => ({
          strategy: row.strategy,
          // 每格状态只认真件算好的三布尔，绝不拿阈值重算（六场景正交、其余维空真，与三难同源）。
          ladder: row.scenarios.map((s) => s.id + ':' + (s.compactFootprint === false ? '占' : s.replayCompleteness === false ? '丢' : s.fastRecovery === false ? '滞' : '稳')).join(' → '),
          metrics: row.metrics, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.logCompactionSnapshot.rows.map((row) => [row.strategy,
          `${Number(row.trilemma.compactFootprint)}${Number(row.trilemma.replayCompleteness)}${Number(row.trilemma.fastRecovery)}`])),
        noUniversalWinner: r.logCompactionSnapshot.verdict.noUniversalWinner,
        replayBoundary: r.logCompactionSnapshot.replayBoundary,
        crosscheck: r.logCompactionSnapshot.crosscheck,
        verdict: r.logCompactionSnapshot.verdict,
      } : null,
      bloomFilter: r.bloomFilterSnapshot ? {
        strategies: r.bloomFilterSnapshot.rows.map((row) => ({
          strategy: row.protocol,
          // 每格状态只认真件算好的三布尔（compactFootprint/insertsNeverFail/deleteSupport）——绝不拿阈值重算，与 trilemma 同源。
          ladder: row.scenarios.map((s) => s.id + ':' + (s.compactFootprint === false ? '肥' : s.insertsNeverFail === false ? '崖' : s.deleteSupport === false ? '缺删' : '✓')).join(' → '),
          metrics: row.metrics, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.bloomFilterSnapshot.rows.map((row) => [row.protocol,
          `${Number(row.trilemma.compactFootprint)}${Number(row.trilemma.insertsNeverFail)}${Number(row.trilemma.deleteSupport)}`])),
        noUniversalWinner: r.bloomFilterSnapshot.verdict.noUniversalWinner,
        crosscheck: r.bloomFilterSnapshot.crosscheck,
        verdict: r.bloomFilterSnapshot.verdict,
      } : null,
      cacheReplacement: r.cacheReplacementSnapshot ? {
        strategies: r.cacheReplacementSnapshot.rows.map((row) => ({
          strategy: row.protocol,
          // 每格状态只认真件算好的三布尔（scanResistance/stableHitRate/adaptiveBalance）—绝不拿阈值重算，与 trilemma 同源。
          ladder: row.scenarios.map((s) => s.id + ':' + (s.scanResistance === false ? '污' : s.stableHitRate === false ? '抖' : s.adaptiveBalance === false ? '僵' : '✓')).join(' → '),
          metrics: row.metrics, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.cacheReplacementSnapshot.rows.map((row) => [row.protocol,
          `${Number(row.trilemma.scanResistance)}${Number(row.trilemma.stableHitRate)}${Number(row.trilemma.adaptiveBalance)}`])),
        noUniversalWinner: r.cacheReplacementSnapshot.verdict.noUniversalWinner,
        crosscheck: r.cacheReplacementSnapshot.crosscheck,
        verdict: r.cacheReplacementSnapshot.verdict,
      } : null,
      streamWindow: r.streamWindowSnapshot ? {
        strategies: r.streamWindowSnapshot.rows.map((row) => ({
          strategy: row.protocol,
          // 每格状态只认真件算好的三布尔（resultCompleteness/lateTolerance/stateEfficiency）—绝不拿阈值重算，与 trilemma 同源。
          ladder: row.scenarios.map((s) => s.id + ':' + (s.resultCompleteness === false ? '缺' : s.lateTolerance === false ? '迟' : s.stateEfficiency === false ? '胀' : '✓')).join(' → '),
          metrics: row.metrics, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.streamWindowSnapshot.rows.map((row) => [row.protocol,
          `${Number(row.trilemma.resultCompleteness)}${Number(row.trilemma.lateTolerance)}${Number(row.trilemma.stateEfficiency)}`])),
        noUniversalWinner: r.streamWindowSnapshot.verdict.noUniversalWinner,
        crosscheck: r.streamWindowSnapshot.crosscheck,
        verdict: r.streamWindowSnapshot.verdict,
      } : null,
      hyperLogLog: r.hyperLogLogSnapshot ? {
        strategies: r.hyperLogLogSnapshot.rows.map((row) => ({
          strategy: row.protocol,
          // 每格状态只认真件算好的三布尔（estimatorAccuracy/fixedMemory/mergeable）—绝不拿阈值重算，与 trilemma 同源。
          ladder: row.scenarios.map((s) => s.id + ':' + (s.estimatorAccuracy === false ? '失' : s.fixedMemory === false ? '碎' : s.mergeable === false ? '裂' : '✓')).join(' → '),
          metrics: row.metrics, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.hyperLogLogSnapshot.rows.map((row) => [row.protocol,
          `${Number(row.trilemma.estimatorAccuracy)}${Number(row.trilemma.fixedMemory)}${Number(row.trilemma.mergeable)}`])),
        noUniversalWinner: r.hyperLogLogSnapshot.verdict.noUniversalWinner,
        crosscheck: r.hyperLogLogSnapshot.crosscheck,
        verdict: r.hyperLogLogSnapshot.verdict,
      } : null,
      crdt: r.crdtSnapshot ? {
        strategies: r.crdtSnapshot.rows.map((row) => ({
          strategy: row.protocol,
          // 每格状态只认真件现算好的三布尔（strongEventualConvergence/expressiveness/compactMetadata）—绝不拿阈值重算，与 trilemma/vectors 同源。
          // '乱'=并发意图被静默吞(SEC破) / '锁'=不可反向减删(expressiveness破) / '胀'=元数据随规模膨胀(compact破)。
          ladder: row.scenarios.map((s) => s.id + ':' + (s.strongEventualConvergence === false ? '乱' : s.expressiveness === false ? '锁' : s.compactMetadata === false ? '胀' : '✓')).join(' → '),
          metrics: row.metrics, trilemma: row.trilemma,
        })),
        trilemmaVectors: Object.fromEntries(r.crdtSnapshot.rows.map((row) => [row.protocol,
          `${Number(row.trilemma.strongEventualConvergence)}${Number(row.trilemma.expressiveness)}${Number(row.trilemma.compactMetadata)}`])),
        vectors: r.crdtSnapshot.vectors,
        baseVectors: r.crdtSnapshot.baseVectors,
        noUniversalWinner: r.crdtSnapshot.verdict.noUniversalWinner,
        crosscheck: r.crdtSnapshot.crosscheck,
        verdict: r.crdtSnapshot.verdict,
      } : null,
      stoppedRegistered: r.stopped?.registered,
    }, null, 2))
    process.exit(0)
  }).catch((e) => { console.error(e.message); process.exit(1) })
}
