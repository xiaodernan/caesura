/**
 * scripts/caesura-author-env.mjs —— 作者侧 LLM env 唯一入口（KI-538 审计修正）。
 *
 * <p>全仓 `scripts/*.mjs` 禁止裸写 <code>env.CAESURA_*</code>（KI-441 的 tripwire：裸写全部 env 读数才算绕开唯一入口），
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
  // KI-587（2026-11-15 落）：`.env` 曾长期写的是 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL（旧名），
  // 而本入口自始只读 CAESURA_* —— 直接 `npm run llm:warmup` 静默走空 key 失败，
  // 现象与「wkapi 不能调通 / 一直空命中」完全一致。本处兼容一档旧名回落：
  // 读数与优先级：CAESURA_* > LLM_* > 默认；玩家进程不消费本文件。
  const key = env.CAESURA_LLM_API_KEY ?? env.LLM_API_KEY ?? ''
  const base = (env.CAESURA_LLM_BASE_URL ?? env.LLM_BASE_URL ?? '').trim() || LLM_DEFAULT_BASE_URL
  const model = (env.CAESURA_LLM_MODEL ?? env.LLM_MODEL ?? '').trim() || LLM_DEFAULT_MODEL
  return { apiKey: key, baseUrl: base, model }
}

/** 仅密钥的快捷出口（供 `--live` 类 CLI 预检，避免重复解析整份 env）。 */
export function authorLlmKey(env = process.env) {
  return env.CAESURA_LLM_API_KEY ?? env.LLM_API_KEY ?? ''
}
