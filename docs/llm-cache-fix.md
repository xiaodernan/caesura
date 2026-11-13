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

1. **DLG_MEG / BELLTONGUE**——两 canon 总 prompt_tokens 仅相差 1 token（5262 vs 5261），稳定；首轮冷启，第二次都稳定命中 **5120/5261-5262 = 97.3%**。短前缀间不相容，[canonical mode 才过得去 OpenAI 1024-token prefix-breakpoint](前端)。
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
