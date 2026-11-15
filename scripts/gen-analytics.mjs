/**
 * scripts/gen-analytics.mjs — 生成 admin/data.js（止音后台 · 模拟队列 v1）
 *
 * 为什么模拟：静态托管没有跨用户上报通道；玩家进程零 LLM 也零网络请求。
 * 模拟队列是公开研究先验 + 固定 PRNG 种子的合成数据，用来演示/教学/压测分析引擎；
 * 任何样本都可用 `node scripts/gen-analytics.mjs` 原样复算（幂等到字节）。
 *
 * 先验参考（公开研究，作为生成参数区间，**不是**本项目的真实遥测）：
 *   - Baymard Institute：平均购物车放弃率 70.22%（2026-10-28 更新，50 项研究 2006–2025 非加权均值）→ 漏斗大幅流失的暮尺度
 *   - Nielsen Norman Group：用户在 ~10 秒内决定去留；约五分之一的人立即离开
 *   - Contentsquare Experience Benchmark 2024/25：平均跳出率 ≈ 49–50%；平均会话 ≈ 52–55 秒
 *   - StatCounter Global Stats 2025：移动端 Web 流量占比 ≈ 62%
 * 真实用户数据见「本机实况」面板（localStorage，`caesura.telemetry.v1`）。
 *
 * 用法：node scripts/gen-analytics.mjs
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mulberry32, mean } from '../admin/analytics.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'admin', 'data.js')
const SEED = 20261115
const DAYS = 30
const END = new Date('2026-11-15T00:00:00Z')

const rand = mulberry32(SEED)
const r2 = (x) => Math.round(x * 100) / 100

/* ---------- 日粒度序列 ---------- */
const daily = []
for (let i = DAYS - 1; i >= 0; i--) {
  const d = new Date(END.getTime() - i * 86400000)
  const dow = d.getUTCDay() // 0 Sun
  const weekend = (dow === 0 || dow === 6) ? 1.27 : 1.0
  const growth = 1 + (DAYS - 1 - i) * 0.021
  const base = 118 * growth
  const noise = 0.84 + rand() * 0.33
  const sessions = Math.round(base * weekend * noise)
  const newUserShare = 0.30 + rand() * 0.09
  const endRate = 0.058 + rand() * 0.014 + (weekend - 1) * 0.008
  daily.push({
    date: d.toISOString().slice(0, 10),
    sessions,
    newUsers: Math.round(sessions * newUserShare),
    bounce: r2(0.55 + 0.085 * Math.sin((DAYS - 1 - i) * 0.63 + 0.4) + (rand() - 0.5) * 0.05),
    avgDurationSec: Math.round(84 + 30 * Math.sin((DAYS - 1 - i) * 0.52 + 1.15) + (rand() - 0.5) * 18),
    pageViews: Math.round(sessions * (2.3 + rand() * 0.9)),
    endings: Math.round(sessions * endRate),
    marks: Math.round(sessions * (0.225 + rand() * 0.03)),
    storyFinishes: Math.round(sessions * (0.145 + rand() * 0.03)),
  })
}
// daily 已按老→新排列（i 从 29 降到 0）
const sum = (k) => daily.reduce((s, d) => s + d[k], 0)
const totalSessions = sum('sessions')

/* ---------- 漏斗（期间总量） ---------- */
const funnel = {
  steps: [
    { id: 'landed', labelZh: '抵达首页', labelEn: 'Landed', count: totalSessions },
    { id: 'pressed-start', labelZh: '按下开始', labelEn: 'Pressed start', count: Math.round(totalSessions * 0.585) },
    { id: 'in-world', labelZh: '进入世界', labelEn: 'Entered the world', count: 0 },
    { id: 'atlas-open', labelZh: '打开游记/谱册', labelEn: 'Opened Atlas / Codex', count: 0 },
    { id: 'chapter-finish', labelZh: '读完一篇正文', labelEn: 'Finished a chapter', count: 0 },
    { id: 'ending', labelZh: '抵达结局', labelEn: 'Reached an ending', count: 0 },
  ],
}
funnel.steps[2].count = Math.round(funnel.steps[1].count * 0.815)
funnel.steps[3].count = Math.round(funnel.steps[2].count * 0.435)
funnel.steps[4].count = Math.round(funnel.steps[3].count * 0.655)
funnel.steps[5].count = Math.round(funnel.steps[4].count * 0.425)

