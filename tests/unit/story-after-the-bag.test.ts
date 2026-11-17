import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《纸袋之后》故事页（story/after-the-bag/index.html）自证：
 *   ① 文件存在 + 默认中文；② 双语两半齐全；③ 两半都带 canon（回廊钟 · 盐 · 纸袋 · 听 · 阿汐）；
 *   ④ 零网络；⑤ 全集互链（篇二十七 + 前两篇 + 全集）；⑥ 埋点 + zh-tw 转换器同存；⑦ 第二十七篇 + 余响集之二十七。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/after-the-bag/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 之二十七《纸袋之后》（story/after-the-bag/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, '不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('双语两半同存，篇目的关键词正确', () => {
    expect(HTML).toContain('纸袋之后')
    expect(HTML).toContain('After the Bag')
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('tracker.js')
    expect(HTML).toContain('zh-tw-converter.js')
  })

  it('中文正文：含 canon（回廊钟 · 纸袋 · 阿汐 · 盐线 · 门自己开了一条缝）', () => {
    for (const marker of ['回廊钟', '纸袋', '阿汐', '盐线', '门自己开了一条缝']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含 canon（Arcade / Axi / paper bag / salt / finger\'s width）', () => {
    for (const marker of ['Arcade', 'Axi', 'paper bag', 'salt', "finger's width"]) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（全篇 + 全集 + 世界谱 + 游戏 + 前两篇）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/beyond-the-line/', '/caesura/story/beside-the-button/', '/caesura/story/after-half-a-chime/', '/caesura/story/echo-vale/', '/caesura/story/ensemble/', '/caesura/story/third-voice/', '/caesura/story/string-listener/', '/caesura/story/last-string/', '/caesura/story/fourth-strike/', '/caesura/story/anthology/', '/caesura/', '/caesura/codex/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })

  it('本页称 LLM 草稿 · 人工闸落地 — 篇名注明来源', () => {
    for (const marker of ['LLM', '人工闸', 'LLM-drafted', 'human-approved']) {
      expect(HTML, `missing provenance marker: ${marker}`).toContain(marker)
    }
  })
})
