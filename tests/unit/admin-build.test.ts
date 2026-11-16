import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-630 · admin「研发状态 · Build Observatory」门钉：
 *   ① admin 页含面板与挂载点；② app.js 真去 fetch 两处公网只读源（site-latest + GitHub Actions API），
 *      出场即降级（任一不可达都不许整页崩）；③ renderAll 真的调用 renderBuild；
 *   ④ styles.css 含 .panel-build / .build-runs / .build-fill；
 *   ⑤ STRINGS 键 build.h2 / build.err 在两语表里；⑥ 代码里不出现任何密钥形状。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

describe('admin · 研发状态 Build Observatory（KI-630）', () => {
  const html = read('admin/index.html')
  const js = read('admin/app.js')
  const css = read('admin/styles.css')

  it('admin/index.html 含面板与挂载点（bar + runs + status）', () => {
    expect(html).toContain('id="panel-build"')
    expect(html).toContain('id="build-head"')
    expect(html).toContain('id="build-ki-bar"')
    expect(html).toContain('id="build-sys-bar"')
    expect(html).toContain('id="build-runs"')
    expect(html).toContain('data-i18n="build.h2"')
    expect(html).toContain('href="https://github.com/xiaodernan/caesura/actions"')
  })

  it('app.js 真去 fetch 两处公网只读源，且两路各自有降级路径', () => {
    expect(js).toContain('raw.githubusercontent.com/xiaodernan/caesura/master/site-latest.json')
    expect(js).toContain('api.github.com/repos/xiaodernan/caesura/actions/runs?branch=master&per_page=8')
    expect(js).toContain('renderBuild()')
    expect(js).toContain("renderAiCommitted(); hydrateAiLive(); renderStateGraph(); renderBuild()")
    expect(js).toContain('build-error')
    expect(js).toContain('build-runs')
  })

  it('styles.css 含 Build Observatory 样式（无 @import / 无外链 url）', () => {
    expect(css).toContain('.panel-build')
    expect(css).toContain('.build-runs')
    expect(css).toContain('.build-fill')
    expect(css).not.toContain('@import')
    expect(css).not.toMatch(/url\(\s*https?:/)
  })

  it('STRINGS 双语键 build.h2 / build.err 在 zh 与 en 表里都有', () => {
    expect(js).toContain("'build.h2'")
    expect(js).toContain("'build.err'")
    const h2 = js.match(/'build\.h2': \{ zh: '([^']+)', en: '([^']+)' \}/)
    expect(h2, 'build.h2 需要 zh 与 en 两种语言原文').toBeTruthy()
    expect(h2![1].length).toBeGreaterThan(6)
    expect(h2![2].length).toBeGreaterThan(6)
  })

  it('代码里不出现任何密钥形状（无凭证即是承诺）', () => {
    expect(js).not.toMatch(/sk-[A-Za-z0-9_\-]{16,}/)
    expect(html).not.toMatch(/sk-[A-Za-z0-9_\-]{16,}/)
  })
})