/* ---------- 渠道 / 设备 / 语言 ---------- */
const channels = [
  { id: 'direct', labelZh: '直接访问', labelEn: 'Direct', share: 0.38, endingRate: 0.079 },
  { id: 'github', labelZh: 'GitHub 仓库', labelEn: 'GitHub repo', share: 0.21, endingRate: 0.061 },
  { id: 'hub', labelZh: '个人主页引流', labelEn: 'Personal hub', share: 0.17, endingRate: 0.098 },
  { id: 'search', labelZh: '搜索引擎', labelEn: 'Search', share: 0.12, endingRate: 0.032 },
  { id: 'social', labelZh: '社媒/论坛', labelEn: 'Social / forums', share: 0.07, endingRate: 0.044 },
  { id: 'other', labelZh: '其他', labelEn: 'Other', share: 0.05, endingRate: 0.027 },
].map((c) => ({ ...c, sessions: Math.round(c.share * totalSessions) }))

const devices = [
  { id: 'mobile', labelZh: '手机', labelEn: 'Mobile', share: 0.58, endingRate: 0.052, avgDurationSec: 74 },
  { id: 'desktop', labelZh: '桌面', labelEn: 'Desktop', share: 0.37, endingRate: 0.094, avgDurationSec: 132 },
  { id: 'tablet', labelZh: '平板', labelEn: 'Tablet', share: 0.05, endingRate: 0.061, avgDurationSec: 95 },
]

const locales = [
  { id: 'zh', labelZh: '中文', labelEn: 'Chinese', share: 0.71 },
  { id: 'en', labelZh: '英文', labelEn: 'English', share: 0.29 },
]

/* ---------- 24 小时分布（权重归一化为 1） ---------- */
const hourWeights = [
  0.024, 0.011, 0.005, 0.002, 0.001, 0.002, 0.004, 0.008,
  0.014, 0.022, 0.033, 0.041, 0.047, 0.045, 0.041, 0.038,
  0.036, 0.035, 0.041, 0.055, 0.076, 0.081, 0.098, 0.050,
]
const hourSum = hourWeights.reduce((s, x) => s + x, 0)
const hourly = hourWeights.map((w, h) => ({ h, share: Number((w / hourSum).toFixed(4)) }))

/* ---------- 周队列留存（null = 尚未到期） ---------- */
const cohorts = [
  { id: 'W-041', labelZh: '10/18 当周', labelEn: 'Week of Oct 18', size: 812, d1: 0.17, d3: 0.120, d7: 0.076, d14: 0.048, d30: 0.028 },
  { id: 'W-042', labelZh: '10/25 当周', labelEn: 'Week of Oct 25', size: 733, d1: 0.18, d3: 0.125, d7: 0.080, d14: 0.052, d30: 0.031 },
  { id: 'W-043', labelZh: '11/01 当周', labelEn: 'Week of Nov 01', size: 905, d1: 0.19, d3: 0.135, d7: 0.088, d14: 0.058, d30: 0.035 },
  { id: 'W-044', labelZh: '11/08 前半段', labelEn: 'Early Nov (1st half)', size: 1021, d1: 0.20, d3: 0.142, d7: 0.096, d14: 0.063, d30: null },
  { id: 'W-045', labelZh: '11/09 当周', labelEn: 'Week of Nov 09', size: 945, d1: 0.22, d3: 0.158, d7: 0.108, d14: null, d30: null },
  { id: 'W-046', labelZh: '11/15 当周', labelEn: 'Week of Nov 15', size: 1105, d1: 0.24, d3: 0.171, d7: null, d14: null, d30: null },
]

