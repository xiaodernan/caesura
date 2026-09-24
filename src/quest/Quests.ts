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
 * 1. **任务推进只由两种事驱动**：某个旗标被立起（`world.flag` 广播，走 `advanceOn.flags`），
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
}

export interface QuestsSnapshot {
  states: Record<string, string>
  relations: Record<string, number>
  seen: string[]
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
  private readonly offs: Array<() => void> = []

  constructor(
    private readonly data: readonly QuestData[],
    private readonly onEvent: (e: QuestEvent) => void = () => {},
  ) {
    this.offs.push(
      // 旗标是**唯一**的世界状态事件源（Phase 6-A 第一步把它收成一条广播），所以这里
      // 只需要听一条通道就能接住"战斗/交互/对话"三种来源立的旗。
      bus.on('world.flag', (p) => {
        if (p.value === true || p.value === 1 || p.value === 'true') this.onFlag(p.key)
      }),
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

  /** 任务是否已走到最后一步之后（末步的旗标已立 ⇒ 这条线在本切片内收束） */
  isComplete(id: string): boolean {
    const q = this.def(id)
    if (!q) return false
    return this.stepIndex(id) >= q.steps.length - 1
  }

  /** 开始一条线：落到第一步。已在进行的线不会被打回第一步 */
  start(id: string): boolean {
    if (this.states.has(id)) return false
    const q = this.def(id)
    if (!q || q.steps.length === 0) return false
    this.setStep(q, 0, true)
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
      this.setStep(q, idx, false)
      return true
    }
    if (cur < 0) return this.start(id)
    if (cur >= q.steps.length - 1) return false
    this.setStep(q, cur + 1, false)
    return true
  }

  private setStep(q: QuestData, index: number, started: boolean): void {
    const step = q.steps[index]
    this.states.set(q.id, step.state)
    this.onEvent({ questId: q.id, state: step.state, index, label: step.label, started })
    bus.emit('quest.changed', {
      questId: q.id, state: step.state, index, total: q.steps.length, label: step.label, started,
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
      const step = q.steps[idx]
      if (!step.advanceOn?.flags.includes(key)) continue
      if (idx >= q.steps.length - 1) continue
      this.setStep(q, idx + 1, false)
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
    }
  }

  restore(s: Partial<QuestsSnapshot> | null | undefined): void {
    this.states.clear()
    this.relations.clear()
    this.seenNodes.clear()
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
  }

  dispose(): void { for (const off of this.offs.splice(0)) off() }
}
