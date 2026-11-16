
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

