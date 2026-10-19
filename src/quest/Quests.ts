import { bus } from '@/core/EventBus'
import { clamp } from '@/core/Math'
import type { QuestData } from '@/data/schema'

/**
 * 叙事进度（Phase 6-B）：**任务状态机 + NPC 关系 + 对话已读节点**。
 *
 * 为什么这三样住在一个类里：它们的写方完全相同（对话效果 / 世界旗标），读方也完全相同
 * （对话条件求值），并且一起进同一格存档。拆成三个类只会得到三个"总是要一起改"的东西。
 *
 * 三条纪律：
 * 1. **任务推进只由三种事驱动**：某个旗标被立起（`world.flag` 广播，走 `advanceOn.flags`）、
 *    某一格值域状态落进一组取值（`world.state` 广播，走 `advanceOn.state`，如《该不该敲响》的三选一），
 *    或对话里的一次选择（`DialogueEffects.advanceQuest`）。没有"计时器"也没有"计数到 N 次"——
 *    需求 §28 明确禁止「去那里杀 10 只回来」，所以这里连一个计数器都不提供。
 * 2. **关系值是 -5..+5 的整数**（narrative §3.1），越界夹住而不是无限长。
 * 3. **已读节点缓存进档**：`once` 节点（初见的独白、一次性演出）读档后不会重复演。
 */
export interface QuestEvent {
  questId: string
  state: string
  index: number
  label: string
  started: boolean
  /** 这一步是否**收束**了整条线（末步的 advanceOn 命中） */
  completed: boolean
}

export interface QuestsSnapshot {
  states: Record<string, string>
  relations: Record<string, number>
  seen: string[]
  /** 已收束的线（末步的 advanceOn 命中）。老档没有这一格 ⇒ 空集，不假装已完成 */
  completed: string[]
}

const RELATION_MIN = -5
const RELATION_MAX = 5

export function seenKey(dialogueId: string, nodeId: string): string {
  return `${dialogueId}#${nodeId}`
}

export class Quests {
  private readonly states = new Map<string, string>()
  private readonly relations = new Map<string, number>()
  private readonly seenNodes = new Set<string>()
  /** 已收束的线：末步的 advanceOn 命中才算走完（"停在末步"不等于"做完了"） */
  private readonly completedQuests = new Set<string>()
  private readonly offs: Array<() => void> = []

  constructor(
    private readonly data: readonly QuestData[],
    private readonly onEvent: (e: QuestEvent) => void = () => {},
    /**
     * 读世界旗标的谓词——**顺序补判**要用它（见 `settle`）。缺省恒 false：
     * 不传也能跑，只是不做补判（单元测试大多如此），生产路径由 main.ts 注入 `streaming.hasFlag`。
     */
    private readonly hasFlag: (key: string) => boolean = () => false,
  ) {
    this.offs.push(
      // 旗标是**唯一**的世界状态事件源（Phase 6-A 第一步把它收成一条广播），所以这里
      // 只需要听一条通道就能接住"战斗/交互/对话"三种来源立的旗。
      bus.on('world.flag', (p) => {
        if (p.value === true || p.value === 1 || p.value === 'true') this.onFlag(p.key)
      }),
      // 值域状态是旗标之外的**第二种世界读数**（枚举 vs 两格），所以这里多听一条通道。
      // 只有登记过的 key/value 才广播得出来，因此下面不必再校验取值合法。
      bus.on('world.state', (p) => this.onState(p.key, p.value)),
    )
  }

  private def(id: string): QuestData | null {
    return this.data.find((q) => q.id === id) ?? null
  }

  /* ------------------------------- 任务 ------------------------------- */

  state(id: string): string | null {
    return this.states.get(id) ?? null
  }

  isStarted(id: string): boolean {
    return this.states.has(id)
  }

  /** state 串在本任务里的序号；对话引擎用它求值 `gte`（找不到 -1） */
  stepIndexOf(questId: string, state: string): number {
    const q = this.def(questId)
    if (!q) return -1
    return q.steps.findIndex((s) => s.state === state)
  }

  /** 已推进到第几步（0 起）；未开始 = -1 */
  stepIndex(id: string): number {
    const st = this.states.get(id)
    if (st === undefined) return -1
    const q = this.def(id)
    if (!q) return -1
    return q.steps.findIndex((s) => s.state === st)
  }

  /**
   * 这条线是否**收束**了。判据是"末步的 `advanceOn` 已命中"——而不是"已经走到末步"：
   * 停在末步意味着任务**正在进行**（例：《哑钟》= 你该去合听三段录音了），把它算成完成
   * 会让任务簿撒谎。末步没有 `advanceOn` 的线（后续步还没写的那四条）永远返回 false。
   */
  isComplete(id: string): boolean {
    return this.completedQuests.has(id)
  }

  /** 开始一条线：落到第一步。已在进行的线不会被打回第一步 */
  start(id: string): boolean {
    if (this.states.has(id)) return false
    const q = this.def(id)
    if (!q || q.steps.length === 0) return false
    this.settle(q, 0, true)
    return true
  }

  /** 推进；`to` 给定时直接落到那个 state（用于分支收敛），否则顺推一步 */
  advance(id: string, to?: string): boolean {
    const q = this.def(id)
    if (!q) return false
    const cur = this.stepIndex(id)
    if (to !== undefined) {
      const idx = q.steps.findIndex((s) => s.state === to)
      if (idx < 0) return false
      if (idx <= cur) return false // 单调：不许回头，也不许原地重播
      this.settle(q, idx, false)
      return true
    }
    if (cur < 0) return this.start(id)
    if (cur >= q.steps.length - 1) return false
    this.settle(q, cur + 1, false)
    return true
  }

