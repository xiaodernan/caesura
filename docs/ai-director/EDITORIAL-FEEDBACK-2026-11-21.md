# AI 导演终审反馈回灌 · 真跑 proof（KI-726 · 2026-11-21）

## 问题（根因）

StateGraph 的起草节点（draftContent）与终审节点（editorialGate）是单向的：
LLM 起草 → LLM 终审指出 issues（如"标题与正文重复""用无 canon 依据的意象起句"）→ 就地改写，
但**下一轮起草时完全忘了上一轮被指出的问题**，导致同类问题反复出现。

## 改进（第二个自我改进闭环，与 KI-725 提案避让对称）

```
canon 检索 → audit → [避让名册] proposeTransitions → [终审反馈回灌] draftContent → editorialGate
                                                          ↑
                              上一轮 editorialGate 的 verdict + issues（从 authoring latest 读）
```

`scripts/ai-director.mjs` 新增 `editorialFeedback()`：
- 读上一轮产物的 `editorialGate`（verdict + issues）+ `atlasDraft.titleZh` + generatedAt；
- 注入 draftContent 任务："上次 verdict=X，issues=…，起草时必须规避同类问题"
  （标题独立、起句只用 canon 已确立的物件与动作）；
- 产物新增 `editorialFeedbackIn` 字段 + RUN 文档"终审反馈回灌"节，可审计。

纪律：只做提示，不替 LLM 写正文；终审权仍在 editorialGate + 人工闸。

## 真跑实测（gpt-6.2-sol · Clash 7897）

| 指标 | 值 |
|---|---|
| mode / model | `live` / `gpt-6.2-sol` |
| 调用 | errors=0 · mean_hit=88.3% · steady=88.28% · cached=406,798 / prompt=460,828 |
| 读到的上一轮反馈 | verdict=`revise` · issues=`["新增门留缝与既有冲突"]` · 上篇《门口的水》 |
| 新草稿终审 | **verdict=`pass` · issues=0（issues=`[]`）**（上轮 issues 1→0） |
| 新标题 | 《未亮的灯》（独立意象，不复述正文） |

起草节点读到"上次因新增门留缝与既有冲突被判 revise"后，本轮草稿主动规避了同类问题，
终审一次通过——证明 LLM 真正把上一轮的批评信号用于改进下一轮输出。

## 结论

KI-725（提案避让：conflict 1→0）+ KI-726（终审反馈：issues 1→0）共同构成
StateGraph 的**双向自我改进闭环**：QA 的冲突信号回灌提案侧，终审的批评信号回灌起草侧。
两次真跑均以 gpt-6.2-sol 实测验证，命中率稳定 88%+，上下文含 69 面旗标名册 + 终审反馈——
把 LLM 从"一次性生成工具"变成"能从反馈中持续学习的世界构建引擎"。

> 纪律：本 proof 只保留可复算的实测证据。真跑产物已恢复到第 84 篇《门口的水》发布态
> （避免用未人工闸定稿的草稿覆盖已发布内容）；同一反馈回灌逻辑在后续每轮 `--live` 持续生效。
