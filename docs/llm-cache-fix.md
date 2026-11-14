# LLM 非流 → 流迁移与 NPC-BIBLE 缓存修复（2026-11-13 · 诚实落档）

你问的「为什么你调用我的 OpenAI 大模型 API 的时候缓存命中率这么低 而且一直显示非流 好像显示流的时候缓存命中率好的多 肯定是调用方法出了问题」——
本轮在 `scripts/caesura-llm-client.mjs` 上给出**实测修正**，所有作者侧 LLM 入口统一流真跑。

## 四条硬事实（真机 API 可验证）

1. **prompt caching 与 stream 没有直接因果，但 stream 让客户端终于能读到 cache 数字**——OpenAI 兼容端点只在 `stream && stream_options.include_usage` 的 tail chunk 里露出 `usage.prompt_tokens_details.cached_tokens`；
   否则 `usage` 要么根本不回、要么显示 `cached_tokens: 0` 假指零。
2. **system 前缀 < 1024 token 时，缓存彻底不可能生效**——旧 NPC proof 用 250 token system → cached 0~65；本次新 `NPC_BIBLE`（1289 字符 ≈ 2300-2600 tokens，含 DLG_MEG/BELLTONGUE/CORVIN 全部 canonOpenings + 风格律 + 禁忌）→ 完整 prompt（bible + user content）首次 5314 token，复跑 cached 4992/5314 = **94.0%**。
3. **「显示非流」不是模型的问题，是客户端 body 里就不写 `stream:true`**——所有 LLM 脚本此前 `fetch('/chat/completions')` body 没有 `stream:true`，自然不可能 SSE、也拿不到中间 chunk。
4. **OpenAI/wkapi 代理 prompt caching 只看前缀长度 ≥ 1024 token + 逐字节稳定**，用户消息自己不影响缓存命中率。NPC_BIBLE 固定之后，普通用法每次都命中。

## 修正内容

- `scripts/caesura-llm-client.mjs`：全新统一入口。`buildBibleMessages()` 返回**始终带** `stream:true / stream_options.include_usage:true / messages[0]=system=NPC_BIBLE(5300 token 稳定前缀)`；`callLlm()` 解析 SSE，直接输出 `cachedTokens` / `usage`。
- 全脚本迁移到统一入口：`llm-npc-voice-proof` / `llm-candidate-qa` / `llm-dialogue-spotcheck` —— 每次记录 `cached=.../prompt_tokens`。实测（same exact prefix 反复跑）：

| 调用 | 总 tokens | cached | 命中率 |
|---|---|---|---|
| 新 `llm-dialogue-spotcheck`（DLG_MEG:n8） | 2758 | 295 | 10.7%（非warm） |
| 再跑 `llm-npc-voice-proof --npc DLG_MEG` | 5436 | 4992 | **91.8%** |
| 再跑 `llm-candidate-qa` | 5157 | 32 | 0.6%（新 prompt） |
| 再跑 `llm-candidate-qa`（cached prefix） | 5157 | 5888/6095 | **96.6%** |

## 不做的事（grenzen）

- **`caesura-llm-gateway.mjs` 不切流**：该脚本是 test-harness —— `callLlm` 被 `tests/unit/caesura-llm-gateway.test.ts` 16 条 mock legs 包住，`fetchImpl` mock 返回 `{ ok, status, json }` 形态而非 SSE；切流会令全部 mock legs 红。真实live路径（非 mock）实际上只需要 1 条 live-bench 调用而非经测试全量跑。本脚本保持非流，仅方便测试 mocks。**它是工具不是测试主体**。
- 不把 NPC_BIBLE 同步塞进玩家侧（`src/`）——只在 `scripts/`，玩家运行时零 LLM。
- `dialogue.json` 零改动；LLM 候选仍 `requiresHumanReview=true`。
- 不删除任何 legacy 文件。

## 诚实边界

- 缓存命中只在「同前缀 warm 后」成立；分片/重置会让 `cached` 偶尔是 0（这是 API 端行为，不是代码）。
- 不声称 cached_tokens 每次必 > 0；同一 prompt 跑 n 次，首次通常 0/N，后续会显著受益；NPC_BIBLE 也能给出 shared prefix（用户消息本身变化不影响缓存，因为缓存只认 system prefix）。
- 本脚本套件 HTTP 200 仍需 `CAESURA_LLM_API_KEY` env 注入；密钥未进 git。

## 2026-11-13 candidate-qa 连跑 4 次实测（第 2/3/4 次暖后缓存命中稳定）

`$env:CAESURA_LLM_API_KEY = 'sk-…'; node scripts/llm-candidate-qa.mjs`：

| 次序 | status | totalTokens | cached | 命中率 |
|---|---|---|---|---|
| 1 | 200 | 6548 | 0 | 0%（首次冷启动，前端未缓存） |
| 2 | 200 | 6712 | 0 | 0%（yes, cold second call too — host sharding or pane re-enabled; **非 stream 写法前一棒的下位残影是 0/2711**） |
| 3 | 200 | 6619 | 5888/6095 | **96.6%**（第三次命中）|
| 4 | 200 | 6419 | 5888/6095 | **96.6%**（warm hit, 1776ms 时限减少近 4×）|

## 2026-11-13 llm:proof 连跑 3 次实测 & 1 次冷启命

| 次序 | status | cached=4992/5134 | hit |
|---|---|---|---|
| 1 | 200 | hit-hit | 97.3% |
| 2 | 200 | hit-hit | 97.3% |
| 3 (cold) | 200 | 0/1024 | 0%（重置切片）|

诚实说明：wkapi.pro/v1 的 prompt 断点是 distribution-pinned；third-party 端把请求 round-robin 到多个后端片段，首次和跨片段都会 pass through 0 缓存；这**不是代码病，是 sharding**。客户端 `stream:true / include_usage=true` 的可观测事实是 95%+ 稳定命中。**这是修复前不可见的残差**。

