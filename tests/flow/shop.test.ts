import { describe, expect, it } from 'vitest'
import { registerGameData } from '@/data'
import { registry } from '@/core/Registry'
import { itemOf } from '@/rpg/Inventory'
import { RpgRuntime } from '@/rpg/Runtime'
import { salvageValue, TIMBITE } from '@/rpg/Upgrade'
import { sellPrice, shopData, CURRENCY } from '@/rpg/Shop'
import type { ShopData } from '@/data/schema'

/**
 * KI-055①：营地交易（progression.md §6.2/§6.3）。
 *
 * 这一层的断言全部**从表里算**，不写第二个价格：卖价 = `items.value × shop.sell.mul`，
 * 买价 = `shop.stock[].price`。改表必须改读数，读数不改就是没在读表。
 *
 * 反套利那一条用"结构上不可能"来断言而不是用数字来赌：清单里的件都是 consumable，
 * 而 `sellPrice` 对非装备一律给 0 ⇒ 「买回来再卖」这一圈回收的是 0，与系数取值无关。
 */

registerGameData()

const shop = (): ShopData => shopData()
const price = (itemId: string): number => Math.round((itemOf(itemId).value ?? 0) * shop().sell.mul)

function rich(n = 5000): RpgRuntime {
  const rt = new RpgRuntime('origin_tuner', 4242)
  rt.inv.add(TIMBITE, n)
  return rt
}

describe('KI-055① 卖装（§6.3 档价×50%）', () => {
  it('每一件装备的卖价都等于「表里的底数 × 表里的系数」，逐件对账', () => {
    const mul = shop().sell.mul
    expect(mul, '红线本身：0<mul<1').toBeGreaterThan(0)
    expect(mul).toBeLessThan(1)
    const gears = registry.ids('it_').concat(registry.ids('wp_'), registry.ids('ar_'), registry.ids('seal_'))
      .map((id) => itemOf(id))
      .filter((it) => it.kind === 'weapon' || it.kind === 'armor' || it.kind === 'seal')
    expect(gears.length, '装备件不该为 0（否则这条断言是空的）').toBeGreaterThan(0)
    for (const it of gears) expect(sellPrice(it.id), `${it.id} 的卖价`).toBe(price(it.id))
  })

  it('卖价不看强化等级，分解看：§6.3「强化沉没不反还」的两种写法在这一条上分开', () => {
    const rt = rich()
    const a = rt.inv.addGear('ar_choir_hood', 0)
    const b = rt.inv.addGear('ar_choir_hood', 3)
    expect(sellPrice(a.itemId)).toBe(sellPrice(b.itemId))
    const s0 = salvageValue(itemOf(a.itemId), a.level)
    const s3 = salvageValue(itemOf(b.itemId), b.level)
    expect(s3.timbite, '分解才认等级（+10%/级）——所以卖不是强化投资的退路').toBeGreaterThan(s0.timbite)
  })

  it('卖掉身上那件：槽位先脱下，不会留下指向空气的 uid', () => {
    const rt = rich()
    const worn = rt.inv.gears.find((g) => rt.eq.slots.weapon === g.uid)!
    expect(worn.itemId, '出身装里要有武器').toBe('wp_tuning_sword_item')
    const before = rt.inv.count(TIMBITE)
    const r = rt.sell(worn.uid)
    expect(r.ok).toBe(true)
    expect(r.price).toBe(price(worn.itemId))
    expect(rt.eq.slots.weapon, '卖掉的正是身上那件 ⇒ 武器槽空了').toBeUndefined()
    expect(rt.mods().weaponId).toBeNull()
    expect(rt.inv.gearByUid(worn.uid)).toBeUndefined()
    expect(rt.inv.count(TIMBITE) - before).toBe(price(worn.itemId))
  })

  it('不存在的 uid 与不能卖的件：一分不扣、一件不少', () => {
    const rt = rich()
    const stone = rt.inv.count(TIMBITE)
    const gears = rt.inv.gears.length
    expect(rt.sell('g999999').ok).toBe(false)
    expect(rt.inv.count(TIMBITE)).toBe(stone)
    expect(rt.inv.gears.length).toBe(gears)
    // 素材/消耗品不是卖家：给它们开价就是第二条印钞机
    expect(sellPrice('it_dross')).toBe(0)
    expect(sellPrice('it_echo_salve')).toBe(0)
  })
})

