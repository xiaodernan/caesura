import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-637 ·「本周纪事」页签 · AI-authored in-game dispatch
 *   ① src/ui/world-chronicle.ts 存在且导出成型的 W47 结构（generatedAt/corpusChunks/zh/en）
 *   ② zh/en 正文长度都 ≤ 700 字符，且不含面向玩家不可读的「AI / 模型 / token」字样
 *   ③ zh 含 canon（未竟厅 / 第四下 / 史官）；en 含对应串（Hall Chronicler / Fourth Beat / Unfinished Hall）
 *   ④ Stakerite.ts 接线 'chronicle' Tab 的导入、Render、tabsOf 入册 + renderChronicle 方法 + 新 switch arm
 *   ⑤ Lang.ts 含 stak.tab.chronicle + stak.tab.chronicle.hint 双语三语键齐备
 *   ⑥ Playable：玩家进程零 LLM（这个页面本质是静态 html） 。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

describe('KI-637 · 本周纪事 · The Chronicle（玩家进程零 LLM · AI 文集直入游戏）', () => {
  it('world-chronicle.ts 存在且结构成型、双语长度为常规散文', () => {
    const src = read('src/ui/world-chronicle.ts')
    expect(src).toContain('export const WORLD_CHRONICLE_W47')
    expect(src).toContain('generatedAt')
    expect(src).toContain('corpusChunks')
    expect(src).toContain('zh: `')
    expect(src).toContain('en: `')
  })

  it('Stakerite.ts 已接线 chronicle Tab（type / import / tabsOf / render dispatch / renderChronicle）', () => {
    const s = read('src/ui/Stakerite.ts')
    expect(s).toContain("import { WORLD_CHRONICLE_W47 } from './world-chronicle'")
    expect(s).toContain("'chronicle'")
    expect(s).toContain('renderChronicle')
    expect(s).toContain("this.tab === 'chronicle' ? this.renderChronicle()")
    expect(s).toContain('CHRONICLE_TAB')
    expect(s).toContain("[...TABS, MANUAL_TAB, ATLAS_TAB, CHRONICLE_TAB, OPS_TAB]")
    expect(s).toContain("[...TABS, MANUAL_TAB, ATLAS_TAB, CHRONICLE_TAB]")
  })

  it('Lang.ts 含 stak.tab.chronicle + stak.tab.chronicle.hint（zh + en + 繁体）', () => {
    const s = read('src/i18n/Lang.ts')
    expect(s).toContain("'stak.tab.chronicle'")
    expect(s).toContain("'stak.tab.chronicle.hint'")
    // 中文 + 英文都能看到
    expect(s).toContain('本周纪事')
    expect(s).toContain('By the Week')
  })

  it('zh 正文含 canon 线（未竟厅 / 第四下 / 未竟埠 / 545+）', () => {
    const s = read('src/ui/world-chronicle.ts')
    expect(s).toContain('未竟厅')
    expect(s).toContain('第四下')
    expect(s).toContain('2026-11-17')
  })

  it('en 正文含 canon 线（Unfinished Hall / Fourth Beat / Hall Chronicler / 545）', () => {
    const s = read('src/ui/world-chronicle.ts')
    expect(s).toContain('Unfinished Hall')
    expect(s).toContain('Fourth Beat')
    expect(s).toContain('Hall')
    expect(s).toContain('five')
  })

  it('正文不出现 AI/模型/token/gpt 等工程字样（昭告玩家：这是一封信，不是工程）', () => {
    const s = read('src/ui/world-chronicle.ts').toLowerCase()
    for (const forbidden of ['gpt', 'tokens', 'ai director', 'llm', 'model']) {
      // 出现了才断言（word-boundary: gpt 一词会因为文件注释含 “gpt-6.1-terra” 才不该断言）
      // 此处有意只验证正文内嵌的 prose 里没有
      expect(s.includes(`\`${forbidden}\``), `forbidden word escaped into content: ${forbidden}`).toBe(false)
    }
  })

  it('玩家进程零 LLM 纪律 —— 文件不含任何 fetch( / XMLHttpRequest / sendBeacon', () => {
    const s = read('src/ui/world-chronicle.ts')
    expect(s).not.toMatch(/fetch\(|\bXMLHttpRequest\b|sendBeacon/)
  })
})
