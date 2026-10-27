/**
 * `openLootTable` 的「稀有装备自动存档」守卫（KI-026 的口径，src/rpg/Settlement.ts:70-77）。
 *
 * 契约原文（代码注释）：「拾到 epic/unique 装备时自动存档——这一件太好了，不能让玩家因为没存档而丢失」。
 * 此前 `rare-loot` 这个理由**在整仓只出现一次**（就是那一行 `deps.checkpoint('rare-loot')`），
 * 没有任何用例断言它被调用过：把那一行删掉，全量套件照样全绿。
 *
 * 可达性：`loot_chest_t1` 与 `loot_secret_bellinterior` 两张真表的 gearBand 都含 `epic`
 * （后者只有 rareplus/epic）⇒ 生产链上确实会走到。这里用**单档 band 的实验室表**把随机性钉掉，
 * 不依赖真表的权重骰。
 *
 * 反向面同样要守：普通档（common）与「只有材料/遗响」都不许触发自动存档 ——
 * 否则「稀有」这个词就退化成「只要开箱子就存档」，等于把存档频率抬成噪声。
 */
import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { registerGameData } from '@/data'
import type { LootRoll, LootTableData } from '@/data/schema'
import { itemOf } from '@/rpg/Inventory'
import { RpgRuntime } from '@/rpg/Runtime'
import { openLootTable, type SettlementDeps } from '@/rpg/Settlement'

registerGameData()

let seq = 0
/** 只活在测试里的掉落表（前缀避开真表的 `loot_`，免得被数据自检当成真数据扫到） */
function labTable(rolls: LootRoll[]): string {
  const id = `zz_lab_rareloot_${++seq}`
  registry.register<LootTableData>(id, { id, rolls })
  return id
}

function makeDeps(seed: string): { deps: SettlementDeps; reasons: string[]; refreshes: () => number } {
  const reasons: string[] = []
  let refreshes = 0
  const deps: SettlementDeps = {
    rpg: new RpgRuntime('origin_tuner', seed),
    refresh: () => { refreshes++ },
    checkpoint: (reason) => { reasons.push(reason) },
  }
  return { deps, reasons, refreshes: () => refreshes }
}

describe('openLootTable 的稀有装备自动存档（KI-026）', () => {
  it('epic 装备 ⇒ checkpoint("rare-loot")；普通档 ⇒ 不存档', () => {
    const epic = makeDeps('rareloot-epic')
    const t = labTable([{ id: 'gear', gearBand: [{ rarity: 'epic', weight: 100 }] }])
    const grants = openLootTable(epic.deps, t)
    const g = grants.find((x) => x.type === 'gear')
    expect(g, '单档 epic 的表必须真的掉出装备件').toBeDefined()
    // 前提自证：掉出来的这一件确实是 epic（不是被保底/上修改成别的档）
    expect(itemOf(epic.deps.rpg.inv.gearByUid(g!.id)!.itemId).gear!.rarity).toBe('epic')
    expect(epic.reasons).toContain('rare-loot')
    expect(epic.refreshes(), '开表之后必须灌回一次面板').toBe(1)

    const common = makeDeps('rareloot-common')
    const tc = labTable([{ id: 'gear', gearBand: [{ rarity: 'common', weight: 100 }] }])
    openLootTable(common.deps, tc)
    expect(common.reasons, '普通档不触发自动存档').toEqual([])
  })

  it('unique 装备同样触发（两个稀有档位都要守）', () => {
    const u = makeDeps('rareloot-unique')
    const t = labTable([{ id: 'gear', gearBand: [{ rarity: 'unique', weight: 100 }] }])
    const grants = openLootTable(u.deps, t)
    const g = grants.find((x) => x.type === 'gear')
    expect(g, '单档 unique 的表必须真的掉出装备件').toBeDefined()
    expect(itemOf(u.deps.rpg.inv.gearByUid(g!.id)!.itemId).gear!.rarity).toBe('unique')
    expect(u.reasons).toContain('rare-loot')
  })

  it('只有材料/遗响、没有装备件 ⇒ 不触发', () => {
    const m = makeDeps('rareloot-material')
    const t = labTable([
      { id: 'stone', item: 'it_timbite', count: [2, 2] },
      { id: 'xp', xp: [10, 10] },
    ])
    const grants = openLootTable(m.deps, t)
    expect(grants.some((x) => x.type === 'gear'), '这张表不该掉装备').toBe(false)
    expect(m.reasons).toEqual([])
  })
})
