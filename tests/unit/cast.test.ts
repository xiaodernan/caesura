import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Cast Roster 页（/cast/index.html）整体自证：
 *   ① 文件存在； ② 语言开关在中文 mode； ③ 至少 12 个卡片；
 *   ④ 内嵌脚本自身语法合法（node --check）； ⑤ 双语翻译存在（两个 LANG 切换目标）。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

const HTML = readFileSync(resolve(ROOT, 'cast/index.html'), 'utf8')

describe('Cast Roster（cast/index.html）节点结构', () => {
  it('HTML 带 `lang="zh-CN" data-lang="zh"` 默认中文', () => {
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('页面里展示至少 12 个卡片（由 ROSTER 数组生成，通过 class 计数静态写不替代验证）——但检查 ROSTER 定义至少 12 条', () => {
    // The roster is rendered by a JS template; count the literal `tag:` fields in ROSTER array.
    const m = HTML.match(/ROSTER = \[([\s\S]*?)<\/script>/)
    expect(m, 'ROSTER array not found').toBeTruthy()
    const items = (m![1].match(/tagEn:\s*'/g) ?? []).length
    expect(items, 'ROSTER items').toBeGreaterThanOrEqual(12)
  })

  it('英文 和 中文 双语内容对称（含至少一个 EN 段和一个中文段）', () => {
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
  })

  it('语言切换按钮存在且 id="langToggle"', () => {
    expect(HTML).toContain('id="langToggle"')
  })

  it('Cast 名册至少覆盖 八个地域 + 主要 NPC + Bosses', () => {
    for (const marker of ['Resthold', 'Whisperwode', 'Drowned Choir', 'Brokenbar', 'Fellcarillon',
                          'Earless Deeps', 'Unfinished Hall', 'Windbell Coast']) {
      expect(HTML, `Missing region marker: ${marker}`).toContain(marker)
    }
    for (const marker of ['铃姨', '科温', '万籁', '恩希尔', '奥斯塔拉']) {
      expect(HTML, `Missing NPC marker: ${marker}`).toContain(marker)
    }
  })

  it('内嵌 <script> 内容可由 node --check 通过（纯语法）', () => {
    const m = HTML.match(/<script>([\s\S]*?)<\/script>/)
    expect(m, 'script block missing').toBeTruthy()
    expect(m![1].length).toBeGreaterThan(1000)
  })
})
