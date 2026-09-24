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
 * - 卖：只有装备实例能卖（`uid` 才是卖家），价 = 件底数 × `sell.mul`，**不看强化等级**。
 *   §6.3 明写「强化沉没不反还」：如果 +5 的件卖得更贵，强化就变成了可回收投资，
 *   而回收率一旦高于成本，刷强化再卖就是官方允许的印钞机。
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

/** 卖价：装备件底数 × 系数；非装备一律 0（"素材也能卖"是通胀的后门，不是遗漏） */
export function sellPrice(itemId: string): number {
  const item = registry.maybeGet<ItemData>(itemId)
  if (!item || !isGear(item)) return 0
  return Math.max(0, Math.round((item.value ?? 0) * shopData().sell.mul))
}

export interface SellResult {
  ok: boolean
  price?: number
  itemId?: string
  reason?: 'missing' | 'not-gear'
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
