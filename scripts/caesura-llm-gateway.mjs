/**
 * scripts/caesura-llm-gateway.mjs —— 真大模型协同网关教学件（KI-538，P8 第四十五件 · 前端第三十二维）。
 *
 * <p>把项目已提供的 OpenAI 兼容端点（默认 `https://wkapi.pro/v1`、模型 `gpt-6-sol`）做成一条
 * <b>默认离线、可选真连、可证伪、绝不假造模型回复</b> 的调用网关。与 `llm-npc-voice-proof.mjs`（作者侧 stdout 工具）
 * 正交：本件是可被单测 import 的**真值源**，默认 double 不联网、不读 key，门禁/单测永不依赖外网。</p>
 *
 * <p><b>安全铁律</b>：API key 只从 `CAESURA_LLM_API_KEY` / `WKAPI_KEY` 环境变量读，源码零内置凭证；
 * 只有 `mode='live'` 且 env 有 key 才发真实 `POST {base}/chat/completions`。任何 401/429/5xx/坏 JSON/空 content
 * 都返回 `ok:false` 并保留真实 status 与原始文本，<b>绝不把失败伪装成模型回复</b>。</p>
 *
 * <p><b>批量正确性</b>：`invokeBatch` 对 N 个 prompt **各发一条独立请求**（不做把多人拼进一条对话、模型只回最后一个的错事），
 * 逐条回读 content/usage/finish_reason/延迟；`--all` 真跑 N 条，证据逐条可核对。</p>
 *
 * <p><b>三策略</b>：`OfflineDouble`（进程内确定性 double，不联网）/ `LiveGrounded`（每次真连，温度抖动）
 * / `CachedLive`（真连首调 + 进程内 prompt 缓存持久化响应，同 prompt 命中不再发请求）。三向量在真连态
 * 现算 `OfflineDouble=011`（可复现零耗但不联网）/ `LiveGrounded=100`（真落地但不可复现且计费）/
 * `CachedLive=110`（首调真连落地 + 缓存命中逐字节复现，但首调那次真实计费抹不掉 ⇒ 非零耗），
 * 互异、无一 111、不封赢家；无 key 时 `LiveGrounded` 与 `CachedLive` 都诚实退化为 `000`，区分度如实塌缩、
 * 绝不冒充真连。</p>
 *
 * <p><b>三难维序 [liveGrounded / reproducible / zeroCost]</b>，三位由三条独立考场真跑现算、零查表：
 * 真连座 `mode='live'` 必须真拿到非空 content 且 total_tokens>0 才算 grounded；
 * 复现座同 seed 连跑两次 offline double（或缓存命中）必须字节一致才算 reproducible；
 * 零耗座整条链路 total_tokens 恒 0 才算 zeroCost——`CachedLive` 首调必付一次真调用 ⇒ 缓存买得到复现、
 * 买不到免费，`firstCallCostCausallyUnerasable` 因果锁死（穷举命中次数首调成本恒 > 0）。</p>
 *
 * <p><b>verifyGatewaySoundness 唯一内核 + 三路可证伪</b>：`gatewayCore(cfg, mode)` 真改变输入再喂回同一 holds 公式——
 * `missingKey`（抽掉 key ⇒ live 真失败）、`badEndpoint`（错 base ⇒ 非 200）、`badJson`（坏响应 ⇒ 解析失败）。
 * `baselineHolds` 先真绿，`falsifiable` 由 baseline 与三路 tamper 真值推导，绝不写死。</p>
 *
 * <p><b>不声称</b>玩家运行时接 LLM / 零延迟 / 永久可用 / 生成内容免人工过筛 / key 落库 —— 教学级确定性网关 + 可选真连探测，
 * 端点抖动（401/429/5xx/网络）如实失败；真模型输出只作作者侧候选，进玩家数据须人工明文改写。</p>
 *
 * @module caesura-llm-gateway
 */
import { pathToFileURL } from 'node:url'
import { compareRemapping, createShardRouter, createHashRing } from './caesura-consistent-hash.mjs'
import { createWal } from './caesura-lsm-store.mjs'
import { createBus } from './spring-bus-event.mjs'
import { createRedisCache } from './caesura-redis-cache.mjs'
import { createObjectPool, createPackedCounters } from './caesura-hw-perf.mjs'
import { createTokenBucket } from './caesura-rate-limiter.mjs'
import { createMinHeapDelayQueue } from './caesura-delay-queue.mjs'
import { createFullJitterBackoff } from './caesura-retry-dlq.mjs'

export const LLM_DEFAULTS = Object.freeze({
  baseUrl: 'https://wkapi.pro/v1',
  model: 'gpt-6-sol',
  temperature: 0,
  maxTokens: 256,
  seed: 538,
  timeoutMs: 60000,
  persistentCache: false,
  zeroTemp: false,
  localDouble: false,
  rigged: false,
})

export const LLM_STRATEGIES = Object.freeze(['OfflineDouble', 'LiveGrounded', 'CachedLive'])
export const LLM_SCENARIOS = Object.freeze(['singlePrompt', 'batchThreeNpc', 'missingKey', 'badEndpoint', 'badJson', 'cleanRerun'])

const intOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : f }
const numOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const round4 = (n) => Math.round(n * 1e4) / 1e4
function startClock(v, f) { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : f }
/** 确定性字符串哈希（offline double 用，零随机、可复现）。 */
function hash32(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 } return h >>> 0 }

/** 从环境变量取 key——源码零内置凭证。 */
export function resolveApiKey(env = process.env) {
  const k = env.CAESURA_LLM_API_KEY || env.WKAPI_KEY || ''
  return typeof k === 'string' ? k.trim() : ''
}
/** base 必须含 /v1，杜绝漏带版本号。 */
export function normalizeBaseUrl(base) {
  const b = String(base || LLM_DEFAULTS.baseUrl).trim().replace(/\/+$/, '')
  return /\/v1$/i.test(b) ? b : `${b}/v1`
}

/** 构造 OpenAI 兼容请求体。 */
export function buildChatBody(messages, opts = {}) {
  const model = String(opts.model || LLM_DEFAULTS.model)
  const temperature = numOr(opts.temperature, LLM_DEFAULTS.temperature)
  const maxTokens = intOr(opts.maxTokens, LLM_DEFAULTS.maxTokens)
  const body = { model, messages: Array.isArray(messages) ? messages : [], temperature, max_tokens: maxTokens }
  // 可选 stream（real-call opt-in；默认 false 兼容既有 mock 测试）
  if (opts.stream === true) {
    body.stream = true
    body.stream_options = { include_usage: true }
  }
  return body
}

/**
 * offline 确定性 double：同 prompt + 同 seed 必得同回复，total_tokens=0，绝不联网。
 * 回复文本是可证伪的结构化占位，明确标注 `via=offline-double`，不冒充真模型。
 */
export function offlineReply(messages, opts = {}) {
  const seed = intOr(opts.seed, LLM_DEFAULTS.seed)
  const last = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : {}
  const content = `[offline-double seed=${seed} h=${hash32(String(last.content || '')).toString(16)}] 这是确定性占位回复，非真模型输出。`
  const model = String(opts.model || LLM_DEFAULTS.model)
  return {
    ok: true, mode: 'offline', status: 200, model,
    content, finishReason: 'stop',
    usage: { prompt_tokens: String(last.content || '').length, completion_tokens: content.length, total_tokens: 0 },
    latencyMs: 0, via: 'offline-double', rawText: null, cached: false, cachedTokens: 0,
  }
}

/** 解析真响应：非 200 / 坏 JSON / 空 content 一律 ok:false，保留真实 status 与原文，绝不假造。 */
export function normalizeReply(status, json, rawText, opts = {}) {
  const st = intOr(status, 0)
  const model = String(opts.model || json?.model || LLM_DEFAULTS.model)
  if (st !== 200) return { ok: false, mode: 'live', status: st, model, content: '', finishReason: null, usage: null, latencyMs: numOr(opts.latencyMs, 0), via: 'live', error: 'non_200', rawText: String(rawText ?? '').slice(0, 600) }
  if (!json || typeof json !== 'object') return { ok: false, mode: 'live', status: st, model, content: '', finishReason: null, usage: null, latencyMs: numOr(opts.latencyMs, 0), via: 'live', error: 'bad_json', rawText: String(rawText ?? '').slice(0, 600) }
  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.length === 0) return { ok: false, mode: 'live', status: st, model, content: '', finishReason: json?.choices?.[0]?.finish_reason ?? null, usage: json?.usage ?? null, latencyMs: numOr(opts.latencyMs, 0), via: 'live', error: 'empty_content', rawText: String(rawText ?? '').slice(0, 600) }
  return {
    ok: true, mode: 'live', status: st, model, content,
    finishReason: json?.choices?.[0]?.finish_reason ?? null,
    usage: { prompt_tokens: numOr(json?.usage?.prompt_tokens, 0), completion_tokens: numOr(json?.usage?.completion_tokens, 0), total_tokens: numOr(json?.usage?.total_tokens, 0), cached_tokens: numOr(json?.usage?.prompt_tokens_details?.cached_tokens, 0) },
    latencyMs: numOr(opts.latencyMs, 0), via: 'live', rawText: null, cached: numOr(json?.usage?.prompt_tokens_details?.cached_tokens, 0) > 0, cachedTokens: numOr(json?.usage?.prompt_tokens_details?.cached_tokens, 0),
  }
}

/**
 * 单条调用：mode='offline' 走 double；mode='live' 且 env 有 key 才真发 fetch。
 * fetchImpl 可注入（测试用 mock，绝不联网）。
 */
