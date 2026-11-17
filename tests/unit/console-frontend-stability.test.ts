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

  it('index.html 页脚含故事链接出口（盐 / 空拍子 / 账本 / 余响集 / 霜锤 / 千门 / 暗潮 / 后记 / 低音之城 / 钟摆渡人 / 未竟账页 / 第四下 / 末弦 / 听弦 / 第三声 / 合奏 / 回声谷）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/empty-bar/', '/caesura/story/ledger/',
      '/caesura/story/anthology/', '/caesura/story/frostbell/', '/caesura/story/doors/',
      '/caesura/story/dark-tide/', '/caesura/story/twelfth-listener/', '/caesura/story/bell-picker/',
      '/caesura/story/lampwright-bell/', '/caesura/story/lowtone-city/', '/caesura/story/pendulum-ferryman/', '/caesura/story/unfinished-ledger/', '/caesura/story/fourth-strike/', '/caesura/story/last-string/', '/caesura/story/string-listener/', '/caesura/story/third-voice/', '/caesura/story/ensemble/', '/caesura/story/echo-vale/']) {
      expect(HTML, `missing story href: ${href}`).toContain(href)
    }
  })

  it('LANG_EXACT 含二十三篇故事双语键（盐系列本页切英文时不裸奔 CJK）', () => {
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

      "'余响二十三篇 · 沉默的编年史': 'Twenty-three Chronicles · The Chronicles of Silence',",
      "'STATEGRAPH · 状态图内核': 'State Graph Kernel',",
      "'节点是纯函数：同入参同出参（×100）': 'Nodes are pure: same input → same output (×100)',",
      "'interrupt() 人审回路：挂起→审批→同 thread 恢复（interrupt → resume）': 'interrupt() human-in-the-loop: suspend → approve → resume on the same thread',",
    ]) {
      expect(APP, `missing LANG_EXACT pair: ${pair}`).toContain(pair)
    }
  })
})
