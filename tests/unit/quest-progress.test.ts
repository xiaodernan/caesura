import { bus } from '@/core/EventBus'
import { describe, expect, it } from 'vitest'
import type { DialogueEffects, QuestData } from '@/data/schema'
import type { DialogueContext, DialogueEngine, DialogueView } from '@/quest/Dialogue'
import { Quests, type QuestEvent } from '@/quest/Quests'
import { DialogueSession, type DialogueDeps, type DialogueInv } from '@/quest/Settlement'

/**
 * 任务状态机与对话结算胶水的分支死角（批 14）。happy path 已由 flow/（bells、dialogue、haltrune）
 * 与 unit/dialogue.test.ts 盖住，这里只补它们的拒收腿、缺省腿与去重闸：
 * - Quests：手造 QuestData[] 直接喂构造器（不经 registry），旗标/顺推/补判/restore 的每条腿单独点名；
 * - Settlement：假引擎桩（DialogueDeps 是接口，桩掉 pick/start/choose/advance/treeById 五个读数就够），
 *   applyEffects 是公开方法，可以不经过对话流程直接钉效果清单的语义。
 */

/** 手造一条任务线：steps 给 [state, advanceOn.flags?]，其余字段给无害占位 */
const qdef = (id: string, steps: Array<{ state: string; flags?: string[] }>): QuestData => ({
  id, nameKey: `quest.${id}`, displayName: id, npc: 'npc_test', outcome: '',
  steps: steps.map((s) => ({
    state: s.state, label: `${id}·${s.state}`,
    ...(s.flags ? { advanceOn: { flags: s.flags } } : {}),
  })),
})

/** 带事件.spy 的账本：onEvent 收一份，断言「播了几条」用 */
const book = (data: QuestData[], hasFlag: (k: string) => boolean = () => false) => {
  const events: QuestEvent[] = []
  const q = new Quests(data, (e) => events.push(e), hasFlag)
  return { q, events }
}

describe('任务状态机的旗标驱动（world.flag 是唯一世界旗源）', () => {
  it('旗标的三种真形都能顺推（true / 1 / \'true\'），置假不顺推（65）', () => {
    const { q, events } = book([
      qdef('q_forms', [
        { state: 'S0', flags: ['flag.numeric'] },
        { state: 'S1', flags: ['flag.str'] },
        { state: 'S2' },
      ]),
    ])
    q.start('q_forms')
    expect(q.state('q_forms')).toBe('S0')
    bus.emit('world.flag', { key: 'flag.numeric', value: 1 })
    expect(q.state('q_forms')).toBe('S1')
    bus.emit('world.flag', { key: 'flag.str', value: 'true' })
    expect(q.state('q_forms')).toBe('S2')
    bus.emit('world.flag', { key: 'flag.noise', value: false })
    bus.emit('world.flag', { key: 'flag.str', value: '' })
    expect(q.state('q_forms'), '置假与空串都不动状态').toBe('S2')
    expect(events.length, 'start + 两次顺推，噪声旗不产生事件').toBe(3)
  })

  it('末步的 advanceOn 命中 = 收束一次；同一面旗再响不重播（182）', () => {
    const { q, events } = book([qdef('q_end', [{ state: 'FIN', flags: ['flag.finish'] }])])
    q.start('q_end')
    expect(q.isComplete('q_end'), '停在末步不等于做完').toBe(false)
    bus.emit('world.flag', { key: 'flag.finish', value: true })
    expect(q.isComplete('q_end')).toBe(true)
    expect(q.state('q_end'), '收束不改状态').toBe('FIN')
    bus.emit('world.flag', { key: 'flag.finish', value: true })
    expect(events.length, 'start + 收束，重复旗标被去重闸挡住').toBe(2)
  })
})

describe('任务状态机的 start/advance 拒收腿', () => {
  it('start：认不出的线与空线都开不了（116）；advance：认不出的线开不了（124）', () => {
    const { q } = book([
      qdef('q_ok', [{ state: 'A' }, { state: 'B' }]),
      qdef('q_empty', []),
    ])
    expect(q.start('q_nobody')).toBe(false)
    expect(q.start('q_empty'), '零步的线没有第一步可落').toBe(false)
    expect(q.isStarted('q_nobody')).toBe(false)
    expect(q.advance('q_nobody')).toBe(false)
    expect(q.state('q_nobody')).toBeNull()
  })

  it('advance：跳到不存在的步是拒收（128）；未开始顺推=接委托（133 真腿），已开始顺推=走下一步（133 假腿）', () => {
    const { q } = book([qdef('q_ok', [{ state: 'A' }, { state: 'B' }])])
    expect(q.advance('q_ok', 'Z')).toBe(false)
    expect(q.advance('q_ok'), '还没接的线顺推一步 = start').toBe(true)
    expect(q.state('q_ok')).toBe('A')
    expect(q.advance('q_ok'), '已开始：不带 to 就是顺推一步').toBe(true)
    expect(q.state('q_ok')).toBe('B')
    expect(q.advance('q_ok', 'A'), '单调：回头不行').toBe(false)
    expect(q.state('q_ok')).toBe('B')
  })

  it('stepIndexOf：认不出的线给 -1（90）', () => {
    const { q } = book([qdef('q_ok', [{ state: 'A' }])])
    expect(q.stepIndexOf('q_nobody', 'A')).toBe(-1)
    expect(q.stepIndexOf('q_ok', 'A')).toBe(0)
  })
})