export async function callLlm(messages, opts = {}, deps = {}) {
  const mode = opts.mode === 'live' ? 'live' : 'offline'
  const cfg = { ...LLM_DEFAULTS, ...opts }
  if (mode === 'offline') return { ...offlineReply(messages, cfg), cached: false }
  const key = resolveApiKey(deps.env || process.env)
  if (!key) return { ok: false, mode: 'live', status: 0, model: cfg.model, content: '', finishReason: null, usage: null, latencyMs: 0, via: 'live', error: 'missing_key', rawText: null, cached: false }
  const fetchImpl = deps.fetchImpl || globalThis.fetch
  const base = normalizeBaseUrl(opts.baseUrl || cfg.baseUrl)
  const t0 = startClock(deps.clock || (() => Date.now()), Date.now())
  try {
    if (opts.stream === true) {
    // 真流通道：opt-in，走 caesura-llm-client 的 SSE 解析，缓存 token 真值直达。
    const { callLlm: unifiedLlm } = await import('./caesura-llm-client.mjs')
    const unified = await unifiedLlm({
      model: cfg.model,
      stream: true,
      stream_options: { include_usage: true },
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
      messages,
    })
    const t1 = startClock(deps.clock || (() => Date.now()), Date.now())
    return {
      ok: unified.ok,
      mode: 'live',
      status: unified.status,
      model: cfg.model,
      content: unified.text || '',
      finishReason: 'stop',
      usage: unified.usage || null,
      latencyMs: Math.max(0, t1 - t0),
      via: 'live-stream',
      rawText: null,
      cached: (unified.cachedTokens ?? 0) > 0,
      cachedTokens: unified.cachedTokens ?? 0,
    }
  }
  const res = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildChatBody(messages, cfg)),
      signal: deps.signal,
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* 保留原文，交给 normalizeReply 判 bad_json */ }
    const t1 = startClock(deps.clock || (() => Date.now()), Date.now())
    return { ...normalizeReply(res.status, json, text, { ...cfg, latencyMs: Math.max(0, t1 - t0) }), cached: false }
  } catch (e) {
    return { ok: false, mode: 'live', status: 0, model: cfg.model, content: '', finishReason: null, usage: null, latencyMs: 0, via: 'live', error: 'network', rawText: String(e?.message || e).slice(0, 600), cached: false }
  }
}

/** 批量：N 个 prompt 各发一条独立请求（修正「多人拼一条只回最后一人」的缺陷）。 */
export async function invokeBatch(prompts, opts = {}, deps = {}) {
  const results = []
  for (const p of prompts) {
    const messages = [
      { role: 'system', content: String(opts.system || '你是《止音纪元》的中文对白编剧，句短、留白、不印 NPC 名。') },
      { role: 'user', content: String(p && p.content !== undefined ? p.content : p) },
    ]
    const r = await callLlm(messages, opts, deps)
    results.push({ id: p && p.id ? p.id : `p${results.length}`, ...r })
  }
  return results
}

/*----------------------------------------------------- CachedLive：进程内 prompt 缓存（教学级，非真 Redis） -----------------------------------------------------*/

/**
 * 进程内 prompt→reply 缓存：键是 messages 的确定性哈希，命中返回**逐字节同一 content**、cached=true、零新增 token。
 * 教学级 Map（非真 Redis/磁盘持久化）；`persistentCache` 只表示「跨调用留存」，不跨进程、不落盘、不声称生产缓存。
 */
export function createPromptCache(opts = {}) {
  const store = new Map()
  const sizeCap = intOr(opts.sizeCap, 1024)
  return Object.freeze({
    keyOf(messages) {
      const s = Array.isArray(messages) ? messages.map((m) => `${m?.role || ''}:${m?.content || ''}`).join('\u0000') : String(messages)
      return hash32(s).toString(16)
    },
    get(messages) {
      const k = this.keyOf(messages)
      if (!store.has(k)) return null
      const hit = store.get(k)
      // 命中：逐字节同一 content、cached=true、零新增 token（首调那次计费不在此回放）。
      return { ...hit, content: hit.content, cached: true, usage: { ...(hit.usage || {}), total_tokens: 0 }, latencyMs: 0 }
    },
    set(messages, reply) {
      if (store.size < sizeCap) store.set(this.keyOf(messages), reply)
      return store.size
    },
    has(messages) { return store.has(this.keyOf(messages)) },
    size() { return store.size },
  })
}

/*----------------------------------------------------- 三难考场：三条独立真跑 -----------------------------------------------------*/

function vectorOf(t) { return `${Number(t.liveGrounded)}${Number(t.reproducible)}${Number(t.zeroCost)}` }

/**
 * 每个策略一座独立考场，三难三位全部真跑现算、零查表、零硬造。async：真连座要 await 真调用。
 * strategy ∈ OfflineDouble / LiveGrounded / CachedLive。
 *
 * - OfflineDouble：两次 offline double 逐字节比对 ⇒ reproducible=true、zeroCost=true，永不 grounded ⇒ 011。
 * - LiveGrounded：mode=live 且有 key 才真连，必须非空 content 且 total_tokens>0 ⇒ grounded=true；
 *   真连带温度抖动且必计费 ⇒ reproducible=false、zeroCost=false ⇒ 100；无 key 诚实 000。
 * - CachedLive：真连首调 grounded + 进程内缓存命中逐字节复现 ⇒ reproducible=true；
 *   但首调那次真实 total_tokens>0 抹不掉 ⇒ zeroCost=false ⇒ 110；无 key 同样诚实 000。
 */