/* ---------- 页面级指标（含 rage-click 热点） ---------- */
const pages = [
  { path: '/', labelZh: '游戏入口', labelEn: 'Game entry', views: Math.round(totalSessions * 1.06), avgTimeSec: 38, bounce: 0.63, exitShare: 0.34, rageClicks: 187 },
  { path: '/tutorial/', labelZh: '入门教程', labelEn: 'Tutorial', views: 1166, avgTimeSec: 244, bounce: 0.31, exitShare: 0.08, rageClicks: 24 },
  { path: '/cast/', labelZh: '角色图鉴', labelEn: 'Cast roster', views: 640, avgTimeSec: 128, bounce: 0.44, exitShare: 0.06, rageClicks: 12 },
  { path: '/codex/', labelZh: '世界谱', labelEn: 'World codex', views: 512, avgTimeSec: 176, bounce: 0.47, exitShare: 0.09, rageClicks: 96 },
  { path: '/story/', labelZh: '《盐》', labelEn: 'Story · Salt', views: 1468, avgTimeSec: 402, bounce: 0.29, exitShare: 0.07, rageClicks: 31 },
  { path: '/story/ledger/', labelZh: '《账本》', labelEn: 'Story · The Ledger', views: 402, avgTimeSec: 118, bounce: 0.38, exitShare: 0.11, rageClicks: 213 },
  { path: '/story/first-bell/', labelZh: '《第一钟》', labelEn: 'Story · The First Bell', views: 388, avgTimeSec: 342, bounce: 0.33, exitShare: 0.10, rageClicks: 18 },
  { path: '/story/tribunal/', labelZh: '《雨审判》', labelEn: 'Story · The Rain Tribunal', views: 301, avgTimeSec: 388, bounce: 0.31, exitShare: 0.05, rageClicks: 15 },
  { path: '/story/frostbell/', labelZh: '《霜锤》', labelEn: 'Story · The Frost Hammer', views: 240, avgTimeSec: 297, bounce: 0.36, exitShare: 0.06, rageClicks: 9 },
  { path: '/console/', labelZh: '调度台（运维）', labelEn: 'Console (ops)', views: 686, avgTimeSec: 61, bounce: 0.71, exitShare: 0.19, rageClicks: 41 },
  { path: '/admin/', labelZh: '后台观察站', labelEn: 'Admin observatory', views: 96, avgTimeSec: 162, bounce: 0.78, exitShare: 0.05, rageClicks: 2 },
]

/* ---------- 总量 ---------- */
const totals = {
  sessions: totalSessions,
  newUsers: sum('newUsers'),
  returning: totalSessions - sum('newUsers'),
  endings: sum('endings'),
  pageViews: sum('pageViews'),
  marks: sum('marks'),
  storyFinishes: sum('storyFinishes'),
}

/* ---------- 自校验不变量（生成即验，违约直接抛） ---------- */
const fail = (msg) => { throw new Error('[gen-analytics] invariant violated: ' + msg) }
for (const d of daily) {
  if (!(d.bounce >= 0 && d.bounce <= 1)) fail('bounce out of range @ ' + d.date)
  if (!(d.endings >= 0 && d.endings <= d.sessions)) fail('endings > sessions @ ' + d.date)
}
const fcounts = funnel.steps.map((s) => s.count)
for (let i = 1; i < fcounts.length; i++) {
  if (!(fcounts[i] <= fcounts[i - 1])) fail('funnel not decreasing at step ' + i)
}
if (fcounts[0] !== totalSessions) fail('funnel[0] != totalSessions')
const hourTotal = hourly.reduce((s, h) => s + h.share, 0)
if (Math.abs(hourTotal - 1) > 0.02) fail('hourly share must ≈1, got ' + hourTotal)
for (const c of cohorts) {
  const seq = [c.d1, c.d3, c.d7, c.d14, c.d30].filter((x) => x !== null && x !== undefined)
  for (let i = 1; i < seq.length; i++) if (seq[i] > seq[i - 1] + 1e-9) fail('cohort not decreasing @ ' + c.id)
}
if (Math.abs(channels.reduce((s, c) => s + c.share, 0) - 1) > 1e-9) fail('channel shares must sum to 1')
if (Math.abs(devices.reduce((s, c) => s + c.share, 0) - 1) > 1e-9) fail('device shares must sum to 1')
if (mean(cohorts.map((c) => c.d1)) >= 0.22) fail('d1 must stay under the P1 threshold for the demo dataset')

