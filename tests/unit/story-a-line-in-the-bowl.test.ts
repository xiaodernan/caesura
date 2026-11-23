import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《碗底的一线》公开页（story/a-line-in-the-bowl/index.html）验证：
 *   · 文件存在 + 默认中文 · 双语页 · canon 名词跨界（碗底细纹 · 空着不漏 · 光 · 盐 · 门）
 *   · 阅读进度条 · 前篇篇八十五 + 全集入口 + zh-tw 转换表 + 同源同步，
 *   · No.86 · 余响集之八十六。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/a-line-in-the-bowl/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 余响八十六《碗底的一线》(story/a-line-in-the-bowl/index.html)', () => {
  it('文件存在 + 默认中文 · data-lang="zh"', () => {
    expect(HTML.length, '页面文件缺失').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('双语页骨架 · 篇八十六标题 · id="langToggle"', () => {
    expect(HTML).toContain('碗底的一线')
    expect(HTML).toContain('A Line at the Bottom of the Bowl')
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('tracker.js')
    expect(HTML).toContain('zh-tw-converter.js')
    expect(HTML).toContain('read-progress.js')
  })

  it('中文 / zh · canon 名词跨界（阿汐 · 薄簿 · 盐 · 碗底 · 光）', () => {
    for (const marker of ['阿汐', '薄簿', '盐', '碗底', '光', '门']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文 / en · canon Axi / ledger / salt / bowl / light / seam', () => {
    for (const marker of ['Axi', 'ledger', 'salt', 'bowl', 'light', 'seam']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络依赖 · 全本地资源（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('页内导航链 · 含前篇篇八十五 + 篇八十六自身 + 全集 + 世界谱 + 游戏', () => {
    for (const href of ['/caesura/story/', '/caesura/story/a-line-in-the-bowl/', '/caesura/story/a-night-within/', '/caesura/story/anthology/', '/caesura/codex/', '/caesura/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })

  it('篇八十六为 LLM 草稿 · 人工闸 · 作者侧页（署名请用原生措辞）', () => {
    for (const marker of ['LLM', '人工闸', 'LLM-drafted', 'human-gated']) {
      expect(HTML, `missing provenance marker: ${marker}`).toContain(marker)
    }
  })

  it('页面自身链入 read-progress.js（阅读进度条同步）', () => {
    expect(HTML).toContain('/caesura/read-progress.js')
  })

  it('篇目脚注 · 第八十六篇 · 余响集号戳记', () => {
    expect(HTML).toContain('第八十六篇')
    expect(HTML).toContain('No. 86')
  })
})
