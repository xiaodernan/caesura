import { registry } from '@/core/Registry'
import type { AttrKey, EnemyData, ItemData, SlotKey } from '@/data/schema'
import { Progression, originOf } from './Progression'
import { Inventory, itemOf } from './Inventory'
import { Equipment, equipSeal } from './Equipment'
import { LootDirector, allGearItems, type LootGrant } from './Loot'
import { MovementBook, type MovementSnapshot, type SkillAction } from './Movements'
import { tryUpgrade, salvage, type UpgradeResult } from './Upgrade'

/**
 * 成长系统的总装（Phase 5-B/5-C2）：Progression（音级/属性）× Inventory（背包）×
 * Equipment（装备）× Loot（掉落）× Movements（乐章战技谱册）。
 *
 * 它对外只吐两样东西：
 * 1. `mods()` —— 一组**扁平乘数**，由 main.ts 灌进 PlayerController 与战斗管线。
 * 2. `onEnemyKilled()` —— 一串「拿到了什么」，由调用方负责播报与存档。
 *
 * 刻意不认识 three，也不认识 PlayerController：这样它能在 headless 测试里整条跑通
 * （需求 §59 的自动化流程），而"玩家"只是它的一组消费者。
 */

export interface PlayerMods {
  /** 当前音级（HUD 显示用） */
  rank: number
  /** 软上限折算后的六音级属性（伤害标尺消费它，而不是面板值） */
  attrs: Record<AttrKey, number>
  hpMax: number
  staminaMax: number
  poiseMax: number
  defense: number
  loadMax: number
  /** §8.2 rank5 里程碑的落空硬直修正（ms，未达不发；见 Progression.DerivedStats.parryWhiffMs） */
  parryWhiffMs: number
  overdriveMax: number
  critRate: number
  critMul: number
  execMul: number
  /** 自身噪音乘数（静默词缀；万籁/深窖的正解靠它） */
  noiseMul: number
  /**
   * §2.1 失谐给「异常强度」的乘数：震裂每层承伤、碎裂真伤、回响重演伤共用它。
   * 它是**玩家出手侧**的乘数（我施加的异常更疼），不是我自己挨异常的倍率。
   */
  statusPowerMul: number
  /** 环境失谐（Corruption）累积乘数，<1 = 褪色更慢；地板由 progression.json 的 toleranceFloor 兜住 */
  corruptionResistMul: number
  poiseDmgMul: number
  staminaRegenMul: number
  perfectBlockBonusTicks: number
  lightStartupTicks: number
  bellBonus: number
  restOverdrive: number
  weaponDamageMul: number
  weaponId: string | null
  weight: number
  overloaded: boolean
}

export function defaultMods(): PlayerMods {
  return {
    rank: 1,
    attrs: { str: 0, dex: 0, ton: 0, vig: 0, ovr: 0, fis: 0 },
    hpMax: 1, staminaMax: 1, poiseMax: 1, defense: 0, loadMax: 999, parryWhiffMs: 0, overdriveMax: 10,
    critRate: 0, critMul: 1.35, execMul: 1, noiseMul: 1, poiseDmgMul: 1, staminaRegenMul: 1,
    statusPowerMul: 1, corruptionResistMul: 1,
    perfectBlockBonusTicks: 0, lightStartupTicks: 0, bellBonus: 0, restOverdrive: 0,
    weaponDamageMul: 1, weaponId: null, weight: 0, overloaded: false
  }
}

export interface RpgSnapshot {
  progression: ReturnType<Progression['snapshot']>
  inventory: ReturnType<Inventory['snapshot']>
  equipment: ReturnType<Equipment['snapshot']>
  loot: ReturnType<LootDirector['snapshot']>
  /** Phase 5-C2：乐章战技谱册（v4 起）。v3 老档没有这一格 ⇒ restore 走空状态 */
  movements?: MovementSnapshot
}

export class RpgRuntime {
  readonly prog: Progression
  readonly inv: Inventory
  readonly eq = new Equipment()
  readonly loot: LootDirector
  /** §7 谱册：点亮了哪几页、哪一式练到几级、两个主动槽里装着什么 */
  readonly moves = new MovementBook()

  constructor(originId = 'origin_tuner', seed: number | string = 0x51f3a2) {
    this.prog = new Progression(originId)
    this.inv = new Inventory(seed)
    this.loot = new LootDirector(this.inv, this.prog)
    // 出身自带装备：定弦决定的不只是数值分布，还有你手里握着什么（§2.2）
    const origin = originOf(originId)
    const weaponItem = allGearItems().find((it) => it.gear?.weaponId === origin.weaponId)
    if (!weaponItem) throw new Error(`RpgRuntime: 出身 ${originId} 的武器 ${origin.weaponId} 没有对应的装备件`)
    for (const g of [...(origin.gearIds ?? []), weaponItem.id]) {
      const gear = this.inv.addGear(g)
      const item = itemOf(g)
      if (item.gear?.slot === 'seal') equipSeal(this.eq, gear.uid)
      else this.eq.equip(this.inv, gear.uid)
    }
  }

