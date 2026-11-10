# CAESURA《止音纪元》— Spring Cloud 微服务网格（集大成地图）

> 本文是 CAESURA 项目里「Spring Cloud 微服务家族」的**合成地图**：把散落在 `scripts/` 的 35+ 件 Node 侧
> Spring Cloud 客户端，收口成游戏可一键拉起的一朵云。本文只描述**架构与边界**，不重复每个件的实现细节
> （细节见 `docs/KNOWN_ISSUES.md` 的 KI-460~489 账本行与各 `scripts/*.d.mts`）。

## 1. 总原则（决策原则①，贯穿全族）

- **Spring/Java 侧只做编排/重试/熔断/报告**；**判定与阈值一律由 Node 侧负责**。
- 因此每个 Node 客户端都是「编排壳 + 判定权在 Node」，不把业务阈值写死进 Spring 配置。
- `scripts/*.mjs` 必须配 `*.d.mts`（声明导出名完全一致）并通过 `decl-parity` 门；账本/PLAN/PHASE-STATUS 三者计数一致。

## 2. 分层

```
┌──────────────────────────────────────────────────────────────────────┐
│  游戏本体 (src/)                                                       │
│   └─ bridge.install(game)  —— 开机即注册 / 关机即注销（caesura-game-bootstrap）│
│   └─ gc.connectGameBus(bus, routes) —— 真 EventBus ↔ 云事件（KI-489 桥） │
└───────────────────────────────┬──────────────────────────────────────┘
                                  │ createGameCloud({...}).start()
┌─────────────────────────────────▼─────────────────────────────────────┐
│  caesura-game-cloud  （开箱即用云入口，KI-478/484/485/489/490/491/493/494）│
│    start / call / proxyCall / shutdown / status                         │
│    + events（KI-484 云事件总线）· auth（KI-485 鉴权守卫）                │
│    + connectGameBus（KI-489 事件桥，shutdown 自动退桥）                   │
│    + gray（KI-491 灰度/金丝雀加权路由；lbStrategy 可切 weight）           │
│    + net（KI-494 计网可观测包，真调用耗时/成败喂 AIMD/RTO/滑窗，opt-in）   │
├───────────────────────────────────────────────────────────────────────┤
│  caesura-cloud-runtime  （集大成运行时，KI-473/477/487）                 │
│    call 路径：网关 predicate 匹配 → 完整 filter 链（KI-486/487）         │
│             → 负载均衡选实例 → 起 span → transport                       │
│    + caesura-service-proxy（KI-474：按服务隔离的韧性调用）               │
├───────────────────────────────────────────────────────────────────────┤
│  家族客户端（Node 侧，组合进运行时）：                                  │
│   · 门面/发现   : spring-cloud-facade · spring-mesh-registry · spring-discovery · eureka · consul │
│   · 网关        : spring-gateway-route（表）· spring-gateway-matcher（KI-475 可用化求值/可重入链）  │
│                  · spring-gateway-filter-handlers（KI-486 Retry/RateLimit/CircuitBreaker           │
│                    + KI-492 Bulkhead 并发舱壁 / TimeLimiter 调用超时）                            │
│   · 负载/熔断   : spring-load-balancer（KI-491 weight 策略可用化）· spring-resilience-breaker（KI-472）│
│                  · spring-gateway-gray（KI-491 会话亲和/金丝雀分池/池内加权/空池回退）            │
│   · 追踪        : spring-sleuth-trace（查）· spring-sleuth-tracer（KI-476 进程内造 span）         │
│   · 配置        : spring-config-client · spring-config-server · spring-config-refresh            │
│                  · caesura-config-aggregator（KI-480 多源优先级合并）                           │
│   · 安全/契约   : spring-cloud-security-oauth2 · spring-cloud-vault · spring-cloud-contract        │
│                  · caesura-auth-guard（KI-485 鉴权守卫）/ caesura-event-bus（KI-484 事件总线）     │
│                  · caesura-game-event-bridge（KI-489 真 EventBus↔云 桥，依赖注入）                 │
│                  · caesura-auth-guard.authorizeOnline（KI-490 RFC 7662 introspection 在线校验）   │
│                  · caesura-redis-cache（KI-493 LRU+TTL+singleflight+字节预算，接鉴权缓存）        │
│   · 计网算法   : caesura-net-stack（KI-494 Reno/CUBIC 拥塞控制·RTO+Karn·滑窗+SACK·0-RTT·HTTP SWR/ETag）│
│   · 任务/函数   : spring-cloud-task · spring-cloud-function · spring-cloud-stream · openfeign     │
│   · 总线/健康   : spring-bus-client · spring-health-check · spring-mesh-health                     │
│   · K8s         : spring-cloud-kubernetes-client（KI-479，configMap+endpoints→mesh 实例）         │
│   · 适配层      : caesura-mesh-adapter（游戏成为一等公民，KI-471）                                 │
└───────────────────────────────────────────────────────────────────────┘
        │                                   │
        ▼                                   ▼
  Java 侧 6 件服务（registry/config/gateway/gate/report/client）  ·  真实 Eureka/Consul/Config/K8s/Zipkin（注入才接）
```

