# TOOLKIT — CAESURA 全拼装件总目录

> 更专业的说法：这份文档是仓库里 **所有作者侧/开发者侧仪器** 的注册册。
> 它不写玩家内容、不冒充真内核、不声称「接入 LLM 就意味着对白更好」——只替你标好每件仪器的读数与归宿。
> 玩家运行时零 LLM、零网络、零密钥；作者工具只在你自己的终端里跑。

## 0. 当前时间轴（2026-11-13 快照 · 可再生）

- KI.rows=468 / Implemented=291 / Partial=167 / Placeholder=0 / Blocked=10
- PKG.scripts=64 / PKG.deps=1 / PKG.devDeps=6 · KV 现读 `npm run status`
- 42 个控制台维度（`console/index.html` `#row-*`）· `npm run console:data` 重生（snapshot.json ↔ bootstrap.js 双源同代）
- 新增：`spring-config:bench` —— KI-547 `caesura-spring-config` 双源一致；`spring-feign:bench` KI-546 的补账配套
- 前端范式：headless 腿证据 + `console:data` 双载体同源（snapshot.json ↔ bootstrap.js）

## 1. 维护门（所有更动必须先过这两个）

| 命令 | 用途 |
|---|---|
| `npm run status` | 真机现读 KV 印记（KI/SYS/TD/PF/ARCH/PKG） |
| `npm run status:embed -- --check` | 自证 docs/PHASE-STATUS.md 机读区与现读逐字一致 |
| `npm run lint` | `tsc --noEmit` 全仓（src + tests + scripts 声明文件） |
| `npm run validate:data` | 数据 schema 校验（0 ERROR 才放行；WARN 记录但不阻断） |
| `npm run test` / `npx vitest run <file>` | 单测全集 / 指定文件（`head-compiles` 非确定性，见 KI-198） |
| `npm run check` | lint + validate:data + test 三门齐跑 |
| `npm run console:data` | 重生控制台 snapshot.json + bootstrap.js + 注入 builtAt |
| `npm run check-links` | 文档相对链接有效性（只验有无歧义路径，远程跳过） |

## 2. 教学件 bench 系列（`npm run <name>:bench`，~40 件）

命名规则：`<domain>:bench` ⇒ 对应 `scripts/caesura-<domain>.mjs`，CLI 双跑字节一致。
每个 bench 都遵守家族同构六件套：**确定性 seeds · 可注入 clock · verifyXxx 双路自证 · 三路篡改真喂回翻 false · 十一枚真件 21 键证据 · rigged collapse 探针**。

