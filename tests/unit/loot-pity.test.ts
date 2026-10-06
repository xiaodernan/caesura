import { describe, expect, it } from 'vitest'
import { Rng } from '@/core/Math'
import { registry } from '@/core/Registry'
import { registerGameData } from '@/data'
import type { LootRoll, LootTableData, ProgressionData } from '@/data/schema'
import { Inventory } from '@/rpg/Inventory'
import { Progression } from '@/rpg/Progression'
import { LootDirector } from '@/rpg/Loot'
import { itemOf } from '@/rpg/Inventory'

/**
 * 掉落评审（G5③）。`pity` 这个词在本项目里指**两条不同的规则**，而实现此前只落了半条：
 *
 *   - §9.4 全局大保底「每第 N 件装备强制 ≥ 地板稀有度」——代码里写着，但 N 与地板档是 `Loot.ts`
 *     的两个常量（本次搬进 `progression.json.pity`：这颗旋钮恰恰是最常调的那颗）；
 *   - §9.2 容器档那一列「连续 N 次没掉本条 ⇒ 第 N+1 次必掉」——`LootRoll.pity` 在 8 张表里写着，
 *     **运行时没有任何地方读它**（需求 §55「不许写没有消费方的数据」的违例，本次补上消费方）。
 *
 * 这里除了钉住两条各自的行为，还专门钉住它们**互不替换**：容器那条不许动稀有度，
 * 大保底那条不许动掉落频率。少一条断言，未来就有人会"顺手合并"成一条。
 */

let labSeq = 0
/**
 * 注册一张只在测试里存在的表。前缀刻意避开 `loot_`：本文件后面的数据自检扫的是
 * `registry.ids('loot_')`，把实验表混进真数据里就成了自己检查自己。
 */
function labTable(rolls: LootRoll[]): string {
  const id = `zz_lab_pity_${++labSeq}`
  registry.register<LootTableData>(id, { id, rolls })
  return id
}

function makeLoot(seed: number | string = 'pity-lab') {
  registerGameData()
  const inv = new Inventory(seed)
  const prog = new Progression('origin_tuner')
  return { inv, prog, loot: new LootDirector(inv, prog) }
}

const rarityOfLast = (inv: Inventory): string =>
  itemOf(inv.gears[inv.gears.length - 1].itemId).gear?.rarity ?? '?'

