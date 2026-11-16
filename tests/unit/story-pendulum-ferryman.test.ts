import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《钟摆渡人》故事页（story/pendulum-ferryman/index.html）自证：
 *   ① 文件存在 + 默认中文；② 语言切换 + 双语两半齐全；③ 两半都带 canon（未竟厅 / 钟摆 / 恩希尔）；
 *   ④ 零网络请求；⑤ 与篇一/三/九/十/全集/篇十五互链；⑥ 篇十六 · 余响集之十六。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/pendulum-ferryman/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 之十六《钟摆渡人》（story/pendulum-ferryman/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, 'story/pendulum-ferryman/index.html 不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('语言切换按钮存在（id="langToggle"）且双语两半同存', () => {
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('钟摆渡人')
    expect(HTML).toContain('The Pendulum Ferryman')
  })

  it('中文正文：含 canon（未竟厅 / 钟摆 / 恩希尔）', () => {
    for (const marker of ['未竟厅', '钟摆', '恩希尔']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含 canon（Unfinished Hall / pendulum / Hersil）', () => {
    for (const marker of ['Unfinished Hall', 'pendulum', 'Hersil']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（篇一/三/九/十/全集/世界谱/篇十五 + 游戏）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/empty-bar/', '/caesura/story/stonethroat/', '/caesura/story/first-bell/', '/caesura/story/twelfth-listener/', '/caesura/story/lowtone-city/', '/caesura/story/anthology/', '/caesura/', '/caesura/codex/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })
})
