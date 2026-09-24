import { registry } from '@/core/Registry'
import type { EnemyData, ItemData, LootRoll, LootTableData, ProgressionData, RegionData } from '@/data/schema'
import type { Inventory } from './Inventory'
import { itemOf, isGear } from './Inventory'
import { originOf, type Progression } from './Progression'

/**
 * 掉落（progression.md §9）。掷骰全部走 `Inventory` 那颗种子化 RNG，而**抽到第几笔跟着存档走**
 * （§10「掉落随机种子入档 ⇒ 可复现 QA」）⇒ 同一颗种子、同一份档，续掉的每一发都能重放。
 *
 * 这里住着**两条各自独立**的保底，别把它们合成一条：
 * - §9.4 全局大保底：每第 `progression.pity.every` 件装备强制 ≥ `floorRarity`。它记在**掉落层**
 *   而不是"每次击杀"层——玩家杀 10 只嘈壳和开 10 个箱子共用同一条计数，否则"多刷小怪"就能把
 *   保底刷出来，那不是保底，是漏洞。
 * - §9.2 容器保底：某一条 roll 连续 `LootRoll.pity` 次没掷中，下一次强制命中。它只管**这一条掉不掉**，
 *   不许抬稀有度（抬稀有度是上面那条的工作），计数按 `${表id}:${roll id}` 逐条各攒各的。
 */

export interface LootGrant {
  type: 'xp' | 'item' | 'gear'
  /** xp 时为 'resonance'；item 时为物品 id；gear 时为装备实例 uid */
  id: string
  count: number
  name: string
  /** 保底触发的那一件（UI 可以给它不同的提示） */
  pity?: boolean
}

/** §9.4 全局大保底的两个数（每第 N 件 / 地板稀有度）——住在 progression.json，代码里不留第二份 */
function pityRule(): { every: number; floorRarity: string } {
  return registry.get<ProgressionData>('progression').pity
}

export class LootDirector {
  /** 已首杀过的敌人（读档恢复；§9.3 Boss 首杀唯一） */
  private firstKilled = new Set<string>()
  /** 连续未出稀有的装备件数（§9.4 全局大保底，跨表累计） */
  private gearStreak = 0
  /** 逐条 roll 的「连续没中」计数（§9.2 容器保底），键 = `tableId:rollId`；只有带 pity 的 roll 会占一格 */
  private rollStreak = new Map<string, number>()
  /** 玩家此刻站在哪个区域（§9.4 区域上修，KI-030①）。由 main.ts 每次区域切换写入，**不入档**——它是世界的读数不是掉落的账 */
  private regionId: string | null = null

  constructor(
    private readonly inv: Inventory,
    private readonly prog: Progression,
    private readonly rng = inv.rng,
    /** 幸运系数（§6.2「丰谐」，KI-030②）：**每次掷骰现查**而不是快照——卸下护符的那一格起就不该再加值 */
    private readonly luck = () => 0,
  ) {}

  setRegion(regionId: string | null): void {
    this.regionId = regionId
  }

  isFirstKill(enemyId: string): boolean {
    return !this.firstKilled.has(enemyId)
  }

  /** 击杀结算：遗响 + 掉落 + 首杀专属。返回这一笔给了什么（调用方负责播报）。 */
  onEnemyKilled(enemy: EnemyData): LootGrant[] {
    const first = this.isFirstKill(enemy.id)
    this.firstKilled.add(enemy.id)
    const out: LootGrant[] = []
    for (const d of enemy.drops ?? []) {
      if (d.chance !== undefined && !this.rng.chance(d.chance)) continue
      out.push(...this.grant(d.tableId, first))
    }
    return out
  }

  grant(tableId: string, firstKill = false): LootGrant[] {
    const table = registry.get<LootTableData>(tableId)
    const out: LootGrant[] = []
    for (const r of table.rolls) out.push(...this.roll(tableId, r))
    if (firstKill && table.firstKill) {
      for (const r of table.firstKill) out.push(...this.roll(tableId, r))
    }
    return out
  }

  /** 一次掷骰：先问「本条中没中」（attempts），再按命中的内容给东西 */
  private roll(tableId: string, r: LootRoll): LootGrant[] {
    if (!this.attempts(tableId, r)) return []
    if (r.xp) {
      const n = this.rng.int(r.xp[0], r.xp[1])
      this.prog.addResonance(n)
      return [{ type: 'xp', id: 'resonance', count: n, name: '遗响' }]
    }
    if (r.gearBand) {
      const rule = pityRule()
      const pity = (this.gearStreak + 1) % rule.every === 0
      const rarity = this.pickRarity(r.gearBand, pity)
      const item = this.pickGearItem(rarity)
      this.gearStreak++
      if (!item) return []
      const g = this.inv.addGear(item.id)
      return [{ type: 'gear', id: g.uid, count: 1, name: item.displayName, ...(pity ? { pity: true } : {}) }]
    }
    if (r.item) {
      const n = this.withOriginPassive(r.item, r.count ? this.rng.int(r.count[0], r.count[1]) : 1)
      const got = this.inv.add(r.item, n)
      if (got <= 0) return []
      return [{ type: 'item', id: r.item, count: got, name: itemOf(r.item).displayName }]
    }
    return []
  }

