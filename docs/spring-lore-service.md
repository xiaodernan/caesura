# caesura-lore · 世界谱后端（2026-11-15 落 · KI-564）

> Spring Cloud 族的第八个成员：对外提供《止音纪元》世界谱的**只读检索服务**。
> 玩家进程不经过它；Java 侧不持有任何判定；所有阈值仍由 Node 侧（`scripts/spring-family-rules.mjs`）拍板。

## 它是什么 / 不是什么

| 是 | 不是 |
|---|---|
| 52 条真实文本的只读 API（双语） | 玩家后端 / 存档服务器（`gameplay.md` 明写「无专用服务器」） |
| Java 侧 BM25：中文 bigram + 英文词元，k1=1.5 · b=0.75 · 标题×3 | 对 dialogue.json 的任何读写（它**根本读不到**仓库——快照打在 jar 里） |
| **双引擎检索**：`?engine=bm25`（内存路 · 默认）⇔ `?engine=fts`（SQLite 词袋倒排 · in-memory `jdbc:sqlite::memory:` · `posting` 复合主键 `PRIMARY KEY(token, entry_id)` · `df` 一 token 一查）—— 同裁判评估两条路（分词与打分出自 `LoreTokenizer` + `LoreScoring`） | 门名册 / 熔断 / 重试的第二个主人 |
| memory\|redis 双后端缓存，`/lore/stats` 可查命中率 + 数据库体检（`db.entries/postings/distinctTokens/avgdl/buildMs/plan`） | 生产网关（那个是 caesura-gateway） |
| `mvn -DskipTests package` 即构建；e2e 一条龙拉起 | eureka 注册不是默认（见下） |

**⚠️ 注册纪律（2026-11-15）**：默认**不注册任何注册中心**（`EUREKA_REGISTER=false` 缺省）—— 共享机器上的 8761 可能是别家的注册中心。整族 e2e 同族起 8761 时要演示注册，显式 `EUREKA_REGISTER=true` 即可。曾误注一次 CAESURA-LORE 到本机 careeros-discovery（8761），已用 Eureka API 干净注销（Registry 现回归 404）。

## 端点

```
GET  /lore/codex?lang=zh|en        → { lang, total: 52, entries: [...] }   （每种语言一份载荷，分别入缓存）
GET  /lore/codex/{id}?lang=zh|en   → 200 单条 / 404 {"error":"not_found"}
GET  /lore/search?q=万籁&limit=5[&engine=fts]   → { q, lang, total, tookMs, algorithm, engine, hits: [{id,cat,title,body,score}] }
POST /lore/search  {"q":"万籁","limit":5,"lang":"zh","engine":"fts"}  （同上；JSON 体形态）
GET  /lore/explain?q=万籁          → { q, tokens, plan, engine }（EXPLAIN QUERY PLAN 原文 + 分词；每问必真算，不进缓存）
GET  /lore/stats                   → { entries, cacheBackend, cacheHits, cacheMisses, searches, hitRate, uptimeMs, playerProcessLlm: false, db: { entries, postings, distinctTokens, avgdl, buildMs, type, plan } }
GET  /lore/health（≡ actuator /actuator/health 的 lore 环节）→ { entries: 52 }
```

`id` 是稳定的 slug（`<cat>-<en-title-slug>`，如 `reach-resthold`、`boss-the-myriad-earless-deeps`）。

## 数据同源（不手抄）

`Services/spring/caesura-lore/src/main/resources/lore/codex.json` 由作者侧脚本生成：

```powershell
node scripts/lore-codex-snapshot.mjs
```

该脚本从 `codex/index.html` 的 `CODEX` 数组切出（构建期断言 **52 条、id 唯一、cat ∈ {reach,boss,ending,term,mark,system,epic,lands}**），
脚本跑完 `git status` 会显示该文件。**不要手改它**——要改文本就改 `codex/index.html`，再重跑脚本。

## 缓存双后端

| 模式 | 触发 | 行为 |
|---|---|---|
| `memory`（默认） | `CAESURA_LORE_CACHE=memory` 或缺省 | `ConcurrentMapCacheManager`，零外部依赖，健康不被 Redis 拖垮 |
| `redis` | `CAESURA_LORE_CACHE=redis` + `SPRING_DATA_REDIS_HOST/PORT` | `RedisCacheManager`，10 分钟 TTL，`lore:` 键前缀 |

**真机验证（2026-11-15 · throwaway 容器 · 已销毁）**：`redis:7.4-alpine` @ 16399 · health UP（redis 组件 UP）· `KEYS 'lore:*'` → `lore:codex:codex:zh` + `lore:search:search:zh:万籁:5` · 同一查询 ×3 ⇒ `hitRate=0.6`。

## SQLite 词袋倒排·可观测性（2026-11-15 落）

- `posting(token TEXT, entry_id TEXT, tf INTEGER, PRIMARY KEY(token, entry_id)) WITHOUT ROWID` —— 逗号复合主键 = 免二级索引、
  `df(token PK, df)` —— 建索引期一次算好，热路径零聚合；`entry(dl)` —— 文档长度现算好的。