  private setStep(q: QuestData, index: number, started: boolean): void {
    const step = q.steps[index]
    this.states.set(q.id, step.state)
    const completed = this.completedQuests.has(q.id)
    this.onEvent({ questId: q.id, state: step.state, index, label: step.label, started, completed })
    bus.emit('quest.changed', {
      questId: q.id, state: step.state, index, total: q.steps.length, label: step.label, started, completed,
      // KI-137：marker **原样透传**——任务机不认识"世界的哪一点"（那是 Objectives 那一层的事）
      ...(step.marker ? { marker: step.marker } : {}),
    })
  }

  /**
   * 旗标驱动的顺推：**只查当前这一步**的 `advanceOn`。
   * 不查未来步骤，是因为"提前把三步的旗都立了"在时序上就是另一回事——
   * 那些旗各自对应玩家真的做过的三件事，走一步就该停下让下一句台词有机会被听见。
   */
  private onFlag(key: string): void {
    for (const q of this.data) {
      const idx = this.stepIndex(q.id)
      if (idx < 0) continue
      if (!q.steps[idx].advanceOn?.flags?.includes(key)) continue
      this.push(q, idx)
    }
  }

  /** 值域驱动的顺推（与 `onFlag` 同一套"只查当前这一步"的规矩，见其注释） */
  private onState(key: string, value: string): void {
    for (const q of this.data) {
      const idx = this.stepIndex(q.id)
      if (idx < 0) continue
      const gate = q.steps[idx].advanceOn?.state
      if (!gate || gate.key !== key || !gate.in.includes(value)) continue
      this.push(q, idx)
    }
  }

  /** 推进一步；已在末步 ⇒ 这里就是整条线的收束点 */
  private push(q: QuestData, idx: number): void {
    if (idx < q.steps.length - 1) {
      this.settle(q, idx + 1, false)
      return
    }
    // 末步的 advanceOn = "这条线在这里收束"。命中就记完成（状态不变），
    // 而不是像以前那样**静默忽略**——那会让末步的 advanceOn 变成没人读的死数据。
    if (this.completedQuests.has(q.id)) return
    this.completedQuests.add(q.id)
    this.setStep(q, idx, false)
  }

  /**
   * 落步并**顺序补判**：开放世界里玩家会先做后接（先在钟坠院捡到采晶人的铭牌，再去找科温签契约），
   * 而 `onFlag` 只听得见"新立起来的旗"——那面旗早就在了，于是那一步永远不会推进。
   * 所以每一步落地时都要再问一次"这一步的推进条件是不是早就满足了"。
   * 只往前走、有界（最多 steps.length 步），数据即使成环也不会转不停。
   */
  private settle(q: QuestData, index: number, started: boolean): void {
    let i = index
    let first = started
    for (let guard = 0; guard <= q.steps.length; guard++) {
      this.setStep(q, i, first)
      first = false
      const flags = q.steps[i].advanceOn?.flags ?? []
      if (!flags.some((f) => this.hasFlag(f))) return
      if (i < q.steps.length - 1) { i++; continue }
      if (this.completedQuests.has(q.id)) return
      this.completedQuests.add(q.id)
      this.setStep(q, i, false)
      return
    }
  }

  /* ------------------------------- 关系 ------------------------------- */

  relation(npc: string): number {
    return this.relations.get(npc) ?? 0
  }

  addRelation(npc: string, delta: number): number {
    const next = clamp(this.relation(npc) + delta, RELATION_MIN, RELATION_MAX)
    this.relations.set(npc, next)
    return next
  }

  /* ---------------------------- 已读节点缓存 ---------------------------- */

  hasSeen(dialogueId: string, nodeId: string): boolean {
    return this.seenNodes.has(seenKey(dialogueId, nodeId))
  }

  markSeen(dialogueId: string, nodeId: string): void {
    this.seenNodes.add(seenKey(dialogueId, nodeId))
  }

  /* ------------------------------- 存档 ------------------------------- */

  snapshot(): QuestsSnapshot {
    return {
      states: Object.fromEntries(this.states),
      relations: Object.fromEntries(this.relations),
      seen: [...this.seenNodes].sort(),
      completed: [...this.completedQuests].sort(),
    }
  }

  restore(s: Partial<QuestsSnapshot> | null | undefined): void {
    this.states.clear()
    this.relations.clear()
    this.seenNodes.clear()
    this.completedQuests.clear()
    if (!s) return
    // 读档只认**现在还在表里**的 id：数据里删掉的线不该靠一份老档复活
    for (const [id, state] of Object.entries(s.states ?? {})) {
      const q = this.def(id)
      if (q && q.steps.some((x) => x.state === state)) this.states.set(id, state)
    }
    for (const [npc, v] of Object.entries(s.relations ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v)) this.relations.set(npc, clamp(v, RELATION_MIN, RELATION_MAX))
    }
    for (const k of s.seen ?? []) this.seenNodes.add(k)
    // 只认"当前还在表里、且确实停在末步"的完成记录：数据改过之后不该靠老档凭空完成
    for (const id of s.completed ?? []) {
      const q = this.def(id)
      if (q && this.stepIndex(id) === q.steps.length - 1) this.completedQuests.add(id)
    }
  }

  dispose(): void { for (const off of this.offs.splice(0)) off() }
}
