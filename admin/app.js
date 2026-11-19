/**
 * admin/app.js — 止音后台 · 用户观察站（KI-583）
 * 零依赖 · 静态托管 · 密码 123（礼貌的门，不是安全边界）
 * 聚合数据 = 模拟队列（admin/data.js，固定种子可复算）；本机实况 = localStorage 真实事件。
 */
import { TELEMETRY } from './data.js'
import {
  mean, movingAverage, linearRegression, forecast, anomalies, funnelRates,
  deriveRecommendations, pct, num, dur,
} from './analytics.mjs'

const SVGNS = 'http://www.w3.org/2000/svg'
const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]
// zh-TW: simplified source is converted at runtime by /caesura/zh-tw-converter.js (loaded via defer)
const tw = (s) => (window.__caesuraZhTW && typeof window.__caesuraZhTW.toTraditional === 'function' ? window.__caesuraZhTW.toTraditional(s) : s)
const T = (zh, en) => (LANG === 'en' ? en : (LANG === 'zh-TW' ? tw(zh) : zh))

/* ─────────── 语言 ─────────── */
let LANG = 'zh'
try {
  const saved = localStorage.getItem('caesura-lang')
  if (saved === 'en' || saved === 'zh-TW') LANG = saved
} catch { /* 默认中文 */ }

const STRINGS = {
  'brand.h1': { zh: '止音后台 · 用户观察站', en: 'The Observatory · User Deck' },
  'gate.kicker': { zh: 'CAESURA / 用户观察站', en: 'CAESURA / USER OBSERVATORY' },
  'gate.title': { zh: '止音后台 · 门', en: 'The Observatory · Door' },
  'gate.hint': { zh: '输入口令 123 即可进入。所有人都能进——这是一道礼貌的门，不是保险箱；里面只有数据与解读。', en: 'Enter the passphrase 123. Everyone can — a courtesy door, not a vault; inside is only data and reading.' },
  'gate.enter': { zh: '入内', en: 'Enter' },
  'gate.error': { zh: '不对。口令是 123 —— 人人可知。', en: 'No. The passphrase is 123 — public by design.' },
  'gate.foot': { zh: '客户端门只阻止误入，不保护任何数据；静态托管上连入口都是公开的。这页没有秘密。', en: 'The client gate keeps honest mistakes out only — it protects nothing. On static hosting the door is public too. Nothing here is secret.' },
  'topbar.clock': { zh: '本地时间', en: 'Local time' },
  'topbar.static': { zh: '静态 · 种子数据', en: 'static · seeded' },
  'topbar.back': { zh: '返回游戏', en: 'Back to game' },
  'trend.h2': { zh: '日活 · 30 天 + 线性外推', en: 'Daily sessions · 30d + projection' },
  'trend.hint': { zh: '实线＝真实（模拟）日会话 · 虚线＝7 日均线 · 酒红＝未来 7 日朴素外推', en: 'jade = actual · dashed gold = MA7 · wine dash = naive 7d projection' },
  'funnel.h2': { zh: '转化漏斗 · 抵达 → 结局', en: 'Conversion funnel · land → ending' },
  'funnel.hint': { zh: '每步相对上一步的转化；最右＝整体完读率', en: 'Each step vs. previous; rightmost = overall clear rate' },
  'channels.h2': { zh: '渠道 × 会话 × 完读率', en: 'Channels × sessions × clear rate' },
  'channels.hint': { zh: '宽度＝会话份额，右列＝抵达结局率', en: 'bar width = session share · right = ending rate' },
  'devices.h2': { zh: '设备 & 语言', en: 'Devices & locales' },
  'devices.hint': { zh: 'StatCounter 2025：移动端 ≈ 62%（本页模拟 58%）', en: 'StatCounter 2025: mobile ≈ 62% (this deck simulates 58%)' },
  'hours.h2': { zh: '24 小时分布 · 深夜钟鸣窗口', en: '24h distribution · the night-bell window' },
  'hours.hint': { zh: '金框＝20:00–00:00；CN 玩家集中的四辰', en: 'gold bars = 20:00–00:00 — the four struck hours' },
  'cohort.h2': { zh: '周队列留存 · 谁还在回来', en: 'Weekly cohort retention · who comes back' },
  'cohort.hint': { zh: '行＝入坑周 · 列＝第 N 日留存 · 空＝尚未到期', en: 'rows = entry week · cols = day-N · empty = not due yet' },
  'anom.h2': { zh: '异常日 · |z| ≥ 1.8', en: 'Anomalous days · |z| ≥ 1.8' },
  'anom.hint': { zh: '基于 30 天会话数的整体 z 分数', en: 'z-score over the 30-day session series' },
  'anom.note': { zh: '判读：连续两个高于 +2σ 才考虑扩容与限流；单日尖刺大概率是周末与首屏曝光。', en: 'Reading: sustained 2σ+ beats are what justify capacity/rate-limit work; a lone spike is usually a weekend and first-screen exposure.' },
  'exits.h2': { zh: '退出点 & Rage-click 热点', en: 'Exits & rage-click hotspots' },
  'exits.hint': { zh: '玩家在哪里离开，在哪里连点不存在的按钮', en: 'Where players leave · where they tap buttons that don’t exist' },
  'exits.h3a': { zh: '退出率 Top', en: 'Top exits' },
  'exits.h3b': { zh: 'Rage-click Top', en: 'Top rage-clicks' },
  'recs.h2': { zh: '智能优化建议 · 按当前数据现场推导', en: 'Optimization moves · derived live from the data' },
  'recs.note': { zh: '规则即策略：每条建议都携带它被触发的指标、阈值与当前值；改了数据，建议会跟着变。不给没被数据点名的行动。', en: 'Rules are the strategy: each move carries its metric, threshold and current value. Change the data, the moves change. Nothing here acts without the data naming it.' },
  'live.h2': { zh: '本机实况 · 你这台浏览器真实发生的一切', en: 'Live · what actually happened on this browser' },
  'live.h3': { zh: '最近 12 条事件', en: 'Last 12 events' },
  'live.clear': { zh: '清空本机记录', en: 'Clear local records' },
  'live.export': { zh: '导出本机 JSON', en: 'Export local JSON' },
  'export.csv': { zh: '导出日数据 CSV', en: 'Export daily CSV' },
  'export.json': { zh: '导出全部 JSON', en: 'Export full JSON' },
  'export.ai': { zh: '导出 AI 诊断备忘', en: 'Export AI diagnosis memo' },
  'export.digest': { zh: '复制运营日报', en: 'Copy ops digest' },
  'method.h2': { zh: '方法论 · 这页数的家底', en: 'Methodology · where these numbers come from' },
  'method.fine2': { zh: '玩家进程零 LLM · 零网络请求；本后台同上。真实用户流量接入 Spring report（@8082）后，可整体替换数据源而不动本页分析逻辑。', en: 'The game process has zero LLM calls and zero network; this deck is the same. Once real telemetry is wired through the Spring report service (@8082), the data source can be swapped wholesale without touching the analysis here.' },
  'method.fine3': { zh: '刻意公开的门禁 · 密码 123 · KI-583。', en: 'The door is public on purpose · passphrase 123 · KI-583.' },
  'ai.cache': { zh: 'LLM 缓存命中（rolling 80 · 每次运行逐条记账）', en: 'LLM cache hits (rolling 80 · per-call ledger)' },
  'ai.h2': { zh: 'AI 导演 · 真·LLM 诊断', en: 'AI Director · real-LLM diagnosis' },
  'ai.hint': { zh: '深度嵌入：左＝最近一次真机运行（随仓库镜像）｜右＝自带 Key 现场诊断', en: 'Embedded deep: left = latest on-machine run (mirrored with the repo) · right = bring-your-own-key live diagnosis' },
  'ai.c.h3': { zh: '最近一次真机运行 · 止音纪元', en: 'Latest on-machine run · Epoch of Hush' },
  'ai.consistency': { zh: '一致性 / 100', en: 'Consistency / 100' },
  'ai.risks.h4': { zh: '风险 · LLM 点名', en: 'Risks · named by the LLM' },
  'ai.gaps.h4': { zh: '缺口', en: 'Gaps' },
  'ai.transitions.h4': { zh: '世界状态流转提案 · from → to（人工闸后落库）', en: 'World state transitions · from → to (human gate first)' },
  'ai.draft.h4': { zh: '第十七篇游记 · 草稿（人工闸，不落库）', en: 'Travelogue No.17 · draft (human gate; not committed)' },
  'ai.offline': { zh: '离线 dry-run 产物——跑 npm run ai:director:live 生成真机版本。', en: 'Offline dry-run artifact — run npm run ai:director:live to produce the real one.' },
  'ai.l.h3': { zh: '自带 Key · 现场诊断', en: 'Bring your own key · live' },
  'ai.l.note': { zh: 'Key 只存你这台浏览器的 sessionStorage，不落盘、不上报、不进任何仓库；网关 CORS 已实测开放。连得上与否取决于你的网络路径（本机 Clash：让浏览器走系统代理/TUN；海外直连；否则本机 npm run ai:director:live）。每次调用消耗的是你自己网关上的 token。', en: 'Your key lives only in this browser’s sessionStorage — never on disk, never reported, never in any repo; the gateway’s CORS is open (verified). Reachability depends on your network path (local Clash: browser must use the system proxy/TUN; overseas: direct; otherwise use npm run ai:director:live locally). Calls spend your gateway’s tokens.' },
  'ai.l.base': { zh: 'Base URL（OpenAI 兼容）', en: 'Base URL (OpenAI-compatible)' },
  'ai.l.model': { zh: '模型', en: 'Model' },
  'ai.l.key': { zh: 'API Key', en: 'API Key' },
  'ai.l.run': { zh: '真跑诊断 →', en: 'Run live diagnosis →' },
  'ai.l.fine': { zh: '发送内容＝本页聚合数据的 ≤800 字摘要（不含任何个人信息）；模型回复原样呈现。', en: 'What is sent = a ≤800-char digest of this page’s aggregate data (no personal information). The model’s reply is shown verbatim.' },
  'ai.l.result': { zh: '模型现场答复', en: 'The model’s live reply' },
  'ai.live': { zh: '实时', en: 'LIVE' },
  'priors.h2': { zh: '先验审计 · Priors Audit', en: 'Priors Audit · the LLM’s second-guess' },
  'priors.hint': { zh: 'LLM 对照 4 条公开研究先验逐项裁决本页模拟队列 · canon 对账的同形门', en: 'LLM verdicts against 4 public priors — canon-gate’s sibling door' },
  'priors.sensitivity.h3': { zh: '最敏感的先验', en: 'Most sensitive prior' },
  'priors.ready.h3': { zh: '接真机建议', en: 'Ready to wire live telemetry?' },
  'priors.calls': { zh: 'calls', en: 'calls' },
  'priors.cached': { zh: 'cached_tokens', en: 'cached_tokens' },
  'priors.date': { zh: 'audited', en: 'audited' },
  'priors.note': { zh: 'authorOnly · runtime:false · LLM 裁决 · 人工闸后方可落库', en: 'authorOnly · runtime:false · LLM-authored · human gate required' },
  'forecast.h2': { zh: '趋势研判 · Forecast', en: 'Trend Forecast · what to move next' },
  'forecast.hint': { zh: 'LLM 读遥测快照（30 天 DAU / 漏斗 / 移动端占比），给出按优先级排序的 4 条可验收行动', en: 'LLM reads the telemetry snapshot (30-day sessions / funnel / mobile share) and emits 4 prioritised, acceptance-ready actions' },
  'forecast.summary.h3': { zh: '走势概要', en: 'Summary' },
  'forecast.cohort.h3': { zh: '最危险的人群', en: 'Riskiest cohort' },
  'forecast.actions.h3': { zh: '四条行动 · 按优先级', en: 'Four actions, in order' },
  'forecast.sensitivity.h3': { zh: '最敏感的假设', en: 'Most sensitive assumption' },
  'forecast.calls': { zh: 'calls', en: 'calls' },
  'forecast.cached': { zh: 'cached_tokens', en: 'cached_tokens' },
  'forecast.date': { zh: 'forecasted', en: 'forecasted' },
  'forecast.note': { zh: 'authorOnly · runtime:false · LLM 裁决 · 人工闸后方可落库', en: 'authorOnly · runtime:false · LLM-authored · human gate required' },
  'sg.h2': { zh: '状态图检查站 · StateGraph 实跑', en: 'StateGraph checkpoints · the real run' },
  'sg.hint': { zh: 'AI 导演引擎的真实运行轨迹——八节点（含 canon 编辑闸门）· 四个 LLM 边共享同一 system 前缀 · 产物过人工闸', en: 'The real trajectory of the AI Director engine — eight nodes (incl. the canon editorial gate) · four LLM edges sharing one system prefix · artifacts pass the human gate' },
  'build.h2': { zh: '研发状态 · Build Observatory', en: 'Build Observatory · the repo’s vital signs' },
  'build.hint': { zh: '仓库工程体征——site-latest.json + GitHub Actions API（公网 · 只读 · 无凭证）', en: 'The repo’s vital signs — site-latest.json + GitHub Actions API (public, read-only, no credentials)' },
  'build.state.h3': { zh: '主分支现状', en: 'Master, right now' },
  'build.ki': { zh: 'KI 完成度', en: 'KI implemented' },
  'build.sys': { zh: 'SYS 实现进度', en: 'SYS implemented' },
  'build.scripts': { zh: 'scripts · devDeps · ARCH', en: 'scripts · devDeps · ARCH' },
  'build.updated': { zh: 'site-latest 更新于', en: 'site-latest updated' },
  'build.runs.h3': { zh: '最近 CI（主分支）', en: 'Recent CI (master)' },
  'build.note': { zh: '凡绿过之处即此页展示之处；每一次推送都在跑。', en: 'What is green here actually ran — every push keeps it that way.' },
  'build.err': { zh: '读不到公网 CI 状态（网络 / rate-limit）——上面现状仍然有效。', en: 'Could not reach the public CI feed (network / rate-limit) — the snapshot on the left still holds.' },
}

