/**
 * scripts/ai-admin-auditor.mjs — KI-636 · admin「先验审计」
 *
 * 让 LLM 对照公开研究先验（Baymard / NN/g / Contentsquare / StatCounter 2026），
 * 逐项裁决「本页模拟队列是否与现实公认区间一致」，并指出可信度、修正方向、什么时候该收集真实遥测替换。
 *
 * 输入 = admin/data.js 的真实 computed 值（我拉取并算出具体数字，绝不让模型自己编）+ 先验；
 * 输出 = src/data/authoring/admin-priors-audit.json（双重拷贝，admin/ 也同步一份供公网读）。
 *
 * 纪律：玩家进程零 LLM；产物 runtime:false；不进任何外部服务；密钥只走 env。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authorLlmEnv } from './caesura-author-env.mjs'
import { callLlm, applyAuthorProxyFromEnv } from './caesura-llm-client.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const args = process.argv.slice(2)
const MODE = args.includes('--live') ? 'live' : 'offline'
const TODAY = new Date().toISOString().slice(0, 10)
const NOW_ISO = new Date().toISOString()

/* ═══════════ 输入（我从 data.js 算真实数字，不让模型编）═══════════ */
const { TELEMETRY: d } = await import('../admin/data.js')

const daily = d.daily
const meanBounce = daily.reduce((n, r) => n + r.bounce, 0) / daily.length
const totalSessions = d.totals.sessions
const funnel = d.funnel.steps
const endingRate = funnel[funnel.length - 1].count / funnel[0].count
const devices = d.devices
const mobileShare = (devices.find((x) => x.id === 'mobile') ?? {}).share ?? 0
const topExit = [...d.pages].sort((a, b) => b.exitShare - a.exitShare)[0]
const topRage = [...d.pages].sort((a, b) => b.rageClicks - a.rageClicks)[0]
const locales = d.locales
const zhShare = (locales.find((l) => l.id === 'zh') ?? {}).share ?? 0
const lateWindow = d.hourly.slice(20).reduce((n, h) => n + h.share, 0) + (d.hourly[0]?.share ?? 0)
const rFunnel = (from, to) => from + ' → ' + to
const fmt = (x) => Number(x).toFixed(3)

console.log('observed computed:')
console.log(`  mean bounce: ${fmt(meanBounce)}`)
console.log(`  ending conversion: ${fmt(endingRate)}`)
console.log(`  mobile share: ${fmt(mobileShare)}`)
console.log(`  zh share: ${fmt(zhShare)}`)
console.log(`  late-window share (20:00–00:00): ${fmt(lateWindow)}`)
console.log(`  top exit page: ${topExit.path} (${(topExit.exitShare*100).toFixed(0)}%)`)
console.log(`  top rage page: ${topRage.path} (×${topRage.rageClicks})`)
const funnelSummary = funnel.map((s) => `${s.labelZh}=${s.count}`).join(' → ')
console.log('funnel:', funnelSummary)

const PRIORS = [
  { label: 'Baymard · 购物车放弃率（50 项研究 2006–2025 · 非加权均值约 70%）', prior: 'Cart abandonment ~70%; ~1/3 of users who add a cart actually buy', band: 'ecommerce / 转化漏斗 · 0.65–0.75 band' },
  { label: 'Nielsen Norman Group · 10 秒法则（首屏约五分之一用户立即离开）', prior: '~20% immediate bounce at first paint', band: 'general web · 首屏 0.15–0.25 band' },
  { label: 'Contentsquare Benchmarks 2026 · 99B sessions / 6500+ sites · Mobile ~60%', prior: 'globally mobile share exceeds desktop', band: 'global web traffic · 2025–2026 band' },
  { label: 'StatCounter · Oct 2026 worldwide · Mobile 60.87% · Desktop 39.13%', prior: 'mobile ≈ 61% · desktop ≈ 39% (worldwide)', band: 'web device share · 2026 benchmark' },
]