describe('顺序补判：落步时问「条件是不是早就满足了」', () => {
  it('每一步的旗都早立好了 ⇒ 一路走到底并收束（200 假腿 / 202 假腿 / 204）', () => {
    const { q, events } = book(
      [qdef('q_chain', [
        { state: 'A', flags: ['flag.c1'] },
        { state: 'B', flags: ['flag.c2'] },
        { state: 'C', flags: ['flag.c3'] },
      ])],
      () => true,
    )
    q.start('q_chain')
    expect(q.state('q_chain')).toBe('C')
    expect(q.isComplete('q_chain')).toBe(true)
    expect(events.length, '三步各一条 + 末步收束补一条').toBe(4)
  })

  it('条件只在半路满足 ⇒ 走一步就停，把下一步留给世界（200 真腿）', () => {
    const { q, events } = book(
      [qdef('q_stop', [{ state: 'A', flags: ['flag.s1'] }, { state: 'B', flags: ['flag.s2'] }])],
      (k) => k === 'flag.s1',
    )
    q.start('q_stop')
    expect(q.state('q_stop')).toBe('B')
    expect(q.isComplete('q_stop')).toBe(false)
    expect(events.length).toBe(2)
  })
})

describe('restore：只认现在还在表里的东西，缺省字段各自走各自的空闸', () => {
  it('restore(null) 回到全空（247）；restore({}) 三份缺省一次全亮（249/253/256）', () => {
    const { q } = book([qdef('q_r', [{ state: 'A' }, { state: 'B' }])])
    q.start('q_r')
    q.restore(null)
    expect(q.snapshot()).toEqual({ states: {}, relations: {}, seen: [], completed: [] })
    q.restore({})
    expect(q.snapshot()).toEqual({ states: {}, relations: {}, seen: [], completed: [] })
  })

  it('脏档四闸：认不出的线/步丢弃、关系值夹住且非数丢弃、完成记录要停在末步（251/254/260）', () => {
    const { q } = book([
      qdef('q_r', [{ state: 'A' }, { state: 'B' }]),
      qdef('q_empty', []),
    ])
    q.restore({
      states: { q_r: 'B', q_nobody: 'A', q_empty: 'A' }, // 一条合法、一条线没了、一条没有步可对
      relations: { npc_a: 3, npc_b: 99, npc_c: Number.NaN, npc_d: 'x' as unknown as number },
      seen: ['d#n'],
      completed: ['q_r', 'q_nobody'],
    })
    expect(q.state('q_r')).toBe('B')
    expect(q.state('q_nobody')).toBeNull()
    expect(q.state('q_empty'), '没有步可对的线不认').toBeNull()
    expect(q.relation('npc_a')).toBe(3)
    expect(q.relation('npc_b'), '越界夹住不炸档').toBe(5)
    expect(q.relation('npc_c'), 'NaN 丢弃').toBe(0)
    expect(q.relation('npc_d'), '非数丢弃').toBe(0)
    expect(q.hasSeen('d', 'n')).toBe(true)
    expect(q.isComplete('q_r'), '确实停在末步的完成记录认下').toBe(true)
    expect(q.isComplete('q_nobody')).toBe(false)
  })
})

/* ------------------------------ Settlement：对话的结算胶水 ------------------------------ */

const vid = (nodeId: string): DialogueView => ({ dialogueId: 'dlg_s', nodeId }) as unknown as DialogueView
const NORES = { view: null, effects: [] as DialogueEffects[] }

/** 假引擎桩：script 按键供答案；treeGone 只影响 treeById，noNpc 让 pick 认不出 npc */
const harness = (
  script: Record<string, { view: DialogueView | null; effects: DialogueEffects[] }> = {},
  treeGone = false,
  noNpc = false,
) => {
  const calls = {
    present: [] as (DialogueView | null)[],
    paused: [] as boolean[],
    notify: [] as string[],
    flags: {} as Record<string, boolean>,
    states: [] as Array<[string, string]>,
    refresh: 0,
  }
  const inv = new Map<string, number>()
  const deps: DialogueDeps = {
    quests: new Quests([]),
    engine: {
      pick: () => (noNpc ? null : { id: 'dlg_s' }),
      start: () => script.start ?? NORES,
      choose: (_t: unknown, _n: unknown, id: string) => script[id] ?? NORES,
      advance: () => script.advance ?? NORES,
      treeById: () => (treeGone ? null : { id: 'dlg_s' }),
    } as unknown as DialogueEngine,
    ctx: {} as DialogueContext,
    inv: {
      add: (id, n = 1) => { inv.set(id, (inv.get(id) ?? 0) + n); return inv.get(id) ?? 0 },
      remove: (id, n = 1) => { inv.set(id, (inv.get(id) ?? 0) - n); return true },
      count: (id) => inv.get(id) ?? 0,
    } as DialogueInv,
    setFlag: (k, v) => { calls.flags[k] = v },
    setState: (k, v) => { calls.states.push([k, v]) },
    notify: (t) => { calls.notify.push(t) },
    refresh: () => { calls.refresh++ },
    setPaused: (p) => { calls.paused.push(p) },
    present: (v) => { calls.present.push(v) },
  }
  return { session: new DialogueSession(deps), calls, inv, quests: deps.quests }
}

