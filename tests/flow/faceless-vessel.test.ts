import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { registerGameData, regions, dialogues, quests as questTable, worldstate, worldStates as stateTable } from '@/data'
import { StreamingSystem } from '@/world/Streaming'
import { Interactables } from '@/world/Interactables'
import { Quests } from '@/quest/Quests'
import { WorldStates } from '@/quest/WorldStates'
import { WorldState } from '@/quest/WorldState'
import { DialogueEngine, type DialogueContext, type DialogueView } from '@/quest/Dialogue'
import { DialogueSession } from '@/quest/Settlement'
import { Inventory } from '@/rpg/Inventory'

/**
 * 无面童线步 3《容器》（narrative §2.5 / §4.8 初句圣所线索链，KI-043）。
 *
 * 在这一批之前，`q_faceless` 的步 3 收束旗 `flag.faceless_clue_ring_complete` **零写方**：
 * 对话树 n7–n9 画了五环（初句/誓/响/尘/归）、n10 备好了归属四选一（VESSEL/CHILD/CHOSEN/LOST
 * 各写自己的 `state.faceless.identity`）、任务步 4 的 `advanceOn.state` 也等着——但世界里
 * 没有任何一处能把那面旗立起来，线永远卡在步 2（可达性断裂，KI-041 同族）。
 *
 * 本批把「亲手把它们按顺序点亮」（n8 的原文）落成世界侧的环链，全链从生产入口进：
 * 四环线索（interactUsed 规则）⇒ 井底门开 ⇒ 誓→响→尘→归 四点**链式点亮**（后一环 require
 * 前一环的旗——「按顺序」不是口号）⇒ 归环写下收束旗 ⇒ 复访无面童走 n10 四选一 ⇒ 步 4 收束。
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
  const inv = new Inventory('faceless')
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
  const interact = new Interactables(regions, () => true)
  const last = (): DialogueView => views[views.length - 1]
  alive.push(() => { session.close(); worldState.dispose(); states.dispose(); quests.dispose(); interact.dispose(); streaming.dispose() })

  /** 走到步 2 完成（初见 → 应答），返回能进 n7 五环指引的世界。
   *  初见两条路都 startQuest ⇒ 任务在对话里开；步 2 的收束旗由对话腿写（前批已落）。 */
  const toStep2 = (): void => {
    session.open('npc_faceless')
    session.choose('c1') // ……你怎么会知道这个词？
    session.choose('c1') // 跟我走。（startQuest + faceless_met + first_writing）
    session.close()
    streaming.setFlag('flag.faceless_answered', true)
  }

  /** 把一条线索环交互物按下去（走 Interactables.use 生产入口） */
  const use = (id: string): { ok: boolean; state: string; text: string } => {
    const it = interact.all.find((x) => x.id === id)!
    const r = interact.use(id, { ...it.pos })
    return { ok: r.ok, state: r.state, text: r.text }
  }

  /** 观察波前那一次轻触（KI-338 的生产入口）：不在 `observeOnly` 名册上的东西返回 null */
  const observe = (id: string) => interact.observeTouch(id)

  /** 四环线索（§4.8 ①–④）挨个研读——门前的证据 */
  const gatherClues = (): void => {
    use('in_fellcarillon_reverse_score')
    use('in_resthold_dome_reflection')
    use('in_drownedchoir_d5_scratch')
    use('in_deeps_lean_corpses')
  }

  return { streaming, quests, states, session, interact, views, last, use, observe, gatherClues, toStep2 }
}

