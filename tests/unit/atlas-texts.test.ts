import { describe, expect, it } from 'vitest'
import { STORY_CHAPTERS } from '@/ui/atlas-texts'

/**
 * src/ui/atlas-texts.ts — 五十六篇双语全文内嵌模块的门钉（2026-11-16 KI-618 扩 · 2026-11-17/18 KI-621/KI-623/KI-634/KI-639/KI-641/KI-643/KI-648/KI-649/KI-650/KI-651/KI-652/KI-657/KI-658/KI-659/KI-661/KI-662/KI-664/KI-665/KI-666/KI-667/KI-668/KI-669/KI-670/KI-671/KI-672/KI-673/KI-674/KI-675/KI-676/KI-677/KI-678/KI-679/KI-680/KI-681/KI-682/KI-683/KI-684/KI-685/KI-686/KI-687 增篇十七→五十六）。
 * 这些腿钉住的是「游记」一定能把五十六篇短篇读出来的基本盘：
 *   ① 五十六篇齐全 · 编号 1..56；
 *   ② 中文篇与英文篇都必须有真实正文（百句级不是占位符）；
 *   ③ 每篇至少有一个被游记渲染依赖的标记（p / beat / coda）；
 *   ④ 名称与姜读相对应（中文标题·英文标题与故事对齐，防机械错位）。
 */

describe('Atlas 五十六篇全文（atlas-texts.ts）', () => {
  it('恰好五十六篇 · 编号 1..56 严格递增', () => {
    expect(STORY_CHAPTERS.length).toBe(56)
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

  it('中文标题严格对应（五十六篇顺序）', () => {
    expect(STORY_CHAPTERS.map((c) => c.zhTitle)).toEqual([
      '盐', '山下无名碑', '空拍子', '账本', '回声庭园',
      '雨审判', '霜锤', '千门', '石喉', '第一钟', '暗潮', '后记 · 第十二个听者', '拾钟人', '灯匠', '低音之城', '钟摆渡人', '未竟账页', '第四下', '末弦', '听弦', '第三声', '合奏', '回声谷', '半声之后', '铜扣旁', '线外', '纸袋之后', '窗台盐线', '盐线之后', '窗台记数', '空处之后', '未刻之数', '秤旁', '未记的一页', '干处', '未称之物', '空秤', '秤盘之外', '秤影', '门槛之外', '门外的湿痕', '门槛上的盐', '未开之页', '未寄出的信', '空秤之后', '未摆的一次', '船底的干痕', '未问之船', '船上的空处', '盐未上船', '船未启', '壶边', '圈印', '壶底旧痕', '未动的摆', '未交接',
    ])
  })

  it('英文标题严格对应（五十六篇顺序）', () => {
    expect(STORY_CHAPTERS.map((c) => c.enTitle)).toEqual([
      'Salt', 'The Nameless Stone', 'The Empty Bar', 'The Ledger', 'The Garden of Return',
      'The Rain Tribunal', 'The Frostbell', 'The Thousand Doors', 'The Stone-Throat', 'The First Bell', 'The Dark Tide', 'Epilogue · The Twelfth Listener', 'The Bell-Picker', 'The Lampwright', 'The City of Low Tones', 'The Pendulum Ferryman', 'The Unfinished Ledger Page', 'The Fourth Strike', 'The Last String', 'The String-Listener', 'The Third Voice', 'The Ensemble', 'The Echo Vale', 'After Half a Chime', 'Beside the Button', 'Beyond the Line', 'After the Bag', 'Salt on the Sill', 'After the Salt Line', 'The Sill Keeps Count', 'After the Space', 'The Unmarked Number', 'Beside the Scale', 'The Unentered Page', 'The Dry Place', 'Unweighed', 'The Empty Scale', 'Beyond the Scale', "The Scale's Shadow", 'Beyond the Threshold', 'The Mark Outside', 'Salt at the Threshold', 'The Unopened Page', 'The Unsent Letter', 'After the Empty Scale', 'The Unmade Swing', 'The Dry Mark Beneath', 'The Unasked Boat', 'The Place Aboard', 'Salt Not Aboard', 'The Boat Still', 'Beside the Jar', 'The Ring', 'The Mark Beneath the Jar', 'The Unmoved Pendulum', 'No Handover',
    ])
  })

  it('人物到篇对应（阿衡 / 阿汀 / 恩希尔 / 麦格 / Meg / Hersil / 守夜人 / 阿汐 / 阿笙）', () => {
    const all = STORY_CHAPTERS.map((c) => c.zh + c.en).join('\n')
    for (const marker of ['阿衡', '阿汀', '恩希尔', '麦格', 'Meg', 'Hersil', 'Hersil', '守夜人', '阿汐', 'String-Listener', '阿笙', 'third voice', '老石喉', 'four drawers', '四个抽屉', '阿沉', 'sound-token']) {
      expect(all, `missing marker: ${marker}`).toContain(marker)
    }
  })
})
