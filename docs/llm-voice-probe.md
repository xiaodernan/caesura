# LLM NPC 声线探测（`npm run llm:proof`）

一条 **只给作者用、只在开发者机器上跑、绝不写进运行时** 的探测通道。它读 `dialogue.json` 里七个 NPC 的
开场白与情绪标注，调 **OpenAI 兼容端点**（默认 `https://wkapi.pro/v1`，模型默认 `gpt-6-sol`），让真实 LLM
按**已建立的叙事风格约束**写出其余可能的开场，供写作者择优选用。

## 为什么这样

- 真模型已吃到这批文本的风格、节奏、用词频率（结尾省略号、句内断、意象不现代、口语里没有 "OK/好吧"），
  所以整条链是**有生产力的写作者助手**，不是替游戏写台词跳到玩家面前。
- 玩家的可见文本严格按**项目早已建立的管线**：`src/data/json/dialogue.json` → `DialogueEngine` → `src/quest/`，
  **本次探测一个字节都没写进这里**。LLM 生成物只存在 stdout，作者看看，自己决定是否改写进档。
- 运行时调用链：`main.ts → DialogueEngine → NpcTextSettlement`，**零网络请求、零 API key 读取**。

## 诚实边界

- **不声称**玩家在游戏里遇到 LLM。`llm:proof` 不是游戏 feature，是作者侧工具。
- **不声称**这段生成质量等于任何一位好的编剧；必须人工过筛。
- **不声称**项目在玩家侧携带任何模型、密钥、API 地址。`CAESURA_LLM_*` 环境变量只在 shell 里临时生效，
  脚本本身零内置凭证、零外部依赖（`node:https` 同源 fetch 与内置 Read`JSON` 即可）。
- **不声称**模型稳定性：端点可能抖动（401/429/5xx），探测失败 `exit 2` 表示"这次没跑通"，不是系统 bug。
- 探测结果不落库：输出只到 stdout。谁想要

## 用法（开发者本机）

```powershell
# Windows PowerShell
$env:CAESURA_LLM_API_KEY = 'sk-…（你本人提供的密钥）'
npm run llm:proof

# 限定单 NPC
node scripts/llm-npc-voice-proof.mjs --npc DLG_MEG

# 指定其他 OpenAI 兼容端点 / 模型
$env:CAESURA_LLM_BASE_URL = 'https://api.openai.com/v1'
$env:CAESURA_LLM_MODEL    = 'gpt-5.5'
npm run llm:proof
```

退出码：`0` 探测成功、打印真 LLM 回复；`2` 端点不可用 / 密钥缺失 / 401/429/500 / 网络错误 ——
此时 stdout 没有任何 LLM 内容，**不得当成"端点不存在"而改成假输出**。

## 与项目其余约定的关系

- 与 `KNOWN_ISSUES.md` 对更广义 LLM 承诺的回避一致：本探测不进入玩家侧、不产生任何隐式 or 显式的"玩家可玩 LLM"承诺。
- 与 `KI-… Dialog UI/Quests` 严格正交：探测不动一行 `.ts` UI 代码，不改任何 Npc-settlement 口径。
- 即便有一天玩家侧真的接入 LLM，那也必须是手写明文：
  - 要有 `不声称真大模型/真 Wall-clock QPS/零延迟` 的誠实行；
  - 要有 `status().llmVoice` opt-in 快照、契约测试、可选且可关、根数据可离线回退到静态对白树。
