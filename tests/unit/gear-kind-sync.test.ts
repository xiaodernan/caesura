import { describe, it, expect } from 'vitest'
import { registerGameData, items } from '@/data'
import { isGear } from '@/rpg/Inventory'
import type { ItemData } from '@/data/schema'

registerGameData()

/**
 * `isGear` 的 kind 枚举必须与数据里「有 `gear` 字段」完全一致（`rpg/Inventory.ts`）。
 *
 * `isGear` 是 `Inventory.add` / `addGear` 的分岔口：认成装备 ⇒ 生成**实例**（每件独立 uid／
 * 等级／词缀），认不成 ⇒ 进**堆叠**。两侧都静默——一个带 gear 的新类别若忘了登记进
 * `isGear`，它会变成一堆可堆叠的"装备"，装备/建议/出售整条链全聋；反之一个丢了 gear 字段的
 * weapon 会被当成堆叠件，`addGear` 那一侧又开始抛。
 *
 * 这条不变式此前**零测试**：`rpg.test.ts` 没有一处引用 `isGear`，也没有对账 kind ↔ gear。
 * 用全表逐件对账（37 件）而不是抽样，两个方向的漂移都逃不掉。
 */
describe('isGear：kind 枚举 ↔ 数据 gear 字段 全表一致', () => {
  it('逐件对账：isGear(item) === (item.gear 存在)', () => {
    expect(items.length, 'items.json 不能是空表——空表会让这条判据恒真').toBeGreaterThan(0)
    for (const it of items as ItemData[]) {
      expect(isGear(it), `「${it.id}」（kind=${it.kind}）的 isGear 与 gear 字段不一致`).toBe(it.gear != null)
    }
  })

  it('装备类别集合恰为 {weapon, armor, seal}（从数据现推，不另抄名单）', () => {
    const gearKinds = new Set((items as ItemData[]).filter((it) => it.gear != null).map((it) => it.kind))
    expect([...gearKinds].sort()).toEqual(['armor', 'seal', 'weapon'])
  })

  it('非装备类别里没有任何一件带 gear 字段（堆叠侧干净）', () => {
    const stacky = (items as ItemData[]).filter((it) => it.gear == null)
    expect(stacky.length).toBeGreaterThan(0)
    for (const it of stacky) expect(isGear(it)).toBe(false)
  })

  it('既有认知抽查：一把武器是装备、一件素材不是', () => {
    const weapon = (items as ItemData[]).find((it) => it.kind === 'weapon')
    const material = (items as ItemData[]).find((it) => it.kind === 'material')
    expect(weapon, 'items.json 里应当有 weapon').toBeTruthy()
    expect(material, 'items.json 里应当有 material').toBeTruthy()
    expect(isGear(weapon!)).toBe(true)
    expect(isGear(material!)).toBe(false)
  })
})
