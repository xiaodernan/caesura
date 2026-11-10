# CAESURA《止音纪元》— Spring Cloud 微服务网格（集大成地图）

> 本文是 CAESURA 项目里「Spring Cloud 微服务家族」的**合成地图**：把散落在 `scripts/` 的 35+ 件 Node 侧
> Spring Cloud 客户端，收口成游戏可一键拉起的一朵云。本文只描述**架构与边界**，不重复每个件的实现细节
> （细节见 `docs/KNOWN_ISSUES.md` 的 KI-460~499 账本行与各 `scripts/*.d.mts`）；前端只读可视化层见第 2 节顶部与第 6 节边界。

## 1. 总原则（决策原则①，贯穿全族）

- **Spring/Java 侧只做编排/重试/熔断/报告**；**判定与阈值一律由 Node 侧负责**。
- 因此每个 Node 客户端都是「编排壳 + 判定权在 Node」，不把业务阈值写死进 Spring 配置。
- **前后端协同同理（KI-495 / KI-498 贯穿收口）**：前端 `console/` 只读 Node 侧真跑落盘的快照（五场景 E2E 判词 + 与场景并列的 `systems` 二维读数），判定权仍在 Node 判词；前端只渲染、不复核、不另算一套数，缺字段诚实降级为「—」/「无数据」。
- `scripts/*.mjs` 必须配 `*.d.mts`（声明导出名完全一致）并通过 `decl-parity` 门；账本/PLAN/PHASE-STATUS 三者计数一致。

## 2. 分层

```
┌──────────────────────────────────────────────────────────────────────┐
│ 集大成控制台 (console/, KI-495/498)：零依赖静态页，只读真快照        │
│  npm run console:data ⇒ 5 场景 E2E + systems 二维 ⇒ snapshot.json    │
│  渲染 拓扑/事件流/韧性/灰度/缓存环/cwnd/计网 + LSM/硬件二维读数      │
│  file:// 直开走 bootstrap.js 回退；web 服务走 XHR 拉 snapshot.json   │
└──────────────────────────────────────────────────────────────────────┘
   ▲ 数据源：下方 E2E（第 5 节）真跑产物 snapshot.json，只读、不回写运行时
┌──────────────────────────────────────────────────────────────────────┐
│  游戏本体 (src/)                                                       │
│   └─ bridge.install(game)  —— 开机即注册 / 关机即注销（caesura-game-bootstrap）│
│   └─ gc.connectGameBus(bus, routes) —— 真 EventBus ↔ 云事件（KI-489 桥） │
└───────────────────────────────┬──────────────────────────────────────┘
                                  │ createGameCloud({...}).start()
┌─────────────────────────────────▼─────────────────────────────────────┐
│  caesura-game-cloud  （开箱即用云入口，KI-478/484/485/489/490/491/493/494/496/497/498/499）│
│    start / call / proxyCall / shutdown / status                         │
│    + events（KI-484 云事件总线）· auth（KI-485 鉴权守卫）                │
│    + connectGameBus（KI-489 事件桥，shutdown 自动退桥）                   │
│    + gray（KI-491 灰度/金丝雀加权路由；lbStrategy 可切 weight）           │
│    + net（KI-494 计网可观测包，真调用耗时/成败喂 AIMD/RTO/滑窗，opt-in）   │
│    + store（KI-496 LSM 存储引擎，结构读数挂 status.store，opt-in）          │
│    + hw（KI-497 OS/硬件适配对照，结构读数挂 status.hw，opt-in）             │
│    + hashRing（KI-499 一致性哈希环+缓存分片，挂 status.hashRing，opt-in）   │
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
│   · 存储/数据库 : caesura-lsm-store（KI-496 memtable 跳表·WAL·SSTable 稀疏索引+Bloom·leveled         │
│                  compaction；点查 vs 线性扫描对照证据，opt-in 挂 status.store）                    │
│   · OS/硬件适配 : caesura-hw-perf（KI-497 对象池降 GC 分配·cache line padding 规避 false sharing·   │
│                  AoS→SoA LRU miss 局部性对照；只给结构计数、不实测墙钟，opt-in 挂 status.hw）       │
│   · 缓存分片   : caesura-consistent-hash（KI-499 一致性哈希环）      │
│                  虚拟节点·扩容最小重映射对照；挂 status.hashRing）   │
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
// KI-496：给 createGameCloud 传 store:true（或 store:{memtableMax,levelMultiplier,...}）即开 LSM 引擎：
// const gc = createGameCloud({ store: { memtableMax: 64, levelMultiplier: 4 } })
// gc.store.put('boss:1', { hp: 100 }); gc.store.get('boss:1') // memtable 跳表→WAL→flush 成 SSTable
// gc.store.compact()                          // leveled 归并去重、深层丢 tombstone
//   → gc.store.stats() / status().store 读 flushes/compactions/mergedAway/comparisons/speedup/levels
//   → 判定权仍在 Node 侧（层数/位数/比较器/层乘数全注入）；默认 store:false 不装配、不改调用路径
// KI-497：给 createGameCloud 传 hw:true（或 hw:{poolAccesses,counterCount,cacheLineBytes,...}）即开 OS/硬件对照：
// const gc = createGameCloud({ hw: true })
//   → status().hw.snapshot() 现跑三件确定性对照：对象池分配次数 / cache line 假共享对数 / AoS→SoA LRU miss
//   → 只给结构计数（不实测墙钟/GC 暂停/真多核流量），判定权仍在 Node 侧、阈值全注入
//   → 默认 hw:false 不装配、不改调用路径；也可直接用 caesura-hw-perf 的 createObjectPool/compareLayouts
// gc.events.publishGameEvent('game.saved', {...})           // KI-484：云侧发事件
// shutdown() 会自动退桥，不留悬挂订阅
```

