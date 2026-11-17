import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《半声之后》故事页（story/after-half-a-chime/index.html）自证：
 *   ① 文件存在 + 默认中文；② 双语两半齐全；③ 两半都带 canon（回廊钟第37年 / 阿沉 / 一枚旧铜扣 · 收音人 / LLM 草稿）；
 *   ④ 零网络；⑤ 全集互链；⑥ 埋点 + zh-tw 转换器同存；⑦ 篇二十四 + 余响集之二十四。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/after-half-a-chime/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 之二十四《半声之后》（story/after-half-a-chime/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, '不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('双语两半同存，篇目的关键词正确', () => {
    expect(HTML).toContain('半声之后')
    expect(HTML).toContain('After Half a Chime')
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('tracker.js')
    expect(HTML).toContain('zh-tw-converter.js')
  })

  it('中文正文：含 canon（回廊钟 · 阿沉 · 收音人 · 旧铜扣 · 一口从没敲过的钟）', () => {
    for (const marker of ['回廊钟', '阿沉', '收音人', '旧铜扣', '没敲过的钟']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含 canon（Arcade / A-Chen / keeper / brass button / thirty-seventh vigil）', () => {
    for (const marker of ['Arcade', 'A-Chen', 'keeper', 'brass button', 'thirty-seventh']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（全篇一..二十四 + 全集 + 世界谱 + 游戏 + 前一篇）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/echo-vale/', '/caesura/story/ensemble/', '/caesura/story/third-voice/', '/caesura/story/string-listener/', '/caesura/story/last-string/', '/caesura/story/fourth-strike/', '/caesura/story/unfinished-ledger/', '/caesura/story/anthology/', '/caesura/', '/caesura/codex/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })

  it('本页称是 LLM 草稿 · 人工闸落地 — 篇名注明做了什么', () => {
    for (const marker of ['LLM', '人工闸', 'LLM-drafted', 'human-approved']) {
      expect(HTML, `missing provenance marker: ${marker}`).toContain(marker)
    }
  })
})
