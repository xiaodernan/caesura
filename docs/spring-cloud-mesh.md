# CAESURA《止音纪元》— Spring Cloud 微服务网格（集大成地图）

> 本文是 CAESURA 项目里「Spring Cloud 微服务家族」的**合成地图**：把散落在 `scripts/` 的 35+ 件 Node 侧
> Spring Cloud 客户端，收口成游戏可一键拉起的一朵云。本文只描述**架构与边界**，不重复每个件的实现细节
> （细节见 `docs/KNOWN_ISSUES.md` 的 KI-460~508 账本行与各 `scripts/*.d.mts`）；前端只读可视化层见第 2 节顶部与第 6 节边界。

## 1. 总原则（决策原则①，贯穿全族）

- **Spring/Java 侧只做编排/重试/熔断/报告**；**判定与阈值一律由 Node 侧负责**。
- 因此每个 Node 客户端都是「编排壳 + 判定权在 Node」，不把业务阈值写死进 Spring 配置。
- **前后端协同同理（KI-495 / KI-498 / KI-501 / KI-502 / KI-503 / KI-504 / KI-505 / KI-506 / KI-507 / KI-508 贯穿收口）**：前端 `console/` 只读 Node 侧真跑落盘的快照（五场景 E2E 判词 + 与场景并列的 `systems` 十维读数：LSM 存储引擎 / OS 硬件适配 / 缓存防护三件套 / 网关限流算法族 / 服务故障检测器 / B+ 树索引引擎 / 事务与并发控制 / 分布式事务 / Raft 共识 / 分布式锁与租约），判定权仍在 Node 判词；前端只渲染、不复核、不另算一套数，缺字段诚实降级为「—」/「无数据」。
- `scripts/*.mjs` 必须配 `*.d.mts`（声明导出名完全一致）并通过 `decl-parity` 门；账本/PLAN/PHASE-STATUS 三者计数一致。

## 2. 分层

```
┌──────────────────────────────────────────────────────────────────────┐
│ 集大成控制台 (console/, KI-495/498/501/502/503/504/505/506/507)：零依赖只读真快照 │
│  npm run console:data ⇒ 5 场景 E2E + systems 十维 ⇒ snapshot.json    │
│  渲染 拓扑/事件流/韧性/灰度/缓存环/cwnd/计网                         │
│  + LSM/硬件/缓存防护/限流/故障检测(φ+SWIM)/B+树/事务(MVCC)/分布式事务/Raft 共识/分布式锁 十维 │
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
│  caesura-game-cloud  （开箱即用云入口，KI-478/484/485/489/490/491/493/494/496/497/498/499/500/501/502/503/504/507/508）│
│    start / call / proxyCall / shutdown / status                         │
│    + events（KI-484 云事件总线）· auth（KI-485 鉴权守卫）                │
│    + connectGameBus（KI-489 事件桥，shutdown 自动退桥）                   │
│    + gray（KI-491 灰度/金丝雀加权路由；lbStrategy 可切 weight）           │
│    + net（KI-494 计网可观测包，真调用耗时/成败喂 AIMD/RTO/滑窗，opt-in）   │
│    + store（KI-496 LSM 存储引擎，结构读数挂 status.store，opt-in）          │
│    + hw（KI-497 OS/硬件适配对照，结构读数挂 status.hw，opt-in）             │
│    + hashRing（KI-499 一致性哈希环+缓存分片，挂 status.hashRing，opt-in）   │
│    + shardedCache（KI-500 分片缓存客户端，挂 status.shardedCache，opt-in）  │
│    + cacheGuard（KI-501 击穿/穿透/雪崩防护对照，挂 status.cacheGuard，opt-in）│
│    + rateLimit（KI-502 限流五算法 + Redis 原子桶，挂 status.rateLimit，opt-in）│
│    + failureDetector（KI-503 φ 检测 + SWIM 三态 + 健康视图，opt-in）           │
│    + bplusIndex（KI-504 B+ 树 vs LSM 点查/范围/写放大三笔账，opt-in）        │
│    + mvccTxn（KI-505 MVCC 可见性 + 五档隔离异常矩阵 + 2PL 死锁，opt-in）     │
│    + distributedTxn（KI-506 2PC 阻塞/Saga 留脏/TCC 幂等三协议权衡，opt-in）  │
│    + raftConsensus（KI-507 Raft 单leader/多主/Gossip 三协议权衡，opt-in）       │
│    + distributedLock（KI-508 SETNX/Redlock/etcd Lease+Fencing 三协议权衡，opt-in） │
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
│   · 分片缓存   : caesura-sharded-cache（KI-500 环+LRU+TTL 咬合）     │
│                  扩缩容命中率保留率对照；挂 status.shardedCache）    │
│   · 缓存防护   : caesura-cache-guard（KI-501 击穿/穿透/雪崩）         │
│                  击穿 singleflight+逻辑过期 / 穿透 布隆+空值墓碑 /   │
│                  雪崩 TTL 抖动削峰；复用 KI-493/496，挂 status.cacheGuard │
│   · 网关限流   : caesura-rate-limiter（KI-502 五算法突发对照）——      │
│                  固定窗口 2× 翻边突发 / 滑动日志 O(n) / 滑动计数 O(1) /│
│                  令牌桶受控突发 / 漏桶恒定整形 + Redis 原子桶（复用    │
│                  KI-493、原子 vs 非原子超发、跨实例共享），挂 status.rateLimit │
│   · 故障检测   : caesura-failure-detector（KI-503）——                          │
│                  φ 累积风险(Welford+erfc 自适应) / SWIM 三态间接探测反证       │
│                  / 健康视图 TTL 缓存 / 固定超时 vs φ 权衡对照，opt-in 挂 status│
│   · 索引/数据库 : caesura-bplus-tree（KI-504）——                                  │
│                  真 B+ 树(阶数可控扇出决定层高·叶双向链范围顺序扫·分裂/删除再     │
│                  平衡 borrow+merge) vs LSM 三笔账(点查比较/范围归并/写放大)，     │
│                  逐条对账+不封全局赢家，opt-in 挂 status.bplusIndex               │
│   · 事务/并发   : caesura-mvcc-txn（KI-505）——                                     │
│                  MVCC 多版本可见性·水位 gc / 五档隔离(RU~SER)×五类异常矩阵        │
│                  / S/X 行锁 2PL / wait-for graph DFS 死锁，SI 漏写偏斜不封赢家      │
│   · 分布式事务  : caesura-distributed-txn（KI-506）——                                │
│                  2PC prepare 全员投票/全 yes 提交/协调者宕机⇒阻塞 / Saga 逆序补偿    │
│                  / TCC Try·Confirm·Cancel 幂等，六场景三难向量不封赢家              │
│   · Raft 共识    : caesura-raft-consensus（KI-507）——                                  │
│   · 分布式锁     : caesura-distributed-lock（KI-508）——                                 │
│                  Raft term单调/随机超时破平票/quorum/Leader Completeness/脑裂只读      │
│                  / 多主并发冲突+复制读陈 / Gossip 反熵间隙不收敛，三难向量不封赢家     │
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

**前端集大成控制台只读真快照（KI-495 / KI-498 / KI-501 / KI-502 / KI-503 / KI-504 / KI-505 / KI-506 / KI-507 / KI-508 贯穿收口）**——`console/` 是零框架/零 CDN/零外部依赖的静态页，与 Node 判词解耦：

```bash
npm run console:data     # 真跑 5 趟 E2E（main/gray/resilience/cache/net）+ systems 十维读数（LSM/OS 硬件/缓存防护/网关限流/故障检测/B+ 树索引/事务并发控制/分布式事务/Raft 共识/分布式锁）⇒ console/snapshot.json + bootstrap.js
```

- 数据源唯一：`scripts/caesura-console-gen.mjs` 用真 `runMeshE2E` 跑五场景，把判词 normalize 成 `ConsoleScenario[]` 并 `deriveHighlights` 出八个大数；`generatedAt` 是采集时刻，拒绝手改。
- **与五场景并列的 `systems` 数据块（KI-498）**：`buildSystems(opts)` 真跑一只 `createLsmStore` 确定性 benchmark（flush/compaction/tombstone/Bloom/点查 vs 线性扫描 `speedup≈39×`）与 `createGameCloud({hw:true}).status().hw`（对象池省分配、padded vs packed 假共享对、AoS→SoA 顺序扫 `speedup≈4×`）；它是**独立数据块，不混入 `scenarios`/`highlights`/五场景 `ok` 口径**，可注入 `systems:false` 关闭（兼容旧快照与确定性单测）；后续 KI-501/502/503/504/505/506/507 相继并入 `guards`/`rateLimit`/`failureDetector`/`bplusIndex`/`mvccTxn`/`distributedTxn`/`raftConsensus`/`distributedLock` 七维，现为十维，各自的 `*:false` 可单维关闭、不连坐其它维。
- 双载体同源：`console/snapshot.json`（web 服务经 XHR 拉取）与 `console/bootstrap.js`（`file://` 直开时同源回退）由同一次生成写出，`app.js` 二者取其一、不编造第二套数；`systems` 同样写进两份载体。
- 渲染即判词：拓扑/事件流/韧性条/灰度分池/缓存命中环/cwnd AIMD 曲线/SRTT·RTO·CUBIC·滑窗读数，以及 `systems` 七维独立读数——**LSM 存储引擎面板**（speedup 仪表、flush/compact/归并/丢 tombstone/Bloom 负查、各层段数条）、**OS 硬件适配面板**（对象池省分配、false sharing 对数、AoS→SoA 布局 speedup）、**缓存防护三面板**（击穿放大条、穿透回源对照条、雪崩双直方图）、**网关限流两面板**（五算法 burstRatio 横条：1× 玉 / 2× 酒红，Redis 原子 vs 非原子放行条 + 超发大数 + 跨实例共享 dot）、**服务故障检测两面板**（固定超时 vs φ 抖动误报大数 + φ 曲线 SVG 真折线/判死阈值虚线/固定超时误报点、同延迟规律 vs 抖动自适应双条、SWIM 三态成员条、健康视图 TTL 命中三段）、**B+ 树索引两面板**（实测层高+稳态估+扇出+叶数+不变式 0 违例、阶数→层高阶梯条；点查比较/范围结构代价/写放大三组双侧真计数对照条按 favors 上色、不封全局赢家、同批 key 答案逐条对账 dot）、**事务并发控制两面板**（五档隔离×五类异常热力矩阵按挡住染玉/漏掉染酒红 + 各档中止数 chip + 不封 Serializable 全局赢家 dot；wait-for graph 死锁环节点链+牺牲者+无环探针+2PL 违规 + 长事务/无长事务 gc 水位双卡）、**分布式事务两面板**（三协议×六场景矩阵格：成/止/阻/脏按真判词上色 + 侵入度真读数 + 消息数横条对照；三难不可兼得向量逐格玉=占/酒红=缺 + 2PC 阻塞/Saga 留脏/TCC 幂等重试探针 + 不封任何协议赢家 dot），全部来自真快照；缺字段降级为「—」/「无存储引擎读数」/「无硬件适配读数」/「无击穿读数」/「无限流算法读数」/「无故障检测读数」/「无 B+ 树结构读数」/「无隔离异常矩阵读数」/「无死锁检测读数」/「无 gc 水位读数」/「无三协议场景矩阵读数」/「无三难判据读数」，单块缺不连坐其它块，不画假条、不写假数（暗黑哥特视觉、SVG 手绘、响应式、`prefers-reduced-motion` 降级）。
- 判定权不越界：前端只渲染，不复核、不重算阈值；`caesura-console-gen` 与 `caesura-console-ui` 分别用真 E2E、`node:vm` + DOM stub 跑真 `app.js` 出可断言证据（**13 腿 + 9 腿**，KI-498 各补 3 / 2 腿，含空 `systems` 诚实降级与单维缺失不连坐；演进：KI-501 加 `systems.guards` 三面板、KI-502 加 `systems.rateLimit` 两面板、KI-503 加 `systems.failureDetector` 两面板、KI-504 加 `systems.bplusIndex` 两面板、KI-505 加 `systems.mvccTxn` 两面板、KI-506 加 `systems.distributedTxn` 两面板、KI-507 加 `systems.raftConsensus` 两面板、KI-508 加 `systems.distributedLock` 两面板，现为十维、前端 **17 腿 + 25 腿**，此处保留 KI-498 当初的历史腿数不改写）。

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
- **前后端协同贯穿证据（KI-498）**：`buildSystems(opts)` 真跑一只 `createLsmStore` benchmark 与 `createGameCloud({hw:true}).status().hw`，一次 `npm run console:data` 同时刷新五场景 + `systems` 二维（CLI 实测 `lsm.speedup≈39.04×` / `hw.poolSaved=1999` / `hw.layoutSpeedup=4×`）；`snapshot.json` 与 `bootstrap.js` 的 `systems` 逐字同源。`caesura-console-gen.test.ts` 13 腿（含 `buildSystems` 真判词、`systems:false` 关闭、已提交快照带真 systems 且与 bootstrap 同源）、`caesura-console-ui.test.ts` 9 腿（真读数落 LSM/HW 新面板、整块缺失与单维缺失诚实降级不连坐）。`systems` 是**与五场景并列的独立数据块、不混入** `ok`/`highlights` 判词口径。（演进：本段是 KI-498 当初落地时的二维读数与 13+9 腿证据；后续 KI-501 加 `systems.guards`「缓存防护」、KI-502 加 `systems.rateLimit`「网关限流」，现为四维、前端 13+13 腿，见本节末两段与第 244 行腿数汇总；此处保留历史读数不改写。）
- `node scripts/caesura-lsm-store.mjs` 一趟确定性 benchmark 证存储引擎：512 key 写入自动 flush 10 段、leveled compaction 归并去重、丢 74 个 tombstone、Bloom 负查零段探测，点查 `scanBaselineComparisons/lsmComparisons` 对照得 `speedup≈39×`；`caesura-lsm-store.test.ts` 20 腿钉住跳表有序/概率层数、Bloom 零假阴性+假阳性有界、WAL 重放、SSTable 稀疏索引、`tombstone` 不复活旧版本、与线性扫描对照读数；`createGameCloud({store:{...}})` 装配证 `status().store` 结构读数可见（KI-496）。

