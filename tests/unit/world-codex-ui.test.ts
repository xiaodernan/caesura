import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * /codex「世界谱」页（codex/index.html）自证：
 *   ① 文件存在 + 默认中文；② 语言切换按钮；③ CODEX 条目数与分类齐全（八区 / 三 Boss / 三 Endings
 *      / 十处刻痕 / 六片新陆）；④ 浏览器内 BM25（k1 · b · idf）实现存在且零网络请求；
 *   ⑤ 双语正文都存在；⑥ HTML 自包含（无外链 <script> 或 <link rel=stylesheet> href=http）。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'codex/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('World Codex（codex/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, 'codex/index.html 不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('语言切换按钮存在（id="langToggle"）', () => {
    expect(HTML).toContain('id="langToggle"')
  })

  it('CODEX 条目数 ≥ 52，且八个地域、三 Boss、三 Ending、十四处刻痕、六片新陆齐全', () => {
    const entries = (HTML.match(/cat:'(?:reach|boss|ending|term|mark|system|epic|lands)'/g) ?? []).length
    expect(entries, 'CODEX entries').toBeGreaterThanOrEqual(52)
    for (const marker of [
      'Resthold', 'Whisperwode', 'Drowned Choir', 'Brokenbar',
      'Fellcarillon', 'Earless Deeps', 'Unfinished Hall', 'Windbell Coast',
      'Ostlara', 'The Myriad', 'Hersil',
      'Sound the fourth bell', 'Give it to her to melt', 'Never toll again',
      'EPIC-V', 'EPIC-VI', 'EPIC-VII',
      'Rainbell Hollow', 'The Bass Citadel', 'Frost-Hammer Cliff',
      'The Arcade of Bells', 'The Garden of the Return',
    ]) {
      expect(HTML, `missing marker: ${marker}`).toContain(marker)
    }
  })

  it('十四处刻痕全文入库（中英平行）', () => {
    const marks = (HTML.match(/cat:'mark'/g) ?? []).length
    expect(marks, 'mark entries').toBe(14)
    for (const line of [
      'before your first breath',
      'The trees in Whisperwode',
      'At the bottom, a bell never struck',
      'The pendulum',
      'a bell never struck',
      'your own footsteps from three years ago',
      'no one counts it anymore',
      'Tide-Lines',
    ]) {
      expect(HTML, `missing mark line: ${line}`).toContain(line)
    }
  })

  it('BM25 实现存在（k1 · b · idf · bigram）', () => {
    expect(HTML).toContain('K1 = 1.5')
    expect(HTML).toContain('B = 0.75')
    expect(HTML).toContain('const idf')
    expect(HTML).toContain('slice(i, i + 2)')
    // 中文 bigram + 英文词元双通道
    expect(HTML).toContain("/[a-z0-9]+/g")
  })

  it('双语正文同存（class="zh-copy" / class="en-copy"）', () => {
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
  })

  it('零网络请求（无外链 script/stylesheet；语料全内嵌）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })
})
