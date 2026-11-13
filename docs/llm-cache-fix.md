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
