import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《空拍子》故事页（story/empty-bar/index.html）自证：
 *   ① 文件存在 + 默认中文；② 语言切换 + 双语两半齐全；③ 中英两半都提到
 *      《止音纪元》世界观（未竟厅 / Unfinished Hall）；④ 零网络请求；⑤ 两篇系列互链。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/empty-bar/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 之三《空拍子》（story/empty-bar/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, 'story/empty-bar/index.html 不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('语言切换按钮存在（id="langToggle"）且双语两半同存', () => {
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('未竟厅')
    expect(HTML).toContain('Unfinished Hall')
  })

  it('中文正文：含开篇（轮值 / 谱架 / 指挥棒）与结尾（空拍子到你了）', () => {
    for (const marker of ['未竟厅', '恩希尔', '指挥棒', '空拍子', '轮值', '谱架']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含开篇与闭环结尾（bar / your turn）', () => {
    for (const marker of ['Unfinished Hall', 'baton', 'Hersil', 'Empty Bar', 'your turn']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（指回篇一 story/ 与游戏 / 世界谱 / 教程）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/unnamed-stone/', '/caesura/', '/caesura/codex/', '/caesura/tutorial/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })
})
