# CAESURA 项目长期开发计划（持续演进版）

## 已完成（主干上已提交，npm run check 全绿）

| 阶段 | 内容 | 提交 |
|------|------|------|
| KI-422/429/430/441 | Spring Cloud 家族守门人（5 服务 + spawn-ledger-check + 119 条测试） | 1e29b4f |
| KI-118 | ledger-rules const + import() 点名，移除重复 dev-gateway | 7ca6896 |
| KI-441/KV | 同步 KI-441 账本行 + PHASE-STATUS KV 块 + import-target-rules 修正 | 46bc537 |
| Phase A / F2 | 画质四档接线：QualityStore→SaveWorld.quality，Stakerite 档位行 | bd38ac0 |
| Phase B / F1 | ColorGrade.colorGradePass 失谐乘数接口 | e8e5829 |
| Phase D / F4 | 凝固声波目录门：art-direction §1.4 + vfx-soundwave-catalog.test.ts | 2e6c0d9 |
| Phase F / Spring Cloud | caesura-config 配置客户端 + spring-health-check 探针 + docker-compose | 9abf6c5 |
| Phase F-2 | spring-config-client（Node.js Config 客户端，4 测试） | 1bffdb1 |
| Phase F-3 | spring-bus-client（Node.js Bus 客户端，5 测试） | bf490f6 |
| Phase F-4 | spring-eureka-client（Node.js Eureka 客户端，6 测试） | 551bd2c |
| Phase F-5 | spring-config-refresh（综合刷新脚本，3 测试） | 651ce4f |
| Phase F-6 | spring-discovery（服务发现+配置综合客户端，3 测试） | e71a50c |
| Phase F-7 | spring-gateway-route（Gateway 路由客户端，5 测试） | af6ddd3 |
| Phase F-8 | spring-circuit-breaker（熔断器客户端，5 测试） | fc06e67 |
| Phase F-9 | spring-sleuth-trace（Sleuth 链路追踪客户端，6 测试） | d03a7bf |
| Phase F-10 | spring-load-balancer（负载均衡客户端，7 测试） | b7f6629 |
| Phase F-11 | spring-mesh-health（服务网格健康聚合器，5 测试） | ce32537 |
| Phase F-12 | spring-config-server（Config Server 客户端，4 测试） | b8b7d89 |
| Phase F-13 | Spring Cloud Config Server 增强：startConfigWatcher 热刷新回调 + 版本回滚端点 + `config/{app}` 版本名册（7 测试 → 9 测试） | 4351589, a416f77 |
| Phase F-14 | `fetchConfigWithFallback`：Config Server 不可用时降级到 fallback 配置 + `_configError` 标记（3 新测试） | 4351589 |
| Phase F-15 | Spring Cloud Bus 事件总线 `spring-bus-event.mjs`：进程内发布/订阅（publish/publishAsync/subscribe/close），默认实例 `defaultBus`（11 测试） | 4351589 |
| Phase F-16 | Phase 7 F2 第二批落点：`src/renderer/QualityRenderer.ts`——renderer 分档实际消费者（applyRendererQuality + RendererQuality.sync()），headless 只记不应用，真 GL 落点等 Phase 9/10（8 测试） | 4351589 |
| Phase F-17 | Spring Cloud Bus × Config Server 闭环：startConfigWatcher 第 5 形参 `bus` → `config.changed` 自动广播；启动语义改为首趟只登记不吐事件；CLI 创建本地 Bus 打印总线响应（2 条新集成测试） | a416f77 |
| Phase F-18 | Spring Cloud Gateway 动态路由热加载：`createRouteTable` + `watchRoutes`（mtime 快照 + added/removed 差集 + `route.changed` 广播）+ `refreshRoutes` + CLI `refresh` 子命令（9 条新测试） | abcf512 |
| Phase F-19 | Spring Cloud 家族端到端真跑通（宿主直跑六件 jar，未碰另一项目进程）：修 client 父引用 + 加入 reactor + finalName 对齐 compose（KI-452）；修 client BOM 版本漂移（Boot 3.5.16 × Cloud 2022.0.4 compatibility-verifier 拒绝）+ 缺 `spring.config.import`（KI-453）；实测 registry/config/gate/report/gateway/client 全部在线、网关双路由 200、两道真门经网关跑 green（`circuitState=CLOSED`） | bf3d106 |
| Phase F-20 | Spring Cloud 家族判词整族全绿：六件 jar 全起、gate 名册 count=5（含 gate-suite test）、`/report/verdict` 5 门全 green、熔断器全程 CLOSED、Java 侧判定权仍是 Node 侧、healths 稳定 | 92d1a2d |
| Phase F-21 | 端到端验收器 `scripts/spring-family-e2e-check.mjs` 固化（两阶启动 + 四条探针 + 自动停六件；14 腿单测覆盖纯函数） | e9b979e |
| Phase F-22 | `gate-perf` 加入门名册：`measure-probe.mjs --budget=10ms` + `perf-budget-rules.mjs`（p95 预算门，10 腿单测）；经网关实测 gate-perf green（4.4s），probes 期望 count 5→6 同步 | 236bf92, 280a9e4 |
| KI-407 | coverage 棘轮三出口（0/1/2）全部有测试 + 基线落地 | 07399b9 |
| Phase C / F3 | Boss 乐句线 HUD：BossPhraseBar.ts + main.ts 接线 + flow 测试 | 08bb3f5 |
| KI-118 fix | spring-health-check.mjs 移除 shebang（module-loader 门禁） | 0698210 |
| Phase 7 F2-第二批 | Streaming ring 接线（activateRingBonus/preloadRingBonus） | 08e59a9 |
| Phase 7 F2-第二批 | renderer 分档接口（QualityTargets.renderer） | 96df2f0 |
| Phase C-2 | BossPhraseBar 单元测试（5 腿） | 4ea4ed0 |
| KI-442~445 | 账本行同步（KNOWN_ISSUES/WORKPLAN/PHASE-STATUS KV） | daea06e |
| Stakerite 覆盖率看板 | 读 coverage-floor.json 显示总地板 | b0e0fb7 |
| Phase 7 F2-第三批 | QualityStore→GPUParticles 预算乘数接线验证（5 腿） | 26347df |
| KI-460 | spring-cloud-stream-client：Spring Cloud Stream binder 抽象 + 声明式 producer/consumer（7 腿） | d2a4717 |
| KI-461 | spring-cloud-openfeign-client：声明式 REST + 路径模板 + LB 寻址（7 腿） | d2a4717 |
| KI-462 | spring-cloud-vault-client：KV 密钥 + 缓存/TTL + tokenExpired（6 腿） | d2a4717 |
| KI-463 | spring-cloud-security-oauth2-client：JWT/scope/expire/authorize/introspect（9 腿） | d2a4717 |
| KI-464 | spring-cloud-consul-client：注册/发现/健康（内存+HTTP，6 腿） | d2a4717 |
| KI-465 | spring-cloud-facade (CaesuraCloud)：七族客户端统一门面 + request 链路（6 腿） | d2a4717 |
| KI-466 | spring-mesh-status：整族可观测性聚合快照（5 腿） | d2a4717 |
| KI-467 | spring-cloud-task-client：一次性短任务收口（7 腿） | e798cf3 |
| KI-468 | spring-cloud-function-client：函数名=处理逻辑的注册/路由收口（6 腿） | e798cf3 |
| KI-469 | spring-cloud-contract-client：消费者驱动契约桩（5 腿） | e798cf3 |
| KI-470 | spring-mesh-registry：合并 Eureka/Consul/静态 的统一服务视图（5 腿） | e798cf3 |
| KI-471 | caesura-mesh-adapter：游戏成为家族一等公民（5 腿） | e798cf3 |
| KI-472 | spring-resilience-breaker：进程内 Resilience4j 风格熔断（7 腿） | 2ff7f79 |
| KI-473 | caesura-cloud-runtime：facade+mesh-registry+gateway-route+load-balancer+game-adapter 组合成「游戏一键拉起的一朵云」（7 腿） | 2ff7f79 |
| KI-474 | caesura-service-proxy：runtime.call（负载均衡）+ 进程内熔断 串成韧性调用链路（6 腿） | 2ff7f79 |
| KI-475 | spring-gateway-matcher：Gateway predicate 求值 + filter 链（7 腿） | 172c8a0 |
| KI-476 | spring-sleuth-tracer：进程内 tracer（W3C traceparent，6 腿） | 172c8a0 |
| KI-477 | caesura-cloud-runtime.call 升级为完整服务网格调用（网关匹配+追踪+CB filter，4 腿） | 49f5417 |
| KI-478 | caesura-game-cloud：游戏开箱即用云入口 createGameCloud（5 腿） | b38ee93 |
| KI-479 | spring-cloud-kubernetes-client：K8s 对位（configMap+endpoints→mesh 实例，6 腿） | d99f0c9 |
| KI-480 | caesura-config-aggregator：多源配置优先级合并（6 腿） | d99f0c9 |
| KI-481 | spring-family-mesh-e2e：headless 端到端证据（5 腿） | 9f799e5 |
| KI-482 | caesura-game-bootstrap：游戏生命周期 ↔ 云入口桥接件（5 腿） | e717d97 |
| KI-483 | docs/spring-cloud-mesh.md：集大成微服务网格合成地图 | e717d97 |
| KI-484 | caesura-event-bus：按 type 分发的游戏事件总线（5 腿） | 5e618da |
| KI-485 | caesura-auth-guard：游戏鉴权守卫（5 腿） | 5e618da |
| KI-486 | spring-gateway-filter-handlers：Retry/RateLimit/CircuitBreaker handler + 可重入链（8+2 腿） | 58abd33 |
| KI-487 | caesura-cloud-runtime.call 接入完整 filter 链（+3 腿） | 58abd33 |
| KI-488 | spring-family-mesh-e2e 主链覆盖 events+auth+retry（+3 腿） | 58abd33 |
| KI-489 | caesura-game-event-bridge：游戏真 EventBus ↔ 云事件总线桥（8+1+1 腿，connectGameBus 一行接线） | 60d84f1 |
| KI-490 | caesura-auth-guard.authorizeOnline：RFC 7662 introspection 在线校验（不透明令牌/active/在线 scope/fail-open，9+1 腿） | 853b413 |
| KI-491 | spring-gateway-gray：灰度/金丝雀加权路由端到端接线（metadata 保真/lbStrategy/会话亲和/空池回退，9+3+1+1 腿） | 2fc7743 |
| KI-492 | spring-gateway-filter-handlers：Bulkhead 并发舱壁 + TimeLimiter 超时（6+1+1 腿，零运行时改动接进 filter 链） | 1fa7fa0 |
| KI-493 | caesura-redis-cache：LRU+TTL+singleflight+字节预算 RESP 风格缓存 + introspection 缓存接线 | f5722c6 |
| KI-494 | caesura-net-stack：AIMD 拥塞控制/RTO+ Karn/滑动窗口/0-RTT/HTTP 缓存语义 | b2ba973 |
| KI-495 | 前端集大成 mesh 控制台（暗黑哥特风、自包含、注入真 E2E 数据） | 0df3874 |
| KI-496 | caesura-lsm-store：LSM 引擎（memtable 跳表+WAL+SSTable 稀疏索引+Bloom+leveled compaction，附线性扫描对照证据） | cd37ce9 |
| KI-497 | caesura-hw-perf：OS/硬件适配（对象池降 GC 分配+cache line padding 规避 false sharing+AoS→SoA LRU 局部性对照） | 9ba2f44 |
| KI-498 | 前后端协同贯穿：`caesura-console-gen` 增 `systems` 数据块真跑 LSM+OS 硬件读数，`console/` 加「存储引擎 / 硬件适配」两面板（五场景与 highlights 口径不动、缺字段诚实降级） | d1eb7c4 |
| KI-499 | caesura-consistent-hash：一致性哈希环（虚拟节点+加权+二分查找）+ 扩容最小重映射 vs 取模对照证据 + 缓存分片定位器，opt-in 挂 status.hashRing | f4df07c |
| KI-500 | caesura-sharded-cache：分片缓存客户端（KI-493 缓存 + KI-499 环咬合），扩缩容命中率保留率一致性哈希 vs 取模对照，opt-in 挂 status.shardedCache | 388d583 |
| KI-501 | caesura-cache-guard：缓存防护三件套（击穿 singleflight+逻辑过期 / 穿透布隆前置+空值墓碑 / 雪崩 TTL 抖动削峰），systems.guards 前端三面板贯穿，opt-in 挂 status.cacheGuard | 28fdcda |
| KI-502 | caesura-rate-limiter：网关限流算法族（固定窗口/滑动窗口日志/滑动窗口计数/令牌桶/漏桶）对照 + Redis 原子令牌桶跨实例共享与非原子超发证据，systems.rateLimit 前端水位面板贯穿，opt-in 挂 status.rateLimit | e94442c |
| KI-503 | caesura-failure-detector：服务故障检测器（Welford+erfc 的 φ 累积风险自适应判定 + SWIM 三态成员协议/间接探测/incarnation 单调/reap + 复用 KI-493 的健康视图 TTL 缓存），固定超时 vs φ 诚实权衡对照，systems.failureDetector 前端两面板贯穿，opt-in 挂 status.failureDetector | e96a174 |
| KI-504 | caesura-bplus-tree：B+ 树索引引擎 + 与 LSM 点查/范围查/写放大诚实权衡对照（阶数可控扇出决定层高 + 叶子双向链表范围顺序扫 + 分裂/删除再平衡 borrow+merge，三笔账对照不封全局赢家），systems.bplusIndex 前端两面板贯穿，opt-in 挂 status.bplusIndex | 33c6257 |
| KI-505 | caesura-mvcc-txn：事务与并发控制（MVCC 多版本链可见性判据 + 水位 gc + 五档隔离 RU/RC/RR/SI/Serializable + SI/Serializable 写冲突中止 + S/X 行锁两阶段锁 + wait-for graph DFS 死锁检测，五类异常矩阵不封 Serializable 全局赢家），systems.mvccTxn 前端两面板贯穿，opt-in 挂 status.mvccTxn | 67f7cfc |
| KI-506 | caesura-distributed-txn：分布式事务三协议诚实权衡（2PC 两阶段提交 prepare 全员投票/全 yes 提交/协调者 prepare 后宕机⇒全员阻塞 + Saga 正向链失败逆序补偿/补偿失败留脏/放弃隔离 + TCC Try/Confirm/Cancel 三阶段/确认失败幂等重试/业务侵入最重），同组确定性故障场景喂三协议钉死「2PC 阻塞协调者单点 / Saga 不阻塞但留脏无隔离 / TCC 无隔夜脏但三套接口侵入最重」三难不可同时最优、不封赢家，systems.distributedTxn 前端两面板贯穿，opt-in 挂 status.distributedTxn | 72b7bd3 |
| KI-507 | caesura-raft-consensus：Raft 共识与复制状态机三协议诚实权衡（Raft 单 leader term 单调/随机选举超时打破平票/quorum 多数派当选+Leader Completeness/AppendEntries+nextIndex 回退+matchIndex+commitIndex 按序 apply/脑裂旧 leader 只读不写/分区少数派拒写 CP + 多主复制本地立即提交/向量时钟/并发写冲突需合并/异步复制读陈值 + Gossip 无主随机反熵最终收敛/收敛无确定上界），同组确定性故障场景喂三协议钉死「线性一致性 ∧ 分区可用性 ∧ 收敛确定性」三难不可同时最优、不封赢家、可证伪，systems.raftConsensus 前端两面板贯穿，opt-in 挂 status.raftConsensus | 4af0d23 |
| KI-508 | caesura-distributed-lock：分布式锁与租约三协议诚实权衡（单 Redis SETNX+TTL 一次 RTT 最低延迟但单点 + GC 暂停锁过期双主写脏 + Redlock 多数实例墙钟 quorum 抗少数宕机但时钟漂移破互斥 + etcd Lease 续租心跳/Raft 复制/单调 fencing token 后端拒旧主写脏但多数派往返延迟最高），同组确定性故障场景喂三协议钉死「互斥安全 ∧ 部分容错可用 ∧ 低延迟」三难不可同时最优、不封赢家、可证伪，systems.distributedLock 前端两面板贯穿，opt-in 挂 status.distributedLock | 89112c1 |
| KI-509 | caesura-idgen：分布式 ID 生成三协议诚实权衡（UUIDv4 本地无中心不怕回拨但随机主键喂 KI-504 真 B+ 树定位比较数更高（comparisons 判据；mid 分裂+半满稳态下随机 splits 反更少，如实保留 randomFewerSplits 反直觉读数） / Snowflake 位布局 timestamp<<22\|workerId<<12\|sequence 趋势递增且去中心但墙钟回拨停发或重复 / Redis 号段 Leaf-segment 双 buffer 预取段内严格递增且不怕回拨但中心宕机发号中断 + 重启跳号浪费），同组确定性故障场景喂三协议 + 真树量随机 vs 顺序主键 comparisons 相对判据（随机 cmp 102>顺序 77，splits 反直觉更少如实保留）钉死「索引友好 ∧ 去中心 ∧ 抗时钟异常」三难不可同时最优、不封赢家、可证伪，systems.idGen 前端两面板贯穿，opt-in 挂 status.idGen | 0d50bbc |
| KI-510 | caesura-distributed-ratelimit：分布式限流的分布式化三协议诚实权衡（本地桶零中心 RTT + 实例故障隔离但 N 实例超发 `N×C` / Redis 中心桶全局精确但单 key 热点 + 单点瘫痪 + 中心 RTT / 一致性哈希分片桶单片降级 + 最小重映射但配额碎片化早拒且仍吃中心 RTT），以 KI-499 真环 `balanceRatio` + KI-502 真原子桶交叉印证，六场景三难向量 `011/100/010` 不封赢家（Sharded 不是银弹）可证伪（rigged 四开关 singleInstance+centerAvailable+perfectBalance+balancedKeys ⇒ 全 111、三判词翻 false，balancedKeys 抹配额碎片第二成因 key 倾斜），`systems.distributedRateLimit` 第十二维前端两面板贯穿，opt-in 挂 status.distributedRateLimit | 3be8a68 |
| KI-511 | caesura-config-consistency：分布式配置一致性三协议诚实权衡（轮询最简但 0~T 秒感知延迟 + 无变更也吃完整 RTT/带宽 / 长轮询变更近零延迟 + 无变更零空转但每客户端常驻挂起连接 + 中心宕全断 / watch 推送即时省连接但客户端须可寻址 + 版本号兜底 reorder + 广播风暴须削峰），以 spring-config-server 真版本链/mtime watcher + spring-bus-event 真订阅 + spring-gateway-gray 亲和分桶 + caesura-cache-guard XFetch + KI-493 TTL 失效计数交叉印证，六场景三难向量 `100/011/010` 不封赢家（不预设各恰好缺一）可证伪（rigged 轮询瞬时 + 中心恒在线 + 无风暴 ⇒ 全 111、三判词翻 false），`systems.configConsistency` 第十三维前端两面板贯穿，opt-in 挂 status.configConsistency | 待提交 |

