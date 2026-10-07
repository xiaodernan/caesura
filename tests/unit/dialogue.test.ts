import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { registerGameData, dialogues, quests as questTable } from '@/data'
import type { DialogueData, DialogueEffects, DialogueNode } from '@/data/schema'
import { DialogueEngine, conditionPass, type DialogueContext } from '@/quest/Dialogue'
import { WorldStates } from '@/quest/WorldStates'
import { Quests } from '@/quest/Quests'

/**
 * 对话引擎与任务状态机（Phase 6-B / narrative §3、需求 §28/§30）。
 *
 * 这里钉的是**设计承诺**而不是实现细节：
 * - 条件求值只读（打开对话不改世界）；
 * - 任务的推进只有两种来源（旗标 / 对话里的选择），没有计数器；
 * - 分支收敛后不回跳（单调），关系值被夹在 -5..+5；
 * - `once` 节点读档后不重演。
 */

registerGameData()

/** 带可变状态的上下文（大多数用例要"先满足条件再看分支"） */
function liveCtx() {
  const flags = new Set<string>()
  const items = new Map<string, number>()
  const rel = new Map<string, number>()
  const questStates = new Map<string, string>()
  const seen = new Set<string>()
  const quests = new Quests(questTable)
  const worldStates = new WorldStates([])
  const ctx: DialogueContext = {
    hasFlag: (k) => flags.has(k),
    relation: (npc) => rel.get(npc) ?? quests.relation(npc),
    questState: (id) => questStates.get(id) ?? quests.state(id),
    questIndex: (id) => quests.stepIndex(id),
    hasItem: (id, count = 1) => (items.get(id) ?? 0) >= count,
    hasSeen: (d, n) => seen.has(`${d}#${n}`),
    state: (k) => worldStates.get(k),
  }
  return {
    ctx, quests, flags, items, rel, questStates, seen,
    give: (id: string, n = 1) => items.set(id, (items.get(id) ?? 0) + n),
    setFlag: (k: string) => flags.add(k),
    see: (d: string, n: string) => seen.add(`${d}#${n}`),
  }
}

describe('条件求值（§3.1 的四种谓词，全部只读）', () => {
  it('flags 的 all / any / not 各自生效', () => {
    const c = liveCtx()
    c.setFlag('flag.a')
    expect(conditionPass({ flags: { all: ['flag.a'] } }, 'npc', c.ctx)).toBe(true)
    expect(conditionPass({ flags: { all: ['flag.a', 'flag.b'] } }, 'npc', c.ctx)).toBe(false)
    expect(conditionPass({ flags: { any: ['flag.b', 'flag.a'] } }, 'npc', c.ctx)).toBe(true)
    expect(conditionPass({ flags: { not: ['flag.b'] } }, 'npc', c.ctx)).toBe(true)
    expect(conditionPass({ flags: { not: ['flag.a'] } }, 'npc', c.ctx)).toBe(false)
  })

  it('relation 的 gte / lte / eq 与 quest 的 in / gte', () => {
    const c = liveCtx()
    c.rel.set('npc_x', 3)
    expect(conditionPass({ relation: { op: 'gte', value: 2 } }, 'npc_x', c.ctx)).toBe(true)
    expect(conditionPass({ relation: { op: 'gte', value: 4 } }, 'npc_x', c.ctx)).toBe(false)
    expect(conditionPass({ relation: { op: 'lte', value: 3 } }, 'npc_x', c.ctx)).toBe(true)
    expect(conditionPass({ relation: { op: 'eq', value: 3 } }, 'npc_x', c.ctx)).toBe(true)
    c.quests.start('q_bells')
    // gte 需要"第几步"这个信息，而步序只住在任务表里 ⇒ 求值时要把它传进去（不是模块级全局）
    expect(conditionPass({ quest: { id: 'q_bells', in: ['BELLS.STEP1_OPEN'] } }, 'npc_x', c.ctx, c.quests)).toBe(true)
    expect(conditionPass({ quest: { id: 'q_bells', gte: 'BELLS.STEP1_JUDGED' } }, 'npc_x', c.ctx, c.quests)).toBe(false)
    c.quests.advance('q_bells')
    expect(conditionPass({ quest: { id: 'q_bells', gte: 'BELLS.STEP1_JUDGED' } }, 'npc_x', c.ctx, c.quests)).toBe(true)
  })

  it('hasItem 是「知情」的载体：没有那截断舌就不该有"我看了断面"这个选项', () => {
    const c = liveCtx()
    expect(conditionPass({ hasItem: { id: 'it_bell_tongue' } }, 'npc', c.ctx)).toBe(false)
    c.give('it_bell_tongue')
    expect(conditionPass({ hasItem: { id: 'it_bell_tongue' } }, 'npc', c.ctx)).toBe(true)
    expect(conditionPass({ hasItem: { id: 'it_bell_tongue', count: 2 } }, 'npc', c.ctx)).toBe(false)
  })

  it('求值不产生副作用：反复求值不会改任务/关系/旗标', () => {
    const c = liveCtx()
    for (let i = 0; i < 5; i++) conditionPass({ flags: { all: ['flag.a'] }, relation: { op: 'gte', value: 0 } }, 'npc', c.ctx)
    expect(c.flags.size).toBe(0)
    expect(c.quests.state('q_bells')).toBeNull()
    expect(c.quests.relation('npc')).toBe(0)
  })
})

