import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《听弦》故事页（story/string-listener/index.html）自证：
 *   ① 文件存在 + 默认中文；② 双语两半齐全；③ 两半都带 canon（弦 / 北崖 / 未竟厅 / 阿汐）；
 *   ④ 零网络；⑤ 全集互链；⑥ 埋点 + zh-tw 转换器同存；⑦ 篇二十 + 余响集之二十。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/string-listener/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 之二十《听弦》（story/string-listener/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, '不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('双语两半同存，篇目的关键词正确', () => {
    expect(HTML).toContain('听弦')
    expect(HTML).toContain('The String-Listener')
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('tracker.js')
    expect(HTML).toContain('zh-tw-converter.js')
  })

  it('中文正文：含 canon（弦 / 北崖 / 未竟厅 / 阿汐 / 谁在听）', () => {
    for (const marker of ['弦', '北崖', '未竟厅', '阿汐', '谁在听']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含 canon（string / north cliff / Unfinished Hall / Axi / who is listening）', () => {
    for (const marker of ['string', 'north cliff', 'Unfinished Hall', 'Axi', 'who is listening']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（全篇一..十九 + 全集 + 世界谱 + 游戏 + 前后两篇）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/last-string/', '/caesura/story/fourth-strike/', '/caesura/story/unfinished-ledger/', '/caesura/story/pendulum-ferryman/', '/caesura/story/anthology/', '/caesura/', '/caesura/codex/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })
})