const PAYLOAD = [
  '【公开先验（请逐条对齐裁决）】',
  ...PRIORS.map((p, i) => `${i + 1}. ${p.label} — prior: ${p.prior}；band: ${p.band}`),
  '',
  '【本页模拟队列现状——这些数字由 AI 自身计算，不是现实流量】',
  `total_sessions: ${totalSessions}`,
  `mean_bounce: ${fmt(meanBounce)} (range ${fmt(Math.min(...daily.map(d=>d.bounce)))}–${fmt(Math.max(...daily.map(d=>d.bounce)))})`,
  `ending_conversion: ${fmt(endingRate)}`,
  `mobile_share: ${fmt(mobileShare)}`,
  `zh_share: ${fmt(zhShare)}`,
  `late_window_share (20:00–00:00): ${fmt(lateWindow)}`,
  `top_exit: ${topExit.path} × ${topExit.exitShare.toFixed(2)}`,
  `top_rage_click: ${topRage.path} × ${topRage.rageClicks}`,
  `funnel: ${funnelSummary}`,
  '',
  '【任务】逐条裁决上面的先验对照本页模拟队列是否成立（一致 / 偏离 / 无依据）：',
  '- 每条 verdict 给 "plausible" | "strained" | "rejected" 三个等级之一；',
  '- "plausible" = 模拟值落在 prior band 之内或仅轻微偏离；',
  '- "strained" = 模拟值压边或偏离但可解释（如：游戏的玩法固有高完读率、高 bounce 由深度账本/复杂文档导致）；',
  '- "rejected" = 模拟值与 prior 明显冲突、且无法从类型差异解释；',
  '- 整体结论：①是否值得现在就接真实遥测（节奏建议）②如果接了，下一步怎么验证（例如与上述 4 个 prior 同向对齐）；',
  '- 作答务必中文/英文对照，严格 JSON 对象，不要任何额外说明、不要代码块。所有字符串必须可用 JSON.stringify 直接解析——不要裸换行、不要尾逗号、不要注释。',
  '{"verdicts":[{"label":"...","verdict":"plausible|strained|rejected","whyZh":"≤40字","whyEn":"≤25 words"}],"overall":{"verdictZh":"≤50字","verdictEn":"≤25 words","readyZh":"是否该接真实遥测","readyEn":"≤15 words"},"sensitivity":{"zh":"哪条 prior 最敏感","en":"Which prior bites hardest"}}',
].join('\n')

const SYSTEM = [
  '你是《止音纪元》的「先验审计员」。你的任务不是夸奖/批评这份模拟队列，而是用公开研究的锚点核对它。',
  '纪律：不许把“我猜”写成“结论”；不确定就写 "rejected" 或 "strained"。',
  '禁止输出：「我是一个 AI」「作为一个大模型」「我无法判断」——这些不是你这个职位可以用的词。',
  '输出严格的单个 JSON 对象，语言中文/英文对照，不要代码块。',
].join('\n')

async function main() {
  const env = authorLlmEnv()
  if (!env.apiKey) { console.error('missing CAESURA_LLM_API_KEY'); process.exit(2) }
  if (MODE !== 'live') { console.log('offline dry-run — payload prints, no network'); console.log('\n' + PAYLOAD); return }

  await applyAuthorProxyFromEnv()
  const out = await callLlm({
    model: env.model, stream: true, stream_options: { include_usage: true },
    temperature: 0.4, max_tokens: 1400,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: PAYLOAD }],
  }, { baseUrl: env.baseUrl, apiKey: env.apiKey })
  const raw = String(out.text ?? '').replace(/^```(?:json|JSON)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const m = raw.match(/\{[\s\S]*\}/)
  const jsonBody = m ? m[0] : raw
  let parsed = null
  try {
    parsed = JSON.parse(jsonBody)
  } catch (e1) {
    try { parsed = JSON.parse(jsonBody.replace(/,(\s*[\]}])/g, '$1')) } catch (e2) { console.error('parse fail', e2.message, jsonBody.slice(0, 400)); process.exit(2) }
  }
  if (!parsed?.verdicts) { console.error('schema missing verdicts'); process.exit(2) }

  const art = {
    $comment: 'KI-636 · admin「先验审计」· AI priors audit · 作者侧 · runtime:false · 玩家进程零 LLM',
    runtime: false,
    authorOnly: true,
    containsCredentials: false,
    requiresHumanReview: true,
    schema: 1,
    mode: MODE,
    generatedAt: NOW_ISO,
    model: env.model,
    endpoint: env.baseUrl,
    telemetryHead: { totalSessions, meanBounce: fmt(meanBounce), endingConversion: fmt(endingRate), mobileShare: fmt(mobileShare) },
    observed: {
      funnel: d.funnel.steps.map((s) => ({ id: s.id, count: s.count })),
      devices: d.devices.map((x) => ({ id: x.id, share: x.share })),
      locales: d.locales.map((x) => ({ id: x.id, share: x.share })),
      pages: d.pages.length,
      refs: d.meta.refs,
    },
    priors: PRIORS.map((p, i) => ({ index: i + 1, ...p })),
    verdicts: parsed.verdicts,
    overall: parsed.overall ?? null,
    sensitivity: parsed.sensitivity ?? null,
    usage: { cachedTokens: out.cachedTokens ?? 0, statuses: [out.status], calls: 1 },
  }
  const body = JSON.stringify(art, null, 2) + '\n'
  const target1 = resolve(ROOT, 'src/data/authoring/admin-priors-audit.json')
  const target2 = resolve(ROOT, 'admin/admin-priors-audit.json')
  mkdirSync(dirname(target1), { recursive: true })
  writeFileSync(target1, body, 'utf8')
  writeFileSync(target2, body, 'utf8')
  console.log('\nwritten', target1)
  console.log('written', target2)
  console.log('verdicts:', art.verdicts.map((v) => `${v.label.slice(0, 40)} = ${v.verdict}`).join(' | '))
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
