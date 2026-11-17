import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * KI-646 · 教程 v1.11「30 秒快速上手 · 三步点亮」
 *   ① tutorial/index.html 含 qs3 快速上手区域（3 张卡 + 完成提示）
 *   ② 双轨 zh/en 副本平行对仗
 *   ③ 三张卡：01 定弦 / 02 进世界 / 03 活下来，均有 ping 动画 class .qs3-card + .qs3-pip
 *   ④ 完成横幅 qs3-done role="status" 双语均在
 *   ⑤ qs3 脚本：零 fetch / XMLHttpRequest / sendBeacon · 不出网
 *   ⑥ 页脚 v1.11（zh/en 双轨）
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const HTML = readFileSync(resolve(ROOT, 'tutorial/index.html'), 'utf8')

describe('KI-646 · 教程 v1.11 · 30 秒快速上手', () => {
  it('qs3 区块存在：三张卡 qs3-step-1..3 + 完成横幅 qs3-done', () => {
    for (const id of ['qs3-step-1', 'qs3-step-2', 'qs3-step-3', 'qs3-done']) {
      expect(HTML, `missing #${id}`).toContain(`id="${id}"`)
    }
    expect(HTML).toContain('id="qs3"')
  })

  it('双轨 zh/en 副本平行：每张卡都同时带 zh-copy 与 en-copy', () => {
    // 每个 step-card 段落同时含 zh-copy 与 en-copy
    const cards = HTML.match(/<button class="qs3-card"[\s\S]*?<\/button>/g) ?? []
    expect(cards.length).toBe(3)
    for (const card of cards) {
      expect(card).toContain('zh-copy')
      expect(card).toContain('en-copy')
      expect(card).toContain('qs3-pip')
    }
    // 完成横幅双语
    expect(HTML).toContain('三盏灯全亮')
    expect(HTML).toContain('Three pips lit')
  })

  it('三步标题/正文稳定：定弦 / 进世界 / 活下来 双轨均在', () => {
    for (const marker of ['按下', '行走', '挥剑', 'Press', 'walk', 'attack', 'String', 'Enter', 'Survive']) {
      expect(HTML, `missing marker: ${marker}`).toContain(marker)
    }
  })

  it('交互零出网：qs3 脚本不含 fetch( / XMLHttpRequest / sendBeacon', () => {
    const scriptMatch = HTML.match(/<script>[\s\S]*?<\/script>/g) ?? []
    const qs3Script = scriptMatch.find((s) => s.includes('caesura-qs3-lit')) ?? ''
    expect(qs3Script.length).toBeGreaterThan(200)
    expect(qs3Script).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon/)
  })

  it('完成横幅带 role="status" + aria-live="polite"（屏幕阅读器可知三灯全亮）', () => {
    expect(HTML).toMatch(/id="qs3-done"[^>]*role="status"/)
    expect(HTML).toMatch(/id="qs3-done"[^>]*aria-live="polite"/)
  })

  it('页脚版本号 v1.11 双语同步', () => {
    expect(HTML).toContain('CAESURA · v1.11 · 《止音纪元》官方教程')
    expect(HTML).toContain('CAESURA · v1.11 · Official Tutorial')
  })
})
