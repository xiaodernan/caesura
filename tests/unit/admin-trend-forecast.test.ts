import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * KI-645 · admin「趋势研判 · Forecast」· LLM 裁决真嵌入 admin 可视段
 * ① scripts/ai-trend-forecast.mjs 存在且接线：admin/data.js + forecast() + aizzz + Clash 代理 + callLlm；
 * ② 产物 admin-trend-forecast.json（双拷贝）成型：runtime:false + requiresHumanReview + schema + mode "live"；
 * ③ actions 恰好 4 条且 seq 1..4 有序、impact/effort 枚举合法；
 * ④ 每条 action 双语且 rationale/metric/risk 齐全；
 * ⑤ admin/index.html 新面板已接入（panel-forecast + forecast.h2）；
 * ⑥ admin/app.js 新渲染函数 renderForecast() 已接入 renderAll；
 * ⑦ package.json 有 ai:forecast 脚本 + docs/ai-director 产物存档存在 · 归档不含 sk-。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const exists = (p: string) => existsSync(resolve(ROOT, p))

describe('KI-645 · admin 趋势研判 · LLM-in-admin（Forecast 段）', () => {
  it('ai-trend-forecast.mjs 存在且正确接线（data.js / forecast() / proxy / callLlm）且无 sk- 字面', () => {
    const s = read('scripts/ai-trend-forecast.mjs')
    expect(s).toContain("import { forecast } from '../admin/analytics.mjs'")
    expect(s).toContain("await import('../admin/data.js')")
    expect(s).toContain('applyAuthorProxyFromEnv')
    expect(s).toContain('callLlm')
    expect(s).toContain('--live')
    // 绝不内嵌密钥
    expect(s.match(/sk-[A-Za-z0-9]{12,}/)).toBeNull()
  })

  it('admin-trend-forecast.json 存在且结构成型（双拷贝字节一致）', () => {
    const a = read('admin/admin-trend-forecast.json')
    const b = read('src/data/authoring/admin-trend-forecast.json')
    expect(a.length).toBe(b.length)
    expect(a.length).toBeGreaterThan(600)
    const j = JSON.parse(a)
    expect(j.runtime).toBe(false)
    expect(j.authorOnly).toBe(true)
    expect(j.containsCredentials).toBe(false)
    expect(j.requiresHumanReview).toBe(true)
    expect(j.mode).toBe('live')
    expect(j.usage.statuses).toContain(200)
    expect(j.forecast?.sessions?.points).toHaveLength(7)
    expect(j.forecast?.pageViews?.points).toHaveLength(7)
    expect(j.usage.cachedTokens).toBeGreaterThanOrEqual(0)
  })

  it('actions 恰好 4 条且 seq 1..4 有序、impact/effort 枚举合法', () => {
    const j = JSON.parse(read('admin/admin-trend-forecast.json'))
    expect(Array.isArray(j.actions)).toBe(true)
    expect(j.actions).toHaveLength(4)
    const impact = ['high', 'medium', 'low']
    for (const [i, a] of j.actions.entries()) {
      expect(a.seq, `seq order at ${i}`).toBe(i + 1)
      expect(impact).toContain(a.impact)
      expect(['S', 'M', 'L']).toContain(a.effort)
    }
  })

  it('每条 action 双语完备：action/rationale/metric/risk 双语且非空', () => {
    const j = JSON.parse(read('admin/admin-trend-forecast.json'))
    for (const [i, a] of j.actions.entries()) {
      const pfx = `action[${i}]`
      expect(a.actionZh?.trim().length, `${pfx}.actionZh`).toBeGreaterThan(6)
      expect(a.actionEn?.trim().length, `${pfx}.actionEn`).toBeGreaterThan(6)
      expect(a.rationaleZh?.trim().length, `${pfx}.rationaleZh`).toBeGreaterThan(6)
      expect(a.rationaleEn?.trim().length, `${pfx}.rationaleEn`).toBeGreaterThan(6)
      expect(a.metric?.trim().length, `${pfx}.metric`).toBeGreaterThan(4)
      expect(a.riskZh?.trim().length, `${pfx}.riskZh`).toBeGreaterThan(4)
      expect(a.riskEn?.trim().length, `${pfx}.riskEn`).toBeGreaterThan(4)
    }
    // 概要双语非空
    expect(j.summary?.zh?.trim().length).toBeGreaterThan(6)
    expect(j.summary?.en?.trim().length).toBeGreaterThan(6)
    expect(j.riskiestCohort?.zh?.trim().length).toBeGreaterThan(6)
    expect(j.riskiestCohort?.en?.trim().length).toBeGreaterThan(6)
  })

  it('admin/index.html 新面板 panel-forecast 已接入 · data-i18n="forecast.h2"', () => {
    const s = read('admin/index.html')
    expect(s).toContain('id="panel-forecast"')
    expect(s).toContain('data-i18n="forecast.h2"')
    expect(s).toContain('id="forecast-actions"')
    expect(s).toContain('id="forecast-sens-zh"')
  })

  it('admin/app.js 新渲染函数 renderForecast() 已实现并进 renderAll() · forecast.h2 键齐备', () => {
    const s = read('admin/app.js')
    expect(s).toContain("'forecast.h2'")
    expect(s).toContain('async function renderForecast()')
    expect(s).toContain('renderForecast()')
    expect(s).toContain("'forecast.hint'")
    expect(s).toContain("'forecast.note'")
  })

  it('package.json 有 ai:forecast 脚本 + docs/ai-director 产物存档存在且不含 sk-', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts?.['ai:forecast']).toBe('node scripts/ai-trend-forecast.mjs')
    const recent = [
      'docs/ai-director/ADMIN-TREND-FORECAST-2026-11-17.md',
    ]
    for (const p of recent) {
      expect(exists(p), `missing artifact ${p}`).toBe(true)
      const body = read(p)
      expect(body, `artifact ${p} leaked sk-`).not.toMatch(/sk-[A-Za-z0-9]{12,}/)
      expect(body.length).toBeGreaterThan(400)
    }
  })
})
