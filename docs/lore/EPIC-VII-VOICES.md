# EPIC-VII《低音之城》whisper 候选 · canon 检索增强对账（2026-11-15）

> **状态**：设计稿配套附录。不是主线内容，不是 runtime，不是 `dialogue.json`。
> **工具**：`.scratch/epic7-canon-probe.mjs`（与 `scripts/newlands-canon-rag.mjs` 同构：BM25-ish 字符二元组 top-5 + LLM judge，`temperature=0.1`，`stream+include_usage`）。
> **模型**：wkapi.pro/v1 · `gpt-6-sol` · `CAESURA_LLM_API_KEY` env 注入 · 密钥不落 git。
> **Corpus**：dialogue.json（81 chunks）+ WORLD-BIBLE + narrative + NEW-LANDS + EPIC-V/VI/VII 设计稿 = **208 chunks**。
> **用法纪律**：本表只对候选行负责；verdict 不影响 EPIC-VII 的 DESIGN-ONLY 地位；任何 whisper 候选要进主线必须过 `llm:qa` 四轮 + 作者目检。

## 对账表（14 行 · 2026-11-15）

| # | npcId | 候选行 | verdict | judge 理由（原文） |
|---|---|---|---|---|
| 1 | DLG_WIND | 风从低音之城那边转回来了，带着一纸交割单的味道 | conflict | 以「交割单的味道」作半句抒情，违反写作纪律 |
| 2 | DLG_WIND | 风没有往回敲，门槛上只有低音石潮湿的气 | conflict | 「低音石」是未见设定；句式属半句抒情，违反写作纪律 |
| 3 | DLG_RAIN | 雨把衙门的墨迹洗成白纸，署名一行也不剩 | conflict | 雨会洗去字迹有据，但「衙门」是未见的新地点 |
| 4 | DLG_RAIN | 雨停以后，判词还湿着，纸面已经不认人了 | conflict | 抒情句触犯禁半句抒情；「纸面不认人」无 canon 支持 |
| 5 | DLG_FROSTWRIGHT | 第四十八下之后，我把锤放回雪里 | unsupported | 「第四十八下」与「雪里」均无 canon 支持，且未违反写作纪律 |
| 6 | DLG_FROSTWRIGHT | 敲钟的人不回看自己的手 | dup | 与已检索 canon 句子完全相同 |
| 7 | DLG_FROSTWRIGHT | 你这把锤，前十二下太轻，中间十二下才像，最后二十四下是挥别 | dup | 改写了既有台词的敲击分段与「挥别」结论 |
| 8 | DLG_OWNER | 编年回廊里，我给你留的那一记还在原位 | conflict | 回廊里没有 NPC；此句暗示说话者曾在回廊留过东西 |
| 9 | DLG_OWNER | 门里没有答案，只有你四十八记的回音住址 | conflict | 半句抒情，且「四十八记的回音住址」无 canon 依据 |
| 10 | DLG_GATEKEEPER | 负荷降得够低，人们连自己的呼吸都要记账了 | conflict | 守门人只回应门；此句谈论人们的呼吸，违背声部限制 |
| 11 | DLG_GATEKEEPER | 一切敲过的东西，都该有个对价 | dup | 与已登记 canon 句子完全相同 |
| 12 | DLG_STONETHROAT | 低音石出厂的时候，它们都还是热的 | unsupported | canon 只说写编号时低音石还热，未记载出厂时的状态 |
| 13 | DLG_STONETHROAT | 霜下那块钟核，至今压着一声没人敢承认的回音 | conflict | 新增「霜下钟核」设定，且属半句抒情 |
| 14 | DLG_OWNER | 钟从不是声音，钟是你愿意让世界继续听下去的方式 | dup | 与 EPIC-VII 的 §3 条 canon 句子相同，仅标点格式不同 |

**汇总**：ok 0 · unsupported 2 · dup 4 · conflict 8 · parse-error 0。

**Token 统计**：14 calls，cached_tokens 合计 **240,981**（第 1 次 cold=0；第 2 次起每次 18,537 cached —— prompt 前缀复用率约 84–93%）。

## 结论（给后续作者的三条硬教训）

1. **禁半句抒情**不是装饰 —— 14 行里有 4 行直接撞上这条铁律（1/2/4/9/13），句尾收住就废掉一整行。
2. **把设计稿本身当 canon 语料是污染**：本次 4 个 dup 全部是 EPIC-VII 正文原句被检索出来后判成「与已检索 canon 句子完全相同」。设计稿里出现的 whisper 例句**就是没过闸的候选**，不是可用台词。
3. **「未见设定」默认判 conflict**：低音之城本身在 canon 里只有 `NEW-LANDS` 一行提及（`低音之城 ♭G` 归属表），所以「低音石」「霜下钟核」一律被判 conflict 而不是 unsupported——**EPIC-VII 的物品词必须先登记进 WORLD-BIBLE 派生表，再谈写台词**。

## 方法论注记

- Corpus 构成动了：本轮把设计稿 pack（EPIC-V/VI/VII）加入了检索池，导致 dup 率虚高（正文自引）；后续对账应对设计稿 pack 加 `tag=设计` 时打可见标签并在结果里单列"含设计稿：true"。
- `DLG_WIND` / `DLG_RAIN` 在 dialogue.json 里**根本不存在**（EPIC-V/VI 新机 NPC，dialogue.json 未登记）——judge 给的 conflict/dup 仍然成立，因为判断依据是检索内容而不是说话人真实性；这不是 bug，是这句话要记账。
- 0 条 ok ≠ 这一章走不进主线；这一章从来不打算现在走进主线——关电闸清单见 `docs/EPIC-VII.md §5`。

> 密钥：全程 `CAESURA_LLM_API_KEY` env 注入；本文件零密钥落盘。
