import { describe, expect, it } from 'vitest'
import { STORY_CHAPTERS } from '@/ui/atlas-texts'

/**
 * src/ui/atlas-texts.ts — 十九篇双语全文内嵌模块的门钉（2026-11-16 KI-618 扩 · 2026-11-17 KI-621/KI-623/KI-634 增篇十七/十八/十九）。
 * 这些腿钉住的是「游记」一定能把十九篇短篇读出来的基本盘：
 *   ① 十九篇齐全 · 编号 1..19；
 *   ② 中文篇与英文篇都必须有真实正文（百句级不是占位符）；
 *   ③ 每篇至少有一个被游记渲染依赖的标记（p / beat / coda）；
 *   ④ 名称与姜读相对应（中文标题·英文标题与故事对齐，防机械错位）。
 */

describe('Atlas 十九篇全文（atlas-texts.ts）', () => {
  it('恰好十九篇 · 编号 1..19 严格递增', () => {
    expect(STORY_CHAPTERS.length).toBe(19)
    STORY_CHAPTERS.forEach((c, i) => expect(c.no).toBe(i + 1))
  })

  it('每篇都有中文与英文正文 · 非空且充数量级', () => {
    for (const c of STORY_CHAPTERS) {
      expect(c.zh.replace(/<[^>]+>/g, '').trim().length, `zh too short: ${c.zhTitle}`).toBeGreaterThan(600)
      expect(c.en.replace(/<[^>]+>/g, '').trim().length, `en too short: ${c.enTitle}`).toBeGreaterThan(600)
    }
  })

  it('每篇正文都含 <p> 段落 · 游记渲染必备', () => {
    for (const c of STORY_CHAPTERS) {
      expect(c.zh, `zh missing <p> in ${c.zhTitle}`).toContain('<p')
      expect(c.en, `en missing <p> in ${c.enTitle}`).toContain('<p')
    }
  })

  it('中文标题严格对应（十九篇顺序）', () => {
    expect(STORY_CHAPTERS.map((c) => c.zhTitle)).toEqual([
      '盐', '山下无名碑', '空拍子', '账本', '回声庭园',
      '雨审判', '霜锤', '千门', '石喉', '第一钟', '暗潮', '后记 · 第十二个听者', '拾钟人', '灯匠', '低音之城', '钟摆渡人', '未竟账页', '第四下', '末弦',
    ])
  })

  it('英文标题严格对应（十九篇顺序）', () => {
    expect(STORY_CHAPTERS.map((c) => c.enTitle)).toEqual([
      'Salt', 'The Nameless Stone', 'The Empty Bar', 'The Ledger', 'The Garden of Return',
      'The Rain Tribunal', 'The Frostbell', 'The Thousand Doors', 'The Stone-Throat', 'The First Bell', 'The Dark Tide', 'Epilogue · The Twelfth Listener', 'The Bell-Picker', 'The Lampwright', 'The City of Low Tones', 'The Pendulum Ferryman', 'The Unfinished Ledger Page', 'The Fourth Strike', 'The Last String',
    ])
  })

  it('人物到篇对应（阿衡 / 阿汀 / 恩希尔 / 麦格 / Meg / Hersil / Meg / 守夜人）', () => {
    const all = STORY_CHAPTERS.map((c) => c.zh + c.en).join('\n')
    for (const marker of ['阿衡', '阿汀', '恩希尔', '麦格', 'Meg', 'Hersil', 'Hersil', '守夜人']) {
      expect(all, `missing marker: ${marker}`).toContain(marker)
    }
  })
})