## 3. 一次 `proxyCall` 的完整链路（KI-477/487 实证）

```
proxyCall('caesura-gate', '/api/health')
  └─ service-proxy: 按服务名取/建一只进程内熔断器（spring-resilience-breaker）
       └─ runtime.call:
            1. gateway.matchRoute(routes, {path})      —— 无路由 → no_route 短路
            2. mesh.aggregate() → load-balancer 选实例（Eureka/Consul/K8s/self 合并视图）
            3. tracer.startSpan + 注入 W3C traceparent 头
            4. gateway.runWithFilters(route, ctx, handlers, terminal=doTransport)  ← KI-487 完整 filter 链
                 · 可重入链（KI-486）：每个 handler 的 next() 是「重跑剩余链」的纯函数
                 · CircuitBreaker → 包 spring-resilience-breaker，按 args.name 隔离，复用 runtime 熔断器
                 · Retry          → 失败重跑下游 ≤ args.attempts 次，backoffMs 可注入
                 · RateLimit      → 令牌桶，按 args.key 隔离，桶空抛 rate_limited
                 · Bulkhead(KI-492)→ 并发舱壁，按 args.key 信号量子，maxConcurrent 满即拒/排队，控 in-flight 并发
                 · TimeLimiter(KI-492)→ Promise.race 超时，到点抛 time_limiter_timeout，不取消底层 in-flight
                 · 阈值全来自路由 args / opts（判定权 Node 侧）；链尾才 doTransport
                 · 结果回带 filterStats（retries/rateLimited/bulkheadRejected/timedOut/passed）供 E2E 读数
            5. transport(url) → 真调用（或默认走 CaesuraCloud.request 编排）
            6. tracer.finish(span) → 产出与 spring-sleuth-trace 同源的 span
```

> 注入的自定义网关若没有 `runWithFilters`，退回旧语义（只按 CircuitBreaker filter 包一层），非破坏。

## 4. 游戏如何成为「一等微服务」（一行集成）

```js
// src/ 游戏启动处（伪代码，事件名按真实游戏生命周期适配）
import { createGameCloudBridge } from '../../scripts/caesura-game-bootstrap.mjs'

const bridge = createGameCloudBridge({
  gameId: 'caesura-game',
  gamePort: 7700,
  sources: {
    eureka: () => discoverEureka(),      // 或 k8s：springCloudKubernetes.discover('svc')
    // k8s: () => k8s.discover('caesura-gate'),
  },
})
bridge.install(game)   // 开机 → 注册进 mesh + 广播 lifecycle/runtime 事件；关机 → 注销
```

- `caesura-game-bootstrap`（KI-482）只交付桥接件，**不改游戏 src/ 构建**，事件名可用 `bootEvents/shutdownEvents` 适配。
- 默认 `gateway:true, tracer:true`：调用自动过网关、带调用链追踪。

**游戏事件成为一等微服务事件（KI-484/485/489）**——把真 `EventBus` 与云事件总线、鉴权守卫一并接上：

