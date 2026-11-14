import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 区域交互物 verb 双语闸：
 *   ① regions.json 里每一条带 verb 的交互行都必须登记 verbKey；
 *   ② ZH 字典该键**逐字**就是那条 verb（数据与字典一个源头，改一处忘另一处当场红）；
 *   ③ EN 字典该键**零 CJK**（英文模式不许出现中文字形）。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const REGIONS = JSON.parse(readFileSync(resolve(ROOT, 'src/data/json/regions.json'), 'utf8')) as Array<{
  id: string
  interactables?: Array<{ id: string; verb?: string; verbKey?: string }>
}>
const SRC = readFileSync(resolve(ROOT, 'src/i18n/Lang.ts'), 'utf8')

const dictBlock = (name: 'ZH' | 'EN'): string => {
  const start = SRC.indexOf(`const ${name}: Record<string, string> = {`)
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

const ROWS = REGIONS.flatMap((r) =>
  (r.interactables ?? []).filter((x) => x.verb !== undefined).map((x) => ({ region: r.id, ...x })),
)

describe('区域交互 verb 双语对账', () => {
  it('每一条 verb 行都登记 verbKey（EN 模式下不许退回中文提示）', () => {
    for (const row of ROWS) {
      expect(row.verbKey, `${row.region}/${row.id} 有 verb 但没 verbKey`).toBeTruthy()
      expect(row.verbKey!.startsWith('interact.'), `${row.verbKey} 命名不是 interact.*`).toBe(true)
    }
  })

  it('verbKey 双语齐全、非空；ZH 逐字等于原 verb', () => {
    for (const row of ROWS) {
      expect(ZH[row.verbKey!], `ZH 缺 ${row.verbKey}`).toBeTruthy()
      expect(EN[row.verbKey!], `EN 缺 ${row.verbKey}`).toBeTruthy()
      expect(ZH[row.verbKey!], `ZH 与 regions.json verb 不一致：${row.region}/${row.id}`).toBe(row.verb)
    }
  })

  it('EN 侧 verbKey 零 CJK', () => {
    for (const row of ROWS) {
      expect(EN[row.verbKey!], `EN 键 ${row.verbKey} 混入中文字形`).not.toMatch(/[一-鿿]/)
    }
  })
})
