import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getLang, setLang, t } from '@/i18n/Lang'

/**
 * 双语字典的同构门（i18n infra）。
 *
 * `Lang.ts` 里 ZH／EN 两张字典必须**键集合完全一致**——少一个键的那一侧只会静默回退
 * （`t()` 找不到就退到 ZH、再找不到就吐回 key 字符串），于是「英文模式下面冒出中文」
 * 和「中文模式下面冒出半句英文」都会是无声的错位。键集合是结构事实，靠肉眼对两份
 * 几百行的表不可靠，只能让测试数。
 *
 * 第二条门：EN 字典里**不许出现 CJK 字符**——英文模式下面屏幕上不许有中文（中英不夹杂）。
 *
 * 顺带验证 `t()` 的行为：默认中文、缺键回吐 key、`${name}` 插值。
 */

const SRC = readFileSync(resolve(fileURLToPath(new URL('../../src/i18n/Lang.ts', import.meta.url))), 'utf8')

/** 从 src/i18n/Lang.ts 里抽一份 `<const NAME: Record<string, string> = { ... }` 的 `...` 块 */
const dictBlock = (name: 'ZH' | 'EN'): string => {
  const start = SRC.indexOf(`const ${name}: Record<string, string> = {`)
  expect(start, `${name} 字典不在 src/i18n/Lang.ts 里`).toBeGreaterThan(-1)
  const end = SRC.indexOf('\n}\n', start)
  expect(end, `${name} 字典找不到收尾`).toBeGreaterThan(-1)
  return SRC.slice(start, end)
}
const keysOf = (block: string): string[] =>
  [...block.matchAll(/^\s*'([^']+)':/mg)].map((m) => m[1])
const bodyOf = (block: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/^\s*'([^']+)':\s*('(?:[^'\\]|\\.)*'),?$/mg)) {
    out[m[1]] = m[2]
  }
  return out
}

afterEach(() => { setLang('zh') })

describe('i18n Lang 双字典同构', () => {
  it('ZH 与 EN 的键集合逐键相同（排序后对比）', () => {
    const zh = keysOf(dictBlock('ZH')).sort()
    const en = keysOf(dictBlock('EN')).sort()
    expect(en).toEqual(zh)
  })

  it('EN 字典里不许出现 CJK 字符（英文模式不夹杂中文）', () => {
    const en = bodyOf(dictBlock('EN'))
    expect(Object.keys(en).length).toBeGreaterThan(0)
    for (const [k, v] of Object.entries(en)) {
      expect(v, `EN 键 ${k} 里有中文字形`).not.toMatch(/[一-鿿]/)
    }
  })

  it('每个 t() 键都能在 EN/ZH 至少一侧读出字符串（不吐 key 兜底）', () => {
    const zh = keysOf(dictBlock('ZH'))
    for (const k of zh) {
      expect(setLang('zh')).toBe('zh')
      const z = t(k)
      expect(z).not.toBe(k)
      expect(setLang('en')).toBe('en')
      const e = t(k)
      expect(e).not.toBe(k)
    }
  })
})

describe('t() 的行为', () => {
  it('默认 zh；切 en 再切 zh 是可逆的', () => {
    expect(getLang()).toBe('zh')
    expect(t('stak.tab.tune')).toBe('调音')
    expect(setLang('en')).toBe('en')
    expect(t('stak.tab.tune')).toBe('Tune')
    expect(setLang('zh')).toBe('zh')
    expect(t('stak.tab.tune')).toBe('调音')
  })

  it('缺键回吐 key 本身（不是 undefined，也不是中文）', () => {
    expect(t('no.such.key.anywhere')).toBe('no.such.key.anywhere')
  })

  it('${name} 插值在两种语言下都生效', () => {
    expect(t('stak.profile.name', { n: 2 })).toBe('配置文件 2')
    setLang('en')
    expect(t('stak.profile.name', { n: 2 })).toBe('Profile 2')
  })
})