- `node scripts/caesura-hw-perf.mjs` 一趟确定性对照证 OS/硬件适配：对象池 10000 次取还只 `new` 1 次（省 9999 次 GC 分配）、padded 假共享对 0 vs packed 7（空间开销 8×）、顺序扫 AoS 5000 miss vs SoA 1250 miss（`speedup≈4×`）、跳跃扫 stride16 两者都 625 miss（红利消失）；`caesura-hw-perf.test.ts` 16 腿钉住对象池复用/限额丢弃、cache line 跨行隔离、LRU 容量 2 行经典换页、AoS/SoA 顺序加速与跳跃退化、注入确定性；`createGameCloud({hw:true})` 装配证 `status().hw` 三件读数可见（KI-497）。

- **一致性哈希 / 缓存分片证据（KI-499）**：`npm run hash:bench` 一趟确定性对照证扩缩容——3→4 节点扩容时一致性哈希只迁 `consistentRate≈0.272`（理论下界 0.25），朴素取模迁 `moduloRate≈0.5155`（≈N/(N+1)），省下约 0.24 的键重映射；缩容 `delta=-1` 对照同样 `consistentRate<moduloRate`；三节点分布 `balanceRatio≈1.28`（虚拟节点环把 key 铺得接近均分）。`caesura-consistent-hash.test.ts` 14 腿钉住环点有序/二分查找、增删节点最小迁移、加权 3:1≈0.75:0.25、均匀度随虚拟节点数单调改善（8→128→512 的 balanceRatio 递减）、弱哈希+少虚拟节点偏斜更大（`balanceRatio` 如实暴露）、同 key 恒落同分片同槽、空环 null 不造节点、注入确定性；`createGameCloud({hashRing:true})` 装配证 `status().hashRing` 环快照与扩容对照读数可见（惰性缓存不反复跑 benchmark）、`spring-family-mesh-e2e` 的 `hashRingSnapshot` 证主链非破坏，`hashRing:false` 缺省不改任何调用路径。

- **分片缓存客户端 / 命中率保留率证据（KI-500）**：`npm run cache:bench` 一趟确定性对照把 KI-493 缓存与 KI-499 环咬合——预热 1 万 key 到三片真 `createRedisCache`（各片 3111/3478/3411 条），扩到 4 片时**一致性哈希分片保住 `consistentRetention≈0.7533`（理论 N/(N+1)=0.75），朴素取模只保住 `moduloRetention≈0.4853`**，省下 0.268 的缓存命中；缩容 `delta=-1` 为 0.6589 vs 0.4897。真缓存 `remapOn` 只按**失效计数**不搬数据（retained 7533 / invalidated 2467），其保留率与 `compareHitRetention` **逐字一致**——与 KI-499 `compareRemapping` 互为镜像（那边数迁移键、这边数缓存存活）。`caesura-sharded-cache.test.ts` 13 腿钉住同 key 恒落同片、每片真缓存读写、片内 `load` singleflight 只调一次、注入 `now` 透传使 TTL 确定性过期、扩缩容 `remapOn` 失效/保留记账与 added/removed、保留率趋理论且取模更差、镜像 KI-499、快照纯数据、空集降级不 NaN、注入确定性；`createGameCloud({shardedCache:true})` 装配证 `status().shardedCache` 只读环快照 + 保留率对照（惰性缓存不反复预热）、`spring-family-mesh-e2e` 的 `shardedCacheSnapshot` 证主链非破坏，`shardedCache:false` 缺省不改任何调用路径。

