import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《石喉》故事页（story/stonethroat/index.html）自证：
 *   ① 文件存在 + 默认中文；② 语言切换 + 双语两半齐全；③ 两半都带出设计册 canon（低音之城 / 石喉母亲）；
 *   ④ 零网络请求；⑤ 与篇一/二/三/四/六/八/全集互链。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/stonethroat/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 之九《石喉》（story/stonethroat/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, 'story/stonethroat/index.html 不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('语言切换按钮存在（id="langToggle"）且双语两半同存', () => {
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('石喉')
    expect(HTML).toContain('The Stone-Throat')
  })

  it('中文正文：含指定 canon（石喉母亲 / 低音之城 / 写下来 / 女主）', () => {
    for (const marker of ['石喉母亲', '低音之城', '写下来', '少女']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含 canon 与闭环（The Stone-Throat Matriarch / Low Tones / Let the river keep count）', () => {
    for (const marker of ['The Stone-Throat Matriarch', 'Low Tones', 'Let the river keep count', 'Write it']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（篇一/二/三/四/六/八 + 全集 + 世界谱 + 游戏）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/unnamed-stone/', '/caesura/story/empty-bar/', '/caesura/story/ledger/', '/caesura/story/tribunal/', '/caesura/story/doors/', '/caesura/story/anthology/', '/caesura/', '/caesura/codex/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })
})
