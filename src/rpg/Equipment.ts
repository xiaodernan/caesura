import { registry } from '@/core/Registry'
import type { ItemData, ProgressionData, SlotKey } from '@/data/schema'
import type { GearInstance, Inventory } from './Inventory'
import { itemOf } from './Inventory'
import { armorDefMul, weaponDamageMul } from './Upgrade'

/**
 * 装备（progression.md §5.1）。槽位七格：武器 1 + 护甲 4 + 音徽 2。
 *
 * 这里只做「汇总」，不认识玩家：它把一身装备折算成一组乘数交给 Progression / 战斗管线。
 * 词缀的每一条都有**真实消费方**（见每条注释），没有消费方的词缀不写进数据表——
 * 一个没人读的 +5% 和没做没有区别，只是让面板看起来更满。
 */

export const SLOTS: SlotKey[] = ['weapon', 'helm', 'cuirass', 'gloves', 'greaves', 'sealA', 'sealB']

export interface EquipMods {
  /** Σ护甲 DEF（含强化与硬膜词缀）；不含腔体加成（那部分在 Progression.derive 里） */
  defense: number
  weight: number
  critRate: number
  /** 架势伤害乘数（共鸣） */
  poiseDmgMul: number
  staminaRegenMul: number
  /** 处决/背刺伤害乘数（泛音弦） */
  execMul: number
  /** 自身噪音乘数（静默：越小越安静）。深窖/万籁的正解装备靠它 */
  noiseMul: number
  /** 完美格挡窗 +帧（之延） */
  perfectBlockBonusTicks: number
  /** 轻击前摇 -帧（之切） */
  lightStartupTicks: number
  /** 对钟甲/钟壳目标的伤害加成（之鸣钟） */
  bellBonus: number
  /** 弹反成功额外过载（之休止） */
  restOverdrive: number
  /**
   * 幸运系数（§6.2「丰谐」，KI-030②）：掉落**高段权重**的加数（0.15 = +15%），
   * 由 `LootDirector` 读——它不是战斗乘数，所以不写进 `PlayerMods`，装备侧只负责把它算出来。
   */
  lootLuck: number
  /** 当前武器的强化倍率（引针枪/大剑同表） */
  weaponDamageMul: number
  /** 当前武器指向的 WeaponData id；无武器时 null */
  weaponId: string | null
}

export const EMPTY_MODS: EquipMods = {
  defense: 0, weight: 0, critRate: 0, poiseDmgMul: 0, staminaRegenMul: 0,
  execMul: 0, noiseMul: 0, perfectBlockBonusTicks: 0, lightStartupTicks: 0,
  bellBonus: 0, restOverdrive: 0, weaponDamageMul: 1, weaponId: null, lootLuck: 0
}

export class Equipment {
  /** 槽位 → 装备实例 uid */
  slots: Partial<Record<SlotKey, string>> = {}

  equipped(inv: Inventory, slot: SlotKey): GearInstance | null {
    const uid = this.slots[slot]
    if (!uid) return null
    return inv.gearByUid(uid) ?? null
  }

  /** 装上一件。同名件换装是允许的（那就是"换装备"），但槽位必须对得上。 */
  equip(inv: Inventory, uid: string): SlotKey | null {
    const gear = inv.gearByUid(uid)
    if (!gear) return null
    const item = itemOf(gear.itemId)
    const slot = targetSlot(item)
    if (!slot) return null
    this.slots[slot] = uid
    return slot
  }

  unequip(slot: SlotKey): void {
    delete this.slots[slot]
  }

  weightOf(inv: Inventory): number {
    let w = 0
    for (const slot of SLOTS) {
      const g = this.equipped(inv, slot)
      if (g) w += itemOf(g.itemId).gear?.weight ?? 0
    }
    return w
  }

  /** 负重超载（>100%）：翻滚禁用、疾跑禁用、体力回复 -40%（§5.1 的明确惩罚） */
  isOverloaded(inv: Inventory, loadMax: number): boolean {
    return this.weightOf(inv) > loadMax
  }

