import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《第四下》故事页（story/fourth-strike/index.html）自证：
 *   ① 文件存在 + 默认中文；② 语言切换 + 双语两半齐全；③ 两半都带 canon（第四下 / 钟舌 / 灯匠阿瓷的孩子）；
 *   ④ 零网络请求；⑤ 与篇一/篇十/篇十三/篇十四/篇十七/全集互链；⑥ 篇十八 · 余响集之十八；
 *   ⑦ 埋点与 zh-TW 转换器都在（全站双轨纪律）。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/fourth-strike/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 之十八《第四下》（story/fourth-strike/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, 'story/fourth-strike/index.html 不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('语言切换按钮存在（id="langToggle"）且双语两半同存', () => {
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('第四下')
    expect(HTML).toContain('The Fourth Strike')
  })

  it('中文正文：含 canon（第四下 / 钟舌 / 灯匠阿瓷的孩子 / 岬角）', () => {
    for (const marker of ['第四下', '钟舌', '灯匠阿瓷', '岬角']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含 canon（fourth / clapper / A-Ci / beacon）', () => {
    for (const marker of ['fourth', 'clapper', 'A-Ci', 'beacon']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（篇一 / 篇三 / 篇四 / 篇九 / 篇十 / 篇十三 / 篇十四 / 篇十五 / 篇十六 / 篇十七 / 全集 / 世界谱 / 游戏）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/empty-bar/', '/caesura/story/ledger/', '/caesura/story/stonethroat/', '/caesura/story/first-bell/', '/caesura/story/bell-picker/', '/caesura/story/lampwright-bell/', '/caesura/story/lowtone-city/', '/caesura/story/pendulum-ferryman/', '/caesura/story/unfinished-ledger/', '/caesura/story/anthology/', '/caesura/', '/caesura/codex/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })

  it('埋点与 zh-TW 转换器都在（全站双轨纪律）', () => {
    expect(HTML).toContain('tracker.js')
    expect(HTML).toContain('zh-tw-converter.js')
  })
})
