import { registry } from '@/core/Registry'
import type { AttrKey, EnemyData, ItemData, SlotKey } from '@/data/schema'
import { Progression, originOf } from './Progression'
import { Inventory, itemOf } from './Inventory'
import { Equipment, equipSeal } from './Equipment'
import { LootDirector, allGearItems, type LootGrant } from './Loot'
import { MovementBook, type MovementSnapshot, type SkillAction } from './Movements'
import { tryUpgrade, salvage, type UpgradeResult } from './Upgrade'
import { buy, sellGear, sellStack, type BuyResult, type SellResult, type StackSellResult } from './Shop'

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
  /** §4.4 泛音弓满弓分叉的额外枝数（rank12 里程碑；0 = 底数 2 枝） */
  bowForkBranches: number
  /** 战技伤害加成（律色，KI-029）：加数（0.07 = +7%），消费方 activeHitbox 的技能那一支 */
  skillDmg: number
  /** 之连（KI-029）：连段递变加成，消费方 activeHitbox 的近战连段 */
  comboScaling: number
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
    statusPowerMul: 1, corruptionResistMul: 1, skillDmg: 0, comboScaling: 0, bowForkBranches: 0,
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
  /** 出身造装写进背包的那批实例 uid——restring 只摘这一批，别的件（掉落/购买）不在其列 */
  private originGearUids: string[] = []

  constructor(originId = 'origin_tuner', seed: number | string = 0x51f3a2) {
    this.prog = new Progression(originId)
    this.inv = new Inventory(seed)
    this.loot = new LootDirector(this.inv, this.prog, this.inv.rng, () => this.eq.totals(this.inv).lootLuck)
    this.grantOriginGear(originId)
  }

  /** 出身自带装备：定弦决定的不只是数值分布，还有你手里握着什么（§2.2） */
  private grantOriginGear(originId: string): void {
    const origin = originOf(originId)
    const weaponItem = allGearItems().find((it) => it.gear?.weaponId === origin.weaponId)
    if (!weaponItem) throw new Error(`RpgRuntime: 出身 ${originId} 的武器 ${origin.weaponId} 没有对应的装备件`)
    this.originGearUids = []
    for (const g of [...(origin.gearIds ?? []), weaponItem.id]) {
      const gear = this.inv.addGear(g)
      this.originGearUids.push(gear.uid)
      const item = itemOf(g)
      if (item.gear?.slot === 'seal') equipSeal(this.eq, gear.uid)
      else this.eq.equip(this.inv, gear.uid)
    }
  }

  /**
   * 「定弦」（KI-031② / §2.2）：开演之前换一根弦。六维回到新出身的底、出身装整批换掉、
   * 装备槽清空后重挂。守卫只有一条，但它是设计承诺本身：**定弦是开场那一屏的动作**，
   * 攒了任何进度（升级/遗响）之后就不存在"重选出身"——那叫洗点，玩法与代价都另有主人（§8.3）。
   */
  restring(originId: string): void {
    if (this.prog.rank > 1 || this.prog.xp > 0) {
      throw new Error(`RpgRuntime.restring: 音级 ${this.prog.rank}·遗响 ${this.prog.xp}——进度已经属于那根弦，定弦只发生在开演之前`)
    }
    this.prog.restore(new Progression(originId).snapshot()) // 未知出身在 originOf 处按既有措辞炸掉
    for (const uid of this.originGearUids) this.inv.removeGear(uid)
    this.eq.restore({})
    this.grantOriginGear(originId)
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
      bowForkBranches: d.bowForkBranches,
      skillDmg: eq.skillDmg,
      comboScaling: eq.comboScaling,
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
   * §6.2/§6.3 营地交易：卖身上或包里的那一件装备实例，买清单里的消耗品。
   * 卖与分解共用同一条防线——槽位不能指向一个已经不存在的 uid，所以先脱再拆/再卖。
   */
  sell(uid: string): SellResult {
    for (const slot of Object.keys(this.eq.slots) as SlotKey[]) {
      if (this.eq.slots[slot] === uid) this.eq.unequip(slot)
    }
    return sellGear(this.inv, uid)
  }

  buy(entryId: string): BuyResult { return buy(this.inv, entryId) }

  /**
   * 卖掉手里的那 n 件堆叠货（残骸/素材/乐谱，KI-059）。装备走 `sell(uid)`（实例才是卖家），
   * 堆叠件走这里（数量才是卖家）——两条腿不共用一个入口，否则"卖这把剑"和"卖 3 个残晶"
   * 会在同一个参数上分叉。
   */
  sellStacks(itemId: string, n = 1): StackSellResult {
    return sellStack(this.inv, itemId, n)
  }

  /**
   * 使用消耗品（回响膏=回血；音色晶=刮失谐）。返回实际生效量，由 main.ts 落到玩家身上——
   * 这一层不认识 PlayerController，所以"回血/清值"只能作为数字交回去，不能自己改人。
   *
   * KI-023① 之后 `use` 认三种用法，而**这条腿只认两种**：投掷（`throw`）的消费方是
   * `CombatManager.throwCrystal`，不是这里。所以只写 `throw` 的晶石不能被"研读"吃掉一件——
   * 先扣再算会让它返回 `ok:true, 0, 0`，玩家看到的是道具凭空消失（§55：一个字段一个消费方，
   * 而"没有效果的那种消费"是最坏的一种）。今天表里没有这样的道具，这道闸门是为那个合法形状立的。
   */
  useItem(itemId: string): { ok: boolean; heal: number; corruption: number } {
    const item: ItemData = itemOf(itemId)
    if (item.kind !== 'consumable' || !item.use) return { ok: false, heal: 0, corruption: 0 }
    const heal = item.use.heal ?? 0
    const corruption = item.use.corruption ?? 0
    if (heal === 0 && corruption === 0) return { ok: false, heal: 0, corruption: 0 }
    if (this.inv.count(itemId) <= 0) return { ok: false, heal: 0, corruption: 0 }
    this.inv.remove(itemId, 1)
    return { ok: true, heal, corruption }
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
