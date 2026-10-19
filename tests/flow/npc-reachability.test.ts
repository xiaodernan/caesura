import { describe, expect, it } from 'vitest'
import { registerGameData, npcs, dialogues, regions, quests as questTable, worldStates } from '@/data'
import { DialogueEngine } from '@/quest/Dialogue'

/**
 * NPC 的**可达性**——"名册里有这个人" ≠ "玩家能跟他说上话"。
 *
 * 门禁只查**一半**：`regions.json` 里 `kind:'npc'` 的 `npcId` 必须在 `npcs.json` 里
 * （否则"按 E 只会得到一句占位台词"）。**另外两半没有任何东西看着**：
 * - 名册里有人、**却没有对话树** ⇒ 按 E 得到的是占位台词（而不是他的树）——玩家读到的是"这个人没话说"，
 *   而账上写着"他有小传、有 homeRegion"；
 * - 名册里有人、**却没有任何入口** ⇒ 那是**死数据**：写得多满都没人能碰到他。
 *
 * 本守卫把这三半钉齐。⚠️ 它**不查**"树里写得好不好"（那是叙事读数，由人判）。
 */
registerGameData()

const roster = npcs as unknown as Array<{ id: string }>
const trees = dialogues as unknown as Array<{ id: string; npc: string }>
const rows = regions as unknown as Array<{ id: string; interactables?: Array<Record<string, unknown>> }>

/** 名册里的每个人 → 谁给了他一棵树 */
function treeOwners(): Set<string> {
  return new Set(trees.map((t) => t.npc))
}

/** 名册里的每个人 → 谁能碰到他（`kind:'npc'` 的陈设） */
function entryOwners(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const rg of rows) {
    for (const it of rg.interactables ?? []) {
      if (it.kind !== 'npc' || typeof it.npcId !== 'string') continue
      const list = out.get(it.npcId) ?? []
      list.push(`${rg.id}.interactables(${it.id})`)
      out.set(it.npcId, list)
    }
  }
  return out
}

describe('NPC 可达性：名册 ↔ 树 ↔ 入口，三半都要齐', () => {
  it('名册不该是空的（否则这道门在空转）', () => {
    expect(roster.length).toBeGreaterThan(0)
    expect(trees.length).toBeGreaterThan(0)
  })

  it('名册里每个人都**有对话树**（没有 ⇒ 按 E 只会得到一句占位台词）', () => {
    const owners = treeOwners()
    const missing = roster.filter((n) => !owners.has(n.id)).map((n) => n.id)
    expect(missing, `这些 NPC 没有对话树：${missing.join(', ')}`).toEqual([])
  })

  it('名册里每个人都**至少有一个入口**（没有 ⇒ 死数据：写得多满都没人碰得到他）', () => {
    const entries = entryOwners()
    const orphans = roster.filter((n) => !entries.has(n.id)).map((n) => n.id)
    expect(orphans, `这些 NPC 没有任何 kind:'npc' 入口：${orphans.join(', ')}`).toEqual([])
  })

  it('每个 npc 入口的 npcId 都在名册里（门禁那一半，这里按同源再钉一次）', () => {
    const known = new Set(roster.map((n) => n.id))
    const bad: string[] = []
    for (const [npcId, where] of entryOwners()) if (!known.has(npcId)) bad.push(`${npcId} ← ${where.join(' / ')}`)
    expect(bad, `悬空入口：${bad.join('；')}`).toEqual([])
  })

  it('每个人的**入口就在他自己的 `homeRegion` 里**（站在别人家的 NPC = 小传与现场两处真相）', () => {
    // `homeRegion` 是"他住在哪"；入口是"玩家在哪能碰到他"。两者不一致时不会有别的东西响——
    // 玩家会在一个**不是他家的地方**遇见他，而面板/调试读数仍说他在老家。
    const entries = entryOwners()
    const wrong: string[] = []
    for (const n of roster as unknown as Array<{ id: string; homeRegion?: string }>) {
      const home = n.homeRegion
      if (typeof home !== 'string' || home.length === 0) { wrong.push(`${n.id} 没写 homeRegion`); continue }
      const where = (entries.get(n.id) ?? []).map((w) => w.split('.')[0])
      if (!where.includes(home)) wrong.push(`${n.id}: home=${home} 但入口在 ${where.join('/') || '（无）'}`)
    }
    expect(wrong, `入口不在自己家里：${wrong.join('；')}`).toEqual([])
  })

  it('每棵树的主人都在名册里（树不会替一个不存在的人说话）', () => {
    const known = new Set(roster.map((n) => n.id))
    const bad = trees.filter((t) => !known.has(t.npc)).map((t) => `${t.id}→${t.npc}`)
    expect(bad, `悬空的树主人：${bad.join(', ')}`).toEqual([])
  })
})

describe('默认状态下**点得开**吗（"有树" ≠ "此刻有话可说"）', () => {
  it('每个 NPC 在**默认上下文**下 `start().view` 非空（空 ⇒ 按 E 只得占位台词）', () => {
    const engine = new DialogueEngine(
      dialogues as never,
      questTable as never,
    )
    // 默认上下文 = 什么都没发生过：无旗标 / 关系 0 / 任务未开始 / 无物品 / 没看过任何节点 /
    // 值域读登记表的缺省。**这是"新玩家刚进游戏"的那一格**，也正是最容易踩空的那一格。
    const defaults = new Map((worldStates as unknown as Array<{ key: string; default?: string }>).map((w) => [w.key, w.default ?? '']))
    const ctx = {
      hasFlag: () => false,
      relation: () => 0,
      questState: () => null,
      questIndex: () => -1,
      hasItem: () => false,
      hasSeen: () => false,
      state: (k: string) => defaults.get(k) ?? '',
    }
    const silent = roster.map((n) => n.id).filter((id) => engine.start(id, ctx).view === null)
    expect(silent, `这些 NPC 在默认状态下开不了口（树在，但那一格够不着）：${silent.join(', ')}`).toEqual([])
  })
})
