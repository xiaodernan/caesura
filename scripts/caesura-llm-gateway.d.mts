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

export interface LlmReply {
  ok: boolean
  mode: 'offline' | 'live'
  status: number
  model: string
  content: string
  finishReason: string | null
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_tokens?: number } | null
  latencyMs: number
  via: 'offline-double' | 'live' | 'prompt-cache'
  error?: string | null
  rawText?: string | null
  cached?: boolean
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
export function buildChatBody(messages: Array<{ role: string; content: string }>, opts?: { model?: string; temperature?: number; maxTokens?: number }): Record<string, unknown>
export function offlineReply(messages: Array<{ role: string; content: string }>, opts?: { seed?: number; model?: string }): LlmReply
export function normalizeReply(status: number, json: unknown, rawText: string, opts?: { model?: string; latencyMs?: number }): LlmReply
export function callLlm(
  messages: Array<{ role: string; content: string }>,
  opts?: { mode?: string; model?: string; baseUrl?: string; temperature?: number; maxTokens?: number; seed?: number },
  deps?: { env?: Record<string, string | undefined>; fetchImpl?: (...args: any[]) => Promise<any>; signal?: unknown; clock?: () => number },
): Promise<LlmReply>
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
