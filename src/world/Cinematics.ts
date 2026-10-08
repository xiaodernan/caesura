import type { CinematicRow } from '@/data/schema'

/**
 * §6 过场清单（需求 §31）的**播放器**——纯逻辑、零 three、可 headless 测。
 *
 * 它**不做**什么（如实）：
 * - **不演**：镜头轨道、字幕时序、低通→全频那些要真几何与相机（KI-008 / KI-010）。
 *   这里只有"哪一条在跑、还剩多久、这一 tick 要不要夺输入"这三件事。
 * - **不决定何时放**：`start(id)` 是调用方的事（对话节点、Boss 入场、结局分支）。
 *
 * 它**做**什么：
 * - `start(id)` 用**清单里的 id** 起一条演出；**id 不在表里 ⇒ 返回 false 且不起**
 *   （不静默开始一个空演出——那正是"账上写着有、实际什么都没发生"的形状）。
 * - `advance(deltaMs)` 走时间；走完自动收束，返回"这一 tick 还有没有演出在跑"。
 * - `inputLocked`：这一条演出期间玩家输入是否被夺走（`lockInput` 那一格）。
 *   **它不自己去改 Input**——那是 `main.ts` 的腿；这里只回答"该不该锁"。
 */
export interface CinematicPlayback {
  id: string
  kind: CinematicRow['kind']
  /** 这一条的总时长（毫秒） */
  durationMs: number
  /** 已经走了多少毫秒 */
  elapsedMs: number
}

export class Cinematics {
  private readonly byId = new Map<string, CinematicRow>()
  private active: CinematicPlayback | null = null

  constructor(rows: readonly CinematicRow[]) {
    for (const r of rows) {
      // 表里的 id 唯一由判据（`scripts/cinematic-rules.mjs`）与门禁守着；这里后到的覆盖先到的，
      // 不静默去重也不抛——重复 id 是数据错，该由门禁在数据侧报，不该让播放器在运行时替它决定。
      this.byId.set(r.id, r)
    }
  }

  /** 表里有没有这一条 */
  has(id: string): boolean {
    return this.byId.has(id)
  }

  /** 当前在跑的那条（没有则 null） */
  get current(): CinematicPlayback | null {
    return this.active === null ? null : { ...this.active }
  }

  /** 演出期是否该夺走玩家输入（没有演出在跑 ⇒ false） */
  get inputLocked(): boolean {
    if (this.active === null) return false
    return this.byId.get(this.active.id)?.lockInput ?? false
  }

  /**
   * 起一条演出。**id 不在表里 ⇒ false 且不起**（调用方应当据此记一条账，而不是当它放过）。
   * 已在跑另一条时：新的**取代**旧的（过场不排队——同时演两条在设计里不存在）。
   */
  start(id: string): boolean {
    const row = this.byId.get(id)
    if (!row) return false
    this.active = { id: row.id, kind: row.kind, durationMs: row.durationMs, elapsedMs: 0 }
    return true
  }

  /** 手动收束（玩家跳过 / 被战斗打断时由调用方决定要不要调）。 */
  skip(): void {
    this.active = null
  }

  /**
   * 走时间。返回**这一 tick 结束后还有没有演出在跑**（false = 刚收束或本来就没有）。
   * 走完那一刻 `current` 就变 null——**不留在"最后一帧"**：留一帧是表现层的事，
   * 逻辑层留着它会让 `inputLocked` 多锁一 tick。
   */
  advance(deltaMs: number): boolean {
    if (this.active === null) return false
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return true
    this.active.elapsedMs += deltaMs
    if (this.active.elapsedMs >= this.active.durationMs) {
      this.active = null
      return false
    }
    return true
  }
}
