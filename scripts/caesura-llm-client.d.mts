/** `scripts/caesura-llm-client.mjs` —— 统一的作者侧 LLM 出口（KI-538 / 对话作者工具统一门面） */

export const NPC_BIBLE: string
export const SHORT_BIBLE: string

export interface BibleMessages {
  model: string
  stream: true
  stream_options: { include_usage: true }
  temperature: number
  max_tokens: number
  messages: Array<{ role: 'system' | 'user'; content: string }>
  /**
   * 前缀缓存**亲和路由**键（默认注入）。
   *
   * ⚠️ 它**不是命中率开关**：实测同一条前缀注不注入，稳态命中率都是 4/4（docs/llm-cache-fix.md 第十二节）。
   * 它的作用是把逐字节稳定的前缀钉在同一台缓存主机，减少被分到冷后端的概率。
   */
  prompt_cache_key?: string
}
export function buildBibleMessages(opts?: {
  npcMode?: 'canon' | 'short'
  user?: string
  model?: string
  temperature?: number
  maxTokens?: number
  /**
   * 亲和路由键策略：默认 `'auto'`（**默认注入**）；`true`=由稳定 system 前缀派生；
   * 字符串=直接用该键；`false` / `'off'` / `'none'`=关闭。
   */
  cacheKey?: boolean | string | 'auto' | 'off' | 'none'
}): BibleMessages

/** 稳定前缀缓存键：锚在 system（逐字节稳定的文风总纲/NPC 圣经），不锚在每次都变的 user 正文上。 */
export function derivePromptCacheKey(messages: Array<{ role?: string; content?: string }>, opts?: { promptCacheKey?: string | boolean }): string

/** 统一 usage 形状：cached_tokens + cache_hit_rate 现算真值；未命中时容忍 prompt_tokens_details 整体缺失。 */
export function normalizeUsage(u: unknown): {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cached_tokens: number
  cache_hit_rate: number
  [k: string]: unknown
} | null

export interface LlmCallResult {
  ok: boolean
  status: number
  dt: number
  usage: any
  cachedTokens: number
  /** 现算命中率 = cached_tokens / prompt_tokens（0~1），绝不写死、绝不估算。 */
  cacheHitRate: number
  text: string
  raw?: string
}
export function callLlm(body: BibleMessages | Record<string, unknown>, opts?: {
  baseUrl?: string
  apiKey?: string
  /** 可注入 fetch（测试 mock / 上层网关 deps.fetchImpl 透传）。 */
  fetchImpl?: (...args: any[]) => Promise<any>
}): Promise<LlmCallResult>

export interface WarmupResult {
  /** 无 key ⇒ 零网络请求的诚实降级。 */
  skipped: boolean
  reason: string | null
  rounds: number
  /** 每轮的 `cached_tokens`（唯一可信命中读数）。 */
  cachedTokens: number[]
  /** 每轮的代理记账值（跨请求不可比）。 */
  promptTokensReported: number[]
  statuses: number[]
  /** 第几轮开始命中（1-based）；从未命中 ⇒ rounds+1。 */
  warmupRounds: number
  /** 是否烤热成功。 */
  warm: boolean
  prefixBytes: number
  note: string
}
/** 前缀预热：首调必 miss ⇒ 生产上先烤热再跑正题。零 key 时零网络请求。 */
export function warmupPrefix(opts?: {
  rounds?: number
  npcMode?: 'canon' | 'short'
  user?: string
  model?: string
  temperature?: number
  maxTokens?: number
  baseUrl?: string
  apiKey?: string
  fetchImpl?: (...args: any[]) => Promise<any>
}): Promise<WarmupResult>