| 家族 | 命令 | 教学件 |
|---|---|---|
| 存储 | `lsm:bench` | LSM-tree 写放大/读放大/布隆过滤读放大 vs B+ 树对照 |
| 淘汰 | `cache-replacement:bench` | LRU / LFU / TinyLFU / W-TinyLFU / ARC 五策略命中率矩阵 |
| 缓存键空间 | `cache:coherency:bench` | Cache-Aside / Write-Through / Write-Behind + 失效时序 |
| 一致性 | `raft:bench` / `disttxn:bench` | Raft 先判例 vs 2PC/Saga/TCC; partial failure 对照 |
| 并发/锁 | `dlock:bench` | SETNX/Redlock/etcd Lease + fencing token 时序 |
| 限流 | `ratelimit:bench` / `ratelimit:cluster:bench` / `red:rate` | 令牌桶/漏桶/集中令牌桶/分布式分片 |
| 幂等/去重 | `idempotent-consumer:bench` | InMemoryDedupSet=110 / RedisSetNx=101 / BloomGuard=011 |
| 行为检测 | `detect:bench` / `guard:bench` | φ-failure 累积 / SWIM 三态 / 布隆防裂 filter |
| 发件箱/外点 | `outbox:bench` / `delivery:bench` / `retry:bench` / `delay:bench` | 投递语义 · 重试退避 · 死信 · 延时队列 |
| 消费组 | `consumer-rebalance:bench` | Eager=011 / CooperativeSticky=101 / StaticMembership=110 |
| 网关 | `gateway-routing:bench` | PathPrefix=001 / RegexCapture=110 / HeaderGroup=101 |
| 熔断 | `circuit-breaker:bench` | Count/Rate/SlowCall 三折 |
| 订阅层 | `stream-window:bench` / `group:bench` | 窗口聚合/滑动窗口/水位线 |
| 并发控制 | `txn:bench` | MVCC 多版本/2PL 死锁检测/五档隔离异常矩阵 |
| 分布式配置 | `config:consistency:bench` | 轮询/长轮询/watch 三难不封赢家 |
| 配置中心 | `spring-config:bench` / `spring-feign:bench` | GitBackend=110 / NativeBackend=101 / RedisBackend=011 · Feign 110/011/001 |
| 分布式 ID | `idgen:bench` | Snowflake / UUID / 号段双 buffer |
| 消息/日志 | `log-compaction:bench` / `backpressure:bench` | LSM 紧凑 + size/time 固定阈值回末 |
| 结构索引 | `bplus:bench` / `hash:bench` | B+ 树阶 vs LSM 笔账 + 一致性哈希偏斜 |
| 高基数/基数 | `hyperloglog:bench` / `bloom-filter:bench` | PFADD 基数 vs Bloom filter 精度 |
| 计数器/伪共享 | `hw:bench` | CPU 级 PackedCounters vs Int64 填充 vs 伪共享 |
| 大负载实验 | `spring-batch:bench` | Chunked batch / SetUpSetUp skip / 遗留重跑 |
| 跳表/限时 | `delay:bench` | Min-heap 时间螺旋盘/redis 有序集合对照 |
| 缓存粒度 | `cache:bench` | 大对象一致性 + 多态 value 缓存淘汰 |
| 追踪采样 | `trace:bench` | Head/Tail/Adaptive 三拼 |

## 3. 作者侧 LLM 一族（已接入真实 API · 作者侧 · 玩家进程零 LLM）

| 命令 | 作用 | 说明 |
|---|---|---|
| `npm run llm:proof` | 真机调用 LLM（默认 `gpt-6-sol` via `CAESURA_LLM_API_KEY` env 注入 · 出站线段隐 · 默认 wkapi.pro/v1/v1） | 仅候选对白；**绝不写 dialogue.json** |
| `npm run llm:qa` | 对现有 dialogue 节点批判式审稿（prompt 线束照顾文风总纲），2026-11-12 结论 pass 45/skip 33/flag 3 | 需人裁决 |
| `npm run llm:diff` | 机读证明「LLM 候选零泄漏进 dialogue.json」——81 节点 vs 6 条候选，0 逐字泄漏 | 作者侧 gate |
| `npm run llm:cand-qa` | 候选声线便签：LLM 对每条 DLG_* 候选给 keep/pending/flag 便签 ≤30 字（2026-11-13 真跑：keep 3 / pending 7 / flag 2） | 作者侧；不下定论（LLM 倾向 keep 自己写的句子） |
| `node scripts/llm-dialogue-spotcheck.mjs` | 单点声线评估：对单个已 flag 行重请求一次第三方视角（2026-11-13 真跑 DLG_MEG:n8 · pending · "末句身份信息过满"） | 作者侧；零写入；作者终裁 |
| `npm run llm-gateway:bench` | 伪 Gateway 教学件（默认 offline）；`--live` 真联机对照 CachedLive/LiveGrounded 行为 | 仅 shell env key；不写文件 |
| `llm-voice-candidates.json` | `runtime:false · authorOnly · requiresHumanReview=true` | 候选池，作者逐字审后方可落 |
| `docs/llm-gateway-evidence.md` / `docs/llm-voice-probe.md` | **唯一**的密钥说明纪律：密钥仅环境变量；不入 git/不入 .env/不回搜 | 诚实边界 |

## 4. 接线进游戏 / 控制台的一族

