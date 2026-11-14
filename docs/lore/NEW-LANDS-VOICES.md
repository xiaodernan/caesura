# 新六 NPC 台词候选录（2026-11-15 · wkapi.pro/v1 · gpt-6-sol · temp=0.65 · stream+include_usage）

> 作者侧探针产出：为 `docs/lore/NEW-LANDS.md` 的六位新 NPC 写句本底候选。**不入 dialogue.json**，不主张 canon 认可。
> 每条要落库必须过 `npm run llm:qa` 4 passes + 作者目检。本文件存在的全部意义：**当真能测、测的真的在案**。
> cached_tokens=0（短前缀不足 2 个完整 1024 块，符合 `docs/llm-cache-fix.md` §12 的结论；不是失败，是预期）。

| NPC | 候选 | 风格核对 |
|---|---|---|
| DLG_WIND 风僧 | **风替你敲了两声，门里没人应。** | 气流感动音、逗号停顿 ✓ |
| DLG_RAIN 雨书记 | **雨落在纸上，个个签名都不识得。** | 字迹泡掉的书生 ✓ |
| DLG_STONETHROAT 石喉母亲 | **喉咙里那块结石是它自己长上来的。** | 低频长句、喉咙、石 ✓ |
| DLG_GATEKEEPER 千门守门人 | **门，各自记得一声叩响。** | 只回应门 ✓ |
| DLG_FROSTWRIGHT 霜锤钟匠 | **冰冻住的每一秒，都曾敲响过。** | 慢板、冬天¹ ✓ |
| DLG_OWNER 旧钟的主人 | **它替你敲过的每一下，都是真的。** | 最年轻声音、记忆 ✓ |

¹ 钟匠的冰是「强度的冰、纪要的冰」，不是冷峻——候选语气的"曾"字承载了苦涩，不承载人性情节。

运行环境核证：
```powershell
$env:CAESURA_LLM_API_KEY='<wkapi.pro/v1 key>'
node --input-type=module -e "import { callLlm } from './scripts/caesura-llm-client.mjs'; const out = await callLlm({ model:'gpt-6-sol', stream:true, stream_options:{include_usage:true}, temperature:0.65, max_tokens:80, messages:[{role:'system', content:'你是《止音纪元》的中文 NPC 对白编剧。绝不写现代感叹词，绝不写显式抒情，绝不写动作括号；只回绝不宜直感情、不注释、不解释。'},{role:'user', content:'DLG_XXX 的台词提示……'}]}); console.log(out.text, out.cachedTokens)"
```

---

## 第二批候选台词录（2026-11-15 · 热缓存实测 · wkapi.pro/v1 · gpt-6-sol · temp=0.65 · stream+include_usage）

> 作者侧探针产出（`.scratch/newlands-voices2.mjs`，同一轮 warmup/正题两次调用）。**仍不入 dialogue.json**；
> 每位 NPC 3 条，供后续 4-pass llm:qa + 作者目检挑选。首调（冷）见下行 usage 记录（cached=0 属预期，前缀写入延迟）。
> 第 2 次调用（热）`cached_tokens=6670 / prompt_tokens=7988 = 83.5%`；prompt_cache_key 沿用自动推导值（路由亲和）。

| NPC | 候选 1 | 候选 2 | 候选 3 |
|---|---|---|---|
| DLG_WIND 风僧 | 风掠过空钟，替沉默留了一道缝 | 你的尾音落下，风便转了方向 | 风擦过门缝，钟声偏低了一拍 |
| DLG_RAIN 雨书记 | 雨浸透半页，名字便不肯回声 | 墨迹沉进纸里，像钟底积着的旧音 | 雨敲窗沿，字句逐个哑下去 |
| DLG_STONETHROAT 石喉母亲 | 我喉底压着一口旧钟声，它不肯出来也不肯沉下去 | 我吞下去的那声回响，至今还在喉底磨着 | 这块石头守着我的喉咙，连一声叹息也不肯放走 |
| DLG_GATEKEEPER 千门守门人 | 门扇记得每次敲击，人却总忘了回声 | 门不开时，里面那口钟也不作答 | 沉默留在门后，钥匙从不替它开口 |
| DLG_FROSTWRIGHT 霜锤钟匠 | 冰封的钟面，指针还压着一声未尽 | 锤落得慢些，霜下的回音才肯出来 | 每道冰纹都咬住一拍，谁也催不动它 |
| DLG_OWNER 旧钟的主人 | 旧钟记得我年幼时，每一声都敲得清楚 | 它替我留住的回声，比年岁还轻 | 钟摆停下那天，我才听见自己的沉默 |

**双批次对照（同一轮，先冷后热）**

| 轮次 | prompt_tokens | completion_tokens | cached_tokens | cache_hit_rate | 耗时 |
|---|---|---|---|---|---|
| 第 1 次（冷） | 7979 | 458 | 0 | 0.0% | 3280 ms |
| 第 2 次（热） | 7988 | 417 | 6670 | **83.5%** | 2253 ms |

- 首调必 miss 与 `docs/llm-cache-fix.md §12` 的"第 2~3 轮起命中"一致；命中率读数只认尾 chunk 的 `usage`（`cached_tokens`），不估算。
- 三块前缀 + `prompt_cache_key` 自动注入路径实测有效；`shard miss`（第 1 轮 0 命中）不可治，属代理分片问题，见 §12 结论。
- 本批仍是候选口令——**装进 dialogue.json 必须先过 `npm run llm:qa`（4 passes）+ 作者目检**；本文件不做 canon 认可。