describe('KI-055① 买消耗品（§6.2 高频小额）', () => {
  it('清单里每一项都真存在、都是消耗品、价格是正整数（§6.3 红线的读数侧）', () => {
    for (const e of shop().stock) {
      const it = itemOf(e.item)
      expect(it.kind, `${e.item} 必须是 consumable`).toBe('consumable')
      expect(Number.isInteger(e.price), `${e.id} 的价格`).toBe(true)
      expect(e.price).toBeGreaterThan(0)
    }
    expect(shop().stock.length).toBeGreaterThan(0)
  })

  it('钱不够 ⇒ 一分不扣、一件不加（先查后扣，不做「扣了再退」）', () => {
    const rt = new RpgRuntime('origin_tuner', 4242)
    rt.inv.remove(TIMBITE, rt.inv.count(TIMBITE))
    const e = shop().stock[0]
    const r = rt.buy(e.id)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('poor')
    expect(rt.inv.count(CURRENCY)).toBe(0)
    expect(rt.inv.count(e.item)).toBe(0)
  })

  it('买成功：扣的就是表里那个价，到的就是表里那件（一次一件）', () => {
    const rt = rich()
    const e = shop().stock[0]
    const before = rt.inv.count(CURRENCY)
    const r = rt.buy(e.id)
    expect(r.ok).toBe(true)
    expect(r.itemId).toBe(e.item)
    expect(before - rt.inv.count(CURRENCY)).toBe(e.price)
    expect(rt.inv.count(e.item)).toBe(1)
  })

  it('带满了 ⇒ 不成交也不扣钱：堆叠上限就是这条腿的节流阀', () => {
    const rt = rich()
    const e = shop().stock[0]
    const stack = itemOf(e.item).stack
    rt.inv.add(e.item, stack)
    const before = rt.inv.count(CURRENCY)
    const r = rt.buy(e.id)
    expect(r.ok, '一次都买不进').toBe(false)
    expect(r.reason).toBe('full')
    expect(rt.inv.count(e.item)).toBe(stack)
    expect(rt.inv.count(CURRENCY)).toBe(before)
  })

  it('清单上没有的 id：拒绝，而不是免费给东西', () => {
    const rt = rich()
    const before = rt.inv.count(CURRENCY)
    expect(rt.buy('no_such_entry').ok).toBe(false)
    expect(rt.inv.count(CURRENCY)).toBe(before)
  })

  it('§6.3 反套利（结构版）：买进来的东西卖不掉，且半价意味着买回再卖必亏', () => {
    const rt = rich(100000)
    for (const e of shop().stock) {
      expect(sellPrice(e.item), `${e.item} 不是装备 ⇒ 没有卖价`).toBe(0)
      // 就算哪天允许卖消耗品，价也必须是买价的严格小数：这条给的是"系数本身够用"的读数
      expect(Math.round(e.price * shop().sell.mul), `${e.id} 的买回再卖`).toBeLessThan(e.price)
      const before = rt.inv.count(CURRENCY)
      expect(rt.buy(e.id).ok).toBe(true)
      expect(rt.inv.count(CURRENCY), '买入只扣不赚').toBe(before - e.price)
    }
  })
})

describe('KI-055① 改表法：两个数都住在 shop.json，代码里没有第二份', () => {
  it('改 sell.mul ⇒ 卖价跟着改；改 stock.price ⇒ 扣款跟着改；还原后回到原读数', () => {
    const gears = ['wp_tuning_sword_item', 'ar_choir_hood', 'seal_firstbeat']
    const table = registry.get<ShopData>('shop')
    const entry = table.stock[0]
    const savedMul = table.sell.mul
    const savedPrice = entry.price
    const base = gears.map((id) => sellPrice(id))
    try {
      table.sell.mul = 0.25
      gears.forEach((id, i) => expect(sellPrice(id), `${id} 读到新系数`).toBe(Math.round((itemOf(id).value ?? 0) * 0.25)))
      entry.price = savedPrice + 77
      const rt = rich()
      const before = rt.inv.count(CURRENCY)
      expect(rt.buy(entry.id).ok).toBe(true)
      expect(before - rt.inv.count(CURRENCY), '买入扣的是表里此刻那个价').toBe(savedPrice + 77)
    } finally {
      table.sell.mul = savedMul
      entry.price = savedPrice
    }
    gears.forEach((id, i) => expect(sellPrice(id), `${id} 还原`).toBe(base[i]))
    const rt = rich()
    const before = rt.inv.count(CURRENCY)
    expect(rt.buy(entry.id).ok).toBe(true)
    expect(before - rt.inv.count(CURRENCY)).toBe(savedPrice)
  })
})