function applyI18n() {
  const tw = (LANG === 'zh-TW' && window.__caesuraZhTW && typeof window.__caesuraZhTW.toTraditional === 'function') ? window.__caesuraZhTW.toTraditional : (s) => s;
  const sourceKey = (LANG === 'zh-TW' ? 'zh' : LANG);
  for (const el of $$('[data-i18n]')) {
    const v = STRINGS[el.dataset.i18n]
    if (v) el.textContent = tw(v[sourceKey] || v.zh || v.en)
  }
  document.documentElement.dataset.lang = LANG
  document.documentElement.lang = LANG === 'en' ? 'en-US' : (LANG === 'zh-TW' ? 'zh-TW' : 'zh-CN')
  // 非 data-i18n 的内联节点：整份委托给 zh-tw-converter（apply/restore 成对）
  if (window.__caesuraZhTW) {
    if (LANG === 'zh-TW' && typeof window.__caesuraZhTW.applyToDocument === 'function') window.__caesuraZhTW.applyToDocument();
    else if (LANG === 'zh' && typeof window.__caesuraZhTW.restoreOriginals === 'function') window.__caesuraZhTW.restoreOriginals();
  }
  const t = $('#lang-toggle');
  t.textContent = LANG === 'en' ? 'EN' : (LANG === 'zh-TW' ? '繁體' : '简体')
  t.setAttribute('aria-pressed', String(LANG === 'en'))
}
function setLang(next) {
  LANG = next
  try { localStorage.setItem('caesura-lang', next) } catch { /* noop */ }
  applyI18n()
  renderAll()
}

/* ─────────── 门 ─────────── */
function tryUnlock(pass) {
  if (pass === '123') {
    try { sessionStorage.setItem('caesura-admin-ok', '1') } catch { /* noop */ }
    $('#gate').classList.add('unlocked')
    setTimeout(() => { $('#gate').hidden = true; $('#deck').hidden = false }, 320)
    renderAll()
    return true
  }
  const card = $('#gate-card')
  card.classList.remove('shake')
  // 强制 reflow 让动画可重播
  void card.offsetWidth
  card.classList.add('shake')
  $('#gate-error').classList.add('show')
  return false
}

/* ─────────── SVG 小工具 ─────────── */
function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVGNS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  if (parent) parent.appendChild(el)
  return el
}
function clearSvg(svg) { while (svg.firstChild) svg.removeChild(svg.firstChild) }

/* ─────────── 渲染：KPI ─────────── */
function renderKpis() {
  const d = TELEMETRY.daily
  const today = d[d.length - 1]
  const avg = (k) => mean(d.map((x) => x[k]))
  const tot = TELEMETRY.totals
  const { overall } = funnelRates(TELEMETRY.funnel.steps)
  const d1Mean = mean(TELEMETRY.cohorts.map((c) => c.d1))
  const todayAn = anomalies(d.map((x) => x.sessions), 1.8).find((a) => a.index === d.length - 1)
  const delta = (cur, base, invert = false) => {
    if (!base) return { txt: '—', cls: '' }
    const diff = (cur - base) / base
    const good = invert ? diff < 0 : diff > 0
    const arrow = diff >= 0 ? '↑' : '↓'
    return { txt: `${arrow} ${Math.abs(diff * 100).toFixed(1)}%`, cls: good ? 'up' : 'down' }
  }
  const dSess = delta(today.sessions, avg('sessions'))
  const dBounce = delta(today.bounce, avg('bounce'), true)
  const dDur = delta(today.avgDurationSec, avg('avgDurationSec'))
  const newShare = today.newUsers / today.sessions
  const perNewShare = tot.newUsers / tot.sessions

  const cards = [
    { label: T('总会话 · 30 天', 'Sessions · 30d'), value: num(tot.sessions), foot: T(`新增 ${num(tot.newUsers)} · 回访 ${num(tot.returning)}`, `new ${num(tot.newUsers)} · returning ${num(tot.returning)}`) },
    { label: T('今日会话', 'Sessions today'), value: num(today.sessions), foot: `<span class="${dSess.cls}">${dSess.txt}</span> ${T('vs 30d 均值', 'vs 30d avg')}` },
    { label: T('新用户占比', 'New-user share'), value: pct(newShare, 1), foot: `${pct(perNewShare, 1)} ${T('30d 均值', '30d avg')}` },
    { label: T('跳出率', 'Bounce'), value: pct(today.bounce, 1), foot: `<span class="${dBounce.cls}">${dBounce.txt}</span> ${T('越低越好', 'lower is better')}` },
    { label: T('平均会话', 'Avg session'), value: dur(today.avgDurationSec), foot: `<span class="${dDur.cls}">${dDur.txt}</span> ${T('vs 30d 均值', 'vs 30d avg')}` },
    { label: T('抵达结局', 'Reached ending'), value: num(tot.endings), foot: T(`整体完读率 ${pct(overall)}`, `overall clear ${pct(overall)}`) },
    { label: T('次日留存', 'D1 retention'), value: pct(d1Mean, 1), foot: T('最新队列 W-046 ↑ .24', 'newest cohort W-046 ↑ .24') },
    { label: T('今日异常', 'Today anomaly'), value: todayAn ? `z ${todayAn.z > 0 ? '+' : ''}${todayAn.z}` : '—', alert: !!todayAn, foot: todayAn ? T('周日尖峰 · 观察明天是否回落', 'Sunday spike — watch tomorrow') : T('无异常', 'none') },
  ]
  $('#kpis').innerHTML = cards.map((c) => `
    <div class="kpi${c.alert ? ' alert' : ''}">
      <div class="k-label">${c.label}</div>
      <div class="k-value">${c.value}</div>
      <div class="k-foot">${c.foot}</div>
    </div>`).join('')
}