describe('无面童线步 3《容器》：五环要亲手按顺序点亮', () => {
  it('四环线索不全 ⇒ 两条通道都锁着；集齐 ⇒ 只有波前轻触才开门（E 推不开）', () => {
    const w = makeWorld()
    expect(w.use('ga_deeps_firstphrase_door').state, '证据不全，井底的门不该开').toBe('locked')
    expect(w.observe('ga_deeps_firstphrase_door')!.state, '波前也不能跳过证据').toBe('locked')
    w.use('in_fellcarillon_reverse_score')
    w.use('in_resthold_dome_reflection')
    w.use('in_drownedchoir_d5_scratch')
    expect(w.use('ga_deeps_firstphrase_door').state, '还差深窖那一环').toBe('locked')
    w.use('in_deeps_lean_corpses')
    const e = w.use('ga_deeps_firstphrase_door')
    expect(e.ok, 'E 键不是这把门的动词：任何闻者推门即塌').toBe(false)
    expect(e.text, '锁文要说清它在等什么').toContain('休止')
    expect(w.streaming.hasFlag('flag.firstphrase_open'), '推那一下不该立旗').toBe(false)
    const r = w.observe('ga_deeps_firstphrase_door')!
    expect(r.ok, '四环齐 + 波前轻触 ⇒ 门开').toBe(true)
    expect(w.streaming.hasFlag('flag.firstphrase_open'), '门开后圣所在世界里有记录').toBe(true)
  })

  it('环链必须按顺序点亮：跳环是 locked，乱序点不动；归环点亮 ⇒ 步 3 收束旗立、任务推进', () => {
    const w = makeWorld()
    w.toStep2() // 先接下线（真实流程：初见在先）——answered 旗把任务顺推到《容器》段
    w.gatherClues()
    w.observe('ga_deeps_firstphrase_door')
    expect(w.use('in_firstphrase_ring_echo').state, '没点过誓，响不许亮').toBe('locked')
    expect(w.use('in_firstphrase_ring_oath').ok, '誓是大门楣，门开后第一个亮').toBe(true)
    expect(w.use('in_firstphrase_ring_dust').state, '跳过响直接摸尘 ⇒ 锁').toBe('locked')
    expect(w.use('in_firstphrase_ring_echo').ok, '誓后点响').toBe(true)
    expect(w.use('in_firstphrase_ring_dust').ok, '响后点尘').toBe(true)
    expect(w.quests.state('q_faceless'), 'answered 旗已让 settle 顺推到《容器》：归还没点，线不收束').toBe('FACELESS.STEP3_VESSEL')
    expect(w.use('in_firstphrase_ring_home').ok, '尘后点归——五环全亮').toBe(true)
    expect(w.streaming.hasFlag('flag.faceless_clue_ring_complete'), '收束旗由世界侧写下（此前零写方）').toBe(true)
    expect(w.quests.state('q_faceless'), '旗是步 3 的 advanceOn ⇒ 顺推停在终步（identity 还没写）').toBe('FACELESS.STEP4_IDENTITY')
    expect(w.quests.isComplete('q_faceless'), '归属没写 ⇒ 线未完成').toBe(false)
  })

  it('归属四选一：各写各的 identity、任务收束；写了之后 n10 不再来（identity_written 闸门）', () => {
    for (const [choice, value] of [['c1', 'VESSEL'], ['c2', 'CHILD'], ['c3', 'CHOSEN'], ['c4', 'LOST']] as const) {
      const w = makeWorld()
      w.toStep2()
      w.gatherClues()
      w.observe('ga_deeps_firstphrase_door')
      w.use('in_firstphrase_ring_oath')
      w.use('in_firstphrase_ring_echo')
      w.use('in_firstphrase_ring_dust')
      w.use('in_firstphrase_ring_home')
      w.session.open('npc_faceless')
      expect(w.last().nodeId, '五环全亮后复访：它蹲在缝隙边等你落笔').toBe('n10')
      w.session.choose(choice)
      expect(w.states.get('state.faceless.identity')).toBe(value)
      expect(w.quests.state('q_faceless'), 'identity 是步 4 的 advanceOn ⇒ 线收束').toBe('FACELESS.STEP4_IDENTITY')
      expect(w.quests.isComplete('q_faceless'), '步 4 的 advanceOn 命中 ⇒ isComplete 为真').toBe(true)
      w.session.close()
      w.session.open('npc_faceless')
      expect(w.last().nodeId, '写完归属再复访：n10 不该再来（identity_written 已立）').not.toBe('n10')
    }
  })

  it('没走到圣所的玩家复访：仍是五环指引（n7/n8），不被跳进结局', () => {
    const w = makeWorld()
    w.toStep2()
    w.session.open('npc_faceless')
    // settled 顺推后步 3 已开（answered 旗同时是步 2 的收束）——n7/n8 的 quest 闸门过去了，
    // 复访落在 n9（五环全亮前的指引，不问任务步）。
    expect(w.last().nodeId, '没走到圣所的玩家复访：仍是五环指引（n7 的 quest 闸是 gte，顺推后的步 3 也落在它）').toBe('n7')
    w.session.close()
    expect(w.quests.state('q_faceless')).toBe('FACELESS.STEP3_VESSEL')
    expect(w.quests.isComplete('q_faceless'), '步 3 没收束 ⇒ 线未完成').toBe(false)
  })
})

/**
 * KI-338：观察波前那条动词通道本身（不是那把门的故事，是"用哪只手碰它"这一格）。
 * 三条腿各自钉一件事：E 拒收 / 普通交互物不归它管 / 成功那一句读的是数据里的 notify。
 */
describe('观察波前那一次轻触（KI-338）', () => {
  it('E 推不开 observeOnly 的门；波前轻触才立旗，且 HUD 念的是数据里那句', () => {
    const w = makeWorld()
    w.gatherClues()
    const notes: string[] = []
    const off = bus.on('ui.notify', (p) => notes.push(p.text))
    const e = w.use('ga_deeps_firstphrase_door')
    expect(e.ok).toBe(false)
    expect(e.state).toBe('locked')
    expect(w.streaming.hasFlag('flag.firstphrase_open')).toBe(false)
    const r = w.observe('ga_deeps_firstphrase_door')!
    expect(r.ok).toBe(true)
    expect(r.text, '数据里那三处 notify 从此有读者，不再走按 kind 的通用句').toContain('与世隔绝的耳朵')
    expect(notes).toContain('门开了一道缝 —— 里面是世上唯一与世隔绝的耳朵')
    expect(w.observe('ga_deeps_firstphrase_door'), '开过之后不再报一次：它已经不在待办名册上').toBeNull()
    off()
  })

  it('普通交互物不归这条动词管：observeTouch 返回 null，E 照旧', () => {
    const w = makeWorld()
    w.gatherClues()
    w.observe('ga_deeps_firstphrase_door')
    expect(w.observe('in_firstphrase_ring_oath'), '不是 observeOnly 的东西不认这条通道').toBeNull()
    expect(w.use('in_firstphrase_ring_oath').ok, '它的动词仍是 E').toBe(true)
  })

  it('一批标记只挑出归这条动词管的那几件（observeTouches）', () => {
    const w = makeWorld()
    w.gatherClues()
    expect(w.interact.observeTouches(['in_firstphrase_ring_oath', 'in_firstphrase_ring_echo']), '普通交互物一件都不进结果').toEqual([])
    const rs = w.interact.observeTouches(['in_firstphrase_ring_oath', 'ga_deeps_firstphrase_door'])
    expect(rs.length, '只有那扇门归这条动词管').toBe(1)
    expect(rs[0].id).toBe('ga_deeps_firstphrase_door')
    expect(rs[0].ok).toBe(true)
  })

  it('缺证据时波前也只说"还差哪几件"，不拿风味文案盖住前置', () => {
    const w = makeWorld()
    const r = w.observe('ga_deeps_firstphrase_door')!
    expect(r.state).toBe('locked')
    expect(r.text).toContain('flag.clue_')
  })
})
