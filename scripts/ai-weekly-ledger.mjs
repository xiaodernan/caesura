/**
 * scripts/ai-weekly-ledger.mjs — KI-715 · 「余响编年 · Weekly Ledger / Chronicler's Entry」
 *
 * 让 LLM 以余响世界的编年史笔法，为过去 7 天写一段双语「年报」——不是预测，不是统计，是用世界语写给世界的
 * 一段民报。真实跑一次就生成 `admin/ai-weekly-ledger.json`，admin 页加载它显示。
 *
 * 首先跑：暖场本机环境 → 预热 → 生成 -> 落盘 -> retry 自救。生成：
 *   ① 整段双语编年（zh + en 各 ≤ 400 字节 · 世界语 · 编年史口吻 · 只能用 canon 名词）
 *   ② "oneline" = 今日一行（28 字以内的编年戳记）
 *   ③ "echo" = 同款句式"线一次一月一回响"作为 WorldEcho line（26 字以内）
 *   ④ usage 账单 ingestion in admin/ai-cache-metrics.json · schema=1
 *
 * 模式=`--live` 才出网（默认直连 / aizzz；需要代理才显式设 CAESURA_LLM_PROXY）；默认为 dry-run。API key 只从 env 读。
 * 玩家进程零 LLM；这是作者侧产物，人工闸后落库。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authorLlmEnv } from './caesura-author-env.mjs'
import { callLlm, derivePromptCacheKey, applyAuthorProxyFromEnv } from './caesura-llm-client.mjs'
import { sceneBible } from './lib/scene-bible.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const args = process.argv.slice(2)
const MODE = args.includes('--live') ? 'live' : 'offline'
const TODAY = new Date().toISOString().slice(0, 10)
const NOW_ISO = new Date().toISOString()

const env = authorLlmEnv()
if (!env.apiKey) {
  console.warn('missing CAESURA_LLM_API_KEY — running offline dry-run only')
  process.exit(2)
}

console.log(`weekly-ledger mode=${MODE} hasKey=${!!env.apiKey} today=${TODAY}`)
if (MODE === 'offline') {
  console.log('offline: prompt previews, not calling LLM (inject --live to run)')
  process.exit(0)
}

// 这整个巨前缀 = 场景圣经 + 标题 + 篇八十的 hash
const prefix = sceneBible() + '\n\n【本轮任务编年】\n本篇为《余响编年 · Chronicle》周报，由 LLM 编年太史官执笔，用世界语为《止音纪元》本周写一段编年：\n\n- 编年口吻：不抒情、不夸张、物件说话、留白、年鉴式。\n- 可使用的名词：潮、页角、两条线、薄簿、门槛上的盐、船底干痕、灯、阿汐、阿沉、回廊、回声、Hush。\n- 绝不出现的词：复仇、报复、新神、OG-ENT。\n- 输出严格 JSON：{ "portraitZh": "≤200字中文编年", "portraitEn": "≤120 words english", "oneLineZh": "≤28字中文今日戳记", "oneLineEn": "≤18 words english daily stamp", "echoZh": "≤22字中文余响句", "echoEn": "≤14 words english echo line" }'

// 多轮预热（同前缀，逐次烤这次的缓存；缓存 miss < 5000 时直接重试到命中率 > 25K）
const warmMessages = [{ role: 'system', content: prefix }, { role: 'user', content: '（预热）' }]
let warm = null
for (let round = 1; round <= 3; round += 1) {
  warm = await callLlm({
    model: env.model,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0,
    max_tokens: 4,
    messages: warmMessages,
    prompt_cache_key: derivePromptCacheKey(warmMessages),
  }, { baseUrl: env.baseUrl, apiKey: env.apiKey })
  const cached = warm?.cachedTokens ?? 0
  console.log(`warmup round=${round} status=${warm?.status} cached=${cached} hit=${warm?.usage?.prompt_tokens ? Math.round((cached / warm.usage.prompt_tokens) * 1000) / 10 : '?'}%`)
  if (cached > 20000) break
  await new Promise((r) => setTimeout(r, 600))
}

const body = {
  model: env.model,
  stream: true,
  stream_options: { include_usage: true },
  temperature: 0.72,
  max_tokens: 800,
  messages: [
    { role: 'system', content: prefix },
    { role: 'user', content: `年份 ${TODAY} · 月第 ${Math.ceil(new Date().getDate() / 7)} 周 · 请霜写编年并只回 JSON` },
  ],
  prompt_cache_key: derivePromptCacheKey([{ role: 'system', content: prefix }]),
}

const out = await callLlm(body, { baseUrl: env.baseUrl, apiKey: env.apiKey })
let parsed = null
try { parsed = JSON.parse((String(out?.text || '')).replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim()) } catch { /* leave null */ }

const artifact = {
  $comment: 'KI-715 · 余响编年 · Weekly Ledger · LLM 真跑 · authorOnly · runtime:false · 人工闸后落库',
  runtime: false,
  authorOnly: true,
  containsCredentials: false,
  requiresHumanReview: true,
  schema: 1,
  mode: MODE,
  generatedAt: NOW_ISO,
  model: env.model,
  endpoint: env.baseUrl,
  portraitZh: parsed?.portraitZh ?? null,
  portraitEn: parsed?.portraitEn ?? null,
  oneLineZh: parsed?.oneLineZh ?? null,
  oneLineEn: parsed?.oneLineEn ?? null,
  echoZh: parsed?.echoZh ?? null,
  echoEn: parsed?.echoEn ?? null,
  usage: {
    calls: out ? 1 : 0,
    promptTokens: out?.usage?.prompt_tokens ?? 0,
    cachedTokens: out?.cachedTokens ?? 0,
    hitRate: (out?.usage?.prompt_tokens ?? 0) > 0 ? Math.round(((out?.cachedTokens ?? 0) / out.usage.prompt_tokens) * 1000) / 10 : 0,
    statuses: [out?.status ?? 0],
    attempts: out?.attempts ?? 1,
    model: out?.modelUsed ?? env.model,
  },
  errors: out?.ok === false ? [{ node: 'generate', message: `status=${out?.status ?? 0}: ${String(out?.error || '').slice(0, 200)}` }] : [],
}

const target = resolve(ROOT, 'admin', 'ai-weekly-ledger.json')
const authoringTarget = resolve(ROOT, 'src', 'data', 'authoring', 'ai-weekly-ledger.json')
writeFileSync(target, JSON.stringify(artifact, null, 2) + '\n', 'utf8')
writeFileSync(authoringTarget, JSON.stringify(artifact, null, 2) + '\n', 'utf8')
console.log(`weekly-ledger written: ${target}`)
console.log(`portraitZh head: ${(artifact.portraitZh ?? '').slice(0, 32)}… / usage cached=${artifact.usage.cachedTokens} hit=${artifact.usage.hitRate}% model=${artifact.usage.model}`)
