import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 任务步双语键位闸：
 *   ① `quests.json` 每一步都必须登记 `labelKey`；
 *   ② 该键必须双语同时存在且非空；
 *   ③ ZH 字典该键的**逐字**就是 quests.json 里那条 label（数据与字典一个源头，改一处忘另一处当场红）；
 *   ④ EN 字典该键**零 CJK**（EN 模式不许出现中文字形）。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const QUESTS = JSON.parse(readFileSync(resolve(ROOT, 'src/data/json/quests.json'), 'utf8')) as Array<{
  id: string
  nameKey: string
  steps: Array<{ state: string; label: string; labelKey?: string }>
}>
const SRC = readFileSync(resolve(ROOT, 'src/i18n/Lang.ts'), 'utf8')

const dictBlock = (name: 'ZH' | 'EN'): string => {
  const start = SRC.indexOf(`const ${name}: Record<string, string> = {`)
  expect(start, `${name} 字典不在 Lang.ts 里`).toBeGreaterThan(-1)
  const end = SRC.indexOf('\n}\n', start)
  return SRC.slice(start, end)
}
const bodyOf = (block: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)',?$/mg)) {
    out[m[1]] = m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  }
  return out
}
const ZH = bodyOf(dictBlock('ZH'))
const EN = bodyOf(dictBlock('EN'))

const ALL_STEPS = QUESTS.flatMap((q) => q.steps.map((st) => ({ q: q.id, ...st })))

describe('quest steps 双语对账', () => {
  it('每一步都登记 labelKey，且解析出非空字符串', () => {
    for (const st of ALL_STEPS) {
      expect(st.labelKey, `${st.q} ${st.state} 没登记 labelKey`).toBeTruthy()
      expect(st.labelKey!.startsWith('quest.'), `${st.labelKey} 命名不是 quest.*`).toBe(true)
    }
  })

  it('labelKey 双语都在、非空；ZH 逐字等于 label', () => {
    for (const st of ALL_STEPS) {
      expect(ZH[st.labelKey!], `ZH 缺 ${st.labelKey}`).toBeTruthy()
      expect(EN[st.labelKey!], `EN 缺 ${st.labelKey}`).toBeTruthy()
      expect(ZH[st.labelKey!], `ZH 与 quests.json label 不一致：${st.state}`).toBe(st.label)
    }
  })

  it('EN 侧 labelKey 零 CJK', () => {
    for (const st of ALL_STEPS) {
      expect(EN[st.labelKey!], `EN 键 ${st.labelKey} 混入中文字形`).not.toMatch(/[一-鿿]/)
    }
  })

  it('quest 级 nameKey 双语齐全', () => {
    for (const q of QUESTS) {
      expect(ZH[q.nameKey], `ZH 缺 ${q.nameKey}`).toBeTruthy()
      expect(EN[q.nameKey], `EN 缺 ${q.nameKey}`).toBeTruthy()
    }
  })
})
