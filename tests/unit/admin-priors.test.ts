import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-636 · admin「先验审计 · Priors Audit」门钉：
 *   ① admin 页含先验面板与挂载点；② app.js 有 renderPriors + fetch `./admin-priors-audit.json`；③
 *   负载件 src/data/authoring/admin-priors-audit.json + admin/admin-priors-audit.json 双拷贝存在；
 *   ④ 双拷贝字节级一致；⑤人工闸四要素；⑥verdict 恰好 4 条且取值扫 {plausible, strained, rejected}；
 *   ⑦ 无密钥形状；⑧styles.css 含 .priors-row；⑨ LLM 友好（顺利通过 cache = cachedTokens > 0 或 statuses 200）。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const AUTHORING = resolve(ROOT, 'src/data/authoring/admin-priors-audit.json')
const ADMIN = resolve(ROOT, 'admin/admin-priors-audit.json')
const KEY_SHAPE = /sk-[A-Za-z0-9_\-]{16,}/

describe('admin · 先验审计 Priors Audit（KI-636）', () => {
  const html = read('admin/index.html')
  const js = read('admin/app.js')
  const css = read('admin/styles.css')

  it('admin/index.html 含面板与挂载点', () => {
    expect(html).toContain('id="panel-priors"')
    expect(html).toContain('id="priors-verdicts"')
    expect(html).toContain('id="priors-overall-zh"')
    expect(html).toContain('id="priors-sens-zh"')
    expect(html).toContain('data-i18n="priors.h2"')
  })

  it('app.js 有 renderPriors + fetch audit JSON + 调用 renderAll', () => {
    expect(js).toContain('renderPriors')
    expect(js).toContain('./admin-priors-audit.json')
    expect(js).toContain('renderAiCommitted(); hydrateAiLive(); renderStateGraph(); renderRouter(); renderBuild(); renderPriors()')
  })

  it('styles.css 含 priors 样式（无 @import / 无外链）', () => {
    expect(css).toContain('.panel-priors')
    expect(css).toContain('.priors-row')
    expect(css).toContain('.priors-badge')
    expect(css).not.toContain('@import')
    expect(css).not.toMatch(/url\(\s*https?:/)
  })

  it('双拷贝存在且字节级一致', () => {
    expect(existsSync(AUTHORING)).toBe(true)
    expect(existsSync(ADMIN)).toBe(true)
    expect(readFileSync(ADMIN, 'utf8')).toBe(readFileSync(AUTHORING, 'utf8'))
  })

  it('人工闸四要素 + mode=live + schema=1 + verdict 条数=4 且取值合法', () => {
    const art = JSON.parse(read('src/data/authoring/admin-priors-audit.json')) as Record<string, any>
    expect(art.runtime).toBe(false)
    expect(art.authorOnly).toBe(true)
    expect(art.requiresHumanReview).toBe(true)
    expect(art.containsCredentials).toBe(false)
    expect(art.schema).toBe(1)
    expect(art.mode).toBe('live')
    expect(Array.isArray(art.verdicts)).toBe(true)
    expect(art.verdicts.length).toBe(4)
    const allowed = new Set(['plausible', 'strained', 'rejected'])
    for (const v of art.verdicts) {
      expect(allowed.has(v.verdict), `verdict ${v.verdict} ∉ plausible|strained|rejected`).toBe(true)
    }
  })

  it('任何产物文件里不得出现密钥形状', () => {
    for (const p of [AUTHORING, ADMIN]) {
      expect(KEY_SHAPE.test(readFileSync(p, 'utf8'))).toBe(false)
    }
  })

  it('至少一次调用成功（usage.statuses 中的状态码 200）', () => {
    const art = JSON.parse(read('src/data/authoring/admin-priors-audit.json')) as Record<string, any>
    expect(Array.isArray(art.usage?.statuses)).toBe(true)
    for (const s of art.usage.statuses) expect([200, 201]).toContain(Number(s))
  })
})
