import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《第一钟》故事页（story/first-bell/index.html）自证：
 *   ① 文件存在 + 默认中文；② 语言切换 + 双语两半齐全；③ 两半都带出 canon（第一口钟 / 铸钟人）；
 *   ④ 零网络请求；⑤ 与篇一/二/三/四/七/九/全集互链。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/first-bell/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 之十《第一钟》（story/first-bell/index.html）', () => {
  it('文件存在且默认中文 data-lang="zh"', () => {
    expect(HTML.length, 'story/first-bell/index.html 不存在').toBeGreaterThan(100)
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
  })

  it('语言切换按钮存在（id="langToggle"）且双语两半同存', () => {
    expect(HTML).toContain('id="langToggle"')
    expect(HTML).toContain('class="zh-copy"')
    expect(HTML).toContain('class="en-copy"')
    expect(HTML).toContain('第一钟')
    expect(HTML).toContain('The First Bell')
  })

  it('中文正文：含 canon（最后的铸钟人 / 第一口钟 / 写下来）', () => {
    for (const marker of ['最后的铸钟人', '这口钟没有被任何人敲过', '沉默本来就是这一场', '第一次']) {
      expect(HTML, `zh missing: ${marker}`).toContain(marker)
    }
  })

  it('英文正文：含 canon 与闭环（The Last Bell-Smith / never struck by anyone / first silence）', () => {
    for (const marker of ['The Last Bell-Smith', 'never struck by anyone', 'silence', 'the first strike']) {
      expect(HTML, `en missing: ${marker}`).toContain(marker)
    }
  })

  it('零网络请求（无外链 script / stylesheet）', () => {
    expect(HTML).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(HTML).not.toMatch(/<link[^>]*href=["']https?:/)
  })

  it('链接出口存在（篇一/二/三/四/七/九 + 全集 + 世界谱 + 游戏）', () => {
    for (const href of ['/caesura/story/', '/caesura/story/unnamed-stone/', '/caesura/story/empty-bar/', '/caesura/story/ledger/', '/caesura/story/frostbell/', '/caesura/story/stonethroat/', '/caesura/story/anthology/', '/caesura/', '/caesura/codex/']) {
      expect(HTML, `missing link: ${href}`).toContain(href)
    }
  })
})
