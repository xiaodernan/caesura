import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-654（KI-645 行动 #4 · 趋势研判裁决）：正文阅读进度 + 下一篇入口。
 *
 * 裁决原文：「为正文加入阅读进度与下一篇入口；以读完率达到百分之七十为验收」。
 * 这里钉住机器可验收的每一格：
 *   ① read-progress.js 存在、零网络、零 LLM；
 *   ② 全部 85 个正文页（篇一《盐》= /caesura/story/ + 62 个 slug 目录）都引用它；
 *   ③ canon 顺序 ORDER = 83 项，与 atlas-texts.ts 的 no: 1..85 对应；
 *   ④ 双语标签 · ⑤ 减动效/可访问性 · ⑥ story-finished 串联 KI-653 通道；
 *   ⑦ admin 本机实况两格真读数。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const RP = resolve(ROOT, 'public/read-progress.js')
const read = (p: string): string => readFileSync(p, 'utf8')

describe('KI-654 · 阅读进度 + 下一篇入口（KI-645 行动 #4）', () => {
  it('read-progress.js 存在 · 零网络 · 零 LLM · 只写 transform 不触发重排', () => {
    const s = read(RP)
    expect(s).toContain('readbar')
    expect(s).toContain('scaleX')
    expect(s).toContain('requestAnimationFrame')
    expect(s).not.toMatch(/fetch\s*\(/)
    expect(s).not.toMatch(/XMLHttpRequest/)
    expect(s).not.toMatch(/https?:\/\//)
    expect(s).not.toMatch(/OpenAI|gpt-|claude-|api\.aizzz/)
  })

  it('85 个正文页全部引用 /caesura/read-progress.js', () => {
    const storyDir = resolve(ROOT, 'story')
    const pages = [
      'index.html',
      ...readdirSync(storyDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== 'anthology')
        .map((d) => `${d.name}/index.html`)
    ]
    expect(pages, 'expected salt root + 84 slugs').toHaveLength(85)
    for (const rel of pages) {
      const s = read(resolve(storyDir, rel))
      expect(s, `missing read-progress in ${rel}`).toContain('data')
      expect(s, `missing read-progress script in ${rel}`).toContain('/caesura/read-progress.js')
    }
  })

  it('canon 顺序 = 85 项 · 与 atlas-texts.ts 的 no 一一对应', () => {
    const s = read(RP)
    const m = s.match(/var ORDER = \[([\s\S]*?)\];/)
    expect(m, 'ORDER block not found').toBeTruthy()
    const slugs = [...m![1].matchAll(/slug: '([^']*)'/g)].map((x) => x[1])
    expect(slugs).toHaveLength(85)
    expect(slugs[0]).toBe('')           // 篇一《盐》= /caesura/story/
    expect(slugs[1]).toBe('unnamed-stone')
    expect(slugs[25]).toBe('beyond-the-line')
    expect(slugs[26]).toBe('after-the-bag')
    expect(slugs[27]).toBe('salt-on-the-sill')
    expect(slugs[28]).toBe('after-the-salt-line')
    expect(slugs[29]).toBe('the-sill-keeps-count')
    expect(slugs[30]).toBe('after-the-space')
    expect(slugs[31]).toBe('the-unmarked-number')
    expect(slugs[32]).toBe('beside-the-scale')
    expect(slugs[33]).toBe('the-unentered-page')
    expect(slugs[34]).toBe('the-dry-place')
    expect(slugs[35]).toBe('unweighed')
    expect(slugs[36]).toBe('the-empty-scale')
    expect(slugs[37]).toBe('beyond-the-scale')
    expect(slugs[38]).toBe('the-scale-shadow')
    expect(slugs[39]).toBe('beyond-the-threshold')
    expect(slugs[40]).toBe('the-mark-outside')
    expect(slugs[41]).toBe('salt-at-the-threshold')
    expect(slugs[42]).toBe('the-unopened-page')
    expect(slugs[43]).toBe('the-unsent-letter')
    expect(slugs[44]).toBe('after-the-empty-scale')
    expect(slugs[45]).toBe('the-unmade-swing')
    expect(slugs[46]).toBe('the-dry-mark-beneath')
    expect(slugs[47]).toBe('the-unasked-boat')
    expect(slugs[48]).toBe('the-place-aboard')
    expect(slugs[49]).toBe('salt-not-aboard')
    expect(slugs[50]).toBe('the-boat-still')
    expect(slugs[51]).toBe('beside-the-jar')
    expect(slugs[52]).toBe('the-ring')
    expect(slugs[53]).toBe('the-mark-beneath-the-jar')
    expect(slugs[54]).toBe('the-unmoved-pendulum')
    expect(slugs[55]).toBe('no-handover')
    expect(slugs[56]).toBe('beside-the-pendulum')
    expect(slugs[57]).toBe('salt-beside-the-seat')
    expect(slugs[58]).toBe('the-mark-remains')
    expect(slugs[59]).toBe('at-ebb-one-stick')
    expect(slugs[60]).toBe('the-swing-unreturned')
    expect(slugs[61]).toBe('the-ash-beside-the-pendulum')
    expect(slugs[62]).toBe('ash-not-fallen')
    expect(slugs[63]).toBe('the-mark-not-entered')
    expect(slugs[64]).toBe('the-ash-unhurried')
    expect(slugs[65]).toBe('the-fire-knows')
    expect(slugs[66]).toBe('the-ash-unreturned')
    expect(slugs[67]).toBe('the-fading-mark')
    expect(slugs[68]).toBe('the-unentered-stroke')
    expect(slugs[69]).toBe('the-corner-turns')
    expect(slugs[70]).toBe('one-more-dusk')
    expect(slugs[71]).toBe('the-ledger-shut')
    expect(slugs[72]).toBe('the-unanswered-question')
    expect(slugs[73]).toBe('one-line-in-the-night')
    expect(slugs[74]).toBe('she-too-a-seam')
    expect(slugs[75]).toBe('a-page-beside-the-pendulum')
    expect(slugs[76]).toBe('the-unferried-page')
    expect(slugs[77]).toBe('the-salt-is-there')
    expect(slugs[78]).toBe('the-boats-measure')
    expect(slugs[79]).toBe('two-lines')
    expect(slugs[80]).toBe('a-page-by-the-boat')
    expect(slugs[81]).toBe('the-unsent-page')
    expect(slugs[82]).toBe('the-empty-bowl')
    expect(slugs[83]).toBe('water-by-the-door')
    expect(slugs[84]).toBe('a-night-within')
    const atlas = read(resolve(ROOT, 'src/ui/atlas-texts.ts'))
    expect((atlas.match(/no: \d+,/g) || []).length).toBe(85)
  })

  it('双语标签与本机记账键在源码里', () => {
    const s = read(RP)
    for (const marker of ['下一篇', 'Next · ', '余响集 · 八十五篇全集', 'Keep reading', 'caesura.reading.v1', 'story-finished']) {
      expect(s, `missing: ${marker}`).toContain(marker)
    }
  })

  it('可访问性：减动效支持 · 真 <a> · aria-hidden 进度条', () => {
    const s = read(RP)
    expect(s).toContain('prefers-reduced-motion')
    expect(s).toContain("document.createElement('a')")
    expect(s).toContain('aria-hidden')
  })

  it('串联 KI-653 埋点通道：story-finished / story-next 只打本机', () => {
    const s = read(RP)
    expect(s).toContain('__caesuraTrack')
    expect(s).toContain("'story-finished'")
    expect(s).toContain("'story-next'")
  })

  it('admin 本机实况：读完篇数与下一篇点击两格（不是装饰）', () => {
    const s = read(resolve(ROOT, 'admin/app.js'))
    expect(s).toContain('storyFinishes')
    expect(s).toContain('storyNext')
    expect(s).toContain("'story-finished'")
    expect(s).toContain("'story-next'")
  })
})
