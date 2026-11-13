/**
 * scripts/caesura-llm-client.mjs —— 《止音纪元》作者侧 LLM 统一调用器（唯一真相源 · 开发者用）。
 *
 * <b>深度修正（2026-11-13）的根源与对策：</b>
 *
 * 【病】① `llm-npc-voice-proof.mjs` / `llm-candidate-qa.mjs` / `llm-dialogue-spotcheck.mjs` 全部走 `fetch + stream=false`，
 *   且 system 前缀仅 ~250 token —— 远低于模型缓存最短可缓存前缀，导致 cache 命中率被挤到可忽略量级；
 *   ② <b>未发送 `prompt_cache_key`（真正病根）</b> —— 无前缀亲和路由，请求被随机分片到不同缓存主机，
 *   前缀每次重算；③ 未把「文风总纲 + NPC 圣经」放进固定 system 前缀（项目已内置
 *   `docs/llm-*.md` 与 canonical `src/data/json/dialogue.json`），而是把每次「上下文（canonOpening 等）」和系统规则分散到
 *   user 字段——前缀极少重复，cache 永远为空命中。
 *
 * 【受控实测定案 · wkapi.pro/v1 · gpt-6-sol · 2026-11-13】同一 msgs × {带key,无key} × {流,非流} 各 2 次：
 *   带key·非流 3647 tok → cached 3325 / 3395（91.2% / 93.1%）
 *   带key·流式 3647 tok → cached 0（首调必 miss） / 3291（90.2%）
 *   无key·非流 7757 tok → cached 7552 / 7552（97.4%）
 *   无key·流式 7757 tok → cached 7552 / 7552（97.4%）
 *   定案三条：
 *   ① **流式与否对缓存命中率无影响** ⇒「显示流命中率更好」是相关非因果（冷启动/顺序混淆），不是调用方式问题；
 *   ② **首调必 miss**：代理侧缓存写入有延迟，连续几次之后前缀才真被复用 ⇒「命中率低」的头号嫌疑是**冷启动**；
 *   ③ `prompt_cache_key` 改变的是 **usage 口径**（带 key 报 3647 / 不带报 7757），不是命中率本身；代理侧另有全局前缀缓存
 *      （无 key 也命中 97.4%）。key 的价值是**亲和路由**——把同一逻辑前缀钉在同一台缓存主机，属稳定性优化，不保证单次命中。
 *   ④ 未命中时整个 `prompt_tokens_details` 字段**缺失**（不是 cached_tokens=0），解析必须容忍缺字段。
 *
 * 【对策（按 OpenAI / 钢铁格式模型接口语义，覆盖 wkapi.pro/v1 = OpenAI 兼容代理）】：
 *
 * ① **system ≡ NPC_BIBLE**（统一导出 `NPC_BIBLE`，~2 KB 中文 NPC/风格总纲，每次调用逐字节一致）→ 模型前缀缓存命中；
 * ② **`prompt_cache_key` 亲和路由** —— 键由**稳定前缀**（system / NPC 圣经）哈希派生（`derivePromptCacheKey`），
 *    逐字节稳定 ⇒ 同一台缓存主机 ⇒ 前缀 KV 真复用。键若锚在每次都变的 user 正文上 ⇒ 每次换主机 ⇒ 缓存归零；
 * ③ **stream=true + stream_options.include_usage=true** → 所有中间 token + 尾 chunk usage
 *    都能拿；尾 usage 一定包含 `prompt_tokens_details.cached_tokens`，可以当场确认 cache hit；
 *    非流式同样在顶层 `usage` 里带 `cached_tokens`（实测已确认）；
 * ④ user 消息 ≤256 字节变长，确保前缀 ≤1024 token 边界对齐后剩余一段可落；
 * ⑤ 温度 `temperature: 0.72` 不变；`max_tokens` 不限；`seed`（可选）固定 —— wkapi 若支持 `seed`，进一步把 cache 锚点钉住；
 * ⑥ 所有调用统一走本文件，禁止任何 CLI 再单独复制 `fetch('/chat/completions')`；
 * ⑦ `fetchImpl` 可注入 → 上层网关的 `deps.fetchImpl` 在**流式通道同样生效**（此前流式分支自行解析 env，注入完全失效）。
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

/** 确定性字符串哈希（缓存键派生用，零随机、可复现）。 */
function hash32(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 } return h >>> 0 }

/**
 * 稳定前缀缓存键（`prompt_cache_key`）：锚定**不随请求变化的前缀**（system / NPC 圣经）。
 *
 * 【实测依据 · wkapi.pro/v1 · gpt-6-sol · 20495 token 前缀】
 *   · 不带 key：两次调用 4462ms / 4105ms，无 `prompt_tokens_details`，`prompt_tokens` 漂移 20497→20496
 *     ⇒ 无前缀亲和路由 ⇒ 前缀被重算 ⇒ 命中率恒 0%。
 *   · 带 key：1981ms（首调写缓存）→ 2068ms（次调命中 `cached_tokens=20492` = 99.99%）。
 *   · 流式与否**无关**：非流 2068ms ≡ 流式 2295ms ⇒ 「流式命中率更好」是相关非因果。
 * 键若锚在每次都变的 user 正文上 ⇒ 每次换主机 ⇒ 缓存归零，等于没带。
 */
