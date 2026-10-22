import { registry } from '@/core/Registry'
import { Rng, type RngState } from '@/core/Math'
import type { ItemData, SlotKey } from '@/data/schema'

/**
 * 背包（需求 §25/§44）。两类东西分开存：
 * - `stacks`：可堆叠的货币/素材/消耗品/叙事件（音色石、残晶、乐谱残页…）。
 * - `gears`：装备**实例**——每件有自己的 uid、强化等级和词缀数值（progression.md §5.3
 *   「档位内数值均匀随机」）。同一 id 的两把调律剑不是同一个对象，这是对比装备的前提。
 */

export interface GearAffix { id: string; value: number }

export interface GearInstance {
  uid: string
  itemId: string
  /** 强化等级 0..10（上限由稀有度封顶，见 Upgrade.ts） */
  level: number
  affixes: GearAffix[]
}

export interface ItemSnapshot {
  stacks: { itemId: string; count: number }[]
  /** KI-046：已研读的物品 id（检视记录跟着档走） */
  inspected?: string[]
  gears: GearInstance[]
  /**
   * 掉落 RNG 抽到了第几笔（§10「随机种子入档 ⇒ 可复现 QA」）。
   * 没有这一格，读档就等于把掷骰序列倒回开局：同一个存档重载三次会掉出三串不同的东西，
   * 而 QA 要的恰恰是"这局之后的每一发都能重放"。
   */
  rng?: RngState
}

let uidSeq = 0

export function itemOf(id: string): ItemData {
  return registry.get<ItemData>(id)
}

export function isGear(item: ItemData): boolean {
  return item.kind === 'weapon' || item.kind === 'armor' || item.kind === 'seal'
}

/** 装备件能进哪个槽；音徽（'seal'）两槽都吃，由 Equipment 决定放哪一边 */
export function slotOf(item: ItemData): SlotKey | null {
  return item.gear?.slot ?? null
}

export class Inventory {
  private stacks = new Map<string, number>()
  gears: GearInstance[] = []
  /** 掉落掷骰的种子化 RNG（§10「掉落随机种子入档（可复现 QA）」） */
  readonly rng: Rng

  constructor(seed: number | string = 0x51f3a2) {
    this.rng = new Rng(seed)
  }

  /** KI-046：已研读的物品 id 集合 */
  inspected = new Set<string>()

  /** 研读一件物品（不消耗）：返回检视文本（没有则 null），并把物品标记为已检视 */
  inspect(itemId: string): string | null {
    const item = itemOf(itemId)
    if (!item || this.count(itemId) < 1) return null
    const text = item.use?.inspect ?? null
    if (text) this.inspected.add(itemId)
    return text
  }

  hasInspected(itemId: string): boolean { return this.inspected.has(itemId) }

  count(itemId: string): number {
    return this.stacks.get(itemId) ?? 0
  }

  /** 加物品。装备件永远生成新实例（哪怕同名），堆叠件受 `stack` 上限约束并返回实收数量。 */
  add(itemId: string, n = 1): number {
    const item = itemOf(itemId)
    if (isGear(item)) {
      for (let i = 0; i < n; i++) this.addGear(itemId)
      return n
    }
    const have = this.count(itemId)
    const room = Math.max(0, item.stack - have)
    const got = Math.min(room, n)
    if (got > 0) this.stacks.set(itemId, have + got)
    return got
  }

  /** 锻造一件装备实例：按稀有度掷词缀（Unique 件的固定词缀不随机 id，只掷数值） */
  addGear(itemId: string, level = 0, affixes?: GearAffix[]): GearInstance {
    const item = itemOf(itemId)
    if (!isGear(item)) throw new Error(`Inventory: "${itemId}" is not a gear item`)
    const g: GearInstance = {
      uid: `g${++uidSeq}`,
      itemId,
      level,
      affixes: affixes ?? rollAffixes(item)
    }
    this.gears.push(g)
    return g
  }

  remove(itemId: string, n = 1): boolean {
    const have = this.count(itemId)
    if (have < n) return false
    const left = have - n
    if (left <= 0) this.stacks.delete(itemId)
    else this.stacks.set(itemId, left)
    return true
  }

  gearByUid(uid: string): GearInstance | undefined {
    return this.gears.find((g) => g.uid === uid)
  }

  removeGear(uid: string): boolean {
    const i = this.gears.findIndex((g) => g.uid === uid)
    if (i < 0) return false
    this.gears.splice(i, 1)
    return true
  }

  /** 分类清单（§44 背包要支持 filtering/sorting/categories） */
  list(category?: ItemData['kind']): { itemId: string; count: number; item: ItemData }[] {
    const out: { itemId: string; count: number; item: ItemData }[] = []
    for (const [itemId, count] of this.stacks) {
      const item = itemOf(itemId)
      if (category && item.kind !== category) continue
      out.push({ itemId, count, item })
    }
    for (const g of this.gears) {
      const item = itemOf(g.itemId)
      if (category && item.kind !== category) continue
      out.push({ itemId: g.itemId, count: 1, item })
    }
    return out.sort((a, b) => a.item.displayName.localeCompare(b.item.displayName, 'zh'))
  }