describe('对话引擎：选树 / 退路 / 一次性节点 / 效果产出', () => {
  const engine = () => new DialogueEngine(dialogues, new Quests(questTable))

  it('真实数据自洽：每棵树都能从 root 走到一个结束节点（门禁同款判据的运行时版）', () => {
    for (const t of dialogues) {
      const e = engine()
      const c = liveCtx()
      const res = e.start(t.npc, c.ctx)
      expect(res.view, `${t.id} 应当能开场`).not.toBeNull()
    }
  })

  it('初见与复访是同一棵树的两条入口：条件不满足时退到 fallbackNode', () => {
    const e = engine()
    const tree = dialogues.find((d) => d.id === 'DLG_BELLTONGUE') as DialogueData
    const fresh = liveCtx()
    expect(e.start('npc_belltongue', fresh.ctx).view!.nodeId).toBe('n0')
    const again = liveCtx()
    again.setFlag('flag.belltongue_met')
    expect(e.start('npc_belltongue', again.ctx).view!.nodeId).toBe('n5')
    // 复访的第一道门是**值域三选一**（没走到抉择步就顺着 next 一路退到通用复访节点 n5）
    expect(tree.fallbackNode).toBe('n13')
  })

  it('选项按条件过滤：没有断舌时"我看了断面"那条不可见（其余照旧）', () => {
    const e = engine()
    const tree = dialogues.find((d) => d.id === 'DLG_BELLTONGUE')!
    const c = liveCtx()
    c.setFlag('flag.belltongue_met')
    c.quests.start('q_bells') // 这一条还要求「正处在 step1」：任务没开就不该给这条知情选项
    const noItem = e.start('npc_belltongue', c.ctx).view!
    expect(noItem.choices.map((x) => x.id)).toEqual(['c2', 'c3'])
    c.give('it_bell_tongue')
    const withItem = e.start('npc_belltongue', c.ctx).view!
    expect(withItem.choices.map((x) => x.id)).toEqual(['c1', 'c2', 'c3'])
    void tree
  })

  it('选择产出效果清单（引擎自己不写世界）：引擎只回答"要结算什么"', () => {
    const e = engine()
    const tree = dialogues.find((d) => d.id === 'DLG_BELLTONGUE')!
    const c = liveCtx()
    const start = e.start('npc_belltongue', c.ctx)
    expect(start.effects).toEqual([])
    const res = e.choose(tree, 'n0', 'c1', 'npc_belltongue', c.ctx)
    expect(res.effects).toHaveLength(1)
    expect(res.effects[0].setFlags).toEqual(['flag.belltongue_met'])
    expect(res.effects[0].startQuest).toBe('q_bells')
    // 但**世界没变**：旗标、任务、关系都还停在原处
    expect(c.flags.size).toBe(0)
    expect(c.quests.state('q_bells')).toBeNull()
  })

  it('once 节点被读过就跳过（读档后不重演）', () => {
    const e = engine()
    const c = liveCtx()
    // 科温的档案室那一句是一次性旁白
    const seenCtx = liveCtx()
    seenCtx.see('DLG_CORVIN', 'n4')
    const tree = dialogues.find((d) => d.id === 'DLG_CORVIN')!
    const first = e.start('npc_corvin', c.ctx)
    expect(first.view!.nodeId).toBe('n0')
    const res = e.choose(tree, 'n0', 'c1', 'npc_corvin', c.ctx) // → n1
    expect(res.view!.nodeId).toBe('n1')
    const res2 = e.choose(tree, 'n1', 'c2', 'npc_corvin', c.ctx) // → n4（once）
    expect(res2.view!.nodeId).toBe('n4')
    const res3 = e.choose(tree, 'n1', 'c2', 'npc_corvin', seenCtx.ctx)
    expect(res3.view, '看过的 once 节点后面没有别的了 ⇒ 直接收场').toBeNull()
  })

  it('没有可说话的内容时明确返回 no-tree，而不是给一段空对话', () => {
    const e = engine()
    const c = liveCtx()
    const res = e.start('npc_unknown', c.ctx)
    expect(res.view).toBeNull()
    expect(res.reason).toBe('no-tree')
  })
})