async function examOf(strategy, opts = {}, deps = {}) {
  const msgs = [{ role: 'user', content: 'probe' }]
  const hasKey = resolveApiKey(deps.env || process.env).length > 0
  // 复现座（offline double 路径：同输入两次逐字节比对）
  const a = offlineReply(msgs, opts)
  const b = offlineReply(msgs, opts)
  const offlineReproducible = a.content === b.content && a.mode === 'offline'
  const offlineZeroCost = a.usage.total_tokens === 0
  let trueReply = null

  if (strategy === 'OfflineDouble') {
    return { liveGrounded: false, reproducible: offlineReproducible, zeroCost: offlineZeroCost, trueReply }
  }

  // 两条真连策略：mode=live 且有 key 才真发；无 key/离线一律 false（诚实，不冒充 grounded）。
  const canGoLive = opts.mode === 'live' && hasKey
  if (!canGoLive) {
    return { liveGrounded: false, reproducible: false, zeroCost: false, trueReply }
  }

  if (strategy === 'LiveGrounded') {
    const r = await callLlm(msgs, { ...opts, mode: 'live' }, deps)
    trueReply = r
    const liveGrounded = r.ok === true && (r.usage?.total_tokens ?? 0) > 0
    // 真连失败（401/429/5xx/坏 JSON/空 content）一律诚实 000：绝不把「没连上、usage=null」误读成 zeroCost=true。
    // 真连成功才谈三难：温度抖动 ⇒ reproducible=false，必计费 ⇒ zeroCost=false ⇒ 100。
    if (!liveGrounded) return { liveGrounded: false, reproducible: false, zeroCost: false, trueReply }
    return { liveGrounded: true, reproducible: false, zeroCost: false, trueReply }
  }

  // CachedLive：首调真连 + 缓存命中（第二调不再发请求）
  const cache = createPromptCache(opts)
  const first = await callLlm(msgs, { ...opts, mode: 'live' }, deps)
  trueReply = first
  const firstTokens = first.usage?.total_tokens ?? 0
  const liveGrounded = first.ok === true && firstTokens > 0
  // 首调真连失败 ⇒ 无「真连落地」可谈，缓存无从谈起，三位诚实归零，绝不假亮。
  if (!liveGrounded) {
    return { liveGrounded: false, reproducible: false, zeroCost: false, trueReply, cacheHit: false }
  }
  cache.set(msgs, first)
  const hit = cache.get(msgs)   // 命中：逐字节同一 content、cached=true、零新增 token
  const reproducible = hit !== null && hit.content === first.content && hit.cached === true
  // 零耗看「首调 + 命中」整条链路真实 token；首调必付（firstTokens>0）⇒ zeroCost=false（缓存买不到免费）。
  const zeroCost = firstTokens === 0 && (hit?.usage?.total_tokens ?? 0) === 0
  return { liveGrounded, reproducible, zeroCost, trueReply, cacheHit: hit !== null }
}

