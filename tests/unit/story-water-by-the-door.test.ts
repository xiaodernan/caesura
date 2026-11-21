import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《门口的水》公开页（story/water-by-the-door/index.html）验证：
 *   · 文件存在 + 默认中文 · 双语页 · canon 名词跨界（空碗没水 · 门槛盐 · 门留缝）
 *   · 阅读进度条 · 全集里篇八十四 + 前篇篇八十三 + 全集入口 + zh-tw 转换表 + 同源同步,
 *   · No.84 · 余响集之八十四。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/water-by-the-door/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 余响八十四《门口的水》(story/water-by-the-door/index.html)', () => {
  it('文件存在 + 默认中文 · data-lang="zh"', () => {
    expect(HTML.length, '页面文件缺失').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('双语页骨架 · 篇八十四标题 · id="langToggle"', () => {
    expect(HTML).toContain('门口的水')
    expect(HTML).toContain('Water by the Door')
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('tracker.js')
    expect(HTML).toContain('zh-tw-converter.js')
    expect(HTML).toContain('read-progress.js')
  })

  it('中文 / zh · canon 名词跨界（阿汐 · 薄簿 · 盐 · 门槛 · 空碗 · 水）', () => {
    for (const marker of ['阿汐', '薄簿', '盐', '门槛', '空碗', '水']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文 / en · canon Arcade / Axi / ledger / salt / bowl / water', () => {
    for (const marker of ['Arcade', 'Axi', 'ledger', 'salt', 'bowl', 'water']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络依赖 · 全本地资源（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('页内导航链 · 含前篇篇八十三 + 篇八十四自身 + 全集 + 世界谱 + 游戏', () => {
    for (const href of ['/caesura/story/', '/caesura/story/water-by-the-door/', '/caesura/story/the-empty-bowl/', '/caesura/story/anthology/', '/caesura/codex/', '/caesura/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })

  it('篇八十四为 LLM 草稿 · 人工闸 · 作者侧页（署名请用原生措辞）', () => {
    for (const marker of ['LLM', '人工闸', 'LLM-drafted', 'human-gated']) {
      expect(HTML, `missing provenance marker: ${marker}`).toContain(marker)
    }
  })

  it('页面自身链入 read-progress.js（阅读进度条同步）', () => {
    expect(HTML).toContain('/caesura/read-progress.js')
  })

  it('篇目脚注 · 第八十四篇 · 余响集号戳记', () => {
    expect(HTML).toContain('第八十四篇')
    expect(HTML).toContain('No. 84')
  })
})