- **缓存防护三件套 / 前后端协同贯穿证据（KI-501）**：`npm run guard:bench` 一趟确定性对照证三大故障——①**击穿**：64 路并发 miss 同一热点 key，无防护把 loader 打 **64 次**、`singleflight`（复用 KI-493 `createRedisCache.load`）合并成 **1 次**（放大 64×、省 63 次），XFetch 逻辑过期另提前续期挤掉 26 个并发回源；②**穿透**：512 key 中 256 个不存在，`rounds=4` 下无防护 **1024 次**回源 → 空值墓碑（复用 KI-493）只首轮 **256 次**、布隆前置（复用 KI-496 `createBloomFilter`）挡掉 246 个、只放行 **10 次**（省 99.02%），**如实暴露 10 个假阳性**（不零误判）；③**雪崩**：512 key 统一 TTL 全挤 1 个过期桶（单桶峰值 **512**），TTL 抖动后摊到 8 桶、峰值降 **72**（削峰 85.94%），抖动只挪时刻不减少总过期数。`caesura-cache-guard.test.ts` 15 腿钉住 singleflight 真合并/注入 loader 计数/空集降级、XFetch 判据单调、穿透三路口径/布隆零假阴性+假阳性如实、雪崩削峰/直方图守恒/jitter=0 退化、汇总确定性/快照纯数据/复用真件。`createGameCloud({cacheGuard:true})` 装配证 `status().cacheGuard` 三件读数可见（惰性缓存不反复跑对照）、`spring-family-mesh-e2e` 的 `cacheGuardSnapshot` 证主链非破坏，`cacheGuard:false` 缺省不改任何调用路径。**前端贯穿**：`buildSystems` 增顶层 `systems.guards`（与 `lsm`/`hw` 平级、**不混入** `ok`/`highlights`，可 `guards:false` 关、缺则 null 降级），`console/` 加「击穿 / 穿透 / 雪崩」三面板读真值渲染（放大条 / 回源对照条 / 双直方图）、缺字段诚实降级不连坐，快照与 `bootstrap.js` 同源；CLI 实测 `stampede 32→1 / 布隆省 99% / 削峰 86%`。判定权全 Node 侧、前端只渲染不复核。
- **网关限流算法族 / Redis 原子令牌桶证据（KI-502）**：`npm run ratelimit:bench` 一趟确定性对照把「为什么限流必须选对算法 + 为什么 Redis 令牌桶要用 Lua 原子」钉死。①**五算法同一条窗口翻边突发轨迹**（24 请求：`t=999×8 → t=1000×8 → t=2000×8`，配额 8 / 窗 1000ms）：**固定窗口**按墙钟整窗对齐，翻边前后两批仅差 1ms 却落两个自然窗、全部放行 ⇒ 任意 1 窗内最多 **16 条 = 2× 配额**（`burstRatio=2`）；**滑动日志**（精确 O(n) 内存）、**滑动计数**（前窗加权 O(1) 近似）、**令牌桶**（capacity 受控突发）、**漏桶**（恒定速率整形）都把突发压在 **8 条 = 1×**（`burstRatio=1`）——「加防护就少放」不是笼统口号，而是能逐算法量出的放大倍数差。②**Redis 令牌桶原子性**：复用 KI-493 `createRedisCache.command()` 存桶状态、`now` 作命令参数传入（对齐 Spring `RedisRateLimiter` 把时间戳交给 Lua、不用 Redis 服务器时钟）；64 路并发下**原子路径**（读-补-判-写零 await 的同步段、等价 Lua 串行）恰好放行 **8 条 = capacity（不超发）**，**非原子路径**（GET 后 `await` 让出、N 路都读到同一满桶再写回 ⇒ 丢失更新）放行 **64 条（超发 56）**；两实例共享同 backend + key 见剩余一致（5/5），证跨实例共享。`caesura-rate-limiter.test.ts` 16 腿钉住五算法各自语义（固定窗口翻边 / 滑动日志精确裁剪与 cost / 滑动计数跨窗加权近似量出偏差 / 令牌桶 refill 与速率 0 拒绝给 null / 漏桶恒定漏与 retry 计算）、默认突发轨迹、五句判词、自定义轨迹注入、Redis 原子 vs 非原子超发、跨实例共享、汇总纯数据可 JSON 往返。`createGameCloud({rateLimit:true})` 装配证 `status().rateLimit` 四维读数可见（惰性缓存不反复跑对照）、`spring-family-mesh-e2e` 的 `rateLimitSnapshot` 证主链非破坏，`rateLimit:false` 缺省不改任何调用路径。**前端贯穿**：`buildSystems` 增顶层 `systems.rateLimit`（与 `lsm`/`hw`/`guards` 平级、**不混入** `ok`/`highlights`，可 `rateLimit:false` 关、缺则 null 降级），`console/` 加「五算法突发放大 + Redis 原子性」两面板读真值渲染（burstRatio 横条：1× 玉 / 2× 酒红、超发大数 + 原子/非原子对照条 + 跨实例共享 dot）、缺字段诚实降级不连坐，快照与 `bootstrap.js` 同源；CLI 实测 `fixedWindow ×2 / sliding ×1 / Redis 原子 8 vs 非原子 64（超发 56）`。判定权全 Node 侧、前端只渲染不复核；与 KI-486 `RateLimit` handler 互补、不改动其语义。

- **服务故障检测器 / φ 累积风险 + SWIM 三态 + 健康视图证据（KI-503）**：`npm run detect:bench` 一趟确定性对照补上「注册发现之后如何判定实例已死」这块判定链。①**固定超时 vs φ**：同一条含 3 次 GC 长暂停（420ms）+ 一次真故障的确定性心跳轨迹，固定超时（250ms）在抖动期**误剔除 3 次**、真故障 **260ms** 检出；φ 累积风险（定长 `Float64Array` 环形缓冲 + Welford 在线重算 μ/σ + erfc 近似算 `φ=−log10(P(间隔>距上次心跳))`）抖动期**零误报**、真故障 **690ms** 检出——**如实保留「固定更快但更吵 / φ 保守降误报但检测更慢」的真实权衡**，不粉饰 φ 全面更优；②**自适应**：同一段 260ms 延迟喂给规律历史（σ≈0、被可容忍暂停下限钳到 150）得 `φ≈0.84`、喂给本就抖动的历史（σ≈185）得 `φ≈0.36`，证「同延迟在看上下文的 φ 下判词不同」而固定超时做不到；③**SWIM 三态**：直接 ping 失败 → 请 2 个中继间接探测，gate-b 由中继 r2 代 ping 成功**反证存活**（间接救回 1 次、不误标 suspected）、gate-c 全失败标 suspected 且撑过 `3×1000=3000ms` 疑超时被 `reap` 确认死亡（faulty 1）、gate-d 的 suspicion 被更高 incarnation 的 alive gossip 覆盖（旧 gossip 覆盖不了新反证）；④**健康视图缓存**：把 φ 判定与 SWIM alive 收敛成健康实例列表（`gate-a/gate-b/gate-d`，剔除 faulty 的 `gate-c`），TTL 内二次读命中缓存、主动 `invalidate` 后重算。`caesura-failure-detector.test.ts` 14 腿钉住 erfc 数学（erfc(0)=1/对称/单调/Q(0)=0.5）、样本不足不定罪、φ 单调越阈、σ 下限防爆炸、环形缓冲有界与覆盖最旧、Welford 数值稳定与注入确定性、SWIM 直接+间接救回+reap+gossip 反证+incarnation 单调、健康视图 TTL 命中与失效、六句判词、study 纯数据可 JSON 往返。`createGameCloud({failureDetector:true})` 装配证 `status().failureDetector` 五维读数可见（惰性缓存不反复跑对照）、`spring-family-mesh-e2e` 的 `failureDetectorSnapshot` 证主链非破坏，`failureDetector:false` 缺省不改任何调用路径。**前端贯穿**：`buildSystems` 增顶层 `systems.failureDetector`（与 `lsm`/`hw`/`guards`/`rateLimit` 平级、**不混入** `ok`/`highlights`，可 `failureDetector:false` 关、缺则 null 降级），`console/` 加「固定 vs φ」+「SWIM 三态」两面板读真值渲染（φ 曲线 SVG 真折线 + 判死阈值虚线 + 固定超时误报点、同延迟规律/抖动自适应双条、三态成员条与健康视图 TTL 命中三段）、缺字段诚实降级不连坐，快照与 `bootstrap.js` 同源；CLI 实测 `抖动误报 固定 3 vs φ 0 / 真故障 260ms vs 690ms / SWIM 间接救回 1`。判定权全 Node 侧、前端只渲染不复核；不接真 Cassandra/Consul、正态假设是教学简化、非墙钟跑分。

