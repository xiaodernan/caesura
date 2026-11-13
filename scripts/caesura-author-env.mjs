/**
 * scripts/caesura-author-env.mjs —— 作者侧 LLM env 唯一入口（KI-538 审计修正）。
 *
 * <p>全仓 `scripts/*.mjs` 禁止写 `envvar-CAESURA_*` 裸访问（KI-441 tripwire，
 * tests/unit/spring-family-table.test.ts）。本文件是读下列三个 env 的**唯一**位置：</p>
 * <ul>
 *   <li>`CAESURA_LLM_API_KEY` —— wkapi.pro / OpenAI-compatible 作者侧密钥（绝不进玩家进程、绝不落 git）;</li>
 *   <li>`CAESURA_LLM_BASE_URL` —— 覆盖默认 `https://wkapi.pro/v1` 的 base URL;</li>
 *   <li>`CAESURA_LLM_MODEL`   —— 覆盖默认 `gpt-6-sol` 的模型名。</li>
 * </ul>
 * <p>读取一份 `env` 对象（缺省 `process.env`，也可传入任意类 process.env 的对象，便于测试）；
 * 缺省回落到与网关（caesura-llm-gateway.mjs）同款默认，禁止把任何引用写进文件系统或落盘。</p>
 *
 * @module caesura-author-env
 */
export const AUTHOR_ENV_KEYS = Object.freeze(['CAESURA_LLM_API_KEY', 'CAESURA_LLM_BASE_URL', 'CAESURA_LLM_MODEL'])
export const LLM_DEFAULT_BASE_URL = 'https://wkapi.pro/v1'
export const LLM_DEFAULT_MODEL = 'gpt-6-sol'
export const LLM_DEFAULT_MISSING_KEY = 'missing CAESURA_LLM_API_KEY（env 注入；绝不落 git）'

/**
 * 作者侧 LLM env —— 返回一次性快照 { apiKey, baseUrl, model }。
 * @param {NodeJS.ProcessEnv | Record<string,string|undefined>} [env]
 */
export function authorLlmEnv(env = process.env) {
  const key = env.CAESURA_LLM_API_KEY ?? ''
  const base = (env.CAESURA_LLM_BASE_URL ?? '').trim() || LLM_DEFAULT_BASE_URL
  const model = (env.CAESURA_LLM_MODEL ?? '').trim() || LLM_DEFAULT_MODEL
  return { apiKey: key, baseUrl: base, model }
}

/** 仅密钥的快捷出口（供 `--live` 类 CLI 预检，避免重复解析整份 env）。 */
export function authorLlmKey(env = process.env) {
  return env.CAESURA_LLM_API_KEY ?? ''
}
