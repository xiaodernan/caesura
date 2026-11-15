import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《余响集》全集页（story/anthology/index.html）自证：
 *   ① 文件存在 + 默认中文；② 语言切换 + 双语两半齐全；③ 正文含六篇故事的全部出口；
 *   ④ 零网络请求；⑤ 链接到全部六篇 + 世界谱 + 游戏。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/anthology/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('余响集（story/anthology/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, 'story/anthology/index.html 不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('语言切换按钮存在（id="langToggle"）且双语两半同存', () => {
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('余响集')
    expect(HTML).toContain('The Aftermath')
  })

  it('中文正文：含十篇全部标题', () => {
    for (const marker of ['《盐》', '《山下无名碑》', '《空拍子》', '《账本》', '《回声庭园》', '《雨审判》', '《霜锤》', '《千门》', '《石喉》', '《第一钟》']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含十篇全部标题', () => {
    for (const marker of ['“Salt”', '“The Nameless Stone”', '“The Empty Bar”', '“The Ledger”', '“The Garden of Return”', '“The Rain Tribunal”', '“The Frostbell”', '“The Thousand Doors”', '“The Stone-Throat”', '“The First Bell”']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('十篇全部能链到（href 出口必须全）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/unnamed-stone/', '/caesura/story/empty-bar/', '/caesura/story/ledger/', '/caesura/story/garden/', '/caesura/story/tribunal/', '/caesura/story/frostbell/', '/caesura/story/doors/', '/caesura/story/stonethroat/', '/caesura/story/first-bell/', '/caesura/', '/caesura/codex/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })

  it('纸质整卷：@media print 样式 + #printBtn 按钮 + window.print() 直连', () => {
    expect(HTML).toContain('@media print')
    expect(HTML).toContain('@page')
    expect(HTML).toContain('break-inside: avoid')
    expect(HTML).toContain('id="printBtn"')
    expect(HTML).toContain('window.print()')
    expect(HTML).toContain('.shelf')
  })
})
