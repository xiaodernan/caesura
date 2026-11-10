import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  VFX_PALETTE,
  createRingMaterial,
  createSparkMaterial,
  createShardMaterial,
  makeRingGeometry,
} from '../../src/vfx/materials'

/**
 * KI-429/F4｜凝固声波目录门：`art-direction.md` §1.4 名册与 `src/vfx/materials.ts`
 * 单一主人表必须逐字对账。五色 hex 与四个工厂函数名，缺一不可——
 * 与 `tests/unit/vfx-materials.test.ts`（17 条，钉材质自身形状）同源，此处只管「名册里有没有、名字对不对」。
 *
 * headless 可证：只读 markdown 文本与 TS 模块导出，不触 WebGL。
 */
const AD_PATH = 'docs/art-direction.md'

function section14(text: string): string {
  const start = text.indexOf('### 1.4 目录与名册')
  if (start < 0) return ''
  const end = text.indexOf('\n---\n', start)
  return end < 0 ? text.slice(start) : text.slice(start, end)
}

function hexCells(s14: string): string[] {
  const out: string[] = []
  const re = /`0x[0-9a-fA-F]{6}`/g
  let m
  while ((m = re.exec(s14))) out.push(m[0])
  return out
}

function fnCells(s14: string): string[] {
  const out: string[] = []
  const re = /`(makeRingGeometry|createRingMaterial|createSparkMaterial|createShardMaterial)\(\)`/g
  let m
  while ((m = re.exec(s14))) out.push(m[1])
  return out
}

describe('KI-429/F4｜vfx-soundwave-catalog：art-direction §1.4 名册与 materials.ts 单一主人表对账', () => {
  const s14 = section14(readFileSync(AD_PATH, 'utf8'))

  it('§1.4 名册存在且非空（未写目录 = 这条门还没立）', () => {
    expect(s14.length, 'docs/art-direction.md §1.4 目录与名册缺失').toBeGreaterThan(0)
  })

  it('四个材质工厂函数从 materials.ts 导出（名册不许写空头衔）', () => {
    expect(typeof createRingMaterial).toBe('function')
    expect(typeof createSparkMaterial).toBe('function')
    expect(typeof createShardMaterial).toBe('function')
    expect(typeof makeRingGeometry).toBe('function')
  })

  it('五色 hex 全在 §1.4 名册里（与 VFX_PALETTE 逐一对位）', () => {
    const cells = hexCells(s14)
    expect(Object.keys(VFX_PALETTE)).toHaveLength(5)
    for (const [name, hex] of Object.entries(VFX_PALETTE)) {
      const cell = `\`0x${hex.toString(16).padStart(6, '0')}\``
      expect(cells, `§1.4 名册缺 VFX_PALETTE.${name} = ${cell}`).toContain(cell)
    }
  })

  it('四个材质工厂函数全在 §1.4 名册里', () => {
    const cells = fnCells(s14)
    expect(cells).toContain('makeRingGeometry')
    expect(cells).toContain('createRingMaterial')
    expect(cells).toContain('createSparkMaterial')
    expect(cells).toContain('createShardMaterial')
  })

  it('§1.4 名册不多也不少：五色 + 四工厂 = 九条，不多数不许少写', () => {
    const cells = hexCells(s14)
    const fns = fnCells(s14)
    expect(cells.length, '§1.4 hex 单元格数应为 5（与 VFX_PALETTE 五色一一对应）').toBe(5)
    expect(fns.length, '§1.4 工厂函数单元格数应为 4（与 materials.ts 四导出一一对应）').toBe(4)
  })
})
