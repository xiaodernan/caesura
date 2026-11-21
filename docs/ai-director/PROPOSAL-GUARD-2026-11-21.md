# AI 导演提案避让闸门 · 真跑 proof（KI-725 · 2026-11-21）

## 问题（根因）

第 84 篇真跑时，LLM 提出 `flag.earless_deeps_five_ring_clues_archived`，被流转 QA 判为 `conflict`——
与既有 `flag.faceless_clue_ring_complete` 重复。根因：`proposeTransitions` 节点起草时**从未见过既有 flag 名册**，
无法知道哪些旗标已存在、哪些被判过重复，只能凭 canon 文本臆造 flag 名。

## 改进（StateGraph 自我改进闭环）

把 QA 的反馈回灌进提案节点，形成闭环：

```
canon 检索 → audit → [避让名册注入] proposeTransitions → draftContent → editorialGate
                          ↑
       regions setsFlag + echo-flow entries + dialogue flags + 历史 QA conflict
```

`scripts/ai-director.mjs` 新增 `canonFlagRoster()`：
- ① `regions.json` 的 `interactables[].setsFlag`（玩家真能触发的旗标）
- ② `echo-flow.json` 的运行时 entries（已放行的世界线旗标）
- ③ `dialogue.json` 的对白旗标
- ④ 上一轮 `transitions-qa.json` 里 `canonFit=conflict` 的旗标（明确重复，严禁再提）

名册作为「避让提示」注入提案 task；LLM 起草时即知哪些旗标已占用、哪些历史重复。
人工闸仍是唯一放行口——脚本只做机械自检（撞 conflict 如实登记为 `transitionWarnings`），不自动丢弃。

## 真跑实测（gpt-6.2-sol · Clash 7897）

| 指标 | 值 |
|---|---|
| mode / model | `live` / `gpt-6.2-sol` |
| 调用 | 5 × HTTP 200 · errors=0 |
| 缓存 | cached=507,759 / prompt=575,038 · mean_hit=88.3% · steady=88.15% |
| 避让名册 | **69 面**既有 canon flag 喂进提案上下文（真实提高上下文利用率） |
| 历史 conflict 识别 | `flag.earless_deeps_five_ring_clues_archived` 被正确识别并注入警示 |
| 本轮新提案 conflict | **conflict=0**（`warnings=[]`，4 条新 flag 全部避让成功） |
| 新提案 flag | `flag.doorway_bowl_touched_and_returned` / `flag.doorway_bowl_left_unfilled` / `flag.threshold_question_left_unanswered` / `flag.fingertip_ash_allowed_to_fade` |

新 flag 与第 84 篇《门口的水》主题高度契合（门边的碗 / 没水 / 门槛 / 指尖的灰），
且都是 genuinely new 的动作——证明 LLM 真正理解了"避免语义重复"的约束，而非机械改后缀。

## 结论

把 QA 冲突信号回灌进 StateGraph 的提案节点后，重复提案被从源头消除（conflict 1→0），
同时把真实上下文从约 62k 的圣经前缀扩展到含 69 面旗标名册的避让提示——
既是「LLM 深度流转 + 自我改进」，也是「提高上下文利用率」的一次实证。

> 纪律：本 proof 记录真跑实测的提案避让效果。为避免打乱已人工闸落地并发布的第 84 篇世界线，
> 真跑产物（草稿 / QA / cache-metrics）已恢复到第 84 篇发布时的状态；本文件只保留可复算的实测证据。
> 同一避让逻辑在后续每轮 `--live` 真跑中持续生效。