```js
import { bus } from '@/core/EventBus'                       // 游戏真事件总线（on/emit，载荷 GameEvents）
// gc 即 createGameCloud(...) 的实例；也可走 createGameCloudBridge({...}).gc
gc.connectGameBus(bus, [                                     // KI-489：白名单，默认空＝零转发
  { from: 'game',  key: 'boss.phase',   type: 'game.boss.phase' },   // 游戏 → 云
  { from: 'game',  key: 'combat.hit',   type: 'game.combat.hit' },
  { from: 'cloud', type: 'remote.notice', key: 'ui.notify' },        // 云 → 游戏
])
const claims = gc.auth.authenticate(token)                  // KI-485：Bearer 解析+过期+作用域
if (gc.auth.canAccess(claims, 'game:call')) { /* ... */ }
// KI-490：需要在线吊销/不透明令牌时，改走 introspection（判定权仍在你手里）：
// const v = await gc.auth.authorizeOnline(token, {
//   introspectionUrl: 'http://idp/oauth2/introspect', fetch: myFetch,
//   policy: 'fail-closed',   // 端点挂了默认拒；显式 'fail-open' 才降级放行并标 degraded
// })                          // → { ok, source:'local'|'introspection'|'cache', claims, reason, degraded?, cacheHit? }
//                              // 不透明 Bearer（非 JWT）有端点时穿过本地、由 IdP 裁决 sub/scope
// KI-493：给 createGameCloud 传 authCache:true 即开 introspection 结果缓存（TTL 内同令牌不再打端点）：
// const gc = createGameCloud({ authCache: true, authCacheTtlMs: 30_000, requiredScopes: [...] })
//   → 第二次同令牌 authorizeOnline 命中 { source:'cache', cacheHit:true }；失败/降级态不缓存
//   → gc.auth.cacheStats() / status().authCache 读命中率；gc.authCache 是底层 LRU+TTL 缓存实例
// KI-494：给 createGameCloud 传 net:true 即开计网可观测包，proxyCall/call 用真耗时与成败喂算法：
// const gc = createGameCloud({ net: true })
//   → 每次成功调用 ACK 一次 Reno/CUBIC 窗口、采一个 RTO 样本；失败按超时/重传统计
//   → gc.net.snapshot() / status().net 读 cwnd/ssthresh/SRTT/RTO/滑窗/HTTP 缓存/0-RTT 快照
//   → 六只状态机阈值全可逐项注入（net:{aimd:{...},rto:{...},...}），判定权仍在 Node 侧
// gc.events.publishGameEvent('game.saved', {...})           // KI-484：云侧发事件
// shutdown() 会自动退桥，不留悬挂订阅
```

- `caesura-game-event-bridge`（KI-489）**依赖注入**两只 bus（`scripts/` 永不 import 浏览器 `src/`），按 `routes`
  白名单双向转发；判定权 Node 侧——哪些事件过桥、映射成什么 type，全由 `routes` 定。
- `game.started`/`game.stopped` 由 `gc.start()/shutdown()` 自动发到云事件总线（KI-484），E2E 可证。

**灰度/金丝雀加权路由（KI-491）**——把家族里各说各话的 `Weight` predicate 与 `weight` 负载策略收口成一只决策器：

```js
const gc = createGameCloud({
  lbStrategy: 'weight',                                   // 负载策略可注入：round-robin(缺省)/random/weight
  gray: {
    canaryPercent: 10,                                    // 金丝雀流量比例（Node 侧注入，缺省 0）
    stickyHeader: 'x-player-id',                          // 会话亲和键；同 key 必落同一池（无状态哈希）
    grayField: 'version', canaryValue: 'v2',              // 精确值匹配：只把 version=v2 当金丝雀
    weightField: 'weight',                                // 池内按 metadata.weight 加权
  },
  sources: { k8s: () => [
    { id: 'v1:1', name: 'gate', address: '10.0.0.1', port: 80, metadata: { version: 'v1', weight: 9 } },
    { id: 'v2:1', name: 'gate', address: '10.0.0.2', port: 80, metadata: { version: 'v2', weight: 1 } },
  ] },
})
const r = await gc.call('gate', '/api/fight', { headers: { 'x-player-id': 'p42' } })
// r.gray = { lane:'canary'|'primary', fallback, key, bucket, canaryPercent }
```

- `spring-gateway-gray`（KI-491）**判定权全 Node 侧**：阈值/字段名/亲和键/`selector`/`rand` 全由 opts 注入；不配 `gray` 时运行时逐字维持旧的 round-robin，非破坏。
- 金丝雀池为空时**诚实回退**稳定池并标 `fallback:true`（不路由到空、也不凭空放行）；`healthy===false` 实例一律滤掉。
- `toLoadBalancerInstances` 现**保真 `metadata`**（旧版只留 healthy，灰度信息全丢）——这是 `weight` 策略与灰度分池能生效的前提。

## 5. 端到端证据

```bash
node scripts/spring-family-mesh-e2e.mjs
```