/* ─────────── 渲染：趋势图 ─────────── */
function renderTrend() {
  const svg = $('#chart-trend')
  clearSvg(svg)
  const d = TELEMETRY.daily
  const xs = d.map((_, i) => i)
  const ys = d.map((x) => x.sessions)
  const ma = movingAverage(ys, 7)
  const fc = forecast(ys, { lookback: 14, horizon: 7 })
  const all = [...ys, ...fc.points]
  const maxV = Math.ceil((Math.max(...all) * 1.12) / 50) * 50
  const W = 720, H = 210, L = 36, R = 44, Tp = 14, B = 26
  const X = (i) => L + (i * (W - L - R)) / (ys.length + 6)
  const Y = (v) => Tp + (1 - v / maxV) * (H - Tp - B)

  for (let g = 0; g <= 4; g++) {
    const v = (maxV / 4) * g
    svgEl('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'grid-line' }, svg)
    svgEl('text', { x: L - 6, y: Y(v) + 3, 'text-anchor': 'end', class: 'tick' }, svg).textContent = num(v)
  }
  svgEl('line', { x1: L, x2: W - R, y1: Y(0), y2: Y(0), class: 'axis' }, svg)

  const path = ys.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
  svgEl('path', { d: path, class: 'line-actual' }, svg)
  const maPath = ma.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
  svgEl('path', { d: maPath, class: 'line-ma' }, svg)

  const lastX = X(ys.length - 1), lastY = Y(ys[ys.length - 1])
  const fcPath = fc.points.map((v, i) => `${i === 0 ? `M${lastX.toFixed(1)},${lastY.toFixed(1)}` : ''} L${X(ys.length + i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ').trim()
  svgEl('path', { d: fcPath, class: 'line-fc' }, svg)

  for (const a of anomalies(ys, 1.8)) {
    svgEl('circle', { cx: X(a.index), cy: Y(a.value), r: 4.2, class: 'dot-anom' }, svg)
  }
  const tickIdx = [0, 9, 19, 29]
  for (const i of tickIdx) {
    svgEl('text', { x: X(i), y: H - 8, 'text-anchor': 'middle', class: 'tick' }, svg).textContent = d[i].date.slice(5)
  }
  svgEl('text', { x: X(ys.length + 2), y: H - 8, 'text-anchor': 'middle', class: 'tick-strong' }, svg).textContent = '+7d'

  const total7 = fc.points.reduce((s, x) => s + x, 0)
  $('#trend-foot').innerHTML = T(
    `外推：斜率 <b>${fc.slope.toFixed(2)}</b> 会话/日 · R²=${fc.r2.toFixed(2)} · 未来 7 天 ≈ ${num(total7)} 会话 · <b>线性外推，仅供方向参考</b>`,
    `Projection: slope <b>${fc.slope.toFixed(2)}</b> sessions/day · R²=${fc.r2.toFixed(2)} · next 7d ≈ ${num(total7)} sessions · <b>naive linear extrapolation — directional only</b>`,
  )
}

/* ─────────── 渲染：漏斗 ─────────── */
function renderFunnel() {
  const { steps } = TELEMETRY.funnel
  const { stepRates, overall } = funnelRates(steps)
  const first = steps[0].count
  $('#funnel').innerHTML = steps.map((s, i) => `
    <div class="f-row">
      <div class="f-label">${T(s.labelZh, s.labelEn)}</div>
      <div class="f-track"><div class="f-bar" style="width:${((s.count / first) * 100).toFixed(2)}%"></div></div>
      <div class="f-meta"><b>${num(s.count)}</b>${i > 0 ? ` · ${pct(stepRates[i - 1], 1)}` : ''}</div>
    </div>`).join('')
  $('#funnel-foot').innerHTML = T(
    `整体完读率 <b>${pct(overall)}</b> —— ${num(steps[steps.length - 1].count)} 个玩家走到了结局`,
    `Overall clear rate <b>${pct(overall)}</b> — ${num(steps[steps.length - 1].count)} players reached an ending`,
  )
}

/* ─────────── 渲染：渠道 ─────────── */
function renderChannels() {
  const maxShare = Math.max(...TELEMETRY.channels.map((c) => c.share))
  $('#channels').innerHTML = TELEMETRY.channels.map((c) => `
    <div class="ch-row">
      <div class="ch-label">${T(c.labelZh, c.labelEn)} · ${pct(c.share, 0)}</div>
      <div class="ch-track"><div class="ch-bar" style="width:${((c.share / maxShare) * 100).toFixed(2)}%"></div></div>
      <div class="ch-rate">${T('完读', 'clear')} <b>${pct(c.endingRate, 1)}</b> · ${num(c.sessions)}</div>
    </div>`).join('')
}

/* ─────────── 渲染：设备 & 语言 ─────────── */
const DEVICE_COLORS = { mobile: '#c9b458', desktop: '#4f9b86', tablet: '#a9afbd' }
function renderDevices() {
  const svg = $('#chart-devices')
  clearSvg(svg)
  const cx = 90, cy = 90, r = 58, CIRC = 2 * Math.PI * r
  svgEl('circle', { cx, cy, r, fill: 'none', stroke: 'var(--ash-3)', 'stroke-width': 22 }, svg)
  let offset = 0
  for (const dev of TELEMETRY.devices) {
    const len = dev.share * CIRC
    svgEl('circle', {
      cx, cy, r, fill: 'none', stroke: DEVICE_COLORS[dev.id] ?? '#a9afbd', 'stroke-width': 22,
      'stroke-dasharray': `${len.toFixed(1)} ${(CIRC - len).toFixed(1)}`,
      'stroke-dashoffset': (-offset).toFixed(1),
      transform: `rotate(-90 ${cx} ${cy})`,
    }, svg)
    offset += len
  }
  svgEl('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', fill: '#e8e3d3', 'font-size': 17, 'font-family': 'var(--serif)' }, svg).textContent = num(TELEMETRY.totals.sessions)
  svgEl('text', { x: cx, y: cy + 13, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 6.5, 'letter-spacing': '.22em' }, svg).textContent = T('会话', 'SESSIONS')

  $('#device-legend').innerHTML = TELEMETRY.devices.map((dev) => `
    <div class="dl-item"><span class="dl-swatch" style="background:${DEVICE_COLORS[dev.id] ?? '#a9afbd'}"></span>
      <span>${T(dev.labelZh, dev.labelEn)} <b>· ${pct(dev.share, 0)}</b><br /><small style="color:var(--muted)">${T('完读', 'clear')} ${pct(dev.endingRate, 1)} · ${T('均时', 'avg')} ${dur(dev.avgDurationSec)}</small></span>
    </div>`).join('')

  const zhShare = TELEMETRY.locales.find((l) => l.id === 'zh').share
  $('#locale-bar').innerHTML = `
    <div class="lb-track"><div class="lb-zh" style="width:${pct(zhShare, 2)}"></div><div class="lb-en" style="width:${pct(1 - zhShare, 2)}"></div></div>
    <div class="lb-foot"><span>${T('中文', 'Chinese')} ${pct(zhShare, 0)}</span><span>${T('英文', 'English')} ${pct(1 - zhShare, 0)}</span></div>`
}

/* ─────────── 渲染：24 小时 ─────────── */
function renderHours() {
  const svg = $('#chart-hours')
  clearSvg(svg)
  const H = TELEMETRY.hourly
  const maxV = Math.max(...H.map((x) => x.share))
  const W = 720, Hh = 150, L = 8, R = 8, Tp = 10, B = 18
  const bw = (W - L - R) / 24
  for (const { h, share } of H) {
    const peak = h >= 20 || h === 0
    const bh = (share / maxV) * (Hh - Tp - B)
    svgEl('rect', {
      x: (L + h * bw + 1.5).toFixed(1), y: (Hh - B - bh).toFixed(1),
      width: (bw - 3).toFixed(1), height: bh.toFixed(1), rx: 1.5,
      class: 'hour-bar' + (peak ? ' peak' : ''),
    }, svg)
    if (h % 3 === 0) svgEl('text', { x: L + h * bw + bw / 2, y: Hh - 4, 'text-anchor': 'middle', class: 'tick' }, svg).textContent = String(h).padStart(2, '0')
  }
  const peakShare = H.slice(20, 24).reduce((s, x) => s + x.share, 0) + (H[0]?.share ?? 0)
  $('#hours-foot').innerHTML = T(
    `20:00–00:00 合计 <b>${pct(peakShare, 1)}</b> 的会话——深夜是这款游戏的黄金档`,
    `20:00–00:00 holds <b>${pct(peakShare, 1)}</b> of sessions — prime time for this game is midnight`,
  )
}

/* ─────────── 渲染：留存矩阵 ─────────── */
function renderCohorts() {
  const cols = ['d1', 'd3', 'd7', 'd14', 'd30']
  const head = cols.map((c) => `<th>${c.toUpperCase()}</th>`).join('')
  const rows = TELEMETRY.cohorts.map((c) => `
    <tr><th>${T(c.labelZh, c.labelEn)}<br /><small style="color:var(--muted)">${num(c.size)} ${T('人', 'players')}</small></th>
      ${cols.map((k) => c[k] == null ? '<td class="empty">—</td>' : `<td class="cell" style="background:rgba(79,155,134,${(0.10 + (c[k] / 0.25) * 0.55).toFixed(3)})">${pct(c[k], 1)}</td>`).join('')}
    </tr>`).join('')
  $('#cohort').innerHTML = `<thead><tr><th>${T('队列', 'Cohort')}</th>${head}</tr></thead><tbody>${rows}</tbody>`
}

/* ─────────── 渲染：异常日 ─────────── */
function renderAnomalies() {
  const d = TELEMETRY.daily
  const found = anomalies(d.map((x) => x.sessions), 1.8)
  const el = $('#anom')
  if (!found.length) {
    el.innerHTML = `<li style="border-color:var(--line-soft);border-left-color:var(--jade);background:rgba(79,155,134,.05)"><span class="a-date" style="color:var(--jade)">${T('无异常', 'none')}</span><div class="a-body">${T('30 天内 |z| < 1.8——节奏平稳。', 'No |z| ≥ 1.8 over 30 days — a steady pulse.')}</div></li>`
    return
  }
  el.innerHTML = found.map((a) => `
    <li><span class="a-date">${d[a.index].date} · ${num(a.value)} ${T('会话', 'sessions')} · z ${a.z > 0 ? '+' : ''}${a.z} (${a.direction === 'up' ? '↑' : '↓'})</span>
      <div class="a-body">${a.direction === 'up'
        ? T('高于常态的一天。若次日回落至均值则为周末/曝光效应；连续两日 > +2σ 才考虑扩容。', 'A day above the norm. If the next day settles back to average it was weekends/exposure; sustained +2σ on consecutive days is what justifies capacity work.')
        : T('低于常态的一天。排查推送/站点可用性/外链失效；若是单日事件则自愈。', 'A day below the norm. Check pushes, uptime and referrer links; one-off days usually self-heal.')}</div>
    </li>`).join('')
}

/* ─────────── 渲染：退出 & rage ─────────── */
function renderExits() {
  const pages = [...TELEMETRY.pages]
  const byExit = [...pages].sort((a, b) => b.exitShare - a.exitShare).slice(0, 4)
  const byRage = [...pages].sort((a, b) => b.rageClicks - a.rageClicks).slice(0, 4)
  const maxExit = byExit[0]?.exitShare ?? 1
  const maxRage = byRage[0]?.rageClicks ?? 1
  $('#exit-list').innerHTML = byExit.map((p) => `
    <div class="x-row"><div class="x-path" title="${p.path}">${T(p.labelZh, p.labelEn)} · ${p.path}</div>
      <div class="x-track"><div class="x-bar" style="width:${((p.exitShare / maxExit) * 100).toFixed(1)}%"></div></div>
      <div class="x-num">${pct(p.exitShare, 1)}</div></div>`).join('')
  $('#rage-list').innerHTML = byRage.map((p) => `
    <div class="x-row"><div class="x-path" title="${p.path}">${T(p.labelZh, p.labelEn)} · ${p.path}</div>
      <div class="x-track"><div class="x-bar rage" style="width:${((p.rageClicks / maxRage) * 100).toFixed(1)}%"></div></div>
      <div class="x-num">${num(p.rageClicks)}</div></div>`).join('')
}

/* ─────────── 渲染：智能建议 ─────────── */
function renderRecs() {
  const recs = deriveRecommendations(TELEMETRY)
  const counts = { P0: 0, P1: 0, P2: 0 }
  for (const r of recs) counts[r.priority]++
  $('#recs-count').textContent = recs.length
    ? T(`${recs.length} 条 · P0×${counts.P0} P1×${counts.P1} P2×${counts.P2}`, `${recs.length} moves · P0×${counts.P0} P1×${counts.P1} P2×${counts.P2}`)
    : T('0 条 · 全部指标处在阈值之上', '0 moves — every metric sits above threshold')
  $('#recs').innerHTML = recs.length
    ? recs.map((r) => `
      <article class="rec">
        <div class="rec-top"><span class="chip chip-${r.priority}">${r.priority}</span><span class="rec-metric">${r.metric} · ${T('当前', 'now')} ${typeof r.current === 'number' && Math.abs(r.current) <= 1 ? pct(r.current, 1) : num(r.current)} ${T('阈值', 'thr')} ${typeof r.threshold === 'number' && Math.abs(r.threshold) <= 1 ? pct(r.threshold, 1) : num(r.threshold)}</span></div>
        <h3 class="rec-title">${T(r.titleZh, r.titleEn)}</h3>
        <p class="rec-action">${T(r.actionZh, r.actionEn)}</p>
        <p class="rec-id">${r.id}</p>
      </article>`).join('')
    : `<p class="live-empty">${T('所有指标均在阈值之上——保持，并给下一次新章预留曝光窗口。', 'All metrics above threshold — hold steady and reserve exposure for the next chapter.')}</p>`
}

/* ─────────── 本机实况 ─────────── */
const TELEMETRY_KEY = 'caesura.telemetry.v1'
function readLocalTelemetry() {
  try {
    const raw = localStorage.getItem(TELEMETRY_KEY)
    if (!raw) return null
    const doc = JSON.parse(raw)
    if (!doc || doc.v !== 1 || !Array.isArray(doc.events)) return null
    return doc
  } catch { return null }
}
function renderLive() {
  const doc = readLocalTelemetry()
  const stats = $('#live-stats'), events = $('#live-events')
  if (!doc) {
    stats.innerHTML = ''
    events.innerHTML = `<li class="live-empty" style="list-style:none;margin-left:-20px">${T('这台浏览器还没有事件——继续浏览本站的页面，它会悄悄记下你的一切（只存在本机）。', 'No events on this browser yet — browse any page of the site and it will quietly remember everything (this device only).')}</li>`
    return
  }
  const paths = new Set(doc.events.map((e) => e.path))
  const rages = doc.events.filter((e) => e.type === 'rage').length
  const pageviews = doc.events.filter((e) => e.type === 'pageview').length
  /* KI-653（KI-645 行动 #1）：首屏 Start 的曝光/按下——真环形缓冲里的真事件 */
  const qsShown = doc.events.filter((e) => e.type === 'quickstart-shown').length
  const qsPress = doc.events.filter((e) => e.type === 'quickstart-press').length
  /* KI-654（KI-645 行动 #4）：正文读完记账——读完率的机器可验收证据 */
  const storyFinishes = doc.events.filter((e) => e.type === 'story-finished').length
  const storyNext = doc.events.filter((e) => e.type === 'story-next').length
  const mins = Math.max(1, Math.round((Date.now() - (doc.firstSeen ?? Date.now())) / 60000))
  const statsHtml = [
    { n: num(doc.events.length), l: T('事件总数', 'events') },
    { n: num(paths.size), l: T('到访页面数', 'pages seen') },
    { n: String(pageviews), l: T('页面浏览', 'page views') },
    { n: String(qsShown), l: T('Start 曝光', 'quickstart shown') },
    { n: String(qsPress), l: T('Start 按下', 'quickstart press') },
    { n: String(storyFinishes), l: T('读完篇数', 'story finishes') },
    { n: String(storyNext), l: T('下一篇点击', 'next-story taps') },
    { n: String(rages), l: 'rage-clicks' },
    { n: mins + 'm', l: T('首次到访至今', 'since first visit') },
    { n: String(doc.counts?.error ?? 0), l: T('JS 错误', 'JS errors') },
  ].map((s) => `<div class="live-stat"><div class="l-num">${s.n}</div><div class="l-label">${s.l}</div></div>`).join('')
  stats.innerHTML = statsHtml
  events.innerHTML = doc.events.slice(-12).reverse().map((e) => {
    const t = new Date(e.t)
    const hhmmss = [t.getHours(), t.getMinutes(), t.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':')
    return `<li><span style="color:var(--muted)">${hhmmss}</span> <b style="color:var(--gold)">${e.type}</b> <span class="ev-path">${e.path}</span></li>`
  }).join('')
}

/* ─────────── 导出 ─────────── */
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}
function exportCsv() {
  const head = 'date,sessions,newUsers,bounce,avgDurationSec,pageViews,endings,marks,storyFinishes'
  const rows = TELEMETRY.daily.map((d) => [d.date, d.sessions, d.newUsers, d.bounce, d.avgDurationSec, d.pageViews, d.endings, d.marks, d.storyFinishes].join(','))
  download('caesura_analytics_daily.csv', '﻿' + [head, ...rows].join('\n'), 'text/csv;charset=utf-8') // ﻿ BOM 前缀（U+FEFF）
  note(T('已下载 caesura_analytics_daily.csv', 'caesura_analytics_daily.csv downloaded'))
}
function exportJson() {
  download('caesura_analytics_full.json', JSON.stringify(TELEMETRY, null, 2), 'application/json;charset=utf-8')
  note(T('已下载 caesura_analytics_full.json', 'caesura_analytics_full.json downloaded'))
}

/* KI-631 · 导出 AI 诊断备忘（Markdown）：唯一把真机产物的人带到桌面上的通道 */
async function exportAiMemo() {
  const fetchSafe = async (url) => {
    try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json() } catch { return null }
  }
  const [d, qa] = await Promise.all([
    fetchSafe('./ai-director-latest.json'),
    fetchSafe('./ai-director-transitions-qa.json'),
  ])
  if (!d) { note(T('读不出 ai-director-latest.json——先跑一次真机诊断', 'Could not read ai-director-latest.json — run the live director first')); return }
  const u = d.usage || {}
  const kv = (d.worldSnapshot && d.worldSnapshot.phaseStatus) || {}
  const lines = [
    '# CÆSURA · AI 导演诊断备忘',
    `生成于 ${d.generatedAt ?? '—'} · mode ${d.mode ?? '—'} · 模型 ${d.model ?? '—'} · 语料 ${d.corpusSize ?? '—'} chunks`,
    `LLM 调用 ${u.calls ?? 0} 次 · cached_tokens ${u.cachedTokens ?? 0} · statuses [${(u.statuses ?? []).join(',')}]`,
    '',
    '## 世界现状快照（机器现读 · 不许手写）',
    `KI ${kv.KIImplemented ?? '?'} / ${kv.KIrows ?? '?'} · SYS ${kv.SYSImplemented ?? '?'} · ARCH ${kv.ARCHSections ?? '?'} · atlas ${d.worldSnapshot?.atlasEntries ?? '?'} 篇 · story ${d.worldSnapshot?.storyChapters ?? '?'} 篇 · dialogue ${d.worldSnapshot?.dialogue?.trees ?? '?'} 棵 / ${d.worldSnapshot?.dialogue?.nodes ?? '?'} 格 / 旗标 ${d.worldSnapshot?.dialogue?.distinctFlags ?? '?'}`,
    '',
    '## 一致性审计',
  ]
  if (d.audit) {
    lines.push(`consistency: ${d.audit.consistency}/100`, `verdictZh: ${d.audit.verdictZh ?? '—'}`, `verdictEn: ${d.audit.verdictEn ?? '—'}`)
    lines.push('', 'risks:')
    for (const r of d.audit.risks ?? []) lines.push(`- [${r.severity}] ${r.itemZh ?? ''} — ${r.detailZh ?? ''}`)
    lines.push('', 'gaps:')
    for (const g of d.audit.gapsZh ?? []) lines.push(`- ${g}`)
  } else {
    lines.push('（本次运行无 audit —— offline dry-run）')
  }
  lines.push('', '## 世界状态流转提案（人工闸）')
  const verdictByFlag = new Map(((qa && qa.verdicts) || []).map((v) => [v.flag, v]))
  ;(d.transitions ?? []).forEach((t, i) => {
    const qaV = verdictByFlag.get(t.flag)
    lines.push(`${i + 1}. ${t.flag}`)
    lines.push(`   ${t.fromZh} → ${t.toZh}`)
    lines.push(`   ${t.narrativeZh ?? ''}`)
    if (qaV) lines.push(`   裁决: ${qaV.canonFit}${qaV.notesZh ? ` — ${qaV.notesZh}` : ''}`)
  })
  lines.push('', '## 第十七篇游记 · 草稿（requiresHumanReview · 不落库）')
  if (d.atlasDraft) {
    lines.push(`No.${d.atlasDraft.no} 《${d.atlasDraft.titleZh}》 / No.${d.atlasDraft.no} “${d.atlasDraft.titleEn ?? ''}”`)
    lines.push(d.atlasDraft.pZh ?? '')
    lines.push(`— ${d.atlasDraft.codaZh ?? ''}`)
  } else {
    lines.push('（无草稿）')
  }
  lines.push('', '---', '> 机器生成稿件 · 人工闸后方可落库 · 零玩家运行时')
  download('caesura_ai-director-memo.md', lines.join('\n'), 'text/markdown;charset=utf-8')
  note(T('已下载 caesura_ai-director-memo.md', 'caesura_ai-director-memo.md downloaded'))
}
function digestText() {
  const d = TELEMETRY.daily
  const today = d[d.length - 1]
  const { overall } = funnelRates(TELEMETRY.funnel.steps)
  const recs = deriveRecommendations(TELEMETRY)
  const top = recs.slice(0, 3).map((r) => `  [${r.priority}] ${r.id} — ${T(r.titleZh, r.titleEn)}`).join('\n')
  return T(
    `止音纪元 · 运营日报（${today.date}）\n` +
    `会话 ${num(today.sessions)}（30d ${num(TELEMETRY.totals.sessions)}）· 跳出 ${pct(today.bounce, 0)} · 均时 ${dur(today.avgDurationSec)}\n` +
    `新用户占比 ${pct(today.newUsers / today.sessions, 0)} · 完读率 ${pct(overall)} · 抵达结局 ${num(TELEMETRY.totals.endings)}\n` +
    `异常日：${anomalies(d.map((x) => x.sessions), 1.8).map((a) => d[a.index].date).join('，') || '无'}\n` +
    `优先动作：\n${top}`,
    `CAESURA ops digest (${today.date})\n` +
    `Sessions ${num(today.sessions)} (30d ${num(TELEMETRY.totals.sessions)}) · bounce ${pct(today.bounce, 0)} · avg ${dur(today.avgDurationSec)}\n` +
    `New-user share ${pct(today.newUsers / today.sessions, 0)} · clear rate ${pct(overall)} · endings ${num(TELEMETRY.totals.endings)}\n` +
    `Anomalous days: ${anomalies(d.map((x) => x.sessions), 1.8).map((a) => d[a.index].date).join(', ') || 'none'}\n` +
    `Top moves:\n${top}`,
  )
}
async function copyDigest() {
  const text = digestText()
  try { await navigator.clipboard.writeText(text); note(T('日报已复制到剪贴板', 'Digest copied to clipboard')) }
  catch {
    const ta = document.createElement('textarea')
    ta.value = text; document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy'); note(T('日报已复制到剪贴板', 'Digest copied to clipboard')) } catch { note(T('复制失败——请手动选择文本', 'Copy failed — please select the text manually')) }
    ta.remove()
  }
}
function note(msg) { $('#export-note').textContent = msg; setTimeout(() => { $('#export-note').textContent = '' }, 3200) }

/* ─────────── AI 导演（KI-620 · 真·LLM 嵌入）─────────── */
const aiEl = (id) => document.getElementById(id)
const clearEl = (el) => { while (el && el.firstChild) el.removeChild(el.firstChild) }
function makeEl(tag, className, text) {
  const el = document.createElement(tag)
  if (className) el.className = className
  if (text !== undefined) el.textContent = text
  return el
}
const AI_LIVE_KEY = 'caesura-ai-live'

function buildDigest() {
  const t = TELEMETRY
  const daily = t.daily
  const last7 = daily.slice(-7)
  const prev7 = daily.slice(-14, -7)
  const sumSessions = (a) => a.reduce((n, d) => n + d.sessions, 0)
  const meanBounce = (a) => (a.length ? a.reduce((n, d) => n + d.bounce, 0) / a.length : 0)
  const funnel = t.funnel.steps
  const clearRate = funnel[0].count ? funnel[funnel.length - 1].count / funnel[0].count : 0
  const topExit = [...t.pages].sort((a, b) => b.exitShare - a.exitShare)[0]
  const topRage = [...t.pages].sort((a, b) => b.rageClicks - a.rageClicks)[0]
  const mobile = (t.devices.find((d) => d.id === 'mobile') || {}).share
  const zhShare = (t.locales.find((l) => l.id === 'zh') || {}).share
  const lateWindow = t.hourly.slice(20).reduce((n, h) => n + h.share, 0) + (t.hourly[0]?.share ?? 0)
  return {
    cohort: 'simulated · seed 20261115 · 2026-10-17 → 2026-11-15',
    sessions: t.totals.sessions,
    newUsers: t.totals.newUsers,
    endings: t.totals.endings,
    storyFinishes: t.totals.storyFinishes,
    last7Sessions: sumSessions(last7),
    prev7Sessions: sumSessions(prev7),
    last7Bounce: Math.round(meanBounce(last7) * 100) / 100,
    funnelClearRatePct: Math.round(clearRate * 1000) / 10,
    mobileShare: mobile,
    zhShare,
    topExitPage: `${topExit.path} (exit ${(topExit.exitShare * 100).toFixed(0)}%)`,
    topRagePage: `${topRage.path} (×${topRage.rageClicks})`,
    lateWindowShare: Math.round(lateWindow * 1000) / 1000,
  }
}

async function renderAiCommitted() {
  const chip = aiEl('ai-mode-chip')
  if (!chip) return
  const gen = aiEl('ai-generated'), mod = aiEl('ai-model-line'), verdict = aiEl('ai-verdict'), cons = aiEl('ai-consistency')
  const risks = aiEl('ai-risks'), gaps = aiEl('ai-gaps'), transitions = aiEl('ai-transitions'), draft = aiEl('ai-draft')
  const off = aiEl('ai-offline-note'), err = aiEl('ai-load-error')
  off.hidden = true; err.hidden = true
  let d
  try {
    const r = await fetch('./ai-director-latest.json', { cache: 'no-store' })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    d = await r.json()
  } catch (e) {
    err.textContent = T('读取 ai-director-latest.json 失败：', 'Failed to load ai-director-latest.json: ') + String((e && e.message) || e)
    err.hidden = false
    chip.textContent = '—'
    return
  }
  /* KI-624 · 流转 QA 裁决（可选；缺文件时不阻塞面板） */
  let qa = null
  try {
    const qr = await fetch('./ai-director-transitions-qa.json', { cache: 'no-store' })
    if (qr.ok) qa = await qr.json()
  } catch { qa = null }
  const verdictByFlag = new Map((((qa && qa.verdicts)) || []).map((v) => [v.flag, v]))
  const isEn = LANG === 'en'
  const audit = d.audit
  chip.textContent = d.mode === 'live' ? T('实时', 'LIVE') : String(d.mode || '离线').toUpperCase()
  gen.textContent = String(d.generatedAt || '').slice(0, 19).replace('T', ' ')
  const u = d.usage || {}
  mod.textContent = `${d.model || '—'} · ${d.corpusSize || 0} chunks · ${u.calls || 0} calls · ${u.cachedTokens || 0} cached`
  cons.textContent = audit && Number.isFinite(Number(audit.consistency)) ? String(audit.consistency) : '—'
  verdict.textContent = audit ? (isEn ? audit.verdictEn : audit.verdictZh) || '—' : '—'
  clearEl(risks); clearEl(gaps); clearEl(transitions); clearEl(draft)
  for (const r of (audit && audit.risks) || []) {
    const li = makeEl('li', `ai-risk ai-risk-${r.severity || 'low'}`)
    li.append(
      makeEl('b', null, (isEn ? (r.itemEn || r.itemZh) : (r.itemZh || r.itemEn)) || ''),
      makeEl('span', null, ` — ${(isEn ? r.detailEn : r.detailZh) || ''}`),
    )
    risks.appendChild(li)
  }
  for (const g of (audit && (isEn ? audit.gapsEn : audit.gapsZh)) || []) gaps.appendChild(makeEl('li', null, g))
  for (const tr of d.transitions || []) {
    const li = makeEl('li', 'ai-transition')
    const meta = makeEl('div', 'ai-t-meta', `${tr.flag || ''} · ${T('人工闸', 'human gate')}`)
    const verdict = verdictByFlag.get(tr.flag)
    if (verdict && verdict.canonFit) {
      const badge = makeEl('span', `ai-verdict-badge ai-verdict-${verdict.canonFit}`, String(verdict.canonFit))
      badge.title = `${verdict.notesZh || ''}${verdict.notesEn ? ' / ' + verdict.notesEn : ''}`
      meta.appendChild(badge)
    }
    li.append(
      makeEl('div', 'ai-t-route', `${(isEn ? tr.fromEn : tr.fromZh) || '—'}  →  ${(isEn ? tr.toEn : tr.toZh) || '—'}`),
      meta,
      makeEl('p', null, (isEn ? tr.narrativeEn : tr.narrativeZh) || ''),
    )
    transitions.appendChild(li)
  }
  const dr = d.atlasDraft
  if (dr) {
    draft.append(
      makeEl('h5', null, `No.${dr.no} · ${(isEn ? dr.titleEn : dr.titleZh) || ''}`),
      makeEl('p', null, (isEn ? dr.pEn : dr.pZh) || ''),
      makeEl('p', 'ai-coda', `— ${(isEn ? dr.codaEn : dr.codaZh) || ''}`),
      makeEl('small', null, T('requiresHumanReview · 不落库', 'requiresHumanReview · not committed')),
    )
  } else {
    draft.append(makeEl('p', null, T('（尚无草稿）', '(no draft yet)')))
  }
  off.hidden = !(d.mode === 'offline' || !audit)
}

function showAiError(msg) { const errEl = aiEl('ai-error'); if (errEl) { errEl.textContent = msg; errEl.hidden = false } }
function hydrateAiLive() {
  let saved = null
  try { saved = JSON.parse(sessionStorage.getItem(AI_LIVE_KEY) || 'null') } catch { saved = null }
  const baseEl = aiEl('ai-base'), modelEl = aiEl('ai-model'), keyEl = aiEl('ai-key')
  if (baseEl) baseEl.value = (saved && saved.base) || 'https://api.aizzz.xyz/v1'
  if (modelEl) modelEl.value = (saved && saved.model) || 'gpt-6.2-sol'
  if (keyEl && saved && saved.key) keyEl.value = saved.key
}

async function runAiLive(e) {
  e.preventDefault()
  const errEl = aiEl('ai-error'), wrap = aiEl('ai-result-wrap'), out = aiEl('ai-result'), btn = aiEl('ai-run')
  errEl.hidden = true
  const base = (aiEl('ai-base').value || '').trim().replace(/\/+$/, '')
  const model = (aiEl('ai-model').value || '').trim()
  const key = (aiEl('ai-key').value || '').trim()
  if (!base || !model || !key) { showAiError(T('Base URL / 模型 / Key 都要填', 'Base URL, model and key are all required')); return }
  try { sessionStorage.setItem(AI_LIVE_KEY, JSON.stringify({ base, model, key })) } catch { /* noop */ }
  btn.disabled = true
  btn.textContent = T('思考中…', 'Thinking…')
  try {
    const digest = buildDigest()
    const sys = LANG === 'en'
      ? 'You are the World Director and product analyst of CÆSURA (The Epoch of Hush). Read the telemetry digest from the admin observatory and reply with: 1) overall situation (≤80 words), 2) three biggest risks — each with metric, threshold, current value, 3) three next optimizations — each with its trigger metric, 4) one in-game “world state transition” suggestion players could actually feel. Be concrete; cite the numbers; no filler. English.'
      : '你是《止音纪元》的世界导演兼数据分析师。读下面这份后台观察站的埋点摘要，答复：① 总评（≤80字）② 三个最大风险（每条给出指标、阈值、现值）③ 三个下一步优化（每条给触发指标）④ 一条玩家可感知的游戏内「世界状态流转」建议。要具体，引用数字，不要废话。中文。'
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0.4, max_tokens: 1200,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: `埋点摘要：\n${JSON.stringify(digest, null, 1)}` },
        ],
      }),
    })
    const raw = await res.text()
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try { const j = JSON.parse(raw); msg += ` · ${(j && j.error && j.error.message) || raw.slice(0, 200)}` } catch { msg += ` · ${raw.slice(0, 200)}` }
      showAiError(msg)
      return
    }
    let content = ''
    try { content = (JSON.parse(raw)?.choices?.[0]?.message?.content) || '' } catch { content = raw }
    out.textContent = content || T('(空响应)', '(empty response)')
    wrap.hidden = false
  } catch (e2) {
    showAiError(`${T('请求失败：', 'Request failed: ')}${(e2 && e2.message) || e2}\n${T('（诚实提示：CORS 网关是开放的，但你的浏览器能不能到到网关是另一回事——本机 Clash Verge 下浏览器需走系统代理/TUN 才能连上 aizzz；海外网络可直连；如两者都不行，用本机 npm run ai:director:live 生成真跑产物即可在「最近一次真机运行」查看）', '(Honest note: the gateway’s CORS is open, but whether your browser can reach the gateway is a separate question — with local Clash Verge your browser needs the system proxy/TUN; overseas networks reach it directly. Either way, npm run ai:director:live on the machine produces the mirrored report on the left.)')}`)
  } finally {
    btn.disabled = false
    btn.textContent = T('真跑诊断 →', 'Run live diagnosis →')
  }
}

/* ─────────── LLM 缓存命中账本（KI-685 A · rolling 80 · 持久证据）─────────── */
async function renderCacheMetrics() {
  const el = document.getElementById('ai-cache-summary')
  if (!el) return
  let ledger
  try {
    const r = await fetch('./ai-cache-metrics.json', { cache: 'no-store' })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    ledger = await r.json()
  } catch {
    el.textContent = T('暂无账本（跑一次 npm run ai:director:live 生成）', 'No ledger yet (run npm run ai:director:live once)')
    return
  }
  const entries = Array.isArray(ledger && ledger.entries) ? ledger.entries : []
  if (entries.length === 0) {
    el.textContent = T('账本为空——下次 live 运行自动登记', 'Ledger empty — the next live run registers itself')
    return
  }
  const last = entries[entries.length - 1] || {}
  const latest = [...entries].reverse().find((e) => e && e.mode === 'live') || last
  const fmt = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : String(v))
  const steady = fmt(latest.steadyStateHitRate)
  const mean = fmt(latest.meanHitRate)
  const cached = Number(latest.cachedTokens) || 0
  const approx = cached >= 1000 ? `${(cached / 1000).toFixed(1)}k` : String(cached)
  el.textContent = T(`运行 ${entries.length} 次 · 最近 steady ${steady}% · mean ${mean}% · cached≈${approx}/call`,
                     `${entries.length} runs · latest steady ${steady}% · mean ${mean}% · cached≈${approx}/call`)
}

/* ─────────── 状态图检查站（KI-622 · StateGraph 实跑可视化）─────────── */
const SG_NODES = [
  { id: 'loadWorld', zh: '加载世界快照', en: 'Load world' },
  { id: 'retrieveCanon', zh: 'RAG 检索 canon', en: 'Retrieve canon' },
  { id: 'warmup', zh: '预热前缀缓存', en: 'Warmup prefix' },
  { id: 'audit', zh: '一致性审计', en: 'Consistency audit', llm: true },
  { id: 'proposeTransitions', zh: '状态流转提案', en: 'Transitions', llm: true },
  { id: 'draftContent', zh: '下一篇草稿', en: 'Draft next', llm: true },
  { id: 'editorialGate', zh: 'canon 编辑闸门', en: 'Editorial gate', llm: true },
  { id: 'writeArtifacts', zh: '落盘产物', en: 'Write artifacts' },
]

async function renderStateGraph() {
  const svg = document.getElementById('sg-graph')
  if (!svg) return
  const err = document.getElementById('sg-error')
  let d
  try {
    const r = await fetch('./ai-director-latest.json', { cache: 'no-store' })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    d = await r.json()
  } catch (e) {
    err.textContent = T('读取 ai-director-latest.json 失败：', 'Failed to load ai-director-latest.json: ') + String((e && e.message) || e)
    err.hidden = false
    return
  }
  err.hidden = true
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v) }
  const u = d.usage || {}
  const checks = new Map((d.graphCheckpoints || []).map((c) => [c.node, c]))
  const total = (d.graphCheckpoints || []).reduce((n, c) => n + (Number(c.ms) || 0), 0)
  setText('sg-corpus', d.corpusSize ?? 0)
  setText('sg-calls', u.calls ?? 0)
  setText('sg-cached', u.cachedTokens ?? 0)
  setText('sg-total', total)

  clearSvg(svg)
  const SVGNS = 'http://www.w3.org/2000/svg'
  const defs = svgEl('defs', {}, svg)
  const marker = svgEl('marker', { id: 'sg-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, defs)
  svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'rgba(201,180,88,.55)' }, marker)

  const BOX_W = 108
  const BOX_H = 62
  const GAP = 12
  const TOTAL = SG_NODES.length
  const startX = (980 - (TOTAL * BOX_W + (TOTAL - 1) * GAP)) / 2
  const Y = 88
  for (let i = 0; i < TOTAL; i += 1) {
    const node = SG_NODES[i]
    const x = startX + i * (BOX_W + GAP)
    const cp = checks.get(node.id)
    const ok = cp ? cp.ok !== false : null
    const ms = cp ? Number(cp.ms) || 0 : null

    if (i < TOTAL - 1) {
      svgEl('line', { x1: x + BOX_W + 1, y1: Y + BOX_H / 2, x2: x + BOX_W + GAP - 1, y2: Y + BOX_H / 2, stroke: 'rgba(201,180,88,.5)', 'stroke-width': 1.6, 'marker-end': 'url(#sg-arrow)' }, svg)
    }

    const g = svgEl('g', {}, svg)
    svgEl('rect', { x, y: Y, width: BOX_W, height: BOX_H, rx: 9, fill: ok === false ? 'rgba(165,68,82,.24)' : 'rgba(201,180,88,.10)', stroke: ok === false ? '#a54452' : '#c9b458', 'stroke-width': 1.2, 'stroke-dasharray': node.llm ? '4 3' : 'none' }, g)
    const label = T(node.zh, node.en)
    const t1 = svgEl('text', { x: x + BOX_W / 2, y: Y + 22, 'text-anchor': 'middle', fill: '#e8dfc2', 'font-size': 11.5, 'font-family': '"Noto Serif SC","Songti SC",Georgia,serif' }, g)
    t1.textContent = label
    if (node.llm) {
      const tag = svgEl('text', { x: x + BOX_W / 2, y: Y + 38, 'text-anchor': 'middle', fill: '#4f9b86', 'font-size': 8.5, 'font-family': 'Consolas, monospace', 'letter-spacing': 2 }, g)
      tag.textContent = 'LLM'
    } else {
      const tag = svgEl('text', { x: x + BOX_W / 2, y: Y + 38, 'text-anchor': 'middle', fill: '#6f7684', 'font-size': 8.5, 'font-family': 'Consolas, monospace', 'letter-spacing': 2 }, g)
      tag.textContent = T('状态图', 'Graph')
    }
    // checkpoint 徽章 + 耗时
    svgEl('circle', { cx: x + BOX_W / 2, cy: Y + BOX_H + 16, r: 8.5, fill: ok === false ? '#a54452' : '#2e4a3f', stroke: ok === false ? '#d88a8a' : '#4f9b86', 'stroke-width': 1 }, g)
    const check = svgEl('text', { x: x + BOX_W / 2, y: Y + BOX_H + 19.5, 'text-anchor': 'middle', fill: '#dff3ea', 'font-size': 9, 'font-family': 'Consolas, monospace' }, g)
    check.textContent = ok === false ? '✗' : '✓'
    const t2 = svgEl('text', { x: x + BOX_W / 2, y: Y + BOX_H + 33, 'text-anchor': 'middle', fill: '#8b93a1', 'font-size': 8.5, 'font-family': 'Consolas, monospace' }, g)
    t2.textContent = ms === null ? '—' : `${ms.toLocaleString()}ms`
  }

  const legend = svgEl('text', { x: 490, y: 236, 'text-anchor': 'middle', fill: '#6f7684', 'font-size': 8, 'font-family': 'Consolas, monospace', 'letter-spacing': 1.5 }, svg)
  legend.textContent = '— LLM 边共享同一 system 前缀（prompt_cache_key 按前缀派生）· 绿 ✓ = 该检查点 ok · 虚线框 = LLM 节点'
}

/* ─────────── 研发状态（KI-630 · Build Observatory）─────────── */
async function renderBuild() {
  const svgless = document.getElementById('panel-build')
  if (!svgless) return
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v) }
  const setBar = (id, frac) => { const el = document.getElementById(id); if (el) el.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%` }
  /* A — site-latest.json：仓展示面板的唯一真相源（与 hub fallback 同一份） */
  try {
    const r = await fetch(`https://raw.githubusercontent.com/xiaodernan/caesura/master/site-latest.json?ts=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const d = await r.json()
    const kv = (d && d.kv) || {}
    const kiRows = Number(kv['KI.rows']) || 0
    const kiImpl = Number(kv['KI.Implemented']) || 0
    const sysRows = Number(kv['SYS.rows']) || 0
    const sysImpl = Number(kv['SYS.Implemented']) || 0
    setText('build-head', `master @ ${String(d.head || '').slice(0, 7)}`)
    setBar('build-ki-bar', kiRows > 0 ? kiImpl / kiRows : 0)
    setBar('build-sys-bar', sysRows > 0 ? sysImpl / sysRows : 0)
    setText('build-ki-num', `${kiImpl} / ${kiRows} · ${kiRows > 0 ? Math.round((kiImpl / kiRows) * 100) : 0}%`)
    setText('build-sys-num', `${sysImpl} / ${sysRows} · ${sysRows > 0 ? Math.round((sysImpl / sysRows) * 100) : 0}%`)
    setText('build-scripts-num', `PKG.scripts ${kv['PKG.scripts'] ?? '—'} · devDeps ${kv['PKG.devDeps'] ?? '—'} · ARCH.sections ${kv['ARCH.sections'] ?? '—'}`)
    setText('build-updated', d.date ? String(d.date).slice(0, 19).replace('T', ' ') : '—')
  } catch (error) {
    setText('build-head', 'site-latest.json 不可达')
    setText('build-ki-num', '— / —')
    setText('build-sys-num', '— / —')
  }
  /* B — GitHub Actions API：最近 8 条运行，公网只读，无需凭证 */
  const runsEl = document.getElementById('build-runs')
  const errEl = document.getElementById('build-error')
  try {
    const r = await fetch('https://api.github.com/repos/xiaodernan/caesura/actions/runs?branch=master&per_page=8', { cache: 'no-store' })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const d = await r.json()
    const runs = Array.isArray(d.workflow_runs) ? d.workflow_runs.slice(0, 5) : []
    runsEl.replaceChildren(...runs.map((run) => {
      const li = document.createElement('li')
      const concluded = String(run.conclusion || '')
      const status = String(run.status || '')
      const ok = concluded === 'success'
      const fail = concluded === 'failure' || concluded === 'timed_out' || concluded === 'cancelled'
      li.className = `build-run${ok ? ' ok' : fail ? ' fail' : ' run'}`
      const name = document.createElement('b')
      name.textContent = String(run.name || 'workflow').trim()
      const meta = document.createElement('span')
      const sha = String(run.head_sha || '').slice(0, 7)
      const dt = run.created_at ? String(run.created_at).slice(5, 16).replace('T', ' ') : ''
      const when = dt ? `${dt.slice(0, 5)} ${dt.slice(6)}` : ''
      meta.textContent = `${ok ? '✓' : fail ? '✗' : '○'} ${sha} · ${when}`
      const link = document.createElement('a')
      link.href = run.html_url || 'https://github.com/xiaodernan/caesura/actions'
      link.target = '_blank'
      link.rel = 'noreferrer'
      link.textContent = '→'
      link.setAttribute('aria-label', `open run ${sha}`)
      li.append(name, meta, link)
      return li
    }))
    errEl.hidden = true
  } catch {
    runsEl.replaceChildren()
    errEl.textContent = T('读不到公网 CI 状态（网络 / rate-limit）——上面现状仍然有效。', 'Could not reach the public CI feed (network / rate-limit) — the snapshot on the left still holds.')
    errEl.hidden = false
  }
}

/* ─────────── 先验审计（KI-636 · Priors Audit）─────────── */
async function renderPriors() {
  const root = document.getElementById('panel-priors')
  if (!root) return
  const vEl = document.getElementById('priors-verdicts')
  const isEn = LANG === 'en'
  let d
  try {
    const r = await fetch('./admin-priors-audit.json', { cache: 'no-store' })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    d = await r.json()
  } catch (e) {
    vEl.replaceChildren(makeEl('p', 'priors-err', T('读取 admin-priors-audit.json 失败：', 'Failed to load admin-priors-audit.json: ') + String(e?.message ?? e)))
    return
  }
  /* 渲染 4 条 verdict */
  vEl.replaceChildren(...(d.verdicts ?? []).map((v) => {
    const row = makeEl('div', `priors-row priors-${v.verdict}`)
    const icon = makeEl('span', 'priors-icon', v.verdict === 'plausible' ? '✓' : v.verdict === 'strained' ? '△' : '✗')
    const content = makeEl('div', 'priors-content')
    const title = makeEl('div', 'priors-title', isEn ? v.label : v.label.split(' / ')[0])
    const why = makeEl('p', 'priors-why', isEn ? v.whyEn : v.whyZh)
    const badge = makeEl('span', `priors-badge priors-badge-${v.verdict}`, v.verdict.toUpperCase())
    content.append(title, why)
    row.append(icon, content, badge)
    return row
  }))
  /* 注入 overall */
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '—' }
  setText('priors-overall-zh', d.overall?.verdictZh)
  setText('priors-overall-en', d.overall?.verdictEn)
  setText('priors-sens-zh', d.sensitivity?.zh)
  setText('priors-sens-en', d.sensitivity?.en)
  setText('priors-ready-zh', d.overall?.readyZh)
  setText('priors-ready-en', d.overall?.readyEn)
  setText('priors-calls', d.usage?.calls)
  setText('priors-cached', d.usage?.cachedTokens)
  setText('priors-date', String(d.generatedAt || '').slice(0, 10))
  /* zh-TW / zh 保持 zh-only · en 保持 en-only */
  document.querySelectorAll('.priors-overall-zh').forEach((el) => { el.hidden = isEn })
  document.querySelectorAll('.priors-overall-en').forEach((el) => { el.hidden = !isEn })
}

/* ─────────── 趋势研判（KI-645 · Forecast）─────────── */
async function renderForecast() {
  const root = document.getElementById('panel-forecast')
  if (!root) return
  const vEl = document.getElementById('forecast-actions')
  const isEn = LANG === 'en'
  let d
  try {
    const r = await fetch('./admin-trend-forecast.json', { cache: 'no-store' })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    d = await r.json()
  } catch (e) {
    vEl.replaceChildren(makeEl('p', 'priors-err', T('读取 admin-trend-forecast.json 失败：', 'Failed to load admin-trend-forecast.json: ') + String(e?.message ?? e)))
    return
  }
  /* 渲染 4 条 action */
  const effortLabel = (e) => (isEn ? (e === 'S' ? 'small' : e === 'M' ? 'medium' : 'large') : (e === 'S' ? '小' : e === 'M' ? '中' : '大'))
  const impactLabel = (i) => (isEn ? i.toUpperCase() : (i === 'high' ? '高影响' : i === 'medium' ? '中影响' : '低影响'))
  vEl.replaceChildren(...(d.actions ?? []).map((a) => {
    const row = makeEl('div', 'priors-row forecast-row')
    const icon = makeEl('span', 'priors-icon', String(a.seq ?? '·'))
    const content = makeEl('div', 'priors-content')
    const title = makeEl('div', 'priors-title', isEn ? a.actionEn : a.actionZh)
    const why = makeEl('p', 'priors-why', isEn ? a.rationaleEn : a.rationaleZh)
    const meta = makeEl('div', 'forecast-meta')
    meta.append(
      makeEl('span', `forecast-badge forecast-impact-${a.impact || 'medium'}`, impactLabel(a.impact || 'medium')),
      makeEl('span', `forecast-badge forecast-effort-${(a.effort || 'M').toLowerCase()}`, (a.effort || 'M') + ' · ' + effortLabel(a.effort || 'M')),
      makeEl('span', 'forecast-metric', String(a.metric ?? '')),
    )
    const risk = makeEl('p', 'forecast-risk', T('风险：', 'Risk: ') + (isEn ? a.riskEn : a.riskZh))
    content.append(title, why, meta, risk)
    row.append(icon, content)
    return row
  }))
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '—' }
  setText('forecast-summary-zh', d.summary?.zh)
  setText('forecast-summary-en', d.summary?.en)
  setText('forecast-cohort-zh', d.riskiestCohort?.zh)
  setText('forecast-cohort-en', d.riskiestCohort?.en)
  setText('forecast-sens-zh', d.sensitivity?.zh)
  setText('forecast-sens-en', d.sensitivity?.en)
  setText('forecast-calls', d.usage?.calls)
  setText('forecast-cached', d.usage?.cachedTokens)
  setText('forecast-date', String(d.generatedAt || '').slice(0, 10))
  document.querySelectorAll('#panel-forecast .priors-overall-zh').forEach((el) => { el.hidden = isEn })
  document.querySelectorAll('#panel-forecast .priors-overall-en').forEach((el) => { el.hidden = !isEn })
}

/* ─────────── 方法论 ─────────── */
function renderMethod() {
  const m = TELEMETRY.meta
  $('#method-note').textContent = T(m.noteZh, m.noteEn)
  $('#method-refs').innerHTML = m.refs.map((r) => `<li><b>${T(r.labelZh, r.labelEn)}</b> — ${r.detail}</li>`).join('')
  $('#method-disclaimer').textContent = T(m.disclaimerZh, m.disclaimerEn)
}

/* ─────────── 总渲染 + 时钟 ─────────── */
function renderAll() {
  renderKpis(); renderTrend(); renderFunnel(); renderChannels(); renderDevices()
  renderHours(); renderCohorts(); renderAnomalies(); renderExits(); renderRecs()
  renderLive(); renderMethod(); renderAiCommitted(); hydrateAiLive(); renderStateGraph(); renderBuild(); renderPriors(); renderForecast(); renderCacheMetrics();
}
function tickClock() {
  const t = new Date()
  $('#clock').textContent = [t.getHours(), t.getMinutes(), t.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':')
}

/* ─────────── 启动 ─────────── */
$('#lang-toggle').addEventListener('click', () => setLang(LANG === 'zh' ? 'zh-TW' : (LANG === 'zh-TW' ? 'en' : 'zh')))
$('#gate-form').addEventListener('submit', (e) => { e.preventDefault(); tryUnlock($('#gate-input').value.trim()) })
$('#export-csv').addEventListener('click', exportCsv)
$('#export-json').addEventListener('click', exportJson)
$('#export-ai').addEventListener('click', exportAiMemo)
$('#copy-digest').addEventListener('click', copyDigest)
$('#live-export').addEventListener('click', () => {
  const doc = readLocalTelemetry()
  if (!doc) { note(T('本机暂无数据', 'No local data yet')); return }
  download('caesura_analytics_local.json', JSON.stringify(doc, null, 2), 'application/json;charset=utf-8')
  note('caesura_analytics_local.json')
})
$('#live-clear').addEventListener('click', () => {
  try { localStorage.removeItem(TELEMETRY_KEY) } catch { /* noop */ }
  renderLive()
  note(T('本机记录已清空', 'Local records cleared'))
})
$('#ai-live-form')?.addEventListener('submit', runAiLive)

// ?key=123 一键入内；已解锁则直接进
const params = new URLSearchParams(location.search)
const preAuthed = (params.get('key') === '123') || (() => { try { return sessionStorage.getItem('caesura-admin-ok') === '1' } catch { return false } })()
if (preAuthed) {
  $('#gate').hidden = true
  $('#deck').hidden = false
}
applyI18n()
if (preAuthed) renderAll()
tickClock()
setInterval(tickClock, 1000)
