import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《千门》故事页（story/doors/index.html）自证：
 *   ① 文件存在 + 默认中文；② 语言切换 + 双语两半齐全；③ 两半都带出设计册 canon（回廊钟 / 守门人 / 一千扇门）；
 *   ④ 零网络请求；⑤ 与篇一/二/三/七/全集互链。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/doors/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 之八《千门》（story/doors/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, 'story/doors/index.html 不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('语言切换按钮存在（id="langToggle"）且双语两半同存', () => {
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('千门')
    expect(HTML).toContain('The Thousand Doors')
  })

  it('中文正文：含 canon（守门人 / 一千扇 / 第一扇门 / 门自己开了）', () => {
    for (const marker of ['守门人', '一千扇门', '第一扇门', '门自己开了']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含 canon 与闭环（The Gatekeeper / door of her own home / opened itself）', () => {
    for (const marker of ['The Gatekeeper', 'door of her own home', 'opened itself', 'first one']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（篇一/二/三/七 + 全集 + 世界谱 + 游戏）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/unnamed-stone/', '/caesura/story/empty-bar/', '/caesura/story/frostbell/', '/caesura/story/anthology/', '/caesura/', '/caesura/codex/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })
})