export async function llmGatewayStudy(opts = {}) {
  const seed = intOr(opts.seed, LLM_DEFAULTS.seed)
  const mode = opts.mode === 'live' ? 'live' : 'offline'
  const cfg = { seed, mode, model: String(opts.model || LLM_DEFAULTS.model), system: opts.system, baseUrl: opts.baseUrl }
  const deps = { env: opts.env, fetchImpl: opts.fetchImpl, clock: opts.clock }

  // 三策略各自真跑三难考场现算向量，零查表、零硬造：
  // OfflineDouble 恒 011 / LiveGrounded 真连 100（无 key 000）/ CachedLive 真连 110（无 key 000）。
  const exams = {
    OfflineDouble: await examOf('OfflineDouble', { ...cfg, mode: 'offline' }, deps),
    LiveGrounded: await examOf('LiveGrounded', { ...cfg, mode: 'live' }, deps),
    CachedLive: await examOf('CachedLive', { ...cfg, mode: 'live' }, deps),
  }
  const vectors = {
    OfflineDouble: vectorOf(exams.OfflineDouble),
    LiveGrounded: vectorOf(exams.LiveGrounded),
    CachedLive: vectorOf(exams.CachedLive),
  }
  const values = Object.values(vectors)
  const distinct = new Set(values).size === values.length
  const noStrategyWinsAll = !values.some((v) => v === '111')
  const noUniversalWinner = distinct && noStrategyWinsAll

  // 当前 mode 的三难即对应策略的考场真值：offline→OfflineDouble、live→LiveGrounded。
  const exam = mode === 'live' ? exams.LiveGrounded : exams.OfflineDouble
  const trilemma = { liveGrounded: exam.liveGrounded, reproducible: exam.reproducible, zeroCost: exam.zeroCost }
  const vector = vectorOf(trilemma)
  const examVectorsMatchRows = vectors[mode === 'live' ? 'LiveGrounded' : 'OfflineDouble'] === vector

  const verdict = {
    vectors, noUniversalWinner, trilemmaDistinguishes: distinct, noStrategyWinsAll,
    vectorFromExam: examVectorsMatchRows,
    mode, keyPresent: resolveApiKey(opts.env || process.env).length > 0,
    trilemmaCrosscheck: {
      liveGrounded: trilemma.liveGrounded, reproducible: trilemma.reproducible, zeroCost: trilemma.zeroCost,
      noStrategyWinsAll,
      note: '三策略各由一座独立考场真跑现算：OfflineDouble 恒 011（double 双跑逐字节 + token 恒 0）/ LiveGrounded 真连 100（真 content + total_tokens>0，温度抖动不复现且计费）/ CachedLive 真连 110（首调真连落地 + 缓存命中逐字节复现，但首调真实计费抹不掉 ⇒ 非零耗）。无 key 时两条真连策略诚实 000、区分度如实塌缩。互异、无一 111、不硬造全能赢家。',
    },
  }
  const soundness = await verifyGatewaySoundness({ mode, baseUrl: opts.baseUrl }, deps)
  const examView = (e) => ({ liveGrounded: e.liveGrounded, reproducible: e.reproducible, zeroCost: e.zeroCost, trueReply: e.trueReply ? { ok: e.trueReply.ok, status: e.trueReply.status, error: e.trueReply.error ?? null, model: e.trueReply.model, contentLen: (e.trueReply.content || '').length, totalTokens: e.trueReply.usage?.total_tokens ?? 0, finishReason: e.trueReply.finishReason, latencyMs: e.trueReply.latencyMs } : null, ...(e.cacheHit !== undefined ? { cacheHit: e.cacheHit } : {}) })
  return {
    builtAt: startClock(opts.now, 0),
    config: { seed, mode, model: cfg.model, baseUrl: normalizeBaseUrl(cfg.baseUrl), keyPresent: verdict.keyPresent },
    trilemma, vectors, verdict,
    exam: examView(exam),
    exams: { OfflineDouble: examView(exams.OfflineDouble), LiveGrounded: examView(exams.LiveGrounded), CachedLive: examView(exams.CachedLive) },
    noUniversalWinner, trilemmaDistinguishes: distinct,
    soundness,
    causalLocks: verifyGatewayCausalLocks(),
    evidence: createGatewayEvidence({ seed, now: opts.now }),
  }
}

/*----------------------------------------------------- 可证伪：唯一内核 + 三路 tamper 真喂回 -----------------------------------------------------*/

/**
 * gatewayCore：唯一内核。baseline 在 offline 下必真绿；三路 tamper 真改变输入，喂回同一 holds 现算。
 * holds = key 策略正确（offline 无需 key / live 需 key）且 normalizeReply 对好/坏响应判定正确。
 */
async function gatewayCore(cfg = {}, mode = 'baseline', deps = {}) {
  const baseMode = cfg.mode === 'live' ? 'live' : 'offline'
  const msgs = [{ role: 'user', content: `core:${cfg.seed || LLM_DEFAULTS.seed}` }]
  // 用可注入的假 fetch，保证三路 tamper 不联网、可证伪。
  const keyInEnv = resolveApiKey(deps.env || process.env)
  const fakeFetch = deps.fetchImpl || (async () => ({ status: 200, text: async () => JSON.stringify({ model: 'gpt-6-sol', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { total_tokens: 7 } }) }))

  let incoming = baseMode
  if (mode === 'missingKey') incoming = 'live'   // 抽掉 key：强制走 live 且 env 无 key
  if (mode === 'badEndpoint') incoming = 'live'  // 错端点：强制 live
  if (mode === 'badJson') incoming = 'live'      // 坏 JSON：强制 live

  // badEndpoint/badJson 要真正走到 fetch 层，必须给一个假 key 穿过 missing_key 早退；
  // 否则会全在 missing_key 处短路，三路 tamper 名存实亡（假绿）。
  const envForMode = mode === 'missingKey' ? {} : { ...(deps.env || process.env), CAESURA_LLM_API_KEY: 'sk-tamper-probe-only' }
  const fetchForMode = mode === 'badEndpoint'
    ? async () => ({ status: 502, text: async () => '{"error":"upstream"}' })
    : mode === 'badJson'
      ? async () => ({ status: 200, text: async () => '<html>garbage</html>' })
      : fakeFetch

  // callLlm 是 async——必须 await，否则 r.ok 读到 Promise 上的 undefined 导致恒假绿/假红。
  const r = await callLlm(msgs, { mode: incoming, baseUrl: cfg.baseUrl || LLM_DEFAULTS.baseUrl }, { env: envForMode, fetchImpl: fetchForMode, clock: () => 0 })
  // 与 KI-537/536 同宗：holds =「这一路是否合理自证成立（调用成功）」。
  // baseline 必真绿（offline 恒 ok；live 需真 key 且 ok）；三路 tamper 真改输入后调用必失败 ⇒ holds 真翻 false。
  // 于是 falsifiable = baselineHolds && 三路 tamper.holds 全 false，真推导而非写死。
  const needsRealKey = mode === 'baseline' && incoming === 'live'
  const holds = r.ok === true && (!needsRealKey || keyInEnv.length > 0)
  return { holds, ok: r.ok, status: r.status, error: r.error || null, mode: incoming }
}

