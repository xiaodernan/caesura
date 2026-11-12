# LLM 对白声线审稿（`npm run llm:qa`）

一站式 *只编辑建议、不改写任何文件* 的对白现场审稿工具。**它不调玩家机器**——开发者本机跑；
读 `src/data/json/dialogue.json` 全部节点（~80 条），交给真 LLM
（默认端点 `https://wkapi.pro/v1`，模型 `gpt-6-sol`，由
`.env` 之外临时 `CAESURA_LLM_API_KEY` 注入）判决是否符合 **CAESURA 文风总纲**：

> 克制的、声学隐喻的诗意。台词禁止翻译腔（"哦，朋友""我以……起誓""听着，伙计"）。人物说话像敲钟——余音比敲击重要。

## 与 `llm:proof` 的分工

- `llm:proof`：**给作者看 LLM 会怎么写 NPC**（新的可选台词）。
- `llm:qa`：**给作者看 LLM 怎么评你写完的台词**（critique）。

两者都是**作者侧 / 编辑侧**工具，均非运行时、玩家进程绝不联网、绝不产生任何
玩家侧 token/密钥托管；均不写进 `status()`，**不声称**"你的 NPC 真心好或不好"，只给建议。

## 判词（必须可追踪）

- `pass` — 符合本文风、保留。
- `flag` — 需要作者手工判断是否改写。LLM 给出子串+原因；作者仍可以手动保留。
- `skip` — 信息密度/语气/非 NPC 内容（如纯动作 / 纯环境描述）， LLM 不判。

**本机跑过一次 2026-11-12**，样本：DLG_BELLTONGUE 17 / DLG_MEG 12 / DLG_CORVIN 15 / DLG_FACELESS 17 / DLG_HALTRUNE 15 / DLG_TABLET 1 / DLG_HERSIL_PREBOSS 4 共 81 节点；结论 pass 45 / skip 33 / flag 3。

## 2026-11-12 审稿结论（作者裁决）

1. `DLG_MEG:n8` — LLM 判"finale 过白"，作者判**保留**。这是 Act 2 hub 收尾的情感落点，差不多了才看得见全体员工（所有宴席/铃断/她等了三个秋天）；n8 本身已经比那时冷——"声卷全了。"就是结束。
2. `DLG_CORVIN:n9` — LLM 判"啰嗦解释背景"，作者判**保留**。这是 Corvin 唯一一次几乎不装矜持地把二十代律政院的罪事说出口；删掉信息层等于删掉他的偿罪弧线。
3. `DLG_CORVIN:n2` — LLM 判"别把背对着我说你→有翻译腔"，作者**改**：`别把背对着我说话` → `别背对着我说话`。

**第三项已落实于本提交**（`DLG_CORVIN:n2` 字面量 `别把背对着我说话` → `别背对着我说话`，可在 commit history 里直接 `git show` 到）。

## 诚实边界

- LLM 判 LLM 类输出存在自我偏好口径；本工具的 flag **不是 "这句不好"**，是"这值得作者再看一眼"。
  需求层面严禁把审稿结果当作写 COMPLEX 级对白的唯一准则。
- 工具不写回 dialogue.json；必须人工 review PR 决定怎么改。
- 即便 flag 是对的，**作者也可以保留**——文风总纲是可执行的判断准绳，但是不是绝对规则、看那阵的 §3.3 示例对话 A/B 的作者到底干什么。
- 不声称本工具的覆盖率：N 个对白里 flag 率不刻意降低也不刻意提升——rubric 未必囊括文化变量；
  LLM 不会知道每句台词预算是多少敲击余音；它也不知道文手约定：环境 SFX 一次渲染 vs 角色解读逐句对白。

## 用法

```powershell
$env:CAESURA_LLM_API_KEY = 'sk-…'                # 你的密钥，切勿放入任何 .env 进仓
npm run llm:qa                                  # 全量
node scripts/llm-dialogue-qa.mjs --npc DLG_MEG   # 单段
node scripts/llm-dialogue-qa.mjs --json          # JSONL（默认就是）
```

退出码：`0` 审稿完成（含 pass/skip/flag 混合，不因 flag 率"高"退出非零）；
`2` 密钥缺失 / 端点不可用 / 401/429/500 / 网络错误 —— 此时没有任何审稿结果可信。
