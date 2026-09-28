import { describe, expect, it } from 'vitest'
import { registerGameData, regions, dialogues, quests as questTable, worldStates } from '@/data'
import { StreamingSystem } from '@/world/Streaming'
import { Quests } from '@/quest/Quests'
import { WorldStates } from '@/quest/WorldStates'
import { DialogueEngine, type DialogueContext, type DialogueView } from '@/quest/Dialogue'
import { DialogueSession } from '@/quest/Settlement'
import { Inventory } from '@/rpg/Inventory'

/**
 * 断弦线步 2/3（narrative §2.4《点名册》与营地定性，§7 `STATE.CAMP`）。
 *
 * 这一批把「尸体军阵的巡逻」接到一个**真的会改世界**的抉择上：替断弦填名册 = 给营地定性，
 * 三种写法各是终幕入场编排的一根线。三条设计承诺在这里被钉住：
 *
 * 1. **步 1 靠机制推进**：只有以纯闪避走完整圈（旗标 `flag.haltrune_patrol_seen`）才开《点名册》；
 *    仅仅"见过面"不算——那时复访给的是中立的那句，不是"名册的事，你想好了吗？"。
 * 2. **决断只由值域承载**：`state.haltrune.camp = OUTPOST/RUINS/GARRISON` 是营地归属的唯一读数，
 *    不另立一枚与它重复的旗标（"两条同时立起来时世界是哪一种"就是值域表要消灭的局面）。
 * 3. **末步 ≠ 完成**：营地定性把线推到《最后一班岗》（`HALTRUNE.STEP3_LASTWATCH`），
 *    那一步没有 `advanceOn` ⇒ `isComplete` 必须是 false——停在末步意味着任务**正在进行**。
 */

function makeWorld() {
  registerGameData()
  const streaming = new StreamingSystem(regions)
  const quests = new Quests(questTable, () => {}, (k) => streaming.hasFlag(k))
  const states = new WorldStates(worldStates)
  const engine = new DialogueEngine(dialogues, quests)
  const inv = new Inventory('haltrune')
  const ctx: DialogueContext = {
    hasFlag: (k) => streaming.hasFlag(k),
    relation: (npc) => quests.relation(npc),
    questState: (id) => quests.state(id),
    questIndex: (id) => quests.stepIndex(id),
    hasItem: (id, count = 1) => inv.count(id) >= count,
    hasSeen: (d, n) => quests.hasSeen(d, n),
    state: (k) => states.get(k),
  }
  const views: DialogueView[] = []
  const session = new DialogueSession({
    quests, engine, ctx, inv,
    setFlag: (k, v) => streaming.setFlag(k, v),
    setState: (k, v) => states.set(k, v),
    notify: () => {},
    refresh: () => {},
    setPaused: () => {},
    present: (v) => { if (v) views.push(v) },
  })
  const last = (): DialogueView => views[views.length - 1]
  const cleanup = (): void => { session.close(); states.dispose(); quests.dispose(); streaming.dispose() }
  /** 走完一遍巡逻（初见 → 跟队 → 一整圈），返回落到步 2 的世界 */
  const walkPatrol = (): void => {
    session.open('npc_haltrune')
    session.choose('c1') // 我不打断他们
    session.choose('c1') // （跟着他们，走完一整圈）
    session.close()
  }
  return { streaming, quests, states, session, views, last, cleanup, walkPatrol }
}

describe('断弦线《点名册》：营地归属是一次真的三选一', () => {
  it('仅仅"见过面"不算走完巡逻：那时复访不给名册，只给中立的那句', () => {
    const w = makeWorld()
    w.session.open('npc_haltrune')
    expect(w.last().nodeId).toBe('n0')
    w.session.choose('c2') // 死人该躺下 ⇒ 只立"见过面"
    expect(w.streaming.hasFlag('flag.haltrune_met')).toBe(true)
    expect(w.streaming.hasFlag('flag.haltrune_patrol_seen')).toBe(false)
    w.session.close()

    w.session.open('npc_haltrune')
    expect(w.last().nodeId, '名册还没开张 ⇒ 落在中立节点上').toBe('n10')
    expect(w.last().text).not.toContain('名册的事')
    expect(w.last().choices).toEqual([])
    w.cleanup()
  })

  it('走完巡逻 ⇒ 步 2《点名册》；三选一写到 state.haltrune.camp 并把线推到《最后一班岗》', () => {
    const w = makeWorld()
    w.walkPatrol()
    expect(w.streaming.hasFlag('flag.haltrune_patrol_seen')).toBe(true)
    expect(w.quests.state('q_haltrune'), '旗标是任务步的读方').toBe('HALTRUNE.STEP2_ROSTER')

    w.session.open('npc_haltrune')
    expect(w.last().nodeId).toBe('n5')
    expect(w.last().choices.map((c) => c.id)).toEqual(['c1', 'c2'])
    w.session.choose('c2') // （把名册还给他）
    expect(w.last().nodeId).toBe('n6')
    expect(w.last().choices.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])

    w.session.choose('c1') // 归还给休垒 —— 友军哨站
    expect(w.states.get('state.haltrune.camp')).toBe('OUTPOST')
    expect(w.quests.state('q_haltrune'), '营地既定 ⇒ 线往前走到最后一班岗').toBe('HALTRUNE.STEP3_LASTWATCH')
    expect(w.quests.isComplete('q_haltrune'), '最后一班岗还没演 ⇒ 不许算收束').toBe(false)
    expect(w.last().nodeId, '后果句').toBe('n7')
    expect(w.last().text).toContain('友军哨站')

    w.session.advance() // 效果句走完 ⇒ 落到复访的中立末节点
    expect(w.last().nodeId).toBe('n10')
    w.cleanup()
  })

  it('三种写法各写各的值，且决定之后不可回退（复访只演后果句，不再给决断）', () => {
    const cases: Array<[string, string, string, string]> = [
      ['c1', 'OUTPOST', 'n7', '友军哨站'],
      ['c2', 'RUINS', 'n8', '废墟'],
      ['c3', 'GARRISON', 'n9', '驻防地'],
    ]
    for (const [choice, value, node, needle] of cases) {
      const w = makeWorld()
      w.walkPatrol()
      w.session.open('npc_haltrune')
      w.session.choose('c2')
      w.session.choose(choice)
      expect(w.states.get('state.haltrune.camp'), `${choice} ⇒ ${value}`).toBe(value)
      expect(w.last().nodeId).toBe(node)
      expect(w.last().text).toContain(needle)
      w.session.close()

      w.session.open('npc_haltrune')
      expect(w.last().nodeId, '复访还是那一句后果').toBe(node)
      expect(w.last().choices, '名册交出去了 ⇒ 这里没有可选项').toEqual([])
      expect(w.states.get('state.haltrune.camp'), '值不会被第二次决定改写').toBe(value)
      w.session.close()
      w.cleanup()
    }
  })

  it('营地归属只有值域一个读数：不再另立一枚与它重复的旗标', () => {
    const w = makeWorld()
    w.walkPatrol()
    w.session.open('npc_haltrune')
    w.session.choose('c2')
    w.session.choose('c3')
    expect(w.states.get('state.haltrune.camp')).toBe('GARRISON')
    expect(w.streaming.hasFlag('flag.haltrune_camp_decided'), '值域与旗标各说一遍 = 两个真值').toBe(false)
    w.cleanup()
  })
})