- **B+ 树索引引擎 / 与 LSM 点查·范围查·写放大诚实对照证据（KI-504）**：`npm run bplus:bench` 一趟确定性对照，把 KI-496 注释里反复「拿 B+ 树当对照系」那段**纸面声称**第一次兑现成一株真 B+ 树。①**真 B+ 树骨架**：阶数可控（扇出=order，奇数取偶/强制≥4，因奇数无法把满节点均分两株）、数据只住叶子且叶子**双向链**串起、内节点只存分隔键+child 指针；512 key 实测长成 **3 层 / 32 叶 / 35 节点**（`heightEstimate` 按 mid 分裂半填充稳态估也 3 层，两者并排不混谈），`heightLadder` 证扇出 4→层高 6、128→层高 2 单调不增。写入含自顶向下**分裂**、删除含自底向上 `borrow`+`merge`+根降高（400 key 交错删 300 条实测 merges/borrows 均 >0、根 6→5 层、删空回 1 层），`validate()` 逐条钉住「所有叶同深 / 分隔键=右孩子最小 key 副本 / 节点填充上下界 / 叶链双向 / 全局严格递增 / 叶 key 总数=size」——**不变式违例 0**，是树不是数组冒充。②**三笔账对照**（同一批 512 key 分灌 B+ 树与 `createLsmStore`，先决条件 `agreement.bothAgree=true` 证两引擎 get/range 逐条一致、答案分叉则性能读数不作数）：**点查比较数** B+ 776 vs LSM 1158（B+ 层高二分 vs LSM memtable 跳表+多层 SSTable 稀疏索引+Bloom 负查，`pointFavors=bplus`）；**范围查结构代价** B+ 360（=定位比较+叶链跳 10、结果天然有序零排序）vs LSM 1649（跨段收集 512 条 + 全量排序 1137 比较，KI-496 明写「收集排序非归并堆」，`rangeFavors=bplus`）；**写放大模型** B+ `pageRewrites=616`（原地改页重排：552 put + 2×32 分裂）vs LSM `seqWriteUnits=603`（顺序追加 WAL 552 条 + 9 flush + 2 compaction + 归并掉 40 旧版本，`writeFavors=lsm`）——判词**不封全局赢家**（`noUniversalWinner=true`），如实保留「B+ 点查/范围查稳但写原地改页、LSM 顺序写适配 SSD 但读跨层/范围全量归并/compaction 重复搬运」这组真实取舍（同 KI-497/503 诚实立场）。`caesura-bplus-tree.test.ts` 16 腿钉住有序不变式/点查二分/叶链范围查/分裂长高/删除 borrow+merge+降高/覆盖与重复删/与 LSM 逐条对账/三笔账各有真读数/六句判词可证伪/注入确定性/study+snapshot 纯数据/空集降级。`createGameCloud({bplusIndex:true})` 装配证 `status().bplusIndex` 六维读数可见（惰性缓存不反复跑对照）、`spring-family-mesh-e2e` 的 `bplusIndexSnapshot` 证主链非破坏，`bplusIndex:false` 缺省不改任何调用路径。**前端贯穿**：`buildSystems` 增顶层 `systems.bplusIndex`（与 `lsm`/`hw`/`guards`/`rateLimit`/`failureDetector` 平级、**不混入** `ok`/`highlights`，可 `bplusIndex:false` 关、缺则 null 降级），`console/` 加「B+ 树层高/扇出」+「三笔账对照」两面板读真值渲染（实测层高+稳态估+扇出+叶数+不变式 0 违例、阶数→层高阶梯条；点查/范围/写放大三组双侧真计数按 favors 上色、不封全局赢家、同批 key 答案逐条对账 dot）、缺字段诚实降级不连坐，快照与 `bootstrap.js` 同源；CLI 实测 `B+ 高 3 层/叶 32 / 点查 776 vs LSM 1158 / 写放大 616 vs 603 / 对账一致`。判定权全 Node 侧、前端只渲染不复核；三笔账全结构计数模型、非墙钟 QPS/字节吞吐，两件都是教学实现。

- **事务与并发控制 / MVCC 多版本可见性 + 五档隔离异常矩阵 + 行锁 2PL 死锁检测证据（KI-505）**：`npm run txn:bench` 一趟确定性对照，补上数据库内核继 KI-496 存储引擎（LSM）、KI-504 索引（B+ 树）之后的第三大支柱「事务」——LSM 里的 `seq` 多版本与 `tombstone` 本就是 MVCC 雏形，本件第一次把它显式化成事务可见性判词。①**MVCC 骨架**：`createVersionChain` 单 key 多版本链（每版带 `beginTs`/`commitTs`/`writerTxn`/`tombstone`）按判据「已提交且 `commitTs≤readTs`、或自己未提交版本对己可见、`tombstone` 表删除」取对该快照可见的最新版；`compact(waterMarkTs)` 按水位回收（回收 <水位 的旧版、只留水位前基线一版），实测长事务低水位 10 版全留、无长事务高水位回收到 3 版，把「长事务拖住 gc」钉成可断言读数。`createMvccStore` 逻辑时钟（`now`+内部单调 tick）分配 beginTs/commitTs，`read` 按隔离级别取读视图（RU 读未提交 / RC 每语句最新已提交 / RR·SI·SER 首读锁快照），`commit` 在 SI/SER 做 first-committer-wins 写冲突中止、SER 再加 SSI 简化读写反依赖挡写偏斜，`rollback` 丢弃未提交版。②**五档隔离 × 五类异常矩阵**（同一组确定性并发调度分喂五档、每格据实判该异常有没有真出现）：**RU 五类全出 1 中止 → RC 挡脏读、仍出不可重复读/幻读/丢失更新/写偏斜 → RR 再挡不可重复读/幻读、仍出丢失更新/写偏斜 → SI 再挡丢失更新却**漏写偏斜** → SER 五类全挡但中止最多 3 次**。这组阶梯如实保留最反直觉的真实取舍——**SI 不是可串行化**（挡得住脏读/不可重复读/幻读/丢失更新，双账户写偏斜仍穿透）、**Serializable 满分隔离要付中止重试代价**（`noUniversalWinner=true`，不封 SER 全面赢家，同 KI-497/503/504 诚实立场）。③**行锁 2PL + 死锁**：S/X 兼容矩阵（只有 S-S 兼容）、两阶段锁 growing→shrinking（释放后再申请判 2PL 违规）、`waitForGraph()` 由「被阻塞请求↔冲突持锁者」现算、`detectDeadlock()` 用 **DFS 三色标记找环**（T1 持 A、T2 持 B 互等实测检出 `T1↔T2` 环、无环探针如实报无环 ⇒ 非恒真可证伪）、`abortDeadlock()` 按 youngest/min-locks 选牺牲者（实测牺牲 T2）放锁、重解阻塞（`regranted=1`）、复检环已破。`caesura-mvcc-txn.test.ts` 16 腿钉住版本链可见性/tombstone/水位 gc/读己之写/MVCC 快照读/RC 每语句新视图/写冲突中止/SI 漏写偏斜/S·X 锁兼容/2PL 阶段/wait-for graph DFS 环检测与非恒真/五档异常矩阵阶梯/判词可证伪（注入假调度则翻红）/空集降级/study+snapshot 纯数据/注入确定性。`createGameCloud({mvccTxn:true})` 装配证 `status().mvccTxn` 七维读数可见（惰性缓存 `mvCached`、可注入现成 study 带 builtAt 原样带出）、`spring-family-mesh-e2e` 的 `mvccTxnSnapshot` 证主链非破坏，`mvccTxn:false` 缺省不改任何调用路径。**前端贯穿**：`buildSystems` 增顶层 `systems.mvccTxn`（与 `lsm`/`hw`/`guards`/`rateLimit`/`failureDetector`/`bplusIndex` 平级、**不混入** `ok`/`highlights`，可 `mvccTxn:false` 关、缺则 null 降级），`console/` 加「隔离级别 × 并发异常」+「MVCC 版本链 / 死锁检测」两面板读真值渲染（五行×五类异常热力格按挡住染玉/漏掉染酒红 + 各档中止 chip + 不封全局赢家 dot；wait-for graph 环节点链 + 牺牲者 + 无环探针 + 2PL 违规 + 长事务/无长事务 gc 水位双卡）、缺字段诚实降级不连坐，快照与 `bootstrap.js` 同源；CLI 实测 `RU[5出/1止]→RC[4出/1止]→RR[2出/1止]→SI[1出/2止]→SER[0出/3止] / SI 漏写偏斜 是 / 死锁 T1↔T2 牺牲 T2 已破 / 长事务保留版本 是`。判定权全 Node 侧、前端只渲染不复核；五行矩阵/中止/死锁检测全是**确定性调度上的结构计数**、非墙钟 QPS/延迟跑分，两件事务实现都是教学版。

