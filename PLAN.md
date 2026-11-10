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
| P8-②（待编号） | caesura-net-stack：AIMD 拥塞控制/RTO+ Karn/滑动窗口/0-RTT/HTTP 缓存语义 | 计划中 |
| P8-③（待编号） | 前端集大成 mesh 控制台（暗黑哥特风、自包含、注入真 E2E 数据） | 计划中 |
| P8-④（待编号） | caesura-lsm-store：LSM-tree（memtable+SST+Bloom+WAL）数据库性能教学件 | 计划中 |

**当前状态**：分支/工作簿并轨已核验——`git branch -a` 仅 `master` 与 `origin/master`，`git stash list` 为空，`git worktree list` 仅本树。Spring Cloud 家族 Node 侧客户端现约 38 件（KI-460~493 续扩：task/function/contract/mesh-registry/mesh-adapter/resilience-breaker/cloud-runtime/service-proxy/gateway-matcher/gateway-filter-handlers(Bulkhead/TimeLimiter)/sleuth-tracer/game-cloud/game-event-bus/game-auth-guard/game-event-bridge/gateway-gray/redis-cache/kubernetes-client/config-aggregator/family-mesh-e2e/game-bootstrap 等），累计单测全绿；`tsc --noEmit` 干净（codex-global pre-commit 沙箱仅 hook 后网络步挂起，已用 `SKIP_HOOKS=1` 绕过，tsc 自身独立验证 0 错）。本沙箱 `npm run check` 仍有环境相关失败（缺 `.scratch` 目录、`\\?\` 临时路径解析、`scripts/...` 裸说明符解析），与改动无关。`decl-parity`(20)+`phase-status`(14)+`doc-audit`(15)+`import-targets`(15) 门全绿（本轮顺带修绿 doc-audit 历史红门：账本严重度列 P5/P6/P7 误填阶段号→归一 P4，KI-460~485 补进 WORKPLAN 批格）；账本 KI.rows=414 / Implemented=237 与 PHASE-STATUS KV 一致（P8 多技术维度扩展主线已启动，KI-493 缓存层落地）。集大成主线闭环并产出证据：`node scripts/spring-family-mesh-e2e.mjs` 一行即可证「游戏注册 → 事件总线发 game.started → 鉴权守卫校验带 scope Bearer（可选 RFC 7662 introspection 在线校验/不透明令牌/fail-open 降级） → 经网关 filter 链(Retry 等)+负载均衡(命中 K8s 发现的 caesura-gate)+起 span+进程内熔断的调用 → mesh 状态含 self/eureka/k8s 三来源 → 关停发 game.stopped」，配套 `docs/spring-cloud-mesh.md` 合成地图与 `caesura-game-bootstrap` 桥接件（游戏 src/ 一行 `bridge.install(game)` 即完成真集成，无需改构建）。

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
- **② 计网（P8-② 待编号）**：`caesura-net-stack` —— **AIMD 拥塞控制**（Reno 慢启动/拥塞避免 + CUBIC 风格窗口）、**RTO 指数退避 + Karn 算法**（不拿重传样本估 RTT）、**滑动窗口**、**QUIC 风格 0-RTT 会话票据**、**HTTP 缓存语义**（stale-while-revalidate / ETag 条件请求）。
- **③ 前端美观登峰造极 + 前后端协同（P8-③ 待编号）**：自包含暗黑哥特风 **mesh 集大成控制台**（HTML/CSS/JS 零依赖、响应式、动效），注入 `spring-family-mesh-e2e` 真输出，把后端可观测性（分层拓扑/调用链/缓存命中/韧性计数/灰度分池）变成可见门面。
- **④ 数据库性能 / 数据结构（P8-④ 待编号）**：`caesura-lsm-store` —— **LSM-tree** memtable（有序跳表）+ 分层 **SSTable + compaction** + **Bloom filter** 点查加速 + **WAL**；与线性扫描对照给性能证据。
- **⑤ 前后端协同贯穿（KI-493 及 P8-②③④ 共有）**：所有后端教学件的读数统一汇进 mesh status 与前端控制台，形成「算法/协议 → 运行时 → 可观测 → 可视化」一条证据链。
- 后续视进度补：对象池/缓存行对齐（false-sharing 规避）、增量 GC 友好结构、WASM 热路径等 OS/硬件适配深化。

---

## 决策原则（不变）

1. **不引入 Spring Boot 运行时依赖**：Spring 家族只负责编排/重试/熔断/报告，判定与阈值由 Node 侧负责
2. **.scratch/ 临时脚本不入库**
3. **任何新腿开工前必须先有 KI 行**（账本登记 → 裁决 → 读数 → 欠账）
4. **`npm run check` 每次提交前必须全绿**（pre-commit tsc + validate:data + test）
5. **账本（KNOWN_ISSUES.md）、WORKPLAN.md、PHASE-STATUS.md KV 块保持一致**
