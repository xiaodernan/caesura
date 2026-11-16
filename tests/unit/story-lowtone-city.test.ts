import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《低音之城》故事页（story/lowtone-city/index.html）自证：
 *   ① 文件存在 + 默认中文；② 语言切换 + 双语两半齐全；③ 两半都带 canon（低音之城 / 石喉母亲 / 听账）；
 *   ④ 零网络请求；⑤ 与篇一/二/三/九/全集互链；⑥ 篇十五 · 余响集之十五。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/lowtone-city/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 之十五《低音之城》（story/lowtone-city/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, 'story/lowtone-city/index.html 不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('语言切换按钮存在（id="langToggle"）且双语两半同存', () => {
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('低音之城')
    expect(HTML).toContain('The City of Low Tones')
  })

  it('中文正文：含 canon（石喉母亲 / 低音之城 / 听账 / E♭）', () => {
    for (const marker of ['石喉母亲', '低音之城', '听账', 'E♭']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含 canon（Stone-Throat Matriarch / The Bass Citadel / the debt of listening）', () => {
    for (const marker of ['Stone-Throat Matriarch', 'The Bass Citadel', 'the debt of listening', 'one E♭']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（篇一/三/九/十/十一/十二/十三/十四/全集/世界谱 + 游戏）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/empty-bar/', '/caesura/story/stonethroat/', '/caesura/story/first-bell/', '/caesura/story/dark-tide/', '/caesura/story/twelfth-listener/', '/caesura/story/bell-picker/', '/caesura/story/lampwright-bell/', '/caesura/story/anthology/', '/caesura/', '/caesura/codex/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })
})