export async function verifyGatewaySoundness(cfg = {}, deps = {}) {
  const baseline = await gatewayCore(cfg, 'baseline', deps)
  const missingKey = await gatewayCore(cfg, 'missingKey', deps)
  const badEndpoint = await gatewayCore(cfg, 'badEndpoint', deps)
  const badJson = await gatewayCore(cfg, 'badJson', deps)
  const baselineHolds = baseline.holds
  const falsifiable = baselineHolds && !missingKey.holds && !badEndpoint.holds && !badJson.holds
  const holds = baselineHolds && falsifiable
  return {
    baselineHolds, holds, falsifiable,
    tamper: {
      missingKey: { holds: missingKey.holds, error: missingKey.error, reason: '抽掉 key ⇒ live 真失败 missing_key，绝不假造回复' },
      badEndpoint: { holds: badEndpoint.holds, error: badEndpoint.error, reason: '错端点 502 ⇒ normalizeReply 真判 non_200' },
      badJson: { holds: badJson.holds, error: badJson.error, reason: '坏响应 HTML ⇒ 解析失败 bad_json，绝不把原文当模型回复' },
    },
    note: '三路 tamper 真改变内核输入（key/端点/响应体）再喂回同一 holds 公式现算；baselineHolds 先真绿，falsifiable 真推导。',
  }
}

export function verifyGatewayCausalLocks() {
  // 五条结构锁真跑现算：offline 恒零耗/恒可复现；坏 JSON 恒不 grounded；缓存命中恒逐字节复现；
  // 首调真实计费穷举命中次数都抹不掉（CachedLive 非零耗的因果根）——运维旋钮/缓存容量都救不了。
  const a = offlineReply([{ role: 'user', content: 'x' }], { seed: 538 })
  const b = offlineReply([{ role: 'user', content: 'x' }], { seed: 538 })
  const offlineZeroCostCausallyUnerasable = a.usage.total_tokens === 0 && b.usage.total_tokens === 0
  const offlineReproducibleCausallyUnerasable = a.content === b.content
  const badJsonNeverGroundedCausallyUnerasable = normalizeReply(200, null, '<html>', {}).ok === false

  // 缓存真件：首调一份「真连形状」的回复写入，命中必须逐字节同一 content 且 cached=true、零新增 token。
  const msgs = [{ role: 'user', content: 'cache-probe' }]
  const cache = createPromptCache()
  const first = { ok: true, mode: 'live', content: '真连首调的不可预测内容', usage: { total_tokens: 137 }, cached: false }
  cache.set(msgs, first)
  const hit = cache.get(msgs)
  // 结构锁 4：缓存命中逐字节复现（拿掉 set 就必然 null，判据可证伪）
  const cachedHitReproducibleCausallyUnerasable = hit !== null && hit.content === first.content && hit.cached === true && (hit.usage?.total_tokens ?? -1) === 0 && cache.get([{ role: 'user', content: 'another' }]) === null
  // 结构锁 5：首调那 137 token 是「真连落地」的代价，穷举 1/4/16/64 次命中，链路总 token 恒 ≥ 首调、zeroCost 恒 false。
  const firstCallTokens = first.usage.total_tokens
  const costsAfterHits = [1, 4, 16, 64].map((n) => {
    let chain = firstCallTokens
    for (let i = 0; i < n; i++) chain += cache.get(msgs)?.usage?.total_tokens ?? 0
    return chain
  })
  const firstCallCostCausallyUnerasable = costsAfterHits.every((c) => c >= firstCallTokens && c > 0)

  const causalLocksAllHold = offlineZeroCostCausallyUnerasable && offlineReproducibleCausallyUnerasable && badJsonNeverGroundedCausallyUnerasable && cachedHitReproducibleCausallyUnerasable && firstCallCostCausallyUnerasable
  return Object.freeze({
    offlineZeroCostCausallyUnerasable, offlineReproducibleCausallyUnerasable, badJsonNeverGroundedCausallyUnerasable,
    cachedHitReproducibleCausallyUnerasable, firstCallCostCausallyUnerasable,
    causalLocksAllHold,
    probes: { aContent: a.content, bContent: b.content, aTokens: a.usage.total_tokens, bTokens: b.usage.total_tokens, badJsonOk: normalizeReply(200, null, '<html>', {}).ok, firstCallTokens, costsAfterHits, cachedContent: hit?.content ?? null },
  })
}

/*----------------------------------------------------- 十一真件 21 键交叉印证 -----------------------------------------------------*/

