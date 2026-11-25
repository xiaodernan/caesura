import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * KI-738 · 说明书跟得上新功能。
 *
 * 病：KI-736「拾遗」与 KI-737「深处」都是**玩家看得见的新内容**，但教程页（玩家真正会读的那份
 * 简明说明书）一个字没提；同时页脚的全集篇目停在第八十一篇，比游戏本体少了四篇，
 * 中文侧还有一个「篇四十一篇」的叠字——正是用户点名要修的「错别字 / 有则改之」。
 *
 * 这一组只钉**可机器判定**的那几件事：新章节在、双语齐全、篇目到底、叠字不再、并且
 * 「深处不计里程」这句话与运行时的诚实边界同源（两边都写，改一边另一边会红）。
 */

const html = readFileSync(new URL('../../tutorial/index.html', import.meta.url), 'utf8')
const descendSrc = readFileSync(new URL('../../src/quest/Descend.ts', import.meta.url), 'utf8')

const count = (re: RegExp): number => (html.match(re) ?? []).length

describe('KI-738 · 教程页补上「深处」与「拾遗」', () => {
  it('深处一节真的在，且中英两条都在（不是只写中文再让英文 404）', () => {
    expect(html).toContain('深处 · 走不完的那一层')
    expect(html).toContain('The Deep · the floor you never finish')
    expect(html).toContain('wandering echoes')
    expect(html).toContain('拾遗')
  })

  it('入口写法与游戏一致：Tab 开地图、右栏最后一行是深处（玩家照做能走到）', () => {
    expect(/<span class="key">Tab<\/span> 开地图/.test(html)).toBe(true)
    expect(/Press <span class="key">Tab<\/span> for the map/.test(html)).toBe(true)
    expect(html).toContain('再下一层')
    expect(html).toContain('one floor deeper')
  })

  it('诚实边界两边同源：教程说「不计里程 / 已落记录不回滚」，Descend.ts 也这么说', () => {
    expect(html).toContain('不计里程')
    expect(html).toContain('已经落下的记录不回滚')
    expect(html).toContain('no mileage')
    expect(descendSrc).toContain('不计里程')
    // 复沓层不落旗标这条不许只在文档里成立：运行时的注释必须仍在
    expect(descendSrc).toContain('不立旗标')
  })

  it('双语段数守恒（只有一侧的段落 = 另一种语言的读者读到空白）', () => {
    const zh = count(/class="[^"]*zh-copy/g)
    const en = count(/class="[^"]*en-copy/g)
    expect(zh).toBeGreaterThan(20)
    expect(zh).toBe(en)
  })
})

describe('KI-738 · 页脚全集跟上 92 篇 + 叠字', () => {
  it('页脚补到第九十二篇（新链接都在，中英各一份）', () => {
    for (const slug of ['the-unsent-page', 'the-empty-bowl', 'water-by-the-door', 'a-night-within', 'a-line-in-the-bowl', 'the-chip-on-the-rim', 'the-wind-at-the-seam', 'the-wind-writes-on-the-ash', 'the-one-left-empty', 'the-bell-not-cast', 'the-black-at-the-pour-gate', 'the-second-print-on-the-mould', 'the-rain-kept-for-another']) {
      expect(html).toContain('/caesura/story/' + slug + '/')
    }
    expect(html).toContain('篇八十六 · 碗底的一线')
    expect(html).toContain('No. 86 · A Line at the Bottom of the Bowl')
    expect(html).toContain('篇八十七 · 碗沿的缺口')
    expect(html).toContain('No. 87 · The Chip on the Rim')
    expect(html).toContain('篇八十八 · 门缝的风')
    expect(html).toContain('No. 88 · The Wind at the Seam')
    expect(html).toContain('篇八十九 · 风在灰上写字')
    expect(html).toContain('No. 89 · The Wind Writes on the Ash')
    expect(html).toContain('篇九十 · 空着的一格')
    expect(html).toContain('No. 90 · The One Left Empty')
    expect(html).toContain('篇九十一 · 未铸之钟')
    expect(html).toContain('No. 91 · The Bell Not Cast')
    expect(html).toContain('篇九十二 · 浇口上的黑')
    expect(html).toContain('No. 92 · The Black at the Pour Gate')
    expect(html).toContain('篇九十三 · 模上的第二道指印')
    expect(html).toContain('No. 93 · The Second Print on the Mould')
    expect(html).toContain('篇九十四 · 替人记的雨')
    expect(html).toContain('No. 94 · The Rain Kept for Another')
    expect(html).toContain('No. 82 · The Unsent Page')
  })

  it('「篇四十一篇」这种叠字不再出现（错别字：有则改之）', () => {
    expect(html).not.toContain('篇四十一篇')
    expect(html).toContain('篇四十一 · 门外的湿痕')
  })
})