  /** 战斗/面板要的全部乘数，一次算完（每次装备/升级后由 main.ts 重新拉一次） */
  mods(): PlayerMods {
    const eq = this.eq.totals(this.inv)
    const d = this.prog.derive(eq.defense)
    const weight = eq.weight
    return {
      rank: this.prog.rank,
      attrs: this.prog.effectiveAttrs(),
      hpMax: d.hpMax,
      staminaMax: d.staminaMax,
      poiseMax: d.poiseMax,
      defense: d.defense,
      loadMax: d.loadMax,
      parryWhiffMs: d.parryWhiffMs,
      overdriveMax: d.overdriveMax,
      critRate: d.critRate + eq.critRate,
      critMul: d.critMul,
      execMul: d.execMul * eq.execMul,
      statusPowerMul: d.statusPowerMul,
      corruptionResistMul: d.corruptionResistMul,
      noiseMul: eq.noiseMul,
      poiseDmgMul: eq.poiseDmgMul,
      staminaRegenMul: eq.staminaRegenMul,
      perfectBlockBonusTicks: eq.perfectBlockBonusTicks,
      lightStartupTicks: eq.lightStartupTicks,
      bellBonus: eq.bellBonus,
      restOverdrive: eq.restOverdrive,
      weaponDamageMul: eq.weaponDamageMul,
      weaponId: eq.weaponId,
      weight,
      overloaded: weight > d.loadMax
    }
  }

  equip(uid: string): { ok: boolean; slot?: SlotKey; weaponId?: string | null } {
    const gear = this.inv.gearByUid(uid)
    if (!gear) return { ok: false }
    const item = itemOf(gear.itemId)
    const slot = item.gear?.slot === 'seal' ? equipSeal(this.eq, uid) : this.eq.equip(this.inv, uid)
    if (!slot) return { ok: false }
    return { ok: true, slot, weaponId: item.gear?.weaponId ?? null }
  }

  unequip(slot: SlotKey): void { this.eq.unequip(slot) }

  upgrade(uid: string): UpgradeResult { return tryUpgrade(this.inv, uid) }

  salvage(uid: string): { dross: number; timbite: number } | null {
    // 拆掉身上那件之前先脱下来：否则槽位会指向一个已经不存在的 uid
    for (const slot of Object.keys(this.eq.slots) as SlotKey[]) {
      if (this.eq.slots[slot] === uid) this.eq.unequip(slot)
    }
    return salvage(this.inv, uid)
  }

  /**
   * 使用消耗品（回响膏=回血；音色晶=刮失谐）。返回实际生效量，由 main.ts 落到玩家身上——
   * 这一层不认识 PlayerController，所以"回血/清值"只能作为数字交回去，不能自己改人。
   */
  useItem(itemId: string): { ok: boolean; heal: number; corruption: number } {
    const item: ItemData = itemOf(itemId)
    if (item.kind !== 'consumable' || !item.use) return { ok: false, heal: 0, corruption: 0 }
    if (this.inv.count(itemId) <= 0) return { ok: false, heal: 0, corruption: 0 }
    this.inv.remove(itemId, 1)
    return { ok: true, heal: item.use.heal ?? 0, corruption: item.use.corruption ?? 0 }
  }

  onEnemyKilled(enemy: EnemyData): LootGrant[] {
    return this.loot.onEnemyKilled(enemy)
  }

  /** 洗点（§8.3）：先扣音色石，扣得动才退点——顺序反了就会「洗完了没钱付」 */
  respec(): { ok: boolean; refunded: number; cost: number; reason?: 'poor' | 'nothing' } {
    const cost = this.prog.respecCost()
    if (this.inv.count('it_timbite') < cost) return { ok: false, refunded: 0, cost, reason: 'poor' }
    const before = this.prog.unspent
    const refunded = this.prog.respec()
    if (refunded <= 0) {
      this.prog.unspent = before
      return { ok: false, refunded: 0, cost, reason: 'nothing' }
    }
    this.inv.remove('it_timbite', cost)
    return { ok: true, refunded, cost }
  }

  snapshot(): RpgSnapshot {
    return {
      progression: this.prog.snapshot(),
      inventory: this.inv.snapshot(),
      equipment: this.eq.snapshot(),
      loot: this.loot.snapshot(),
      movements: this.moves.snapshot()
    }
  }

  restore(s: Partial<RpgSnapshot>): void {
    if (s.progression) this.prog.restore(s.progression)
    if (s.inventory) this.inv.restore(s.inventory)
    if (s.equipment) this.eq.restore(s.equipment)
    if (s.loot) this.loot.restore(s.loot)
    // v3 及更早的档没有这一格：不传 = 谱册空白（§78 如实），而不是替老档编一套已学会的战技。
    // rank 先恢复再传进去：槽位是音级开的，判序反了就会让存档里伪造的槽位生效。
    this.moves.restore(s.movements ?? null, this.prog.rank)
  }

  /** 两个主动槽此刻能打出去的招式（键＝输入动作名）；main.ts 把它灌给 PlayerController */
  skillLoadout(): Record<string, SkillAction> { return this.moves.loadout() }
}

/** 装备件的中文名（面板/播报用；数据里 displayName 已是中文，nameKey 留给未来本地化） */
export function gearName(itemId: string): string {
  return registry.maybeGet<ItemData>(itemId)?.displayName ?? itemId
}