  /**
   * §44「Current vs New」里 **New** 那一栏：把这件装到它自己的槽位之后，整套乘数会变成什么。
   * 刻意走"换装载重算"而不是"把这件的属性加到当前上"：词缀、强化倍率、音徽 A/B、噪音那一条的
   * 「加总偏移」都在 `totalsFrom` 里，抄一份加法就会和真实装备之后的数字不一致（玩家会把它当 bug）。
   * 投影不碰真实槽位。
   */
  preview(inv: Inventory, uid: string): { slot: SlotKey; mods: EquipMods } | null {
    const gear = inv.gearByUid(uid)
    if (!gear) return null
    const own = itemOf(gear.itemId).gear?.slot
    if (!own) return null
    const slots = { ...this.slots }
    const slot: SlotKey = own === 'seal' ? sealSlotFor(slots) : own
    slots[slot] = uid
    return { slot, mods: this.totalsFrom(slots, inv) }
  }

  totals(inv: Inventory): EquipMods { return this.totalsFrom(this.slots, inv) }

  private totalsFrom(slots: Partial<Record<SlotKey, string>>, inv: Inventory): EquipMods {
    const out: EquipMods = { ...EMPTY_MODS }
    const prog = registry.get<ProgressionData>('progression')
    for (const slot of SLOTS) {
      const uid = slots[slot]
      const g = uid ? inv.gearByUid(uid) ?? null : null
      if (!g) continue
      const item = itemOf(g.itemId)
      const gear = item.gear
      if (!gear) continue
      out.weight += gear.weight
      if (gear.slot === 'weapon') {
        out.weaponId = gear.weaponId ?? null
        out.weaponDamageMul = weaponDamageMul(g.level)
      } else {
        out.defense += Math.round((gear.def ?? 0) * armorDefMul(g.level))
      }
      for (const a of g.affixes) {
        const def = [...prog.affixes.prefix, ...prog.affixes.suffix].find((x) => x.id === a.id)
        if (!def) continue
        if (def.stat) applyStat(out, def.stat, a.value)
        else if (def.behavior) applyBehavior(out, def.behavior, a.value)
      }
    }
    // 噪音乘数是「加总偏移」而不是连乘：三件静默不该把噪音乘成负数
    out.noiseMul = Math.max(0.1, 1 + out.noiseMul)
    out.poiseDmgMul = 1 + out.poiseDmgMul
    out.execMul = 1 + out.execMul
    out.staminaRegenMul = 1 + out.staminaRegenMul
    return out
  }

  snapshot(): Partial<Record<SlotKey, string>> { return { ...this.slots } }

  restore(s: Partial<Record<SlotKey, string>>): void { this.slots = { ...s } }
}

function targetSlot(item: ItemData): SlotKey | null {
  const slot = item.gear?.slot
  if (!slot) return null
  if (slot === 'seal') return null // 音徽由调用方指定 A/B，走 equipSeal
  return slot
}

/** 音徽落哪个槽：A 槽优先，A 满了才进 B（避免"装第二枚徽记把第一枚顶掉"这种静默替换） */
export function sealSlotFor(slots: Partial<Record<SlotKey, string>>): SlotKey {
  return slots.sealA ? 'sealB' : 'sealA'
}

/** 音徽单独入口 */
export function equipSeal(eq: Equipment, uid: string): SlotKey | null {
  const slot = sealSlotFor(eq.slots)
  eq.slots[slot] = uid
  return slot
}

function applyStat(out: EquipMods, stat: NonNullable<import('@/data/schema').AffixDef['stat']>, v: number): void {
  switch (stat) {
    case 'defense': out.defense += v; break
    case 'critRate': out.critRate += v; break
    case 'poiseDmg': out.poiseDmgMul += v; break
    case 'staminaRegen': out.staminaRegenMul += v; break
    case 'execDmg': out.execMul += v; break
    case 'noiseMul': out.noiseMul += v; break
    case 'lootLuck': out.lootLuck += v; break
  }
}

function applyBehavior(out: EquipMods, behavior: string, v: number): void {
  switch (behavior) {
    case 'perfectBlockWindow': out.perfectBlockBonusTicks += v; break
    case 'lightStartup': out.lightStartupTicks += v; break
    case 'bellBonus': out.bellBonus += v; break
    case 'restOverdrive': out.restOverdrive += v; break
  }
}