- `caesura-game-event-bridge`（KI-489）**依赖注入**两只 bus（`scripts/` 永不 import 浏览器 `src/`），按 `routes`
  白名单双向转发；判定权 Node 侧——哪些事件过桥、映射成什么 type，全由 `routes` 定。
- `game.started`/`game.stopped` 由 `gc.start()/shutdown()` 自动发到云事件总线（KI-484），E2E 可证。

**前端集大成控制台只读真快照（KI-495 / KI-498 贯穿收口）**——`console/` 是零框架/零 CDN/零外部依赖的静态页，与 Node 判词解耦：

```bash
npm run console:data     # 真跑 5 趟 E2E（main/gray/resilience/cache/net）+ LSM/OS 硬件二维读数 ⇒ console/snapshot.json + bootstrap.js
```

- 数据源唯一：`scripts/caesura-console-gen.mjs` 用真 `runMeshE2E` 跑五场景，把判词 normalize 成 `ConsoleScenario[]` 并 `deriveHighlights` 出八个大数；`generatedAt` 是采集时刻，拒绝手改。
- **与五场景并列的 `systems` 数据块（KI-498）**：`buildSystems(opts)` 真跑一只 `createLsmStore` 确定性 benchmark（flush/compaction/tombstone/Bloom/点查 vs 线性扫描 `speedup≈39×`）与 `createGameCloud({hw:true}).status().hw`（对象池省分配、padded vs packed 假共享对、AoS→SoA 顺序扫 `speedup≈4×`）；它是**独立数据块，不混入 `scenarios`/`highlights`/五场景 `ok` 口径**，可注入 `systems:false` 关闭（兼容旧快照与确定性单测）。
- 双载体同源：`console/snapshot.json`（web 服务经 XHR 拉取）与 `console/bootstrap.js`（`file://` 直开时同源回退）由同一次生成写出，`app.js` 二者取其一、不编造第二套数；`systems` 同样写进两份载体。
- 渲染即判词：拓扑/事件流/韧性条/灰度分池/缓存命中环/cwnd AIMD 曲线/SRTT·RTO·CUBIC·滑窗读数，以及新增的 **LSM 存储引擎面板**（speedup 仪表、flush/compact/归并/丢 tombstone/Bloom 负查、各层段数条）与 **OS 硬件适配面板**（对象池省分配、false sharing 对数、AoS→SoA 布局 speedup），全部来自真快照；缺字段降级为「—」/「无存储引擎读数」/「无硬件适配读数」，不画假条、不写假数（暗黑哥特视觉、SVG 手绘、响应式、`prefers-reduced-motion` 降级）。
- 判定权不越界：前端只渲染，不复核、不重算阈值；`caesura-console-gen` 与 `caesura-console-ui` 分别用真 E2E、`node:vm` + DOM stub 跑真 `app.js` 出可断言证据（**13 腿 + 9 腿**，KI-498 各补 3 / 2 腿，含空 `systems` 诚实降级与单维缺失不连坐）。

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
- `npm run console:data` 真跑 5 趟 E2E 落 `console/snapshot.json`+`bootstrap.js`，`console/snapshot.json` 的 `highlights` 八个大数全部由真判词 `deriveHighlights` 派生（services/spanCount/canaryHits/cacheHitRate/timedOut/cwnd/rto），`net.series` 是同一只真 AIMD 实例喂出的锯齿轨迹；`caesura-console-ui.test.ts` 用 DOM stub 在 `node:vm` 跑真 `app.js` 喂这份真快照，证每块面板都落真读数、缺字段诚实降级（KI-495）。
- **前后端协同贯穿证据（KI-498）**：`buildSystems(opts)` 真跑一只 `createLsmStore` benchmark 与 `createGameCloud({hw:true}).status().hw`，一次 `npm run console:data` 同时刷新五场景 + `systems` 二维（CLI 实测 `lsm.speedup≈39.04×` / `hw.poolSaved=1999` / `hw.layoutSpeedup=4×`）；`snapshot.json` 与 `bootstrap.js` 的 `systems` 逐字同源。`caesura-console-gen.test.ts` 13 腿（含 `buildSystems` 真判词、`systems:false` 关闭、已提交快照带真 systems 且与 bootstrap 同源）、`caesura-console-ui.test.ts` 9 腿（真读数落 LSM/HW 新面板、整块缺失与单维缺失诚实降级不连坐）。`systems` 是**与五场景并列的独立数据块、不混入** `ok`/`highlights` 判词口径。
- `node scripts/caesura-lsm-store.mjs` 一趟确定性 benchmark 证存储引擎：512 key 写入自动 flush 10 段、leveled compaction 归并去重、丢 74 个 tombstone、Bloom 负查零段探测，点查 `scanBaselineComparisons/lsmComparisons` 对照得 `speedup≈39×`；`caesura-lsm-store.test.ts` 20 腿钉住跳表有序/概率层数、Bloom 零假阴性+假阳性有界、WAL 重放、SSTable 稀疏索引、`tombstone` 不复活旧版本、与线性扫描对照读数；`createGameCloud({store:{...}})` 装配证 `status().store` 结构读数可见（KI-496）。

