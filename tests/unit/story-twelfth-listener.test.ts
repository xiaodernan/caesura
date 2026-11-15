import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《后记 · 第十二个听者》故事页（story/twelfth-listener/index.html）自证：
 *   ① 文件存在 + 默认中文；② 语言切换 + 双语两半齐全；③ 两半都带出 canon（第十二个听者）；
 *   ④ 零网络请求；⑤ 与篇一/三/九/十/全集/世界谱/游戏互链。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/twelfth-listener/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 之十二《后记 · 第十二个听者》（story/twelfth-listener/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, 'story/twelfth-listener/index.html 不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('语言切换按钮存在（id="langToggle"）且双语两半同存', () => {
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('第十二个听者')
    expect(HTML).toContain('The Twelfth Listener')
  })

  it('中文正文：含 canon（十二只手 / 听见的人 / 第十二个听者）', () => {
    for (const marker of ['十二只手', '听见的人', '第十二个听者']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含 canon 与闭环（The Twelfth Listener / Those who heard it / read this line）', () => {
    for (const marker of ['The Twelfth Listener', 'Those who heard it', 'read this line']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（篇一/三/九/十/十一 + 全集 + 世界谱 + 游戏）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/empty-bar/', '/caesura/story/stonethroat/', '/caesura/story/first-bell/', '/caesura/story/dark-tide/', '/caesura/story/anthology/', '/caesura/', '/caesura/codex/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })
})
