# caesura-lore · 世界谱后端（2026-11-15 落 · KI-564）

> Spring Cloud 族的第八个成员：对外提供《止音纪元》世界谱的**只读检索服务**。
> 玩家进程不经过它；Java 侧不持有任何判定；所有阈值仍由 Node 侧（`scripts/spring-family-rules.mjs`）拍板。

## 它是什么 / 不是什么

| 是 | 不是 |
|---|---|
| 48 条真实文本的只读 API（双语） | 玩家后端 / 存档服务器（`gameplay.md` 明写「无专用服务器」） |
| Java 侧 BM25：中文 bigram + 英文词元，k1=1.5 · b=0.75 · 标题×3 | 对 dialogue.json 的任何读写（它**根本读不到**仓库——快照打在 jar 里） |
| memory\|redis 双后端缓存，`c/lore/stats` 可查命中率 | 门名册 / 熔断 / 重试的第二个主人 |
| `mvn -DskipTests package` 即构建；e2e 一条龙拉起 | 生产网关（那个是 caesura-gateway） |

## 端点

```
GET  /lore/codex?lang=zh|en        → { lang, total: 48, entries: [...] }   （每种语言一份载荷，分别入缓存）
GET  /lore/codex/{id}?lang=zh|en   → 200 单条 / 404 {"error":"not_found"}
GET  /lore/search?q=万籁&limit=5    → { q, lang, total, tookMs, algorithm, hits: [{id,cat,title,body,score}] }
POST /lore/search  {"q":"万籁","limit":5,"lang":"zh"}  （同上；JSON 体形态）
GET  /lore/stats                   → { entries, cacheBackend, cacheHits, cacheMisses, searches, hitRate, uptimeMs, playerProcessLlm: false }
GET  /lore/health（≡ actuator /actuator/health 的 lore 环节）→ { entries: 48 }
```

`id` 是稳定的 slug（`<cat>-<en-title-slug>`，如 `reach-resthold`、`boss-the-myriad-earless-deeps`）。

## 数据同源（不手抄）

`Services/spring/caesura-lore/src/main/resources/lore/codex.json` 由作者侧脚本生成：

```powershell
node scripts/lore-codex-snapshot.mjs
```

该脚本从 `codex/index.html` 的 `CODEX` 数组切出（构建期断言 **48 条、id 唯一、cat ∈ {reach,boss,ending,term,mark,system,epic,lands}**），
脚本跑完 `git status` 会显示该文件。**不要手改它**——要改文本就改 `codex/index.html`，再重跑脚本。

## 缓存双后端

| 模式 | 触发 | 行为 |
|---|---|---|
| `memory`（默认） | `CAESURA_LORE_CACHE=memory` 或缺省 | `ConcurrentMapCacheManager`，零外部依赖，健康不被 Redis 拖垮 |
| `redis` | `CAESURA_LORE_CACHE=redis` + `SPRING_DATA_REDIS_HOST/PORT` | `RedisCacheManager`，10 分钟 TTL，`lore:` 键前缀 |

缓存的是**序列化后的 JSON 载荷**（不是对象）：两种后端行为一致、热点路径零重复 Jackson 序列化。
放行手动 `getOrCompute`（不走 `@Cacheable`）——命中/未命中计数在自己手里，`/lore/stats` 才说得出真话。

> 注意：本机 6379 被 specproof-redis 占用。要切 redis 先定一个自己的端口（如 16380），不要往人家的实例里写。

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
| `GET /lore/codex?lang=zh` | `total == 48` |
| `GET /lore/search?q=万籁&limit=5&lang=zh` | `total == 2`（万籁 boss + 无耳深窖） |
| `GET /lore/stats` | `entries == 48` |

## 纪律

- **不进玩家进程**（`gameplay.md` §无专用服务器）
- **Java 不读仓库数据表**（`services/spring/spring-family-rules.mjs`：`javaReadsRepoDataFindings`）
- **不持有判定**：Java 只 serve 数据与分数；任何「过不过」仍由 Node 门回答
- **零 LLM**：这个服务没有也不应有任何模型调用