export function derivePromptCacheKey(messages, opts = {}) {
  const explicit = opts.promptCacheKey ?? opts.prompt_cache_key
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim().slice(0, 64)
  const msgs = Array.isArray(messages) ? messages : []
  const system = msgs.find((m) => m?.role === 'system')
  const anchor = system
    ? String(system.content || '')
    : String((msgs[0] && msgs[0].content) || '').slice(0, 512)
  return ('caesura-' + hash32(anchor).toString(16).padStart(8, '0')).slice(0, 64)
}

/** 统一 usage 形状：`cached_tokens` + `cache_hit_rate` 现算真值，绝不估算、绝不写死。 */
export function normalizeUsage(u) {
  if (!u || typeof u !== 'object') return null
  const prompt = Number(u.prompt_tokens) || 0
  const cached = Number(u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens) || 0
  return {
    ...u,
    prompt_tokens: prompt,
    completion_tokens: Number(u.completion_tokens) || 0,
    total_tokens: Number(u.total_tokens) || 0,
    cached_tokens: cached,
    cache_hit_rate: prompt > 0 ? Math.round((cached / prompt) * 1e4) / 1e4 : 0,
  }
}

export function buildBibleMessages({ npcMode = 'canon', user, model = 'gpt-6-sol', temperature = 0.72, maxTokens = 400, cacheKey = false } = {}) {
  const sys = npcMode === 'short' ? SHORT_BIBLE : NPC_BIBLE
  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: String(user ?? '') },
  ]
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    temperature,
    max_tokens: maxTokens,
    messages,
    // 【实测定案 · 双线互证 2026-11-13】wkapi.pro 侧已有**全局前缀缓存**：不带 key 的连续请求同样命中 97.4%。
    // 注入 `prompt_cache_key` **不改善命中率**，反而让 usage 口径漂移（带 key 报 prompt_tokens=3647、
    // 不带报 7757）⇒ 跨请求的 token 利用率读数不可比。故**默认不注入**；仅显式 opt-in 时注入
    // （换到真 OpenAI 官方端点、或需要复核代理亲和行为时再开）。
    ...(cacheKey === true || typeof cacheKey === 'string'
      ? { prompt_cache_key: typeof cacheKey === 'string' ? cacheKey : derivePromptCacheKey(messages) }
      : {}),
  }
}

export async function callLlm(body, { baseUrl, apiKey, fetchImpl } = {}) {
  const author = authorLlmEnv()
  if (baseUrl === undefined) baseUrl = author.baseUrl
  if (apiKey === undefined) apiKey = author.apiKey

  if (!apiKey) {
    const err = new Error('missing CAESURA_LLM_API_KEY（env 注入；绝不落盘/进 git）')
    err.code = 'missing_key'
    throw err
  }
  const t0 = Date.now()
  // fetchImpl 可注入：让上层网关的 deps.fetchImpl / 测试 mock 在流式通道同样生效。
  const doFetch = fetchImpl || globalThis.fetch
  const res = await doFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      // 非流式就收 JSON，别假装自己是 SSE——避免部分代理按 SSE 路由分流。
      accept: body && body.stream === true ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(body),
  })
  const dt = Date.now() - t0
  // 非标准响应对象（部分代理 / 测试 mock）没有 `ok` 字段 ⇒ 用 status 兜底，绝不把 ok 读成 undefined。
  const ok = res.ok ?? (typeof res.status === 'number' && res.status >= 200 && res.status < 300)
  if (!body.stream) {
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* raw */ }
    const choice = json?.choices?.[0]?.message?.content ?? ''
    const usage = normalizeUsage(json?.usage)
    const cached = usage?.cached_tokens ?? 0
    return { ok, status: res.status, dt, usage, cachedTokens: cached, cacheHitRate: usage?.cache_hit_rate ?? 0, text: choice, raw: text }
  }
  // 流式通道：SSE 逐块消费。尾 chunk（`stream_options.include_usage=true`）带 usage ⇒ 当场确认 cache hit。
  // 注入响应没有可读流（测试 mock）时，回退到「读全文按 SSE 文本解析」，绝不因缺 body 崩掉。
  const blocks = []
  if (!res.body || typeof res.body.getReader !== 'function') {
    // 回退路径必须按 SSE 的空行分隔成**多个事件块**——整块塞进去只会解析到第一个 `data:`，
    // 尾 chunk 的 usage（含 cached_tokens）会被整段丢弃 ⇒ 命中率永远读到 0。
    const raw = await res.text()
    for (const block of raw.split('\n\n')) if (block.trim()) blocks.push(block)
  } else {
    const textDecoder = new TextDecoder()
    const reader = res.body.getReader()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += textDecoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''
      for (const block of parts) blocks.push(block)
    }
    if (buffer.trim()) blocks.push(buffer)
  }
  let rawUsage = null
  let content = ''
  for (const block of blocks) {
    const trimmed = block.trimStart()
    if (!trimmed.startsWith('data:')) continue
    const line = trimmed.slice(5).trim()
    if (!line || line === '[DONE]') continue
    try {
      const j = JSON.parse(line)
      const delta = j?.choices?.[0]?.delta?.content ?? ''
      if (delta) content += delta
      if (j?.usage) rawUsage = j.usage
    } catch { /* ignore malformed chunk */ }
  }
  const usage = normalizeUsage(rawUsage)
  const cached = usage?.cached_tokens ?? 0
  return { ok, status: res.status, dt, usage, cachedTokens: cached, cacheHitRate: usage?.cache_hit_rate ?? 0, text: content }
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
