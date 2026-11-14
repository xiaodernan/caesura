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

- 首调必 miss 与 `docs/llm-cache-fix.md` 第十二节的"第 2~3 轮起命中"一致；命中率读数只认尾 chunk 的 `usage`（`cached_tokens`），不估算。
- 三块前缀 + `prompt_cache_key` 自动注入路径实测有效；`shard miss`（第 1 轮 0 命中）不可治，属代理分片问题，见 §12 结论。
- 本批仍是候选口令——**装进 dialogue.json 必须先过 `npm run llm:qa`（4 passes）+ 作者目检**；本文件不做 canon 认可。

## Canon 检索增强对账（2026-11-14 · wkapi.pro/v1 · gpt-6-sol · temp=0.1 · stream+include_usage）

> 做法：BM25-ish（字符二元组）对 `docs/` + `src/data/json/*.json` 所拉检索池 top-5（ dialogue/all → WORLD-BIBLE → narrative.md → NEW-LANDS），
> 然后让 judge 对比着检索块对照候选给 verdict。不碰 dialogue.json。

| NPC | 候选 | Verdict | Reason | dt_ms |
|---|---|---|---|---|
| DLG_WIND | 风掠过空钟，替沉默留了一道缝 | ok | 复述风与钟的既有意象，未引入新设定 | 1590 |
| DLG_WIND | 你的尾音落下，风便转了方向 | unsupported | 仅有风相关设定，未支持风随尾音转向 | 3289 |
| DLG_WIND | 风擦过门缝，钟声偏低了一拍 | unsupported | 风与门缝、低钟声偏拍均无直接canon支持 | 1206 |
| DLG_RAIN | 雨浸透半页，名字便不肯回声 | unsupported | 雨会抹去字迹已有依据，名字不回声未获支持 | 5476 |
| DLG_RAIN | 墨迹沉进纸里，像钟底积着的旧音 | unsupported | 意象可通，但未有足够canon支持钟底旧音 | 1537 |
| DLG_RAIN | 雨敲窗沿，字句逐个哑下去 | ok | 复述雨与字迹被抹去的既有意象，未引入新设定 | 1265 |
| DLG_STONETHROAT | 我喉底压着一口旧钟声，它不肯出来也不肯沉下去 | unsupported | 石喉仅有结石设定，未支持喉底藏旧钟声 | 4179 |
| DLG_STONETHROAT | 我吞下去的那声回响，至今还在喉底磨着 | conflict | 将实物结石改写成吞下的回响，违背既有设定 | 4582 |
| DLG_STONETHROAT | 这块石头守着我的喉咙，连一声叹息也不肯放走 | dup | 复述石喉女主人喉中结石设定 | 1587 |
| DLG_GATEKEEPER | 门扇记得每次敲击，人却总忘了回声 | ok | 复述守门人记门与敲击，未违写作纪律 | 1419 |
| DLG_GATEKEEPER | 门不开时，里面那口钟也不作答 | unsupported | 门内钟及其不作答的设定缺乏canon支持 | 2394 |
| DLG_GATEKEEPER | 沉默留在门后，钥匙从不替它开口 | unsupported | 钥匙与门后沉默的关系缺少明确canon支持 | 5142 |
| DLG_FROSTWRIGHT | 冰封的钟面，指针还压着一声未尽 | conflict | 冰钟可对应，指针与未尽之声无据，且属半句抒情 | 5644 |
| DLG_FROSTWRIGHT | 锤落得慢些，霜下的回音才肯出来 | ok | 符合霜锤钟匠慢板与冰霜回响设定 | 3481 |
| DLG_FROSTWRIGHT | 每道冰纹都咬住一拍，谁也催不动它 | ok | 符合霜锤钟匠的冰与节拍设定 | 4217 |
| DLG_OWNER | 旧钟记得我年幼时，每一声都敲得清楚 | unsupported | 年幼时的记忆与每声清晰，现有设定未支持 | 4702 |
| DLG_OWNER | 它替我留住的回声，比年岁还轻 | unsupported | 年岁之轻有据，留住回声的设定未见 | 5646 |
| DLG_OWNER | 钟摆停下那天，我才听见自己的沉默 | unsupported | 钟摆停下与自身沉默均无足够canon支持 | 3294 |
| DLG_WIND | 风替你敲了两声，门里没人应 | unsupported | 有风敲门依据，次数与无人应答未见据 | 7957 |
| DLG_RAIN | 雨落在纸上，个个签名都不识得 | dup | 复述雨书记“每一滴雨都签了一个我看不懂的名字” | 1372 |
| DLG_STONETHROAT | 喉咙里那块结石是它自己长上来的 | dup | 复述石喉女主人已有台词 | 1360 |
| DLG_GATEKEEPER | 门，各自记得一声叩响 | dup | 复述“每扇门都说你敲过” | 2329 |
| DLG_FROSTWRIGHT | 冰冻住的每一秒，都曾敲响过 | dup | 复述霜锤钟匠既有台词 | 2911 |
| DLG_OWNER | 它替你敲过的每一下，都是真的 | dup | 与旧钟主人既有台词完全相同 | 1848 |

累计 cached_tokens = 91264 · 总调用 24 次 · 本节仅登记结论，不入 dialogue.json。