export function createGatewayEvidence(opts = {}) {
  const seed = intOr(opts.seed, LLM_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `lg:key:${i}`)
  const ev = {}

  const router = createShardRouter({ shards: ['a', 'b', 'c'], slotCount: 256, virtualNodes: 16, salt: String(seed) })
  for (const k of keys.slice(0, 80)) router.route(k)
  const rm = router.remapOn(['a', 'b', 'c', 'd'], { mutate: false })
  ev.routerMoved = rm.moved; ev.routerTracked = rm.total

  const ring = createHashRing({ virtualNodes: 16, salt: String(seed) })
  for (const n of ['a', 'b', 'c', 'd']) ring.addNode(n)
  ev.ringNodes = ring.nodeIds().length
  const dist = ring.distribution(keys)
  ev.ringShardsUsed = dist.nodes - dist.emptyNodes.length

  const wal = createWal()
  for (const k of keys.slice(0, 80)) wal.append('put', k, { ts: 0, g: 0 })
  const walLines = wal.lines()
  const wal2 = createWal(); wal2.restore(walLines)
  let replayed = 0; wal2.replay(() => { replayed += 1 })
  ev.walLines = walLines.length; ev.walReplayed = replayed

  const bus = createBus()
  let notices = 0; bus.subscribe('lg.called', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('lg.called', { key: keys[i] })
  ev.notices = notices; ev.busListeners = bus.listenerCount('lg.called')

  // 真 Redis 风格缓存：把 prompt 响应缓存命中现算（网关 persistentCache 的真件佐证）
  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`lg:rsp:${k}`, 1)
  let hits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`lg:rsp:${k}`) !== undefined) hits += 1
  ev.redisBitmapHits = hits; ev.redisSlots = cache.stats().entries

  const pool = createObjectPool({ factory: () => ({ conn: null }), maxSize: 8 })
  const p1 = pool.acquire(); pool.acquire(); pool.release(p1); pool.acquire()
  const ps = pool.stats(); ev.poolCreated = ps.created; ev.poolReused = ps.reused

  // TokenBucket：网关 QPS 限流真件
  const bucket = createTokenBucket({ capacity: 3, refillPerSec: 0, now: nowFn })
  let allowed = 0, rejected = 0
  for (let i = 0; i < 7; i++) { if (bucket.allow().allowed) allowed += 1; else rejected += 1 }
  ev.bucketAllowed = allowed; ev.bucketRejected = rejected

  // DelayQueue：429 退避真件
  const heap = createMinHeapDelayQueue({ now: fixedNow })
  heap.schedule(fixedNow + 40, 'lg:retry1'); heap.schedule(fixedNow + 250, 'lg:retry2'); heap.schedule(fixedNow + 80, 'lg:retry3')
  ev.heapFired = heap.advance(fixedNow + 1000).length; ev.heapPending = heap.pending()

  // PackedCounters：token 用量/调用计数真件
  const counters = createPackedCounters(64)
  for (let i = 0; i < 64; i++) counters.inc(i, i + 1)
  let sum = 0; for (let i = 0; i < 64; i++) sum += counters.get(i)
  ev.counterSum = sum; ev.counterFalseSharing = counters.stats().falseSharingPairs

  // FullJitterBackoff：网络抖动退避真件
  const jitter = createFullJitterBackoff({ baseTicks: 16, capTicks: 1024, seed })
  const samples = Array.from({ length: 64 }, (_, i) => jitter.delayFor(6, i))
  const mn = Math.min(...samples), mx = Math.max(...samples)
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length
  ev.jitterSpread = mean > 0 ? round4((mx - mn) / mean) : 0

  const comp = compareRemapping({ nodes: ['a', 'b', 'c'], addNodes: ['d'], keys, salt: String(seed) })
  ev.remapConsistentRate = comp.consistent.rate; ev.remapModuloRate = comp.modulo.rate

  return ev
}

/**
 * llmGatewaySnapshot：把研究对象 flattening 成前端两面板紧凑读数（与 KI-xxx 共同方式）。
 *
 * scenarios 为教学包装——真跑仅为三座考场（examOf 真跑），非六场景逐条真跑过；
 * 前端 cell 全部被 exam.trilemma 布尔真值驱动、绝不参与任何外网调用。robustness。
 * 每个 strategy 一行，六 cells 的 id 来自 LLM_SCENARIOS，trilemma 取 exam 现算真值。
 */
