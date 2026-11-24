import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《模上的第二道指印》公开页（story/the-second-print-on-the-mould/index.html）验证：
 *   · 文件存在 + 默认中文 · 双语页 · canon 名词跨界（铸钟坊 · 蜡钟 · 浇口 · 泥壳 · 薄簿 · 火）
 *   · 阅读进度条 · 前篇篇九十一 + 余响索引 + 全集 + zh-tw 转换表，
 *   · No.92 · 余响集之九十二。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/the-second-print-on-the-mould/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 余响九十二《模上的第二道指印》(story/the-second-print-on-the-mould/index.html)', () => {
  it('文件存在 + 默认中文 · data-lang="zh"', () => {
    expect(HTML.length, '页面文件缺失').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('双语页骨架 · 篇九十二标题 · id="langToggle"', () => {
    expect(HTML).toContain('模上的第二道指印')
    expect(HTML).toContain('The Second Print on the Mould')
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('tracker.js')
    expect(HTML).toContain('zh-tw-converter.js')
    expect(HTML).toContain('read-progress.js')
  })

  it('中文 / zh · canon 名词跨界（阿汐 · 薄簿 · 浇口 · 蜡钟 · 泥壳 · 火）', () => {
    for (const marker of ['阿汐', '薄簿', '浇口', '蜡钟', '泥壳', '火']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文 / en · canon Axi / ledger / pour gate / wax bell / clay / fire', () => {
    for (const marker of ['Axi', 'ledger', 'pour gate', 'wax bell', 'clay', 'fire']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络依赖 · 全本地资源（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('页内导航链 · 含前篇篇九十一 + 余响索引 + 全集 + 世界谱 + 游戏', () => {
    for (const href of ['/caesura/story/', '/caesura/story/the-second-print-on-the-mould/', '/caesura/story/the-bell-not-cast/', '/caesura/story/atlas/', '/caesura/story/anthology/', '/caesura/codex/', '/caesura/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })

  it('篇九十二为人工闸 · 双语对照 · 作者侧页', () => {
    for (const marker of ['人工闸', '双语对照', 'bilingual', 'human-gated']) {
      expect(HTML, `missing provenance marker: ${marker}`).toContain(marker)
    }
  })

  it('页面自身链入 read-progress.js（阅读进度条同步）', () => {
    expect(HTML).toContain('/caesura/read-progress.js')
  })

  it('篇目脚注 · 第九十二篇 · 余响集号戳记', () => {
    expect(HTML).toContain('第九十三篇')
    expect(HTML).toContain('No. 93')
  })
})