  /**
   * 本条 roll 是否命中。带了 `pity` 的 roll 才有逐条计数（没带的不占存档位——否则每张表的
   * 每个材料条都要存一笔从未被读过的计数器，那就是把 §55 的反面再抄一遍）。
   */
  private attempts(tableId: string, r: LootRoll): boolean {
    if (r.chance === undefined) return true
    if (this.rng.chance(r.chance)) {
      if (r.pity !== undefined) this.rollStreak.delete(rollKey(tableId, r))
      return true
    }
    if (r.pity === undefined) return false
    const key = rollKey(tableId, r)
    const fails = (this.rollStreak.get(key) ?? 0) + 1
    if (fails > r.pity) {
      this.rollStreak.delete(key) // 保底兑现过一次，计数归零重新开始攒
      return true
    }
    this.rollStreak.set(key, fails)
    return false
  }

  /**
   * 保底：强制 ≥ 地板稀有度；band 里没有就在 floor 档位上直接抽（保底不能被 band 限制住）。
   * 非保底那一腿先过 `tiltBand`——深窖上修与丰谐幸运都只**歪权重**，不保证任何一件。
   */
  private pickRarity(band: { rarity: string; weight: number }[], pity: boolean): string {
    const prog = registry.get<ProgressionData>('progression')
    const order = prog.rarity.map((r) => r.id)
    const floor = pityRule().floorRarity
    const floorIdx = order.indexOf(floor)
    const asItems = (xs: { rarity: string; weight: number }[]) => xs.map((b) => ({ item: b.rarity, weight: b.weight }))
    if (pity) {
      const eligible = band.filter((b) => order.indexOf(b.rarity) >= floorIdx)
      if (eligible.length) return this.rng.weighted(asItems(eligible))
      return floor
    }
    return this.rng.weighted(asItems(this.tiltBand(band, order)))
  }

  /**
   * §9.4 区域上修 × §6.2 幸运系数（KI-030①②）：两者共用同一根杠杆——对高段档位的权重做乘法，
   * 深窖里戴丰谐 = ×1.5×1.15。高段的门槛：区域声明了 `atOrAbove` 就用它；只有幸运时，
   * 门槛与 §9.4 同源（`pity.floorRarity` 是「高段」唯一的数字主人，代码里不另发明一条线）。
   * **歪权重不追加掷骰**：`weighted` 消耗随机数的多少只看 band 长度，与权重取值无关 ⇒
   * 种子重放的轨道不改线（§10）。
   */
  private tiltBand(band: { rarity: string; weight: number }[], order: string[]): { rarity: string; weight: number }[] {
    const region = this.regionId ? registry.maybeGet<RegionData>(this.regionId) : null
    const boost = region?.loot?.rarityBoost
    const mul = (boost ? boost.mul : 1) * (1 + this.luck())
    if (mul === 1) return band
    const hiIdx = boost ? order.indexOf(boost.atOrAbove) : -1
    const from = hiIdx >= 0 ? hiIdx : order.indexOf(pityRule().floorRarity)
    return band.map((b) => (order.indexOf(b.rarity) >= from ? { ...b, weight: b.weight * mul } : b))
  }

  private pickGearItem(rarity: string): ItemData | null {
    // 掉落池不看背包里有什么：从注册表全量扫装备件，背包只是容器
    const all = allGearItems().filter((it) => it.gear?.rarity === rarity)
    if (!all.length) return null
    return this.rng.pick(all)
  }

  /**
   * §2.2 出身被动（目前白名单里只有 lootStackBonus 一种）。**期望值取整**：小数部分掷给
   * 那颗种子化 RNG——3 件的 +10% 若走 `Math.round(3×1.1)=3`，"+10%" 就成了 "+0%"；
   * 掷小数让长期期望真的是 mul×，而且这一掷跟着掉落序列入档（§10 可复现 QA 不破）。
   * 不吃数的件**不消耗随机数**：对照腿（别的出身）的 RNG 序列因此保持同轨。
   */
  private withOriginPassive(itemId: string, n: number): number {
    const p = originOf(this.prog.originId).passive
    if (!p || p.itemId !== itemId) return n
    const v = n * p.mul
    const whole = Math.floor(v)
    if (v === whole) return whole // 整数乘数不掷小数——对照腿的 RNG 序列保持同轨
    return whole + (this.rng.float() < v - whole ? 1 : 0)
  }

  snapshot(): { firstKilled: string[]; gearStreak: number; rollStreaks: Record<string, number> } {
    return { firstKilled: [...this.firstKilled], gearStreak: this.gearStreak, rollStreaks: Object.fromEntries(this.rollStreak) }
  }

  restore(s: { firstKilled?: string[]; gearStreak?: number; rollStreaks?: Record<string, number> }): void {
    this.firstKilled = new Set(s.firstKilled ?? [])
    this.gearStreak = s.gearStreak ?? 0
    // v4 及更早的档没有这一格：不传 = 从零开始攒（§78 如实），而不是白送玩家一次保底
    this.rollStreak = new Map(Object.entries(s.rollStreaks ?? {}))
  }
}

/** 逐条保底的计数键：一张表里每条 roll 各攒各的（同一 id 在同表两个槽里不能重名，由 §55 数据闸门钉住） */
const rollKey = (tableId: string, r: LootRoll): string => `${tableId}:${r.id}`

let gearCache: ItemData[] | null = null
/** 全量装备件（按稀有度抽掉落时用）。注册表是唯一真源，不另建池子表。 */
export function allGearItems(): ItemData[] {
  if (!gearCache) gearCache = registry.ids('it_').concat(registry.ids('wp_'), registry.ids('ar_'), registry.ids('seal_'))
    .map((id) => registry.maybeGet<ItemData>(id))
    .filter((x): x is ItemData => !!x && isGear(x))
  return gearCache
}
