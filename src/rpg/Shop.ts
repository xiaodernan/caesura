import { registry } from '@/core/Registry'
import type { ItemData, ShopData } from '@/data/schema'
import type { Inventory } from './Inventory'
import { itemOf, isGear } from './Inventory'
import { TIMBITE } from './Upgrade'

/**
 * 营地交易（progression.md §6.2/§6.3，KI-055）：音色石经济唯一的**出口**。
 *
 * 在此之前，石只进不出——击杀掉石、分解回石、洗点花石，但没有任何地方能把囤积的东西换成石。
 * 这一层补的就是那半个环，而它刻意做成两条**不对称**的腿：
 * - 卖：两条腿。**装备**只认实例（`uid` 才是卖家），价 = 件底数 × `sell.mul`，**不看强化等级**。
 *   §6.3 明写「强化沉没不反还」：如果 +5 的件卖得更贵，强化就变成了可回收投资，
 *   而回收率一旦高于成本，刷强化再卖就是官方允许的印钞机。
 *   **堆叠件**（残骸/素材/乐谱，KI-059）按数量卖，同一个单价式子——需求 §6 收入表那行
 *   「出售战利品（残骸→石）」到这一天才有实现；在此之前 7 件 material 里 6 件没有任何消费者。
 * - 买：清单（`stock`）只有 consumable，而且**不限购**——于是没有库存字段、没有补货计时器、
 *   也就没有第三份要入档的账。反通胀靠的是价差不靠配额：买来的消耗品根本卖不掉（不是装备），
 *   卖装备拿到的又只有底数的半价，所以「买→卖」这一圈的期望值恒为负，红线由 validator 钉住（§55）。
 *
 * 与 `Upgrade.ts` 同一条失信防线：**先查后扣**（钱够不够、堆叠装不装得下），查过才动账，
 * 不做「扣了再退」——退回来的那一笔在 UI 上就是一次闪，玩家不该看见自己的钱死而复生。
 */

/** 唯一的通货：息声领只认音色石（items.json 里 kind==='currency' 的那一件） */
export const CURRENCY = TIMBITE

export function shopData(): ShopData {
  return registry.get<ShopData>('shop')
}

/**
 * 卖价的**唯一**式子：档价 × `shop.sell.mul`。装备腿与堆叠件腿（KI-059）都走这里——
 * 两条腿各写一遍 `Math.round(v * mul)` 的话，改系数就会出现"装备半价、素材七折"这种没人批准过的漂移。
 * 取整方向如实记下：`round` 对**奇数档价是向上**（残晶 3 → 2，回收率 66%），
 * 这正是要把「分解→卖残晶」留一条活路的那一点偏袒，而不是舍入错误。
 */
export function saleUnit(value: number): number {
  return Math.max(0, Math.round(value * shopData().sell.mul))
}

/** 卖：只有装备实例能按件卖（`uid` 才是卖家），价只看件底数 */
export function sellPrice(itemId: string): number {
  const item = registry.maybeGet<ItemData>(itemId)
  if (!item || !isGear(item)) return 0
  return saleUnit(item.value ?? 0)
}

/**
 * 可以**按数量**卖的堆叠件类别（需求 §6 收入表那行「出售战利品（残骸→石）5-40」）。名单是数据
 * （`shop.json > sell.stackKinds`）而不是 TS 常量，理由只有一个：validator 要拿它和 `stock` 的
 * kind 对账——**能买的类别绝不能同时能卖**（`consumable` 不在名单里，所以"买→卖"那一圈必定亏）。
 * 白名单藏在代码里，那条红线就摸不到了。
 */
export function stackSellKinds(): readonly ItemData['kind'][] {
  return shopData().sell.stackKinds
}

/** 类别在名单里、而且真的写了档价（`value===0` 的那几件是任务信物，不是商品） */
export function stackSellable(item: ItemData | undefined): boolean {
  return !!item && stackSellKinds().includes(item.kind) && (item.value ?? 0) > 0
}

/** 单件堆叠件的卖价；不可卖一律 0（和装备腿同一个口径：0 就是"这不收"） */
export function stackSellPrice(itemId: string): number {
  const item = registry.maybeGet<ItemData>(itemId)
  return stackSellable(item) ? saleUnit(item!.value ?? 0) : 0
}

export interface SellResult {
  ok: boolean
  price?: number
  itemId?: string
  reason?: 'missing' | 'not-gear'
}

export interface StackSellResult {
  ok: boolean
  price?: number
  itemId?: string
  count?: number
  /** `missing` 表里没这件 · `not-stack` 收的不是这类货 · `empty` 数量不合法或手里没这么多 */
  reason?: 'missing' | 'not-stack' | 'empty'
}

/** 卖掉背包里的那一件实例。调用方（RpgRuntime）负责先脱下身上那件。 */
export function sellGear(inv: Inventory, uid: string): SellResult {
  const gear = inv.gearByUid(uid)
  if (!gear) return { ok: false, reason: 'missing' }
  if (!isGear(itemOf(gear.itemId))) return { ok: false, reason: 'not-gear' }
  const price = sellPrice(gear.itemId)
  inv.removeGear(uid)
  inv.add(CURRENCY, price)
  return { ok: true, price, itemId: gear.itemId }
}

/**
 * 卖掉堆叠件（残骸/素材/乐谱）。**先查后扣**与装备腿同一条防线：数量不合法或手里没那么多，
 * 就一个子都不动——不做"扣了再退"，退回来的那一笔在面板上是一次钱死而复生的闪。
 * 一次卖 n 件 = n × 单价，**不再乘第二次系数也不做整堆舍入**：整堆 `round(总数×档价×mul)` 会让
 * "卖一件"与"卖九件"落在两个不同的舍入世界里，反套利对账就没法写成一条能读的式子。
 */
export function sellStack(inv: Inventory, itemId: string, n = 1): StackSellResult {
  const item = registry.maybeGet<ItemData>(itemId)
  if (!item) return { ok: false, reason: 'missing' }
  if (!stackSellable(item)) return { ok: false, reason: 'not-stack' }
  const have = inv.count(itemId)
  if (!Number.isInteger(n) || n <= 0 || have < n) return { ok: false, reason: 'empty' }
  const price = saleUnit(item.value ?? 0) * n
  inv.remove(itemId, n)
  inv.add(CURRENCY, price)
  return { ok: true, price, itemId, count: n }
}

export interface BuyResult {
  ok: boolean
  price?: number
  itemId?: string
  reason?: 'unknown' | 'poor' | 'full'
}

/** 按清单条目 id 买一件（限购数量恒为 1：批量买只是把同一个失败判据重复跑几遍） */
export function buy(inv: Inventory, entryId: string): BuyResult {
  const entry = shopData().stock.find((s) => s.id === entryId)
  if (!entry) return { ok: false, reason: 'unknown' }
  const item = itemOf(entry.item)
  if (inv.count(CURRENCY) < entry.price) return { ok: false, reason: 'poor' }
  if (inv.count(item.id) >= item.stack) return { ok: false, reason: 'full' }
  inv.remove(CURRENCY, entry.price)
  inv.add(item.id, 1)
  return { ok: true, price: entry.price, itemId: item.id }
}
