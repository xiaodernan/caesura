import type { DialogueEffects } from '@/data/schema'
import type { DialogueContext, DialogueEngine, DialogueView } from './Dialogue'
import type { Quests } from './Quests'

/**
 * 对话的**结算胶水**（Phase 6-B）。与 `rpg/Settlement.ts` 同一条理由：
 * 编排逻辑不该只住在 `main.ts` 里——那样 §59 的闭环只能靠"读代码"验证，而不是靠测试。
 *
 * 引擎产出 `DialogueEffects` 清单，这里把它落到**既有的四条通道**上：
 * 旗标 → `setFlag`（走 `world.flag` 广播，与战斗/交互立的旗是同一条路）、
 * 关系与任务 → `Quests`、物品 → 背包。所以"对话改了世界"在存档与日志里
 * 与"战斗改了世界"没有区别，也不存在第二份世界状态。
 */

export interface DialogueInv {
  add(id: string, n?: number): number
  remove(id: string, n?: number): boolean
  count(id: string): number
}

export interface DialogueDeps {
  quests: Quests
  engine: DialogueEngine
  ctx: DialogueContext
  inv: DialogueInv
  setFlag(key: string, value: boolean): void
  notify(text: string, kind?: 'info' | 'reward' | 'boss'): void
  /** 世界被改过之后调用（main.ts 用它把派生值重新灌回玩家） */
  refresh(): void
  /** 对话期间世界停摆的开/关 */
  setPaused(paused: boolean): void
  /** 视图出口：main.ts 接到 DialogueBox 上 */
  present(view: DialogueView | null): void
}

export class DialogueSession {
  private talk: { treeId: string; npc: string; nodeId: string } | null = null

  constructor(private readonly deps: DialogueDeps) {}

  get isTalking(): boolean { return this.talk !== null }
  get npcId(): string | null { return this.talk?.npc ?? null }

  /** 开场。没有可说的话时返回 false 并说明原因（不弹一个空对话框） */
  open(npcId: string): boolean {
    const { engine, ctx } = this.deps
    const tree = engine.pick(npcId, ctx)
    if (!tree) return false
    const res = engine.start(npcId, ctx, this.sink)
    if (!res.view) return false
    this.talk = { treeId: tree.id, npc: npcId, nodeId: res.view.nodeId }
    this.deps.setPaused(true)
    this.turn(res)
    return true
  }

  choose(choiceId: string): void {
    const t = this.talk
    if (!t) return
    const tree = this.tree(t.treeId)
    if (!tree) return
    this.turn(this.deps.engine.choose(tree, t.nodeId, choiceId, t.npc, this.deps.ctx, this.sink))
  }

  advance(): void {
    const t = this.talk
    if (!t) return
    const tree = this.tree(t.treeId)
    if (!tree) return
    this.turn(this.deps.engine.advance(tree, t.nodeId, t.npc, this.deps.ctx, this.sink))
  }

  close(): void {
    if (!this.talk) return
    this.talk = null
    this.deps.present(null)
    this.deps.setPaused(false)
  }

  /**
   * 效果在**跨过边界的那一刻**就已结算（见 `EffectSink` 的注释），所以这一回合只负责推进视图。
   * 顺序很关键：先改世界，再求值下一个节点的条件——反过来就会出现"该出现的决断节点被跳过"。
   */
  private sink: (e: DialogueEffects) => void = (e) => {
    const npc = this.talk?.npc
    if (npc) this.applyEffects([e], npc)
  }

  private turn(res: { view: DialogueView | null; effects: DialogueEffects[] }): void {
    const t = this.talk
    if (!t) return
    if (!res.view) { this.close(); return }
    t.nodeId = res.view.nodeId
    this.deps.quests.markSeen(res.view.dialogueId, res.view.nodeId)
    this.deps.present(res.view)
  }

  /**
   * 结算顺序是**语义**，不是风格：**先把任务建立/推进，再立旗标**。
   *
   * 反例（真踩过）：盐歌第一段记忆那条选择同时 `startQuest: q_meg` 与 `setFlags: [flag.meg_first_fragment]`，
   * 而这条旗标正是第一步的 `advanceOn`。若先立旗，`Quests` 收到广播时任务还没开始（stepIndex = -1）
   * ⇒ 那一步被静默跳过，玩家看到"接了委托但一步没走"。先建任务再立旗，旗标就能落到当前这一步上。
   */
  applyEffects(list: readonly DialogueEffects[], npc: string): void {
    const d = this.deps
    let touched = false
    for (const e of list) {
      if (e.startQuest) { d.quests.start(e.startQuest); touched = true }
      if (e.advanceQuest) { d.quests.advance(e.advanceQuest.id, e.advanceQuest.to); touched = true }
      if (e.setRelation) { d.quests.addRelation(e.setRelation.npc ?? npc, e.setRelation.delta); touched = true }
      for (const f of e.setFlags ?? []) { d.setFlag(f, true); touched = true }
      for (const f of e.clearFlags ?? []) { d.setFlag(f, false); touched = true }
      if (e.giveItem) { d.inv.add(e.giveItem.id, e.giveItem.count ?? 1); touched = true }
      if (e.takeItem) { d.inv.remove(e.takeItem.id, e.takeItem.count ?? 1); touched = true }
      if (e.notify) d.notify(e.notify, 'reward')
    }
    if (touched) d.refresh()
  }

  private tree(id: string) {
    return this.deps.engine.treeById(id)
  }
}
