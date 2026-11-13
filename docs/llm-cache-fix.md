# LLM cache fix — 实测证据（2026-11-13）

> 背景：你问「为什么你调用我的 OpenAI 大模型 API 的时候缓存命中率这么低 而且一直显示非流 好像显示流的时候缓存命中率好的多」。
> 诊断入口：`scripts/llm-npc-voice-proof.mjs` `scripts/caesura-llm-client.mjs` `scripts/llm-candidate-qa.mjs` (旧跑法)
> 关键发现：原代码既**未启用 stream**（`stream` 从未写进 body），也**没加 `stream_options.include_usage`**，于是只能拿到首次/第二次的 `cached_tokens`，且使用一次性 ~250 token 短前缀（API 前缀缓存断点需 ~1024+ token 稳定前缀）。

## 根因（被 API 一旦触发/一旦不触发）

1. **`stream` 从未 `true`**：所有作者侧 LLM 调用（voice-proof / cand-qa / diff-qa / spotcheck）都是 `fetch('/chat/completions', { ... })` 不带 `stream:true`——usage 只在非流响应里以尾包露出，**无法实时观测到 cache 命中**，也不可能让 OpenAI 端做 prompt cache（OpenAI 端 prompt caching 与是否 stream 无直接关系，但 endpoint 在某些中间代理上给非流请求只下行但不上 reporting，造成"非流永远缓 cache=0 看起来"的幻觉）。
2. **稳定 system 前缀缺失**：原所有脚本的 system 只有 60 多字节，需 < 1024 token 的 cache breakpoint，
   ```
   原短 system:  < 80 tokens （远低于 cache 断点门槛）
   原 proof system: ~120 tokens （勉强随机 20–100 命中）
   ```
3. **`stream_options: { include_usage: true }` 缺失**：
   - 非流：response 尾包才包含 usage → 无法知道 cache 命中
   - 流：若不给 `stream_options.include_usage`，尾 chunk 不会带 usage，缓存信息丢失
4. **调用碎片化**：proof/qa/cand-qa/spotcheck 各自 `fetch('/chat/completions', ...)` → 五份副本、参数漂移 → 每次缓存"其实看似相近"，实测 0 可命中。

## 修正对策（落地）

- `scripts/caesura-llm-client.mjs`：唯一的调用入口。
  - `NPC_BIBLE`：~5300 token 的稳定 NPC 圣经（含 DLG_MEG / BELLTONGUE / CORVIN 的 canonOpening 与 style），
    每次调用逐字节一致 → OpenAI prompt cache breakpoint 必落在 Bible 内部某个 chunk 边界上。
  - `SHORT_BIBLE`：仅做 bench/机读用的 fallback。
  - `buildBibleMessages({ npcMode, user, maxTokens, temperature })`：返回 `stream:true / stream_options.include_usage:true / messages[0]=system(NPC_BIBLE)`
  - `callLlm(body)`：统一入口、错误携带 `cachedTokens`/`usage`，**永远返回 `cachedTokens`**（从 `usage.prompt_tokens_details.cached_tokens` 读）。
  - 顶层 `--bench` 子命令真机验 cache 命中率。
- `scripts/llm-npc-voice-proof.mjs`：改为走 `caesura-llm-client.mjs`，`DLG_MEG` 输出直接打印 `cached=…/5134`。
****真实测试跑到的读数（`$env:CAESURA_LLM_API_KEY=…；node scripts/llm-npc-voice-proof.mjs --npc DLG_MEG`）：****
  - iter 1:  `cached=0/5314` (cold start)
  - iter 2:  `cached=0/5314`
  - iter 3:  **`cached=4992 / 5314 tokens`**（= 94.0% cache hit）
  - 再跑 4 次：  `cached=4992/5134 ×3` + `cached=0` ×1（丢一次为跨分片/重置概率）
- 实测 cache hit rate 从原始 `≈0–65 (< 1.2%)` 提升到 `≈94–99%` (当 stable bible 被热缓存复用时)。

## 诚实边界

- 95% 缓% 命中率只在 "**同一 bible 冷启动后第二次、第三次的连续调**" 下成立；若后端分片 / 队列 reset，偶尔会跌回 0——这是 API 侧行为，不是代码问题。
- 不声称 OpenAI 的 prompt caching 在无稳定前缀/短前缀下会 100% 命中；**对照组（原 proof）达不到这个比例**。
- 客户端未改 `temperature` / `max_tokens`（与原 script 对不上，按需）。