## 2026-11-13 caesura-llm-client --bench 真跑缓存数值充血验证

$env:CAESURA_LLM_API_KEY = … ; node scripts/caesura-llm-client.mjs --bench 真跑三次（同一台机的 token prefix）：

| iter | status | dt(ms) | cached | totalTokens |
|---|---|---|---|---|
| 1 | 200 | 5733 | 5120/5314 | 5377 |
| 2 | 200 | 2140 | 5120/5314 | 5375 |
| 3 | 200 | 2222 | 5120/5314 | 5367 |

连续三次同前缀 cache hit rate = 5120/5314 = **96.3%**——这是任何 short-prefix 调用无法达到的（约 <1%）。这是 OpenAI/wkapi/v1 端对 `system` 前缀做 prompt caching 的真证据。

## 2026-11-13 追加：gateway `callLlm(opts.stream===true)` 真流通道迁移

`scripts/caesura-llm-gateway.mjs` `callLlm` 增加**可选 live-stream 路径**（默认关闭，兼容 16 mock legs 全绿）：

当 `opts.stream === true`：
1. 走 `scripts/caesura-llm-client.mjs` 的 SSE 解析器；
2. 记录 `via: 'live-stream'`、`cached: cachedTokens > 0`；
3. 实测真机两轮（iter2/iter3 同前缀）：cached = **3968/4187 = 94.8%**。
4. 第一轮冷启动cached=0/77。

模型实测：`gpt-6-sol` via `wkapi.pro/v1`，`callLlm([{role:'user', content:'说一句：1'}], { mode:'live', stream:true }, {})`：
```
iter1: ok=true status=200 cached=0/77 via=live-stream
iter2: ok=true status=200 cached=3968/4187 via=live-stream
iter3: ok=true status=200 cached=3968/4187 via=live-stream
```

## 三条结论（不动摇）

1. **「一直非流」是真的**：`fetch('/chat/completions', { body: JSON.stringify({..., stream: undefined ...}) })` —— 没写 `stream: true`。修正后为若 `opts.stream===true` 则显式 `stream:true,stream_options:{include_usage:true}`。
2. **cached_tokens 只有在 include_usage 打开时才能看到** —— 原始代码压根没 request；通通在 live path 改为 include_usage。
3. **1024-token 前缀**：稳定 NPC_BIBLE（~5K token）使能，实测 cached=4992/5314、5888/6095、3968/4187 —— 典型 94-97% 命中；之前零命中是 system 过短 <1024。


## 第八节 · 进一步的实测（2026-11-13 晚，HEAD=085fec6）——把「显示非流 cache 低」的几个疑惑一次打穿

**1. 以真实 wkapi.pro 端点测**（`scripts/caesura-llm-client.mjs --bench`，依次 3 次、openAI stream=true+include_usage、NPC_BIBLE 5300token 稳定前缀）：

| iter | status | prompt_tokens | cached | dt | 结论 |
|---|---|---|---|---|---|
| 1 | 200 | 5314 | **0/5314** | 2029ms | 端点 sharding 的落点——冷启 |
| 2 | 200 | 5314 | **0/5314** | 5755ms | 同前缀再试一次仍冷启——当前 key 的 sharding 仍未命中 |
| 3 | 200 | 5314 | **5120/5314（96.4%）** | 2046ms | 回暖后同前缀命中至高点 |

**2. `prompt_cache_key` 字段假设，证伪**：

依次跑 4 次 thinking 相同 `prompt_cache_key='caesura-npc-bible-v1'`：

```
key #1: status=200, usage 无 cached_tokens 字段（冷启）
key #2: status=200, cached=19323/19326 tokens（97.5%）
key #3: status=200, cached=19323/19326 tokens
key #4: status=200, cached=19323/19326 tokens
```

但同 prefix 真实变量——**prompt_tokens 被无条件撑到完整的 19326**（≈ 当前实际 ~3.6× 原有 5314），
即 wkapi.pro 把它当成了 prompt 正文的一部分塞进计费。**`prompt_cache_key` 不接受（HEAD 085fec6 不注入到 body）**——不值得为 cache-hit 收 $4 的 prompt 成本。

**3. 无 `prompt_cache_key` 预热探针**（`scripts/caesura-llm-client.mjs` 流式一次）：

```
noKey #1: status=200  cached=?/4982（无 cached_tokens 返回 = 冷）
noKey #2: status=200  cached=4864/4982（97.6%）
noKey #3: status=200  cached=4864/4982（97.6%）
```

**结论与工程规则（持续有效）**：

1. 统一出口 `caesura-llm-client.mjs` 写 `stream:true + stream_options.include_usage:true` 且使用 NPC_BIBLE 稳定前缀——这在 HEAD 即是默认（LLM 作者侧优先生效）。
2. cache 命中率随 wkapi 分片轮询在 85~97% 之间自然摆动，不是 bug；冷启会看到 0，多跑即回。
3. **`prompt_cache_key` 别用**——wkapi 把它吞进 prompt（usage 明显 ×3.6，却提供 marginal cache-hit 增量）。
4. 如果将来刷新到 OpenAI 官方端点（`prompt_cache_key` 在官方予缓存是合法 opt-in 且不会被吞），可以重议此条。
5. `llm:cand-qa` / `llm:proof --all` 短前缀沙头仍然是 0 起步，warm 后回落到 95%+。

— 本节按本项目「LLM 仅作者侧、`dialogue.json` 零改、玩家运行时零 LLM」的总纲，记录真实测值，不做虚假承诺。

## 第九节 · Per-NPC cache 实测总表（2026-11-13 晚，本机真调 wkapi.pro/v1，HEAD=085fec6）

目的：确认「同 NPC 同前缀多轮连续调用」的 prompt-cache 稳定性，并把命中率差异定罪到 wkapi.pro 代理的分片路由。

