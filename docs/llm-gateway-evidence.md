# KI-538 真大模型协同网关 · 真实跑通证据

> 本文件记录**用用户提供的真实 API 真实跑通**的可复核证据。所有 `usage` / 延迟 / 回复文本均为真实端点返回，
> 未改写、未伪造。API key 只经环境变量 `CAESURA_LLM_API_KEY` 临时传入，**从未写入任何文件、从未进 git**。

## 1. 端点与模型（真实探测）

- Base：`https://wkapi.pro/v1`（**必须带 `/v1`**，`normalizeBaseUrl` 强制补齐）
- 真连模型：`gpt-6-sol`（`/v1/models` 实测返回 200，另有 `gpt-6-astra` / `gpt-5.6-sol` / `gpt-5.6-terra`）
- 协议：OpenAI 兼容 `POST {base}/chat/completions`，`Authorization: Bearer <env key>`
- 真实响应字段：`choices[0].message.content` / `choices[0].finish_reason` / `usage.{prompt_tokens,completion_tokens,total_tokens}` /
  `usage.prompt_tokens_details.cached_tokens`（端点自带 prompt 缓存，实测 cached_tokens 常 >0）

## 2. 「接入项目测试」——离线可证伪门禁（不联网、不需 key）

`npm run llm-gateway:bench` 默认 offline；`tests/unit/caesura-llm-gateway.test.ts` 共 **16 腿**全绿，全部用 mock fetch：
- **三策略三向量零查表**：`OfflineDouble=011`（可复现/零耗/不联网）、`LiveGrounded=100`（真落地/不可复现/计费）、
  `CachedLive=110`（真连首调落地 + 进程内 prompt 缓存命中逐字节复现，但首调那次真实计费抹不掉 ⇒ 非零耗），
  真连态三向量互异、无一 111、不封赢家
- **缓存合理运用**：`createPromptCache` 命中逐字节同一 content、`cached=true`、零新增 token，miss 返回 null，
  `sizeCap` 生效；`CachedLive` 座首调真发一次、命中不再发 fetch（可证伪）
- **五因果锁**：`offline 恒零耗` / `offline 恒可复现` / `badJson 恒不 grounded` / `缓存命中恒逐字节复现` /
  `firstCallCostCausallyUnerasable`（穷举 1/4/16/64 次命中，链路总 token 恒 ≥ 首调 137 ⇒ 缓存买得到复现、买不到免费）
- **诚实 grounded**：无 key 时 `LiveGrounded` 与 `CachedLive` 都 `000`、区分度如实塌缩（同 KI-535/533 rigged 先例），**绝不冒充真连**
- 安全铁律：offline 零网络请求；live 无 key 早退 `missing_key` 且不触碰 fetch；key 只从 env 读
- 三路 tamper 真喂回：`missing_key` / `non_200` / `bad_json` 各自真触发，`falsifiable` 真推导
- 网络异常 `fetch` 抛错 ⇒ `ok:false error=network`，**绝不假造回复**
- 批量正确性：`invokeBatch` 对 N 个 prompt 发 N 条独立请求（修正「多人拼一条只回最后一人」）
- 固定时钟双跑字节一致；十一真件 21 键交叉印证

## 3. 真实跑通证据（真 key · gpt-6-sol）

### 3.1 单条真连（`caesura-llm-gateway.mjs` study, mode=live）

```
trilemma = { liveGrounded: true, reproducible: false, zeroCost: false }   // mode=live → LiveGrounded 座
vectors  = { OfflineDouble: '011', LiveGrounded: '100', CachedLive: '110' }   // 三向量互异、无 111
exams.CachedLive = { liveGrounded: true, reproducible: true, zeroCost: false, cacheHit: true }
trueReply = { ok: true, status: 200, model: 'gpt-6-sol', contentLen: 207,
              totalTokens: 4547, finishReason: 'stop', latencyMs: 3840 }
soundness = { holds: true, baselineHolds: true, falsifiable: true }
tamper    = { missingKey: false, badEndpoint: false, badJson: false }   // 三路真翻 false
causalLocks = { firstCallCostCausallyUnerasable: true, cachedHitReproducibleCausallyUnerasable: true, allHold: true }
```

### 3.2 批量逐 NPC 独立真连（`invokeBatch`，3/3 成功）

对 3 位 NPC **各发一条独立请求**（不再拼进一条对话）：

