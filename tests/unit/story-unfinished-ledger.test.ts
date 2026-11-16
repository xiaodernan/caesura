import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《未竟账页》故事页（story/unfinished-ledger/index.html）自证：
 *   ① 文件存在 + 默认中文；② 语言切换 + 双语两半齐全；③ 两半都带 canon（未竟厅 / 账 / 空白）；
 *   ④ 零网络请求；⑤ 与篇一/篇四/篇九/篇十/篇十五/篇十六/全集 互链；⑥ 篇十七 · 余响集之十七。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/unfinished-ledger/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 之十七《未竟账页》（story/unfinished-ledger/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, 'story/unfinished-ledger/index.html 不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('语言切换按钮存在（id="langToggle"）且双语两半同存', () => {
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('未竟账页')
    expect(HTML).toContain('The Unfinished Ledger Page')
  })

  it('中文正文：含 canon（未竟厅 / 账 / 空白 / 老大师）', () => {
    for (const marker of ['未竟厅', '账', '空白', '老大师']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含 canon（Unfinished Hall / ledger / empty square / Hersil）', () => {
    for (const marker of ['Unfinished Hall', 'ledger', 'empty square', 'Hersil']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（篇一 / 篇三 / 篇四 / 篇九 / 篇十 / 篇十五 / 篇十六 / 全集 / 世界谱 / 游戏）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/empty-bar/', '/caesura/story/ledger/', '/caesura/story/stonethroat/', '/caesura/story/first-bell/', '/caesura/story/lowtone-city/', '/caesura/story/pendulum-ferryman/', '/caesura/story/anthology/', '/caesura/', '/caesura/codex/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })

  it('埋点与 zh-TW 转换器都在（全站双轨纪律）', () => {
    expect(HTML).toContain('tracker.js')
    expect(HTML).toContain('zh-tw-converter.js')
  })
})