- **分布式事务 / 2PC 阻塞 + Saga 补偿留脏 + TCC 三阶段幂等三协议诚实权衡证据（KI-506）**：`npm run disttxn:bench` 一趟确定性对照，把 KI-505 单机 MVCC 事务往跨服务分布式一跳——业务一拆库就撞 CAP，跨 N 个服务的写怎么保证原子，生产里的答案从来不是唯一（2PC / Saga / TCC 三选一各有代价），本件第一次把这三组最经典取舍钉成可断言读数。①**2PC 真两阶段状态机**：`prepare()` 全员投 yes/no、全 yes 才 `commit()` 全局提交、任一 no 即全局中止；故障注入 `coordinatorDownAfterPrepare` 钉死核心病——**全员已 yes、协调者发决策前宕机 ⇒ 参与者停在 `prepared` 持锁阻塞、不可自愈**（实测阻塞 3 人），只有外部超时/人工介入 `resolveBlocked()` 才解开；重复 `commit`/`rollback` **幂等**（重放零消息、提交后回滚被拒）。②**Saga 正向链 + 逆序补偿**：第 k 步失败则逆序跑 `C(k-1)…C0`（实测第 3 步失败 → 补偿顺序 `[1,0]`），`compensateFailAt` 让补偿也失败时 `dirtyData` 如实记账（**不粉饰「补偿必成功」**）；**从不阻塞**但**放弃隔离**（中间态对外可见）。③**TCC Try/Confirm/Cancel**：全 Try 成功才逐 Confirm、任一 Try 失败逐 Cancel 已预留者（实测逆序 `[1,0]`），`confirmFlakyAt`+`confirmFailTimes` 触发**幂等重试**（实测失败 2 次后重试成功、`retries=2`、落 `confirmed` 终态、无脏），重试超 `maxRetries` 才留脏（诚实边界）。④**三协议 × 六场景核心对照**（全成功 / 单点 no / 协调者 prepare 后宕机 / 第 k 步失败 / 补偿再失败 / Confirm 半途失败）：**2PC** `allOk成→voteNo止→coordinatorDown阻→stepFail止→compensateFail成→confirmFlaky成`、侵入度 3（最低）、**协调者宕机全员阻塞**；**Saga** `…compensateFail脏…`、侵入 6、**不阻塞但补偿失败留脏**；**TCC** `…confirmFlaky成`、侵入 9（最重）、**无阻塞无隔夜脏 + Confirm 幂等自愈**。判词**不封任何协议全面赢家**：用「**不阻塞 ∧ 不留脏 ∧ 侵入最低**」三难判据量出三条**互不相同**的向量（2PC=`011` 缺不阻塞 / Saga=`100` 缺不留脏且侵入非最低 / TCC=`110` 缺侵入最低）、**没有一条三个全 ✓**，`noUniversalWinner=true`；判词**可证伪**——注入 rigged 场景（抹掉三种故障）则 2PC 退化成 `111` 全占、Saga/TCC 退化为同一向量，`trilemmaDistinguishes` 与 `noProtocolWinsAll` 同时翻红（同 KI-497/503/504/505 诚实立场，绝不预设「各恰好缺一」这种会误判 Saga 缺两难的假判词）。`caesura-distributed-txn.test.ts` 18 腿钉住 2PC 全 yes 提交/任一 no 中止/协调者宕机阻塞不可自愈+外部介入/幂等重放、Saga 全成功/逆序补偿/补偿失败留脏/首步失败空补偿、TCC 全 Try 提交/Confirm 幂等重试/Try 失败逆序 Cancel/重试耗尽留脏、三协议同场景真实阶梯/三难向量互不相同/判词可证伪（rigged 翻红）/空集降级/study 纯数据 JSON 往返/注入确定性。`createGameCloud({distributedTxn:true})` 装配证 `status().distributedTxn` 八维读数可见（惰性缓存 `dtCached`、可注入现成 study 带 builtAt 原样带出）、`spring-family-mesh-e2e` 的 `distributedTxnSnapshot` 证主链非破坏，`distributedTxn:false` 缺省不改任何调用路径。**前端贯穿**：`buildSystems` 增顶层 `systems.distributedTxn`（与 `lsm`/`hw`/`guards`/`rateLimit`/`failureDetector`/`bplusIndex`/`mvccTxn` 平级、**不混入** `ok`/`highlights`，可 `distributedTxn:false` 关、缺则 null 降级），`console/` 加「三协议 × 六场景」+「三难不可兼得」两面板读真值渲染（矩阵格成/止/阻/脏按真判词上色 + 侵入度真读数 + 消息数横条；三难向量逐格玉=占/酒红=缺 + 2PC 阻塞/Saga 留脏/TCC 幂等重试探针 + 不封赢家 dot）、缺字段诚实降级不连坐（tccRetry 缺落「—」不画 0），快照与 `bootstrap.js` 同源；CLI 实测 `2PC[allOk成/voteNo止/coordinatorDown阻/…] 侵入3 · Saga[…compensateFail脏…] 侵入6 · TCC[…confirmFlaky成] 侵入9 / 三难向量 011·100·110 / 不封赢家 是`。判定权全 Node 侧、前端只渲染不复核；六场景矩阵/三难向量/侵入度全是**确定性故障场景上的结构计数**、非墙钟 QPS/吞吐/真数据库一致性跑分，三件协议都是教学实现。

- **Raft 共识与复制状态机 / Raft 单 leader 强一致 + 多主复制 + Gossip 反熵三协议诚实权衡证据（KI-507）**：`npm run raft:bench` 一趟确定性对照，精准接 KI-506 暴露的「2PC 协调者 prepare 后宕机 ⇒ 全员阻塞不可自愈」那块拼图——2PC 的生产解药是把协调者本身做成一组复制状态机（etcd/Consul/ZooKeeper 就是这么给分布式锁与事务托底），本件第一次把「怎么把一组副本弄成一台不会脑裂的机器」的三条生产之路钉成可断言读数。①**Raft 单 leader 强一致状态机**：`elect()` term 单调递增、注入 rand 的**随机化选举超时打破平票**（实测 splitVote 失败后按最低 timeout 选出新主、`resolvedByTimeout=true`）、quorum=floor(n/2)+1 多数派当选（5 节点 quorum=3）、**Leader Completeness** 挡日志落后候选（`candidateStaleLog` 当选被拒）、`votesAvailable=1` 模拟分区少数派凑不齐票留 `noLeader` 空窗；`append()` 仅 leader 受理、追 log 后复制 AppendEntries 到多数派才前推 `commitIndex` 并**按序 apply**（3 条写实测 commitIndex=appliedIndex=3）、`logBehindAt` 触发 **nextIndex 回退重试**后补齐、`networkPartition` 让 ack 不足 quorum ⇒ **少数派拒写且 commitIndex 不推进**（CP 不冒脑裂）、`staleLeader` 旧 leader term 落后其 AppendEntries/read 被拒（**脑裂下只读不写**，状态机不被污染、诚实拒绝而非返回陈值）。②**多主复制（Active-Active）**：每节点皆主、本地**立即写从不阻塞**、写记逻辑版本 + 作者，`replicate(lag)` 异步互推——并发写同 key（同 ver 不同 by）在合并时暴露 `conflicts`、需 LWW/业务合并（不粉饰自动消解），复制延迟窗口读其它主落**陈值**，但复制拓扑确定 ⇒ **收敛有界**（`convergenceBound=replicationRounds` 非 null）。③**Gossip 反熵最终一致**：无主任节点可写、每轮用注入 rand 洗牌后随机两两配对交换摘要按版本合并；干净场景跑 8 轮实测**最终收敛、读不陈**，`skipRounds=8` 反熵间隙则**不收敛 + 读陈**（`converged=false`、`gapReadStale=true`），且概率反熵**无确定收敛轮数上界**（`convergenceBound=null`，诚实边界）。④**三协议 × 六场景核心对照**（全成功 / leader 宕机选主 / 网络分区少数派 / 两主并发写冲突 / 异步复制延迟读陈值 / 反熵间隙读陈值，故障语义诚实映射：选主/分区只打 Raft、写冲突/复制延迟只打多主与 Gossip、反熵间隙只打 Gossip）：**Raft** `allOk成→leaderElection阻→networkPartition阻→writeConflict成→replicationLag成→antiEntropyGap成`（线性一致、确定收敛，但选主+分区两处拒写）；**MultiMaster** `…writeConflict冲→replicationLag陈…`（从不阻塞、有界收敛，但并发冲突 + 复制延迟读陈）；**Gossip** `…antiEntropyGap陈(散)…`（再缺确定收敛，换来无主高可用）。判词**不封任何协议全面赢家**：用「**线性一致性 ∧ 分区可用性 ∧ 收敛确定性**」三难判据量出三条**互不相同**的向量（Raft=`101` 缺分区可用 / MultiMaster=`011` 缺线性一致 / Gossip=`010` 缺线性一致且缺确定收敛）、**没有一条三个全 ✓**，`noUniversalWinner=true`；判词**可证伪**——注入 rigged 干净场景（抹掉四类故障）则三协议全退化为 `111`，`trilemmaDistinguishes` 与 `noProtocolWinsAll` 同时翻红（同 KI-497/503/504/505/506 诚实立场，绝不预设「各恰好缺一难」——Gossip 实测缺两难）。`caesura-raft-consensus.test.ts` **24 腿**钉住 term 单调/随机超时破平票/缺 quorum 空窗/Leader Completeness/AppendEntries 多数派提交/按序 apply/nextIndex 回退/少数派拒写/脑裂旧主只读/多主立即写与并发冲突/复制延迟读陈与有界收敛/Gossip 随机反熵最终收敛/反熵间隙不收敛读陈/六场景三难向量/判词可证伪/空集降级/study JSON 往返/注入确定性/四探针全真。`createGameCloud({raftConsensus:true})` 装配证 `status().raftConsensus` **九维读数可见**（惰性缓存 `rcCached`、可注入现成 study 带 builtAt 原样带出、`raftNow` 注入）、`spring-family-mesh-e2e` 透传 `raftConsensus/raftNow` 的 `raftConsensusSnapshot` 证主链非破坏（`raftConsensus:false` 缺省不改任何调用路径）。**前端贯穿**：`buildSystems` 增顶层 `systems.raftConsensus`（与 `lsm`/`hw`/`guards`/`rateLimit`/`failureDetector`/`bplusIndex`/`mvccTxn`/`distributedTxn` 平级、**不混入** `ok`/`highlights`，可 `raftConsensus:false` 关、缺则 null 降级），`console/` 加「三协议 × 六场景矩阵」+「三难不可兼得」两面板读真值渲染（矩阵格成/阻/陈/冲/散按真判词上色 + 消息数横条；三难向量逐格玉=占/酒红=缺 + Raft 选举/脑裂·多主冲突·Gossip 反熵间隙三探针 + 不封任何协议赢家 dot）、缺字段诚实降级不连坐，快照与 `bootstrap.js` 同源；CLI 实测 `Raft[allOk:成/leaderElection:阻/networkPartition:阻/…] · MultiMaster[…writeConflict:冲/replicationLag:陈…] · Gossip[…antiEntropyGap:陈]` / 三难向量 `{"Raft":"101","MultiMaster":"011","Gossip":"010"}` / 不封赢家 是。判定权全 Node 侧、前端只渲染不复核。

