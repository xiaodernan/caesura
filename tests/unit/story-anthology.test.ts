import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《余响集》全集页（story/anthology/index.html）自证：
 *   ① 文件存在 + 默认中文；② 语言切换 + 双语两半齐全；③ 正文含六十篇故事的全部出口；
 *   ④ 零网络请求；⑤ 链接到全部六篇 + 世界谱 + 游戏。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/anthology/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('余响集（story/anthology/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, 'story/anthology/index.html 不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('语言切换按钮存在（id="langToggle"）且双语两半同存', () => {
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('余响集')
    expect(HTML).toContain('The Aftermath')
  })

  it('中文正文：含六十篇全部标题', () => {
    for (const marker of ['《盐》', '《山下无名碑》', '《空拍子》', '《账本》', '《回声庭园》', '《雨审判》', '《霜锤》', '《千门》', '《石喉》', '《第一钟》', '《暗潮》', '《后记 · 第十二个听者》', '《拾钟人》', '《灯匠》', '《低音之城》', '《钟摆渡人》', '《未竟账页》', '《第四下》', '《末弦》', '《听弦》', '《第三声》', '《合奏》', '《回声谷》', '《半声之后》', '《铜扣旁》', '《线外》', '《纸袋之后》', '《窗台盐线》', '《盐线之后》', '《窗台记数》', '《空处之后》', '《未刻之数》', '《秤旁》', '《未记的一页》', '《干处》', '《未称之物》', '《空秤》', '《秤盘之外》', '《秤影》', '《门槛之外》', '《门外的湿痕》', '《门槛上的盐》', '《未开之页》', '《未寄出的信》', '《空秤之后》', '《未摆的一次》', '《船底的干痕》', '《未问之船》', '《船上的空处》', '《盐未上船》', '《船未启》', '《壶边》', '《圈印》', '《壶底旧痕》', '《未动的摆》', '《未交接》', '《摆旁空位》', '《摆下的盐》', '《干痕仍在》', '《潮退添柴》']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含六十篇全部标题', () => {
    for (const marker of ['“Salt”', '“The Nameless Stone”', '“The Empty Bar”', '“The Ledger”', '“The Garden of Return”', '“The Rain Tribunal”', '“The Frostbell”', '“The Thousand Doors”', '“The Stone-Throat”', '“The First Bell”', '“The Dark Tide”', '“Epilogue · The Twelfth Listener”', '“The Bell-Picker”', '“The Lampwright”', '“The City of Low Tones”', '“The Pendulum Ferryman”', '“The Unfinished Ledger Page”', '“The Fourth Strike”', '“The Last String”', '“The String-Listener”', '“The Third Voice”', '“The Ensemble”', '“The Echo Vale”', '“After Half a Chime”', '“Beside the Button”', '“Beyond the Line”', '“After the Bag”', '“Salt on the Sill”', '“After the Salt Line”', '“The Sill Keeps Count”', '“After the Space”', '“The Unmarked Number”', '“Beside the Scale”', '“The Unentered Page”', '“The Dry Place”', '“Unweighed”', '“The Empty Scale”', '“Beyond the Scale”', "“The Scale's Shadow”", '“Beyond the Threshold”', '“The Mark Outside”', '“Salt at the Threshold”', '“The Unopened Page”', '“The Unsent Letter”', '“After the Empty Scale”', '“The Unmade Swing”', '“The Dry Mark Beneath”', '“The Unasked Boat”', '“The Place Aboard”', '“Salt Not Aboard”', '“The Boat Still”', '“Beside the Jar”', '“The Ring”', '“The Mark Beneath the Jar”', '“The Unmoved Pendulum”', '“No Handover”', '“The Place Beside the Pendulum”', '“Salt Beside the Seat”', '“The Mark Remains”', '“At Ebb, One Stick”']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('六十篇全部能链到（href 出口必须全）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/unnamed-stone/', '/caesura/story/empty-bar/', '/caesura/story/ledger/', '/caesura/story/garden/', '/caesura/story/tribunal/', '/caesura/story/frostbell/', '/caesura/story/doors/', '/caesura/story/stonethroat/', '/caesura/story/first-bell/', '/caesura/story/dark-tide/', '/caesura/story/twelfth-listener/', '/caesura/story/bell-picker/', '/caesura/story/lampwright-bell/', '/caesura/story/lowtone-city/', '/caesura/story/pendulum-ferryman/', '/caesura/story/unfinished-ledger/', '/caesura/story/fourth-strike/', '/caesura/story/last-string/', '/caesura/story/string-listener/', '/caesura/story/third-voice/', '/caesura/story/ensemble/', '/caesura/story/echo-vale/', '/caesura/story/after-half-a-chime/', '/caesura/story/beside-the-button/', '/caesura/story/beyond-the-line/', '/caesura/story/after-the-bag/', '/caesura/story/salt-on-the-sill/', '/caesura/story/after-the-salt-line/', '/caesura/story/the-sill-keeps-count/', '/caesura/story/after-the-space/', '/caesura/story/the-unmarked-number/', '/caesura/story/beside-the-scale/', '/caesura/story/the-unentered-page/', '/caesura/story/the-dry-place/', '/caesura/story/unweighed/', '/caesura/story/the-empty-scale/', '/caesura/story/beyond-the-scale/', '/caesura/story/the-scale-shadow/', '/caesura/story/beyond-the-threshold/', '/caesura/story/the-mark-outside/', '/caesura/story/salt-at-the-threshold/', '/caesura/story/the-unopened-page/', '/caesura/story/the-unsent-letter/', '/caesura/story/after-the-empty-scale/', '/caesura/story/the-unmade-swing/', '/caesura/story/the-dry-mark-beneath/', '/caesura/story/the-unasked-boat/', '/caesura/story/the-place-aboard/', '/caesura/story/salt-not-aboard/', '/caesura/story/the-boat-still/', '/caesura/story/beside-the-jar/', '/caesura/story/the-ring/', '/caesura/story/the-mark-beneath-the-jar/', '/caesura/story/the-unmoved-pendulum/', '/caesura/story/no-handover/', '/caesura/story/beside-the-pendulum/', '/caesura/story/salt-beside-the-seat/', '/caesura/story/the-mark-remains/', '/caesura/story/at-ebb-one-stick/', '/caesura/', '/caesura/codex/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })

  it('纸质整卷：@media print 样式 + #printBtn 按钮 + window.print() 直连', () => {
    expect(HTML).toContain('@media print')
    expect(HTML).toContain('@page')
    expect(HTML).toContain('break-inside: avoid')
    expect(HTML).toContain('id="printBtn"')
    expect(HTML).toContain('window.print()')
    expect(HTML).toContain('.shelf')
  })
})
