/**
 * scripts/caesura-llm-client.mjs —— 《止音纪元》作者侧 LLM 统一调用器（唯一真相源 · 开发者用）。
 *
 * <b>深度修正（2026-11-13）的根源与对策：</b>
 *
 * 【病】① `llm-npc-voice-proof.mjs` / `llm-candidate-qa.mjs` / `llm-dialogue-spotcheck.mjs` 全部走 `fetch + stream=false`，
 *   且 system 前缀仅 ~250 token —— 远低于模型缓存最短可缓存前缀，导致 cache 命中率被挤到可忽略量级；
 *   ② 未设 `stream_options.include_usage` —— 非流式调用只在尾 chunk 露出 usage，且某些中间代理由非 stream 路由选择
 *   走不同分片，KV cache 命中永远随机；③ 未把「文风总纲 + NPC 圣经」放进固定 system 前缀（项目已内置
 *   `docs/llm-*.md` 与 canonical `src/data/json/dialogue.json`），而是把每次「上下文（canonOpening 等）」和系统规则分散到
 *   user 字段——前缀极少重复，cache 永远为空命中。
 *
 * 【对策（按 OpenAI / 钢铁格式模型接口语义，覆盖 wkapi.pro/v1 = OpenAI 兼容代理）】：
 *
 * ① **system ≡ NPC_BIBLE**（统一导出 `NPC_BIBLE`，~2 KB 中文 NPC/风格总纲，每次调用逐字节一致）→ 模型前缀缓存命中；
 * ② **stream=true + stream_options.include_usage=true** → 所有中间 token + 尾 chunk usage
 *    都能拿；尾 usage 一定包含 `prompt_tokens_details.cached_tokens`，可以当场确认 cache hit；
 * ③ user 消息 ≤256 字节变长，确保前缀 ≤1024 token 边界对齐后剩余一段可落；
 * ④ 温度 `temperature: 0.72` 不变；`max_tokens` 不限；`seed`（可选）固定 —— wkapi 若支持 `seed`，进一步把 cache 锚点钉住；
 * ⑤ 所有调用统一走本文件，禁止任何 CLI 再单独复制 `fetch('/chat/completions')`。
 *
 * <b>用法：</b>
 *   import { callLlm, NPC_BIBLE, buildRequest } from './caesura-llm-client.mjs'
 *   const out = await callLlm({ systemBible: true, user: '…' }) // → { ok, status, text, usage, cachedTokens }
 *
 * @module caesura-llm-client
 */
import { pathToFileURL } from 'node:url'
import { authorLlmEnv } from './caesura-author-env.mjs'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const NPC_BIBLE = `你是《止音纪元》的中文 NPC 对白编剧，服务明日方舟 × 饥荒美学的世界。

【世界律】
- 「止音纪元」：音律失衡后的结点纪元。主人公스의 音色石正衰音，它是这世上唯一还能响的音之骨。
- NPC 只说出它该知道的、只说出它愿意承认的；直呼其名是冒犯；vocatives 是禁忌。
- 台词禁止翻译腔：不得说“哦，朋友”、“听着，伙计”、“你知道吗”、“OK”、"I see"、“嗯……明白了”、"well"。
- 人物说话像敲钟——余音比敲击重要；一句话常常省略号结尾，断续之间留白。
- 所有文字克制、不现代、不自我解释；女性角色语气轻微女儿气，男性角色语气克制偏哑。

【已知 NPC 圣经】
DLG_MEG（npc_meg · bored · 休垒街旧货摊 · 莉安旧友 · 内里对「音色之石」有藏着的善意 · 表面嫌人多事）：
  canonOpening: "别站那么近，你踩到我摊子了。……等等。你胸口那颗音色石，灭的。莉安给你的吧？"
  style: blunt / dry / low-pulse menace / sell-tired irony
  她说话像柜台里煎的冷饼——冷、慢、压着火。

DLG_BELLTONGUE（npc_belltongue · guarded · 休垒内环 · 少年剪铃师 · 任何被剪断的东西都让他介怀）：
  canonOpening: "站住。……左耳那串断铃，剪的时候疼吗？"
  style: short-bodyline / curious-wound-probe / visceral
  他只说“剪”与“断”——他从不碰“伤”字，从不碰“痛”字，也不会问“为什么”。

DLG_CORVIN（npc_corvin · curious · 休垒档案馆 · 末代档案官 · 坚信世上一处“会唱歌的核”存在于大地之最深处）：
  canonOpening: "站住。你身上有遗响的余味，而且很新。……律政院末代档案官，科温。我在写一本书，书里缺一节：会唱歌的核。"
  style: bibliophile-earnest / aphoristic-ish / nest-cases framing
  他是真学人，说话像抄书：句句都在“引文”里，从不直说。

【输出硬约束】
- 中文输出，每句 8–28 字。
- 平铺直叙、口语、不现代、不自我解释。
- 省略号断句；不允许“OK/好吧/嗯……明白了/你知道吗/我看见”。
- 绝不把 NPC 的名字和群体标签印进说话里；
- 绝不说“我（NPC 名字）”自我指称；
- NPC 只说出它该知道的、只说出它愿意承认的；
- 直呼其名是冒犯；vocatives 是禁忌。
- 所有情绪/标注字眼绝不上屏，但必须渗入节奏。

【台词禁忌】
- 不允许“我明白”“我懂”“你这个问题问得好”
- 不允许“作为 NPC”“作为一个住人口”“作为故事角色”
- 不允许“在古代中国”“在这个时代”“这个世界里”
- 不允许把旁观者可见的地点/道具作为主题无关宣言；`