describe('§9.2 容器保底：逐条 roll 的「连续没中」计数', () => {
  it('chance=0 的条目：连续 pity 次没中之后，第 pity+1 次必中', () => {
    const { loot } = makeLoot()
    const t = labTable([{ id: 'gear', chance: 0, pity: 3, gearBand: [{ rarity: 'common', weight: 100 }] }])
    const got = [1, 2, 3, 4].map(() => loot.grant(t).length)
    expect(got.slice(0, 3), '前三次没中就是没中').toEqual([0, 0, 0])
    expect(got[3], '第 4 次被保底顶出来（§9.2「第 N+1 个必」的口径）').toBe(1)
    expect(loot.grant(t).length, '兑现过一次就归零重攒，不能变成每次都白送').toBe(0)
  })

  it('没写 pity 的 roll 不受影响：低概率就是低概率，没有隐藏兜底', () => {
    const { loot } = makeLoot()
    const t = labTable([{ id: 'gear', chance: 0, gearBand: [{ rarity: 'common', weight: 100 }] }])
    for (let i = 0; i < 200; i++) expect(loot.grant(t).length).toBe(0)
  })

  it('低概率条目接上保底后：期望被抬到「至少每 pity+1 次一发」', () => {
    const { loot } = makeLoot('often')
    const t = labTable([{ id: 'gear', chance: 0.02, pity: 8, gearBand: [{ rarity: 'common', weight: 100 }] }])
    const hits = Array.from({ length: 120 }, () => loot.grant(t).length).reduce((s, n) => s + n, 0)
    // 纯 2% 在 120 次里的期望只有 2.4 发；一发都没有就说明保底根本没接线
    expect(hits, `120 次掷骰只掉了 ${hits} 件`).toBeGreaterThanOrEqual(12)
  })

  it('计数逐条各算各的，并跟着存档走', () => {
    const a = makeLoot('per-roll')
    const t = labTable([
      { id: 'gear', chance: 0, pity: 2, gearBand: [{ rarity: 'common', weight: 100 }] },
      { id: 'stone', chance: 0, pity: 2, item: 'it_timbite' }
    ])
    a.loot.grant(t) // 两条各失败一次
    const snap = a.loot.snapshot()
    expect(Object.keys(snap.rollStreaks).sort()).toEqual([`${t}:gear`, `${t}:stone`])
    expect(Object.values(snap.rollStreaks)).toEqual([1, 1])

    const b = makeLoot('per-roll')
    b.loot.restore(snap)
    expect(b.loot.grant(t).length, '读档后计数继续攒：这一次是第 2 次失败，还没到保底').toBe(0)
    expect(b.loot.grant(t).map((g) => g.type).sort(), '第 3 次（连续 2 次没中之后）两条各自兑现')
      .toEqual(['gear', 'item'])
  })

  it('老档没有这一格：读进来不崩，也不会凭空攒出保底', () => {
    const { loot } = makeLoot()
    const t = labTable([{ id: 'gear', chance: 0, pity: 1, gearBand: [{ rarity: 'common', weight: 100 }] }])
    loot.restore({ firstKilled: [], gearStreak: 0 }) // v4 及更早的形状
    expect(loot.grant(t).length, '从零开始：第一次失败还没到保底').toBe(0)
    expect(loot.grant(t).length, '第二次（连续 1 次没中之后）兑现').toBe(1)
  })

  it('同一颗种子开出同一条保底轨迹（§10 掉落种子入档 ⇒ 可复现 QA）', () => {
    const t = labTable([{ id: 'gear', chance: 0.06, pity: 12, gearBand: [{ rarity: 'common', weight: 100 }] }])
    const seq = (): number[] => {
      const { loot } = makeLoot('same-seed')
      return Array.from({ length: 60 }, () => loot.grant(t).length)
    }
    const first = seq()
    expect(first).toEqual(seq())
    expect(first.some((n) => n > 0), '13 次一发封顶，60 次里必然有过').toBe(true)
  })
})

describe('§9.4 全局大保底：两个数住在 progression.json，不在代码里', () => {
  it('数据形状齐全：every ≥ 2，floorRarity 是 rarity 表里真实存在的档', () => {
    registerGameData()
    const p = registry.get<ProgressionData>('progression')
    expect(p.pity.every).toBeGreaterThanOrEqual(2)
    expect(p.rarity.map((r) => r.id)).toContain(p.pity.floorRarity)
  })

  it('改数据就改行为：把 every 从 10 调到 3，第 3 件装备就被顶到地板档', () => {
    const p = registry.get<ProgressionData>('progression')
    const backup = p.pity.every
    try {
      p.pity.every = 3
      const { inv, loot } = makeLoot('global-floor')
      const t = labTable([{ id: 'gear', gearBand: [{ rarity: 'common', weight: 100 }] }])
      const picked: string[] = []
      for (let i = 0; i < 3; i++) {
        loot.grant(t)
        picked.push(rarityOfLast(inv))
      }
      expect(picked.slice(0, 2), '前两件按 band 抽 ⇒ 只有素声').toEqual(['common', 'common'])
      // band 里根本没有地板档 ⇒ 保底不能被 band 限制住，直接给地板档
      expect(picked[2], '第 3 件被大保底顶出 band').toBe(p.rarity.map((r) => r.id).find(() => false) ?? 'rare')
    } finally {
      p.pity.every = backup
    }
  })

  it('两条保底互不替换：容器保底只保证「掉」，不动稀有度', () => {
    const { inv, loot } = makeLoot('two-rules')
    const t = labTable([{ id: 'gear', chance: 0, pity: 1, gearBand: [{ rarity: 'common', weight: 100 }] }])
    const dropped: string[] = []
    for (let i = 0; i < 20; i++) {
      const before = inv.gears.length
      loot.grant(t)
      if (inv.gears.length > before) dropped.push(rarityOfLast(inv))
    }
    expect(dropped.length, '每 2 次 grant 掉一件 ⇒ 20 次正好攒满一次大保底').toBe(10)
    expect(dropped.slice(0, 9), '前九件只是"掉出来了"，稀有度没被容器保底抬过').toEqual(Array(9).fill('common'))
    expect(dropped[9], '第十件才是 §9.4 那一次大保底').not.toBe('common')
  })
})

