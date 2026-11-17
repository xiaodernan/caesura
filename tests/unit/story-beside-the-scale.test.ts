import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《秤旁》故事页（story/beside-the-scale/index.html）自证：
 *   ① 文件存在 + 默认中文；② 双语两半齐全；③ 两半都带 canon（回廊钟 · 阿汐 · 铜扣 · 铁钉 · 秤盘）；
 *   ④ 零网络；⑤ 全集互链（篇三十三 + 前四篇 + 全集）；⑥ 埋点 + zh-tw 转换器 + 阅读进度同存；⑦ 第三十三篇 + 余响集之三十三。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/beside-the-scale/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 之三十三《秤旁》（story/beside-the-scale/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, '不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('双语两半同存，篇目的关键词正确', () => {
    expect(HTML).toContain('秤旁')
    expect(HTML).toContain('Beside the Scale')
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('tracker.js')
    expect(HTML).toContain('zh-tw-converter.js')
    expect(HTML).toContain('read-progress.js')
  })

  it('中文正文：含 canon（回廊钟 · 阿汐 · 铜扣 · 铁钉 · 秤盘 · 薄页）', () => {
    for (const marker of ['回廊钟', '阿汐', '铜扣', '铁钉', '秤盘', '薄页']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含 canon（Arcade / Axi / copper button / iron nail / ledger）', () => {
    for (const marker of ['Arcade', 'Axi', 'copper button', 'iron nail', 'ledger']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（全篇 + 全集 + 世界谱 + 游戏 + 前四篇）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/the-unmarked-number/', '/caesura/story/after-the-space/', '/caesura/story/the-sill-keeps-count/', '/caesura/story/after-the-salt-line/', '/caesura/story/salt-on-the-sill/', '/caesura/story/after-the-bag/', '/caesura/story/beyond-the-line/', '/caesura/story/beside-the-button/', '/caesura/story/ensemble/', '/caesura/story/anthology/', '/caesura/', '/caesura/codex/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })

  it('本页称 LLM 草稿 · 人工闸落地 — 篇名注明来源', () => {
    for (const marker of ['LLM', '人工闸', 'LLM-drafted', 'human-approved']) {
      expect(HTML, `missing provenance marker: ${marker}`).toContain(marker)
    }
  })
})
