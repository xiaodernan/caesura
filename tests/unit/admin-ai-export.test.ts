import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-631 · admin「导出 AI 诊断备忘（Markdown）」门钉：
 *   ① export-ai 按钮在 DOM；② STRINGS 键 export.ai 双语齐；③ app.js 含 exportAiMemo + 两处 fetch + 容错；
 *   ④ 导出逻辑不向任何第三方发key/busy数据——纯 download()。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

describe('admin · 导出 AI 诊断备忘（KI-631）', () => {
  const html = read('admin/index.html')
  const js = read('admin/app.js')

  it('export-ai 按钮存在于导出条', () => {
    expect(html).toContain('id="export-ai"')
    expect(html).toContain('data-i18n="export.ai"')
  })

  it('STRINGS 双语键 export.ai 在 zh 与 en 表里都有', () => {
    expect(js).toContain("'export.ai'")
    const m = js.match(/'export\.ai': \{ zh: '([^']+)', en: '([^']+)' \}/)
    expect(m, 'export.ai 需要 zh 与 en 两种语言原文').toBeTruthy()
    expect(m![1].length).toBeGreaterThan(6)
    expect(m![2].length).toBeGreaterThan(6)
  })

  it('app.js 含 exportAiMemo + 两处 fetch 容错 + 与 buttons 绑定', () => {
    expect(js).toContain('exportAiMemo')
    expect(js).toContain("fetchSafe('./ai-director-latest.json')")
    expect(js).toContain("fetchSafe('./ai-director-transitions-qa.json')")
    expect(js).toContain("$('#export-ai').addEventListener('click', exportAiMemo)")
  })

  it('导出不向任何第三方写入：download() 唯一出口 · 无 POST · 无私密串', () => {
    const fn = js.slice(js.indexOf('async function exportAiMemo()'), js.indexOf('\nfunction digestText'))
    expect(fn).toContain('download(')
    expect(fn).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)/i)
    expect(fn).not.toContain('http://')
    expect(fn).not.toContain('https://')
    expect(fn).not.toMatch(/Authorization|Bearer|sk-[A-Za-z0-9_\-]{10,}/)
  })
})
