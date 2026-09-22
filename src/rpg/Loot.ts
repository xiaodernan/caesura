import { registry } from '@/core/Registry'
import type { EnemyData, ItemData, LootRoll, LootTableData, ProgressionData } from '@/data/schema'
import type { Inventory } from './Inventory'
import { itemOf, isGear } from './Inventory'
import type { Progression } from './Progression'

/**
 * 掉落（progression.md §9）。掷骰全部走 `Inventory` 那颗种子化 RNG ⇒ 同一颗种子
 * 开出同一串掉落（§10「掉落随机种子入档（可复现 QA）」）。
 *
 * 保底是认真的：连续 9 件没出稀有，第 10 件强制 ≥稀有（§9.4）。它记在**掉落层**
 * 而不是"每次击杀"层——玩家杀 10 只嘈壳和开 10 个箱子共用同一条保底计数，
 * 否则"多刷小怪"就能把保底刷出来，那不是保底，是漏洞。
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

const PITY_EVERY = 10
const PITY_FLOOR = 'rare'

export class LootDirector {
  /** 已首杀过的敌人（读档恢复；§9.3 Boss 首杀唯一） */
  private firstKilled = new Set<string>()
  /** 连续未出稀有的装备件数 */
  private gearStreak = 0

  constructor(
    private readonly inv: Inventory,
    private readonly prog: Progression,
    private readonly rng = inv.rng,
  ) {}

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
    for (const r of table.rolls) out.push(...this.roll(r, false))
    if (firstKill && table.firstKill) {
      for (const r of table.firstKill) out.push(...this.roll(r, true))
    }
    return out
  }

  private roll(r: LootRoll, isFirstKill: boolean): LootGrant[] {
    if (r.chance !== undefined && !this.rng.chance(r.chance)) return []
    if (r.xp) {
      const n = this.rng.int(r.xp[0], r.xp[1])
      const gain = this.prog.addResonance(n)
      void gain
      return [{ type: 'xp', id: 'resonance', count: n, name: '遗响' }]
    }
    if (r.gearBand) {
      const pity = (this.gearStreak + 1) % PITY_EVERY === 0
      const rarity = this.pickRarity(r.gearBand, pity)
      const item = this.pickGearItem(rarity)
      this.gearStreak++
      if (!item) return []
      const g = this.inv.addGear(item.id)
      return [{ type: 'gear', id: g.uid, count: 1, name: item.displayName, ...(pity ? { pity: true } : {}) }]
    }
    if (r.item) {
      const n = r.count ? this.rng.int(r.count[0], r.count[1]) : 1
      const got = this.inv.add(r.item, n)
      if (got <= 0) return []
      return [{ type: 'item', id: r.item, count: got, name: itemOf(r.item).displayName, ...(isFirstKill ? { pity: false } : {}) }]
    }
    return []
  }

  /** 保底：强制 ≥ PITY_FLOOR；band 里没有就跳出 band 去全局池抽（保底不能被 band 限制住） */
  private pickRarity(band: { rarity: string; weight: number }[], pity: boolean): string {
    const prog = registry.get<ProgressionData>('progression')
    const order = prog.rarity.map((r) => r.id)
    const floor = order.indexOf(PITY_FLOOR)
    const asItems = (xs: { rarity: string; weight: number }[]) => xs.map((b) => ({ item: b.rarity, weight: b.weight }))
    if (pity) {
      const eligible = band.filter((b) => order.indexOf(b.rarity) >= floor)
      if (eligible.length) return this.rng.weighted(asItems(eligible))
      return PITY_FLOOR
    }
    return this.rng.weighted(asItems(band))
  }

  private pickGearItem(rarity: string): ItemData | null {
    const pool = this.inv
      .list()
      .map((x) => x.item)
      .filter((it) => isGear(it) && it.gear?.rarity === rarity)
    // 掉落池不看背包里有什么：从注册表全量扫装备件，背包只是容器
    const all = allGearItems().filter((it) => it.gear?.rarity === rarity)
    void pool
    if (!all.length) return null
    return this.rng.pick(all)
  }

  snapshot(): { firstKilled: string[]; gearStreak: number } {
    return { firstKilled: [...this.firstKilled], gearStreak: this.gearStreak }
  }

  restore(s: { firstKilled?: string[]; gearStreak?: number }): void {
    this.firstKilled = new Set(s.firstKilled ?? [])
    this.gearStreak = s.gearStreak ?? 0
  }
}

let gearCache: ItemData[] | null = null
/** 全量装备件（按稀有度抽掉落时用）。注册表是唯一真源，不另建池子表。 */
export function allGearItems(): ItemData[] {
  if (!gearCache) gearCache = registry.ids('it_').concat(registry.ids('wp_'), registry.ids('ar_'), registry.ids('seal_'))
    .map((id) => registry.maybeGet<ItemData>(id))
    .filter((x): x is ItemData => !!x && isGear(x))
  return gearCache
}