  snapshot(): ItemSnapshot {
    return {
      stacks: [...this.stacks].map(([itemId, count]) => ({ itemId, count })),
      gears: this.gears.map((g) => ({ uid: g.uid, itemId: g.itemId, level: g.level, affixes: g.affixes.map((a) => ({ ...a })) })),
      rng: this.rng.state(),
      inspected: [...this.inspected]
    }
  }

  restore(s: ItemSnapshot): void {
    this.stacks.clear()
    this.gears.length = 0
    // v4 及更早的档没有 rng 这一格：那就沿用当前这颗 RNG（如实——那份档确实没记位置），
    // 而不是假装把它倒回开局种子：倒回去会让同一份档重载三次掉出三种东西。
    if (s.rng) this.rng.restore(s.rng)
    // KI-046：检视记录跟着档走（读了什么就是读了什么）
    this.inspected.clear()
    for (const id of s.inspected ?? []) if (itemOf(id).id) this.inspected.add(id)
    for (const st of s.stacks ?? []) {
      if (registry.has(st.itemId)) this.stacks.set(st.itemId, st.count)
    }
    for (const g of s.gears ?? []) {
      if (!registry.has(g.itemId)) continue
      this.gears.push({ uid: g.uid, itemId: g.itemId, level: g.level, affixes: (g.affixes ?? []).map((a) => ({ ...a })) })
      const n = Number(g.uid.slice(1))
      if (Number.isFinite(n) && n > uidSeq) uidSeq = n
    }
  }
}

/**
 * 掷词缀：件上写死的（Unique/固定件）只掷数值，其余按稀有度的词缀数从池子里抽。
 * 数值在 `range` 内均匀随机（progression.md §5.3「档位内数值均匀随机（±10% 端差）」）。
 */
export function rollAffixes(item: ItemData, rng: Rng = new Rng()): GearAffix[] {
  const { progressionData } = rpgTables()
  const rarity = progressionData.rarity.find((r) => r.id === item.gear?.rarity)
  const fixed = item.gear?.affixes ?? []
  const out: GearAffix[] = []
  for (const id of fixed) out.push({ id, value: affixValue(id, rng) })
  if (!rarity) return out
  const want = Math.max(0, rarity.affixes - out.length)
  if (want <= 0) return out
  const pool = [...progressionData.affixes.prefix, ...progressionData.affixes.suffix].filter((a) => {
    if (fixed.includes(a.id)) return false
    if (a.slots && item.gear && !a.slots.includes(item.gear.slot)) return false
    if (a.minRarity && rarityIndex(a.minRarity) > rarityIndex(rarity.id)) return false
    return true
  })
  for (let i = 0; i < want && pool.length; i++) {
    const idx = rng.int(0, pool.length - 1)
    const a = pool.splice(idx, 1)[0]
    out.push({ id: a.id, value: affixValue(a.id, rng) })
  }
  return out
}

/** 词缀数值：在区间内均匀随机；**整数区间**取整，小数区间保留三位小数 */
export function affixValue(id: string, rng: Rng = new Rng()): number {
  const { progressionData } = rpgTables()
  const def = [...progressionData.affixes.prefix, ...progressionData.affixes.suffix].find((a) => a.id === id)
  if (!def || !def.range) return 0
  const [lo, hi] = def.range
  const raw = lo + (hi - lo) * rng.float()
  // 取整看**区间是不是整数**，不看 behavior：bellBonus 是「行为型但取比率」的那一族
  // （af_bellwarden [0.06,0.12]，消费方 CombatManager 拿它当乘数、UI 用百分比显示），
  // 从前被 behavior 一律取整 ⇒ Math.round(0.06..0.12) 恒为 0，之鸣钟整条词缀失效。
  // 帧数/次数那一族（perfectBlockWindow / lightStartup）区间本就是整数，走同一条路不变。
  return Number.isInteger(lo) && Number.isInteger(hi) ? Math.round(raw) : Math.round(raw * 1000) / 1000
}

let rarityOrderCache: string[] | null = null
function rarityIndex(id: string): number {
  const { progressionData } = rpgTables()
  if (!rarityOrderCache) rarityOrderCache = progressionData.rarity.map((r) => r.id)
  const i = rarityOrderCache.indexOf(id)
  return i < 0 ? 0 : i
}

/** 惰性取表：单元测试可以在 registerGameData() 之前 import 本模块而不炸 */
function rpgTables(): { progressionData: import('@/data/schema').ProgressionData } {
  return { progressionData: registry.get<import('@/data/schema').ProgressionData>('progression') }
}
