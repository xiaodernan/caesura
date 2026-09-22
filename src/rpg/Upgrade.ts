import { registry } from '@/core/Registry'
import type { ItemData, ProgressionData, UpgradeStep } from '@/data/schema'
import type { GearInstance, Inventory } from './Inventory'
import { itemOf } from './Inventory'

/**
 * 强化（progression.md §5.4）：音色石 + 残晶，**无失败、无销毁**。
 * 惩罚不做赌博——玩家把资源投进来就该拿到确定的回报，不确定性留给战斗本身。
 * 上限由稀有度封顶（素声 +3 / 鸣声 +5 / 金属声 +7 / 晶声 +8 / 史诗与师传 +10）。
 */

export const TIMBITE = 'it_timbite'
export const DROSS = 'it_dross'

function table(): ProgressionData {
  return registry.get<ProgressionData>('progression')
}

/** 从 `level` 升到 `level+1` 的那一格；已到顶返回 null */
export function upgradeStep(level: number): UpgradeStep | null {
  return table().upgrade.find((s) => s.level === level + 1) ?? null
}

/** 武器基础伤害乘数：+1 是 +6%，+10 累计约 +79%（§5.4 合计栏） */
export function weaponDamageMul(level: number): number {
  let mul = 1
  for (const s of table().upgrade) {
    if (s.level > level) break
    mul += s.weaponMul
  }
  return mul
}

/** 护甲 DEF 乘数：满强化约 +106% */
export function armorDefMul(level: number): number {
  let mul = 1
  for (const s of table().upgrade) {
    if (s.level > level) break
    mul += s.armorMul
  }
  return mul
}

export function maxLevelOf(item: ItemData): number {
  const rarity = table().rarity.find((r) => r.id === item.gear?.rarity)
  return rarity?.maxLevel ?? 0
}

export interface UpgradeResult {
  ok: boolean
  reason?: 'maxed' | 'poor' | 'missing'
  level?: number
  spent?: { timbite: number; dross: number }
}

/**
 * 尝试强化一件装备。先查上限，再查材料，**最后才扣**——
 * 「材料够但强化失败还扣了钱」是这类系统最常见的失信点。
 */
export function tryUpgrade(inv: Inventory, uid: string): UpgradeResult {
  const gear = inv.gearByUid(uid)
  if (!gear) return { ok: false, reason: 'missing' }
  const item = itemOf(gear.itemId)
  const cap = maxLevelOf(item)
  if (gear.level >= cap) return { ok: false, reason: 'maxed' }
  const step = upgradeStep(gear.level)
  if (!step) return { ok: false, reason: 'maxed' }
  if (inv.count(TIMBITE) < step.timbite || inv.count(DROSS) < step.dross) return { ok: false, reason: 'poor' }
  inv.remove(TIMBITE, step.timbite)
  inv.remove(DROSS, step.dross)
  gear.level++
  return { ok: true, level: gear.level, spent: { timbite: step.timbite, dross: step.dross } }
}

/** 分解重复件（§6.3：残晶 30% + 音色石 20%）。装备件没有堆叠，所以「重复」= 你不想用的那件。 */
export function salvageValue(item: ItemData, level: number): { dross: number; timbite: number } {
  const s = item.gear?.salvage
  if (!s) return { dross: 0, timbite: 0 }
  const gain = 1 + level * 0.1
  return { dross: Math.max(0, Math.round(s.dross * gain)), timbite: Math.max(0, Math.round(s.timbite * gain)) }
}

export function salvage(inv: Inventory, uid: string): { dross: number; timbite: number } | null {
  const g: GearInstance | undefined = inv.gearByUid(uid)
  if (!g) return null
  const v = salvageValue(itemOf(g.itemId), g.level)
  inv.removeGear(uid)
  inv.add(DROSS, v.dross)
  inv.add(TIMBITE, v.timbite)
  return v
}