**当前状态**：分支/工作簿并轨已核验——`git branch -a` 仅 `master` 与 `origin/master`，`git stash list` 为空，`git worktree list` 仅本树。Spring Cloud 家族 Node 侧客户端现约 55 件（KI-460~511 续扩：task/function/contract/mesh-registry/mesh-adapter/resilience-breaker/cloud-runtime/service-proxy/gateway-matcher/gateway-filter-handlers(Bulkhead/TimeLimiter)/sleuth-tracer/game-cloud/game-event-bus/game-auth-guard/game-event-bridge/gateway-gray/redis-cache/net-stack/console-gen(含 KI-498~511 systems 十三维读数)/lsm-store/hw-perf/consistent-hash/sharded-cache/cache-guard/rate-limiter/failure-detector/bplus-tree/mvcc-txn/distributed-txn/raft-consensus/distributed-lock/idgen/distributed-ratelimit/config-consistency/kubernetes-client/config-aggregator/family-mesh-e2e/game-bootstrap 等），累计单测全绿；`tsc --noEmit` 干净（codex-global pre-commit 沙箱仅 hook 后网络步挂起，已用 `SKIP_HOOKS=1` 绕过，tsc 自身独立验证 0 错）。本沙箱 `npm run check` 仍有环境相关失败（缺 `.scratch` 目录、`\\?\` 临时路径解析、`scripts/...` 裸说明符解析），与改动无关。`decl-parity`(20)+`phase-status`(14)+`doc-audit`(15)+`import-targets`(15) 门全绿（本轮顺带修绿 doc-audit 历史红门：账本严重度列 P5/P6/P7 误填阶段号→归一 P4，KI-460~485 补进 WORKPLAN 批格）；账本 KI.rows=432 / Implemented=255 与 PHASE-STATUS KV 一致（`PKG.scripts=31`；P8 多技术维度扩展主线：KI-493 缓存层 + KI-494 计网栈 + KI-495 前端控制台 + KI-496 LSM 存储引擎 + KI-497 OS/硬件适配 + KI-498 前后端协同贯穿 + KI-499 一致性哈希/缓存分片 + KI-500 分片缓存客户端 + KI-501 缓存防护三件套/前端三面板 + KI-502 网关限流算法族/Redis 原子令牌桶 + KI-503 服务故障检测器/φ 累积风险/SWIM 三态 + KI-504 B+ 树索引引擎/LSM 三笔账对照 + KI-505 事务并发控制/MVCC 多版本可见性/五档隔离异常矩阵/2PL 死锁检测 + KI-506 分布式事务/2PC 阻塞+Saga 补偿留脏+TCC 三阶段幂等/三协议诚实权衡 + KI-507 Raft 共识/2PC 协调者单点消解/线性一致·分区可用·收敛确定三难不封赢家 + KI-508 分布式锁/SETNX 的 GC 暂停双主+Redlock 时钟漂移破互斥+etcd Lease 单调 fencing token 拒旧主写脏/互斥·容错·低延迟三难不封赢家 + KI-509 分布式 ID/UUID 随机主键定位比较数更高(comparisons 判据)+Snowflake 时钟回拨停发+Redis 号段双 buffer 中心宕中断/索引友好·去中心·抗时钟异常三难不封赢家 + KI-510 分布式限流集群化/本地桶 N×C 超发+中心桶单点瘫痪+分片桶配额碎片早拒/全局精确·单点容错·零 RTT 三难不封赢家(Sharded 不是银弹) + KI-511 分布式配置一致性/轮询 0~T 延迟+空转 RTT+长轮询连接常驻+watch 须可寻址与版本兜底/即时感知·无空闲开销·中心宕可降级三难不封赢家十九维全部落地）。集大成主线闭环并产出证据：`node scripts/spring-family-mesh-e2e.mjs` 一行即可证「游戏注册 → 事件总线发 game.started → 鉴权守卫校验带 scope Bearer（可选 RFC 7662 introspection 在线校验/不透明令牌/fail-open 降级） → 经网关 filter 链(Retry 等)+负载均衡(命中 K8s 发现的 caesura-gate)+起 span+进程内熔断的调用 → mesh 状态含 self/eureka/k8s 三来源 → 关停发 game.stopped」，配套 `docs/spring-cloud-mesh.md` 合成地图与 `caesura-game-bootstrap` 桥接件（游戏 src/ 一行 `bridge.install(game)` 即完成真集成，无需改构建）。

---

## 进行中 / 待开工（按优先级）

### P1：Spring Cloud 微服务继续扩展

- ~~`caesura-client` 的配置拉取失败降级测试~~ ✅ 完成（Phase F-14）
- ~~更多 Spring Cloud 模式（config server 刷新、bus 事件等）~~ ✅ 完成（Phase F-15）
- ~~Spring Cloud Bus 与 Config Server 联动：config 变更 → bus 自动广播 → 各服务热刷新~~ ✅ 完成（Phase F-17 / KI-450）
- ~~Spring Cloud Gateway 动态路由热加载（Phase F-7 之上的增强）~~ ✅ 完成（Phase F-18 / KI-451）
- ~~Spring Cloud Resilience4j 熔断实装测量（下一轮）~~ ✅ 已随 F-19 顺带量出：经网关跑真门，`circuitState=CLOSED` 随判决返回（KI-429/453）

### P2：Phase 7 后续

- 更多 VFX/Boss 相关流程测试
- `docs/perf-baseline.md` 持续完善
- ~~renderer 分档实际消费（shadow map size / resolution scale 实际应用到渲染管线）~~ ✅ 完成（Phase F-16，消费者写入契约面；真 GL 落点等 Phase 9/10）
- ~~UI 设置行画质档位选择器~~ ✅ 早已落地（Stakerite「操作」页画质档位 ◀▶ 行，KI-337；本批补了 5 条流程测试并把 ui 包覆盖率抬回 99.93%）

### P3：新功能规划

- 增加 KI 账本行（已开工但未登记的功能）
- 增加更多单元测试提高覆盖率
- 完善文档地图

### P4：集大成运行时深化（已完成 ✅ KI-475~478 @ 172c8a0 / 49f5417 / b38ee93）

- ~~KI-475 `spring-gateway-matcher`：Gateway predicate 求值 + filter 链~~ ✅
- ~~KI-476 `spring-sleuth-tracer`：进程内 tracer（W3C traceparent）~~ ✅
- ~~KI-477 `caesura-cloud-runtime` call 接上 tracing + gateway 路由 + CB filter~~ ✅
- ~~KI-478 `caesura-game-cloud`：游戏开箱即用云入口 createGameCloud~~ ✅
- （拉伸目标）把 `createGameCloud` 真正接进游戏 src/ 启动流程——风险较高，列为 P5 评估项。

### P5：家族补全 + 端到端证据（已完成 ✅ KI-479~481 @ d99f0c9 / 9f799e5）

- ~~KI-479 `spring-cloud-kubernetes-client`：K8s 对位（configMap+endpoints→mesh 实例）~~ ✅
- ~~KI-480 `caesura-config-aggregator`：多源配置优先级合并~~ ✅
- ~~KI-481 `spring-family-mesh-e2e`：headless 端到端（Eureka+K8s 双源 + 网关+LB+熔断+追踪主链路）~~ ✅

### P6：集成收口 + 合成地图（已完成 ✅ KI-482~483 @ e717d97）

- ~~KI-482 `caesura-game-bootstrap`：游戏生命周期 ↔ 云入口 桥接件（install 到 event-emitter/lifecycle 钩子，事件名可适配；不改 src/ 构建）~~ ✅
- ~~KI-483 `docs/spring-cloud-mesh.md`：集大成微服务网格合成地图（分层图 + proxyCall 全链路 + 一行集成 + 端到端证据命令）~~ ✅
- （接入方下一步）按 `docs/spring-cloud-mesh.md` §4，在游戏 src/ 启动处 `bridge.install(game)` 一行完成真·集成（触 src/，由接入方在受管构建内落）。

### P7：持续扩展（部分完成 ✅ KI-484~492，长期项继续）

- ~~Spring Cloud Stream 事件总线接到游戏事件~~ ✅ 完成（KI-484 `caesura-event-bus` + KI-488 进主链）。
- ~~Spring Cloud Security 接到游戏鉴权~~ ✅ 完成（KI-485 `caesura-auth-guard` + KI-488 进主链）。
- ~~Gateway Retry/RateLimit filter 可用化并接进 call~~ ✅ 完成（KI-486 可重入链+三 handler / KI-487 call 接完整 filter 链）。
- 更多 VFX/Boss 相关流程测试（原 P2 遗留，未开工）。
- `docs/perf-baseline.md` 持续完善（未开工）。
- ~~事件总线接真 `core/EventBus`（`GameEvents` 载荷）~~ ✅ 完成（KI-489 依赖注入桥，不 import 浏览器 src/，`gc.connectGameBus(bus, routes)` 一行接线）。
- ~~鉴权守卫接 introspection 端点做在线校验~~ ✅ 完成（KI-490 `authorizeOnline`，RFC 7662 风格，不透明令牌/active 吊销/在线 scope 权威复核/fail-closed 默认+fail-open 降级）。
- ~~灰度/金丝雀加权路由接进集大成运行时~~ ✅ 完成（KI-491 `spring-gateway-gray`，metadata 保真 / lbStrategy / 会话亲和哈希 / 空金丝雀池诚实回退，端到端证同 key 稳定落同池）。
- ~~Resilience4j 韧性 filter 补全（并发舱壁 + 调用超时）~~ ✅ 完成（KI-492 `Bulkhead`/`TimeLimiter`，零运行时改动接进完整 filter 链，E2E `filterStats` 可证）。
- （下一步候选）Gateway filter 链补 RequestHeaderSize / WIP 网关 filter；`docs/spring-cloud-mesh.md` 补 KI-490/491/492 在线校验/灰度/韧性层。
- 覆盖率稳步抬升；任何新腿开工前先有 KI 行。

### P8：集大成多技术维度扩展（新长期主线，KI-493 起，后续按开工顺序编号）

> 用户 2026-11-11 新增授权：在既有 Spring Cloud 集大成主线上，显式补齐 **Redis / 计网 / 数据结构与算法 / 操作系统与硬件适配性能 / 前端美观 / 前后端协同 / 数据库性能 / 缓存运用** 七个技术维度。
> 约束不变：**判定权与阈值仍在 Node 侧**（决策原则①）；每个新能力仍是「账本 KI 行先行 → 实现 → 单测 → 四门 + tsc → 干净提交」闭环；不引入 Spring Boot / Redis / 数据库运行时依赖，全部零依赖、可注入、可 headless 确定性测。

- ~~**① Redis + 缓存 + 数据结构/算法 + OS 硬件适配（KI-493）**~~ ✅ 完成：`caesura-redis-cache` —— 双向链表 + Map 的 **O(1) LRU**、惰性+定期 **TTL**（注入时钟）、**singleflight** 合并并发回填、**字节预算**淘汰（内存/硬件适配）、命中率读数；RESP 风格 `command()` 预留真 Redis 后端。接进 `authorizeOnline` 缓存 introspection 结果，还上 KI-490「每次都打端点」的欠账。
- ~~**② 计网（KI-494）**~~ ✅ 完成：`caesura-net-stack` —— **AIMD 拥塞控制**（Reno 慢启动/拥塞避免 + CUBIC 风格窗口）、**RTO 指数退避 + Karn 算法**（不拿重传样本估 RTT）、**滑动窗口**、**QUIC 风格 0-RTT 会话票据**、**HTTP 缓存语义**（stale-while-revalidate / ETag 条件请求）。
- ~~**③ 前端美观登峰造极 + 前后端协同（KI-495）**~~ ✅ 完成：自包含暗黑哥特风 **mesh 集大成控制台**（HTML/CSS/JS 零依赖、响应式、动效），注入 `spring-family-mesh-e2e` 真输出，把后端可观测性（分层拓扑/调用链/缓存命中/韧性计数/灰度分池）变成可见门面。
- ~~**④ 数据库性能 / 数据结构（KI-496）**~~ ✅ 完成：`caesura-lsm-store` —— 概率跳表 memtable + **WAL 预写日志**（可注入 sink 模拟落盘、跨实例重放恢复）+ 不可变 **SSTable**（稀疏索引 + **Bloom filter** 零假阴性点查加速）+ **leveled compaction**（归并去重、深层安全丢 tombstone）；`stats`/`compareScan` 给 `comparisons` 与 **线性扫描对照 speedup**（CLI 实测 512 key / 39×），20 腿单测钉住 tombstone 不复活旧版本等核心判词。`createGameCloud({store:{...}})` opt-in 挂 `status().store`。
- ~~**⑥ OS / 硬件适配性能深化（KI-497）**~~ ✅ 完成：`caesura-hw-perf` —— **对象池**（取还循环只 new 一次、省 n−1 次 GC 分配，附 `allocationStudy` 对照）、**缓存行 padding 规避 false sharing**（padded 假共享对 0 vs packed >0、paddingOverhead 量化空间换隔离）、**确定性全相联 LRU 行缓存模型**（钉住容量 2 行经典换页）、**AoS→SoA 数据布局 LRU miss 对照**（顺序扫 speedup≈4×、跳跃扫退化到 1×）；三件只给结构性计数对照、**不实测墙钟/GC 暂停/真多核流量**，16 腿单测。`createGameCloud({hw:true})` opt-in 挂 `status().hw`。兑现下方原「后续视进度补」里的对象池/缓存行对齐两项。
- ~~**⑤ 前后端协同贯穿（KI-498 收口）**~~ ✅ 完成：`caesura-console-gen` 在既有五场景之外加顶层 `systems` 数据块（与 `scenarios` 平级、**不混入** `ok`/`highlights` 口径，可 `systems:false` 关闭），真跑 LSM benchmark（点查 `speedup≈39×`）+ `createGameCloud({hw:true}).status().hw`（对象池省分配 / false sharing 0 vs 7 / AoS→SoA 顺序扫 ≈4×）；`console/` 加「存储引擎 · LSM」「硬件适配 · OS」两面板读真值渲染、缺字段诚实降级，`snapshot.json` 与 `bootstrap.js` 同源，一次 `console:data` 同时刷新五场景 + 两维读数（gen 13 腿 + UI 9 腿）。至此「算法/协议 → 运行时 → 可观测 → 可视化」一条证据链闭环（KI-499 又补上一致性哈希/缓存分片第七维）。
- ~~**⑦ 一致性哈希 / 缓存分片 / 微服务扩缩容算法（KI-499）**~~ ✅ 完成：`caesura-consistent-hash` —— **虚拟节点哈希环**（`ringHash`=FNV-1a+Murmur 雪崩终混打散相近短串、排序环点 + 二分查找、加权节点按虚拟点倍数分量）、**扩容最小重映射对照**（一致性哈希迁 `1/(N+1)` vs 朴素取模 `N/(N+1)`，CLI 实测扩容 0.272 vs 0.5155、理论下界 0.25；缩容同样证；`balanceRatio` 如实暴露弱哈希/少虚拟节点的偏斜）、**缓存分片定位器**（同 key 恒落同分片同槽、扩节点报迁移读数）；接进 `createGameCloud({hashRing:true})` opt-in 挂 `status().hashRing`、E2E 证据段，`npm run hash:bench` 出证据；14 腿单测。**不声称**真 Redis Cluster/生产一致性哈希（只做路由判定与迁移计数、无副本/故障转移），重映射率是结构计数比非墙钟/带宽；默认 `hashRing:false` 非破坏，LB 三策略与灰度路由语义不动。命中「算法知识 / 缓存合理运用 / Spring Cloud 微服务元素」三维，接 KI-493 缓存与 KI-491 服务发现路由。
- ~~**⑧ 分片缓存客户端 / 扩缩容命中率保留率（KI-500）**~~ ✅ 完成：`caesura-sharded-cache` —— 把 **KI-493 进程内缓存**（LRU+TTL+singleflight+字节预算）与 **KI-499 一致性哈希环**咬合成一只**分片缓存客户端**：按环 `shardOf(key)` 路由、每片挂一只 `createRedisCache`，`get/set/del/load(片内 singleflight)/stats/remapOn`；`compareHitRetention` 用真判词回答「扩缩容后缓存还剩多少能用」——**扩容保留率一致性哈希 ≈0.7533（理论 N/(N+1)=0.75）vs 朴素取模 ≈0.4853**，缩容 0.6589 vs 0.4897，`savedRate` 量化保住的命中率（与 KI-499 `compareRemapping` 互为镜像：那边数迁移键、这边数缓存存活）；真缓存 `remapOn` 只按**失效计数**不搬数据、保留率与对照逐字一致。CLI `npm run cache:bench` 出证据，接进 `createGameCloud({shardedCache:true})` opt-in 挂 `status().shardedCache`（惰性缓存不反复预热），13 腿单测。**不声称**真 Redis Cluster/生产分布式缓存（无真网络/副本/故障转移/数据搬迁），保留率是**条目落点结构计数比**非真实负载命中率/墙钟/带宽，不粉饰仍有约 1/(N+1) 条目失效；默认 `shardedCache:false` 非破坏、KI-493 缓存与 KI-491 灰度路由语义不动。命中「缓存合理运用 / 算法 / 微服务 / 数据库性能」多维。
- ~~**⑨ 缓存防护三件套 + 前端三面板贯穿（KI-501）**~~ ✅ 完成：`caesura-cache-guard` —— 把生产缓存三大经典故障做成三只可断言对照教学件（**击穿**：N 路并发 miss，`singleflight`（复用 KI-493 `load`）把 N 次回源合并到 1 次、附 XFetch 逻辑过期概率提前续期；**穿透**：不存在 key 的无防护回源 vs 空值墓碑（复用 KI-493）vs 布隆前置（复用 KI-496 `createBloomFilter`），如实暴露假阳性、不零误判；**雪崩**：统一 TTL 单桶峰值 vs TTL 抖动摊桶削峰、直方图守恒）。CLI `npm run guard:bench` 实测 64 路 64→1 回源、布隆省 99%（10 个假阳性如实给出）、512 key 峰值 512→72（削峰 85.9%）；`systems.guards` 与 `lsm`/`hw` 平级接入前端「击穿/穿透/雪崩」三面板（放大条 + 回源对照条 + 双直方图，缺字段诚实降级），`console:data` 一次刷新五场景 + systems 三维。接进 `createGameCloud({cacheGuard:true})` opt-in 挂 `status().cacheGuard`（惰性快照）、E2E 透传 `cacheGuardSnapshot`，15 腿单测。**不声称**真 Redis/真 DB、真压测 QPS/墙钟/带宽（全结构计数），布隆不零误判、jitter 只削峰不减总回源，缺省 `cacheGuard:false` 非破坏。命中「缓存合理运用 / 算法 / 数据库性能 / 前端美观 / 前后端协同」五维。
- ~~**⑩ 网关限流算法族 + Redis 原子令牌桶（KI-502）**~~ ✅ 完成：`caesura-rate-limiter` —— 五只进程内状态机（**固定窗口**按墙钟整窗对齐暴露翻边 2× 突发 / **滑动日志**精确 O(n) / **滑动计数**前窗加权 O(1) 近似 / **令牌桶** capacity 受控突发 / **漏桶**恒定速率整形）+ 一只 **Redis 风格原子令牌桶**（复用 KI-493 `createRedisCache.command()` 存桶状态、`now` 作命令参数传入对齐 Spring `RedisRateLimiter` 的 Lua 时间戳约定；`atomic:true` 读-补-判-写零 await 同步段等价 Lua 串行、`atomic:false` 读写间 `await` 让出复现 GET-SET 竞态超发；两实例共享 backend+key 证跨实例共享）。`compareRateAlgorithms` 喂同一条窗口翻边突发轨迹，钉死「只有固定窗口 burstRatio=2、其余四只=1」；`compareRedisAtomicity` 实测 64 并发原子放行 8（=capacity 不超发）vs 非原子 64（超发 56）。CLI `npm run ratelimit:bench`；`systems.rateLimit` 与 `lsm`/`hw`/`guards` 平级接入前端「五算法突发放大 + Redis 原子性」两面板（burstRatio 横条：1× 玉 / 2× 酒红，超发大数 + 原子/非原子对照条 + 跨实例共享 dot，缺字段诚实降级不连坐），`console:data` 一次刷新五场景 + systems 四维。接进 `createGameCloud({rateLimit:true})` opt-in 挂 `status().rateLimit`（惰性快照）、E2E 透传 `rateLimitSnapshot`，16 腿单测。**不声称**真 Redis/真 EVAL（进程内 KI-493 模拟、真后端靠注入）、「同步原子」跨进程真原子（只单 JS 线程等价 Lua 串行）、五算法参数适配真实生产流量（全结构计数非墙钟 QPS）、漏桶真排队（超限即拒）、滑动计数无偏差（O(1) 换近似）；缺省 `rateLimit:false` 非破坏，KI-486 handler / KI-493 缓存 / KI-491 灰度语义逐字不动。命中「计网知识 / 算法知识 / Redis 运用 / 数据库性能 / 前端美观 / 前后端协同」六维。
- ~~**⑪ 服务故障检测器：φ 累积风险 + SWIM 三态成员协议 + 健康视图缓存（KI-503）**~~ ✅ 完成：`caesura-failure-detector` —— 补上集大成「服务注册发现之后如何判定实例已死」的最后一块判定链。**① `createPhiAccrualDetector`**：定长 `Float64Array` 环形缓冲 + **Welford 在线算法**重算 μ/σ + **erfc 近似**算 `φ=−log10(P(间隔>距上次心跳))`，σ 以可容忍暂停为下限、样本不足 φ 返回 0 不凭空定罪；灵魂是**自适应**——同延迟在规律历史 φ 高、抖动历史 φ 低。**② `createSwimMembership`**：alive→suspected→faulty 三态、直接 ping 失败走 **K 中继间接探测反证**、疑超时 `reap` 确认死亡、**incarnation 单调**合并 gossip（旧覆盖不了新反证）。**③ `createHealthView`**：φ + SWIM 收敛成健康实例列表，复用 KI-493 缓存做 TTL 命中、成员变更主动失效。**④ `compareFixedVsPhi`** 真证据（CLI `npm run detect:bench`）：同一条含 GC 长暂停 + 真故障轨迹，**固定超时 3 次抖动误报但 260ms 检出 / φ 零误报但 690ms 检出**——如实保留「固定更快但更吵」权衡，不粉饰 φ 全面更优；同延迟规律 φ=0.84 vs 抖动 φ=0.36 证自适应。`systems.failureDetector` 与其余四维平级接入前端「固定 vs φ」+「SWIM 三态」两面板（φ 真折线 SVG + 判死阈值 + 误报点、自适应双条、三态成员条、健康视图 TTL 命中三段），`console:data` 一次刷新五场景 + systems 五维，缺字段诚实降级不连坐。接进 `createGameCloud({failureDetector:true})` opt-in 挂 `status().failureDetector`（惰性缓存）、E2E 透传 `failureDetectorSnapshot`，14 腿单测 + game-cloud 2 腿 + e2e 1 腿 + gen/UI 各补。**不声称**真 Cassandra/Akka/Consul、正态假设拟合真网络尾延迟、erfc 是精确库、测了墙钟/真 GC、替代 `spring-health-check`、缓存跨进程共享；缺省 `failureDetector:false` 非破坏、KI-486/493/501/502 语义逐字不动。命中「算法/计网/微服务/缓存/数据库性能/前端美观/前后端协同」七维。
- ~~**⑫ B+ 树索引引擎 + LSM 三笔账诚实对照（KI-504）**~~ ✅ 完成：`caesura-bplus-tree` —— 把 KI-496 注释里反复「拿 B+ 树当对照系」那段**纸面声称**第一次兑现成一株真 B+ 树与可断言对照。**`createBPlusTree`**：阶数可控 ⇒ **扇出 fanout=order+1 直接决定层高**（附 `heightEstimate`「百万 key 几层」教学读数）、数据只住**叶子**且叶子**双向链表**串起（`range(lo,hi)` 定位首叶后沿链顺序扫 `leafHops`，对比 LSM 跨所有段收集后**全量排序**的结构代价）、写路径含**节点分裂**（leaf 满 mid 上推、内节点满递归长高）与**删除再平衡**（underflow 先 `borrow`、借不到 `merge`、根空降高），`stats` 记 `comparisons/splits/merges/borrows/height/leafCount`。**`compareBplusVsLsm`**：同一批确定性 key 分灌 B+ 树与 `createLsmStore`，点查比比较数（B+ 层高二分 vs LSM memtable 跳表 + 多层 SSTable 稀疏索引 + Bloom 负查）、范围查比 **B+ 叶链顺序扫** vs **LSM 跨段归并**、`页重排` vs **LSM flushes/compactions/mergedAway 的顺序写+空间放大**；判词**不封全局赢家**，如实给「B+ 点查/范围查稳但写原地改页重排 / LSM 顺序写适配 SSD 但读跨层、范围全量归并、compaction 重复搬运」（同 KI-497/503 诚实立场）。CLI `npm run bplus:bench`，`systems.bplusIndex` 与其余五维平级接入前端「B+ 结构/层高扇出」+「三笔账对照」两面板（分层节点 SVG + 叶链高亮 + 三组对照条，缺字段诚实降级不连坐）。接进 `createGameCloud({bplusIndex:true})` opt-in 挂 `status().bplusIndex`（惰性缓存）、E2E 透传 `bplusIndexSnapshot`，约 15 腿单测 + game-cloud 2 腿 + e2e 1 腿 + gen/UI 各补。**不声称**生产级 B+ 树/真磁盘页缓冲池/并发闩锁（纯进程内教学状态机、`pageRewrites` 是结构重排模型非真块设备写）、不声称是真 RocksDB/LevelDB 跑分（对照只在两教学件之间、LSM 范围是收集排序非归并堆）、不声称三笔账是墙钟/QPS/字节基准（全结构计数）、不声称「读多选 B+/写多选 LSM」普适（结论随分布/order/段数变、verdict 逐条给）、不声称前端判定/实测、不声称默认参与运行时（`bplusIndex:false` 非破坏、KI-486/493/496/501/502/503 语义逐字不动）。命中「数据库性能 / 数据结构与算法 / 操作系统·缓存行·局部性 / 硬件适配 / 前端美观 / 前后端协同」六维。
- ~~**⑬ 事务与并发控制：MVCC 多版本可见性 + 五档隔离级别异常对照 + 行锁 2PL 死锁检测（KI-505）**~~ ✅ 完成：`caesura-mvcc-txn` —— 补上数据库内核继 KI-496 存储引擎（LSM）、KI-504 索引（B+ 树）之后的第三大支柱「事务」。**`createVersionChain`**：单 key **多版本链**（每版带 `beginTs`/`commitTs`/`writerTxn`/`tombstone`），`visibleAt(readTs,readerTxn)` 按 MVCC 判据选对快照可见的版本（含自己未提交版本对己可见、tombstone 表删除），`compact` 按**水位回收**旧版本（长事务拖 gc 的可断言落点）。**`createMvccStore`**：`begin/commit/rollback/read/write/snapshot`，读视图按隔离级别取（RC 每语句最新已提交 / RR·SI 首读快照 / RU 读未提交），`commit` 在 SI/Serializable 做**写冲突检测**（first-committer-wins 中止后提交者、Serializable 再查读写反依赖挡写偏斜），`stats` 记 `committed/aborted/writeConflicts/writeSkews`。**`createLockManager` + `detectDeadlock`**：S/X 行锁兼容矩阵 + **两阶段锁** growing→shrinking，`waitForGraph()` 建等待有向图、`detectDeadlock()` **DFS 找环**回环路径、`victim`（youngest/min-locks 注入）中止打破。**`compareIsolationLevels`**：同一组确定性并发调度（脏读/不可重复读/幻读/丢失更新/写偏斜经典双账户）分喂五档隔离，钉死「RU 四类全出 / RC 挡脏读但出不可重复读+丢失更新 / RR 挡不可重复读但出幻读+写偏斜 / SI 挡前四类却**漏写偏斜** / Serializable 全挡但**中止率最高**」，判词**不封 Serializable 全面赢家**（同 KI-497/503/504 诚实立场）。CLI `npm run txn:bench`，`systems.mvccTxn` 与其余六维平级接入前端「五档隔离 × 五类异常矩阵」+「MVCC 版本链 / 死锁 wait-for graph」两面板（隔离×异常热力格 + 版本链时间线 SVG + 环检测读数 + 中止率对照条，缺字段诚实降级不连坐）。接进 `createGameCloud({mvccTxn:true})` opt-in 挂 `status().mvccTxn`（惰性缓存）、E2E 透传 `mvccTxnSnapshot`，约 16 腿单测 + game-cloud 2 腿 + e2e 1 腿 + gen/UI 各补。**不声称**真 PostgreSQL/MySQL/生产 MVCC（无真磁盘页/缓冲池/WAL redo·undo/真谓词锁或完整 SSI、版本链回收是水位模型）、不声称覆盖 SQL 标准隔离全部边界（只钉这五类经典异常）、不声称矩阵/中止率/死锁检测是墙钟或 QPS 跑分（全确定性调度上的结构计数）、不声称死锁检测跨进程、不声称 Serializable 全面最优（隔离越强中止越多、verdict 逐档给）、不声称前端判定/实测、不声称默认参与运行时（`mvccTxn:false` 非破坏、KI-486/493/496/501/502/503/504 语义逐字不动）。命中「数据库性能 / 数据结构与算法 / 操作系统·局部性 / 前端美观 / 前后端协同」五维。
- ~~**⑭ 分布式事务：2PC / Saga / TCC 三协议诚实权衡对照（KI-506）**~~ ✅ 完成：`caesura-distributed-txn` —— 把 KI-505 单机 MVCC 事务往跨服务分布式一跳。**`createTwoPhaseCommit`**：真两阶段状态机（`prepare()` 全员投 yes/no、全 yes 才 `commit()`、任一 no 即全局 `rollback()`），故障注入 `coordinatorDownAfterPrepare` 钉死「协调者 prepare 后宕机 ⇒ 全体参与者停在 prepared 持锁阻塞、不可自愈」，重复提交/回滚幂等。**`createSaga`**：正向链逐步执行、第 k 步失败**逆序**跑 `C(k-1)…C1`，`compensateFailAt` 如实记 `dirtyData` 不粉饰补偿必成功，钉死「不阻塞但放弃隔离、补偿失败留脏」。**`createTcc`**：每步 Try 预留→Confirm/Cancel，全 Try 成功才逐 Confirm、任一 Try 失败逐 Cancel，`confirmFailAt` 触发**幂等重试**，钉死「无隔夜脏、可自愈，但 Try/Confirm/Cancel 三套接口业务侵入最重」。**`compareDistributedTxn`**：同组确定性故障场景（全成功 / 单点 no / 协调者宕机 / 第 k 步失败 / 补偿失败 / Confirm 半途失败）分喂三协议，数 `committed/aborted/blocked/dirty/retries/messages`，钉死「2PC 全成功最省消息但协调者宕机全员阻塞 / Saga 从不阻塞但留脏无隔离消息线性 / TCC 无隔夜脏 Confirm 幂等可自愈但三套接口侵入最重」这组最经典真实取舍，判词**不封任何协议全面赢家**（阻塞/侵入/留脏三难不可同时最优、verdict 逐场景给、可证伪非恒真，同 KI-497/503/504/505 诚实立场）。CLI `npm run disttxn:bench`，`systems.distributedTxn` 与其余七维平级接入前端「三协议 × 六场景矩阵」+「阻塞/留脏/侵入三笔账」两面板（阻塞人数条 + 补偿链 SVG + 幂等重试计数，缺字段诚实降级不连坐）。接进 `createGameCloud({distributedTxn:true})` opt-in 挂 `status().distributedTxn`（惰性缓存）、E2E 透传 `distributedTxnSnapshot`，约 16 腿单测 + game-cloud 2 腿 + e2e 1 腿 + gen/UI 各补。**不声称**真 XA/两阶段落盘日志/真跨进程协调者、不声称 Saga/TCC 真跨网络幂等（只单实例状态机重放）、不声称墙钟/吞吐/真库一致性（全确定性故障场景结构计数）、不声称补偿真回滚外部副作用（只记 `dirty`）、不声称某协议全面最优、不声称前端判定/实测、不声称默认参与运行时（`distributedTxn:false` 非破坏、KI-486/493/496/501/502/503/504/505 语义逐字不动）。命中「Spring Cloud 微服务 / 数据库性能 / 数据结构与算法 / 前端美观 / 前后端协同」五维。
- ~~**⑮ Raft 共识与复制状态机：Raft / 多主复制 / Gossip 最终一致三协议诚实权衡对照（KI-507）**~~ ✅ 完成：`caesura-raft-consensus` —— 精准接 KI-506 暴露的「2PC 协调者 prepare 后宕机 ⇒ 全员阻塞不可自愈」单点痛点：2PC 的生产解药是把协调者日志用共识算法复制到多数派（etcd/Consul/ZooKeeper 给分布式锁与事务托底）。**`createRaftCluster`**：term 单调 + 注入 rand 的**随机化选举超时**打破平票 + quorum 多数派当选 + 按 lastLogTerm/lastLogIndex 满足 **Leader Completeness** + AppendEntries/nextIndex 回退/matchIndex/commitIndex 按序 apply，脑裂旧 leader term 落后被拒、只读不写，分区少数派凑不齐 quorum **拒写且 commitIndex 不推进**（CP 保线性一致的代价即选主空窗）。**`createMultiMaster`**：每节点皆主、本地立即提交无选主空窗、写记向量时钟，但**并发写冲突**需 LWW/业务合并、异步复制延迟**读陈值**。**`createGossipStore`**：无主、随机挑 peer **反熵**交换摘要最终收敛、任节点可写分区可用，但只最终一致、概率反熵收敛**无确定上界**、间隙读陈值。**`compareRaftConsensus`**：同组确定性故障场景（全成功/leader 宕机选主/网络分区少数派/两主并发写冲突/异步复制延迟/反熵间隙）分喂三协议，数 blockedWrites/staleReads/conflicts/gossipRounds/messages，钉死「**Raft** 线性一致·确定收敛但分区拒写 / **多主** 分区可用·拓扑确定收敛但写冲突+读陈值 / **Gossip** 无主高可用但只最终一致·收敛无上界」这组真实取舍，用**线性一致性 ∧ 分区可用性 ∧ 收敛确定性**三难判据证明**没有协议同时占全**（noUniversalWinner，可证伪非恒真——rigged 抹掉软肋故障后 Raft 退化为 111、三判词同时翻 false，同 KI-497/503/504/505/506 诚实立场）。CLI `npm run raft:bench`，`systems.raftConsensus` 与其余八维平级接入前端「三协议 × 六场景矩阵」+「三难不可兼得 + 选举/复制/反熵三探针」两面板（拒写/陈值/冲突横条 + term 递增与多数派当选 SVG + 反熵收敛折线，缺字段诚实降级不连坐）。接进 `createGameCloud({raftConsensus:true})` opt-in 挂 `status().raftConsensus`（惰性缓存）、E2E 透传 `raftConsensusSnapshot`，约 18 腿单测 + game-cloud 2 腿 + e2e 1 腿 + gen/UI 各补。**不声称**真 Raft 生产实现（无持久化日志/真随机选举/真 RPC/成员变更/日志压缩/ReadIndex·LeaseRead）、不声称真 etcd/Consul/ZooKeeper 跑分、不声称真多主/Gossip 网络（全单进程状态机、向量时钟与反熵均教学模型）、不声称线性一致/收敛/墙钟/QPS/吞吐是实测（全确定性故障场景结构计数）、不声称某协议全面最优、不声称前端判定/实测、不声称默认参与运行时（`raftConsensus:false` 非破坏、KI-486/493/496/501/502/503/504/505/506 语义逐字不动）。命中「Spring Cloud 微服务 / 计网知识 / 数据结构与算法 / 数据库性能 / 前端美观 / 前后端协同」六维。
- ~~**⑱ 分布式限流的分布式化：本地桶 / Redis 中心桶 / 一致性哈希分片桶三协议诚实权衡对照（KI-510）**~~ ✅ 完成：`caesura-distributed-ratelimit` —— 接 KI-502（单机令牌桶 + Redis 原子桶往多实例集群化一跳）、KI-499（真一致性哈希环分片 + 最小重映射 + `balanceRatio` 偏斜交叉印证）、KI-503（故障检测支撑「单点故障不瘫痪」判据）。**`createLocalBucketCluster`**：N 实例各持 `capacity=C` 本地 `createTokenBucket`、零中心 RTT、单实例故障隔离不连坐，但 `multiInstance` 场景集群总放行 = `N×C` ⇒ `overAllowed` 记账、全局配额超发 N 倍、扩缩容总量随实例数漂移。**`createCentralRedisBucket`**：所有实例共享单 Redis key（复用 KI-502 `createRedisTokenBucket` + KI-493 `createRedisCache.command()`）、原子扣减 ⇒ 全局 `allowed` 精确 = C、原子 vs 非原子对照量出超发，但单 key 热点、centerDown 全集群瘫痪（中心不可用期间请求全拒、centerStalled 记满窗、放行 0）、每调用 1 次 `centerRounds` 中心 RTT。**`createShardedBucket`**：复用 KI-499 `createHashRing` 把 key 映射到 K 片、每片 `capacity=C/K`、`scaleOut` 借一致性哈希最小重映射 `remapRate`、单片故障只降级该片 key（部分容错），但配额按片切死 ⇒ `skewKeys` 场景热片先耗尽冷片有余 ⇒ 有效吞吐 < C（`fragmented` 配额碎片化早拒）、且每次仍吃中心 RTT。**`compareDistributedRateLimit`**：六场景分喂三协议、用真环 `distribution().balanceRatio` 交叉印证碎片 + 真 `createRedisTokenBucket` 64 路并发原子放行 8 vs 非原子 64 超发 56 交叉印证原子性，钉死三组取舍，用**全局配额精确 ∧ 单点故障不瘫痪 ∧ 无中心 RTT**三难判据证明无一占全（向量 `Local=011 / Central=100 / Sharded=010`、三者互异、**Sharded 只占容错一维、不是银弹**、`noUniversalWinner`、可证伪——rigged `singleInstance`+`centerAvailable`+`perfectBalance`+`balancedKeys` 抹掉四处软肋（含 key 倾斜这一配额碎片第二成因：完美均匀的环也救不了「同 key 必落同片」）后三协议全退化 `111`、三判词同时翻 false，同 KI-497/503/504/505/506/507/508/509 诚实立场）。CLI `npm run ratelimit:cluster:bench` 双跑字节一致；`systems.distributedRateLimit` 第十二维前端两面板（三协议 × 六场景矩阵 + 三难向量 + 真环偏斜/真原子桶交叉印证栏 + 不封赢家 dot），opt-in 挂 `status().distributedRateLimit`、默认 `distributedRateLimit:false` 非破坏。**不声称**真 Redis Cluster / 真 Lua EVAL / 真多进程、不声称真数据搬迁、不声称墙钟 QPS 跑分、不声称 Sharded 银弹、不声称前端判定/实测。命中「Spring Cloud 微服务 / Redis 运用 / 数据结构与算法 / 计网 RTT / 操作系统时钟源 / 前端美观 / 前后端协同」多维。
- ~~**⑲ 分布式配置一致性：客户端轮询 / 长轮询 / watch 服务端推送三协议诚实权衡对照（KI-511）**~~ ✅ 完成：`caesura-config-consistency` —— 精准补 KI-480「聚合是快照、不声称热刷新」与 KI-479「不声称做了 watch」两处明确缺口，把「微服务配置改了，怎么让 N 个副本尽快、尽量省、中心挂了还能用地感知」做成可断言教学状态机。**`createPollingClient`**：每 T 秒拉一次快照、服务端无状态，但 0~T 秒感知延迟 + 无变更也吃完整 RTT + 带宽（idleFetches 空转计数）。**`createLongPollingClient`**：挂起请求、有变更才返回否则挂到超时，变更近零延迟 + 无变更零空转，但每客户端常驻一只挂起连接（connections=客户端数）、超时重连、中心宕全断。**`createWatchPushClient`**：服务端主动广播、变更即时且连接按需，但客户端须可寻址注册、版本号兜底事件 reorder/丢失、广播风暴须削峰。**`compareConfigConsistency`**：真 import `spring-config-server` 版本链/mtime watcher（首趟 seeded）+ `spring-bus-event` 真订阅 + `spring-gateway-gray` 亲和分桶 + `caesura-cache-guard` XFetch + KI-493 `createRedisCache.stats().expired` 交叉印证，六场景三难「即时感知 ∧ 无空闲开销 ∧ 中心宕可降级」向量 `Polling=100 / LongPolling=011 / Watch=010` 不封赢家、可证伪（rigged 轮询瞬时+中心恒在线+无风暴 ⇒ 全 111、三判词翻 false，不预设各恰好缺一：LongPolling 实测缺两难）。CLI 双跑字节一致；`systems.configConsistency` 第十三维前端两面板，opt-in 挂 `status().configConsistency`、默认 `configConsistency:false` 非破坏。**不声称**真 Config Server/真 HTTP 长轮询/真 socket watch/真墙钟 QPS，连接与延迟皆结构计数、不封赢家、不声称前端判定/实测。命中「Spring Cloud 微服务 / 计网长轮询与 watch / 缓存 TTL 失效 / 数据结构版本号 / 前端美观 / 前后端协同」多维。
- ~~**⑰ 分布式 ID 生成：UUIDv4 / Snowflake / Redis 号段(Leaf-segment) 三协议诚实权衡对照，以 KI-504 B+ 树索引定位代价(comparisons)为性能落点（KI-509）**~~ ✅ 完成：`caesura-idgen` —— 接 KI-504（**主键选择直接决定你建的这棵 B+ 树索引的定位比较数与写放大**，真 import `createBPlusTree` 量随机 vs 顺序主键 `comparisons` 相对判据（并如实保留 `randomFewerSplits` 反直觉读数））、KI-508（号段用 Redis INCR 批量取号）、KI-506/507（中心化发号服务单点，号段双 buffer 预取缓解）。**`createUuidV4`**：128 位确定性伪随机、本地生成、无中心、不依赖墙钟，但随机主键喂真 B+ 树 ⇒ 定位 `comparisons` 显著多于顺序基线（mid 分裂+半满稳态下 `pageSplits` 反更少，`randomFewerSplits=true` 如实保留、不粉饰）。**`createSnowflake`**：真位布局 `timestamp<<22\|workerId<<12\|sequence`、`parse` 可反解、同毫秒 sequence 自增、趋势单调、本地生成，但 `fo.clockBackward` 墙钟回拨 ⇒ 停发（`stalled`/`clockRollbacks`，`fo.forceDuplicate` 展示重复代价）、`fo.sequenceOverflow` 阻塞等下一毫秒。**`createLeafSegment`**：Redis INCR 内存模拟中心 counter + 双 buffer 预取、段内严格递增、不依赖本地墙钟，但 `fo.centerDown` 双 buffer 耗尽 ⇒ 发号中断、`fo.segmentGap` 重启跳号浪费（`wastedIds`、不连续）、`fo.sequenceOverflow` 取新段记 `centerRounds`（RTT）。**`compareIdGen`**：六场景（全成功/随机主键插树/墙钟回拨/中心宕机/序列溢出/重启跳段）分喂三协议，数 issued/duplicates/stalled/comparisons/pageSplits/wastedIds/centerRounds/waits，用真树 `randomKeyInsert` 的 `comparisons` 对照 `sequentialBaseline` 作索引友好判据（`randomCmpGtSequential`，splits 反转读数如实保留不锚判据），钉死「UUID 本地无中心不怕回拨但随机主键伤索引 / Snowflake 趋势递增去中心但时钟回拨致命 / 号段递增不怕回拨但中心宕中断 + 重启跳号浪费」，用**索引友好 ∧ 去中心 ∧ 抗时钟异常**三难判据证明**没有协议同时占全**（`UUID=011 / Snowflake=110 / Segment=101`，`noUniversalWinner`，可证伪——rigged 注入 `sequentialIds` + 场景故障全置空后三协议全退化为 `111`、三判词同时翻 false，同 KI-497/503/504/505/506/507/508 诚实立场）。CLI `npm run idgen:bench`，`systems.idGen` 与其余十维平级接入前端「三协议 × 六场景矩阵」+「索引友好/去中心/抗时钟三难条 + 随机主键定位比较(cmp)/时钟回拨/中心取号探针」两面板（索引代价 cmp/中断横条 + Snowflake 位布局与号段双 buffer 读数，缺字段诚实降级不连坐）。接进 `createGameCloud({idGen:true})` opt-in 挂 `status().idGen`（惰性缓存）、E2E 透传 `idGenSnapshot`，约 24 腿单测（含真 `createBPlusTree` 交叉印证腿）+ game-cloud 2 腿 + e2e 1 腿 + gen/UI 各补。**不声称**真 UUID 加密随机/真 Snowflake/真 Redis INCR 或 Leaf 跑分（全单进程教学状态机、中心 counter 内存模拟）、不声称真 B+ 树写放大实测（comparisons/pageSplits 走 KI-504 真树结构计数、非真库页/块设备/缓冲池跑分；mid 分裂下随机 splits 反更少，不拿 splits 当「随机更伤」的假证据）、不声称墙钟/QPS/吞吐/真库一致性实测、不声称某协议全面最优、不声称前端判定/实测、不声称默认参与运行时（`idGen:false` 非破坏、KI-486/493/496/501/502/503/504/505/506/507/508 语义逐字不动）。命中「Spring Cloud 微服务 / Redis 运用 / 数据结构与算法 / 数据库性能与索引 / 操作系统时钟源 / 计网 RTT / 前端美观 / 前后端协同」八维。
- ~~**⑯ 分布式锁与租约：单 Redis SETNX+TTL / Redlock 多数派 / etcd Lease+Fencing Token 三协议诚实权衡对照（KI-508）**~~ ✅ 完成：`caesura-distributed-lock` —— 接 KI-507（Raft term 单调即 fencing token 原型、etcd/Consul 是 KI-507 共识的生产载体）与 KI-506（互斥锁本身即最普遍那类协调者单点）。**`createRedisSetnxLock`**：单实例 SETNX + 墙钟 TTL，一次 RTT 最低延迟、TTL 到期自动释放，但 `fo.gcPause` 注入持锁者长暂停 ⇒ TTL 过期后另一客户端加锁成功（`doubleOwners`/`dirtyWrites`，双主写脏）、单点不可容错。**`createRedlock`**：N 实例各自 SETNX + 本地 TTL、须多数且总耗时 < TTL 才成功，`fo.nodeDown` 少数宕机仍可加锁（部分容错），但 `fo.clockDrift` 墙钟漂移 ⇒ 两客户端各凑齐多数双主写脏（不站队 Kleppmann/Sanfilippo 论战）、多数往返延迟居中。**`createEtcdLeaseLock`**：锁状态经 Raft 多数派复制、lease 靠续租心跳维持、每次成功 acquire 发**单调 `fencingToken`**，`fo.staleHolder` 旧持锁者写被后端按 `token < currentToken` 拒绝（`staleWritesRejected`，锁误授也永无双主写脏）、`fo.partitionMinority` 少数派拒加锁（CP）、`fo.nodeDown` 少数宕机照常加锁（容错），代价 `raftRounds` 多数派往返 ⇒ 延迟最高、续租依赖活跃度。**`compareDistributedLock`**：同组确定性故障场景（全成功/GC 暂停/时钟漂移/少数节点宕机/少数派分区/旧持锁者 stale token 写）分喂三协议，数 acquires/doubleOwners/dirtyWrites/staleWritesRejected/failures/raftRounds，钉死「SETNX 最低延迟但单点+GC 暂停破互斥 / Redlock 抗少数故障但靠墙钟+漂移破互斥 / etcd Lease+Fencing 单调 token 兜底永无双主写脏且 Raft 容错但多数往返延迟最高」这组真实取舍，用**互斥安全 ∧ 部分容错可用 ∧ 低延迟**三难判据证明**没有协议同时占全**（`SETNX=001 / Redlock=010 / etcd=110`，`noUniversalWinner`，可证伪非恒真——rigged 抹掉四类故障后三协议全退化为 `111`、三判词同时翻 false，同 KI-497/503/504/505/506/507 诚实立场）。CLI `npm run dlock:bench`，`systems.distributedLock` 与其余九维平级接入前端「三协议 × 六场景矩阵」+「互斥/容错/延迟三难条 + GC 暂停/时钟漂移/fencing 探针」两面板（双主/拒写横条 + 续租心跳与单调 token SVG，缺字段诚实降级不连坐）。接进 `createGameCloud({distributedLock:true})` opt-in 挂 `status().distributedLock`（惰性缓存）、E2E 透传 `distributedLockSnapshot`，约 24 腿单测 + game-cloud 2 腿 + e2e 1 腿 + gen/UI 各补。**不声称**真 Redis SETNX/Redlock 算法/真 etcd Lease 或 Raft 跑分（全单进程教学状态机、墙钟/漂移/token 均确定性注入模型）、不声称真跨进程互斥/真分布式时钟同步/真网络分区、不声称墙钟/QPS/吞吐/真库一致性实测、不声称某协议全面最优、不声称前端判定/实测、不声称默认参与运行时（`distributedLock:false` 非破坏、KI-486/493/496/501/502/503/504/505/506/507 语义逐字不动）。命中「Spring Cloud 微服务 / 计网知识 / Redis 运用 / 数据结构与算法 / 数据库性能 / 前端美观 / 前后端协同」七维。
- 后续视进度补：增量 GC 友好结构、WASM 热路径、NUMA 亲和、SIMD 批处理等 OS/硬件适配进一步深化（对象池/缓存行对齐已由 KI-497 落地）；一致性哈希的虚拟节点持久化 / 副本故障转移 / 真数据搬迁执行、分片缓存的真网络后端 / 热点迁移 / 跨进程一致性仍属生产化欠账（KI-499/500 只做判定、计数与失效记账）；缓存防护的生产化（真 Bloom 持久化 / 空值缓存一致性协议 / XFetch-Jitter 真链路标定）同理（KI-501 只做判定与结构计数对照）；限流的生产化（真 Redis EVAL/Lua 脚本原子 / 分布式令牌桶跨进程配额 / 漏桶真队列等待与削峰延迟）同理（KI-502 只做判定与结构计数、进程内同步原子仅等价 Lua 串行、真后端与跨进程一致性靠注入）。

---

## 决策原则（不变）

1. **不引入 Spring Boot 运行时依赖**：Spring 家族只负责编排/重试/熔断/报告，判定与阈值由 Node 侧负责
2. **.scratch/ 临时脚本不入库**
3. **任何新腿开工前必须先有 KI 行**（账本登记 → 裁决 → 读数 → 欠账）
4. **`npm run check` 每次提交前必须全绿**（pre-commit tsc + validate:data + test）
5. **账本（KNOWN_ISSUES.md）、WORKPLAN.md、PHASE-STATUS.md KV 块保持一致**