输出 JSON 一趟同时证(**KI-488** 主链扩展)：
- `registered/stoppedRegistered` —— 游戏注册进 mesh、关机干净注销（KI-473/482）；
- `services` 含 `self/eureka/k8s` 三来源（KI-479）；
- `callOk/callData` —— proxyCall 经网关+完整 filter 链+负载均衡（命中 K8s 发现的 `caesura-gate`）返回数据；
- `spanCount` —— 调用链追踪产出 span（KI-476）；
- `eventTypes` = `["game.started","game.stopped"]` —— 事件总线真收到生命周期事件（KI-484）；
- `authOK/authAllowed` —— 鉴权守卫校验带 scope 的 Bearer 放行（KI-485）；
- `retryCount` —— filter 链重试计数（KI-486/487，注入 `retryAttempts`+flaky transport 时 >0）；
- 注入 `gameBus` 时 `gameBridge` 证真游戏事件过桥、`bridgeOff` 证退桥无悬挂订阅（KI-489）；
- 注入 `onlineAuth:{introspectionUrl,fetch,policy}` 时 `auth` 证在线校验：active 放行 / inactive 短路拒调 / 端点挂 fail-open 降级放行、fail-closed 拒（KI-490）；
- 注入 `grayInstances`+`gray`+`grayProbes` 时 `grayProbes`/`grayStats` 证灰度：同 key 稳定落同一金丝雀实例（会话亲和）、阈值/精确值分池、空金丝雀池诚实回退稳定（KI-491）；
- 注入 `filters:[{Bulkhead},{TimeLimiter}]` + 挂起 transport 时 `filterStats.timedOut`/`bulkheadHeld` 证韧性 filter 真在链上触发（KI-492）；
- 注入 `authCache:true`+`onlineAuth`+`cacheProbe` 时 `cacheProbe.secondSource='cache'`/`secondCacheHit=true`、`authCacheStats` 命中读数、且 introspection 端点全程只被调一次，证 introspection 结果缓存真生效（KI-493）；
- 注入 `net:true`+`netNow` 时 `netSnapshot.observes` 证主链 proxyCall 真被观测、`aimd.cwnd>1` 证成功 ACK 喂了慢启动、`rto.srtt>0` 证真实耗时被采样，`status().net` 同步可读（KI-494）。

对应 `tests/unit/spring-family-mesh-e2e.test.ts`（14 腿）。

## 6. 边界与「不声称」

- 不声称默认就真连 Eureka/Consul/Config/K8s/Zipkin——均为内存实现，真源由注入决定。
- 不声称网关是真 Spring Cloud Gateway 在跑——predicate 由 `spring-gateway-matcher` 在 Node 侧求值。
- 不声称 span 已上报后端——只产 span 数据，上报由调用方决定。
- 不声称进程内熔断跨进程共享——每进程内存一只，按服务名隔离。
- 不声称 filter 链接了真 Resilience4j/Redis——CircuitBreaker/RateLimit 全进程内内存实现，Retry 不做幂等去重；KI-492 Bulkhead 是 JS 计数器信号量子、跨进程不共享，TimeLimiter **不取消**底层 in-flight 调用（Promise 竞速只让判词先返回，取消归调用方 transport）。
- 不声称鉴权守卫验了签——`caesura-auth-guard` 只解析 JWT claims/过期/作用域，签名校验归网关/资源服务端。
- 不声称接了真 Redis/真 IdP——KI-493 `caesura-redis-cache` 默认进程内（RESP 风格 `command` 仅教学子集），真 Redis 后端靠注入 `backend` 适配器；KI-490 在线校验的 `fetch` 可注入、默认进程内。`fail-open` 只在调用方显式选择时降级放行，缺省一律 `fail-closed`。
- 不声称 `caesura-net-stack`（KI-494）真发包或建连——六只全是纯算法状态机（无 socket），Reno/CUBIC/RTO/滑窗/0-RTT/HTTP 缓存均为 RFC 教学子集：Karn 无时间戳路径按最保守处理、选择性 ACK 不重排数据、0-RTT 只对幂等放行；缺省 α/β/C/ssthresh/TTL 只是 RFC 常见值、非真链路标定，真链路须实测调参（全可注入）。计网包默认 `net:false` 不装配，开了也只观测喂数、不反向改变 `proxyCall` 的调用结果。
- 不声称在线校验结果永久缓存——KI-493 只在配了 `authCache` 时按注入 TTL 缓存「放行/显式 negative」判词，TTL 内以旧判词为准，故 TTL 是**令牌吊销实时性 vs 端点载荷**的安全权衡、须调用方注入；`fail-open` 降级态与 `local` 判词**绝不缓存**，避免故障态被固化。缓存 key 是令牌的 FNV-1a 哈希，不落明文。
- 不声称缓存读路径用了堆/跳表——KI-493 LRU 刻意用 Map+双向链表保持 O(1) 命中/逐出，TTL 走「惰性 + 显式 O(n) 定期清扫」，`singleflight`/字节预算均每进程内存一只、不跨进程共享。
- 不声称灰度接了真流量镜像/service mesh sidecar——KI-491 `spring-gateway-gray` 纯进程内决策，transport 仍是注入的内存实现；不缓存会话状态（亲和靠 selector 确定性哈希，同 key 必落同池），阈值无服务端下发/热更（由 opts 注入）。
- 不声称事件桥 import 了浏览器 `src/`——`caesura-game-event-bridge` 依赖注入两只 duck-typed bus，永不反向依赖；默认空路由零转发，载荷原样透传不校验。
