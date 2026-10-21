import { describe, it, expect } from 'vitest'
import { registerGameData } from '@/data'
import { saleUnit, stackSellKinds, stackSellable, shopData } from '@/rpg/Shop'
import type { ItemData, ItemKind } from '@/data/schema'

registerGameData()

const mul = shopData().sell.mul

/** 只用到 kind/value 的假物品，避免为测试造整套 ItemData */
const fake = (kind: ItemKind, value: number): ItemData => ({ kind, value } as unknown as ItemData)

/**
 * 营地交易的两道闸门（KI-055 / KI-059），都是唯一主人、零直接读者。
 *
 * saleUnit —— 卖价的唯一式子（档价 × sell.mul，round，底线 0）。装备腿与堆叠件腿共用，
 * 谁想在一条腿上另写一遍 Math.round，就会出现「装备半价、素材七折」这种没人批准的漂移。
 * 这里只锁式子本身（round + 0 底线），不锁数据常数 mul。
 *
 * stackSellable —— 能按数量卖的类别闸门：类别在 shop.sell.stackKinds 名单里、且档价>0
 * （value===0 的是任务信物不是商品）。名单走数据，validator 才能对账「能买的类别绝不能同时能卖」。
 * 四个象限（在名单+有价 / 在名单+无价 / 不在名单 / undefined）钉死。
 */
describe('saleUnit：卖价唯一式子（KI-055，两腿共用）', () => {
  it('档价 × mul 后 round，与读数层口径逐值一致', () => {
    for (const v of [0, 1, 3, 10, 100, 333]) {
      expect(saleUnit(v)).toBe(Math.max(0, Math.round(v * mul)))
    }
  })

  it('负数/零档价被 Math.max 压到 0（绝不出现负卖价）', () => {
    expect(saleUnit(0)).toBe(0)
    expect(saleUnit(-5)).toBe(0)
  })

  it('取整方向 = round 而非 floor：0.5 向上偏袒（mul=0.5 时档价 1 不会掉到 0）', () => {
    // 若有人把 round 改成 floor，saleUnit(1) 会掉到 0，这一条红
    expect(saleUnit(1)).toBe(Math.round(1 * mul))
    expect(saleUnit(1)).toBeGreaterThan(0)
  })
})

describe('stackSellable：堆叠件出售闸门（KI-059）', () => {
  it('名单里的类别 + 档价>0 → 可卖', () => {
    const kind = stackSellKinds()[0]
    expect(stackSellable(fake(kind, 10))).toBe(true)
  })

  it('名单里的类别但档价=0（任务信物）→ 不可卖', () => {
    const kind = stackSellKinds()[0]
    expect(stackSellable(fake(kind, 0))).toBe(false)
  })

  it('不在名单里的类别（如 weapon）→ 不可卖', () => {
    expect(stackSellable(fake('weapon', 10))).toBe(false)
  })

  it('undefined → 不可卖', () => {
    expect(stackSellable(undefined)).toBe(false)
  })
})
