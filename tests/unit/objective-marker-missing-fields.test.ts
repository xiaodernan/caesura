/**
 * resolveMarker / unresolvedMarkers 缺口守卫（src/quest/Objectives.ts）。
 *
 * objective-marker.test.ts 已覆盖 pos/npc/region/interact 的 happy path、npc·pos 缺格 ⇒ null、
 * 未知 kind ⇒ null、以及 not-found ⇒ null。但覆盖实测（v8 text reporter）报 Objectives.ts
 * 仍有**未取分支**——正好是这条纪律没被对称锁住的地方：
 *
 *   · 「缺该有的那一格就当认不出 ⇒ null」只对 `npc`(68) 与 `pos`(67) 断言过，
 *     **`interact` 与 `region` 缺 id 的两条分支从没被机器验过**（源码 56 / 65）；
 *   · `rg.interactables ?? []` 的**兜底右腿**没被测过（真区都带 interactables，源码 49 / 58）；
 *   · `unresolvedMarkers` 对 undefined 跳过、对解析不出者收进来、对解析得出者排除——
 *     这三种分流只在"表里全解析得出"的用例里出现过，undefined/解析不出两条腿未单独验（源码 94-95）。
 *
 * 契约原文：**认不出就返回 null，不猜、不静默落到 (0,0,0)**——后者会让箭头指向世界原点，比不画更坏。
 */
import { describe, expect, it } from 'vitest'
import { resolveMarker, unresolvedMarkers } from '@/quest/Objectives'
import { regions } from '@/data'
import type { RegionData } from '@/data/schema'

const regs = regions as unknown as RegionData[]
/** 一个**没有 interactables 格**的合成区——专为打 `rg.interactables ?? []` 的兜底右腿 */
const bareRegion = { id: 'rg_synthetic_bare' } as unknown as RegionData

describe('resolveMarker：缺该有的那一格就当认不出 ⇒ null（四种 kind 对称锁）', () => {
  it('interact 缺 id ⇒ null（源码 56，此前未验）', () => {
    expect(resolveMarker({ kind: 'interact' }, regs)).toBeNull()
  })

  it('region 缺 id ⇒ null（源码 65，此前未验）', () => {
    expect(resolveMarker({ kind: 'region' }, regs)).toBeNull()
  })

  it('区没有 interactables 格时 ?? [] 兜底：npc / interact 都判"认不出"（源码 49 / 58）', () => {
    expect(resolveMarker({ kind: 'npc', id: 'npc_anyone' }, [bareRegion])).toBeNull()
    expect(resolveMarker({ kind: 'interact', id: 'it_anything' }, [bareRegion])).toBeNull()
  })
})

describe('unresolvedMarkers：三条分流各自说实话', () => {
  it('undefined 跳过、解析得出者排除、解析不出者收进来', () => {
    const out = unresolvedMarkers(
      [
        undefined,                                                  // 94：跳过，不进结果
        { kind: 'pos', pos: { x: 1, y: 2, z: 3 } },                  // 解析得出 ⇒ 排除
        { kind: 'npc', id: 'npc_does_not_exist' },                   // 95：解析不出 ⇒ 收进来
      ],
      regs,
    )
    expect(out).toEqual([{ kind: 'npc', id: 'npc_does_not_exist' }])
  })

  it('全解析得出 ⇒ 空表；不把好指示误报成坏指示', () => {
    const out = unresolvedMarkers(
      [
        { kind: 'pos', pos: { x: 0, y: 0, z: 0 } },
        { kind: 'npc', id: 'npc_belltongue' },
      ],
      regs,
    )
    expect(out).toEqual([])
  })
})
