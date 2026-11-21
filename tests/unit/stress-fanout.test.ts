import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-730 · 全站扇出压力测试门钉：
 *   ① 脚本存在且是只读 GET 扇出（无写、无 POST）；
 *   ② storyUrls() 从 read-progress.js 现读全部故事页 + 关键页，含最新落地篇；
 *   ③ 去重、无错误 anthology 路径（曾踩过 /caesura/anthology/ 404）；
 *   ④ percentile 计算正确；
 *   ⑤ 报告字段完整（p50/p95/p99/failureRate/failSample）。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

describe('KI-730 · 全站扇出压力测试', () => {
  it('脚本存在且只读 GET（无写方法、无鉴权串）', async () => {
    const src = read('scripts/stress-fanout.mjs')
    expect(src).toContain('stress-fanout')
    expect(src).toContain("method: 'GET'")
    expect(src).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)/i)
    expect(src).not.toMatch(/Authorization|Bearer|sk-[A-Za-z0-9_\-]{10,}/)
  })

  it('storyUrls 现读全部故事页 + 关键页，含最新落地篇', async () => {
    const m = await import('../../scripts/stress-fanout.mjs')
    const urls = m.storyUrls()
    expect(urls.length).toBeGreaterThan(90)
    expect(urls).toContain('/caesura/story/')
    expect(urls).toContain('/caesura/story/a-night-within/')
    expect(urls).toContain('/caesura/story/the-empty-bowl/')
    expect(urls).toContain('/caesura/site-latest.json')
  })

  it('去重且无错误的 anthology 路径', async () => {
    const m = await import('../../scripts/stress-fanout.mjs')
    const urls = m.storyUrls()
    expect(new Set(urls).size).toBe(urls.length)
    expect(urls).toContain('/caesura/story/anthology/')
    expect(urls.some((u: string) => u === '/caesura/anthology/')).toBe(false)
  })

  it('percentile 计算正确', async () => {
    const m = await import('../../scripts/stress-fanout.mjs')
    const s = [10, 20, 30, 40, 50].sort((a: number, b: number) => a - b)
    expect(m.percentile(s, 50)).toBe(30)
    expect(m.percentile(s, 95)).toBe(50)
    expect(m.percentile([], 50)).toBe(0)
  })

  it('报告字段完整（含 p95/p99/failureRate/failSample）', () => {
    const src = read('scripts/stress-fanout.mjs')
    for (const k of ['p50', 'p95', 'p99', 'failureRate', 'failSample', 'totalBytes', 'wallMs']) {
      expect(src, `报告缺字段 ${k}`).toContain(k)
    }
  })
})
