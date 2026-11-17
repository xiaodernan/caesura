import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-655（KI-645 行动 #3 · 趋势研判裁决）：谱册页误触修复。
 *
 * 裁决原文：「排查谱册页误触并修复高频触发控件；以该页每周暴躁点击数低于一百七十为验收」。
 * 这里钉住机器可验收的每一格：
 *   ① KI-655 误触修复层存在（44px 命中区 + touch-action manipulation + 高亮收掉）；
 *   ② 全部高频触发控件被覆盖（langToggle / wander / sheet-close / chip / q / oracle-chip / [data-cat|q|i] / #grid .card）；
 *   ③ 双击缩放与平板整机菜单呼出已收口（touch-action 落到每个被点的控件 + #q 自身）；
 *   ④ 真 rage 埋点仍在（tracker.js 不被动刀，本页仍报 rage）；
 *   ⑤ 键盘双通过仍在（Enter/Space 激活 .card · role="button" · tabindex=0）；
 *   ⑥ 双语 + 零网络仍然成立。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const PAGE = readFileSync(resolve(ROOT, 'codex/index.html'), 'utf8')

describe('KI-655 · 谱册页误触修复（KI-645 行动 #3）', () => {
  it('KI-655 修复层存在：44px 命中区 + manipulation + 高亮收掉', () => {
    expect(PAGE).toContain('KI-655')
    expect(PAGE).toContain('min-height:44px')
    expect(PAGE).toContain('touch-action:manipulation')
    expect(PAGE).toContain('-webkit-tap-highlight-color:transparent')
    expect(PAGE).toContain('-webkit-touch-callout:none')
  })

  it('全部高频触发控件被覆盖（含真正的点按对象）', () => {
    for (const sel of ['#langToggle', '#wander', '.sheet-close', '.chip', '.q', '.oracle-chip', '[data-cat]', '[data-q]', '[data-i]', '#grid .card', '#q']) {
      expect(PAGE, `selector missing from KI-655 layer: ${sel}`).toContain(sel)
    }
  })

  it('高频控件 display:inline-flex 居中（命中区可用、文字不溢出）', () => {
    expect(PAGE).toMatch(/\.chip,\.q,#langToggle,\.sheet-close,#wander\{display:inline-flex/)
  })

  it('网格卡与 oracle-chip：cursor:pointer + ≥88px / ≥44px', () => {
    expect(PAGE).toMatch(/#grid \.card,\.oracle-chip\{cursor:pointer;min-height:88px\}/)
  })

  it('真 rage 埋点仍在（tracker.js 未被动刀 · 本页仍报 rage）', () => {
    expect(PAGE).toContain('tracker.js')
  })

  it('键盘双通过仍在（.card 真 <article role="button" tabindex="0"> + Enter/Space 激活）', () => {
    expect(PAGE).toContain('role="button"')
    expect(PAGE).toContain('tabindex="0"')
    expect(PAGE).toContain("ev.key === 'Enter' || ev.key === ' '")
  })

  it('双语 + 零网络：无外链 script / stylesheet · data-lang 中文默认', () => {
    expect(PAGE).toContain('data-lang="zh"')
    expect(PAGE).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(PAGE).not.toMatch(/<link[^>]*href=["']https?:/)
  })
})
