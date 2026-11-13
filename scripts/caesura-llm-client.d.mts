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
}
export function buildBibleMessages(opts?: {
  npcMode?: 'canon' | 'short'
  user?: string
  model?: string
  temperature?: number
  maxTokens?: number
}): BibleMessages

export interface LlmCallResult {
  ok: boolean
  status: number
  dt: number
  usage: any
  cachedTokens: number
  text: string
  raw?: string
}
export function callLlm(body: BibleMessages | Record<string, unknown>, opts?: {
  baseUrl?: string
  apiKey?: string
}): Promise<LlmCallResult>