- `node scripts/caesura-hw-perf.mjs` 一趟确定性对照证 OS/硬件适配：对象池 10000 次取还只 `new` 1 次（省 9999 次 GC 分配）、padded 假共享对 0 vs packed 7（空间开销 8×）、顺序扫 AoS 5000 miss vs SoA 1250 miss（`speedup≈4×`）、跳跃扫 stride16 两者都 625 miss（红利消失）；`caesura-hw-perf.test.ts` 16 腿钉住对象池复用/限额丢弃、cache line 跨行隔离、LRU 容量 2 行经典换页、AoS/SoA 顺序加速与跳跃退化、注入确定性；`createGameCloud({hw:true})` 装配证 `status().hw` 三件读数可见（KI-497）。

- **一致性哈希 / 缓存分片证据（KI-499）**：`npm run hash:bench` 一趟确定性对照证扩缩容——3→4 节点扩容时一致性哈希只迁 `consistentRate≈0.272`（理论下界 0.25），朴素取模迁 `moduloRate≈0.5155`（≈N/(N+1)），省下约 0.24 的键重映射；缩容 `delta=-1` 对照同样 `consistentRate<moduloRate`；三节点分布 `balanceRatio≈1.28`（虚拟节点环把 key 铺得接近均分）。`caesura-consistent-hash.test.ts` 14 腿钉住环点有序/二分查找、增删节点最小迁移、加权 3:1≈0.75:0.25、均匀度随虚拟节点数单调改善（8→128→512 的 balanceRatio 递减）、弱哈希+少虚拟节点偏斜更大（`balanceRatio` 如实暴露）、同 key 恒落同分片同槽、空环 null 不造节点、注入确定性；`createGameCloud({hashRing:true})` 装配证 `status().hashRing` 环快照与扩容对照读数可见（惰性缓存不反复跑 benchmark）、`spring-family-mesh-e2e` 的 `hashRingSnapshot` 证主链非破坏，`hashRing:false` 缺省不改任何调用路径。