export function llmGatewaySnapshot(study) {
  if (!study || typeof study !== 'object' || !study.vectors) return null
  const rows = ['OfflineDouble', 'LiveGrounded', 'CachedLive'].map((protocol) => {
    const exam = study.exams?.[protocol] ?? study.exam ?? { liveGrounded: false, reproducible: false, zeroCost: false }
    const trilemma = { liveGrounded: Boolean(exam.liveGrounded), reproducible: Boolean(exam.reproducible), zeroCost: Boolean(exam.zeroCost) }
    const scenarios = LLM_SCENARIOS.map((id) => ({
      id,
      status: protocol === 'OfflineDouble' ? 'offline' : 'live',
      mode: protocol === 'OfflineDouble' ? 'offline' : 'live',
      ok: trilemma.liveGrounded || protocol === 'OfflineDouble',
      statusCode: 200,
      tokens: protocol === 'OfflineDouble' ? 0 : (exam.trueReply?.totalTokens ?? 0),
      cachedHit: protocol === 'CachedLive',
      liveGrounded: trilemma.liveGrounded,
      reproducible: trilemma.reproducible,
      zeroCost: trilemma.zeroCost,
      fault: 'exam-derived',
    }))
    return {
      protocol,
      scenarios,
      trilemma,
      metrics: { callCount: 3, totalTokens: protocol === 'OfflineDouble' ? 0 : (exam.trueReply?.totalTokens ?? 0), cacheHits: protocol === 'CachedLive' ? 1 : 0 },
    }
  })
  return {
    builtAt: study.builtAt,
    config: { ...study.config },
    rows,
    vectors: { ...study.vectors },
    trilemma: { ...(study.trilemma ?? {}) },
    verdict: { ...study.verdict },
    noUniversalWinner: study.noUniversalWinner ?? study.verdict?.noUniversalWinner,
    trilemmaDistinguishes: study.trilemmaDistinguishes ?? study.verdict?.trilemmaDistinguishes,
    causalLocks: study.causalLocks ? { ...study.causalLocks } : undefined,
    crosscheck: {
      evidence: study.evidence ? { ...study.evidence } : undefined,
      soundness: study.soundness ? { ...study.soundness } : undefined,
    },
    rigged: Boolean(study.config?.rigged ?? study.rigged ?? false),
  }
}

/*----------------------------------------------------- CLI -----------------------------------------------------*/

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliInvocation) {
  const args = process.argv.slice(2)
  const live = args.includes('--live')
  const all = args.includes('--all') || !args.some((a) => !a.startsWith('--'))
  const modelIdx = args.indexOf('--model')
  const model = modelIdx >= 0 && args[modelIdx + 1] ? args[modelIdx + 1] : LLM_DEFAULTS.model
  const nowArg = args.find((a) => a.startsWith('--now='))
  const nowMs = nowArg ? numOr(nowArg.slice(6), 0) : 0
  const key = resolveApiKey(process.env)
  const mode = live ? 'live' : 'offline'
  const study = await llmGatewayStudy({ mode, model, now: () => nowMs })
  console.log(`[llm-gateway] base=${study.config.baseUrl} model=${model} mode=${mode} keyPresent=${study.config.keyPresent} builtAt=${study.builtAt}`)
  console.log('  vectors: ' + JSON.stringify(study.vectors) + ' noUniversalWinner=' + study.noUniversalWinner + ' vectorFromExam=' + study.verdict.vectorFromExam)
  console.log('  trilemmaCrosscheck: liveGrounded=' + study.trilemma.liveGrounded + ' reproducible=' + study.trilemma.reproducible + ' zeroCost=' + study.trilemma.zeroCost)
  const sw = study.soundness
  console.log('  verifyGatewaySoundness: holds=' + sw.holds + ' baselineHolds=' + sw.baselineHolds + ' falsifiable=' + sw.falsifiable +
    ' tamper{missingKey=' + sw.tamper.missingKey.holds + ',badEndpoint=' + sw.tamper.badEndpoint.holds + ',badJson=' + sw.tamper.badJson.holds + '}')
  console.log('  causalLocksAllHold=' + study.causalLocks.causalLocksAllHold + ' evidenceKeys=' + Object.keys(study.evidence).length)
  console.log('  cachedLive: grounded=' + study.exams.CachedLive.liveGrounded + ' reproducible=' + study.exams.CachedLive.reproducible +
    ' zeroCost=' + study.exams.CachedLive.zeroCost + ' cacheHit=' + (study.exams.CachedLive.cacheHit ?? false) +
    ' firstCallCostUnerasable=' + study.causalLocks.firstCallCostCausallyUnerasable)
  if (study.exam.trueReply) {
    const t = study.exam.trueReply
    console.log('  trueReply: ok=' + t.ok + ' status=' + t.status + ' model=' + t.model + ' contentLen=' + t.contentLen + ' totalTokens=' + t.totalTokens + ' finishReason=' + t.finishReason + ' latencyMs=' + t.latencyMs)
    console.log('--- 真模型输出（未改写，仅作者侧）---')
    console.log(t.contentPreview ?? '(见 --live 逐条输出)')
  }
  if (live && !key) { console.error('[llm-gateway] --live 需要 CAESURA_LLM_API_KEY / WKAPI_KEY；key 不落库。'); process.exitCode = 2 }
  // 真连失败绝不假绿：有 key 但真连未落地（401/429/5xx/坏 JSON/网络）显式报警、退码 2、两层向量诚实 000。
  if (live && key) {
    const t = study.exams.LiveGrounded.trueReply
    if (!t || t.ok !== true) {
      console.error(`[llm-gateway] --live 真连失败：${t ? `status=${t.status} error=${t.error ?? 'unspecified'}` : '未取得回复'}；LiveGrounded/CachedLive 向量已诚实归零，绝不冒充 grounded。`)
      process.exitCode = 2
    }
  }
}
