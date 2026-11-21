# AI 导演持续产出流水线 · 真跑 proof（KI-728 · 2026-11-21）

## 问题（根因）

`scripts/ai-director.mjs` 的 `draftContent` 节点把下一篇章号 **hardcode 为 `no:84`**——
无论已落地多少篇，每次 `--live` 都产出 no:84，无法自动推进。这是"不停产出新篇章"的根本障碍。

## 改进（动态篇号 + 双闭环自动运转）

`nextChapterNo()` 从 `atlas-texts.ts` 现读 `no` 序列的最大值 +1：

```
atlas no: 1..84  →  nextChapterNo() = 85  →  draftContent 产出 no:85
```

每落地一篇，下一次 `--live` 自动产出再下一篇——无需手改脚本。
配合 KI-725（提案避让）+ KI-726（终审回灌），三个机制构成完整的自动持续产出流水线：

```
canon 检索 → audit → [避让名册] proposeTransitions → [终审反馈] draftContent → editorialGate
                          ↑                              ↑
                  QA conflict 回灌                 editorialGate issues 回灌
                          └────────── 篇号自动 +1 ──────────┘
```

## 真跑实测（gpt-6.2-sol · Clash 7897）

| 指标 | 值 |
|---|---|
| mode / model | `live` / `gpt-6.2-sol` |
| 调用 | 5 × HTTP 200 · errors=0 |
| 缓存 | cached=507,752 / prompt=575,145 · mean_hit=88.3% · steady=88.13% |
| **动态篇号** | atlas max=84 → **产出 `no:85`** 《碗外 / Outside the Bowl》 ✅ |
| 提案避让（KI-725） | 69 面名册 · 历史 conflict 识别 · **本轮 warnings=[]（零冲突）** ✅ |
| 终审回灌（KI-726） | 读到上轮《门口的水》revise+issues → 本轮起草 issues 已换成新类型（上轮"门留缝冲突"不再出现）✅ |
| 本轮终审 | verdict=revise · issues=2 条（新类型，待人工闸） |

三个机制在同一轮真跑中**同时生效**：自动推进篇号、自动规避冲突、自动继承上轮批评。

## 结论

动态篇号消除了"不停产出新篇章"的人为障碍。现在 `--live` 是一条完整流水线：
自动定位下一篇 → 注入 QA 冲突反馈 → 注入终审批评 → 起草 → 终审 → 人工闸落地。
每落地一篇，流水线自动前进一篇。实测 88.3% 命中率稳定，证明改动未破坏缓存。

> 纪律：本 proof 只保留可复算的实测证据。no:85 草稿未经人工闸定稿，故真跑产物已恢复到第 84 篇发布态；
> 动态篇号与双闭环逻辑在后续每轮 `--live` 持续生效。
