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
 * 盐歌线步 4《整卷还是散声》（narrative §2.3 步 4 / §7 STATE.MEG，KI-043）。
 *
 * 设计原文的收束是一个**三选一**：「你拿到钥匙就要去把她唱掉，我为什么还要给你？」——
 * 夺（她当夜收摊离城，Hub 环境乐少一个声部）/ 说服（她说出莉安托付的原话）/ 放弃（她留在
 * 休垒，音栓图改由深窖抄本获取，多一段隐藏 Boss 前置线索）。在 n7 只有一个选项之前，这一格
 * 对玩家喊出的只有一种走法；`state.meg.ending` 也没登记——§9 的 Hub 音乐层读者无从落地。
 * 本批把三选一落进 n7（每条都收束任务：声卷事件完结是同一件事，钥匙的**成色**由值域回答），
 * 夺线另有自己的收场句（n16——她走了，n8 那句"休垒还有人唱这首歌"轮不到她说）。
 *
 * 步 1–3 的既有链照走：初见听出休垒（first_fragment）→ 首钟断面（second_fragment）→
 * 未竟厅深处剥出被剪掉的耳语（whisper_extracted，世界侧 `it_unfinishedhall_whisper` 写，
 * 闸门是铃姨步 4 的敲响值域——本测试以 setFlag 代它，那半句的走查挂未竟厅批次）。
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
  const inv = new Inventory('meg')
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

  /** 走到步 3 完成（初见 → 断面 → 剥出耳语），返回能进 n7 三选一的世界 */
  const toStep3 = (): void => {
    session.open('npc_meg')
    session.choose('c1') // 你认识她。
    session.choose('c1') // （听完）……这里。休垒。 —— 步 1 收束 + 任务开
    session.close()
    streaming.setFlag('flag.belltongue_told', true) // 「首钟断面」来自铃姨线（n3.c1 的前置）——那半句的走查挂铃姨批
    session.open('npc_meg')
    session.choose('c1') // 首钟的断面我听过。 —— 步 2 收束
    session.close()
    streaming.setFlag('flag.meg_whisper_extracted', true) // 未竟厅那处交互物写的旗（世界侧，reqState=RUNG 的走查挂别批）
  }

  return { streaming, quests, states, session, views, last, toStep3 }
}

describe('盐歌线步 4《整卷还是散声》：同一件事的三种成色', () => {
  it('耳语没剥出来之前，复访停在引导（n5）；剥出后落进三选一（n7 三条路）', () => {
    const w = makeWorld()
    w.session.open('npc_meg')
    w.session.choose('c1')
    w.session.choose('c1')
    w.session.close()
    w.streaming.setFlag('flag.belltongue_told', true) // 断面的前置（n3.c1）
    w.session.open('npc_meg')
    w.session.choose('c1')
    w.session.close()
    expect(w.quests.state('q_meg'), '两段拼图后线在步 3').toBe('MEG.STEP3_EXTRACT')
    w.session.open('npc_meg')
    expect(w.last().nodeId, '耳语还在回响层里 ⇒ 复访是引导').toBe('n5')
    w.session.close()

    w.streaming.setFlag('flag.meg_whisper_extracted', true)
    w.session.open('npc_meg')
    expect(w.last().nodeId, '剥出后复访：质询与三选一').toBe('n7')
    expect(w.last().choices.map((c) => c.id), '夺 / 说服 / 放弃，三条都在').toEqual(['c1', 'c2', 'c3'])
    w.session.close()
  })

  it('三种写法各写各的值，任务都收束（声卷事件完结是同一件事）', () => {
    for (const [choice, value] of [['c1', 'CONVINCED'], ['c2', 'SILENCED'], ['c3', 'RELINQUISHED']] as const) {
      const w = makeWorld()
      w.toStep3()
      w.session.open('npc_meg')
      w.session.choose(choice)
      expect(w.states.get('state.meg.ending'), `${choice} ⇒ ${value}`).toBe(value)
      expect(w.streaming.hasFlag('flag.meg_soundscroll_complete'), '声卷事件完结，任务收束旗三线同立').toBe(true)
      expect(w.quests.state('q_meg'), '步 4 advanceOn 命中 ⇒ 线完成').toBe('MEG.STEP4_CONVERGE')
      expect(w.quests.isComplete('q_meg')).toBe(true)
      w.session.close()
    }
  })

  it('收场话分线：说服与放弃归 n8（她还在唱），夺线归 n16（她走了，那句话轮不到她说）', () => {
    const w1 = makeWorld()
    w1.toStep3()
    w1.session.open('npc_meg')
    w1.session.choose('c1')
    expect(w1.last().nodeId, '说服 ⇒ n8').toBe('n8')
    w1.session.close()

    const w2 = makeWorld()
    w2.toStep3()
    w2.session.open('npc_meg')
    w2.session.choose('c2')
    expect(w2.last().nodeId, '夺 ⇒ n16（收摊离城的收场）').toBe('n16')
    w2.session.close()

    const w3 = makeWorld()
    w3.toStep3()
    w3.session.open('npc_meg')
    w3.session.choose('c3')
    expect(w3.last().nodeId, '放弃 ⇒ n8（她留在休垒）').toBe('n8')
    w3.session.close()
  })

  it('以物易声的三条腿：哑带死寂与钟壳第七拍各自吃探索成果，殊途同归步 3', () => {
    for (const [flag, choice] of [['flag.deeps_entrance_open', 'c2'], ['flag.ostlara_defeated', 'c3']] as const) {
      const w = makeWorld()
      w.session.open('npc_meg')
      w.session.choose('c1')
      w.session.choose('c1')
      w.session.close()
      // 没去过那里（旗没立）⇒ 那条腿不可见，只有断面（铃姨线）与「还没攒够」
      w.session.open('npc_meg')
      expect(w.last().nodeId).toBe('n3')
      expect(w.last().choices.map((c) => c.id), '没去过 ⇒ 那条素材腿不出现').toEqual(['c1', 'c2'])
      w.session.close()
      w.streaming.setFlag(flag)
      w.session.open('npc_meg')
      expect(w.last().choices.map((c) => c.id), '去过 ⇒ 第三条腿入场').toEqual(['c1', 'c2', 'c3'])
      w.session.choose(choice)
      expect(w.streaming.hasFlag('flag.meg_second_fragment'), '素材不同，账目相同').toBe(true)
      w.session.close()
    }
  })

  it('完成后复访落在 n10；INTACT 缺省意味着"没走到这个抉择"，不是第四种结局', () => {
    const w = makeWorld()
    w.toStep3()
    w.session.open('npc_meg')
    w.session.choose('c1')
    w.session.close()
    w.session.open('npc_meg')
    expect(w.last().nodeId, '声卷归位后的复访').toBe('n10')
    w.session.close()
    const fresh = makeWorld()
    expect(fresh.states.get('state.meg.ending')).toBe('INTACT')
  })
})
