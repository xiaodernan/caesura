import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-731 · admin 全站健康监控（KI-730 扇出压测接入面板）：
 *   ① index.html 有 site-health 区块 + i18n 双语键；
 *   ② app.js renderSiteHealth 读静态基线 JSON、渲染失败率/p50/p95/p99/吞吐；
 *   ③ admin 只读不真打压测（不 import stress 脚本、不 fan-out），避免冲击 CDN；
 *   ④ styles.css 三列网格 + ok/bad 配色防重叠；
 *   ⑤ 基线报告是真实压测产物（0 失败、94 端点、字段完整）。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

describe('admin · 全站健康监控（KI-731）', () => {
  const html = read('admin/index.html')
  const js = read('admin/app.js')
  const css = read('admin/styles.css')

  it('index.html 有健康区块 + 双语 h4', () => {
    expect(html).toContain('id="site-health"')
    expect(html).toContain('data-i18n="health.h4"')
    expect(js).toMatch(/'health\.h4': \{ zh: '[^']+', en: '[^']+' \}/)
  })

  it('renderSiteHealth 读静态基线并渲染分位数', () => {
    const fn = js.slice(js.indexOf('async function renderSiteHealth()'), js.indexOf('\nfunction showAiError'))
    expect(fn).toContain("fetch('./stress-fanout-latest.json'")
    for (const k of ['failureRate', 'p50', 'p95', 'p99', 'totalBytes', 'generatedAt']) {
      expect(fn, `缺字段 ${k}`).toContain(k)
    }
    expect(fn).toContain('sh-ok')
    expect(fn).toContain('sh-bad')
  })

  it('admin 只读基线 · 不真打压测（不 import fan-out、不 multiplier）', () => {
    const fn = js.slice(js.indexOf('async function renderSiteHealth()'), js.indexOf('\nfunction showAiError'))
    expect(fn).not.toMatch(/import\s+.*stress-fanout/)
    expect(fn).not.toContain('multiplier')
    expect(fn).not.toMatch(/method:\s*['"](POST|PUT)/i)
  })

  it('styles.css 三列网格 + 健康/失败配色', () => {
    expect(css).toContain('.site-health')
    expect(css).toContain('grid-template-columns: repeat(3, 1fr)')
    expect(css).toContain('.sh-ok')
    expect(css).toContain('.sh-bad')
  })

  it('基线报告是真实压测产物（0 失败 / 94 端点 / 字段完整）', () => {
    expect(existsSync(resolve(ROOT, 'admin/stress-fanout-latest.json'))).toBe(true)
    const r = JSON.parse(read('admin/stress-fanout-latest.json'))
    expect(r.failures).toBe(0)
    expect(r.distinct).toBeGreaterThan(90)
    expect(r.requests).toBeGreaterThanOrEqual(r.distinct)
    expect(r.p95).toBeGreaterThan(0)
    expect(r.p99).toBeGreaterThanOrEqual(r.p95)
    expect(typeof r.generatedAt).toBe('string')
  })

  it('初始化调用链含 renderSiteHealth', () => {
    expect(js).toContain('renderSiteHealth()')
  })
})
