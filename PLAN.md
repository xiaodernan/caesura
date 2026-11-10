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
| Phase F / Spring Cloud | caesura-client 配置客户端 + spring-health-check 探针 + docker-compose | 9abf6c5 |
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
| KI-407 | coverage 棘轮三出口（0/1/2）全部有测试 + 基线落地 | 07399b9 |
| Phase C / F3 | Boss 乐句线 HUD：BossPhraseBar.ts + main.ts 接线 + flow 测试 | 08bb3f5 |
| KI-118 fix | spring-health-check.mjs 移除 shebang（module-loader 门禁） | 0698210 |
| Phase 7 F2-第二批 | Streaming ring 接线（activateRingBonus/preloadRingBonus） | 08e59a9 |
| Phase 7 F2-第二批 | renderer 分档接口（QualityTargets.renderer） | 96df2f0 |
| Phase C-2 | BossPhraseBar 单元测试（5 腿） | 4ea4ed0 |
| KI-442~445 | 账本行同步（KNOWN_ISSUES/WORKPLAN/PHASE-STATUS KV） | daea06e |
| Stakerite 覆盖率看板 | 读 coverage-floor.json 显示总地板 | b0e0fb7 |
| Phase 7 F2-第三批 | QualityStore→GPUParticles 预算乘数接线验证（5 腿） | 26347df |

**当前状态**：`npm run check` 全绿：4862 条 / 412 文件，0 红。

---

## 进行中 / 待开工（按优先级）

### P1：Spring Cloud 微服务继续扩展

- `caesura-client` 的配置拉取失败降级测试（模拟 config server 不可用时的退路）
- Spring Cloud 服务网格健康聚合器已完成，可加更多 Spring Cloud 模式（config server 刷新、bus 事件等）

### P2：Phase 7 后续

- 更多 VFX/Boss 相关流程测试
- `docs/perf-baseline.md` 持续完善
- renderer 分档实际消费（shadow map size / resolution scale 实际应用到渲染管线）

### P3：新功能规划

- 增加 KI 账本行（已开工但未登记的功能）
- 增加更多单元测试提高覆盖率
- 完善文档地图

---

## 决策原则（不变）

1. **不引入 Spring Boot 运行时依赖**：Spring 家族只负责编排/重试/熔断/报告，判定与阈值由 Node 侧负责
2. **.scratch/ 临时脚本不入库**
3. **任何新腿开工前必须先有 KI 行**（账本登记 → 裁决 → 读数 → 欠账）
4. **`npm run check` 每次提交前必须全绿**（pre-commit tsc + validate:data + test）
5. **账本（KNOWN_ISSUES.md）、WORKPLAN.md、PHASE-STATUS.md KV 块保持一致**
