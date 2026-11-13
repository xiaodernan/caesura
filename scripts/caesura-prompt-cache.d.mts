/**
 * scripts/caesura-prompt-cache.d.mts · KI-555 前缀亲和 prompt-cache 教学件声明
 *
 * 与 `.mjs` 逐字节同步：
 * - estimateTokens 是**结构量工程近似**（CJK 0.75 token/字 + 其它 4 字符/token），不冒充真 tokenizer、不冒充计费真值
 * - infoFidelity 的口径是「模型看到的世界有没有变（一条事实都没被丢）」，不是「核心事实还在」
 * - live 路径只经 env 注入（PROMPT_CACHE_LIVE_KEY / CAESURA_LLM_API_KEY），不写死 endpoint、不落密钥
 * - live 的唯一可信命中读数是 usage.prompt_tokens_details.cached_tokens（代理的 prompt_tokens 是记账值，不可跨请求比较）
 */

export const PROMPT_CACHE_DEFAULTS: Readonly<{
  seed: number
  messages: number
  cjkTokensPerChar: number
  otherCharsPerToken: number
  coreDensityBoost: number
  budgetTokens: number
  freeStablePrefix: boolean
  losslessSummaryTrim: boolean
  unlimitedBudget: boolean
  zeroTrimPenalty: boolean
  rigged: boolean
}>
export const PROMPT_CACHE_STRATEGIES: ReadonlyArray<'VolatilePrefix' | 'StablePrefix' | 'BudgetedPrefix'>
export const PROMPT_CACHE_SCENARIOS: ReadonlyArray<'coldStart' | 'steadyReuse' | 'overBudget' | 'cleanRerun'>

export interface SyntheticFact { id: string; text: string; core: boolean; priority: number }
export interface SyntheticTurn { id: string; speaker: string; index: number; facts: SyntheticFact[]; heavy: SyntheticFact[] }
export interface SyntheticCorpus {
  seed: number
  messages: number
  prefixLength: number
  prefixTokens: number
  turns: SyntheticTurn[]
}

export const PROMPT_CACHE_BIBLE: string
export function estimateTokens(text: unknown): number
export function createSyntheticCorpus(opts?: { seed?: number; messages?: number }): SyntheticCorpus
export function factDensity(fact: { text?: unknown; priority?: number; core?: boolean }): number

export interface PromptCacheLogEntry {
  turn: number
  hit: boolean
  drifted: boolean
  billed: number
  retained: number
  dropped: number
}
export interface PromptCacheInvokeResult {
  freshPrefixTokens: number
  suffixTokens: number
  retainedFacts: number
  droppedFacts: number
  hits: number
  coreKept: number
  coreTotal: number
  turns: number
  trimmedTokens: number
  log: PromptCacheLogEntry[]
}
export interface PromptCacheBackend {
  protocol: 'VolatilePrefix' | 'StablePrefix' | 'BudgetedPrefix'
  invoke(turns: SyntheticTurn[]): PromptCacheInvokeResult
}
export function createVolatilePrefix(opts?: { freeStablePrefix?: boolean }): PromptCacheBackend
export function createStablePrefix(opts?: { freeStablePrefix?: boolean; bibleAt?: (index: number) => string; warmupLag?: number }): PromptCacheBackend
export function createBudgetedPrefix(opts?: {
  budgetTokens?: number
  unlimitedBudget?: boolean
  zeroTrimPenalty?: boolean
  losslessSummaryTrim?: boolean
  invertedRank?: boolean
  warmupLag?: number
}): PromptCacheBackend