- `scripts/spring-family-mesh-e2e.mjs` — **一行 e2e**：游戏启动 → 事件总线发 game.started → 鉴权 guard 校验 scope Bearer（可选 RFC 7662 introspection · fail-open）→ 网关 filter链（Retry）+ 负载均衡（发现 caesura-gate）+ span + 进程内熔断 → 关停发 game.stopped；`mesh-e2e.test.ts` 47 条注入真 EventBus 形状串起来全链路。
- `scripts/caesura-game-cloud.mjs` — `createGameCloud` 工厂：所有教学件 `status().xxx` 惰性只读快照 + `runXxxStudy`（opt-in）；各维语义逐字降级。
- `scripts/caesura-console-gen.mjs` — 36 维读数收敛进 `systems.*`（`npm run console:data` 重生）；前端 `console/app.js` 36 行 join + `row-*` 面板（`npm run console:data` 之后即刷盘；双载体同源 `snapshot.json ↔ bootstrap.js`）。
- `docs/spring-cloud-mesh.md` 合成地图（evidence + honesty row 家族）。

## 5. 验证谱系（证明到底在哪）

- 每个教学件自带 `verifyXxxSoundness` **双路自证**（路 A 唯一流守恒，路 B 同类流真跑）+ **三路篡改**真喂回同一 holds 公式翻 false。
- `verifyCausalLocks` 三因果锁全真（每个策略障碍物都是结构性的）。
- 命中维 `[trilemma]` 固定维序由 trilemma 现算不查表；向量由现场 cell 累计现算。
- 证据件 `createXxxEvidence` **11 × 21 键**涵盖 ShardRouter/HashRing/WAL/Bus/RedisCache/TokenBucket/MinHeap/PackedCounters/compareRemapping 等（同族全家桶）。
- rigged 三开关（perfectXxx / zeroXxx / collision-free）只会塌缩区分度，绝不硬造 111。

## 6. 已知的坑（请先读再动）

- `tests/unit/head-compiles.test.ts` — 100% 负载机器上的 feature flake（见 KI-198），勿为绿而乱改判据。
- `docs/technical-architecture.md` — 真树对账唯一主人（§2 表 + §5.9.N 名册），所有 src 文件均有对应条目。
- `gating`: `npm run check` 的 `test` 门含 `head-compiles`，挂则跳过；走 `SKIP_HOOKS=1 git commit` 但 **永远先在日志里核对目标 `vitest run` 全绿**。
- `.scratch` 是本工具入库之前的工作原料，**永不进 git**。
- `git stash list` / `git worktree list` 本仓为空，未来如见 `branches` 增加，先查 `docs/branch-consolidation-20261109.md` 的合并条款。

## 7. 怎么动手

1. 先读 KI 账本（`docs/KNOWN_ISSUES.md`）——挑一行 `Partial` 或自己新开一份 `| KI-XXX | … | P4 | Placeholder |`。
2. 零依赖、可注入 `clock`/`seed`，六个场景 × 三向量；写模块 + `.d.mts` + 腿（`tests/unit/caesura-<domain>.test.ts`）。
3. 接线：复制 `caesura-idempotent-consumer.mjs` 套路（verify + causalLocks + 11 真件 + snapshot/metrics + CLI）。
4. 前端：补 `console/index.html` `row-xxx` + `styles.css` `.xxx-*` + `console/app.js renderXxx`；重生 `npm run console:data`。
5. 账本：KNOWN_ISSUES（`Placeholder → Implemented`） / WORKPLAN（✅） / PLAN（Phase F-xx） / PHASE-STATUS KV（status:embed 自证）。

## 8. 诚实边界（刷新）

- 本文件只登记**存在并绿着**的仪器；标 P4 的条目均可通过对应脚本直接复跑核验。
- 不声称真实微服务、真实 Redis 集群、真实网关 netty 路径——都是零依赖的确定性岗哨计数。
- LLM 工具链是作者侧编辑辅助；运行时零 LLM 接入；API key 仅 shell env、永远不进 git/文档/候选文件。
