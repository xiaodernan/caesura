/** `scripts/caesura-llm-gateway.mjs` 的声明：真大模型协同网关教学件（KI-538）。 */

export const LLM_DEFAULTS: Readonly<{
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  seed: number
  timeoutMs: number
  persistentCache: boolean
  zeroTemp: boolean
  localDouble: boolean
  rigged: boolean
}>
export const LLM_STRATEGIES: readonly string[]
export const LLM_SCENARIOS: readonly string[]

/**
 * 可重试的状态码（实测定案 · 2026-11-14 · wkapi.pro/v1 · gpt-6-sol）：
 * 代理在 Chat Completions / Responses 两种后端之间分流抖动，落到只认
 * `input`/`prompt` 的 Responses 后端时稳定返回 400；与请求长度、内容语言、消息条数均无关。
 * ⇒ 400 必须重试（换一台后端通常就成了）；401/429/5xx 一律不重试（如实失败，避免放大限流压力）。
 */
export const AGENT_RETRY_STATUS: readonly number[]
/** 默认重试次数（首次 + 2 次重试）；失败路径的 `attempts` 记的是**实际尝试次数**，不是这个上限。 */
export const AGENT_RETRY_DEFAULT_ATTEMPTS: number

export interface LlmReply {
  /** 真机重试计数（agent attempts；1 = 首次即成/不重试） */
  attempts?: number
  /**
   * **降级重试标记**：默认注入了 `prompt_cache_key`，但端点不认这个参数（400）⇒
   * 自动去掉它重试并成功。`true` 表示本次成功**没有**用上前缀亲和键（退化成整请求级命中）。
   */
  degradedWithoutCacheKey?: boolean
  /**
   * **路由抖动自愈次数**：暖过的前缀本次命中归零 ⇒ 判定为被分到冷后端 ⇒ 重试的次数。
   * 0 = 没发生过自愈。绝不悄悄多花钱，代价必须记账。
   */
  cacheMissRetries?: number
  ok: boolean
  mode: 'offline' | 'live'
  status: number
  model: string
  content: string
  finishReason: string | null
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_tokens?: number; cache_hit_rate?: number; prompt_tokens_details?: { cached_tokens?: number } } | null
  latencyMs: number
  via: 'offline-double' | 'live' | 'live-stream' | 'prompt-cache'
  error?: string | null
  rawText?: string | null
  cached?: boolean
  cachedTokens?: number
}

export interface PromptCache {
  keyOf(messages: Array<{ role?: string; content?: string }> | string): string
  get(messages: Array<{ role?: string; content?: string }> | string): (LlmReply & { cached: true }) | null
  set(messages: Array<{ role?: string; content?: string }> | string, reply: LlmReply): number
  has(messages: Array<{ role?: string; content?: string }> | string): boolean
  size(): number
}

export interface LlmExamView {
  liveGrounded: boolean
  reproducible: boolean
  zeroCost: boolean
  trueReply: { ok: boolean; status: number; error?: string | null; model: string; contentLen: number; totalTokens: number; finishReason: string | null; latencyMs: number } | null
  cacheHit?: boolean
}

export interface LlmStudy {
  builtAt: number
  config: { seed: number; mode: string; model: string; baseUrl: string; keyPresent: boolean }
  trilemma: { liveGrounded: boolean; reproducible: boolean; zeroCost: boolean }
  vectors: Record<string, string>
  verdict: {
    vectors: Record<string, string>
    noUniversalWinner: boolean
    trilemmaDistinguishes: boolean
    noStrategyWinsAll: boolean
    vectorFromExam: boolean
    mode: string
    keyPresent: boolean
    trilemmaCrosscheck: {
      liveGrounded: boolean
      reproducible: boolean
      zeroCost: boolean
      noStrategyWinsAll: boolean
      note: string
    }
  }
  exam: LlmExamView
  exams: { OfflineDouble: LlmExamView; LiveGrounded: LlmExamView; CachedLive: LlmExamView }
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  soundness: GatewaySoundness
  causalLocks: GatewayCausalLocks
  evidence: Record<string, number>
}

export interface GatewaySoundness {
  baselineHolds: boolean
  holds: boolean
  falsifiable: boolean
  tamper: {
    missingKey: { holds: boolean; error: string | null; reason: string }
    badEndpoint: { holds: boolean; error: string | null; reason: string }
    badJson: { holds: boolean; error: string | null; reason: string }
  }
  note: string
}

export interface GatewayCausalLocks {
  offlineZeroCostCausallyUnerasable: boolean
  offlineReproducibleCausallyUnerasable: boolean
  badJsonNeverGroundedCausallyUnerasable: boolean
  cachedHitReproducibleCausallyUnerasable: boolean
  firstCallCostCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  probes: { aContent: string; bContent: string; aTokens: number; bTokens: number; badJsonOk: boolean; firstCallTokens: number; costsAfterHits: number[]; cachedContent: string | null }
}

