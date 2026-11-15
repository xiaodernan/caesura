import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《盐》故事页（story/index.html）自证：
 *   ① 文件存在 + 默认中文；② 语言切换按钮 + 双语两半齐全；③ 中英两半都提到
 *      《止音纪元》世界观（风钟海岸 / Windbell Coast）；④ 零网络请求；
 *   ⑤ 中英两半都完整（至少含 coda 与闭环结尾）。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 页（story/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, 'story/index.html 不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('语言切换按钮存在（id="langToggle"）且双语两半同存', () => {
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('风钟海岸')
    expect(HTML).toContain('Windbell Coast')
  })

  it('中文正文：含开篇（石盘/阿衡）与结尾（第四个拍子）', () => {
    for (const marker of ['石盘', '阿衡', '数节拍', '今夜如故', '能听懂那第四个拍子']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含开篇与闭环结尾（第四个拍子的英文对应）', () => {
    for (const marker of ['A Hén', 'count the beats', 'Tonight is different', 'someone who can hear the fourth beat']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（指向游戏 / 世界谱 / 教程 / 图鉴 / 调度台）', () => {
    for (const href of ['/caesura/', '/caesura/codex/', '/caesura/tutorial/', '/caesura/cast/', '/caesura/console/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })
})
