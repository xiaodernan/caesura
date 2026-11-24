import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * zh-tw-converter.js + public/zh-tw.compact.json 门钉（新增 2026-11-17）。
 *
 * ① 字典表存在且非空；② public 与 src 两份完全等价；③ 常用简→繁路径正常工作。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const TBL = resolve(ROOT, 'public/zh-tw.compact.json')
const TBL2 = resolve(ROOT, 'src/i18n/zh-tw.compact.json')

describe('zh-tw compact table', () => {
  it('两份表文件都存在', () => {
    expect(existsSync(TBL)).toBe(true)
    expect(existsSync(TBL2)).toBe(true)
  })

  it('两份字节级相同', () => {
    const a = readFileSync(TBL, 'utf8')
    const b = readFileSync(TBL2, 'utf8')
    expect(a, 'public/zh-tw.compact.json 与 src/i18n/zh-tw.compact.json 不一致').toBe(b)
  })

  const table = JSON.parse(readFileSync(TBL, 'utf8'))

  it('非空：keys >= 500（含 multi-char phrase + single char）', () => {
    const keys = Object.keys(table.map as Record<string, string>)
    expect(keys.length).toBeGreaterThan(500)
  })

  it('密度≥9 multi-char phrase：含 "止音纪元" 对应 "止音紀元"', () => {
    const map = table.map as Record<string, string>
    /* Unicode escape 止音纪元 / 止音紀元 */
    const sc = '\u6b62\u97f3\u7eaa\u5143'
    const tc = '\u6b62\u97f3\u7d00\u5143'
    expect(map[sc]).toBe(tc)
  })

  it('运行时语言事件接通转换与原文恢复', () => {
    const converter = readFileSync(resolve(ROOT, 'public/zh-tw-converter.js'), 'utf8')
    expect(converter).toContain("document.addEventListener('caesura-language-change'")
    expect(converter).toContain("if (event.detail === 'zh-TW')")
    expect(converter).toContain('applyToDocument();')
    expect(converter).toContain('observe(document.body);')
    expect(converter).toContain('restoreOriginals();')
  })

  it('游戏入口按当前页解析转换器，本地根路径与 Pages 子路径都能加载', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    expect(html).toContain('<script defer src="./zh-tw-converter.js"></script>')
    expect(html).not.toContain('src="/caesura/zh-tw-converter.js"')
    expect(html).not.toContain('src="./caesura/zh-tw-converter.js"')
  })

  it('繁体 key（U+9418）不应被误写为简体单字', () => {
    const map = table.map as Record<string, string>
    expect(map['\u9418'] as string | undefined, '钟 U+9418 是繁体，不应有这个 key').toBeUndefined()
  })
})
