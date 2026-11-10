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

**当前状态**：`npm run check` 全绿：4790 条 / 398 文件，0 红。

---

## 进行中 / 待开工（按优先级）

### Phase C —— F3 Boss 乐句线 HUD（ui-visible，headless 可证部分）

**目标**：`hud.bossPhrase(bar_beat, phraseIdx, total)` 的显示层。

落点：
1. `src/ui/BossPhraseBar.ts` —— 零 game 依赖，只读渲染器，订阅 `ui.notify`/`boss.phase`/`beats`
2. `src/main.ts` —— 组合根接线（BossPhraseBar 构造、bus 订阅）
3. `tests/flow/boss-phrase-hud.test.ts` —— 真 AISystem + 真 RhythmClock + tickFrame 发 tick，量渲染输入

还欠：Boss 乐句线数据源（来自 `boss.phase` 事件，已由 `Settlement` 发出），HUD 右侧中条位置。

---

### Phase 7 F2 第二批 —— Streaming ring 接线 + renderer 分档

**Streaming ring**：`QualityStore.profile().activateRingBonus`/`preloadRingBonus` 接进 `StreamingSystem` 构造（一次性读，不每帧重算）。组合根归零覆盖率挡住直接改 `main.ts`，需先量。

**renderer 分档**：`ColorGrade`/`VfxLayer`/`SceneLights` 按 `QUALITY_PROFILES[t].resolutionScale`/`shadowMapSize` 分档。今日无真 WebGL，headless 跳过断言，只留契约。

---

### Phase E —— KI-407 coverage 棘轮（已完成，40/40）

`scripts/coverage.mjs` 三出口（0/1/2）全部有测试，`scripts/coverage-floor.json` 基线已建。

---

## 后续候选（选做，不阻塞主线）

- F3 之后：`src/ui/Stakerite.ts` 加「画质档位」已完成（Phase A），可再加「覆盖率看板」行（读 `scripts/coverage.mjs` 输出）
- Spring Cloud：`caesura-gate` 与 Node 侧 `scripts/spring-family-rules.mjs` 的 `serviceTopologyFindings` 已三方一致，可再加 `caesura-client` 的配置拉取失败降级测试
- `docs/technical-architecture.md`：加 `src/ui/BossPhraseBar.ts` 与 `src/vfx/ColorGrade.ts#colorGradePass` 的文件地图行
- KI-407 之外：`npm run coverage` 真跑基线（--bless）并提交 `scripts/coverage-floor.json` 更新

---

## 决策原则（不变）

1. **不引入 Spring Boot 运行时依赖**：Spring 家族只负责编排/重试/熔断/报告，判定与阈值由 Node 侧负责
2. **.scratch/ 临时脚本不入库**
3. **任何新腿开工前必须先有 KI 行**（账本登记 → 裁决 → 读数 → 欠账）
4. **`npm run check` 每次提交前必须全绿**（pre-commit tsc + validate:data + test）
5. **账本（KNOWN_ISSUES.md）、WORKPLAN.md、PHASE-STATUS.md KV 块保持一致**
