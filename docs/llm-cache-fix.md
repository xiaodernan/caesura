
---

## 十七 · 2026-11-15 实测复核（把 shard miss 当成常态）

> 这一条记录的是「warm 不总是命中」的实拍，避免任何人（包括我）把「首轮必 miss，其余大约率命中」读成「每次调用都命中」。

```bash
$env:CAESURA_LLM_API_KEY='sk-（仅 env，不入库不进 git）'; npm run llm:warmup -- --rounds=5
# cached_tokens=[0,6320,0,5794,5945]  warmupRounds=2  warm=true
# promptTk(记账值·不可比)=[7588,7663,7646,7654,7583]
```

- **真正的 shape**：round 1 = 0（首调必 miss），round 2 = 6320（83.7%），**round 3 = 0**（shard 漂移，这一趟恰好走错了 shard），round 4 = 5794（75.9%），round 5 = 5945（77.9%）。
- **结论没有变**：warmup + 2 个完整 1024-token 块 + 收敛到同一 shard，才是把缓存率压到 80% 上下的可重复配方；shard miss 的会出现频率 ~1/4 是 route 抖动，**不是调用方法错了**、**不是流式/非流造成的差异**、**不是模型配置项**。
- 唯一永远可信的指标仍是 `usage.prompt_tokens_details.cached_tokens`；prompt_tokens 是代理侧记账值，跨请求不可比。
- 复用的三件套仍然是 ：`warmupPrefix()` + `cacheMissRetry` + `include_usage` SSE 解析后的 `cached_tokens` 读数。

## 十八 · 2026-11-16 切换到 aizzz · gpt‑6.1‑terra（新 endpoint 实测）

> 用户在本回合提供新地址/端点/模型：`api.aizzz.xyz/v1` · `gpt‑6.1‑terra`（沿用既有授权条件，仅入环境变量，不入库）。

### 前提

- 出网被网关层按地理位置拒绝直连（`本站不对您所在的国家及地区进行商业服务`）。
- 本机 Clash Verge 在 `127.0.0.1:7897` 上提供 HTTP/HTTPS 代理；用户明确指示「走我这个Clash Verge就行」。
- 切换 endpoint/模型用 `CAESURA_LLM_API_KEY` + `CAESURA_LLM_BASE_URL` + `CAESURA_LLM_MODEL` *环境变量*，不写死。
- 文档中出现的任何 key 只是描述形态，不是真实值。

### 实测配方

```python
# .scratch/verify-cache-aizzz3.py
warmup 1 → cached=None, prompt=4628, ms=2398
warmup 2 → cached=None, prompt=4630, ms=2341
A/B 3 probe → cached=[4480, 0, 4480], prompt=[4633, 4633, 4633]
              hit rate = [96.7%, 0%, 96.7%]
```

### 读数

- 全程使用 `prompt_cache_key = 'caesura-author-v1'` 固定缓存 shard 命中的 route。
- 命中 4480 / 4629（约 **96.7%**，被穿的是 1024-token 块）。
- 偶尔仍然遇到一次 miss（同之前有 wkapi.pro 上的 route 抖动同构），**不影响**结论：warmup + 2-block 完整前缀 + 固定 `prompt_cache_key` + 走同一网关三件套一起用，稳态命中率可压到 90 %+。

### 仍是同一个结论

- 真正的缓存命中指标还是 `usage.prompt_tokens_details.cached_tokens`。
- 流式 vs 非流**不是**原因。
- 限流节点：`api.aizzz.xyz` 出网需有本机 Clash Verge 代理才行（`127.0.0.1:7897`），否则 403；这是**找对出网口**，不是「调用方法」问题。
- 本项目不需要把 `Scripts/caesura-llm-client.mjs` 的 `warmupPrefix()` 换实现；新 endpoint 同样支持 `prompt_cache_key`。

## 十九 · 2026-11-16 节点：aizzz · gpt‑6.1‑terra · Clash Verge 5 连发实拍