- **分布式锁与租约 / 单 Redis SETNX+TTL + Redlock 多数派 + etcd Lease+Fencing Token 三协议诚实权衡证据（KI-508）**：`npm run dlock:bench` 一趟确定性对照，精准接 KI-507 暴露的「Raft 共识消除 2PC 协调者单点，但互斥锁本身仍是那类最普遍的协调者单点」——跨服务抢分布式锁 / 选主 / 幂等去重 / 全局配额，生产里三条各有硬伤的路本件全做成可断言教学状态机。**单 Redis SETNX+TTL**：`createRedisSetnxLock` 一次 RTT 最低延迟（latency=1）、TTL 到期自动释放，但 `fo.gcPause`（持锁者 GC 长暂停使 TTL 在它仍以为持锁时耗尽）⇒ 另一客户端 `acquire({afterExpiry:true})` 成功、`doubleOwners` 计数 + 旧写 `write({stale:true})` 因无 fencing 落库 `dirtyWrites`（双主写脏）；单点 `fo.nodeDown` 宕机即全盘不可用。**Redlock 多数派**：`createRedlock` N=5 实例 quorum=3，`acquire` 须在多数实例拿到且总耗时 < TTL 才算成功，`fo.nodeDown` 挂 2 剩 3 仍可加锁（部分容错），但 `fo.clockDrift` 实例间墙钟漂移 ⇒ 第二客户端也凑齐多数（双主）、`fo.partitionMinority` 连不足 quorum 拒加锁、无 fencing 旧写落库；多数往返 latency=quorum=3 居中（不站队 Kleppmann/Sanfilippo 论战、只如实量代价）。**etcd Lease+Fencing**：`createEtcdLeaseLock` 锁状态经 Raft 多数派复制、lease 靠 `renew` 续租心跳维持、每次成功 `acquire` 发单调递增 `fencingToken`，`write({token})` 与 `release({token})` **真做 token 数值比较**（`token < currentToken` ⇒ `staleWritesRejected`、拒），`fo.staleHolder` 旧持锁者过期 token 写 ⇒ **即使锁被误授也永无双主写脏**（这正是 fencing 相对裸租约的价值）；`fo.partitionMinority` 少数派凑不齐 quorum ⇒ CP 拒加锁、`fo.nodeDown` 少数宕机多数还在 ⇒ 容错成功，代价 `raftRounds` 多数派往返 latency=3 最高、续租依赖活跃度。**`compareDistributedLock`**：同组确定性故障场景（全成功 / 持锁者 GC 暂停 / 实例时钟漂移 / 少数节点宕机 / 客户端落少数派分区 / 旧持锁者过期凭证写）分喂三协议，数各 `acquired/doubleOwners/dirtyWrites/blockedAcquires/staleWritesRejected/fencedProtected/messages/latency`，钉死「SETNX 最低延迟但单点 + GC 暂停双主写脏 / Redlock 抗少数宕机但靠墙钟、漂移破互斥、多数往返 / etcd Lease+Fencing 单调 token 兜底永无双主写脏 + Raft 容错但多数往返延迟最高」这组真实取舍，用**互斥安全 ∧ 部分容错可用 ∧ 低延迟**三难判据证明**没有协议同时占全**（`noUniversalWinner`，可证伪非恒真——rigged 单实例/单节点 + 六场景故障全置空后三协议全退化为 `111`、三判词同时翻 false，同 KI-497/503/504/505/506/507 诚实立场）。CLI 实测 `SETNX[allOk:成/gcPause:双/clockDrift:成/nodeDown:阻/partitionMinority:成/staleFencing:脏] · Redlock[allOk:成/gcPause:成/clockDrift:双/nodeDown:成/partitionMinority:拒/staleFencing:脏] · ETCD[allOk:成/gcPause:护/clockDrift:成/nodeDown:成/partitionMinority:拒/staleFencing:护]` / 三难向量 `{"SETNX":"001","Redlock":"010","ETCD":"110"}` / 不封赢家 是。`systems.distributedLock` 与其余九维平级接入前端「三协议 × 六场景矩阵」+「互斥/容错/延迟三难条 + GC 暂停/时钟漂移/fencing 探针」两面板（双主/拒写横条 + 续租心跳与单调 token 读数，缺字段诚实降级不连坐）；`npm run console:data` 一次刷新十维 systems、snapshot/bootstrap 同源。接进 `createGameCloud({distributedLock:true})` opt-in 挂 `status().distributedLock`（惰性缓存）、E2E 透传 `distributedLockSnapshot`。判定权全 Node 侧、前端只渲染不复核；六场景矩阵 / 双主·脏写·拒写数 / 三难向量 / 消息数全是**确定性故障场景上的结构计数**、非墙钟 QPS/吞吐/真 Redis·etcd 跑分，三件协议都是教学实现。

