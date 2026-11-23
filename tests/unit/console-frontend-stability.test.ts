import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * console（集大成调度台）前端稳定性门钉——F-124 的长期护栏，2026-11-15 KI-573 落。
 * 这些选择器被删一个，面板立刻在内窗口里再次撑破 / 挤压 / 断词失效：
 *   `.panel{min-width:0}` · `.panel-head{flex-wrap:wrap}` · `text-wrap:balance` ·
 *   `body *{overflow-wrap:anywhere}` · `[class$="-sc"]{break-all}` · 行内 `.num{flex-basis:…}`。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const CSS = readFileSync(resolve(ROOT, 'console/styles.css'), 'utf8')
const APP = readFileSync(resolve(ROOT, 'console/app.js'), 'utf8')
const HTML = readFileSync(resolve(ROOT, 'console/index.html'), 'utf8')

const panelBlock = () => {
  const i = CSS.indexOf('.panel {')
  return i >= 0 ? CSS.slice(i, i + 400) : ''
}
const panelHeadBlock = () => {
  const i = CSS.indexOf('.panel-head {')
  return i >= 0 ? CSS.slice(i, i + 240) : ''
}

describe('console 前端稳定性门钉（F-124 的长期护栏）', () => {
  it('body, body * 断词（中文 + camelCase 长串不撑破列）', () => {
    expect(CSS).toContain('body, body * { overflow-wrap: anywhere;')
  })

  it('`.panel{min-width:0}` 在位（grid 列不撑破）', () => {
    expect(panelBlock()).toContain('min-width: 0')
  })

  it('`.panel-head{flex-wrap:wrap}` 在位（梯形行可换行）', () => {
    expect(panelHeadBlock()).toContain('flex-wrap: wrap')
  })

  it('`.panel-head h2` 居中断词（min-width:0 + text-wrap:balance）', () => {
    expect(CSS).toMatch(/\.panel-head h2 \{[^}]*min-width:\s*0;[^}]*text-wrap: balance;/s)
  })

  it('`.cc-line .num` 梯形行重排基线存在', () => {
    expect(CSS).toMatch(/\.cc-line\s+\.num\s*\{[^}]*flex-basis:\s*\d+px/)
  })

  it('`.pg-line .num` 梯形行重排基线存在', () => {
    expect(CSS).toMatch(/\.pg-line\s+\.num\s*\{[^}]*flex-basis:\s*\d+px/)
  })

  it('`.pc-line .num` 梯形行重排基线存在', () => {
    expect(CSS).toMatch(/\.pc-line\s+\.num\s*\{[^}]*flex-basis:\s*\d+px/)
  })

  it('`.gf-line .num` 梯形行重排基线存在', () => {
    expect(CSS).toMatch(/\.gf-line\s+\.num\s*\{[^}]*flex-basis:\s*\d+px/)
  })

  it('`[class$="-sc"]` 断词兜底（break-all）在位', () => {
    expect(CSS).toContain('[class$="-sc"]')
    expect(CSS).toMatch(/\[class\$="-sc"\]\s*\{[^}]*overflow-wrap: anywhere/)
  })

  it('app.js 保留 overflow 巡检钩（querySelectorAll(body *)）', () => {
    expect(APP).toContain("querySelectorAll('body *')")
  })

  it('index.html 页脚含故事链接出口（盐 / 空拍子 / 账本 / 余响集 / 霜锤 / 千门 / 暗潮 / 后记 / 低音之城 / 钟摆渡人 / 未竟账页 / 第四下 / 末弦 / 听弦 / 第三声 / 合奏 / 回声谷 / 半声之后 / 铜扣旁 / 线外 / 纸袋之后 / 窗台盐线 / 盐线之后 / 窗台记数 / 空处之后 / 未刻之数 / 秤旁 / 未记的一页 / 干处 / 未称之物 / 空秤 / 秤盘之外 / 秤影 / 门槛之外 / 门外的湿痕 / 门槛上的盐 / 未开之页 / 未寄出的信 / 空秤之后 / 未摆的一次 / 船底的干痕 / 未问之船 / 船上的空处 / 盐未上船 / 船未启 / 壶边 / 圈印 / 壶底旧痕 / 未动的摆 / 未交接 / 摆旁空位 / 摆下的盐 / 干痕仍在 / 潮退添柴 / 摆不回 / 摆旁的灰 / 灰未落 / 干痕未进 / 灰不催 / 火自己知道 / 灰不归 / 淡痕 / 未添的一笔 / 页角自翻 / 又多一个傍晚 / 薄簿合着 / 未答之问 / 夜开的一线 / 她也一线 / 摆旁一页 / 未渡的一页 / 盐还在）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/empty-bar/', '/caesura/story/ledger/',
      '/caesura/story/anthology/', '/caesura/story/frostbell/', '/caesura/story/doors/',
      '/caesura/story/dark-tide/', '/caesura/story/twelfth-listener/', '/caesura/story/bell-picker/',
      '/caesura/story/lampwright-bell/', '/caesura/story/lowtone-city/', '/caesura/story/pendulum-ferryman/', '/caesura/story/unfinished-ledger/', '/caesura/story/fourth-strike/', '/caesura/story/last-string/', '/caesura/story/string-listener/', '/caesura/story/third-voice/', '/caesura/story/ensemble/', '/caesura/story/echo-vale/', '/caesura/story/after-half-a-chime/', '/caesura/story/beside-the-button/', '/caesura/story/beyond-the-line/', '/caesura/story/after-the-bag/', '/caesura/story/salt-on-the-sill/', '/caesura/story/after-the-salt-line/', '/caesura/story/the-sill-keeps-count/', '/caesura/story/after-the-space/', '/caesura/story/the-unmarked-number/', '/caesura/story/beside-the-scale/', '/caesura/story/the-unentered-page/', '/caesura/story/the-dry-place/', '/caesura/story/unweighed/', '/caesura/story/the-empty-scale/', '/caesura/story/beyond-the-scale/', '/caesura/story/the-scale-shadow/', '/caesura/story/beyond-the-threshold/', '/caesura/story/the-mark-outside/', '/caesura/story/salt-at-the-threshold/', '/caesura/story/the-unopened-page/', '/caesura/story/the-unsent-letter/', '/caesura/story/after-the-empty-scale/', '/caesura/story/the-unmade-swing/', '/caesura/story/the-dry-mark-beneath/', '/caesura/story/the-unasked-boat/', '/caesura/story/the-place-aboard/', '/caesura/story/salt-not-aboard/', '/caesura/story/the-boat-still/', '/caesura/story/beside-the-jar/', '/caesura/story/the-ring/', '/caesura/story/the-mark-beneath-the-jar/', '/caesura/story/the-unmoved-pendulum/', '/caesura/story/no-handover/', '/caesura/story/beside-the-pendulum/', '/caesura/story/salt-beside-the-seat/', '/caesura/story/the-mark-remains/', '/caesura/story/at-ebb-one-stick/', '/caesura/story/the-swing-unreturned/', '/caesura/story/the-ash-beside-the-pendulum/', '/caesura/story/ash-not-fallen/', '/caesura/story/the-mark-not-entered/', '/caesura/story/the-ash-unhurried/', '/caesura/story/the-fire-knows/', '/caesura/story/the-ash-unreturned/', '/caesura/story/the-fading-mark/', '/caesura/story/the-unentered-stroke/', '/caesura/story/the-corner-turns/', '/caesura/story/one-more-dusk/', '/caesura/story/the-ledger-shut/', '/caesura/story/the-unanswered-question/', '/caesura/story/one-line-in-the-night/', '/caesura/story/she-too-a-seam/', '/caesura/story/a-page-beside-the-pendulum/', '/caesura/story/the-unferried-page/', '/caesura/story/the-salt-is-there/', '/caesura/story/the-boats-measure/', '/caesura/story/two-lines/', '/caesura/story/a-page-by-the-boat/', '/caesura/story/the-unsent-page/', '/caesura/story/the-empty-bowl/']) {
      expect(HTML, `missing story href: ${href}`).toContain(href)
    }
  })

  it('LANG_EXACT 含八十二篇故事双语键（盐系列本页切英文时不裸奔 CJK）', () => {
    for (const pair of [
      "'《盐》': 'Salt',",
      "'《空拍子》': 'The Empty Bar',",
      "'《账本》': 'The Ledger',",
      "'《回声庭园》': 'The Garden of Return',",
      "'《雨审判》': 'The Rain Tribunal',",
      "'《余响集》': 'The Aftermath',",
      "'《霜锤》': 'The Frostbell',",
      "'《千门》': 'The Thousand Doors',",
      "'《暗潮》': 'The Dark Tide',",
      "'《后记 · 第十二个听者》': 'Epilogue · The Twelfth Listener',",
      "'《拾钟人》': 'The Bell-Picker',",
      "'《灯匠》': 'The Lampwright',",
      "'《低音之城》': 'The City of Low Tones',",
      "'《钟摆渡人》': 'The Pendulum Ferryman',",
      "'《未竟账页》': 'The Unfinished Ledger Page',",
      "'《第四下》': 'The Fourth Strike',",
      "'《末弦》': 'The Last String',",
      "'篇十一': 'No. 11',",
      "'篇十二': 'No. 12',",
      "'篇十三': 'No. 13',",
      "'篇十四': 'No. 14',",
      "'篇十五': 'No. 15',",
      "'篇十六': 'No. 16',",
      "'篇十七': 'No. 17',",
      "'篇十八': 'No. 18',",
      "'篇十九': 'No. 19',",
      "'篇二十': 'No. 20',",
      "'《听弦》': 'The String-Listener',",
      "'篇二十一': 'No. 21',",
      "'《第三声》': 'The Third Voice',",
      "'篇二十二': 'No. 22',",
      "'《合奏》': 'The Ensemble',",
      "'篇二十三': 'No. 23',",
      "'《回声谷》': 'The Echo Vale',",
      "'篇二十四': 'No. 24',",
      "'《半声之后》': 'After Half a Chime',",
      "'篇二十五': 'No. 25',",
      "'《铜扣旁》': 'Beside the Button',",
      "'篇二十六': 'No. 26',",
      "'《线外》': 'Beyond the Line',",
      "'篇二十七': 'No. 27',",
      "'《纸袋之后》': 'After the Bag',",
      "'篇二十八': 'No. 28',",
      "'《窗台盐线》': 'Salt on the Sill',",
      "'篇二十九': 'No. 29',",
      "'《盐线之后》': 'After the Salt Line',",
      "'篇三十': 'No. 30',",
      "'《窗台记数》': 'The Sill Keeps Count',",
      "'篇三十一': 'No. 31',",
      "'《空处之后》': 'After the Space',",
      "'篇三十二': 'No. 32',",
      "'《未刻之数》': 'The Unmarked Number',",
      "'篇三十三': 'No. 33',",
      "'《秤旁》': 'Beside the Scale',",
      "'篇三十四': 'No. 34',",
      "'《未记的一页》': 'The Unentered Page',",
      "'篇三十五': 'No. 35',",
      "'《干处》': 'The Dry Place',",
      "'篇三十六': 'No. 36',",
      "'《未称之物》': 'Unweighed',",
      "'篇三十七': 'No. 37',",
      "'《空秤》': 'The Empty Scale',",
      "'篇三十八': 'No. 38',",
      "'《秤盘之外》': 'Beyond the Scale',",
      "'篇三十九': 'No. 39',",
      "'《秤影》': 'The Scale\\'s Shadow',",
      "'篇四十': 'No. 40',",
      "'《门槛之外》': 'Beyond the Threshold',",
      "'篇四十一篇': 'No. 41',",
      "'《门外的湿痕》': 'The Mark Outside',",
      "'篇四十二': 'No. 42',",
      "'《门槛上的盐》': 'Salt at the Threshold',",
      "'篇四十三': 'No. 43',",
      "'《未开之页》': 'The Unopened Page',",
      "'篇四十四': 'No. 44',",
      "'《未寄出的信》': 'The Unsent Letter',",
      "'篇四十五': 'No. 45',",
      "'《空秤之后》': 'After the Empty Scale',",
      "'篇四十六': 'No. 46',",
      "'《未摆的一次》': 'The Unmade Swing',",
      "'篇四十七': 'No. 47',",
      "'《船底的干痕》': 'The Dry Mark Beneath',",
      "'篇四十八': 'No. 48',",
      "'《未问之船》': 'The Unasked Boat',",
      "'篇四十九': 'No. 49',",
      "'《船上的空处》': 'The Place Aboard',",
      "'篇五十': 'No. 50',",
      "'《盐未上船》': 'Salt Not Aboard',",
      "'篇五十一': 'No. 51',",
      "'《船未启》': 'The Boat Still',",
      "'篇五十二': 'No. 52',",
      "'《壶边》': 'Beside the Jar',",
      "'篇五十三': 'No. 53',",
      "'《圈印》': 'The Ring',",
      "'篇五十四': 'No. 54',",
      "'《壶底旧痕》': 'The Mark Beneath the Jar',",
      "'篇五十五': 'No. 55',",
      "'《未动的摆》': 'The Unmoved Pendulum',",
      "'篇五十六': 'No. 56',",
      "'《未交接》': 'No Handover',",
      "'篇五十七': 'No. 57',",
      "'《摆旁空位》': 'The Place Beside the Pendulum',",
      "'篇五十八': 'No. 58',",
      "'《摆下的盐》': 'Salt Beside the Seat',",
      "'篇五十九': 'No. 59',",
      "'《干痕仍在》': 'The Mark Remains',",
      "'篇六十': 'No. 60',",
      "'《潮退添柴》': 'At Ebb, One Stick',",
      "'篇六十一': 'No. 61',",
      "'《摆不回》': 'The Swing Unreturned',",
      "'篇六十二': 'No. 62',",
      "'《摆旁的灰》': 'Ash Beside the Pendulum',",
      "'篇六十三': 'No. 63',",
      "'《灰未落》': 'Ash Not Fallen',",
      "'干痕未进': 'The Mark Not Entered',",
      "'篇六十四': 'No. 64',",
      "'《干痕未进》': 'The Mark Not Entered',",
      "'篇六十四 · 干痕未进': 'No. 64 · The Mark Not Entered',",
      "'摆停在最低处 · 干痕未进薄簿 · 她只是添柴 · 谁也不先开口': 'The pendulum rested at its lowest point; the dry mark never entered the thin ledger; she only fed the fire',",
      "'篇六十五': 'No. 65',",
      "'《灰不催》': 'The Ash Unhurried',",
      "'灰不催': 'The Ash Unhurried',",
      "'篇六十五 · 灰不催': 'No. 65 · The Ash Unhurried',",
      "'阿汐添柴时指尖的灰还没有落 · 她没有催它 · 有些落下不必收存': 'As she fed the stove, the ash still clung to her fingertip; she did not hurry it; some things fall without needing to be kept',",
      "'篇六十六': 'No. 66',",
      "'《火自己知道》': 'The Fire Knows',",
      "'火自己知道': 'The Fire Knows',",
      "'篇六十六 · 火自己知道': 'No. 66 · The Fire Knows',",
      "'她不添柴也不熄柴 · 只看着灶火照自己的火候燃着 · 有些火候自己知道': 'She did not add, she did not put out; the fire knew its own heat',",
      "'篇六十七': 'No. 67',",
      "'《灰不归》': 'The Ash Unreturned',",
      "'灰不归': 'The Ash Unreturned',",
      "'篇六十七 · 灰不归': 'No. 67 · The Ash Unreturned',",
      "'清晨，指尖的灰还没有落 · 水壶自己知道时候 · 有些灰不必归还给火': 'At dawn the ash still clung to her fingertip; the kettle knew its own hour; some ash need not return to the fire',",
      "'篇六十八': 'No. 68',",
      "'《淡痕》': 'The Fading Mark',",
      "'淡痕': 'The Fading Mark',",
      "'篇六十八 · 淡痕': 'No. 68 · The Fading Mark',",
      "'灰挂着盐在门槛 · 淡痕不必补记 · 有些痕迹淡了也不必补': 'the ash still clung; the salt still stood; the faded mark stayed unrecorded',",
      "'篇六十九': 'No. 69',",
      "'《未添的一笔》': 'The Unentered Stroke',",
      "'未添的一笔': 'The Unentered Stroke',",
      "'篇六十九 · 未添的一笔': 'No. 69 · The Unentered Stroke',",
      "'傍晚灰淡了她没写进薄簿 · 夜里簿自己翻过去一页她什么也没记': 'At dusk the ash faded; that night the page turned on its own; she recorded nothing',",
      "'篇七十': 'No. 70',",
      "'《页角自翻》': 'The Corner Turns',",
      "'页角自翻': 'The Corner Turns',",
      "'篇七十 · 页角自翻': 'No. 70 · The Corner Turns',",
      "'傍晚薄簿合着页角偶尔自己翻动 · 她没有记下 · 册子自己知道时候': 'At dusk the ledger stood shut; the page corner turned now and then; she recorded nothing',",
      "'篇七十一': 'No. 71',",
      "'《又多一个傍晚》': 'One More Dusk',",
      "'又多一个傍晚': 'One More Dusk',",
      "'篇七十一 · 又多一个傍晚': 'No. 71 · One More Dusk',",
      "'止音纪元又多了一个傍晚 · 阿汐没有记下 · 有些傍晚不需要谁数': 'At dusk the ledger stood shut; she recorded nothing; some dusks need no one to count them',",
      "'篇七十二': 'No. 72',",
      "'《薄簿合着》': 'The Ledger, Shut',",
      "'薄簿合着': 'The Ledger, Shut',",
      "'篇七十二 · 薄簿合着': 'No. 72 · The Ledger, Shut',",
      "'薄簿合着页角偶尔动一下 · 有些页合着也仍在 · 册子自己记': 'At dusk the ledger stood shut; some pages remain, even closed; the book remembered itself',",
      "'篇七十三': 'No. 73',",
      "'《未答之问》': 'The Unanswered Question',",
      "'未答之问': 'The Unanswered Question',",
      "'篇七十三 · 未答之问': 'No. 73 · The Unanswered Question',",
      "'她有一个没答案也不需要答案的问题 · 船一直停着 · 册子自己翻': 'She carried a question that needed no answer; the boat stayed outside; the book turned on its own',",
      "'篇七十四': 'No. 74',",
      "'《夜开的一线》': 'One Line in the Night',",
      "'夜开的一线': 'One Line in the Night',",
      "'篇七十四 · 夜开的一线': 'No. 74 · One Line in the Night',",
      "'夜里门留着一线 · 清晨外面干痕仍在 · 盐立门槛册子自己翻': 'Through the night the door kept a narrow opening; salt and the book staying still',",
      "'篇七十五': 'No. 75',",
      "'《她也一线》': 'She, Too, a Seam',",
      "'她也一线': 'She, Too, a Seam',",
      "'篇七十五 · 她也一线': 'No. 75 · She, Too, a Seam',",
      "'她自己也是一线门缝 · 盐立门槛册子自己翻 · 她也合着她也在': 'At dusk she drew her hand from the threshold; she, too, was a seam; the salt and the book stayed where they had always stood',",
      "'篇七十六': 'No. 76',",
      "'《摆旁一页》': 'A Page Beside the Pendulum',",
      "'摆旁一页': 'A Page Beside the Pendulum',",
      "'篇七十六 · 摆旁一页': 'No. 76 · A Page Beside the Pendulum',",
      "'她把薄簿放在摆旁没打开 · 页角抬起一线又落下 · 她没有替它们记下这一夜': 'She did not open it; some pages need no opening',",
      "'篇七十七': 'No. 77',",
      "'《未渡的一页》': 'The Unferried Page',",
      "'未渡的一页': 'The Unferried Page',",
      "'篇七十七 · 未渡的一页': 'No. 77 · The Unferried Page',",
      "'她不替这一夜记下什么 · 摆轮完了页角偶尔抬起又落下 · 册子自己合着': 'The page corner rose and settled now and then; the book stayed shut; she entered nothing',",
      "'篇七十八': 'No. 78',",
      "'《盐还在》': 'The Salt Is There',",
      "'盐还在': 'The Salt Is There',",
      "'篇七十八 · 盐还在': 'No. 78 · The Salt Is There',",
      "'篇八十': 'No. 80',",
      "'《两条线》': 'Two Lines',",
      "'两条线': 'Two Lines',",
      "'潮退干痕还在潮涨它被覆过再退它还在原处 · 她没有量这条线也没有记它 · 有些线各自知道来处': 'Some lines know where they belong.',",
      "'篇八十 · 两条线': 'No. 80 · Two Lines',",
            "'篇八十二': 'No. 82',",
      "'篇八十五': 'No. 85',",
      "'《门内一夜》': 'A Night Within',",
      "'门内一夜': 'A Night Within',",
      "'门槛边的盐还在 · 薄簿合着 · 傍晚她没有去看海': 'The empty bowl by the door',",
      "'篇八十五 · 门内一夜': 'No. 85 · A Night Within',",
      "'篇八十三': 'No. 83',",
      "'《门边的空碗》': 'The Empty Bowl',",
      "'篇八十三 · 门边的空碗': 'No. 83 · The Empty Bowl',",
      "'篇八十四': 'No. 84',",
      "'《门口的水》': 'Water by the Door',",
      "'篇八十四 · 门口的水': 'No. 84 · Water by the Door',",
      "'篇八十六': 'No. 86',",
      "'《碗底的一线》': 'A Line at the Bottom of the Bowl',",
      "'篇八十六 · 碗底的一线': 'No. 86 · A Line at the Bottom of the Bowl',",
      "'篇八十七': 'No. 87',",
      "'《碗沿的缺口》': 'The Chip on the Rim',",
      "'篇八十七 · 碗沿的缺口': 'No. 87 · The Chip on the Rim',",
      "'篇八十八': 'No. 88',",
      "'《门缝的风》': 'The Wind at the Seam',",
      "'门缝的风': 'The Wind at the Seam',",
      "'篇八十八 · 门缝的风': 'No. 88 · The Wind at the Seam',",
      "'篇八十九 · 风在灰上写字': 'No. 89 · The Wind Writes on the Ash',",
      "'篇九十 · 空着的一格': 'No. 90 · The One Left Empty',",
      "'《空着的一格》': 'The One Left Empty',",
      "'篇九十一': 'No. 91',",
      "'篇九十二': 'No. 92',",
      "'篇九十一 · 未铸之钟': 'No. 91 · The Bell Not Cast',",
      "'《未铸之钟》': 'The Bell Not Cast',",
      "'未铸之钟': 'The Bell Not Cast',",
      "'篇九十二 · 浇口上的黑': 'No. 92 · The Black at the Pour Gate',",
      "'《浇口上的黑》': 'The Black at the Pour Gate',",
      "'浇口上的黑': 'The Black at the Pour Gate',",
      "'《风在灰上写字》': 'The Wind Writes on the Ash',",
      "'风在灰上写字': 'The Wind Writes on the Ash',",
      "'灰替风记账 · 线每天换方向 · 有些账不抄下来才不会被记成债': 'The ash keeps the wind’s accounts; the line changes direction daily; some accounts never copied never become debts',",
      "'《未寄的一页》': 'The Unsent Page',",
      "'未寄的一页': 'The Unsent Page',",
      "'清晨船边的一页仍在 · 阿汐没有翻它 · 潮退又见潮涨又覆': 'The page by the boat remained at dawn.',",
      "'篇八十二 · 未寄的一页': 'No. 82 · The Unsent Page',",
      "'篇八十一': 'No. 81',",
      "'《船边的一页》': 'A Page by the Boat',",
      "'船边的一页': 'A Page by the Boat',",
      "'门外的船仍停着 · 她把手放在薄簿旁边薄簿没有动 · 她记录这一夜没有留下什么': 'She records nothing of this night.',",
      "'篇八十一 · 船边的一页': 'No. 81 · A Page by the Boat',",
      "'篇七十九': 'No. 79',",
      "'《空船的刻度》': 'The Boat’s Measure',",
      "'空船的刻度': 'The Boat’s Measure',",
      "'篇七十九 · 空船的刻度': 'No. 79 · The Boat’s Measure',",
      "'门外的船仍停着船底的干痕仍在 · 阿汐没有量它们之间的距离 · 有些刻度不必拿来量': 'Some measures need not be used.',",
      "'天亮了阿汐没有去看海 · 光斜进来落在盐身上它没有动 · 有些盐在那儿就够了': 'Some salt is there, and that is enough',",

      "'余响九十二篇 · 沉默的编年史': 'Ninety-Two Chronicles · The Chronicles of Silence',",
      "'九十二篇都是《止音纪元》的人间注脚——每一篇双语对照、零 LLM；完整全文见': 'The ninety-two stories are The Epoch of Hush in mortal footnotes — each one bilingual, zero LLM; the full volume:',",
      "'（约四百六十分钟 · 九十二篇整册可读）': '(about 460 minutes · read all ninety-two)',",

      "'余响三十七篇 · 沉默的编年史': 'Thirty-seven Chronicles · The Chronicles of Silence',",
      "'STATEGRAPH · 状态图内核': 'State Graph Kernel',",
      "'节点是纯函数：同入参同出参（×100）': 'Nodes are pure: same input → same output (×100)',",
      "'interrupt() 人审回路：挂起→审批→同 thread 恢复（interrupt → resume）': 'interrupt() human-in-the-loop: suspend → approve → resume on the same thread',",
    ]) {
      expect(APP, `missing LANG_EXACT pair: ${pair}`).toContain(pair)
    }
  })
})
