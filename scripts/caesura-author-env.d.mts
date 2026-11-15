/** scripts/caesura-author-env.mjs 的类型声明（tsc 不核 .mjs；兄弟 .d.mts 供 TS 消费者） */

export interface AuthorLlmEnv {
  apiKey: string
  baseUrl: string
  model: string
}

export const AUTHOR_ENV_KEYS: readonly ['CAESURA_LLM_API_KEY', 'CAESURA_LLM_BASE_URL', 'CAESURA_LLM_MODEL']
export const LLM_DEFAULT_BASE_URL: string
export const LLM_DEFAULT_MODEL: string
export const LLM_DEFAULT_MISSING_KEY: string

export function authorLlmEnv(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): AuthorLlmEnv
export function authorLlmKey(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): string
