import type { DialogueChoice, DialogueCondition, DialogueData, DialogueEffects, DialogueNode } from '@/data/schema'

/**
 * 对话引擎（Phase 6-B / narrative.md §3）。**纯函数式**：给它一棵树 + 一个只读上下文，
 * 它回答"现在能看见哪个节点、有哪几个选项、这一步要结算哪些效果"。
 *
 * 三条设计事实：
 * 1. **引擎不写世界**。它只产出 `DialogueEffects` 清单，由调用方走既有通道落盘
 *    （旗标 → `world.flag` 广播、物品 → 背包、任务 → Quests）。所以"对话改了世界"与
 *    "战斗改了世界"在日志与存档里是同一条路径，不存在第二条真值。
 * 2. **条件求值只读**（§3.1：`NPC 可见对话节点集 = Filter(树, f(quest.state, relation, flags))`）。
 *    于是同一棵树可以被测试穷举、可以在面板里预览，也不会出现"打开对话就改了世界"。
 * 3. **`once` 节点靠"已读"缓存跳过**：初见的独白只演一次，读档后不重复（缓存进档）。
 */

export interface DialogueContext {
  hasFlag(key: string): boolean
  relation(npc: string): number
  questState(id: string): string | null
  /** 已推进到第几步；-1 = 未开始 */
  questIndex(id: string): number
  hasItem(id: string, count?: number): boolean
  hasSeen(dialogueId: string, nodeId: string): boolean
  /** 值域状态的一格读数（`state.*`，没写过 ⇒ 登记表里的缺省） */
  state(key: string): string
}

export interface DialogueChoiceView {
  id: string
  text: string
  style: DialogueChoice['style']
  /** 1 起的显示序号（键盘 1-9 直接选） */
  index: number
}

export interface DialogueView {
  dialogueId: string
  npc: string
  nodeId: string
  speaker: string
  text: string
  emotion?: string
  choices: DialogueChoiceView[]
  /** 没有选项：要么按一下继续（`next`），要么这段对话到此为止 */
  advanceTo: string | null
  ended: boolean
}

/**
 * 效果出口。引擎**不写世界**，但它必须在"跨过边界的那一刻"把效果交出去——
 * 否则会出现一类很隐蔽的错序：玩家选了「我看了断面」，下一个节点的条件
 * `quest.gte STEP1_JUDGED` 却是在那条效果落地**之前**求值的，于是该出现的决断节点被跳过。
 * 调用方（`DialogueSession`）传一个"立刻结算"的 sink，测试传一个"只收集"的 sink——
 * 生产路径的顺序正确，纯函数式测试也还在。
 */
export type EffectSink = (e: DialogueEffects) => void

export interface DialogueResult {
  view: DialogueView | null
  /** 这一步要结算的效果（顺序：选项效果 → 进入节点的 onEnter 效果） */
  effects: DialogueEffects[]
  /** 为什么没话说（调试与测试用） */
  reason?: 'no-tree' | 'no-node'
}

/**
 * 任务表的只读查询口（由 `Quests` 实现）。`gte` 需要知道"第几步"，而步序只住在任务表里——
 * 引擎不自己再存一份顺序，也不搞模块级全局：依赖从构造函数进来，测试才能拿两张不同的表跑。
 */
export interface QuestIndexResolver {
  /** state 串在该任务里的序号；找不到返回 -1 */
  stepIndexOf(questId: string, state: string): number
}

/** 条件求值：五种谓词各自只读一次上下文，没有隐式副作用 */
export function conditionPass(
  c: DialogueCondition | undefined, npc: string, ctx: DialogueContext, quests?: QuestIndexResolver,
): boolean {
  if (!c) return true
  if (c.flags) {
    const all = c.flags.all ?? []
    const any = c.flags.any ?? []
    const not = c.flags.not ?? []
    if (!all.every((f) => ctx.hasFlag(f))) return false
    if (any.length > 0 && !any.some((f) => ctx.hasFlag(f))) return false
    if (not.some((f) => ctx.hasFlag(f))) return false
  }
  if (c.relation) {
    const target = c.relation.npc ?? npc
    const v = ctx.relation(target)
    if (c.relation.op === 'gte' && !(v >= c.relation.value)) return false
    if (c.relation.op === 'lte' && !(v <= c.relation.value)) return false
    if (c.relation.op === 'eq' && !(v === c.relation.value)) return false
  }
  if (c.quest) {
    const state = ctx.questState(c.quest.id)
    if (c.quest.in && (state === null || !c.quest.in.includes(state))) return false
    if (c.quest.gte) {
      const want = quests?.stepIndexOf(c.quest.id, c.quest.gte) ?? -1
      if (want < 0) return false // 数据里没有这个 state ⇒ 条件永远不成立（闸门会先报错）
      if (ctx.questIndex(c.quest.id) < want) return false
    }
  }
  if (c.hasItem) {
    if (!ctx.hasItem(c.hasItem.id, c.hasItem.count ?? 1)) return false
  }
  if (c.state) {
    const v = ctx.state(c.state.key)
    if (c.state.eq !== undefined && v !== c.state.eq) return false
    if (c.state.in && !c.state.in.includes(v)) return false
    if (c.state.notIn && c.state.notIn.includes(v)) return false
  }
  return true
}

