/**
 * scripts/caesura-author-env.mjs —— 作者侧 LLM env 唯一入口（KI-538 审计修正）。
 *
 * <p>全仓 `scripts/*.mjs` 禁止裸写 <code>env.CAESURA_*</code>（KI-441 的 tripwire：裸写全部 env 读数才算绕开唯一入口），
 * tests/unit/spring-family-table.test.ts）。本文件是读下列三个 env 的**唯一**位置：</p>
 * <ul>
 *   <li>`CAESURA_LLM_API_KEY` —— aizzz（OpenAI-compatible 作者侧 endpoint，经本机 Clash Verge HTTP 代理出网）的作者侧密钥（绝不进玩家进程、绝不落 git）;</li>
 *   <li>`CAESURA_LLM_BASE_URL` —— 覆盖默认 `https://api.aizzz.xyz/v1` 的 base URL（旧 endpoint wkapi.pro/gpt-6-sol 仍可注释回落）;</li>
 *   <li>`CAESURA_LLM_MODEL`   —— 覆盖默认 `gpt-6.2-sol` 的模型名（首选；渠道枯竭时按 `CAESURA_LLM_MODELS` 或内置兜底链顺移）;</li>
 *   <li>`CAESURA_LLM_MODELS`  —— 覆盖整条**有序兜底链**（逗号分隔 · 例如 `gpt-6.2-sol,gpt-6.1-sol`）；未设 ⇒ 首选后接默认链。</li>
 * </ul>
 * <p>出网口径（隐式纪律）：本机 Clash Verge 提供 HTTP 代理 `127.0.0.1:7897`；Node 原生 `fetch` 不认系统代理——让本仓所有作者侧网络请求真跑之前，必须先经 `scripts/caesura-llm-client.mjs` 的 `applyAuthorProxyFromEnv()`（读 `CAESURA_LLM_PROXY` 或 `HTTPS_PROXY`；未显式设置则直连）。绝不内置任何代理主机。</p>
 * <p>读取一份 `env` 对象（缺省 `process.env`，也可传入任意类 process.env 的对象，便于测试）；
 * 缺省回落到与网关（caesura-llm-gateway.mjs）同款默认，禁止把任何引用写进文件系统或落盘。</p>
 *
 * @module caesura-author-env
 */
export const AUTHOR_ENV_KEYS = Object.freeze(['CAESURA_LLM_API_KEY', 'CAESURA_LLM_BASE_URL', 'CAESURA_LLM_MODEL', 'CAESURA_LLM_MODELS'])
export const LLM_DEFAULT_BASE_URL = 'https://api.aizzz.xyz/v1'
export const LLM_DEFAULT_MODEL = 'gpt-6.2-sol'
/** 默认**首选 gpt-6.2-sol**（2026-11-19 用户指定更换为此模型）；首选项 5xx/渠道枯竭时**按序**顺移（2026-11-19 实测：8 挂牌模型逐个 200 OK 可用；gpt-6.1-terra 分组 GPT特价 无可用渠道，移出默认链）。 */
export const LLM_DEFAULT_MODEL_CHAIN = Object.freeze(['gpt-6.2-sol', 'gpt-6.1-sol', 'gpt-6.2-astra', 'gpt-5.6-terra'])
export const LLM_DEFAULT_PROXY = 'http://127.0.0.1:7897'
export const LLM_DEFAULT_MISSING_KEY = 'missing CAESURA_LLM_API_KEY（env 注入；绝不落 git）'

/**
 * 有序模型兜底链（2026-11-19 定案 · aizzz 渠道枯竭事故后）：
 *   优先级 `CAESURA_LLM_MODELS="a,b,c"`（逗号分隔 · 去重 · 去空格）；否则 `CAESURA_LLM_MODEL` / `LLM_MODEL` 作首选，后面依次补默认链；
 *   两者都没配 ⇒ 整条默认链（含首选 terra）。返回值至少含一个非空模型名。
 * 首选永远是用户指定模型——只是渠道枯竭时管线不再冻结，而是如实顺移到下一个可用模型。
 * @param {NodeJS.ProcessEnv | Record<string,string|undefined>} [env]
 * @returns {string[]} 去重后的模型名列表（下标 0 = 首选）
 */
export function resolveModelChain(env = process.env) {
  const raw = String(env?.CAESURA_LLM_MODELS ?? '').trim()
  if (raw) {
    const parts = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))]
    if (parts.length) return parts
  }
  const primary = String(env?.CAESURA_LLM_MODEL ?? env?.LLM_MODEL ?? '').trim()
  if (primary) return [primary, ...LLM_DEFAULT_MODEL_CHAIN.filter((m) => m !== primary)]
  return [...LLM_DEFAULT_MODEL_CHAIN]
}

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
  const modelChain = resolveModelChain(env)
  return { apiKey: key, baseUrl: base, model, modelChain }
}

/** 仅密钥的快捷出口（供 `--live` 类 CLI 预检，避免重复解析整份 env）。 */
export function authorLlmKey(env = process.env) {
  return env.CAESURA_LLM_API_KEY ?? env.LLM_API_KEY ?? ''
}
