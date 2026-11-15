import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《回声庭园》故事页（story/garden/index.html）自证：
 *   ① 文件存在 + 默认中文；② 语言切换 + 双语两半齐全；③ 两半都带出设计册 canon（回声庭园）；
 *   ④ 零网络请求；⑤ 与篇一/二/三/四互链。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/garden/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 之五《回声庭园》（story/garden/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, 'story/garden/index.html 不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('语言切换按钮存在（id="langToggle"）且双语两半同存', () => {
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('回声庭园')
    expect(HTML).toContain('The Garden of Return')
  })

  it('中文正文：含指定 canon（回声庭园 / 旧钟的主人 / 木钟）与闭环结尾（弦）', () => {
    for (const marker of ['旧钟的主人', '木钟', '敲过的每一下都替你记了', '耳朵里都多了一根弦']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含 canon 与闭环结尾（owner of the old bell / string in their ear）', () => {
    for (const marker of ['The Owner of the Old Bell', 'wooden bell', 'Every strike you ever made', 'string in their ear']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（指向篇一/二/三/四 + 世界谱 + 游戏）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/unnamed-stone/', '/caesura/story/empty-bar/', '/caesura/story/ledger/', '/caesura/', '/caesura/codex/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })
})
