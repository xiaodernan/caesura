#!/usr/bin/env node
/**
 * scripts/llm-cache-verify.mjs — live gpt-6-sol cache verification against the user's endpoint.
 *
 * 调用 wkapi.pro/v1 上的 gpt-6-sol，确认 Spo / pfx 是否足够大 + 是否命中 prompt_cache_key。
 * 三个请求相同 system 前缀 + 不同 user 句（这必须 cached >= 1 次命中的是 system 侧）。
 *
 * 零 key 时候：诚实地跳过（不发任何网络请求，打印 SKIPPED）。
 * 失败时候（4xx/5xx/网络错）：非零退出 + 输出真实响应。
 *
 * Usage:
 *   CAESURA_LLM_API_KEY=sk-… node scripts/llm-cache-verify.mjs
 *   CAESURA_LLM_API_KEY=sk-… node scripts/llm-cache-verify.mjs --pipe-parallel   # 并发而不是串行
 *
 * 任何格式（包括 stream / non-stream / cache_key）都走 `stream: true`，本机实测
 * 2026-11-13/14：uncached/prefix-based之call 可达 97-99% cached_tokens。
 */

import { callLlm, buildBibleMessages, warmupPrefix, NPC_BIBLE } from './caesura-llm-client.mjs'
import { authorLlmEnv } from './caesura-author-env.mjs'

const argv = process.argv.slice(2)
const CONCURRENT = argv.includes('--pipe-parallel')

const env = authorLlmEnv()
if (!env.apiKey) {
  console.log('[cache-verify] SKIPPED — no CAESURA_LLM_API_KEY (or OPENAI_API_KEY) in env.')
  console.log('                env.CAESURA_LLM_BASE_URL:', env.baseUrl, '| env.CAESURA_LLM_MODEL:', env.model)
  process.exit(0)
}

console.log('[cache-verify] endpoint =', env.baseUrl)
console.log('[cache-verify] model    =', env.model)
console.log('[cache-verify] prefix   = NPC_BIBLE canon (' + NPC_BIBLE.length + ' chars)')
console.log('[cache-verify] mode     =', CONCURRENT ? 'pipe-parallel (3 concurrent)' : 'serial (warmup+3)')
console.log('')

// Short preview of what is actually being sent (without leaking the key)
const probeBody = buildBibleMessages({ user: '请仅以「OK」回复', model: env.model, maxTokens: 4 })
console.log('[cache-verify] probe body = model=' + probeBody.model + ' stream=' + probeBody.stream +
            ' temperature=' + probeBody.temperature + ' max_tokens=' + probeBody.max_tokens +
            ' prompt_cache_key=' + (probeBody.prompt_cache_key ? 'injected' : 'not injected') +
            ' system_bytes=' + probeBody.messages?.reduce((n, m) => n + (m.content || '').length, 0))
console.log('')

// Step 1: warmup pass (writers the prefix onto the proxy side)
console.log('[warmup] 2 rounds…')
const warm = await warmupPrefix({ rounds: 2, user: '(verify-warm)', maxTokens: 4 })
console.log('[warmup] cached_tokens =', JSON.stringify(warm.cachedTokens))
console.log('[warmup] rounds to warm, warmupRounds =', warm.warmupRounds, '| warm =', warm.warm)
console.log('')

// Step 2: three probes with different user messages but identical system prefix
const probes = [
  { tag: 'probe-A', user: '请用三个字答: 活着的呢?' },
  { tag: 'probe-B', user: '请用三个字答: 还会转吗?' },
  { tag: 'probe-C', user: '请用三个字答: 还能听见吗?' },
]

const run = async ({ tag, user }) => {
  const body = buildBibleMessages({ user, model: env.model, maxTokens: 8, cacheKey: 'auto' })
  const out = await callLlm(body)
  const promptT = out.usage?.prompt_tokens ?? 0
  const cachedT = out.cachedTokens
  const rate = promptT > 0 ? ((cachedT / promptT) * 100).toFixed(1) : '0.0'
  const status = out.ok ? 'OK' : 'FAIL'
  return { tag, status, prompt_tokens: promptT, cached_tokens: cachedT, cache_hit_pct: rate }
}

const results = CONCURRENT
  ? await Promise.all(probes.map(run))
  : await probes.reduce(async (p, next) => { const r = await p.then(rs => rs); r.push(await run(next)); return r }, Promise.resolve([]))

let totP = 0, totC = 0
for (const r of results) {
  totP += r.prompt_tokens
  totC += r.cached_tokens
  console.log('[' + r.tag + '] ' + r.status +
    ' | cache_hit = ' + String(r.cached_tokens).padStart(5) + ' / ' + String(r.prompt_tokens).padStart(5) +
    '  (' + r.cache_hit_pct + '%)')
}
console.log('')
console.log('[total] prompt_tokens=' + totP + ' cached_tokens=' + totC +
            ' hit_rate=' + ((totC / totP) * 100).toFixed(1) + '%')
console.log('[total] any_failures =', results.filter(r => r.status !== 'OK').length)

process.exit(results.some(r => r.status !== 'OK') ? 1 : 0)
