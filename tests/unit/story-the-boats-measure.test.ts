import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《空船的刻度》故事页（story/the-boats-measure/index.html）自证：
 *   ① 文件存在 + 默认中文；② 双语两半齐全；③ 两半都带 canon（回廊钟 · 阿汐 · 薄簿 · 盐 · 摆 · 船）；
 *   ④ 零网络；⑤ 全集互链（篇七十九 + 前几篇 + 全集）；⑥ 埋点 + zh-tw 转换器 + 阅读进度同存；⑦ 第七十九篇 + 余响集之七十九。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/the-boats-measure/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 之七十九《空船的刻度》（story/the-boats-measure/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, '不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('双语两半同存，篇目的关键词正确', () => {
    expect(HTML).toContain('空船的刻度')
    expect(HTML).toContain("The Boat's Measure")
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('tracker.js')
    expect(HTML).toContain('zh-tw-converter.js')
    expect(HTML).toContain('read-progress.js')
  })

  it('中文正文：含 canon（回廊钟 · 阿汐 · 薄簿 · 盐 · 摆 · 船 · 干痕）', () => {
    for (const marker of ['回廊钟', '阿汐', '薄簿', '盐', '摆', '船', '干痕']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含 canon（Arcade / Axi / ledger / salt / pendulum / boat / dry mark）', () => {
    for (const marker of ['Arcade', 'Axi', 'ledger', 'salt', 'pendulum', 'boat', 'dry mark']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（本篇 + 前几篇 + 全集 + 世界谱 + 游戏）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/the-boats-measure/', '/caesura/story/the-salt-is-there/', '/caesura/story/the-unferried-page/', '/caesura/story/a-page-beside-the-pendulum/', '/caesura/story/she-too-a-seam/', '/caesura/story/one-line-in-the-night/', '/caesura/story/the-unanswered-question/', '/caesura/story/the-ledger-shut/', '/caesura/story/one-more-dusk/', '/caesura/story/the-corner-turns/', '/caesura/story/the-unentered-stroke/', '/caesura/story/the-fading-mark/', '/caesura/story/the-ash-unreturned/', '/caesura/story/the-fire-knows/', '/caesura/story/the-ash-unhurried/', '/caesura/story/the-mark-not-entered/', '/caesura/story/ash-not-fallen/', '/caesura/story/the-ash-beside-the-pendulum/', '/caesura/story/the-swing-unreturned/', '/caesura/story/at-ebb-one-stick/', '/caesura/story/the-mark-remains/', '/caesura/story/salt-beside-the-seat/', '/caesura/story/beside-the-pendulum/', '/caesura/story/no-handover/', '/caesura/story/the-unmoved-pendulum/', '/caesura/story/the-mark-beneath-the-jar/', '/caesura/story/the-ring/', '/caesura/story/beside-the-jar/', '/caesura/story/the-boat-still/', '/caesura/story/salt-not-aboard/', '/caesura/story/the-place-aboard/', '/caesura/story/the-unasked-boat/', '/caesura/story/the-dry-mark-beneath/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })

  it('本篇为 LLM 草稿 → LLM 终审(revise) → 人工闸扩写（篇名注明来源）', () => {
    for (const marker of ['LLM', '人工闸', 'LLM-drafted', 'human-gated']) {
      expect(HTML, `missing provenance marker: ${marker}`).toContain(marker)
    }
  })

  it('第七十九篇 · 余响集之七十九（kicker 双语对）', () => {
    expect(HTML).toContain('第七十九篇')
    expect(HTML).toContain('No. 79')
  })
})