对应 `tests/unit/spring-family-mesh-e2e.test.ts`（24 腿）；前端证据另见 `tests/unit/caesura-console-gen.test.ts`（17 腿）与 `tests/unit/caesura-console-ui.test.ts`（25 腿）；存储引擎证据见 `tests/unit/caesura-lsm-store.test.ts`（20 腿）、OS/硬件适配见 `tests/unit/caesura-hw-perf.test.ts`（16 腿）、一致性哈希见 `tests/unit/caesura-consistent-hash.test.ts`（14 腿）、分片缓存见 `tests/unit/caesura-sharded-cache.test.ts`（13 腿）、缓存防护见 `tests/unit/caesura-cache-guard.test.ts`（15 腿）、网关限流见 `tests/unit/caesura-rate-limiter.test.ts`（16 腿）、故障检测见 `tests/unit/caesura-failure-detector.test.ts`（14 腿）、B+ 树索引见 `tests/unit/caesura-bplus-tree.test.ts`（16 腿）、事务并发控制见 `tests/unit/caesura-mvcc-txn.test.ts`（16 腿）、分布式事务见 `tests/unit/caesura-distributed-txn.test.ts`（18 腿）、Raft 共识见 `tests/unit/caesura-raft-consensus.test.ts`（24 腿）、分布式锁见 `tests/unit/caesura-distributed-lock.test.ts`（24 腿），连同缓存/计网/防护/限流/故障检测/索引/事务/分布式事务/Raft 共识/分布式锁在 `tests/unit/caesura-game-cloud.test.ts`（33 腿，KI-493~508 opt-in 装配）证装配。

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
- 不声称 KI-500 `caesura-sharded-cache` 是真 Redis Cluster / 生产分布式缓存客户端——各片是**进程内** `createRedisCache`（KI-493），无真网络、无副本、无故障转移、无热点迁移、无跨进程一致性；`remapOn` **不真搬数据**，只把换片/被删片的条目按**失效计数**计入账本（真集群的迁移/回填归后端），`load` 的 singleflight 只在**片内**合并、不跨进程去重。保留率 `retentionRate` 是**条目落点的结构计数比**、不是真实负载下的缓存命中率/墙钟/网络带宽，缺省参数仅教学值、真集群须实测调参。也不声称扩缩容零失效——一致性哈希分片仍有约 `1/(N+1)` 条目换片失效，`retentionRate` 如实给出、不粉饰；朴素取模的保留率对照只用于量出差距、不代表某具体实现。分片缓存**默认不参与**运行时缓存路由——`shardedCache:false` 缺省不装配，接进 `createGameCloud` 也只挂 `status.shardedCache` 只读快照（环 + 保留率对照、惰性缓存不反复预热），KI-493 缓存与 KI-491 灰度路由语义逐字不动、不反向改变任何调用结果。
- 不声称 KI-501 `caesura-cache-guard` 是生产缓存中间件 / 接了真 Redis 或真 DB——loader / 缓存 / Bloom **全进程内、可注入**（复用 KI-493 缓存与 KI-496 Bloom 的真实现，是教学对照组）。回源次数、bucket 峰值都是**结构计数**（这段模拟里 loader 被调了几次、按注入时钟+rand 落进各 bucket 的条目数），**不是**真实压测的 QPS / 墙钟 / 带宽。布隆过滤器**不零误判**——`bloomFalsePositives` 如实给出，假阳性会放行少量不存在的 key 去 DB；空值缓存占内存、有一致性窗，本件不建模。也不声称「加了防护就永不击穿 / 穿透 / 雪崩」：singleflight 只合并**同 key**、跨 key 仍需 TTL 抖动，jitter 只**削峰不减少总回源数**，XFetch 的 `beta` / jitter 的 `jitterRatio` 缺省仅教学值、真系统须实测调参。缓存防护**默认不参与**运行时——`cacheGuard:false` 缺省不装配，接进 `createGameCloud` 也只挂 `status.cacheGuard` 只读快照（惰性缓存、不反复跑对照），KI-493 缓存 / KI-500 分片 / KI-491 灰度路由语义逐字不动、不反向改变任何调用结果；前端只读 `systems.guards` 渲染、不判定不实测。
- 不声称 KI-502 `caesura-rate-limiter` 接了真 Redis / 真 EVAL Lua 脚本——令牌桶状态存 KI-493 `createRedisCache.command()` 的进程内 GET/SET，`backend` 可注入真后端但本件**约定 command 同步返回、不 await 其 Promise**（真异步 Redis 客户端适配不在本教学件范围）；`atomic:true` 的「同步原子」只在**单 JS 线程内**等价 Redis Lua 脚本串行执行，**跨进程真原子**必须由注入的真后端（EVAL + 服务端单线程）保证，本件不提供也不声称。也不声称替代 KI-486 `RateLimit` handler（那只仍是可用的进程内令牌桶 filter，KI-502 只做可对照教学与分布式语义、不改动其语义与调用路径）。五算法的 allowed / `burstRatio` / Redis 超发数都是**结构计数**（这条确定性轨迹下放行了几次、64 并发里几条读到同一旧桶状态），**不是**真实压测的 QPS / 墙钟 / 网络带宽 / 延迟；固定窗口 2× 突发只在「请求恰卡在自然窗翻边」时成立（轨迹刻意构造），真实流量分布下放大倍数不同；滑动计数是 O(1) 内存换来的**近似**（前窗按重叠权重估算，窗口边界附近可能高估/低估，偏差在单测里显式量出，不粉饰成精确）；漏桶**不建模等待队列**（超限即拒，不排队、不产生削峰延迟），令牌/漏桶的 refill/leak 速率与 capacity 缺省仅教学值、真链路须实测调参。网关限流**默认不参与**运行时——`rateLimit:false` 缺省不装配，接进 `createGameCloud` 也只挂 `status.rateLimit` 只读快照（惰性缓存、不反复跑对照），KI-486 handler / KI-493 缓存 / KI-491 灰度路由语义逐字不动、不反向改变任何调用结果；前端只读 `systems.rateLimit` 渲染、不判定不实测。
- 不声称 KI-503 `caesura-failure-detector` 接了真 Cassandra / Akka / Consul / Seris——φ 检测与 SWIM 成员协议都是纯进程内教学状态机：无 socket、无 UDP gossip、无真网络分区、无真实节点互联，`probeFn` / `rand` / `now` 全靠注入，缺省走保守路径（直接探测失败标 suspected）；也不声称 φ 的正态假设拟合真实网络尾延迟——真系统的 accrual 检测器用分段分布或经验直方图，本件用正态分布配 erfc 近似（Abramowitz-Stegun 7.1.26，约 1.5e−7 绝对误差）纯为教学可断言，`threshold` / `minStdDeviationMs` / `windowSize` 缺省仅教学值、真链路须实测标定。固定超时 vs φ 的误报数与检测延迟都是确定性轨迹上的**结构计数**（这条含 3 次 GC 长暂停加 1 次真故障的轨迹里误判几次、多久越阈），**不是**真实压测的墙钟 / MTTR / 可用率跑分；「固定更快但更吵、φ 更稳但更慢」只在这条轨迹上成立，换流量分布结论可能不同（长尾重抖动下 φ 也可能误报，不粉饰成万能）。健康视图缓存是 KI-493 **进程内**缓存、不跨进程共享（真 Redis 后端靠注入 `cache`），成员变更须调用方主动 `invalidate`，本件不做缓存失效的自动 gossip 扩散。故障检测**默认不参与**运行时——`failureDetector:false` 缺省不装配，接进 `createGameCloud` 也只挂 `status.failureDetector` 只读快照（惰性缓存、不反复跑对照），KI-486 handler / KI-493 缓存 / KI-501 防护 / KI-502 限流语义逐字不动、不反向改变任何调用结果，也不替代 `spring-health-check`（那只按调用方传入的 `healthy` 布尔裁决）；前端只读 `systems.failureDetector` 渲染、不判定不实测。
- 不声称灰度接了真流量镜像/service mesh sidecar——KI-491 `spring-gateway-gray` 纯进程内决策，transport 仍是注入的内存实现；不缓存会话状态（亲和靠 selector 确定性哈希，同 key 必落同池），阈值无服务端下发/热更（由 opts 注入）。
- 不声称事件桥 import 了浏览器 `src/`——`caesura-game-event-bridge` 依赖注入两只 duck-typed bus，永不反向依赖；默认空路由零转发，载荷原样透传不校验。
- 不声称前端控制台是实时流/推送——KI-495 `console/` 只读 `npm run console:data` 落盘的**一次性离线快照**，`snapshot.json`（XHR）与 `bootstrap.js`（`file://` 回退）同源；无 WebSocket/SSE、无定时轮询、无后端写入、无交互命令下发（纯只读可视化），要刷新须重跑生成器。
- 不声称前端视觉是像素级截图验证——KI-495 UI 证据是 `node:vm` + DOM stub 跑真 `app.js` 证「每块面板落真读数 + 缺字段降级 + 零外部依赖」的可断言烟测，非浏览器渲染截图；`styles.css` 内联 grain SVG 的 `xmlns` 是命名空间常量、非网络请求。前端不持有判定权与阈值，所有读数是 Node 判词派生，不复核、不重算。
- 不声称 KI-498 的 `systems` 是实时推送、墙钟跑分或游戏运行时 HUD——它仍是 `npm run console:data` 一次性离线采集的**独立只读数据块**，无 WebSocket/SSE、无后端写入、刷新须重跑生成器；`lsm.speedup` 是「点查比较数 ÷ 线性扫描比较数」的**算法计数比**、`hw` 三件是对象池分配次数 / cache line 同行对数 / LRU 模型 miss 数（边界逐字继承 KI-496/497），**非墙钟时间 / GC 暂停 / 真 CPU cache 命中率**，真实收益须实测调参；`systems` 不参与五场景 `ok` 判定与 `highlights` 派生、不混入 E2E 判词口径；`console/` 是独立静态页、不进 vite 主包。
- 不声称 KI-504 `caesura-bplus-tree` 是生产级 B+ 树 / 真数据库索引——它是**纯进程内教学实现**：无真实磁盘页、无缓冲池/页缓存、无 WAL、无并发闩锁（crabbing / latch coupling），`order` / `leafCapacity` 全内存、单线程、非并发安全、不跨进程共享；分隔键只存右孩子最小 key 副本、删除走 `borrow`+`merge` 重排，`validate()` 只在本件内存结构上验「叶同深 / 分隔键副本 / 填充下界 / 叶链双向 / 全局严格递增 / 叶 key 总数=size」六条不变式，不代表任何真库的页布局或磁盘格式。也不声称三笔账是墙钟 / QPS / 字节吞吐跑分——`pointComparisons` / `rangeCost` / `pageRewrites` 与 LSM 侧 `lsmComparisons` / `lsmSortComparisons` / `seqWriteUnits` **全是确定性结构计数模型**（这条 512 key 轨迹上各比了几次、改写了几页 / 追加了几写单元），非真实硬件上的延迟、IOPS 或写放大字节；`pageRewrites=616 vs seqWriteUnits=603` 的口径是「原地改页重写次数」对「顺序追加写单元」两种不同单位，仅用于量出结构取舍、**不可直接换算成真 SSD 写放大**。`heightEstimate` 是 mid 分裂**半填充稳态估计**、不是实测上界（特定插入序下实测层高可能更高），与实测层高并排呈现、不混谈。`noUniversalWinner=true` 与 `pointFavors` / `rangeFavors` / `writeFavors` 只在这两件教学实现、这条确定性轨迹上成立，换 key 分布 / 阶数 / 读写比结论可能不同（如写密集 + 顺序 SSD 场景 LSM 反超），**不封全局赢家**、不粉饰成 B+ 树或 LSM 全面更优；两者正确性对账 `agreement.bothAgree=true` 只是「同批 key 的 get/range 答案逐条一致」这一**先决条件**——一致才让性能读数作数，不一致则读数作废，不代表二者在持久化 / 并发 / 语义上等价。B+ 树索引**默认不参与**运行时——`bplusIndex:false` 缺省不装配，接进 `createGameCloud` 也只挂 `status.bplusIndex` 只读快照（惰性缓存、不反复跑对照），KI-486 handler / KI-493 缓存 / KI-496 LSM / KI-501 防护 / KI-502 限流 / KI-503 故障检测语义逐字不动、不反向改变任何调用结果；前端只读 `systems.bplusIndex` 渲染、不判定不实测。
- 不声称 KI-505 `caesura-mvcc-txn` 是真 PostgreSQL / MySQL / 生产级 MVCC 或真事务管理器——它是**纯进程内教学状态机**：无真实磁盘页、缓冲池、WAL redo/undo 日志、真事务 ID 分配器、真谓词锁或完整 SSI 实现；版本链是内存数组、`compact` 是**水位模型**（正确性依赖调用方保证水位 ≥ 最老活跃快照，非真 vacuum），逻辑时钟是注入 `now` + 内部单调计数器、非真分布式时钟，事务/行锁全单线程、非并发安全、不跨进程共享。也不声称五档隔离实现覆盖了 SQL 标准全部边界——只钉住「脏读 / 不可重复读 / 幻读 / 丢失更新 / 写偏斜」这五类经典异常的确定性调度，教学版把 RR 实现成「快照读但不做写冲突中止」、把 SI 实现成「快照读 + first-committer-wins」、把 Serializable 实现成「SI + 双向读写反依赖（SSI 简化）」以拆出可分辨的五档阶梯，真库语义（MySQL RR 的间隙锁、PostgreSQL 的 SSI、谓词锁、写集冲突细节）远更复杂；SI 漏写偏斜、Serializable 中止最多只在这组调度上成立，换调度 / 隔离实现结论可能不同（`verdict` 逐档如实给、**不封 Serializable 全面赢家**）。也不声称五行异常矩阵 / 中止数 / 死锁检测是墙钟或 QPS 跑分——全是**确定性调度上的结构计数**（这条轨迹里哪类异常真出现几次、多少事务被中止、wait-for graph 有没有环），非实测吞吐 / 延迟 / MTTR；死锁检测是**进程内** wait-for graph 的 DFS 三色环检测、非分布式死锁检测（无跨进程等待边、真分布锁靠注入），也不实现写者优先 / 公平排队（排在队列里的 X 不阻塞后来的 S，**写饥饿是诚实教学边界**）。事务并发控制**默认不参与**运行时——`mvccTxn:false` 缺省不装配，接进 `createGameCloud` 也只挂 `status.mvccTxn` 只读快照（惰性缓存、不反复跑对照），KI-486 handler / KI-493 缓存 / KI-496 LSM / KI-501 防护 / KI-502 限流 / KI-503 故障检测 / KI-504 索引语义逐字不动、不反向改变任何调用结果；前端只读 `systems.mvccTxn` 渲染、不判定不实测。
- 不声称 KI-506 `caesura-distributed-txn` 是真 XA / 真两阶段提交管理器 / 生产级分布式事务协调者——它是**纯进程内教学状态机**：无两阶段落盘日志、无真跨进程协调者、无真网络分区/超时/消息丢失/重传、无真幂等键或去重表，2PC 的 `prepared`/Saga 的补偿/TCC 的预留全是内存标记、单线程、非并发安全、不跨进程共享；故障点（`coordinatorDown`/`failAtStep`/`compensateFailAt`/`confirmFlakyAt`）全靠 opts 注入，真分布式的协调者选举、恢复日志、幂等去重、悬挂/空回滚防护归生产系统（本件只做判定与结构计数）。也不声称 Saga 补偿能真回滚外部副作用——它是业务反向操作、可能失败甚至不可逆，本件只把补偿失败如实记 `dirtyData`、不假装已抹平；TCC 的 Cancel 释放预留「通常可靠」是教学假设，`cancelFailAt` 演示预留系统自身故障照样留脏，不粉饰成绝对可回滚。六场景矩阵 / 侵入度 / 三难向量 / 幂等重试数全是**确定性故障场景上的结构计数**（这条轨迹里谁阻塞几人、补偿失败留几处脏、Confirm 重试几次、每服务几套接口），**不是**墙钟 / QPS / 吞吐 / 真数据库一致性 / 可用率跑分；「2PC 阻塞、Saga 留脏、TCC 侵入最重」这组取舍只在这套协议模型 + 这组故障场景上成立，换场景或故障点结论可能不同（`verdict` 逐条给、**不封任何协议全面赢家**），三难向量「各恰好缺一难」是**刻意不假设**的——Saga 实测缺两难，若强设恰好缺一会把更真实的取舍误判红。分布式事务**默认不参与**运行时——`distributedTxn:false` 缺省不装配，接进 `createGameCloud` 也只挂 `status.distributedTxn` 只读快照（惰性缓存、不反复跑对照），KI-486 handler / KI-493 缓存 / KI-496 LSM / KI-501 防护 / KI-502 限流 / KI-503 故障检测 / KI-504 索引 / KI-505 事务语义逐字不动、不反向改变任何调用结果；前端只读 `systems.distributedTxn` 渲染、不判定不实测。
- 不声称 KI-507 `caesura-raft-consensus` 是真 Raft 生产实现 / 真 etcd·Consul·ZooKeeper 跑分——它是**纯进程内教学状态机**：无真持久化日志、无真随机选举、无真 RPC / 网络分区 / 消息丢失重传、无成员变更 / 日志压缩 snapshot / 只读优化（ReadIndex·LeaseRead）、无真 pre-vote·joint-consensus，日志复制 / 向量时钟 / 反熵全是内存标记、单线程、非并发安全、不跨进程共享；故障点（`leaderDown`/`splitVote`/`networkPartition`/`writeConflict`/`replicationLag`/`antiEntropyGap`）全靠 opts 注入，真共识的选主、日志恢复、幂等去重、成员变更归生产系统（本件只做判定与结构计数）。也不声称多主 / Gossip 是真网络复制——两协议共用一套**最终一致合并内核**（同 ver 不同作者 ⇒ 冲突、按 by 字典序 LWW），差别只在复制调度（多主全对互推、Gossip 随机配对反熵），是真生产变体的教学简化。Raft 的「线性一致」只在「读 leader 已 apply 状态」模型下成立（未实现只读优化与读多数派），旧 leader 读**诚实拒绝**而非返回陈值；Gossip 的 `convergenceBound=null` 是**概率收敛无确定轮数上界**的诚实表达、不是「不收敛」，干净场景跑够轮实测收敛。六场景矩阵 / 阻塞·读陈·冲突数 / 三难向量 / 消息数全是**确定性故障场景上的结构计数**（这条轨迹里谁拒写几次、读陈几次、冲突几次、反熵跑几轮），**不是**墙钟 / QPS / 吞吐 / 真库一致性 / 可用率跑分；「Raft 分区拒写、多主并发冲突+读陈、Gossip 反熵间隙不收敛」这组取舍只在这套协议模型 + 这组故障场景上成立，换场景或故障点结论可能不同（`verdict` 逐条给、**不封任何协议全面赢家**），三难向量「各恰好缺一难」是**刻意不假设**的——Gossip 实测缺两难，若强设恰好缺一会把更真实的取舍误判红。Raft 共识**默认不参与**运行时——`raftConsensus:false` 缺省不装配，接进 `createGameCloud` 也只挂 `status.raftConsensus` 只读快照（惰性缓存、不反复跑对照），KI-486 handler / KI-493 缓存 / KI-496 LSM / KI-501 防护 / KI-502 限流 / KI-503 故障检测 / KI-504 索引 / KI-505 事务 / KI-506 分布式事务语义逐字不动、不反向改变任何调用结果；前端只读 `systems.raftConsensus` 渲染、不判定不实测。
- 不声称 KI-508 `caesura-distributed-lock` 是真 Redis SETNX / Redlock 算法 / 真 etcd Lease 或 Raft 跑分——它是**纯进程内教学状态机**：无真 SETNX 原子 Lua、无真 Raft 日志/真 RPC、无真墙钟或跨进程互斥；SETNX/Redlock/etcd 三协议共用单进程内存状态、单线程、非并发安全、不跨进程共享；故障点（`gcPause`/`clockDrift`/`nodeDown`/`partitionMinority`/`staleFencing`/`forceTakeover`）全靠 opts 注入，真分布式锁的原子 Lua、租约续期与时钟假设、fencing token 的后端持久化校验归生产系统（本件只做判定与结构计数）。也不声称三协议是真网络实现——quorum / 墙钟漂移 / Raft 复制往返都是内存标记的教学简化。fencing 的「旧写被拒」是 `write({token})` 里**真 token 数值比较**（`token < currentToken` ⇒ 拒、不产生 `dirtyWrites`）、非布尔桩；「锁即使误授也永不双主写脏」只在「后端按单调 token 校验」这一模型下成立。六场景矩阵 / 双主·脏写·拒写数 / 三难向量 / 消息数 / latency 全是**确定性故障场景上的结构计数**（这条轨迹里谁双主几次、旧写落库几次、拒写几次、几轮往返），**不是**墙钟 / QPS / 吞吐 / 真库一致性 / 可用率跑分；「SETNX 双主、Redlock 漂移破互斥、etcd fencing 兜底」这组取舍只在这套协议模型 + 这组故障场景上成立，换场景或故障点结论可能不同（`verdict` 逐条给、**不封任何协议全面赢家**），可证伪：rigged 单实例/单节点 + 干净场景三协议全退化为 `111`、三判词同时翻 false。分布式锁**默认不参与**运行时——`distributedLock:false` 缺省不装配，接进 `createGameCloud` 也只挂 `status().distributedLock` 只读快照（惰性缓存、不反复跑对照），KI-486 handler / KI-493 缓存 / KI-496 LSM / KI-501 防护 / KI-502 限流 / KI-503 故障检测 / KI-504 索引 / KI-505 事务 / KI-506 分布式事务 / KI-507 Raft 共识语义逐字不动、不反向改变任何调用结果；前端只读 `systems.distributedLock` 渲染、不判定不实测。
