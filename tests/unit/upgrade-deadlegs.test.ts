import { describe, expect, it } from 'vitest'
import { registerGameData } from '@/data'
import type { ItemData } from '@/data/schema'
import { Inventory, itemOf } from '@/rpg/Inventory'
import { upgradeStep, maxLevelOf, tryUpgrade, salvageValue } from '@/rpg/Upgrade'

/**
 * 批26：Upgrade.ts 的 4 条死分支 + L67 恒死（cov_b25 排行）。
 * 数据走 registerGameData() 的真表（progression.json / items.json），测试不复制数值。
 */

registerGameData()

/** 一个既无 gear 字段的 item（maxLevelOf 的 rarity 查找落空 / salvageValue 无 salvage 格） */
const bareItem = { id: 'it_none' } as unknown as ItemData

describe('Upgrade 死腿（批26）', () => {
  it('upgradeStep：表里没有 level+1 那一格 → null（?? null 右腿）', () => {
    // upgrade 表覆盖 1..10；99 已远超任何 cap ⇒ find 落空
    expect(upgradeStep(99), '超界等级没有下一格').toBeNull()
  })

  it('maxLevelOf：item 没有 gear 字段 → 稀有度查不到，封顶 0（?? 0 右腿）', () => {
    expect(maxLevelOf(bareItem), '无 gear 无稀有度 ⇒ 不能强化').toBe(0)
  })

  it('tryUpgrade：uid 不存在 → missing，且不碰库存（!gear 真腿）', () => {
    const inv = new Inventory(6)
    const r = tryUpgrade(inv, 'no-such-uid')
    expect(r.ok).toBe(false)
    expect(r.reason, '找不到装备件').toBe('missing')
  })

  it('salvageValue：item 没有 salvage 格 → 两项都是 0（!s 真腿）', () => {
    expect(salvageValue(bareItem, 3), '无 salvage 格 ⇒ 拆不出材料').toEqual({ dross: 0, timbite: 0 })
  })

  it('对照：maxLevelOf 正常腿（有 gear 有稀有度）不被本批改动碰坏', () => {
    expect(maxLevelOf(itemOf('ar_mutewrap_helm'))).toBe(3)
  })
})