- `LoreTokenizer` + `LoreScoring` 是内存路（`LoreRanker`）与 SQLite 路的**同一份分词 / 同一份打分**（k1=1.5 · b=0.75 · idf 同一公式）——
  两个引擎对照 = 同裁判评两个实现，调的是存储与索引，不是判分标准。
- 实机读数（`engine=fts` vs `engine=bm25`，同一份 52 条世界谱）：
  `q=万籁` → 同样命中 `boss-the-myriad-earless-deeps` 与 `reach-earless-deeps`（同样 score ≈ 14.70 / 9.68）——**分数完全一致（同裁判）**；
  `/lore/explain?q=万籁` → tokens=[万， 万籁， 籁]，`plan: SEARCH posting USING PRIMARY KEY (token=?)`——证明 PK 命中，不是全表扫。
- `/lore/stats` 新增 `db` 块：`entries=52 · postings=4893 · distinctTokens=2438 · avgdl≈141.9 · buildMs≈921 · type=sqlite-inmemory · plan=SEARCH TABLE posting USING PRIMARY KEY (token=?)`。
- 冷启只付一次建索引成本（in-memory SQLite 约 0.9s），**运行期零磁盘**（`:memory:`）；52 条规模选内存路即可，SQLite 路是
  「数据库索引怎么把 BM25 做对」的真身对照，不是 production over-engineering。

缓存的是**序列化后的 JSON 载荷**（不是对象）：两种后端行为一致、热点路径零重复 Jackson 序列化。
放行手动 `getOrCompute`（不走 `@Cacheable`）——命中/未命中计数在自己手里，`/lore/stats` 才说得出真话。

> 实测（2026-11-15）：throwaway `redis:7.4-alpine` 临时容器起在 16399，`CAESURA_LORE_CACHE=redis` + `CAESURA_LORE_HEALTH_REDIS=true` 下：health UP（redis 组件 UP）、codex total=52、同一条查询三次 → stats `hitRate=0.6`（3 命中 / 2 未命中）、`redis-cli KEYS 'lore:*'` 实读到 `lore:search:search:zh:万籁:5` 与 `lore:codex:codex:zh`。测完已停 lore 并 `docker rm -f` 该容器，**不占用、不读写任何共享 Redis**（6379 被 specproof-redis 占用 · 16380 被 careeros-redis 占用）。如需长期启用：先自建一个**自己的** Redis 实例并定好端口。

## 实机压测（2026-11-15 · 本机 · `memory` 缓存 · 8 worker × 25 连发 `GET /lore/search?q=万籁&limit=5`）

| 指标 | 修单飞之前 | 修单飞之后（双检 + 分段 64 条 ReentrantLock） |
|---|---|---|
| 请求 | 200 ok / 0 err | 200 ok / 0 err |
| 墙钟 | 639ms ≈ **313 req/s** | 650ms ≈ **308 req/s** |
| p50 | 6.9ms | 16.8ms |
| p95 | 131.4ms | **74.8ms** |
| p99 | 250.5ms | **119.3ms** |
| max | 264.3ms | **119.9ms** |
| 缓存 hitRate | 0.960（冷启 **8 miss**：8 个并发全部抢算、重复序列化） | **0.995**（冷启 **1 miss** —— 单飞锁把 stampede 压成一次计算） |

> 冷启动 8→1 的修法住 `LoreCache.getOrCompute()`：同 key 走 `ReentrantLock[]` 分段锁（hash 分 64 段）、进锁后**双检**——
> 等到锁的请求发现答案已经在缓存里，直接按 hit 返回，既不重复计算，也不破坏分段并发度。
> 结论：热路径 p50≈7–17ms（数百 QPS 单实例），冷启动无惊群；任何进一步优化都应当先量后改。

## 跑它

```powershell
cd services/spring
mvn -q -DskipTests package          # 七件 jar 全构建
java -jar caesura-lore\target\caesura-lore-0.1.0.jar
curl http://127.0.0.1:8084/lore/stats
```

整族一条龙（registry → config → gate/report/client/gateway/lore → 探针）：

```powershell
node scripts/spring-family-e2e-check.mjs --timeout=300
```

> 共享机器上 8761/8081 可能被别人占着（本键登记 KI-564 时由 e2e 前提检查报出）——
> 这就是前提检查「先报出来，不乱杀」的设计：端口是别人的，不是我们的残留。

## e2e 探针（CI 干净 ubuntu 上跑）

| 探针 | 期望 |
|---|---|
| `GET /actuator/health` | 200 UP |
| `GET /lore/codex?lang=zh` | `total == 52` |
| `GET /lore/search?q=万籁&limit=5&lang=zh` | `total == 2`（万籁 boss + 无耳深窖） |
| `GET /lore/stats` | `entries == 52` |

## 纪律

- **不进玩家进程**（`gameplay.md` §无专用服务器）
- **Java 不读仓库数据表**（`services/spring/spring-family-rules.mjs`：`javaReadsRepoDataFindings`）
- **不持有判定**：Java 只 serve 数据与分数；任何「过不过」仍由 Node 门回答
- **零 LLM**：这个服务没有也不应有任何模型调用