export class DialogueEngine {
  constructor(
    private readonly data: readonly DialogueData[],
    private readonly quests?: QuestIndexResolver,
  ) {}

  /** 按 id 取树（会话层只记 treeId，视图与效果都由引擎算） */
  treeById(id: string): DialogueData | null {
    return this.data.find((d) => d.id === id) ?? null
  }

  treesFor(npc: string): DialogueData[] {
    return this.data.filter((d) => d.npc === npc)
  }

  /** 选树：entry 过关的里 priority 最大的那棵（后段剧情压前段） */
  pick(npc: string, ctx: DialogueContext): DialogueData | null {
    const ok = this.treesFor(npc).filter((d) => conditionPass(d.entry, npc, ctx, this.quests))
    if (ok.length === 0) return null
    return ok.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0]
  }

  node(tree: DialogueData, id: string): DialogueNode | null {
    return tree.nodes.find((n) => n.id === id) ?? null
  }

  start(npc: string, ctx: DialogueContext, sink?: EffectSink): DialogueResult {
    const tree = this.pick(npc, ctx)
    if (!tree) return { view: null, effects: [], reason: 'no-tree' }
    // 进门节点的条件不成立时退到 fallback（初见 vs 复访两种开场写在同一棵树里）
    const root = this.node(tree, tree.rootNode)
    const useFallback = root && !conditionPass(root.conditions, npc, ctx, this.quests) && tree.fallbackNode
    return this.enter(tree, useFallback ? tree.fallbackNode! : tree.rootNode, npc, ctx, [], sink)
  }

  /** 进入节点：跳过已读的 `once` 节点，收集 onEnter 效果，产出视图 */
  private enter(
    tree: DialogueData, nodeId: string, npc: string, ctx: DialogueContext,
    carried: DialogueEffects[], sink?: EffectSink,
  ): DialogueResult {
    let id: string | null = nodeId
    const effects = [...carried]
    for (const e of carried) sink?.(e)
    for (let guard = 0; id && guard < 64; guard++) {
      const node = this.node(tree, id)
      if (!node) return { view: null, effects, reason: 'no-node' }
      if (node.once && ctx.hasSeen(tree.id, node.id)) { id = node.next ?? null; continue }
      if (node.conditions && !conditionPass(node.conditions, npc, ctx, this.quests)) { id = node.next ?? null; continue }
      // onEnter 先结算再求值本节点的选项：玩家看到的选项必须建立在"这一步已经发生"之上
      if (node.effects) { effects.push(node.effects); sink?.(node.effects) }
      const choices = this.visibleChoices(node, npc, ctx)
      const advanceTo = choices.length > 0 ? null : (node.next ?? null)
      return {
        view: {
          dialogueId: tree.id, npc, nodeId: node.id, speaker: node.speaker, text: node.text,
          ...(node.emotion ? { emotion: node.emotion } : {}),
          choices,
          advanceTo,
          ended: advanceTo === null,
        },
        effects,
      }
    }
    return { view: null, effects, reason: 'no-node' }
  }

  private visibleChoices(node: DialogueNode, npc: string, ctx: DialogueContext): DialogueChoiceView[] {
    const out: DialogueChoiceView[] = []
    for (const c of node.choices ?? []) {
      if (!conditionPass(c.conditions, npc, ctx, this.quests)) continue
      out.push({ id: c.id, text: c.text, style: c.style, index: out.length + 1 })
    }
    return out
  }

  /** 按一下继续（无选项节点） */
  advance(tree: DialogueData, nodeId: string, npc: string, ctx: DialogueContext, sink?: EffectSink): DialogueResult {
    const node = this.node(tree, nodeId)
    if (!node) return { view: null, effects: [], reason: 'no-node' }
    if (node.next) return this.enter(tree, node.next, npc, ctx, [], sink)
    return { view: null, effects: [] } // 结束
  }

  /** 选一个选项：先结算选项效果，再进入它的 next */
  choose(tree: DialogueData, nodeId: string, choiceId: string, npc: string, ctx: DialogueContext, sink?: EffectSink): DialogueResult {
    const node = this.node(tree, nodeId)
    if (!node) return { view: null, effects: [], reason: 'no-node' }
    const choice = (node.choices ?? []).find((c) => c.id === choiceId)
    if (!choice) return { view: null, effects: [], reason: 'no-node' }
    if (!conditionPass(choice.conditions, npc, ctx, this.quests)) return { view: null, effects: [], reason: 'no-node' }
    const carried: DialogueEffects[] = choice.effects ? [choice.effects] : []
    if (choice.next) return this.enter(tree, choice.next, npc, ctx, carried, sink)
    for (const e of carried) sink?.(e)
    return { view: null, effects: carried }
  }
}
