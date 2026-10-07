import { describe, expect, it } from 'vitest'
import { registerGameData, regions, weatherRows } from '@/data'

/**
 * `weatherPresets` 的**形状不变量**——今天（2026-10-07）把天气从 12 条 WARN 销到 4 条时逐区量过，
 * 但那些结论当时只写在 `KI-094` 的散文里。本守卫把它们钉住：
 *
 * 1. **第一格永远是基线 `clear`**（"驻留格"就是"还没有世界变化时这一区长什么样"）；
 * 2. **每一格都得是 `weather.json` 里真有的一档**（不许出现孤儿名——今天删未竟厅那一格时，
 *    `dissonant-storm` 一度成了没有任何区域指的孤儿行，门禁当场报 ERROR）；
 * 3. **没有重复格**（同一档连写两遍＝有一格是白占的）；
 * 4. **两格的区必须两格不同**（第一格 clear、第二格是"修钟后"）。
 *
 * ⚠️ 本守卫**不管**"第二格由谁拨"（那是天气 A 裁决的事，见 `art-direction §8.1.2`：
 * `regions.json` 加一格 `weatherSwitch`，等 `schema.ts`）；它只管**表本身的形状**。
 */
registerGameData()

const known = new Set(weatherRows.map((r) => String((r as { id?: unknown }).id ?? '')))

describe('weatherPresets 的形状不变量（§38 / KI-094）', () => {
  it('每一格都是 weather.json 里真有的档（没有孤儿名）', () => {
    for (const rg of regions) {
      for (const name of rg.weatherPresets ?? []) {
        expect(known.has(name), `${rg.id} 的「${name}」不在 weather.json 里`).toBe(true)
      }
    }
  })

  it('第一格永远是基线 clear —— "驻留格"就是"还没有世界变化时长什么样"', () => {
    for (const rg of regions) {
      const p = rg.weatherPresets ?? []
      if (p.length === 0) continue
      expect(p[0], `${rg.id} 的驻留格应当是 clear`).toBe('clear')
    }
  })

  it('没有重复格，且两格的区两格必须不同（重复＝有一格白占）', () => {
    for (const rg of regions) {
      const p = rg.weatherPresets ?? []
      expect(new Set(p).size, `${rg.id} 的 weatherPresets 有重复：${p.join('/')}`).toBe(p.length)
      if (p.length > 1) expect(p[1], `${rg.id} 的第二格不该等于驻留格`).not.toBe(p[0])
    }
  })
})
