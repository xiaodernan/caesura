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
  'export.digest': { zh: '复制运营日报', en: 'Copy ops digest' },
  'method.h2': { zh: '方法论 · 这页数的家底', en: 'Methodology · where these numbers come from' },
  'method.fine2': { zh: '玩家进程零 LLM · 零网络请求；本后台同上。真实用户流量接入 Spring report（@8082）后，可整体替换数据源而不动本页分析逻辑。', en: 'The game process has zero LLM calls and zero network; this deck is the same. Once real telemetry is wired through the Spring report service (@8082), the data source can be swapped wholesale without touching the analysis here.' },
  'method.fine3': { zh: '刻意公开的门禁 · 密码 123 · KI-583。', en: 'The door is public on purpose · passphrase 123 · KI-583.' },
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
  const mins = Math.max(1, Math.round((Date.now() - (doc.firstSeen ?? Date.now())) / 60000))
  const statsHtml = [
    { n: num(doc.events.length), l: T('事件总数', 'events') },
    { n: num(paths.size), l: T('到访页面数', 'pages seen') },
    { n: String(pageviews), l: T('页面浏览', 'page views') },
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
  renderLive(); renderMethod()
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