describe('掉落表数据自检（G5③ 掉落评审的真数据部分）', () => {
  it('同一张表内 roll id 唯一：逐条保底的键靠它，重名就会两条共用一格计数', () => {
    registerGameData()
    for (const id of registry.ids('loot_')) {
      const t = registry.get<{ rolls?: LootRoll[]; firstKill?: LootRoll[] }>(id)
      const seen = new Set<string>()
      for (const r of [...(t.rolls ?? []), ...(t.firstKill ?? [])]) {
        expect(seen.has(r.id), `${id} 里 roll id「${r.id}」重复：两条会共用同一格保底计数`).toBe(false)
        seen.add(r.id)
      }
    }
  })

  it('写了 pity 的条目必须带 chance（必中条目不存在「没中」，那一格就是死数据）', () => {
    registerGameData()
    let n = 0
    for (const id of registry.ids('loot_')) {
      const t = registry.get<{ rolls?: LootRoll[]; firstKill?: LootRoll[] }>(id)
      for (const r of [...(t.rolls ?? []), ...(t.firstKill ?? [])]) {
        if (r.pity === undefined) continue
        n++
        expect(r.chance, `${id}:${r.id} 写了 pity 却没写 chance`).not.toBeUndefined()
        expect(r.pity).toBeGreaterThanOrEqual(2)
        expect(r.pity).toBeLessThanOrEqual(20)
      }
    }
    expect(n, '数据里确实有「容器保底」这一列，不是测试自己造的').toBeGreaterThanOrEqual(8)
  })

  it('隐藏房给得出装备/乐谱/铭文档，而不是普通材料堆（§4.1 T4 硬规则）', () => {
    registerGameData()
    const hidden: string[] = []
    for (const id of registry.ids('rg_')) {
      const region = registry.get<{ secrets?: { rewardTable: string }[] }>(id)
      for (const s of region.secrets ?? []) hidden.push(s.rewardTable)
    }
    expect(hidden.length, 'regions.json 里要有隐藏房').toBeGreaterThanOrEqual(4)
    const order = registry.get<ProgressionData>('progression').rarity.map((r) => r.id)
    for (const tableId of hidden) {
      const t = registry.get<{ rolls?: LootRoll[] }>(tableId)
      const gearRolls = (t.rolls ?? []).filter((x) => x.gearBand?.length)
      const tierRolls = (t.rolls ?? []).filter((x) => x.item && (x.item.startsWith('seal_') || x.item === 'it_score_fragment'))
      expect(gearRolls.length + tierRolls.length, `${tableId}：隐藏房必须给得出装备或乐谱/铭文档`).toBeGreaterThanOrEqual(1)
      for (const g of gearRolls) {
        const best = Math.max(...g.gearBand!.map((b) => order.indexOf(b.rarity)))
        expect(best, `${tableId}:${g.id} 的装备档至少要够到稀有`).toBeGreaterThanOrEqual(order.indexOf('rare'))
      }
    }
  })
})

describe('背包收不下的一笔', () => {
  it('inv.add 返回 0 ⇒ 这一格静默落空：不播报半份', () => {
    registerGameData()
    // 只换掉 add 这一条腿：LootDirector 对背包的全部预期就是「收下几件」这一格读数
    const inv = { rng: new Rng('loot-full'), add: () => 0 } as unknown as Inventory
    const loot = new LootDirector(inv, new Progression('origin_tuner'))
    const t = labTable([{ id: 'tim', item: 'it_timbite' }])
    expect(loot.grant(t), '一件都没进包 ⇒ 返回空，不返回拿不出名字的半份').toEqual([])
  })
})
