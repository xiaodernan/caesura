/**
 * scripts/ai-trend-forecast.mjs — KI-645 · admin 的「LLM 趋势研判 · Forecast」
 *
 * 让 LLM 读**当前遥测快照**（admin/data.js 的活数据 + admin/analytics.mjs 的 forecast()）——
 * 这一次不是估算先验（KI-636 干那件事），而是给出「下一段时间该动哪一步」的研判意见：
 *   ① 走势概要 zh+en；② 最危险的人群 cohort；③ 恰好 4 条按优先级排序的行动
 *     （action / rationale / impact / effort / metric / risk，双语）；
 *   ④ 灵敏度：哪个假设崩了最伤。
 *
 * 模式 = `--live` 才真正出网（默认直连 / aizzz gpt-6.2-sol；需要代理才显式设 CAESURA_LLM_PROXY）
 *       = 默认 dry-run（只打印 payload，不出网）。API key 只从 env（authoring）拿，绝不入库。
 * 用的是**本地 forecast() 的数据事实**，不是让 LLM 估数——LLM 只负责裁决结构，数字不变。
 * 玩家进程零 LLM；这是 admin 的可选面板，人工闸后入库。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authorLlmEnv } from './caesura-author-env.mjs'
import { callLlm, applyAuthorProxyFromEnv } from './caesura-llm-client.mjs'
import { forecast } from '../admin/analytics.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const args = process.argv.slice(2)
const MODE = args.includes('--live') ? 'live' : 'offline'
const TODAY = new Date().toISOString().slice(0, 10)
const NOW_ISO = new Date().toISOString()

const { TELEMETRY: d } = await import('../admin/data.js')
const daily = d.daily
const sessions = daily.map((x) => x.sessions)
const views = daily.map((x) => x.pageViews)
const bounces = daily.map((x) => x.bounce)
const fS = forecast(sessions)
const fV = forecast(views)
const fB = forecast(bounces)
const totalSessions = d.totals.sessions
const meanBounce = daily.reduce((n, r) => n + r.bounce, 0) / daily.length
const funnel = d.funnel.steps
const endingRate = funnel[funnel.length - 1].count / funnel[0].count
const topExit = [...d.pages].sort((a, b) => b.exitShare - a.exitShare)[0]
const topRage = [...d.pages].sort((a, b) => b.rageClicks - a.rageClicks)[0]
// KI-734：愤怒点击页的**访问量**：此前 payload 只发 rageClicks，LLM 因此幻觉「无访问量、不能算点击率」。
// admin/data.js 的 pages[] 本就带 views；此处现算 rate 一并喂给裁决层（可审计、非估算）。
const topRageViews = Number(topRage?.views ?? 0)
const topRageRate = topRageViews > 0 ? topRage.rageClicks / topRageViews : null
const mobileShare = (d.devices.find((x) => x.id === 'mobile') ?? { share: 0 }).share
const zhShare = (d.locales.find((x) => x.id === 'zh') ?? { share: 0 }).share
const lateWindow = d.hourly.slice(20).reduce((n, h) => n + h.share, 0) + (d.hourly[0]?.share ?? 0)
const fmt = (x) => Number(x).toFixed(3)
const funnelSummary = funnel.map((s) => `${s.labelZh}=${s.count}`).join(' → ')

console.log('observed computed (offline):')
console.log(`  sessions ↓ last 7d forecast: ${fS.points.join(' / ')} (slope=${fmt(fS.slope)} · r²=${fmt(fS.r2)})`)
console.log(`  pageViews ↓ last 7d forecast: ${fV.points.join(' / ')} (slope=${fmt(fV.slope)} · r²=${fmt(fV.r2)})`)
console.log(`  bounce ↓ last 7d forecast: ${fB.points.map((x) => x.toFixed(1) + '%').join(' / ')} (slope=${fmt(fB.slope)})`)
console.log(`  ending conversion: ${fmt(endingRate)}`)
console.log(`  mean bounce: ${fmt(meanBounce)}`)
console.log(`  mobile share: ${fmt(mobileShare)}`)
console.log(`  zh share: ${fmt(zhShare)}`)
console.log(`  late window (20:00–00:00): ${fmt(lateWindow)}`)
const payload = [
  '你是止音纪元的"运营增长"导演，读过本页全部遥测——本页数据是基于公开基准的模拟实采（Baymard 放弃率先验 / NNG 10 秒滞留先验 / StatCounter 2026 移动端占比 / Contentsquare 2025 基准），不是编造。',
  '根据下面" observed computed"定量成分，给出研判——不写感想、不写鸡汤，只给出有依据的行动：',
  '',
  `total_sessions: ${totalSessions}`,
  `mean_bounce: ${fmt(meanBounce)}`,
  `ending_conversion: ${fmt(endingRate)}`,
  `mobile_share: ${fmt(mobileShare)}`,
  `zh_share: ${fmt(zhShare)}`,
  `late_window_share (20:00–00:00): ${fmt(lateWindow)}`,
  `top_exit: ${topExit.path} · ${fmt(topExit.exitShare)}`,
  `top_rage_click: ${topRage.path} · ${topRage.rageClicks} clicks / ${topRageViews} views · rate=${topRageRate === null ? 'n/a' : fmt(topRageRate)} (${topRageRate === null ? 'no views' : (topRageRate * 100).toFixed(1) + '%'})`,
  `funnel: ${funnelSummary}`,
  `sessions forecast slope=${fmt(fS.slope)} · r²=${fmt(fS.r2)} · next-7 ${fS.points.join(',')}`,
  `pageViews forecast slope=${fmt(fV.slope)} · r²=${fmt(fV.r2)}`,
  `bounce forecast slope=${fmt(fB.slope)} · last-7d trend ${fB.points.map((x) => x.toFixed(1) + '%').join(', ')}`,
  '',
  '【工程健康 · 现场真实数据（非估算）】',
  (() => {
    const lines = []
    try {
      const h = JSON.parse(readFileSync(resolve(ROOT, 'admin/stress-fanout-latest.json'), 'utf8'))
      lines.push(`stress_fanout: ${h.requests} requests / ${h.distinct} endpoints / failures=${h.failures} / p95=${h.p95}ms / p99=${h.p99}ms / ${(h.totalBytes / 1048576).toFixed(1)}MB`)
    } catch { lines.push('stress_fanout: (no baseline)') }
    try {
      const a = JSON.parse(readFileSync(resolve(ROOT, 'admin/ai-director-latest.json'), 'utf8'))
      const pg = a.proposalGuard, ef = a.editorialFeedbackIn
      lines.push(`self_improve: canon flag roster ${pg?.existingCount ?? 0} · historical conflicts ${pg?.conflictFlags?.length ?? 0} · round conflicts ${pg?.warnings?.length ?? 0} · editorial feedback verdict ${ef?.verdict ?? 'n/a'} · this-round gate ${a.editorialGate?.verdict ?? 'n/a'}`)
    } catch { lines.push('self_improve: (no data)') }
    try {
      const c = JSON.parse(readFileSync(resolve(ROOT, 'admin/ai-cache-metrics.json'), 'utf8'))
      const last = (c.entries ?? []).slice(-1)[0] ?? {}
      lines.push(`llm_cache: steady_hit=${last.steadyStateHitRate ?? '?'}% · mean_hit=${last.meanHitRate ?? '?'}% · last_model=${last.model ?? '?'}`)
    } catch { lines.push('llm_cache: (no data)') }
    return lines.join('\n')
  })(),
  '',
  '必须输出合法 JSON，字段严格如下（不许多键，不许少键）：',
  '{"summary":{"zh":"≤60 字，客观描述趋势","en":"≤30 words"},',
  ' "riskiestCohort":{"zh":"≤40 字，点名最危险的一批人，必须落到一个具体的 funnel 步/指标","en":"≤25 words","cohort":"landing-bounce | mobile-late | ending-gap | rage-floor | d1-churn"},',
  ' "actions":[{"seq":1,"actionZh":"≤38 字，可执行的一句命令","actionEn":"≤24 words","rationaleZh":"≤55 字，引用上面哪个数","rationaleEn":"≤32 words","impact":"high|medium|low","effort":"S|M|L","metric":"哪个 funnel 步/指标，例如 "「着陆→开搞」转化率" ","riskZh":"≤30 字","riskEn":"≤22 words"}],',
  ' "sensitivity":{"zh":"≤45 字：上面哪个数变动最敏感（你赌哪一个崩了最伤）","en":"≤22 words"}}',
  '',
  '约束：',
  '- actions 必须有且仅有 4 条，seq 从 1 到 4，按优先级排序；',
  '- 每条 action 必须能直接挂进《止音纪元》的 backlog，不能是空话（不许写 "优化体验" "加强引导" 这类无法验收的命名）；',
  '- 每条 action 可以针对「运营增长」或「工程健康」（压测/自我改进/缓存），但必须引用上面的具体数字（含工程健康字段）；',
  '- 任何 verdict 不得以"因为 LLM 是这样说的"为由——必须引用上面的数字；',
  '- 中文 zh 全部用中文，不允许夹带英文字母（metric 那格可以有指标名缩写如 "landing→press" 这种）；',
  '- EN 字段全部用英文，不允许夹中文；',
  '- 不要跨篇 markdown 输出，直接返回 JSON 文本。',
].join('\n')

const SYSTEM = [
  '你是止音纪元的「运营增长 / Growth」导演——一个不可信任的单纯"满分厨师"：',
  '你只信数据、只信数字、只汇报能验收的事； 如果发现遥测互相矛盾，直接说出矛盾在哪里（例如 daily bounce 下行但 exitShare 上行：在页面下线了才有可能）；',
  '你不许编数字，也不许"算不出"——任何算不出的予以显式标出，交给人来核；',
  '你看守的是止音纪元的公开页（静态站）＋ 游戏入口——每次推送全公网可镜像，出问题迭代必须快；',
  '你给出建议时必须给出验收标准：成功是"哪一个数字从 X 变到 Y"。',
  '只输出 JSON；双语并行；不奉承用户、不装大海、不写口号。',
  'top_rage_click 已同时给出 clicks / views / rate——若 views 有值就必须据此算点击率，绝不许声称"无访问量/不能算点击率"；只有 views=0 或 rate=n/a 时才可说无数据。',
].join('\n')

async function main() {
  const env = authorLlmEnv()
  if (!env.apiKey) { console.error('missing CAESURA_LLM_API_KEY'); process.exit(2) }
  if (MODE !== 'live') { console.log('\noffline dry-run — payload follows (no network):\n\n' + payload); return }

  await applyAuthorProxyFromEnv()
  const out = await callLlm({
    model: env.model, stream: true, stream_options: { include_usage: true },
    temperature: 0.32, max_tokens: 1600,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: payload }],
  }, { baseUrl: env.baseUrl, apiKey: env.apiKey })
  const raw = String(out.text ?? '').replace(/^```(?:json|JSON)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const m = raw.match(/\{[\s\S]*\}/)
  const jsonBody = m ? m[0] : raw
  let parsed = null
  try {
    parsed = JSON.parse(jsonBody)
  } catch (e1) {
    try { parsed = JSON.parse(jsonBody.replace(/,(\s*[\]}])/g, '$1')) } catch (e2) { console.error('parse fail', e2.message, jsonBody.slice(0, 500)); process.exit(2) }
  }
  if (!Array.isArray(parsed?.actions) || parsed.actions.length !== 4) {
    console.error('schema fail: actions must be exactly 4, got', Array.isArray(parsed?.actions) ? parsed.actions.length : 'not-array')
    process.exit(2)
  }
  for (const [i, a] of parsed.actions.entries()) {
    if (a.impact !== 'high' && a.impact !== 'medium' && a.impact !== 'low') { console.error('action', i + 1, 'impact out of enum:', a.impact); process.exit(2) }
    if (a.effort !== 'S' && a.effort !== 'M' && a.effort !== 'L') { console.error('action', i + 1, 'effort out of enum:', a.effort); process.exit(2) }
    if (a.seq !== i + 1) { console.error('action', i + 1, 'seq mismatch:', a.seq); process.exit(2) }
  }

  const art = {
    $comment: 'KI-645 · admin 趋势研判 · LLM 裁决。authorOnly · runtime:false · 玩家进程零接触 · 人工闸后登账',
    runtime: false,
    authorOnly: true,
    containsCredentials: false,
    requiresHumanReview: true,
    schema: 1,
    mode: MODE,
    generatedAt: NOW_ISO,
    model: env.model,
    endpoint: env.baseUrl,
    telemetryHead: { totalSessions, meanBounce: fmt(meanBounce), endingConversion: fmt(endingRate), mobileShare: fmt(mobileShare), zhShare: fmt(zhShare), lateWindowShare: fmt(lateWindow) },
    forecast: {
      sessions: { points: fS.points, slope: Number(fmt(fS.slope)), r2: Number(fmt(fS.r2)) },
      pageViews: { points: fV.points, slope: Number(fmt(fV.slope)), r2: Number(fmt(fV.r2)) },
      bounce: { points: fB.points, slope: Number(fmt(fB.slope)), r2: Number(fmt(fB.r2)) },
    },
    observed: {
      funnel: funnel.map((s) => ({ id: s.id, count: s.count })),
      devices: d.devices.map((x) => ({ id: x.id, share: x.share })),
      locales: d.locales.map((x) => ({ id: x.id, share: x.share })),
      pages: d.pages.length,
      /** KI-734 · 愤怒点击热点页连访问量一起留证，杜绝「无访问量」幻觉 */
      topRage: { path: topRage.path, labelZh: topRage.labelZh ?? null, rageClicks: topRage.rageClicks, views: topRageViews, rate: topRageRate === null ? null : Number(fmt(topRageRate)) },
      refs: d.meta.refs,
    },
    /** KI-732 · 喂给 LLM 的工程健康真实数据快照（可审计，非模型估算） */
    engineeringHealth: (() => {
      const o = {}
      try { const h = JSON.parse(readFileSync(resolve(ROOT, 'admin/stress-fanout-latest.json'), 'utf8')); o.stressFanout = { requests: h.requests, endpoints: h.distinct, failures: h.failures, p95: h.p95, p99: h.p99, mb: Number(((h.totalBytes / 1048576).toFixed(1))) } } catch { /* none */ }
      try { const a = JSON.parse(readFileSync(resolve(ROOT, 'admin/ai-director-latest.json'), 'utf8')); o.selfImprove = { roster: a.proposalGuard?.existingCount ?? 0, roundConflicts: a.proposalGuard?.warnings?.length ?? 0, editorialVerdict: a.editorialFeedbackIn?.verdict ?? null, gateVerdict: a.editorialGate?.verdict ?? null } } catch { /* none */ }
      try { const c = JSON.parse(readFileSync(resolve(ROOT, 'admin/ai-cache-metrics.json'), 'utf8')); const last = (c.entries ?? []).slice(-1)[0] ?? {}; o.llmCache = { steadyHit: last.steadyStateHitRate ?? null, meanHit: last.meanHitRate ?? null, model: last.model ?? null } } catch { /* none */ }
      return o
    })(),
    summary: parsed.summary,
    riskiestCohort: parsed.riskiestCohort,
  actions: parsed.actions,
  sensitivity: parsed.sensitivity ?? null,
  /** KI-734 · 已落地闭环账本：LLM 每次重生成会改写 4 条 actions，落地证据不能随之被抹掉。
   *  从上一版产物继承（按 ki 去重幂等），与 action 序号解耦——"这条建议已变成代码"是历史事实，不是本轮裁决。 */
  landedHistory: (() => {
    const carried = []
    const target = resolve(ROOT, 'admin/admin-trend-forecast.json')
    let prev = null
    try { prev = JSON.parse(readFileSync(target, 'utf8')) } catch { /* first run */ }
    for (const rec of [
      ...(prev?.landedHistory ?? []),
      ...((prev?.actions ?? []).filter((a) => a?.landed).map((a) => ({ ...a.landed, _fromAction: a.seq }))),
    ]) {
      if (rec?.ki && !carried.some((x) => x.ki === rec.ki)) carried.push(rec)
    }
    return carried
  })(),
  usage: { cachedTokens: out.cachedTokens ?? 0, statuses: [out.status], calls: 1 },
  }
  const body = JSON.stringify(art, null, 2) + '\n'
  const target1 = resolve(ROOT, 'src/data/authoring/admin-trend-forecast.json')
  const target2 = resolve(ROOT, 'admin/admin-trend-forecast.json')
  const target3 = resolve(ROOT, `docs/ai-director/ADMIN-TREND-FORECAST-${TODAY}.md`)
  mkdirSync(dirname(target1), { recursive: true })
  mkdirSync(dirname(target3), { recursive: true })
  writeFileSync(target1, body, 'utf8')
  writeFileSync(target2, body, 'utf8')
  writeFileSync(target3,
    `# admin 趋势研判 · ${TODAY}\n\n` +
    `> Generated by ai-trend-forecast.mjs · ${NOW_ISO} · model ${env.model} · statuses=[${out.status}] · cached_tokens=${out.cachedTokens ?? 0}\n\n` +
    `## 概要 Summary\n\n${art.summary?.zh ?? ''}\n\n${art.summary?.en ?? ''}\n\n` +
    `## 最危险的一批 Riskiest cohort\n\n${art.riskiestCohort?.zh ?? ''}\n\n${art.riskiestCohort?.en ?? ''}\n\n` +
    `## 四条行动 Actions\n\n` +
    (art.actions ?? []).map((a) =>
      `### ${a.seq}. ${a.actionZh}\n${a.actionEn}\n\n- rationale: ${a.rationaleZh} / ${a.rationaleEn}\n- impact: ${a.impact} · effort: ${a.effort} · metric: ${a.metric}\n- risk: ${a.riskZh} / ${a.riskEn}\n`
    ).join('\n') + `\n## 灵敏度 Sensitivity\n\n${art.sensitivity?.zh ?? ''}\n\n${art.sensitivity?.en ?? ''}\n`, 'utf8')
  console.log('\nwritten', target1)
  console.log('written', target2)
  console.log('written', target3)
  console.log('actions:', (art.actions ?? []).map((a) => `#${a.seq} [${a.impact}/${a.effort}] ${a.actionZh}`).join(' | '))
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
