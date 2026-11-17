/**
 * tests/unit/admin-analytics.test.mjs — 止音后台 · 分析引擎 & 数据契约（KI-583）
 * 守住三件事：
 *  1) admin/analytics.mjs 的纯函数是对的（回归/均线/异常/漏斗/外推）；
 *  2) admin/data.js 的模拟队列自洽（不变量与生成器一致）；
 *  3) admin/ 静态页 + 部署接线 + 全站埋点不会悄悄脱落。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import {
  mulberry32, mean, std, movingAverage, linearRegression, forecast,
  anomalies, funnelRates, pct, deriveRecommendations,
} from '../../admin/analytics.mjs'
import { TELEMETRY } from '../../admin/data.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('analytics · mulberry32 可复现', () => {
  it('同一种子 ⇒ 同一序列', () => {
    const a = mulberry32(20261115), b = mulberry32(20261115)
    for (let i = 0; i < 50; i++) expect(a()).toBe(b())
  })
  it('不同种子 ⇒ 序列不同', () => {
    const a = mulberry32(1), b = mulberry32(2)
    const seqA = Array.from({ length: 10 }, () => a())
    const seqB = Array.from({ length: 10 }, () => b())
    expect(seqA).not.toEqual(seqB)
  })
  it('输出落在 [0,1)', () => {
    const a = mulberry32(42)
    for (let i = 0; i < 500; i++) { const v = a(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1) }
  })
})

describe('analytics · 基础统计量', () => {
  it('mean / std', () => {
    expect(mean([2, 4, 6])).toBe(4)
    expect(mean([])).toBe(0)
    expect(std([5, 5, 5, 5])).toBe(0)
    expect(std([2, 4, 6])).toBeCloseTo(Math.sqrt(8 / 3), 6)
  })
  it('movingAverage 窗口行为（头部不足窗口用已有样本）', () => {
    expect(movingAverage([10, 20, 30, 40], 2)).toEqual([10, 15, 25, 35])
    expect(movingAverage([10, 20, 30], 10)).toEqual([10, 15, 20])
  })
  it('线性回归：完美直线斜率与 R²', () => {
    const { slope, intercept, r2 } = linearRegression([0, 1, 2, 3], [1, 3, 5, 7])
    expect(slope).toBeCloseTo(2, 9)
    expect(intercept).toBeCloseTo(1, 9)
    expect(r2).toBeCloseTo(1, 9)
  })
  it('pct 输出带百分号且一致', () => {
    expect(pct(0.5, 1)).toBe('50.0%')
    expect(pct(1, 0)).toBe('100%')
  })
})

describe('analytics · 外推与异常', () => {
  it('forecast：7 个点、方向跟随斜率', () => {
    const fc = forecast([100, 110, 120, 130, 140, 150, 160, 170], { lookback: 14, horizon: 7 })
    expect(fc.points).toHaveLength(7)
    expect(fc.slope).toBeGreaterThan(0)
    expect(fc.r2).toBeGreaterThan(0.99)
    expect(fc.points[6]).toBeGreaterThan(fc.points[0])
  })
  it('forecast：下降序列斜率为负', () => {
    const fc = forecast([300, 280, 260, 240, 220, 200, 180, 160], { lookback: 14, horizon: 7 })
    expect(fc.slope).toBeLessThan(0)
  })
  it('anomalies：注入尖刺会被点名', () => {
    const series = Array.from({ length: 30 }, () => 150)
    series[17] = 260
    const found = anomalies(series, 1.8)
    expect(found.map((a) => a.index)).toContain(17)
    expect(found[0].direction).toBe('up')
  })
  it('anomalies：平稳序列无异常', () => {
    expect(anomalies([100, 101, 99, 100, 102, 98], 1.8)).toHaveLength(0)
  })
})

describe('analytics · 漏斗', () => {
  it('逐步转化率与整体完读率', () => {
    const steps = [
      { id: 'a', count: 1000 }, { id: 'b', count: 600 }, { id: 'c', count: 300 },
    ]
    const { stepRates, overall } = funnelRates(steps)
    expect(stepRates[0]).toBeCloseTo(0.6, 9)
    expect(stepRates[1]).toBeCloseTo(0.5, 9)
    expect(overall).toBeCloseTo(0.3, 9)
  })
})

describe('analytics · TELEMETRY 模拟队列自洽（与生成器不变量同一套）', () => {
  const d = TELEMETRY.daily
  it('30 天、老→新、ISO 日期', () => {
    expect(d).toHaveLength(30)
    for (const day of d) expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    for (let i = 1; i < d.length; i++) expect(d[i].date > d[i - 1].date).toBe(true)
    expect(d[0].date).toBe('2026-10-17')
    expect(d[d.length - 1].date).toBe('2026-11-15')
  })
  it('totals 是 daily 之和', () => {
    const sum = (k: 'sessions' | 'newUsers' | 'endings' | 'pageViews' | 'marks' | 'storyFinishes') =>
      d.reduce((s: number, x) => s + x[k], 0)
    expect(TELEMETRY.totals.sessions).toBe(sum('sessions'))
    expect(TELEMETRY.totals.newUsers).toBe(sum('newUsers'))
    expect(TELEMETRY.totals.endings).toBe(sum('endings'))
    expect(TELEMETRY.totals.returning).toBe(TELEMETRY.totals.sessions - TELEMETRY.totals.newUsers)
  })
  it('漏斗严格单调降且首步等于总会话', () => {
    const cs = TELEMETRY.funnel.steps.map((s) => s.count)
    expect(cs[0]).toBe(TELEMETRY.totals.sessions)
    for (let i = 1; i < cs.length; i++) expect(cs[i]).toBeLessThanOrEqual(cs[i - 1])
  })
  it('小时分布归一（±2%）', () => {
    const s = TELEMETRY.hourly.reduce((acc: number, h) => acc + h.share, 0)
    expect(Math.abs(s - 1)).toBeLessThanOrEqual(0.02)
  })
  it('周队列留存非递增（null 除外）', () => {
    for (const c of TELEMETRY.cohorts) {
      const seq = [c.d1, c.d3, c.d7, c.d14, c.d30].filter((x): x is number => x !== null && x !== undefined)
      for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeLessThanOrEqual(seq[i - 1] + 1e-9)
    }
  })
  it('渠道/设备份额各自归一', () => {
    const ch = TELEMETRY.channels.reduce((s: number, x) => s + x.share, 0)
    const dev = TELEMETRY.devices.reduce((s: number, x) => s + x.share, 0)
    expect(Math.abs(ch - 1)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(dev - 1)).toBeLessThanOrEqual(1e-9)
  })
  it('所有 bounce 都在 [0,1]；endings ≤ sessions', () => {
    for (const day of d) {
      expect(day.bounce).toBeGreaterThanOrEqual(0); expect(day.bounce).toBeLessThanOrEqual(1)
      expect(day.endings).toBeLessThanOrEqual(day.sessions)
    }
  })
  it('演示先验：D1 均值低于 P1 阈值 0.22（保证 demo 能触发 P1 建议）', () => {
    expect(mean(TELEMETRY.cohorts.map((c) => c.d1).filter((x): x is number => x !== null))).toBeLessThan(0.22)
  })
})

describe('analytics · 智能优化建议引擎', () => {
  it('真实数据 ⇒ 触发 P0 两条', () => {
    const recs = deriveRecommendations(TELEMETRY)
    const ids = recs.map((r) => r.id)
    expect(ids).toContain('land-bounce')
    expect(ids).toContain('press-start')
  })
  it('排序 P0 → P1 → P2', () => {
    const order = { P0: 0, P1: 1, P2: 2 }
    const recs = deriveRecommendations(TELEMETRY)
    for (let i = 1; i < recs.length; i++) {
      expect(order[recs[i].priority]).toBeGreaterThanOrEqual(order[recs[i - 1].priority])
    }
  })
  it('每条建议都带 id/priority/metric/current/threshold 与双语文案', () => {
    for (const r of deriveRecommendations(TELEMETRY)) {
      expect(r.id).toBeTruthy()
      expect(['P0', 'P1', 'P2']).toContain(r.priority)
      expect(r.metric).toBeTruthy()
      expect(typeof r.current).toBe('number')
      expect(typeof r.threshold).toBe('number')
      expect(r.titleZh.length).toBeGreaterThan(6)
      expect(r.titleEn.length).toBeGreaterThan(6)
      expect(r.actionZh.length).toBeGreaterThan(10)
      expect(r.actionEn.length).toBeGreaterThan(10)
    }
  })
  it('健康世界 ⇒ 零条建议（指标全部在阈值之上）', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const healthy: any = JSON.parse(JSON.stringify(TELEMETRY))
    healthy.pages.find((p: any) => p.path === '/').bounce = 0.40
    healthy.funnel.steps[1].count = Math.round(healthy.funnel.steps[0].count * 0.8)
    healthy.funnel.steps[2].count = Math.round(healthy.funnel.steps[1].count * 0.9)
    healthy.funnel.steps[3].count = Math.round(healthy.funnel.steps[2].count * 0.7)
    healthy.funnel.steps[4].count = Math.round(healthy.funnel.steps[3].count * 0.8)
    healthy.funnel.steps[5].count = Math.round(healthy.funnel.steps[4].count * 0.6)
    healthy.cohorts.forEach((c: any) => { c.d1 = 0.30 })
    healthy.devices.find((x: any) => x.id === 'mobile').endingRate = 0.08
    healthy.devices.find((x: any) => x.id === 'desktop').endingRate = 0.09
    healthy.pages.find((p: any) => p.path === '/story/ledger/').rageClicks = 40
    healthy.pages.find((p: any) => p.path === '/console/').bounce = 0.30
    healthy.hourly = healthy.hourly.map((h: any) => ({ ...h, share: h.h >= 20 || h.h === 0 ? 0.05 : h.share }))
    const total = healthy.hourly.reduce((s: number, h: any) => s + h.share, 0)
    healthy.hourly = healthy.hourly.map((h: any) => ({ ...h, share: h.share / total }))
    healthy.daily = healthy.daily.map((day: any, i: number) => ({ ...day, sessions: 150 + (i % 3) }))
    const recs = deriveRecommendations(healthy)
    expect(recs.map((r) => r.id)).not.toContain('land-bounce')
    expect(recs.map((r) => r.id)).not.toContain('press-start')
    expect(recs.map((r) => r.id)).not.toContain('d1-retention')
    expect(recs.map((r) => r.id)).not.toContain('mobile-gap')
    expect(recs.map((r) => r.id)).not.toContain('console-bounce')
    expect(recs.map((r) => r.id)).not.toContain('peak-window')
  })
})

describe('admin · 静态页与部署接线（防悄悄脱落）', () => {
  it('admin/index.html 携带门 + 常量舱标记（smoke marker）', () => {
    const html = read('admin/index.html')
    expect(html).toContain('CAESURA / USER OBSERVATORY')
    expect(html).toContain('id="gate"')
    expect(html).toContain('id="gate-input"')
    expect(html).toContain('./styles.css')
    expect(html).toContain('./app.js')
    expect(html).toContain('../tracker.js')
  })
  it('admin/app.js 复用分析引擎与数据（不是另起炉灶）', () => {
    const js = read('admin/app.js')
    expect(js).toContain("from './analytics.mjs'")
    expect(js).toContain("from './data.js'")
    expect(js).toContain('deriveRecommendations')
    expect(js).toContain("'123'")
  })
  it('admin/styles.css 无外部请求、无 @import', () => {
    const css = read('admin/styles.css')
    expect(css).not.toContain('@import')
    expect(css).not.toMatch(/url\(\s*https?:/)
  })
  it('pages.yml 把 admin 拷进 dist', () => {
    expect(read('.github/workflows/pages.yml')).toContain('cp -R admin/. dist/admin/')
  })
  it('pages.yml 把 site-latest.json 镜像进 dist（/caesura/site-latest.json 可直访）', () => {
    /* 防脱落：如果将来删除这一步，hub 从 Pages 直读最新官宣就会 404；钉住 */
    const yml = read('.github/workflows/pages.yml')
    expect(yml).toContain('cp site-latest.json dist/')
    /* dist 里的副本必须是真的 site-latest.json（含 nexus/master head），内容会被 build-site-latest.mjs 刷新 */
    expect(yml).toContain('site-latest.json')
  })
  it('smoke-live 第 44 个入口：admin（42 端点） + AI 导演双 JSON 端点+ 篇十一..篇三十一故事页', () => {
    const sm = read('scripts/smoke-live.mjs')
    expect(sm).toContain("name: 'admin'")
    expect(sm).toContain('/caesura/admin/')
    expect(sm).toContain('CAESURA / USER OBSERVATORY')
    expect(sm).toContain("name: 'story-12'")
    expect(sm).toContain("name: 'story-13'")
    expect(sm).toContain("name: 'story-14'")
    expect(sm).toContain("name: 'story-15'")
    expect(sm).toContain("name: 'story-16'")
    expect(sm).toContain("name: 'story-17'")
    expect(sm).toContain("name: 'story-18'")
    expect(sm).toContain("name: 'story-19'")
    expect(sm).toContain("name: 'story-20'")
    expect(sm).toContain("name: 'story-21'")
    expect(sm).toContain("name: 'story-22'")
    expect(sm).toContain("name: 'story-23'")
    expect(sm).toContain("name: 'story-24'")
    expect(sm).toContain("name: 'story-25'")
    expect(sm).toContain("name: 'story-26'")
    expect(sm).toContain("name: 'story-27'")
    expect(sm).toContain("name: 'story-28'")
    expect(sm).toContain("name: 'story-29'")
    expect(sm).toContain("name: 'story-30'")
    expect(sm).toContain("name: 'story-31'")
    expect(sm).toContain("name: 'story-32'")
    expect(sm).toContain("name: 'story-33'")
    expect(sm).toContain("name: 'story-34'")
    expect(sm).toContain("name: 'story-35'")
    expect(sm).toContain("name: 'story-36'")
    expect(sm).toContain("name: 'story-37'")
    expect(sm).toContain("name: 'story-38'")
    expect(sm).toContain("name: 'story-39'")
    expect(sm).toContain("name: 'story-40'")
    expect(sm).toContain("name: 'story-41'")
    expect(sm).toContain("name: 'story-42'")
    expect(sm).toContain("name: 'story-43'")
    expect(sm).toContain("name: 'story-44'")
    expect(sm).toContain("name: 'story-45'")
    expect(sm).toContain("name: 'story-46'")
    expect(sm).toContain('/caesura/story/third-voice/')
    expect(sm).toContain('/caesura/story/ensemble/')
    expect(sm).toContain('/caesura/story/echo-vale/')
    expect(sm).toContain('/caesura/story/after-half-a-chime/')
    expect(sm).toContain('/caesura/story/beside-the-button/')
    expect(sm).toContain('/caesura/story/beyond-the-line/')
    expect(sm).toContain('/caesura/story/after-the-bag/')
    expect(sm).toContain('/caesura/story/salt-on-the-sill/')
    expect(sm).toContain('/caesura/story/after-the-salt-line/')
    expect(sm).toContain('/caesura/story/the-sill-keeps-count/')
    expect(sm).toContain('/caesura/story/after-the-space/')
    expect(sm).toContain('/caesura/story/the-unmarked-number/')
    expect(sm).toContain('/caesura/story/beside-the-scale/')
    expect(sm).toContain('/caesura/story/the-unentered-page/')
    expect(sm).toContain('/caesura/story/the-dry-place/')
    expect(sm).toContain('/caesura/story/unweighed/')
    expect(sm).toContain('/caesura/story/the-empty-scale/')
    expect(sm).toContain('/caesura/story/string-listener/')
    expect(sm).toContain("name: 'ai-json-commit'")
    expect(sm).toContain("name: 'ai-json-qa'")
    expect(sm).toContain('admin/ai-director-latest.json')
    expect(sm).toContain('admin/ai-director-transitions-qa.json')
    expect(sm).toContain('/caesura/story/dark-tide/')
    expect(sm).toContain('/caesura/story/twelfth-listener/')
    expect(sm).toContain('/caesura/story/bell-picker/')
    expect(sm).toContain('/caesura/story/lampwright-bell/')
    expect(sm).toContain('/caesura/story/lowtone-city/')
    expect(sm).toContain('/caesura/story/pendulum-ferryman/')
    expect(sm).toContain('/caesura/story/unfinished-ledger/')
    expect(sm).toContain('/caesura/story/fourth-strike/')
    expect(sm).toContain('/caesura/story/beyond-the-scale/')
    expect(sm).toContain('/caesura/story/the-scale-shadow/')
    expect(sm).toContain('/caesura/story/beyond-the-threshold/')
    expect(sm).toContain('/caesura/story/the-mark-outside/')
    expect(sm).toContain('/caesura/story/salt-at-the-threshold/')
    expect(sm).toContain('/caesura/story/the-unopened-page/')
    expect(sm).toContain('/caesura/story/the-unsent-letter/')
    expect(sm).toContain('/caesura/story/after-the-empty-scale/')
    const entries = (sm.match(/\{ name: '/g) ?? []).length
    expect(entries).toBe(56)
  })
  it('public/tracker.js 存在且为本机埋点', () => {
    const t = read('public/tracker.js')
    expect(t).toContain('caesura.telemetry.v1')
    expect(t).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|navigator\.send/)
  })
  it('全站公开页面都已挂 tracker.js（游戏/教程/图鉴/谱/调度台/全集故事/后台）', () => {
    const pages = ['index.html', 'console/index.html', 'tutorial/index.html', 'cast/index.html', 'codex/index.html', 'story/index.html', 'admin/index.html']
    const slugs = readdirSync(join(ROOT, 'story')).filter((n) => statSync(join(ROOT, 'story', n)).isDirectory())
    for (const slug of slugs) pages.push(`story/${slug}/index.html`)
    expect(pages.length).toBe(7 + slugs.length)
    for (const p of pages) expect(read(p), `${p} 缺 tracker.js`).toContain('tracker.js')
  })
  it('全站公开页面都已接入 zh-TW 转换器（/caesura/zh-tw-converter.js）', () => {
    /* KI-615：约束 Pages 镜像上线前 every 页面都能三语切换；predates Pages 镜像站约束此条先红引证提醒 */
    const pages = ['index.html', 'console/index.html', 'tutorial/index.html', 'cast/index.html', 'codex/index.html', 'story/index.html', 'admin/index.html']
    const slugs = readdirSync(join(ROOT, 'story')).filter((n) => statSync(join(ROOT, 'story', n)).isDirectory())
    for (const slug of slugs) pages.push(`story/${slug}/index.html`)
    for (const p of pages) expect(read(p), `${p} 缺 zh-tw-converter.js`).toContain('zh-tw-converter.js')
  })
  it('README 双语都登记 /admin/ 入口（口令 123）', () => {
    expect(read('README.md')).toContain('/caesura/admin/')
    expect(read('README.md')).toContain('123')
    expect(read('README.en.md')).toContain('/caesura/admin/')
    expect(read('README.en.md')).toContain('123')
  })
  it('console 与 tutorial 页脚都有通向后台的链接', () => {
    expect(read('console/index.html')).toContain('/caesura/admin/')
    expect(read('tutorial/index.html')).toContain('/caesura/admin/')
  })
  it('admin/data.js 由固定种子生成（seed 20261115 · 2026-10-17 → 2026-11-15）', () => {
    expect(TELEMETRY.meta.seed).toBe(20261115)
    expect(TELEMETRY.meta.days).toBe(30)
    expect(TELEMETRY.meta.cohortKind).toBe('simulated')
    expect(TELEMETRY.meta.refs.length).toBeGreaterThanOrEqual(4)
  })
})
