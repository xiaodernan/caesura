import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'story/the-second-bowl/index.html')
const HTML = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('Story 第九十五篇《第二只碗》(story/the-second-bowl/index.html)', () => {
  it('文件存在 + 默认中文 + 三语切换按钮', () => {
    expect(HTML).toContain('lang="zh-CN"')
    expect(HTML).toContain('data-lang="zh"')
    expect(HTML).toContain('id="langToggle"')
  })
  it('中英标题与第九十五篇标注', () => {
    expect(HTML).toContain('第二只碗')
    expect(HTML).toContain('The Second Bowl')
    expect(HTML).toContain('第九十五篇')
    expect(HTML).toContain('No. 95')
  })
  it('zh / en 两半正文都在，且前篇链接存在', () => {
    for (const m of ['灶台', '碗', '哥哥', '别等我，先吃', '空位']) expect(HTML, `zh missing: ${m}`).toContain(m)
    for (const m of ['hearth', 'bowls', 'brother', 'eat first', 'empty place']) expect(HTML, `en missing: ${m}`).toContain(m)
    expect(HTML).toContain('/caesura/story/the-rain-kept-for-another/')
  })
  it('离线零外链 + 阅读进度 / 双语转换脚本在位', () => {
    expect(HTML).toContain('/caesura/read-progress.js')
    expect(HTML).toContain('zh-tw-converter.js')
    expect(HTML).not.toMatch(/<link[^>]+href="https?:/)
  })
})