| NPC id | status | total_tokens | finish_reason | 真实回复（未改写） |
|---|---|---|---|---|
| `DLG_MEG`（梅格，bored） | 200 | 338 | stop | 挑就快点，别把灰扬得到处都是。 / 别碰那些旧玩意儿，坏了我可不赔。 |
| `DLG_BELLTONGUE`（钟舌，guarded） | 200 | 4269 | stop | 别动。……你也听见它最后一声了吗？ / 站近些。让我看看——是谁把它剪断的？ |
| `DLG_CORVIN`（科温，curious） | 200 | 4499 | stop | 别动。让我听听，你把什么声音带来了。 / 末代档案官不信巧合。遗响为何跟着你？ |

### 3.3 真连失败诚实归零复核（本轮 · 真实端点 401）

本轮用**真实 `wkapi.pro/v1` 端点**配合一枚对该端点无权的环境变量做真连（真实网络往返、非 mock）：

```
status=401 latencyMs=486 error=non_200
vectors  = { OfflineDouble: '011', LiveGrounded: '000', CachedLive: '000' }   // 两真连策略诚实归零
cachedLive = { grounded: false, reproducible: false, zeroCost: false, cacheHit: false }
进程 exit=2，并显式打印「真连失败：status=401 · 已诚实归零、绝不冒充 grounded」
```

这一路证明网关对**真实端点的失败面**同样诚实：`usage=null` 不被误读成 `zeroCost=true`，401 不冒充 grounded，
不硬造 111 撑区分度。成功面的真实读数见 3.1 / 3.2（上一阶段同一端点 `gpt-6-sol` 真连实测）。

### 3.4 作者侧 `llm:proof` 探针（既有工具，真连复核）

- 单 NPC（`--npc DLG_BELLTONGUE`）：HTTP 200 / 3748ms / usage 4889 tokens，返回 3 句候选开场
- 全量原探针实测暴露缺陷：把 3 个 NPC 塞进同一条对话，模型只回答最后一个（科温）——
  这正是 KI-538 网关 `invokeBatch` 用**逐条独立请求**修正的真问题（见 3.2 的 3/3 独立回复）

## 4. 「测试改善项目」——真实内容如何进入项目

真 LLM 候选开场白落进 `src/data/authoring/llm-voice-candidates.json`，作为**作者侧候选池**：
- **不进玩家运行时**：玩家可见文本仍严格走 `src/data/json/dialogue.json → DialogueEngine → src/quest/`，
  本网关与候选池对 `dialogue.json` 的写入 = **0 行**（LLM 输出从未写进玩家数据）；
  （工作树里 `dialogue.json` 的唯一 1 行改动是并轨线把科温一句病句「建议你别把背对着我说话」修成
  「劝你别背对着我说话」，与本网关、与 LLM 生成无关，属人工对白校对）
- 每条候选带 `via: "gpt-6-sol"` / `status` / `total_tokens` / 生成时间口径，供写作者人工择优
- 是否、何时把某句改写进档，由人明文决定——网关与候选池都不产生隐式「玩家可玩 LLM」承诺

## 5. 诚实边界（不声称）

- **不声称**玩家在游戏里遇到 LLM / 零延迟 / 永久可用；端点抖动（401/429/5xx/网络）如实失败
- **不声称**生成质量等于好编剧；候选必须人工过筛
- **不声称**项目在玩家侧携带任何模型/密钥/API 地址；`CAESURA_LLM_*` 只在 shell 临时生效，脚本零内置凭证
- **不声称**离线 double 是真模型输出；它明确标记 `via=offline-double`、零 token、可复现
- key 不落库、不进 git、不进快照/前端；真连证据只记模型名与 usage 读数，不含凭证

## 6. 复现方式（开发者本机）

```powershell
$env:CAESURA_LLM_API_KEY = 'sk-…（你本人提供的密钥）'
npm run llm-gateway:bench -- --live          # 真连 study（需 key，三向量 011/100/110）
node scripts/caesura-llm-gateway.mjs          # 默认 offline，不联网、不需 key（三向量 011/000/000）
npx vitest run tests/unit/caesura-llm-gateway.test.ts --no-cache   # 16 腿离线门禁
```

> 注：仓库内 `.env`（gitignore 保护）用的键名是 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`；
> 网关只认 `CAESURA_LLM_API_KEY` / `WKAPI_KEY`。开发者本机真连时按上面显式导出，或在 shell 里把
> `.env` 的值映射到 `CAESURA_LLM_API_KEY`——**绝不改代码去读 `.env` 文件**（那会把凭证读取路径固化进源码）。
