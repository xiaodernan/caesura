# CAESURA《止音纪元》 · 大百科（ENCYCLOPEDIA · v1 · 2026-11-15）

> 一页总览：**这是什么、怎么玩、哪里在教、哪里在跑、哪里还在等**——所有 KI-546..563 全部教学件、所有 SYS 系统、所有 docs、控制台一览、和当前交付位的诚实坐标。
> 本文件只索引、不声明：不新增 KI、不改任何数据文件、不替代其他文档；它指向源头。生成自 `phase-status` KV（KI.rows=**481** / Implemented=**304**，SYS.rows=**98** / Implemented=**73**，ARCH.sections=**202** / **0 holes**，PKG.scripts=**78**）。

---

## 1 · 这是什么

一个**沉静的钟**。中文叙事 + 机械战斗（扑断轴击微器）+ 七城七钟七旅人。

玩家的每一件工具——镐击声、呼叫铃、奇怪回声、最后的钟——所有东西都在同一套因果下说话：**沉默是罪、声音是亏；带着耳朵走**。
结尾是敲一记之后再敲一记——世界改了，但还是钟。

---

## 2 · 主线廊道（七城 · 七 Boss）

| # | 地域 | Boss | 真音符 |
|---|---|---|---|
| 1 | 玄石集市 `rg_resthold` | 虚礼典礼官（Meg 的主账房） | ♭E |
| 2 | 频率树林 `rg_whisperwode` | Hexgirl 迷雾探子 | ♭F |
| 3 | 水下唱诗班 `rg_drowned_choir` | 沉默传道师 | ♭A |
| 4 | 断栏营 `rg_brokenbar_camp` | Brute 断栏兽 | ♭C |
| 5 | 破钟崖 `rg_fellcarillon` | Bell-Phantom 巨钟裂魂 | ♭D |
| 6 | 无耳之底 `rg_earless_deeps` | Hersil 无耳 | ♭G |
| 7 | 未完之殿 `rg_unfinished_hall` | 最后的钟 DLG_HERSIL | ♭B |

七 Boss × 七音符与世界观音景见 `docs/WORLD-BIBLE.md`、`docs/lore/NEW-LANDS.md`（NEW-LANDS：再推一层）；史诗六章：`docs/EPIC-V.md`、`docs/EPIC-VI.md`。

**任务链**：`q_bells` · `q_corvin` · `q_meg` · `q_haltrune` · `q_faceless` · `q_threewords`（2026-11-15 第六件 · pilgrimage 链）。
**敌影**：`docs/BESTIARY.md`（10 只全谱：嘈壳到万籁）。

---

## 3 · 控制台（止音仪典网 · 104 面板 · 54 系统键 · 4 主题 · 沉浸模式）

`console/index.html` 单页静态控制台：【仪典涌现 / CACHE ORACLE / 多仪典皮肤 / 沉浸按钮 / 世界图 row-map】登记完毕。**54 项教学后端**：

- **Spring Cloud 全家**：Gateway Route / Filters / Retry / LoadBalance / Circuit Breaker / Feign / Config / Bus / Stream Binding / Vault / Consul KV / Redis Pipeline / Redis HA / Redis Stream / Batch
- **缓存与一致性**：`cache-consistency`（DelayedDoubleDelete=011 / SubscribeBinlog=101 / OutboxPolling=110）· `prompt-cache`（StablePrefix=110 / BudgetedPrefix=101 / VolatilePrefix=010）· `slot-map`（100/110/001）· `cache-replacement`
- **数据库与索引**：`pgvector`（BPlusOrdered=100 / TrgmGin=010 / **VectorHnsw=001** — B+ 树 / pg_trgm / HNSW 三路对照）· `bplus` · `bloom-filter` · `hyperloglog` · `crdt`
- **可靠性**：`circuit-breaker` · `failure-detector` · `raft-consensus` · `distributed-lock` · `distributed-txn` · `transactional-outbox` · `idempotent-consumer` · `consumer-rebalance` · `trace-sampling` · `rate-limiter` · `distributed-ratelimit` · `cache-coherency`
- **推送**：`mesh-e2e`（双源同代 `builtAt===generatedAt`·`console:data` 再生。）

每个都遵守同样的教学合同：**三策略互斥三元组 · 双路自证 · 三路篡改喂回同一 holds 公式 · 因果锁 · 十一真件 21 键**。`npm run pgvector:bench | gateway-filters:bench | slot-map:bench | cache-consistency:bench | prompt-cache:bench` 都是同样的双源一致出口。

---

## 4 · 教学件全谱（KI-546..KI-563）

