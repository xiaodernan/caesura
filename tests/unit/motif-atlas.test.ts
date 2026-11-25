import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《余响索引 / Motif Atlas》门钉：
 *   · 86 张卡片 · 与 read-progress.js 的 ORDER 一一对应（篇一《盐》= /caesura/story/）
 *   · 12 个母题筛 · 搜索框 · 本机已读统计 · 双语半区 · 零网络
 *   · 生成物与 scripts/gen-motif-atlas.mjs 同步（--check 必须绿）
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const HTML = readFileSync(resolve(ROOT, 'story/atlas/index.html'), 'utf8')
const ORDER = readFileSync(resolve(ROOT, 'public/read-progress.js'), 'utf8')

describe('Motif Atlas 余响索引（story/atlas/index.html）', () => {
  it('生成物与脚本同步（node scripts/gen-motif-atlas.mjs --check）', () => {
    const out = execFileSync(process.execPath, ['scripts/gen-motif-atlas.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' })
    expect(out).toContain('motif-atlas: OK')
  })

  it('94 张卡片 · href 与 ORDER 一一对应', () => {
    const hrefs = [...HTML.matchAll(/<a class="card" href="([^"]+)"/g)].map((m) => m[1])
    expect(hrefs).toHaveLength(94)
    const slugs = [...ORDER.matchAll(/slug: '([^']*)'/g)].map((m) => m[1])
    expect(slugs).toHaveLength(94)
    for (let i = 0; i < slugs.length; i++) {
      const expected = '/caesura/story/' + (slugs[i] ? slugs[i] + '/' : '')
      expect(hrefs[i], `card #${i + 1}`).toBe(expected)
    }
  })

  it('母题按出现频次 + 标题加权取前四：第90/91/92篇必须带对应主母题', () => {
    const card90 = HTML.match(/class="card" href="\/caesura\/story\/the-one-left-empty\/" data-no="90" data-motifs="([^"]*)"/)
    expect(card90, '第90篇卡片缺失').toBeTruthy()
    expect(card90![1].split(' ')).toContain('empty')
    const card91 = HTML.match(/class="card" href="\/caesura\/story\/the-bell-not-cast\/" data-no="91" data-motifs="([^"]*)"/)
    expect(card91, '第91篇卡片缺失').toBeTruthy()
    expect(card91![1].split(' ')).toContain('bell')
    expect(card91![1].split(' ')).toContain('empty')
    const card92 = HTML.match(/class="card" href="\/caesura\/story\/the-black-at-the-pour-gate\/" data-no="92" data-motifs="([^"]*)"/)
    expect(card92, '第92篇卡片缺失').toBeTruthy()
    expect(card92![1].split(' ')).toContain('bell')
    expect(card92![1].split(' ')).toContain('empty')
    expect(card92![1].split(' ')).toContain('line')
    const card94 = HTML.match(/class="card" href="\/caesura\/story\/the-rain-kept-for-another\/" data-no="94" data-motifs="([^"]*)"/)
    expect(card94, '第94篇卡片缺失').toBeTruthy()

    const card93 = HTML.match(/class="card" href="\/caesura\/story\/the-second-print-on-the-mould\/" data-no="93" data-motifs="([^"]*)"/)
    expect(card93, '第93篇卡片缺失').toBeTruthy()
    for (const m of ['bell', 'empty', 'line', 'ledger']) expect(card93![1].split(' ')).toContain(m)
    for (const m of HTML.matchAll(/data-no="\d+" data-motifs="([^"]*)"/g)) {
      const tags = m[1].split(' ').filter(Boolean)
      expect(tags.length, `card ${m[0].slice(0, 30)} 标签数`).toBeGreaterThan(0)
      expect(tags.length, `card ${m[0].slice(0, 30)} 标签数`).toBeLessThanOrEqual(8)
    }
  })

  it('12 个母题筛 + 搜索框 + 已读统计', () => {
    const chips = [...HTML.matchAll(/class="chip" data-motif="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(chips).size).toBe(12)
    for (const id of ['salt', 'bowl', 'boat', 'ledger', 'door', 'bell', 'light', 'line', 'tide', 'ash', 'wind', 'empty']) {
      expect(chips, `missing motif: ${id}`).toContain(id)
    }
    expect(HTML).toContain('id="q"')
    expect(HTML).toContain('id="statRead"')
    expect(HTML).toContain('id="continueBtn"')
    expect(HTML).toContain('id="randomBtn"')
    expect(HTML).toContain("localStorage.getItem('caesura.reading.v1')")
  })

  it('双语页骨架 · 默认中文 · 语言开关 · tracker', () => {
    expect(HTML).toContain('data-lang="zh"')
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('余响索引')
    expect(HTML).toContain('Motif Atlas')
    expect(HTML).toContain('/caesura/tracker.js')
  })

  it('零网络依赖 · 无外链 script / stylesheet / 图片', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
    expect(HTML).not.toMatch(/<img[^>]*src=["']https?:/)
  })
})