对应 `tests/unit/spring-family-mesh-e2e.test.ts`（15 腿）；前端证据另见 `tests/unit/caesura-console-gen.test.ts`（13 腿）与 `tests/unit/caesura-console-ui.test.ts`（9 腿）；存储引擎证据见 `tests/unit/caesura-lsm-store.test.ts`（20 腿）、OS/硬件适配见 `tests/unit/caesura-hw-perf.test.ts`（16 腿）、一致性哈希见 `tests/unit/caesura-consistent-hash.test.ts`（14 腿），三者连同缓存/计网在 `tests/unit/caesura-game-cloud.test.ts`（15 腿，KI-493~499 opt-in 装配）证装配。

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
- 不声称接了真 RocksDB/LevelDB/SQLite——KI-496 `caesura-lsm-store` 是纯教学状态机：无真实文件 I/O/页缓存/块设备对齐，`sink` 只模拟落盘；也不声称比 B+ 树全面更优（LSM 以读放大换顺序写、范围查用收集排序非归并堆迭代，缺省参数仅教学值、真库须实测调参）。Bloom filter 只保证零假阴性、不保证零假阳性；compaction 纯进程内单线程、不并发安全、不跨进程共享。默认 `store:false` 不装配，开了也只挂 `status.store` 结构读数、不反向改变任何调用结果。
- 不声称 KI-497 `caesura-hw-perf` 实测了性能——三件全是**结构性/确定性计数对照**，不是跑分：对象池只给「分配次数」省了多少（不是 GC 暂停时长/吞吐）、padding 只给「槽位是否落同一 cache line」的结构判词（不是真多核 coherence 流量/时钟周期）、SoA 只给「确定性 LRU 模型下的 miss 数」（不是真 CPU cache 命中率，模型是 JS Map 插入序近似 LRU、无组相联/替换策略/硬件预取）。真实收益取决于硬件/并发模式/数据规模，须实测调参；不声称对象池线程安全或自动归还（`release` 靠调用方配对、泄漏与重复归还没运行时防护）。默认 `hw:false` 不装配，开了也只挂 `status.hw` 结构读数、不反向改变任何调用结果。
- 不声称 KI-499 `caesura-consistent-hash` 是真 Redis Cluster / 生产一致性哈希——它是**路由判定与迁移计数的教学状态机**：无副本、无虚拟节点持久化、无故障转移、无数据搬迁执行（扩缩容只报「哪些 key 会迁」、不真搬数据，也不缓存命中率/网络带宽）；一致性哈希与缓存分片路由**默认不参与**负载均衡——`hashRing:false` 缺省不装配，接进 `createGameCloud` 也只挂 `status.hashRing` 结构读数，LB 三策略与 KI-491 灰度路由语义逐字不动、不反向改变任何调用结果。重映射率 / `balanceRatio` 是**结构计数比**、非墙钟时间/GC/带宽实测，真实收益取决于 key 集/节点规模/哈希分布，须实测调参；缺省 `ringHash`（FNV-1a+雪崩终混）是教学哈希非加密级，虚拟节点数/权重/哈希函数全可注入。也不声称虚拟节点分布对所有 key 集完美均匀——`distribution().balanceRatio` 如实给出有限样本下的偏差，注入纯 `fnv1a` 或少量虚拟节点即可复现偏斜（这条偏差本身是判词）；加权节点按虚拟点倍数近似分量、非精确配额。
- 不声称灰度接了真流量镜像/service mesh sidecar——KI-491 `spring-gateway-gray` 纯进程内决策，transport 仍是注入的内存实现；不缓存会话状态（亲和靠 selector 确定性哈希，同 key 必落同池），阈值无服务端下发/热更（由 opts 注入）。
- 不声称事件桥 import 了浏览器 `src/`——`caesura-game-event-bridge` 依赖注入两只 duck-typed bus，永不反向依赖；默认空路由零转发，载荷原样透传不校验。
- 不声称前端控制台是实时流/推送——KI-495 `console/` 只读 `npm run console:data` 落盘的**一次性离线快照**，`snapshot.json`（XHR）与 `bootstrap.js`（`file://` 回退）同源；无 WebSocket/SSE、无定时轮询、无后端写入、无交互命令下发（纯只读可视化），要刷新须重跑生成器。
- 不声称前端视觉是像素级截图验证——KI-495 UI 证据是 `node:vm` + DOM stub 跑真 `app.js` 证「每块面板落真读数 + 缺字段降级 + 零外部依赖」的可断言烟测，非浏览器渲染截图；`styles.css` 内联 grain SVG 的 `xmlns` 是命名空间常量、非网络请求。前端不持有判定权与阈值，所有读数是 Node 判词派生，不复核、不重算。
- 不声称 KI-498 的 `systems` 是实时推送、墙钟跑分或游戏运行时 HUD——它仍是 `npm run console:data` 一次性离线采集的**独立只读数据块**，无 WebSocket/SSE、无后端写入、刷新须重跑生成器；`lsm.speedup` 是「点查比较数 ÷ 线性扫描比较数」的**算法计数比**、`hw` 三件是对象池分配次数 / cache line 同行对数 / LRU 模型 miss 数（边界逐字继承 KI-496/497），**非墙钟时间 / GC 暂停 / 真 CPU cache 命中率**，真实收益须实测调参；`systems` 不参与五场景 `ok` 判定与 `highlights` 派生、不混入 E2E 判词口径；`console/` 是独立静态页、不进 vite 主包。