/* ---------- 产出 ---------- */
const payload = {
  meta: {
    schema: 1,
    generatedAt: '2026-11-15T12:00:00+08:00',
    seed: SEED,
    days: DAYS,
    startDate: daily[0].date,
    endDate: daily[daily.length - 1].date,
    cohortKind: 'simulated',
    noteZh: '本面板的聚合数据是固定种子（20261115）可复现的模拟队列：公开研究先验区间 × 30 天 × 4 次重算一致。它用来校准分析引擎与教学演示；本机实况（localStorage）展示的是你这台浏览器真实发生的一切。',
    noteEn: 'Aggregate figures are a reproducible simulated cohort (seed 20261115): public-research prior bands × 30 days × byte-identical regeneration. It calibrates the analysis engine and serves as a walkthrough; “Live (this browser)” below shows what actually happened on this device.',
    refs: [
      { labelZh: 'Baymard Institute · 平均购物车放弃率 70.22%', labelEn: 'Baymard Institute · avg. cart abandonment 70.22%', detail: '2026-10-28 更新 · 50 项研究 2006–2025 · 非加权均值，先验带：漏斗会大幅流失。' },
      { labelZh: 'Nielsen Norman Group · 10 秒法则', labelEn: 'Nielsen Norman Group · the 10-second rule', detail: '≈ 五分之一用户在首屏立即离开 / ~1 in 5 leaves at first paint. Prior band for bounce.' },
      { labelZh: 'Contentsquare Experience Benchmark 2024/25 · 跳出 ≈ 49–50% · 会话 ≈ 52–55 秒', labelEn: 'Contentsquare Experience Benchmark 2024/25 · bounce ≈ 49–50% · session ≈ 52–55s', detail: '行业指纹 / Industry fingerprint used as sanity band.' },
      { labelZh: 'StatCounter Global Stats 2025 · 移动端 ≈ 62%', labelEn: 'StatCounter Global Stats 2025 · mobile ≈ 62%', detail: '移动端流量权重 / Mobile traffic weight for the device mix.' },
    ],
    disclaimerZh: '模拟数据不构成真实用户统计；上线后若接入后端上报（Spring 调度台 report 服务 8082），本页可直接替换数据源为真实流。',
    disclaimerEn: 'Simulated figures are not real user statistics. Once backend telemetry is wired (Spring report @8082), this deck can drop-in swap to live data.',
  },
  daily,
  totals,
  funnel,
  channels,
  devices,
  locales,
  hourly,
  cohorts,
  pages,
}

const body =
  '/**\n' +
  ' * admin/data.js — 止音后台 · 模拟队列 v1（scripts/gen-analytics.mjs 生成 · 固定种子 · 勿手改）\n' +
  ' * The Epoch of Hush — admin observatory · simulated cohort v1 (generated; do not hand-edit)\n' +
  ' */\n' +
  'export const TELEMETRY = ' + JSON.stringify(payload, null, 2) + '\n'

writeFileSync(OUT, body, 'utf8')
console.log('[gen-analytics] written', OUT, '·', (body.length / 1024).toFixed(1) + ' KB', '· sessions=' + totalSessions, '· endings=' + totals.endings, '· funnelOverall=' + ((funnel.steps[5].count / totalSessions) * 100).toFixed(1) + '%')
