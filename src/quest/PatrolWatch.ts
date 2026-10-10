import { bus } from '@/core/EventBus'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * PatrolWatch —— 断弦线步 1《巡逻线尽头》的判据裁判（narrative §2.4）。
 *
 * 设计原文：「玩家以**纯闪避不反击**走完一遍完整巡逻周期（机制即叙事：不打断，才能"看见"
 * 这个阵在等谁）」。在它落地之前，`flag.haltrune_patrol_seen` 是对话选项**自己写**的——
 * 玩家点两下「（跟着他们，走完一整圈）」就算走完，巡逻、出手、闪避全都只是文案。
 * 本类把判据从文案挪回机制，并且是**事件型**的（需求 §28：不许用计数器）：
 *
 *  · **周期完成**是一次事件——巡逻敌人在 `patrol` 态里把路径点走回第一格（`Enemy.onPatrolLoop`）。
 *    不数 tick、不量时长：AI 真的绕回来了，才有"一圈"。
 *  · **出手**也是一次事件——玩家某次攻击/战技真正出手的边沿（`input.action`，发射方是
 *    `ThirdPersonController.startAction` 的成功路径）。闪避、奔跑、投音色晶都不发它：
 *    「不动手」的潜行手段不该把判据弄脏。
 *  · **在跟着走**是绕回那一拍的一次位置读数——绕回时玩家必须在队伍近旁（半径是装配方
 *    给的，AISystem 用敌人自己的 `ai.vision.range` 表值）。军阵自己走了八圈而玩家站在
 *    半个地图外，不构成"你走完了一圈"。
 *  · 裁决只看这些事件之间的**序列**：上一圈绕回之后（或监听开始以来）只要出过一次手，
 *    这一圈就作废——下一圈绕回时重新开始判。不存在"手数够不够"的问题。
 *
 * 为什么不用 `sound.source` 当出手信号：音色晶落地、近战命中冲击、击杀噪声都走那一条流，
 * 「声东击西」恰恰是**不动手**的玩法，用它当出手信号会让正确的潜行把判据打脏。
 */
export class PatrolWatch {
  /** 本轮周期内玩家出过手没有（事件置位，绕回时裁决并复位） */
  private dirty = false
  /** 判据已成立（旗是永久的，成立后不再裁决） */
  private done = false
  private readonly off: () => void

  constructor(
    /** 哪些敌人的绕回算"军阵的一圈"、玩家那一刻算不算在跟——两个谓词由装配方合成一个 */
    private readonly watched: (e: { id: string; dataId: string; pos: Vec3 }, playerPos: Vec3 | null) => boolean,
    /** 判据成立时的一次性回调（写旗走 `world.flag` 广播，旗标的唯一写路径） */
    private readonly onSeen: () => void,
  ) {
    this.off = bus.on('input.action', () => { this.dirty = true })
  }

  /** 巡逻敌人在 `patrol` 态里走回路径第一格（一整圈）——由 `Enemy.onPatrolLoop` 调 */
  notePatrolLoop(e: { id: string; dataId: string; pos: Vec3 }, playerPos: Vec3 | null): void {
    if (this.done || !this.watched(e, playerPos)) return
    if (this.dirty) { this.dirty = false; return }
    this.done = true
    this.onSeen()
  }

  dispose(): void { this.off() }
}