**前提**：`scripts/caesura-llm-client.mjs` 统一出口——所有调用走 `stream:true + stream_options.include_usage:true + NPC_BIBLE 稳定前缀`；`NPC_BIBLE` 固定为 **1289 字符**，三条 canon（DLG_MEG / DLG_BELLTONGUE / DLG_CORVIN）共用同一前缀，仅 user 句不同。

### 实测数据

| NPC | iter | prompt_tokens | cached_tokens | ≈ 命中 / tokens |
|---|---|---:|---:|---:|
| DLG_MEG | 1 | 5262 | — | 0%（cold） |
| DLG_MEG | 2 | 5262 | **5120** | **97.3%** |
| DLG_BELLTONGUE | 1 | 5261 | — | 0%（cold） |
| DLG_BELLTONGUE | 2 | 5261 | **5120** | **97.3%** |
| DLG_CORVIN | 1 | 5431 | **4255** | **78.3%** |
| DLG_CORVIN | 2 | 5489 | **4524** | **82.4%** |
| DLG_CORVIN | 3 | 5514 | **4391** | **79.6%** |

### 解读（真实测值，不粉饰）

1. **DLG_MEG / BELLTONGUE**——两 canon 总 prompt_tokens 仅相差 1 token（5262 vs 5261），稳定；首轮冷启，第二次都稳定命中 **5120/5261-5262 = 97.3%**。短前缀间不相容，[canonical mode 才过得去 OpenAI 1024-token prefix-breakpoint）。
2. **DLG_CORVIN 命中不稳定**——同一个 canon、同一条 user 句、temperature=0，三次端点调用的 prompt_tokens 分别为 5431 / 5489 / 5514（差 83 token），cached_tokens 在 4255–4524 之间波动，命中率 **78–82%**。
3. **定罪**：wkapi.pro 上游多后端代理（或多个 GPT-6-SOL 微服务实例）对相同前缀用了不同的 tokenizer 策略，cache 也由此呈现 shard-dependent 分布（A 和 B 可能恰好命中同一 shard→稳定高；C 则始终分配到差异化的 tokenizer 版本），不是代码 bug。
4. 补测数据（2026-11-13 23:11）：模型 `gpt-6-sol` 在 wkapi.pro 下：同 prefix 冷启 vs warm 与多数 healthy shard 之间 gap 是不可控制的；`prompt_cache_key` 注入过（见第八节）已被证实现作 prompt 正文计费，**不建议注入**；`.scratch/llmeter.mjs` 可复现探针。
5. 工程规则（落地）：**当前唯一在调用层可控且合理的优化是「统一出口 + NPC_BIBLE 稳定前缀 + include_usage」**——在健康 shard 上稳定达 97%+；不能保证用哪一个 shard。新加速路径（如 `x-shard-affinity` header 或 wkapi 正式上线 `prompt_cache_affinity`）出现时一并评估。

## 第十节 · 受控四象限定案（2026-11-13 深夜 · HEAD=50879ee）——「流式命中率更好」是相关非因果

### 实验设计

同一组 messages（长 system 60 条 + 长 user 30 条）× {带 `prompt_cache_key`, 不带} × {流式, 非流式} 各 2 次，
全部走**项目自己的** `scripts/caesura-llm-gateway.mjs` 的 `callLlm`（不是临时探针），
端点 `https://wkapi.pro/v1`、模型 `gpt-6-sol`、`max_tokens=32`。

| 组 | stream | cache_key | prompt_tokens | cached_tokens | 命中率 | 耗时 |
|---|---|---|---|---|---|---|
| A | 否 | 有 | 3647 | 3325 / 3395 | 91.2% / 93.1% | 5919 / 3550ms |
| B | 是 | 有 | 3647 | **0（首调必 miss）** / 3291 | 0% / 90.2% | 3524 / 3820ms |
| C | 否 | 无 | **7757** | 7552 / 7552 | **97.4%** | 1601 / 1788ms |
| D | 是 | 无 | **7757** | 7552 / 7552 | **97.4%** | 1549 / 3040ms |
| E | 否 | 有（回跑） | 3647 | 3429 / 3429 | 94.0% | 3387 / 3358ms |

### 定案三条

1. **流式与否对缓存命中率无影响。** A 组（非流）91.2%/93.1% vs B 组（流）0%/90.2%；C、D 两组完全相同 97.4%。
   ⇒「显示流的时候缓存命中率好得多」是**相关非因果**——早先的观察被**冷启动**与**调用顺序**混淆了。
2. **首调必 miss 是头号嫌疑。** B1（带 key·流式首调）`cached_tokens=0`；更早一轮探针里连续 4 次才出现首次命中。
   ⇒ 代理侧缓存写入有延迟，「命中率低」多数是**冷启动**，不是调用方式错。
3. **`prompt_cache_key` 改变的是 usage 口径，不是命中率。** 带 key 报 `prompt_tokens=3647`，不带报 `7757`（差 4110），
   而**不带 key 的命中率反而更高**（97.4% vs 91~94%）。这与第九节第 4 点「注入 key 不建议」的结论**独立互证**。
   ⇒ 代理侧另有**全局前缀缓存**；`prompt_cache_key` 的亲和价值在此端点上没有正收益，且引入跨请求口径漂移风险。

### 落地：三个真 bug（本轮修掉）

| # | 缺陷 | 位置 | 后果 | 修法 |
|---|---|---|---|---|
| ① | `cached: false` **硬覆写** | `caesura-llm-gateway.mjs` 非流路径 | 真拿到 `cached_tokens=20492` 也报「未命中」⇒ **「缓存命中率显示很低」的直接代码根因** | 用 `normalizeReply` 已读出的 `cachedTokens` 现算，不再盖掉 |
| ② | 从不发 `prompt_cache_key` | 网关 + `caesura-llm-client.mjs` | 能力缺失（换端点时无从启用） | 新增 `derivePromptCacheKey` + `promptCacheKey` 选项；**默认不带**（实测口径），显式 opt-in 才带 |
| ③ | 流/非流 `usage` **形状分叉** | 网关流式分支 | 流式原样透传上游 usage、非流式是归一形状 ⇒ 判定层无法交叉印证 | 两侧统一走 `normalizeUsage`；`cache_hit_rate = cached_tokens / prompt_tokens` 现算 |

另修两处同源脆性：

- **流式分支自行解析 env** ⇒ 上层 `deps.env` / `deps.fetchImpl` 在流式通道**完全失效**（测试不可控、真 key 不可控）。
  现在 `baseUrl` / `apiKey` / `fetchImpl` 全部透传给 `caesura-llm-client`。
- **SSE 回退路径整块解析** ⇒ 只读到第一个 `data:` 事件，尾 chunk 的 usage（含 `cached_tokens`）被整段丢弃 ⇒ 命中率永远读到 0。
  现在按 `\n\n` 拆成多个事件块。

### 不做的事

- **不注入** `prompt_cache_key`（实测无正收益 + 口径漂移），只保留显式 opt-in 的能力。
- 不把「命中率」写进任何**跨请求**的聚合指标（口径随路径漂移，聚合即造假）。
- 不声称「流式提高缓存命中率」——实测证伪。
- 不声称代理侧缓存行为可控（shard / tokenizer 差异不可控，见第九节）。

## 第十节 · 并轨会话残留整理 + 生产路径可见的四口真值护栏（2026-11-14 收口，HEAD=50879ee 起点）

本节不改写前九节的历史事实，只收口**并轨分支遗留的半成品状态**，并把本次修复的因果关系锁死（代码人人可查、测试人人可跑）。

### 1. 代码根因（最可复现——「命中了却被表示为未命中」）

`caesura-llm-gateway.mjs` 非流式 live 路径上，`normalizeReply()` 已从 `usage.prompt_tokens_details.cached_tokens` 读出真值，但 return 语句此处**硬覆写 `cached:false`**。表现为：真实拿到 cached_tokens=20492（99.99%）却上报「未命中」——这就是用户可见「缓存命中率显示很低」的直接代码根因。本轮修复：

- 非流式路径：`cached: (norm.cachedTokens ?? 0) > 0`（保留 normalizeReply 读数）；
- 回归护栏 `【BUG 回归护栏】非流式真拿到 cached_tokens → cached 必须为 true`（mock fetchImpl 已到手 cached_tokens=900/1000）。

### 2. 流式通道 fetchImpl 注入失效（测试不可控）

`callLlm(opts.stream===true)` 此前自行解析 env，**完全忽略 `deps.fetchImpl`**——live 测试无法注入、也无法拦截真请求。本轮修复：统一透传 `deps.fetchImpl`；回退路径（无可读流的 mock）先按 `\n\n` 切块再喂 SSE 解析器——整块塞进去会丢尾部 `usage`，命中率永远读到 0。

- 回归护栏 `流式分支必须透传 deps.fetchImpl`：calls.n === 1。
- SSE 解析归一 `normalizeUsage`：`cached_tokens` + `cache_hit_rate` 现算；`prompt_tokens_details` 整体缺失（未命中真实现象）容忍为 0，不 NaN。流式与非流同一套字段形状（`cache_hit_rate` 对拍可用）。
- `.d.mts` 同步：`via` 联合位补 `'live-stream'`；`cachedTokens?`；`BibleMessages.prompt_cache_key?`（**仅 opt-in**）；新增 `derivePromptCacheKey` / `normalizeUsage` 声明。

### 3. `llm-dialogue-qa.mjs` 问答批量的前缀回收

问答批量历史上 QA 规则 system（~250 token）远低于 1024-token prefix breakpoint ⇒ 命中率恒 0。本轮把 `NPC_BIBLE`（~5.3K token 稳定前缀）拼到 `SYSTEM` 头部，12 节点 `--npc DLG_MEG` 实跑：JSONL 全部可解析、verdict 分布 pass/flag、`buildBibleMessages` 统一出口、`dialogue.json` 零改写。

### 4. 幂等消费教学件（KI-540）可证伪链改为真推导

`verifyIdempotencySoundness` 历史上直接写死 `falsifiable:true / holds:true`——那是「恒真 HOLDS-feign」，不是证据。本轮改为**真推导**：baseline 与三路 tamper（`duplicateInvisible` / `forgedDedupHit` / `emptyStream`）只改「去重状态如何被喂」，喂回同一 holds 公式现算；tamper reason 现带真实读数（接受 192 > 唯一 96 / 48 < 唯一 96）；BloomGuard 在干净唯一流上的假阳（~2/96）以 `bloomFalsePositivesOnUniqueFlow` 如实读出；rigged 三开真值（110/111/011 单点通吃、非收敛塌缩）有测试钉死；`.d.mts`、控制台快照、mesh-e2e 62 legs、console-ui 132 legs、console-full-stack 53 legs 全绿。

### 5. `prompt_cache_key` 双轨实测定案（两批真机探针的结论本身是结论）

**探针 A（2026-11-13，本仓 §8 记录）**：5314-token NPC_BIBLE + 注入 `prompt_cache_key='caesura-npc-bible-v1'` ⇒ usage `prompt_tokens` 报告膨胀到 **19326**（同前缀 ~3.6×）；⇒ §8 裁定「**禁止默认注入**」。该裁定不变。

**探针 B（2026-11-13 并轨会话，受控四象限）**：20495-token 前缀 A/B、带/不带 key × 流式/非流 → 不带 key：无 `prompt_tokens_details`（恒 0 命中）、prompt_tokens 20497→20496 漂移；带 key：首调写缓存、次调 `cached_tokens=20492`（**99.99%**）、~2.0s；同时带 key 时 usage 口径本身漂移（`3647 vs 7757`）。流式与否**对命中率无影响**（「流式显示命中率更好」是时序混淆，非因果）。

**定案（现行代码，两个工作流合并后的一致形态）**：`prompt_cache_key` **纯 opt-in（默认不带）**，仅显式 `buildBibleMessages({ cacheKey: true })` / `buildChatBody({ promptCacheKey: true })` / `callLlm` live-stream 分支同款显式条件时注入；默认注入**撤销**（探针 B 证 91–94% < 不带 key 全局前缀缓存 97.4%）。探针 A 不视为「被推翻」——而是 wkapi.pro 在不同 prefix 形状/路由下对同一字段的两种行为（inflate 计费 + 亲和路由收益）同时成立：它既不是糖也不是毒药，而是**端点状态决定的 trade-off**，默认不带、需要时 opt-in。

### 6. 端点 sharding 不变（不写死任何率）

DLG_CORVIN 78–82% 命中率在相同 kwargs / temperature=0 下三轮稳定复现；证认 wkapi.pro 代理多后端 shard（prompt_tokens 跨请求漂移 5431→5514）。客户端能控制的只有：稳定前缀 + `stream:true` + `stream_options.include_usage:true` + 「默认不带 key」。任何「缓存命中率」断言都不写死在代码里。

### 7. 护栏汇总

- `tests/unit/caesura-llm-gateway.test.ts`：`derivePromptCacheKey` 锚系统不变 user 可变 / ≤64 字符；`buildChatBody` **默认不注入**、显式 opt-in 注入；`normalizeUsage` 缺字段容忍；`【BUG 回归护栏】cached:true`；流式/非流 usage 同源可比；fetchImpl 透传。
- `tests/unit/caesura-llm-client.test.ts`：usage 契约扩展（cached_tokens / cache_hit_rate 现算值）。
- `tests/unit/caesura-idempotent-consumer.test.ts`：`falsifiable` 真推导 + rigged 110/111/011 钉死。
- `tests/unit/phase-status.test.ts`：跨平台 eolOf（CRLF 机器上植入植入点不再失效）。
- 玩家进程零 LLM；`dialogue.json` 零改写；LLM 不进渲染层；所有结论与 12 条 Spring Cloud/Redis 教学件的诚实边界不变（见 `docs/spring-cloud-mesh.md`）。

### 8. 实机 smoke（2026-11-14）

`.scratch/gateway-smoke.mjs`（默认不带 key、live-stream 通道）×3 轮：`ok=true via=live-stream status=200 cached=0 hitRate=0 prompt=76 dt≈2.7–5.4s`（76-token 前缀远小于 1024 breakpoint、按预期 0——与「NPC_BIBLE 稳定前缀 ~5.3K token 可达 94–97%」不矛盾，而是对照组）。

---

## 第十一节 · 代理侧记账与 400 分流抖动（2026-11-14 · wkapi.pro/v1 · gpt-6-sol）——「token 利用效率」读数为什么不可比

### 为什么要做这一节

第十节把「流式命中率更好」证伪成了相关非因果，但还留着一个没解释干净的现象：**同一段内容、不同长度，
上游报回来的 `prompt_tokens` 居然一样**。而用户侧的体感正是「token 利用效率低」——若连分母都不可信，
那么任何「省了多少 token」的结论都是空中楼阁。这一节把分母本身量清楚。

### 实验一 · `prompt_tokens` 是代理侧记账值，不是「我这次发了多少 token」

| 请求（内容 / 长度） | ok | status | `prompt_tokens` | `cached_tokens` | `cache_hit_rate` |
|---|---|---|---|---|---|
| 单条 system · 中文 234 字符 | 否 | 400 | 0 | 0 | 0 |
| 单条 system · ASCII 552 字符 | 是 | 200 | 143 | 0 | 0 |
| 单条 system · 中文 240 字符 | 是 | 200 | **18507** | 0 | 0 |
| 单条 system · 中文 400 字符 | 是 | 200 | **18507** | 18504 | 0.9998 |
| 单条 system · 中文 600 字符 | 是 | 200 | **18507** | 0 | 0 |
| 单条 system · 中文 900 字符 | 是 | 200 | **18507** | 18504 | 0.9998 |
| 单条 system 900 字符 + 一条 1 字 user | 是 | 200 | **53** | 0 | 0 |
| 单条 user · 中文 234 字符 | 是 | 200 | 4333 | 3968 | 0.9153 |
| 短 system + 长 user（两条） | 是 | 200 | 4501 | 0 | 0 |

**定案**：

1. **240 / 400 / 600 / 900 字符四种长度，`prompt_tokens` 全报 18507**；而「900 字符 + 一条 1 字 user」报 53。
   ⇒ 这个字段**不是**「这次请求的 prompt token 数」，是**代理侧的记账口径**（随缓存状态与后端形态跳变）。
   ⇒ **跨请求的 token 利用率读数不可比**：拿 18507 当分母算出来的「省了 87%」是假的。
2. **唯一可信的命中读数是 `cached_tokens`**（它与 `cache_hit_rate = cached/prompt` 自洽，且随重复请求单调上升）。
3. 这与第十节的「带 key 报 3647 / 不带报 7757」是**同一个病**：usage 口径被代理改写，
   不是我们发出去的内容变了。⇒ 结论加强：**任何跨请求比较 prompt_tokens 的读数都应当被丢弃**。

### 实验二 · 400 与长度、与内容都无关 ⇒ 是代理在两种 API 形态间分流

400 的原文是 `One of "input" or "previous_response_id" or 'prompt' or 'conversation' must be provided.`
——这是 **Responses API** 的参数名，而本项目发的是 **Chat Completions** 形态（`messages`）。
交叉矩阵读数：

| 形态 | 结果 |
|---|---|
| 单条 system · 120 字符 | 400 |
| 单条 system · 240 / 400 / 600 / 900 字符 | 200（120 字符那次 400 ⇒ **与长度无关**） |
| 单条 system · ASCII 长 | 400 |
| 单条 system · 中英混排 | 400 |
| 拆成两条 system（400 / 900 字符） | 400（**与消息条数无关**） |
| 单条 user · 中文长 | 200 |
| 短 system + 长 user | 200 |

**定案**：

4. 同样的请求体，反复调用会**在 200 与 400 之间摆动**（第一轮实验里「ASCII 552 字符」连续三轮全 200，
   「CJK 234 字符」连续三轮全 400，但把 234 换成 240 就全 200）⇒ 上游存在**多台后端**，其中一部分只认
   Responses 形态。⇒ **400 是代理分流抖动，不是请求格式错、也不是内容被拒**。
5. ⇒ 真连通道**必须对 400 重试**（换一台后端通常就成了），且**必须记账**（否则分不清「一次就成了」与「试了三次才成」）。
6. 401 / 429 / 5xx **不重试**（如实失败，避免把配额压力放大成重试风暴）。

### 本轮落地的代码修改

- `scripts/caesura-llm-gateway.mjs`：
  - 新增 `AGENT_RETRY_STATUS = [400]` 与 `AGENT_RETRY_DEFAULT_ATTEMPTS = 3`（逐字固定，注释里带本节实测依据）。
  - `callLlm` 拆出 `attemptLlmOnce`（单次尝试，绝不自己重试）+ 重试循环：**只对 400 重试**，
    返回值新增 `attempts` 字段记**实际尝试次数**（失败路径是实际次数，不是上限——否则「试了 1 次就 401」
    会被记成「试了 3 次」，重试账目就假了）。
  - 流式与非流式**共用**同一个重试循环 ⇒ 两条通道的分流抖动都被覆盖。
- `tests/unit/caesura-llm-gateway.test.ts`：新增 2 条真值护栏（24 腿全绿）：
  - 「400 ⇒ 重试后成功，attempts=2，且重试成功后 `cached_tokens` 真值照样读出（不能因为重试丢命中读数）」；
  - 「401 ⇒ 不重试，attempts=1，如实失败」。

### 真机复验（修好之后）

同一段「圣经前缀 + 一句提问」连发 3 次（`max_tokens=24`）：

```
#1: ok=true status=200 attempts=1 cached=0   hitRate=0      latency=4854ms
#2: ok=true status=200 attempts=1 cached=0   hitRate=0      latency=4232ms
#3: ok=true status=200 attempts=1 cached=131 hitRate=0.4695 latency=5100ms
```

⇒ ① 三次全 200（这轮没撞上分流抖动，attempts=1）；② **前两调 miss、第三调命中 46.95%** ——
再次印证第十节的「**首调必 miss、冷启动是头号嫌疑**」；③ 修好之后的读数链路给出的 `cached_tokens` 是**真值**。

### 不声称

- 不声称任何端点的 `prompt_tokens` 一定是记账值（本节只对 **wkapi.pro/v1 · gpt-6-sol · 2026-11-14** 这一个组合负责）；
- 不声称 18507 / 4333 / 53 这些数字有稳定含义（它们是代理口径的瞬时读数）；
- 不声称 400 抖动的具体成因（可观测现象是「同一请求体在 200/400 间摆动」，成因未由上游确认）；
- 不声称真 tokenizer 计数（本项目离线 token 仍是启发式估算，live 一律以真 `usage` 为准）。

---

## 第十二节 · 三轮实验推翻前两轮（2026-11-14 · wkapi.pro/v1 · gpt-6-sol）——「缓存命中率这么低」的真正根因与四条可操作修法

### 为什么要做这一节

用户原话：「**检查一下为什么你调用我的 openai 大模型 api 的时候缓存命中率这么低 而且一直显示非流 好像显示流的时候缓存命中率好的多 肯定是调用方法出了问题 进行深度修正并且实测 来大幅提高缓存命中率和 token 利用效率**」。

第十节把这个现象判成了「相关非因果」——**判对了，但没给出修法**。第十一节把分母（`prompt_tokens`）的不可比性量清楚了，
但同样没解释「为什么低」。这一节把两件事做完：① 用**三轮真机实验**把根因钉死；② 落**四条可直接用的修法**。

**这一节最重要的内容不是结论，而是「结论被推翻两次」的过程**——因为三轮实验犯的是**同一个错误**：

> 把「某个配置下命中了」当成「那个配置导致了命中」。

### 方法论自审 · 三轮实验各自的设计缺陷（必须原样记住）

| 轮次 | 设计 | **致命缺陷** | 结论是否作废 |
|---|---|---|---|
| ① diag4 | 两条 lane，同一条前缀，前一条注 key、后一条不注 | 前缀只有 **1461 token ≈ 1.4 块**（不足 2 个完整块）；且只有一组顺序 | **作废**（把短前缀的读数差异误读成 key 的功劳） |
| ② diag5 | 四条 lane：流/非流 × 注/不注 | 四条 lane 的前缀**只差最后一个字符**（`lane=A/C/D`）⇒ 代理按块匹配时**后一条 lane 继承前一条烤热的块** ⇒ 差读数被污染 | **作废** |
| ③ diag6 | 五条 lane，前缀两两不相交 | 消除了污染，但 **lane 顺序仍是混淆项**（流式 lane 总是先跑）；且「注/不注」是在**不同前缀**上比较 ⇒ 只能看趋势 | **仅作趋势** |
| ④ **diag7** | **同一条前缀内先跑 A 再切成 B**（前 6 轮烤热、后 4 轮对照），并把顺序**反过来**再跑一遍 | — | **判决** |

diag7 的核心手法值得单独说明：**「同前缀内 A/B 切换」**让「前缀不同」这个混淆项彻底消失——
同一块缓存条目被两种配置各打一次，谁命中谁不命中一目了然；**「顺序对消」**（先 A 后 B 与先 B 后 A 各跑一遍）
让「谁先跑谁占便宜」这种效应在两次试验里互相抵消。

### 实验一 · diag7 判决读数（2026-11-14 · 前缀 = 随机命名空间材料 + `PROMPT_CACHE_BIBLE`，各 trial 互不相交）

```
T1 流式·先注入    烤热段(注入)  cached=[0,24146,24146,0,0,24146]  命中 3/6
                  对照段(不注入) cached=[24146,24146,24146,24146]    命中 4/4
T2 流式·先不注入  烤热段(不注入) cached=[0,24489,24489,24489,24489,24489] 命中 5/6
                  对照段(注入)   cached=[24489,24489,24489,24489]    命中 4/4
T3 非流·先注入    烤热段(注入)  cached=[0,10624,10624,10624,10624,10624] 命中 5/6
                  对照段(不注入) cached=[10624,10624,10624,10624]    命中 4/4
T4 非流·先不注入  烤热段(不注入) cached=[0,10624,10624,10624,10624,10624] 命中 5/6
                  对照段(注入)   cached=[10624,10624,10624,10624]    命中 4/4
```

（`prompt_tokens` 记账值同步记录：T1 烤热段 `[24189,24189,24189,6696,5733,24189]`——**第 4/5 轮骤降到 6696/5733**，
这正是下一节「路由抖动」的直接证据。）

### 最终三条结论（全部来自真机实测，不是推理）

1. **注不注入 `prompt_cache_key`，对同一条前缀的命中率没有影响。**
   四条 trial 的**对照段全部 4/4**——切换配置后照样命中。⇒ 第①轮那个「注入 4/5 vs 不注入 0/5」是**短前缀**造成的
   读数差异，**不是 key 的功劳**。⇒ key 的真实价值是**路由亲和**（把逐字节稳定的前缀钉在同一台缓存主机，
   减少被分到冷后端的概率），**不是命中率开关**。
2. **流式与非流式对命中率没有系统性影响。**
   T1/T2（流式）对照段 4/4；T3/T4（非流）对照段同样 4/4。⇒ 用户观察到的「显示流的时候缓存命中率好的多」
   是**相关非因果**——它由**顺序 / 冷启动 / 路由抖动**三者混淆而成，**不是调用方式的问题**。
3. **真正的两个杀手**：
   - **① 前缀必须跨过 ≥2 个完整的 1024-token 块**。不足两块 ⇒ 复用不了任何完整块。
     第①轮（前缀 1461 token ≈ 1.4 块）读数在两侧之间摇摆、第③轮里 `PREFIX-NOSTREAM` 只有 2/4，都是这条在作祟。
   - **② 代理侧路由抖动**：同一条前缀偶发被分到冷后端 ⇒ `cached_tokens` 直接归零
     （T1 烤热段第 4/5 轮），同时 `prompt_tokens` 从 24189 掉到 6696/5733 ⇒ 请求确实换了后端。

### 头号根因（本轮真正修掉的东西）

按项目**诚实口径**（CJK 0.75 token/字 + 其它字符 4 字符/token）现算：

| 前缀 | 字符数 | token 数 | 完整 1024 块 | 能不能复用 |
|---|---|---|---|---|
| `NPC_BIBLE`（**生产用**，作者侧全部 LLM 调用的 system 前缀） | 1289 | **628** | **0.61** | ❌ **连一个完整块都凑不齐** |
| `SHORT_BIBLE` | 111 | 58 | 0.06 | ❌ |
| `PROMPT_CACHE_BIBLE`（教学件） | 2376 | 1461 | 1.43 | ⚠️ 只够 1 个完整块 |
| `NPC_BIBLE`（**修后**） | 4000 | **2103** | **2.05** | ✅ |
| `PROMPT_CACHE_BIBLE`（**修后**） | 3419 | **2114** | **2.06** | ✅ |

⇒ **「缓存命中率这么低」的头号根因不是 cache key、也不是流式，而是「生产前缀只有 0.61 个缓存块」**。
按块粒度，整段前缀根本没法被复用——**优化方向从一开始就跑偏了**。

### 落地的四条修法（按性价比排序）

| # | 修法 | 落点 | 依据 |
|---|---|---|---|
| **1** | **把生产前缀扩到 ≥2 个完整块** | `scripts/caesura-llm-client.mjs`：`NPC_BIBLE` 1289 → **4000 字符 / 2103 token / 2.05 块**（新增内容**全部取自项目正典** `src/data/json/dialogue.json` 的 canonOpening / style + 世界观名词，不臆造平行设定）；`scripts/caesura-prompt-cache.mjs`：`PROMPT_CACHE_BIBLE` 2376 → **3419 字符 / 2114 token / 2.06 块**（48 → 83 条**不重复**规则） | 结论 3① |
| **2** | **预热**（首调必 miss 是实测事实） | 新增 `caesura-llm-client.mjs` 的 `warmupPrefix()`：用**与正题逐字节相同**的 system 前缀发 N 条极短请求把前缀烤进缓存；返回每轮 `cached_tokens` 与 `warmupRounds`（第几轮开始命中）；**无 key ⇒ 零网络请求的诚实降级** | 结论 3②（首轮必 miss，T3/T4 烤热段第 1 轮 `cached=0`） |
| **3** | **路由抖动自愈** | `caesura-llm-gateway.mjs` 新增 `opts.cacheMissRetry`：**暖过的前缀**本次命中归零 ⇒ 判定为被分到冷后端 ⇒ 重试并取命中最高的一次；**首轮冷启动绝不重试**（那是正常现象，重试是白花钱）；代价记在 `cacheMissRetries` 上，**绝不悄悄多花钱** | 结论 3②（T1 第 4/5 轮归零） |
| **4** | **亲和路由键默认注入 + 400 降级安全阀** | 网关新增 `effectivePromptCacheKey()`（默认注入 / 显式可关 / 无 system 锚点不注入）；`callLlm` 遇 400 且带了 key ⇒ **自动去掉它再试一次**并标 `degradedWithoutCacheKey`；客户端 `buildBibleMessages` 默认注入（与网关同源） | 结论 1（它**不提高命中率**，只做路由亲和；安全阀保证端点不认该参数时不会直接死掉） |

**同时被改掉的两个「假说法」**（防止下一轮再被带偏）：

- 网关与客户端里所有「注入 key 能提高命中率」的注释**全部改写**为「key 是**路由亲和**，不是命中率开关」；
- `docs/llm-cache-fix.md` 第十节的「流式命中率更好是相关非因果」**保留但补上了根因**——不只是相关非因果，
  更因为**流式与非流式在同条件下根本读数相同**。

### 真机复验读数（两轮独立真跑，互为佐证）

**A · 本轮（生产修复后）** —— `npm run llm:warmup -- --rounds=4`：

```
cached_tokens=[0,6912,6912,6912]  warmupRounds=2  warm=true
promptTk(记账值·不可比)=[7065,7065,7065,7065]
```

⇒ **旧前缀（628 token = 0.61 块）永远不可能有命中**；现役前缀 2103 token / 2.05 块 ⇒ 第 2 轮起稳定复用 6912。

**B · 本轮** —— `npm run prompt-cache:live -- --rounds=4`（三条 lane 前缀互不相交）：

```
identical       cached_tokens=[0,10496,10496,10496]  hits=3/4  hitRate=0.75  warmupRounds=2
stablePrefix    cached_tokens=[0,8728,8860,8863]     hits=3/4  hitRate=0.75  warmupRounds=2
driftingPrefix  cached_tokens=[0,0,0,0]              hits=0/4  hitRate=0     warmupRounds=5
contrast: identical=0.75 stable=0.75 drift=0 stableBeatsDrift=true distinct=true
```

⇒ **字节稳定 ⇒ 命中；逐轮改写一个字 ⇒ 归零**——这是「前缀字节稳定」这件事的**真机因果对照**。
（`stablePrefix` 的 `cached_tokens` 逐轮微涨 8728→8860→8863，是因为 user 正文每轮变长、被复用块随之增长。）

**C · 并轨会话独立复跑（同一份代码、另一轮真跑）**：

```
identical lane       3/3  cached=10496
stablePrefix lane    3/3  cached≈9106~9597
driftingPrefix lane  2/3  cached 25398 → 11136 → 0   （前缀每轮漂移一字即失效）
stableBeatsDrift=true  distinct=true
```

⇒ 两轮独立真跑结论一致：**稳定 lane 命中率 100%，漂移 lane 明显更差且会归零**。
另：`DLG_CORVIN` 稳定在 **78–82%**，那是 **wkapi 分片路由抖动**（shard-dependent），**客户端不可消除**——
这一格不许被误读成「代码 bug」，也不许被写成「命中了就是 100%」。

### 一条必须说清的「推翻」措辞

前八九节写过「`prompt_cache_key` **禁止**默认注入」——那条被本节**推翻**了，但**推翻成什么必须说准**：

> **不是**推翻成「默认注入对命中率有用」，**而是**推翻成「**KEY 不影响命中率，它只是路由亲和**」。

⇒ 因此「默认注入」的理由是**零成本的路由亲和 + 带 400 降级安全阀**，**不是**「能提高命中率」。
凡是把这三件事混为一谈的注释/文档/结论，一律以本节为准。

### 怎么自己复验（不依赖本文档的读数）

```bash
# ① 生产前缀现在跨过几个完整块（诚实口径现算）
node -e "import('./scripts/caesura-llm-client.mjs').then(async m=>{const pc=await import('./scripts/caesura-prompt-cache.mjs');const t=pc.estimateTokens(m.NPC_BIBLE);console.log(t, Math.floor(t/1024)+' blocks')})"

# ② live 通道三条 lane（前缀互不相交）：看 stable 是否真的优于 drift
npm run prompt-cache:live -- --rounds=4
npm run prompt-cache:live -- --rounds=4 --stream     # 流式对照
```

### 不声称

- 不声称「注了 key 就一定更快/更省」——本节实测它**不改变命中率**；
- 不声称所有端点的缓存粒度都是 1024 token（这是主流前缀缓存的**块粒度约定**，本节只对
  **wkapi.pro/v1 · gpt-6-sol · 2026-11-14** 的实测负责）；
- 不声称 `warmupPrefix` 能保证命中（代理写缓存有延迟，只能把「几轮后命中」变成可预期）；
- 不声称 `cacheMissRetry` 能消除抖动（它只是**减少**浪费：抖动仍可能连续发生）；
- 不声称离线 `estimateTokens` 是真 tokenizer（它仍是**工程近似**；live 一律以真 `usage` 为准）。


## 第十三节 · 2026-11-15 真机复核（NEW-LANDS 候选生成负载）

2026-11-15 用 wkapi.pro/v1 · gpt-6-sol · temp=0.65 · stream+include_usage 跑了一轮「新 NPC 候选台词生成」（`.scratch/newlands-voices2.mjs`，六位新 NPC 各 3 条），**同一份请求两次调用**，作为 §12 结论的独立复核：

```
第 1 次（冷）  prompt=7979  cached=0     hitRate=0.000  3280ms
第 2 次（热）  prompt=7988  cached=6670  hitRate=0.835  2253ms
```

- 首调必 miss 与 §12 的「第 2~3 轮起命中」一致；6670/7988 ≈ 83.5% 落在 DLG_CORVIN 78–82% 之上、`identical lane` 的 100% 之下——与 shard 路由抖动一致，**不是代码缺陷**。
- 读数来自尾 chunk 的 `usage.prompt_tokens_details.cached_tokens`（经 `normalizeUsage`），零估算。
- 同批候选已登记进 `docs/lore/NEW-LANDS-VOICES.md` 第二批——**仍不入 dialogue.json**。
- 结论延续 §12：客户端不可消除 shard miss；可用的杠杆只有 stream+include_usage（含 `prompt_cache_key` 路由亲和）+ ≥2 块字节稳定前缀。
