import { afterEach, describe, expect, it } from 'vitest'
import { registerGameData, regions, dialogues, quests as questTable, worldstate, worldStates as stateTable } from '@/data'
import { StreamingSystem } from '@/world/Streaming'
import { Quests } from '@/quest/Quests'
import { WorldStates } from '@/quest/WorldStates'
import { WorldState } from '@/quest/WorldState'
import { DialogueEngine, type DialogueContext, type DialogueView } from '@/quest/Dialogue'
import { DialogueSession } from '@/quest/Settlement'
import { Inventory } from '@/rpg/Inventory'

/**
 * 无面童线的失败分支（narrative §2.5：「若玩家在铃姨质问步反复撒谎、或在科温"共谋"线后
 * 抱它去看振源核嵌甲——它开始不写字，只写同一个音符。STATE.FACELESS = LOST」）。
 *
 * 两个设计事实在数据里的落法：
 *  · **谎是一次事件**——n4 质询的「是孩子」就是那枚谎（它当场写「他骗你」，设计原句）；
 *    本批之前这一条只加好感不加旗，它被骗了还被哄开心。
 *  · **LOST 有两个入口、一个节点**——《同一个音符》（n17）：撒过谎的人复访时它只写同一个
 *    音符；共谋线（state.corvin.schism = COLLUDED）在那儿开着「带它去看嵌甲」的口，抱去
 *    = 写 LOST；陪它坐 = 还有救（设计写的是"开始不写字"这个进行中状态，不是终审判决）。
 * LOST 写进 identity 值域后任务照常收束（advanceOn 的四值里本来就有它），终局三手牌减二手
 * 的读数留给终幕批。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld() {
  registerGameData()
  const streaming = new StreamingSystem(regions)
  const quests = new Quests(questTable, () => {}, (k) => streaming.hasFlag(k))
  const states = new WorldStates(stateTable)
  const worldState = new WorldState(worldstate, {
    hasFlag: (k) => streaming.hasFlag(k),
    setFlag: (k) => streaming.setFlag(k, true)
  })
  const engine = new DialogueEngine(dialogues, quests)
  const inv = new Inventory('faceless-lost')
  const ctx: DialogueContext = {
    hasFlag: (k) => streaming.hasFlag(k),
    relation: (npc) => quests.relation(npc),
    questState: (id) => quests.state(id),
    questIndex: (id) => quests.stepIndex(id),
    hasItem: (id, count = 1) => inv.count(id) >= count,
    hasSeen: (d, n) => quests.hasSeen(d, n),
    state: (k) => states.get(k)
  }
  const views: DialogueView[] = []
  const session = new DialogueSession({
    quests, engine, ctx, inv,
    setFlag: (k, v) => streaming.setFlag(k, v),
    setState: (k, v) => states.set(k, v),
    notify: () => {},
    refresh: () => {},
    setPaused: () => {},
    present: (v) => { if (v) views.push(v) }
  })
  const last = (): DialogueView => views[views.length - 1]
  alive.push(() => { session.close(); worldState.dispose(); states.dispose(); quests.dispose(); streaming.dispose() })

  /** 走到步 2 的质询（初见 + 任一口钟修过），返回能答「是孩子/是耳朵」的世界 */
  const toQuestion = (): void => {
    session.open('npc_faceless')
    session.choose('c1')
    session.choose('c1')
    session.close()
    streaming.setFlag('flag.bell_first_repaired', true)
  }

  return { streaming, quests, states, session, views, last, toQuestion }
}

describe('无面童的失败分支：谎是一次事件，LOST 有两个入口', () => {
  it('「是孩子」是谎：它当场写「他骗你」，旗立、任务照常推进到步 2 完成', () => {
    const w = makeWorld()
    w.toQuestion()
    w.session.open('npc_faceless')
    expect(w.last().nodeId).toBe('n4')
    w.session.choose('c1') // 是孩子。（谎）
    expect(w.streaming.hasFlag('flag.faceless_lied'), '谎事件立旗（此前这一条只加好感）').toBe(true)
    expect(w.streaming.hasFlag('flag.faceless_answered')).toBe(true)
    expect(w.quests.state('q_faceless'), '谎不影响任务机的线性推进').toBe('FACELESS.STEP3_VESSEL')
    w.session.close()
  })

  it('说实话（是耳朵）不立谎旗——失败分支不误伤诚实的人', () => {
    const w = makeWorld()
    w.toQuestion()
    w.session.open('npc_faceless')
    w.session.choose('c3') // 是耳朵。（实话）
    expect(w.streaming.hasFlag('flag.faceless_lied')).toBe(false)
    expect(w.streaming.hasFlag('flag.faceless_told_it_is_an_ear')).toBe(true)
    w.session.close()
  })

  it('撒过谎的复访落进《同一个音符》（n17）；非共谋只有陪伴一条路（还有救）', () => {
    const w = makeWorld()
    w.toQuestion()
    w.session.open('npc_faceless')
    w.session.choose('c1') // 谎
    w.session.close()
    w.session.open('npc_faceless')
    expect(w.last().nodeId, '谎后复访：它只写同一个音符').toBe('n17')
    expect(w.last().choices.map((c) => c.id), '共谋没定性 ⇒ 没有「带它看嵌甲」的口').toEqual(['c2'])
    w.session.choose('c2') // 陪它坐
    expect(w.states.get('state.faceless.identity'), '陪伴不写 LOST').toBe('INTACT')
    w.session.close()
  })

  it('共谋 + 谎后抱它去看嵌甲 ⇒ LOST 写入、任务收束、收场句 n14', () => {
    const w = makeWorld()
    w.toQuestion()
    w.session.open('npc_faceless')
    w.session.choose('c1') // 谎
    w.session.close()
    w.states.set('state.corvin.schism', 'COLLUDED') // 科温线的共谋定性（那半句的走查挂科温批）
    w.session.open('npc_faceless')
    expect(w.last().nodeId).toBe('n17')
    expect(w.last().choices.map((c) => c.id), '共谋 ⇒ 嵌甲的口开了').toEqual(['c1', 'c2'])
    w.session.choose('c1') // 带它去未竟厅
    expect(w.states.get('state.faceless.identity')).toBe('LOST')
    // 失败分支可以发生在任务进行中：线没走到步 4 的 advanceOn ⇒ 任务簿停在原地（不撒谎），
    // 但世界的读数已经是 LOST——终局三手牌减二手看的是值域，不是任务簿。
    expect(w.states.get('state.faceless.identity')).toBe('LOST')
    expect(w.quests.state('q_faceless')).toBe('FACELESS.STEP3_VESSEL')
    expect(w.quests.isComplete('q_faceless'), '线没走完不算完成——世界记住了失败，任务簿不装').toBe(false)
    expect(w.last().nodeId, '收场句是 n14（它把「失」写在灰上，把灰全撒了）').toBe('n14')
    w.session.close()
  })

  it('没撒过谎的复访不落 n17（neutral n15），失败分支不追杀清白玩家', () => {
    const w = makeWorld()
    w.toQuestion()
    w.session.choose('c2') // ……我不知道。（不算谎——设计给的三选一里它是诚实的中立）
    w.session.open('npc_faceless')
    expect(w.last().nodeId).not.toBe('n17')
    w.session.close()
  })
})