| KI | 教学件 | 三策略 | 三元组向量 |
|---|---|---|---|
| KI-546 | `spring-feign` | GitBackend / NativeBackend / RedisBackend | 110/101/011 |
| KI-547 | `spring-config` | GitBackend / NativeBackend / RedisBackend | 110/101/011 |
| KI-548 | `spring-bus` | InMemoryLocalBus / RedisPubSubBus / KafkaBrokerBus | 011/001/110 |
| KI-549 | `redis-pipeline` | PipelineBatch / LuaScripting / WatchCas | 011/110/101 |
| KI-550 | `gateway-retry` | ImmediateRetry / FixedBackoff / ExponentialFullJitter | 100/010/011 |
| KI-551 | `spring-consul-kv` | PollingRead / BlockingQuery / SessionLockKV | 001/110/101 |
| KI-552 | `redis-ha` | Sentinel / SyncPair / Cluster | 100/010/101 |
| KI-553 | `redis-stream` | PubSub / PersistentQueue / StreamLog | 010/100/110 |
| KI-554 | `spring-vault` | K8sStatic / AppRoleLease / DynamicRotation | 100/010/001 |
| KI-555 | `prompt-cache` | VolatilePrefix / StablePrefix / BudgetedPrefix | 010/110/101 |
| KI-556 | LLM 缓存根因（NPC_BIBLE 2.06 块 · warmup · cache-miss-retry） | 真机实测 | 证据 `docs/llm-cache-fix.md` §12 |
| KI-557 | `redis-slot-map` | SlotModulo / HashTagSlot / ConsistentSlot | 100/110/001 |
| KI-558 | `cache-consistency` | DelayedDoubleDelete / SubscribeBinlog / OutboxPolling | 011/101/110 |
| KI-562 | `pgvector` | BPlusOrdered / TrgmGin / VectorHnsw | 100/010/001 |
| KI-563 | `gateway-filters` | OrderedChain / RateLimitGatewayFilter / CircuitBreakerGatewayFilter | 100/010/001 |

---

## 5 · 文档地图

| 类别 | 代表文件 |
|---|---|
| **设计与叙事** | `docs/IP_SEED.md` · `docs/narrative.md` · `docs/combat.md` · `docs/WORLD-BIBLE.md` · `docs/BESTIARY.md` · `docs/lore/NEW-LANDS.md` · `docs/EPIC-V.md` · `docs/EPIC-VI.md` · `docs/art-direction.md` · `docs/ui-ux.md` · `docs/audio.md` |
| **工程** | `docs/technical-architecture.md` · `docs/spring-cloud-mesh.md` · `docs/spring-cloud-live-smoke.md` · `docs/perf-baseline.md` |
| **账本** | `docs/KNOWN_ISSUES.md`（KI.rows=481）· `docs/WORKPLAN.md` · `PLAN.md`（F-88..F-93） · `docs/TOOLKIT.md` · `docs/PHASE-STATUS.md`（嵌 KV） |
| **LLM** | `docs/llm-cache-fix.md`（NPC_BIBLE·第十二节根因定案） · `docs/llm-dialogue-qa.md` · `docs/llm-gateway-evidence.md` · `docs/llm-voice-probe.md` |
| **规范** | `docs/CONTRIBUTING.md` |

---

## 6 · 真机/集成计数（当前 master）

- `npm run check`（tsc + validate:data + test）→ **绿**（6858 用例 · 518 文件）
- `npm run build` → 0 findings（text 10 份）
- 控制台双源同代：`builtAt===generatedAt`；console-ui **147 legs** · console-full-stack **68 legs**
- mesh-e2e **67 legs** · game-cloud **94 legs** · doc-audit **15/15**
- CI `check` + `spring-family-e2e` — 全绿（最近一次 eb6a092）
- 真机 LLM 缓存：warmup → `cached=[0,6912,6912,6912]`；live 三 lane：stablePrefix **3/4 = 0.75** / identical **0.75** / **driftingPrefix 0**（`stableBeatsDrift=true distinct=true`）

---

## 7 · 边界与诚实声明

- **不**用真 Gateway server / 真 PostgreSQL / 真 Redis Cluster 做官方基准替代；这些教学件是 seeded 确定性实验室。
- **不**改 `dialogue.json`（零改）；NPC 对白作者侧唯一授权是经 `npm run llm:qa` 审稿后由作者落库。
- **玩家进程零 LLM**：所有 AI 内容在构建期合成为数据，运行时不请求任何 API。
- **EPIC-IV 起** **延迟**：新章（EPIC-V / EPIC-VI）是 DESIGN ONLY — 入库需过主线关口。
- v1 盘口 · 未覆盖的已知遗留：`KI-010`（机窗口实测渲染帧率曲线）· `DLG_CORVIN` 78–82% cache hit（share-shard，client 无法消除，见 `llm-cache-fix.md` §12）——作为诚实的已验证参数保留。

---

> 当有人问你「这游戏是什么」：一只敲不碎的钟，十把敲得碎的锤，每一件都在教一个玩家怎么敲。
