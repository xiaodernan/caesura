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
