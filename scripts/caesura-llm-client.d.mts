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
  /** 前缀缓存亲和路由键（**仅显式 opt-in 时才带上**；实测默认不带——wkapi.pro 已有全局前缀缓存）。 */
  prompt_cache_key?: string
}
export function buildBibleMessages(opts?: {
  npcMode?: 'canon' | 'short'
  user?: string
  model?: string
  temperature?: number
  maxTokens?: number
  /** 显式 opt-in：true=由稳定 system 前缀派生；字符串=直接用该键。默认 false（实测默认不带）。 */
  cacheKey?: boolean | string
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