describe('DialogueSession：开讲的门与树消失后的沉默', () => {
  it('open：无可说的话返回 false（53），开场没视图也返回 false；成功则停摆世界并递出视图', () => {
    const h1 = harness({ start: { view: vid('n1'), effects: [] } })
    expect(h1.session.open('npc_x')).toBe(true)
    expect(h1.session.isTalking).toBe(true)
    expect(h1.session.npcId).toBe('npc_x')
    expect(h1.calls.paused).toEqual([true])
    expect(h1.calls.present.length).toBe(1)

    const h2 = harness({}, false, true) // pick 认不出这个 npc
    expect(h2.session.open('npc_x')).toBe(false)
    expect(h2.session.isTalking).toBe(false)

    const h3 = harness() // start 返回空视图
    expect(h3.session.open('npc_x')).toBe(false)
    expect(h3.session.npcId).toBeNull()
    expect(h3.calls.paused, '没开成讲就别冻结世界').toEqual([])
  })

  it('choose/advance：没在对话中是空操作（62/70）；对话中但树没了也沉默（64/72）', () => {
    const h2 = harness()
    h2.session.choose('c1')
    h2.session.advance()
    expect(h2.calls.present.length, '没开讲就点选项：什么都不该发生').toBe(0)

    const h1 = harness({ start: { view: vid('n1'), effects: [] } }, true)
    expect(h1.session.open('npc_x')).toBe(true)
    const n = h1.calls.present.length
    h1.session.choose('c1')
    h1.session.advance()
    expect(h1.calls.present.length, '树没了：不再推进视图，也不崩').toBe(n)
    expect(h1.session.isTalking).toBe(true)
  })

  it('choose 走到空视图 = 收摊：present(null)、解冻、isTalking 翻回 false', () => {
    const h = harness({ start: { view: vid('n1'), effects: [] }, bye: NORES })
    h.session.open('npc_x')
    h.session.choose('bye')
    expect(h.session.isTalking).toBe(false)
    expect(h.calls.paused).toEqual([true, false])
    expect(h.calls.present, '先递视图、再递 null 收屏').toEqual([expect.anything(), null])
  })

  it('advance：树在且引擎有答案 ⇒ 视图推进到下一节点（72 的放行腿）', () => {
    const h = harness({ start: { view: vid('n1'), effects: [] }, advance: { view: vid('n2'), effects: [] } })
    h.session.open('npc_x')
    h.session.advance()
    expect(h.session.isTalking).toBe(true)
    expect(h.calls.present.length).toBe(2)
    expect(h.calls.present[1]).toEqual(vid('n2'))
  })
})

describe('applyEffects：效果清单按语义顺序落进既有通道', () => {
  it('九种字段全给：任务/旗标/值域/物品/播报各走各的通道，最后统一 refresh 一次', () => {
    const h = harness()
    h.session.applyEffects([{
      startQuest: 'q_x',
      advanceQuest: { id: 'q_x', to: 'S1' },
      setRelation: { delta: 2 }, // 不写 npc：回落到对话对象（114 的 ?? npc 腿）
      setFlags: ['flag.a'],
      clearFlags: ['flag.b'],
      setState: { key: 'state.k', value: 'V' },
      giveItem: { id: 'it_x', count: 2 },
      takeItem: { id: 'it_y' },
      notify: '收下了',
    }, { giveItem: { id: 'it_z' } }], 'npc_x')
    expect(h.calls.refresh, '改过世界才 refresh').toBe(1)
    expect(h.calls.flags).toEqual({ 'flag.a': true, 'flag.b': false })
    expect(h.calls.states).toEqual([['state.k', 'V']])
    expect(h.inv.get('it_x')).toBe(2)
    expect(h.inv.get('it_z'), 'giveItem 没写 count 按 1 给（120 的 ?? 1 腿）').toBe(1)
    expect(h.inv.get('it_y'), 'takeItem 没写 count 按 1 拿').toBe(-1)
    expect(h.calls.notify).toEqual(['收下了'])
    expect(h.quests.relation('npc_x'), 'setRelation 没写 npc 时用对话对象').toBe(2)
  })

  it('空效果对象：一个字段都不碰，touched 不翻、不 refresh（113-122 的假腿）', () => {
    const h = harness()
    h.session.applyEffects([{} as DialogueEffects], 'npc_y')
    expect(h.calls.refresh).toBe(0)
    expect(h.calls.flags).toEqual({})
    expect(h.calls.states).toEqual([])
    expect(h.calls.notify).toEqual([])
  })
})
