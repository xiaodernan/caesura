
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