describe('任务状态机（需求 §28：三种推进来源 —— 旗标 / 状态步 / 值域）', () => {
  it('start / advance / 单调：不许回头也不许原地重播', () => {
    const q = new Quests(questTable)
    expect(q.stepIndex('q_bells')).toBe(-1)
    expect(q.start('q_bells')).toBe(true)
    expect(q.start('q_bells'), '已在进行的线不会被打回第一步').toBe(false)
    expect(q.state('q_bells')).toBe('BELLS.STEP1_OPEN')
    expect(q.advance('q_bells')).toBe(true)
    expect(q.state('q_bells')).toBe('BELLS.STEP1_JUDGED')
    expect(q.advance('q_bells', 'BELLS.STEP1_OPEN'), '回跳被拒').toBe(false)
    expect(q.advance('q_bells', 'BELLS.STEP2_OPEN')).toBe(true)
    expect(q.advance('q_bells'), '顺推一步').toBe(true)
    expect(q.state('q_bells')).toBe('BELLS.STEP2_SECOND')
    // 一路推到《哑钟》：这一步是"正在进行"而不是"已完成"
    q.advance('q_bells', 'BELLS.STEP3_OPEN')
    expect(q.state('q_bells')).toBe('BELLS.STEP3_OPEN')
    expect(q.isComplete('q_bells'), '停在这一步 ≠ 做完了').toBe(false)
    // 这一步的 advanceOn（合听解锁降 B）命中 ⇒ 顺推到《哑钟》的拒绝步
    bus.emit('world.flag', { key: 'flag.bell_keymod_found', value: true })
    expect(q.state('q_bells')).toBe('BELLS.STEP3_REFUSED')
    expect(q.isComplete('q_bells')).toBe(false)
    // 拒绝那面旗把线推到**末步**《该不该敲响》——它还不收束：末步等的是一格**值域**，旗标推不动它
    bus.emit('world.flag', { key: 'flag.belltongue_refused', value: true })
    expect(q.state('q_bells')).toBe('BELLS.STEP4_DECIDE')
    expect(q.isComplete('q_bells'), '走到抉择步 ≠ 做完了').toBe(false)
    expect(q.advance('q_bells'), '末步之后没有下一步').toBe(false)
    expect(q.isComplete('q_bells'), '旗标命不中值域那一步').toBe(false)
    // 三选一写下去（值域广播 ⇒ 唯一的写方）才收束；收束不改 state
    bus.emit('world.state', { key: 'state.bells.fourth_dumb', value: 'RUNG' })
    expect(q.isComplete('q_bells')).toBe(true)
    expect(q.state('q_bells'), '收束不改 state').toBe('BELLS.STEP4_DECIDE')
    q.dispose()
  })

  it('旗标驱动的顺推只查**当前这一步**（提前立了三步的旗也不会一次跳完）', () => {
    const q = new Quests(questTable)
    q.start('q_bells')
    bus.emit('world.flag', { key: 'flag.belltongue_told', value: true })
    expect(q.state('q_bells'), 'step1 的旗不是这一步的推进条件').toBe('BELLS.STEP1_OPEN')
    bus.emit('world.flag', { key: 'flag.bell_tongue_examined', value: true })
    expect(q.state('q_bells')).toBe('BELLS.STEP1_JUDGED')
    bus.emit('world.flag', { key: 'flag.belltongue_told', value: true })
    expect(q.state('q_bells'), '这一步的两个分支旗任一命中都算').toBe('BELLS.STEP2_OPEN')
    q.dispose()
  })

  it('顺序补判：先把事情做了再接委托 ⇒ 那几步当场补上（开放世界允许先做后接）', () => {
    const flags = new Set<string>()
    const q = new Quests(questTable, () => {}, (k) => flags.has(k))
    // 玩家先捡到断舌并看懂了断面（旗标早就在了），之后才去找铃姨接委托
    flags.add('flag.bell_tongue_examined')
    q.start('q_bells')
    // 起步那一步的条件已经满足 ⇒ 补判直接落到第二步；第二步的条件没满足就停在那
    expect(q.state('q_bells')).toBe('BELLS.STEP1_JUDGED')

    // 再做一件（说出断面）⇒ 新旗标走 onFlag 那条老路，照常推进
    flags.add('flag.belltongue_told')
    bus.emit('world.flag', { key: 'flag.belltongue_told', value: true })
    expect(q.state('q_bells')).toBe('BELLS.STEP2_OPEN')

    // 连做两步再接（三口钟全修好了才去接委托）⇒ 起步就补到当前该在的位置
    const f2 = new Set(['flag.bell_tongue_examined', 'flag.belltongue_told', 'flag.bell_first_repaired'])
    const q2 = new Quests(questTable, () => {}, (k) => f2.has(k))
    q2.start('q_bells')
    expect(q2.state('q_bells')).toBe('BELLS.STEP2_SECOND')

    // 不注入谓词（老口径）⇒ 不补判：这条差异是**可分辨**的，不是"碰巧一样"
    const q3 = new Quests(questTable)
    q3.start('q_bells')
    expect(q3.state('q_bells')).toBe('BELLS.STEP1_OPEN')
    q.dispose(); q2.dispose(); q3.dispose()
  })

  it('关系值被夹在 -5..+5（越界夹住，不无限长）', () => {
    const q = new Quests(questTable)
    for (let i = 0; i < 10; i++) q.addRelation('npc_belltongue', 2)
    expect(q.relation('npc_belltongue')).toBe(5)
    for (let i = 0; i < 10; i++) q.addRelation('npc_belltongue', -3)
    expect(q.relation('npc_belltongue')).toBe(-5)
  })

  it('快照往返：状态 / 关系 / 已读节点一起回来，且读档只认表里还在的 id', () => {
    const a = new Quests(questTable)
    a.start('q_bells')
    a.advance('q_bells')
    a.addRelation('npc_meg', 2)
    a.markSeen('DLG_MEG', 'n1')
    const snap = a.snapshot()

    const b = new Quests(questTable)
    b.restore(snap)
    expect(b.state('q_bells')).toBe('BELLS.STEP1_JUDGED')
    expect(b.relation('npc_meg')).toBe(2)
    expect(b.hasSeen('DLG_MEG', 'n1')).toBe(true)

    // 数据里删掉的线不该靠老档复活
    const c = new Quests(questTable)
    c.restore({ states: { q_deleted: 'X.Y', q_bells: 'NOT_A_STATE' }, relations: {}, seen: [] })
    expect(c.state('q_bells')).toBeNull()
    expect(c.state('q_deleted')).toBeNull()
  })

  it('推进时广播 quest.changed（UI 与调试面板据此播报，不另存一份任务状态）', () => {
    const q = new Quests(questTable)
    const seen: string[] = []
    const off = bus.on('quest.changed', (p) => seen.push(`${p.questId}:${p.state}`))
    q.start('q_corvin')
    q.advance('q_corvin')
    off()
    expect(seen).toEqual(['q_corvin:CORVIN.STEP1_OPEN', 'q_corvin:CORVIN.STEP2_DELIVER'])
    q.dispose()
  })

  it('isStarted：任务在 start 之前为 false，start 之后为 true', () => {
    const q = new Quests(questTable)
    expect(q.isStarted('q_bells')).toBe(false)
    q.start('q_bells')
    expect(q.isStarted('q_bells')).toBe(true)
    expect(q.isStarted('q_meg'), '别的线没开').toBe(false)
    q.dispose()
  })

  it('settle 末步收束：已立末步旗标时直接跳到末步 ⇒ 当场完成', () => {
    const flags = new Set<string>(['flag.meg_soundscroll_complete'])
    const q = new Quests(questTable, () => {}, (k) => flags.has(k))
    q.start('q_meg')
    expect(q.state('q_meg')).toBe('MEG.STEP1_OPEN')
    q.advance('q_meg', 'MEG.STEP4_CONVERGE')
    expect(q.state('q_meg')).toBe('MEG.STEP4_CONVERGE')
    expect(q.isComplete('q_meg'), '末步落脚且它等的旗已在 ⇒ 当场收束').toBe(true)
    q.dispose()
  })

  it('restore 完成记录：completed 数组里的 id 停在末步 ⇒ 读档后 isComplete=true', () => {
    const c = new Quests(questTable)
    c.restore({ states: { q_meg: 'MEG.STEP4_CONVERGE' }, relations: {}, seen: [], completed: ['q_meg'] })
    expect(c.isComplete('q_meg'), '末步的完成记录随档回来').toBe(true)

    const d = new Quests(questTable)
    d.restore({ states: { q_meg: 'MEG.STEP1_OPEN' }, relations: {}, seen: [], completed: ['q_meg'] })
    expect(d.isComplete('q_meg'), '状态不在末步 ⇒ 老档的完成记录作废').toBe(false)

    const e = new Quests(questTable)
    e.restore({ states: {}, relations: {}, seen: [], completed: ['q_gone'] })
    expect(e.isComplete('q_gone'), '表里没有的线不认完成').toBe(false)
  })

  it('Dialogue.advance 落在终点节点 ⇒ 明确结束（view 空且没有 reason，区别于 no-node）', () => {
    const eng = new DialogueEngine(dialogues, new Quests(questTable))
    const tree = eng.treeById('DLG_MEG')!
    const res = eng.advance(tree, 'n8', 'npc_meg', liveCtx().ctx)
    expect(res.view).toBeNull()
    expect(res.effects).toEqual([])
    expect(res.reason, '终点是正常结束，不是"找不到节点"').toBeUndefined()
  })
})

