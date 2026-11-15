import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《暗潮》故事页（story/dark-tide/index.html）自证：
 *   ① 文件存在 + 默认中文；② 语言切换 + 双语两半齐全；③ 两半都带出 canon（第九个守夜人 / 黑暗森林）；
 *   ④ 零网络请求；⑤ 与篇一/三/十/全集/世界谱/游戏互链。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/dark-tide/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 之十一《暗潮》（story/dark-tide/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, 'story/dark-tide/index.html 不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('语言切换按钮存在（id="langToggle"）且双语两半同存', () => {
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('暗潮')
    expect(HTML).toContain('The Dark Tide')
  })

  it('中文正文：含 canon（第九个守夜人 / 频谱仪 / 三拍一停 / 暗潮未消）', () => {
    for (const marker of ['第九个守夜人', '频谱仪', '三拍一停', '暗潮未消']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含 canon 与闭环（ninth night-keeper / spectrometer / three beats and a pause / The Dark Tide has not receded）', () => {
    for (const marker of ['ninth night-keeper', 'spectrometer', 'three beats and a pause', 'The Dark Tide has not receded']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（篇一/三/十/全集 + 世界谱 + 游戏）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/empty-bar/', '/caesura/story/first-bell/', '/caesura/story/twelfth-listener/', '/caesura/story/anthology/', '/caesura/', '/caesura/codex/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })
})