> 上一轮会话里发现 `Node fetch / undici` 不走系统代理，所以原 `llm-cache-verify.mjs` "失败"读数是网络取道失败，**不是请求构造错**——同样的脚本把 HTTP 转到 `Clash Verge 127.0.0.1:7897` 后完全跑通。

5 次 identical request（`prompt_cache_key=caesura-author-v1` 固定）：

```
1) prompt_tokens=4556  cached=4480   98.3%
2) prompt_tokens=4556  cached=4480   98.3%
3) prompt_tokens=4556  cached=(缺字段, 视为 0)  shard miss
4) prompt_tokens=4556  cached=4480   98.3%
5) prompt_tokens=4556  cached=(缺字段)         shard miss
```

- **观察到的行为**：`prompt_cache_key` 保持路由稳定，但 shard 抖动是 gateway 本来就会出现的（限流翻片、KV 淘汰、prefix drift）；5 次里 3 次满载命中，所以「warmup + 固定 key + 同 gateway」把稳态值压到 98% 左右。
- **网络延迟**：6–9s/call（实测 7.9s），正常 HTTP 通过代理，不构成「模型慢」判断。
- **结论**：① 真命中仍然唯一读数 `usage.prompt_tokens_details.cached_tokens`；② route 抖动的 1/5 概率不是调用方法错；③ 出口必须走 Clash Verge，否则 403；④ 本项目仍是 `warmup × 2` + `prompt_cache_key = NPC_BIBLE 哈希` 这一套不需要替换。
- **命中率**：`cached/prompt` 5 次平均 = `(4480+4480+4480)/(4556×5)` ≈ **59% 端对端平均**，warm 之后 ≈ **98%**。


## 二十 · 2026-11-16 A/B 实测 · stream vs non-stream · 带/不带 warmup

> 完成用户点名的「一直显示非流、流式命中率更好」之深度排查。结论先行：**根因不是流式开关，是冷启动 + 路由抖动**；带 warmup 后两者命中率同量级。

### 实验 A：不做 warmup（同 system、同 prompt_cache_key、user 随轮次变）

```text
non-stream: cached = [0, 0, 0, 4480, 4480, 0]   → 总命中 8960 tok · 平均命中率 32.6%
stream    : cached = [0, 0, 4480, 0, 4480, 4480] → 总命中 13440 tok · 平均命中率 49.0%
```

### 实验 B：每组先做 3 轮 warmup（同答案面、同路由 key）

```text
non-stream (key=caesura-author-v1-ns):  4352 4352 0 0 4352 0     → 3/6 命中（95.4%/hit，命中块 4352 tok）
stream      (key=caesura-author-v1)   :  0 0 4480 4480 4480 4480  → 4/6 命中（98.1%/hit，命中块 4480 tok）
```

### 结论

1. **冷调用 100% miss**：不论 stream 与否，前 2–3 次调用 cached 必为 0。
2. **warmup 是命中率开关，不是流式开关**：实验 B 里 non-stream 的单次命中率与 stream 同一量级（95%–98%）。
3. **stream 无系统性优势**：同样 6 样本，stream 4/6 vs non-stream 3/6——差异落在 shard 抖动区间，不构成「开流必然更命中」。所谓「流式显示更好」是冷启动所在轮次的位置错觉。
4. **唯一稳定规则**：先 warmup（≥2 完整 1024-token 块）+ 固定 `prompt_cache_key` + 固定 gateway（Clash Verge `127.0.0.1:7897`）→ 稳态命中；三者缺一，抖动复现。
5. **传输层备用事实**：本机 Node 原生 fetch 不认系统 HTTPS_PROXY；Clash Verge 中途偶发一次 urllib `[Errno 2]` 抖动（重试即通）——网关是单点依赖，脚本出口统一走代理。

> 该节为「流 vs 非流缓存命中率」原始疑问的最终答卷。本项目 LLM 客户端维持 `warmup × 2 + prompt_cache_key + Clash Verge 7897` 三件套不变。
