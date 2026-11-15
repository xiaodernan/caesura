import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《山下无名碑》故事页（story/unnamed-stone/index.html）自证：
 *   ① 文件存在 + 默认中文；② 语言切换 + 双语两半齐全；③ 中英两半都提到《止音纪元》世界观
 *      （休垒 / Resthold）；④ 零网络请求；⑤ 双语两半都完整（含 coda 闭环结尾）。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/unnamed-stone/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 之二《山下无名碑》（story/unnamed-stone/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, 'story/unnamed-stone/index.html 不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('语言切换按钮存在（id="langToggle"）且双语两半同存', () => {
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('休垒')
    expect(HTML).toContain('Resthold')
  })

  it('中文正文：含开篇（阿汀 / 石碑 / 父亲）与结尾（这算两个人）', () => {
    for (const marker of ['休垒', '阿汀', '石匠的女儿', '没有人替它收尾', '这算两个人']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含开篇与闭环结尾（lock-tight / two of us）', () => {
    for (const marker of ['A Ting', 'the stonecutter', 'the last crossing', 'lock-tight', 'two of us']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（指向篇一 story/ 与游戏 / 世界谱 / 教程 / 图鉴）', () => {
    for (const href of ['/caesura/story/', '/caesura/', '/caesura/codex/', '/caesura/tutorial/', '/caesura/cast/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })
})
