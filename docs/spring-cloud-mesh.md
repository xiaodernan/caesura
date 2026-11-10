# CAESURA《止音纪元》— Spring Cloud 微服务网格（集大成地图）

> 本文是 CAESURA 项目里「Spring Cloud 微服务家族」的**合成地图**：把散落在 `scripts/` 的 30+ 件 Node 侧
> Spring Cloud 客户端，收口成游戏可一键拉起的一朵云。本文只描述**架构与边界**，不重复每个件的实现细节
> （细节见 `docs/KNOWN_ISSUES.md` 的 KI-460~482 账本行与各 `scripts/*.d.mts`）。

## 1. 总原则（决策原则①，贯穿全族）

- **Spring/Java 侧只做编排/重试/熔断/报告**；**判定与阈值一律由 Node 侧负责**。
- 因此每个 Node 客户端都是「编排壳 + 判定权在 Node」，不把业务阈值写死进 Spring 配置。
- `scripts/*.mjs` 必须配 `*.d.mts`（声明导出名完全一致）并通过 `decl-parity` 门；账本/PLAN/PHASE-STATUS 三者计数一致。

## 2. 分层

```
┌──────────────────────────────────────────────────────────────────────┐
│  游戏本体 (src/)                                                       │
│   └─ bridge.install(game)  —— 开机即注册 / 关机即注销（caesura-game-bootstrap）│
└───────────────────────────────┬──────────────────────────────────────┘
                                  │ createGameCloud({...}).start()
┌─────────────────────────────────▼─────────────────────────────────────┐
│  caesura-game-cloud  （开箱即用云入口，KI-478）                          │
│    start / call / proxyCall / shutdown / status                         │
├───────────────────────────────────────────────────────────────────────┤
│  caesura-cloud-runtime  （集大成运行时，KI-473/477）                     │
│    call 路径：网关 predicate 匹配 → 负载均衡选实例 → 起 span            │
│             → 遇网关 CircuitBreaker filter 用进程内熔断包一层 → transport│
│    + caesura-service-proxy（KI-474：按服务隔离的韧性调用）               │
├───────────────────────────────────────────────────────────────────────┤
│  家族客户端（Node 侧，组合进运行时）：                                  │
│   · 门面/发现   : spring-cloud-facade · spring-mesh-registry · spring-discovery · eureka · consul │
│   · 网关        : spring-gateway-route（表）· spring-gateway-matcher（KI-475 可用化求值）        │
│   · 负载/熔断   : spring-load-balancer · spring-resilience-breaker（KI-472 进程内熔断）           │
│   · 追踪        : spring-sleuth-trace（查）· spring-sleuth-tracer（KI-476 进程内造 span）         │
│   · 配置        : spring-config-client · spring-config-server · spring-config-refresh            │
│                  · caesura-config-aggregator（KI-480 多源优先级合并）                           │
│   · 安全/契约   : spring-cloud-security-oauth2 · spring-cloud-vault · spring-cloud-contract        │
│   · 任务/函数   : spring-cloud-task · spring-cloud-function · spring-cloud-stream · openfeign     │
│   · 总线/健康   : spring-bus-client · spring-health-check · spring-mesh-health                     │
│   · K8s         : spring-cloud-kubernetes-client（KI-479，configMap+endpoints→mesh 实例）         │
│   · 适配层      : caesura-mesh-adapter（游戏成为一等公民，KI-471）                                 │
└───────────────────────────────────────────────────────────────────────┘
        │                                   │
        ▼                                   ▼
  Java 侧 6 件服务（registry/config/gateway/gate/report/client）  ·  真实 Eureka/Consul/Config/K8s/Zipkin（注入才接）
```

## 3. 一次 `proxyCall` 的完整链路（KI-477 实证）

```
proxyCall('caesura-gate', '/api/health')
  └─ service-proxy: 按服务名取/建一只进程内熔断器（spring-resilience-breaker）
       └─ runtime.call:
            1. gateway.matchRoute(routes, {path})      —— 无路由 → no_route 短路
            2. mesh.aggregate() → load-balancer 选实例（Eureka/Consul/K8s/self 合并视图）
            3. tracer.startSpan + 注入 W3C traceparent 头
            4. 遇网关 CircuitBreaker filter → 用进程内熔断包一层
            5. transport(url) → 真调用（或默认走 CaesuraCloud.request 编排）
            6. tracer.finish(span) → 产出与 spring-sleuth-trace 同源的 span
```

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

## 5. 端到端证据

```bash
node scripts/spring-family-mesh-e2e.mjs
```

输出 JSON：游戏注册成功、proxyCall 经网关+负载均衡（命中 K8s 发现的 `caesura-gate`）返回数据、mesh 状态含
`self/eureka/k8s` 三来源服务、调用链追踪产出 span、关机干净注销。对应 `tests/unit/spring-family-mesh-e2e.test.ts`（5 腿）。

## 6. 边界与「不声称」

- 不声称默认就真连 Eureka/Consul/Config/K8s/Zipkin——均为内存实现，真源由注入决定。
- 不声称网关是真 Spring Cloud Gateway 在跑——predicate 由 `spring-gateway-matcher` 在 Node 侧求值。
- 不声称 span 已上报后端——只产 span 数据，上报由调用方决定。
- 不声称进程内熔断跨进程共享——每进程内存一只，按服务名隔离。