/* ==================== 批21 分支死角：条件求值的罕见岔路 / 引擎的退路收场 ==================== */

describe('批21 分支死角', () => {
  /**
   * 手造最小树：引擎对树的形状只做最少假设（id/speaker/text），所以单树引擎即可，
   * 不与 dialogues 数据互相干扰（同 npc 多树会被 pick 按 priority 挑走）。
   */
  const n = (id: string, extra: Partial<DialogueNode> = {}): DialogueNode =>
    ({ id, speaker: '试', text: id, ...extra })
  const tree = (nodes: DialogueNode[], rootNode = 'n0'): DialogueData =>
    ({ id: 'DLG_B21', npc: 'npc_b21', rootNode, nodes })
  const solo = (t: DialogueData) => new DialogueEngine([t])

  it('relation 显式点名：条件挂在被点名的 npc 头上，而不是说话人头上（?? 的另一腿）', () => {
    const c = liveCtx()
    c.rel.set('npc_a', 3)
    // 说话人是 npc_b，但读的是 npc_a 的关系值
    expect(conditionPass({ relation: { npc: 'npc_a', op: 'gte', value: 3 } }, 'npc_b', c.ctx)).toBe(true)
    // lte / eq 的**不成立**腿：现有用例只走过成立那一侧
    expect(conditionPass({ relation: { npc: 'npc_a', op: 'lte', value: 2 } }, 'npc_b', c.ctx)).toBe(false)
    expect(conditionPass({ relation: { npc: 'npc_a', op: 'eq', value: 4 } }, 'npc_b', c.ctx)).toBe(false)
  })

  it('quest.gte 的保守闸门：没传 resolver（?? -1）或表里查无此 state（want<0）⇒ 条件一律不成立', () => {
    const c = liveCtx()
    c.quests.start('q_bells')
    // 不传第 4 参 ⇒ 引擎不知道步序，宁可说条件不成立也不瞎猜
    expect(conditionPass({ quest: { id: 'q_bells', gte: 'BELLS.STEP1_OPEN' } }, 'npc', c.ctx)).toBe(false)
    // resolver 明确回答"表里没有这个 state" ⇒ 同样永不成立（数据校验会先报错，这里是运行时兜底）
    expect(conditionPass({ quest: { id: 'q_bells', gte: 'NOT_A_STATE' } }, 'npc', c.ctx, c.quests)).toBe(false)
  })

  it('quest.in 的两条失败腿：任务没开（读数 null）与开着但不在集合里', () => {
    const c = liveCtx()
    expect(conditionPass({ quest: { id: 'q_bells', in: ['BELLS.STEP1_OPEN'] } }, 'npc', c.ctx)).toBe(false)
    c.quests.start('q_bells')
    expect(conditionPass({ quest: { id: 'q_bells', in: ['BELLS.STEP2_OPEN'] } }, 'npc', c.ctx)).toBe(false)
    expect(conditionPass({ quest: { id: 'q_bells', in: ['BELLS.STEP1_OPEN'] } }, 'npc', c.ctx)).toBe(true)
  })

  it('state 条件的 in / notIn：值域读数落在集合外 / 被排除集合里（空登记表 ⇒ 读数是空串）', () => {
    const c = liveCtx()
    expect(conditionPass({ state: { key: 'state.bells.fourth_dumb', in: ['rung'] } }, 'npc', c.ctx)).toBe(false)
    expect(conditionPass({ state: { key: 'state.bells.fourth_dumb', notIn: ['rung'] } }, 'npc', c.ctx)).toBe(true)
    expect(conditionPass({ state: { key: 'state.bells.fourth_dumb', notIn: [''] } }, 'npc', c.ctx)).toBe(false)
  })

  it('查表退路：treeById / node 对不存在的 id 明确回答 null（会话层据此判死，而不是拿到 undefined）', () => {
    const e = new DialogueEngine(dialogues, new Quests(questTable))
    expect(e.treeById('DLG_NOPE')).toBeNull()
    expect(e.node(e.treeById('DLG_MEG')!, 'ghost')).toBeNull()
  })

  it('开局就是死链：rootNode 指向不存在的节点 ⇒ no-node 收场（链接完整性校验会先报错，运行时仍不装死）', () => {
    const t = tree([n('n0')], 'ghost')
    const res = solo(t).start('npc_b21', liveCtx().ctx)
    expect(res.view).toBeNull()
    expect(res.reason).toBe('no-node')
  })

  it('门卫节点条件不过：有 next 就顺过去，没 next 就整场收场（两腿都试）', () => {
    const pass = tree([
      n('gate', { conditions: { flags: { all: ['flag.never'] } }, next: 'real' }),
      n('real'),
    ], 'gate')
    const ok = solo(pass).start('npc_b21', liveCtx().ctx)
    expect(ok.view!.nodeId).toBe('real')
    expect(ok.view!.ended).toBe(true)

    const dead = tree([n('gate', { conditions: { flags: { all: ['flag.never'] } } })], 'gate')
    const no = solo(dead).start('npc_b21', liveCtx().ctx)
    expect(no.view).toBeNull()
    expect(no.reason).toBe('no-node')
  })

  it('emotion 有值就带出去（视图拼装三元的另一腿；现有用例走的都是无 emotion 的节点）', () => {
    const t = tree([n('n0', { emotion: 'grief' })])
    const res = solo(t).start('npc_b21', liveCtx().ctx)
    expect(res.view!.emotion).toBe('grief')
  })

  it('advance 拿着不存在的 nodeId 问路 ⇒ no-node（区别于终点节点的正常收场）', () => {
    const t = tree([n('n0', { next: 'n1' }), n('n1')])
    const res = solo(t).advance(t, 'ghost', 'npc_b21', liveCtx().ctx)
    expect(res.view).toBeNull()
    expect(res.reason).toBe('no-node')
  })

  it('choose 的四条退路：nodeId 不存在 / 节点没有 choices / choiceId 不存在 / 选项条件不过 ⇒ 都收场不炸', () => {
    const t = tree([
      n('bare'),
      n('n0', { choices: [{ id: 'c1', text: '走', style: 'blunt', conditions: { flags: { all: ['flag.never'] } } }] }),
    ])
    const e = solo(t)
    const ctx = liveCtx().ctx
    expect(e.choose(t, 'ghost', 'c1', 'npc_b21', ctx).reason, '节点不存在').toBe('no-node')
    expect(e.choose(t, 'bare', 'c1', 'npc_b21', ctx).reason, '节点压根没有选项列表').toBe('no-node')
    expect(e.choose(t, 'n0', 'nope', 'npc_b21', ctx).reason, '选项 id 不在列表里').toBe('no-node')
    expect(e.choose(t, 'n0', 'c1', 'npc_b21', ctx).reason, '不可见的选项被硬选 ⇒ 条件闸门拦住').toBe('no-node')
  })

  it('选项有效果但没有 next：效果当场交出（sink 收到），对话到此为止（无 effects 的同款收场是另一腿）', () => {
    const sinked: DialogueEffects[] = []
    const withFx = tree([n('n0', { choices: [{ id: 'c1', text: '走', style: 'blunt', effects: { setFlags: ['flag.done'] } }] })])
    const res = solo(withFx).choose(withFx, 'n0', 'c1', 'npc_b21', liveCtx().ctx, (x) => sinked.push(x))
    expect(res.view).toBeNull()
    expect(res.reason, '这是正常收场，不是 no-node').toBeUndefined()
    expect(res.effects).toHaveLength(1)
    expect(sinked, '效果当场交给 sink（没有下一节点可攒）').toHaveLength(1)

    const noFx = tree([n('n0', { choices: [{ id: 'c1', text: '走', style: 'poetic' }] })])
    const res2 = solo(noFx).choose(noFx, 'n0', 'c1', 'npc_b21', liveCtx().ctx)
    expect(res2.view).toBeNull()
    expect(res2.effects).toEqual([])
  })

  it('onEnter 效果当场结算：进节点就 push 进 effects 并交给 sink（数据里暂无 onEnter 节点 ⇒ 手造一棵）', () => {
    const sinked: DialogueEffects[] = []
    const t = tree([n('n0', { effects: { notify: '进门先响一声' }, next: 'n1' }), n('n1')])
    const res = solo(t).start('npc_b21', liveCtx().ctx, (x) => sinked.push(x))
    expect(res.effects).toHaveLength(1)
    expect(sinked, 'onEnter 当场交给 sink').toHaveLength(1)
    // 视图停在 n0 等玩家按一下继续（advanceTo=n1）——但 onEnter 的账在看到画面之前就已经记了
    expect(res.view!.nodeId).toBe('n0')
    expect(res.view!.advanceTo).toBe('n1')
  })

  it('选项效果攒进 carried 走进下一节点：sink 传不传都要对（传 ⇒ 逐条交出；不传 ⇒ 短路，只攒清单）', () => {
    const t = tree([
      n('n0', { choices: [{ id: 'c1', text: '走', style: 'blunt', effects: { setFlags: ['flag.x'] }, next: 'n1' }] }),
      n('n1'),
    ])
    const withSink: DialogueEffects[] = []
    const a = solo(t).choose(t, 'n0', 'c1', 'npc_b21', liveCtx().ctx, (x) => withSink.push(x))
    expect(a.view!.nodeId).toBe('n1')
    expect(withSink, '选项效果在进下一节点那一刻交出').toHaveLength(1)

    const silent = solo(t).choose(t, 'n0', 'c1', 'npc_b21', liveCtx().ctx)
    expect(silent.view!.nodeId).toBe('n1')
    expect(silent.effects, '不传 sink 的读者只收清单，一样不少').toHaveLength(1)
  })

  it('advance 到「按一下继续」的节点 ⇒ 顺着 next 进下一格（终点收场与 ghost 那两腿已有用例）', () => {
    const t = tree([n('n0', { next: 'n1' }), n('n1')])
    const res = solo(t).advance(t, 'n0', 'npc_b21', liveCtx().ctx)
    expect(res.view!.nodeId).toBe('n1')
  })

  it('flags.any 全不立 ⇒ 不成立（现有用例只走过 any 命中一侧）', () => {
    const c = liveCtx()
    expect(conditionPass({ flags: { any: ['flag.x', 'flag.y'] } }, 'npc', c.ctx)).toBe(false)
  })
})