export interface PromptCacheScenarioCell {
  id: 'coldStart' | 'steadyReuse' | 'overBudget' | 'cleanRerun'
  messages: number
  freshPrefixTokens: number
  suffixTokens: number
  retainedFacts: number
  droppedFacts: number
  coreKept: number
  coreTotal: number
  hits: number
  misses: number
  tokensShipped: number
  perTurnTokens: number
  trimmedTokens: number
  bibleTokens: number
  warmupLag: number
  rerunIdentical: boolean | null
  fault: 'cold-cache-write-lag' | 'warm-prefix-reuse' | 'budget-cap' | 'rerun-idempotent'
}
export interface PromptCacheAxes {
  steadyHits: number
  expectedHits: number
  hitRate: number
  coreKept: number
  coreTotal: number
  coreKeepRate: number
  droppedFacts: number
  factsIntact: boolean
  perTurnTokens: number
  baselinePerTurnTokens: number
  trimmedTokens: number
  hitSource: 'local-prefix-fingerprint'
  tokenSource: 'heuristic-estimate'
}
export interface PromptCacheRow {
  protocol: 'VolatilePrefix' | 'StablePrefix' | 'BudgetedPrefix'
  scenarios: PromptCacheScenarioCell[]
  trilemma: { cacheHitRate: boolean; infoFidelity: boolean; tokenEfficiency: boolean }
  axes: PromptCacheAxes
  metrics: {
    totalShippedTokens: number
    totalRetainedFacts: number
    totalDroppedFacts: number
    totalTrimmedTokens: number
    coreKeepRate: number
    steadyHits: number
    expectedHits: number
    perTurnTokens: number
  }
}
export interface PromptCacheVerdict {
  vectors: Record<string, string>
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  noStrategyWinsAll: boolean
  vectorFromTrilemma: boolean
  scenarioDistinguishes: boolean
  rigged: boolean
  rigged_pkg_flags: { freeStablePrefix: boolean; zeroTrimPenalty: boolean; losslessSummaryTrim: boolean; unlimitedBudget: boolean }
  riggedConvergenceCollapsed: boolean
}
export interface PromptCacheCausalLocks {
  prefixAffinityCausallyUnerasable: boolean
  tokenBudgetCausallyUnerasable: boolean
  factRankCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  probes: {
    stableHits: number
    driftHits: number
    driftAt: number
    driftPrefixPayments: number
    budgetHits: number
    trimmedFacts: number
    coreTrimmedFacts: number
    rankSorted: number
  }
}
export interface PromptCacheSoundness {
  laneA: { hits: number; sharedPrefixTokens: number; freshPrefixTokens: number; turns: number; driftAt: number; stablePrefixPaidOnce: boolean }
  laneB: { retainedFacts: number; droppedFacts: number; trimmedTokens: number; coreKept: number; coreTotal: number; coreKeepRate: number }
  baselineHolds: boolean
  holds: boolean
  nontrivial: boolean
  falsifiable: boolean
  tamper: {
    prefixDrift: { holds: boolean; reason: string }
    trimDisabled: { holds: boolean; reason: string }
    factsDropped: { holds: boolean; reason: string }
  }
  events: number
}
export interface PromptCacheEvidence {
  routerMoved: number
  routerTracked: number
  ringNodes: number
  ringShardsUsed: number
  walLines: number
  walReplayed: number
  notices: number
  busListeners: number
  redisBitmapHits: number
  redisSlots: number
  poolCreated: number
  poolReused: number
  bucketAllowed: number
  bucketRejected: number
  heapFired: number
  heapPending: number
  counterSum: number
  counterFalseSharing: number
  jitterSpread: number
  remapConsistentRate: number
  remapModuloRate: number
}
export interface PromptCacheStudy {
  builtAt: number
  config: {
    seed: number
    messages: number
    budgetTokens: number
    freeStablePrefix: boolean
    zeroTrimPenalty: boolean
    losslessSummaryTrim: boolean
    unlimitedBudget: boolean
    rigged: boolean
  }
  rows: PromptCacheRow[]
  vectors: Record<string, string>
  verdict: PromptCacheVerdict
  causalLocks: PromptCacheCausalLocks
  crosscheck: { evidence: PromptCacheEvidence; soundness: PromptCacheSoundness }
  rigged: boolean
}
export interface PromptCacheSnapshot {
  builtAt: number
  config: PromptCacheStudy['config']
  rows: Array<{
    protocol: PromptCacheRow['protocol']
    scenarios: PromptCacheScenarioCell[]
    trilemma: PromptCacheRow['trilemma']
    axes: PromptCacheAxes
    metrics: PromptCacheRow['metrics']
  }>
  vectors: Record<string, string>
  verdict: PromptCacheVerdict
  /** 下列两个随 verdict 现算拍平（与 springVaultSnapshot 同款顶层位） */
  noUniversalWinner?: boolean
  trilemmaDistinguishes?: boolean
  causalLocks: PromptCacheCausalLocks
  crosscheck: PromptCacheStudy['crosscheck']
  rigged: boolean
}
export function promptCacheStudy(opts?: {
  seed?: number
  messages?: number
  budgetTokens?: number
  now?: () => number
  freeStablePrefix?: boolean
  zeroTrimPenalty?: boolean
  losslessSummaryTrim?: boolean
  unlimitedBudget?: boolean
  rigged?: boolean
}): PromptCacheStudy
export const comparePromptCache: typeof promptCacheStudy
export function promptCacheSnapshot(study?: PromptCacheStudy): PromptCacheSnapshot

/** 双路自证 + 三路 tamper 喂回同一个 holds 公式现算 */
export function verifyPromptCacheSoundness(input?: { seed?: number; messages?: number }, opts?: { seed?: number; messages?: number; budgetTokens?: number }): PromptCacheSoundness
/** 三因果锁（prefixAffinity / tokenBudget / factRank）——漂移命中数是真跑出来的，不是常量 */
export function verifyCausalLocks(flags?: { freeStablePrefix?: boolean; zeroTrimPenalty?: boolean; losslessSummaryTrim?: boolean; unlimitedBudget?: boolean }): PromptCacheCausalLocks
/** 21 件跨系统证据（一致性哈希 / WAL / Bus / RedisCache / ObjectPool / TokenBucket / MinHeap / PackedCounters / FullJitterBackoff） */
export function createPromptCacheEvidence(opts?: { seed?: number; now?: number | (() => number) }): PromptCacheEvidence

export interface PromptCacheLiveLane {
  cachedTokens: number[]
  promptTokensReported: number[]
  statuses: number[]
  attempts: number
  hits: number
  misses: number
}
export interface PromptCacheLiveResult {
  live: boolean
  skipped: boolean
  reason: string | null
  baseUrl: string
  model: string
  rounds: number
  attempts: number
  hitSource: 'none' | 'api-usage-prompt-tokens-details-cached-tokens'
  tokenSource: 'none' | 'proxy-accounting-not-comparable'
  cachedTokens: number
  hitRate: number
  stable: PromptCacheLiveLane | null
  drift: PromptCacheLiveLane | null
  prefixBytes: number
  prefixTokens: number
  prefixSignature: string | null
  note: string
}
/** live 通道：只认 usage.prompt_tokens_details.cached_tokens；无 key ⇒ 诚实降级、零网络请求 */
export function runPromptCacheLive(opts?: { rounds?: number; driftLane?: boolean }, deps?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch }): Promise<PromptCacheLiveResult>