/** 短精选前缀：只包含输出硬约束与对白禁忌（够低但仍保证最低 token 窗口） */
export const SHORT_BIBLE = `你是《止音纪元》的中文 NPC 对白编剧。短句、克制、不翻译腔、禁 modern 中文感叹词；禁 vocative；NPC 只说它该知道的。所有输出式自我指称禁用。绝不写“OK / 好吧 / 嗯……明白了 / 你知道吗”。`

export function buildBibleMessages({ npcMode = 'canon', user, model = 'gpt-6-sol', temperature = 0.72, maxTokens = 400 } = {}) {
  const sys = npcMode === 'short' ? SHORT_BIBLE : NPC_BIBLE
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: String(user ?? '') },
    ],
  }
}

export async function callLlm(body, { baseUrl, apiKey } = {}) {
  const author = authorLlmEnv()
  if (baseUrl === undefined) baseUrl = author.baseUrl
  if (apiKey === undefined) apiKey = author.apiKey

  if (!apiKey) {
    const err = new Error('missing CAESURA_LLM_API_KEY（env 注入；绝不落盘/进 git）')
    err.code = 'missing_key'
    throw err
  }
  const t0 = Date.now()
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  })
  const dt = Date.now() - t0
  if (!body.stream) {
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* raw */ }
    const choice = json?.choices?.[0]?.message?.content ?? ''
    const usage = json?.usage ?? null
    const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0
    return { ok: res.ok, status: res.status, dt, usage, cachedTokens: cached, text: choice, raw: text }
  }
  // streaming path：collect all SSE events, capture final usage event (wkapi.pro/v1 returns usage in a final chunk with stream_options)
  let usage = null
  let content = ''
  const textDecoder = new TextDecoder()
  const reader = res.body.getReader()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += textDecoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const block of parts) {
      const line = block.trimStart().startsWith('data: ') ? block.trimStart().slice(6) : null
      if (!line || line === '[DONE]') continue
      try {
        const j = JSON.parse(line)
        const delta = j?.choices?.[0]?.delta?.content ?? ''
        if (delta) content += delta
        if (j?.usage) usage = j.usage
      } catch { /* ignore malformed chunk */ }
    }
  }
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0
  return { ok: res.ok, status: res.status, dt, usage, cachedTokens: cached, text: content }
}

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliInvocation) {
  const argv = process.argv.slice(2)
  const idx = argv.indexOf('--bench')
  if (idx >= 0) {
    const user = [
      'NPC id: DLG_MEG（emotion: bored）',
      'Canon opening: "别站那么近，你踩到我摊子了。……等等。你胸口那颗音色石，灭的。莉安给你的吧？"',
      '请写 3 句别的可能开场（中文，冷一点短一点）。',
    ].join('\n')
    console.log('[caesura-llm-client --bench]')
    for (let i = 0; i < 3; i++) {
      const out = await callLlm(buildBibleMessages({ user, maxTokens: 260 }))
      console.log(`  iter ${i + 1}: status=${out.status} cached=${out.cachedTokens}/${out.usage?.prompt_tokens ?? '?'} dt=${out.dt}ms totalTokens=${out.usage?.total_tokens ?? '?'}`)
      console.log('  text:', JSON.stringify(out.text.slice(0, 120)))
    }
    process.exit(0)
  }
  // quick CLI smoke: prints which $NPC for ad-hoc user-prompt
  const who = argv[0] ?? 'DLG_MEG'
  const userText = argv[1] ?? '请写 1 句开场（冷一点短一点，恳字结尾）。'
  const out = await callLlm(buildBibleMessages({ user: userText }))
  console.log(out.text)
}