export function createPromptCache(opts?: { sizeCap?: number }): PromptCache
export function resolveApiKey(env?: Record<string, string | undefined>): string
export function normalizeBaseUrl(base?: string): string
/** 稳定前缀缓存键：锚在 system（逐字节稳定的文风总纲/NPC 圣经），不锚在每次都变的 user 正文上。 */
export function derivePromptCacheKey(messages: Array<{ role?: string; content?: string }>, opts?: { promptCacheKey?: string | boolean }): string
/**
 * **实际生效的缓存键**（字符串或 null）。
 *
 * <p>优先级：显式字符串 → 直接用（截到 64 字符）；`false`/`'off'`/`'none'` → 关闭（null）；
 * `true` → 强制按稳定前缀派生；**缺省 → 默认注入**（仅当消息里有 system 锚点）。
 * 没有 system 锚点时返回 null——退路锚点「首条消息前 512 字符」在多轮对话里每轮都变，
 * 拿它当亲和键等于每轮换主机、亲和性归零，比不注入更糟。</p>
 */
export function effectivePromptCacheKey(messages: Array<{ role?: string; content?: string }>, opts?: { promptCacheKey?: string | boolean | null; prompt_cache_key?: string | boolean | null }): string | null
/** 统一 usage 形状：cached_tokens + cache_hit_rate 现算真值；未命中时容忍 prompt_tokens_details 整体缺失。 */
export function normalizeUsage(u: unknown): {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cached_tokens: number
  cache_hit_rate: number
  [k: string]: unknown
} | null
export function buildChatBody(messages: Array<{ role: string; content: string }>, opts?: { model?: string; temperature?: number; maxTokens?: number; promptCacheKey?: string | boolean; stream?: boolean }): Record<string, unknown>
export function offlineReply(messages: Array<{ role: string; content: string }>, opts?: { seed?: number; model?: string }): LlmReply
export function normalizeReply(status: number, json: unknown, rawText: string, opts?: { model?: string; latencyMs?: number }): LlmReply
export function callLlm(
  messages: Array<{ role: string; content: string }>,
  opts?: { mode?: string; model?: string; baseUrl?: string; temperature?: number; maxTokens?: number; seed?: number; stream?: boolean; promptCacheKey?: string | boolean | null; agentAttempts?: number; cacheMissRetry?: number },
  deps?: { env?: Record<string, string | undefined>; fetchImpl?: (...args: any[]) => Promise<any>; signal?: unknown; clock?: () => number; agentAttempts?: number; cacheMissRetry?: number },
): Promise<LlmReply>
/** 清空「已暖前缀」记忆（测试用；生产不需要调用）。 */
export function resetWarmPrefixes(): void
export function invokeBatch(
  prompts: Array<{ id?: string; content: string } | string>,
  opts?: { system?: string; mode?: string; model?: string; baseUrl?: string },
  deps?: { env?: Record<string, string | undefined>; fetchImpl?: (...args: any[]) => Promise<any>; clock?: () => number },
): Promise<Array<LlmReply & { id: string }>>
export function llmGatewayStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  mode?: string
  model?: string
  baseUrl?: string
  system?: string
  env?: Record<string, string | undefined>
  fetchImpl?: (...args: any[]) => Promise<any>
  clock?: () => number
}): Promise<LlmStudy>
export function verifyGatewaySoundness(
  cfg?: { mode?: string; baseUrl?: string; seed?: number },
  deps?: { env?: Record<string, string | undefined>; fetchImpl?: (...args: any[]) => Promise<any>; clock?: () => number },
): Promise<GatewaySoundness>
export function verifyGatewayCausalLocks(): GatewayCausalLocks
export function createGatewayEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>

/** fd llmGatewaySnapshot：把研究对象 flattening 成前端两面板紧凑读数。 */
export function llmGatewaySnapshot(study: LlmGatewayStudy | null | Record<string, never>): LlmGatewaySnapshot | null

export interface LlmGatewayStudy {
  builtAt: number
  config: Record<string, any>
  trilemma: { liveGrounded: boolean; reproducible: boolean; zeroCost: boolean }
  vectors: Record<string, string>
  verdict: Record<string, any>
  exam: Record<string, any>
  exams?: Record<string, any>
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  soundness: { holds: boolean; baselineHolds: boolean; falsifiable: boolean; tamper: Record<string, any> } & Record<string, any>
  causalLocks: Record<string, any> & { causalLocksAllHold: boolean }
  evidence: Record<string, number>
}

export interface LlmGatewaySnapshotRow {
  protocol: 'OfflineDouble' | 'LiveGrounded' | 'CachedLive'
  scenarios: Array<{
    id: string; status?: string; mode?: string; ok?: boolean; statusCode?: number; tokens?: number; cachedHit?: boolean
    liveGrounded: boolean; reproducible: boolean; zeroCost: boolean; fault?: string
  }>
  trilemma: { liveGrounded: boolean; reproducible: boolean; zeroCost: boolean }
  metrics: Record<string, any>
}

export interface LlmGatewaySnapshot {
  builtAt: number
  config: LlmGatewayStudy['config']
  rows: LlmGatewaySnapshotRow[]
  vectors: Record<string, string>
  trilemma: LlmGatewayStudy['trilemma']
  verdict: LlmGatewayStudy['verdict']
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks?: LlmGatewayStudy['causalLocks']
  crosscheck?: { evidence?: Record<string, number>; soundness?: LlmGatewayStudy['soundness'] }
  rigged: boolean
}
