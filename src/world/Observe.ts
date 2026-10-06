/**
 * KI-105 声纹观察（Observe）——「聋者之眼」的动词腿（gameplay.md §2.1，需求 P2 聋者之眼）。
 *
 * 主角是聋者：世界的信息不走耳朵，走**视觉声纹**。按住 V，一圈涟漪从脚下荡开，波前扫过的地方，
 * 敌人与能交互的东西以地面波纹显形（§43「敌人巡逻路径以地面波纹显示 3 秒」的机制读法：
 * 显形的时长=波前的行程，不另编一个计时器）。
 *
 * 这条腿同时是 KI-018 的解锁件：无耳深窖的设计正解是「靠听而不是靠看」，而观察动词就是玩家
 * 在近黑区域里的耳朵——没有它，塞进去的幽灵八只会变成「看不见 ⇒ 打不过」的坏题。
 *
 * 形状沿用本仓库的纪律（KI-020/KI-014 同一紫）：纯逻辑、零依赖、无 three、headless 可量；
 * 表现层（VfxLayer 的环）只读这里算好的格子，自己一格状态都不长。
 *
 * - **包络 strength**：0..1。按住每 tick +1/30（0.5s 入场淡入），松开每 tick −1/30（0.5s 退场淡出，
 *   §43 两头都写了时长）。它**不是装饰**：唯一读者是有效显形半径 `OBSERVE_RADIUS × strength`——
 *   刚按下的头半秒涟漪还小、扫不到远处；松手后显形圈从满半径收拢回脚下，标记随之失效。
 * - **脉冲 pulse**：strength 满格且按住时从脚下发出，波前按固定速度线性外扩，
 *   走满 `OBSERVE_TRAVEL_TICKS`（180 tick = 3 秒）后退休。按住不松时每 `OBSERVE_PULSE_GAP`
 *   再发一颗——声呐 ping 的节奏，新生与退休交叠 ⇒ 盘面连续覆盖，而不是闪一下就没。
 * - **标记 mark**：每颗脉冲对每个目标只记一次账（`birth:id` 键），表现层 `takeMarks` 取走即清。
 *
 * 显形不给敌人上**任何**状态（不是 KI-023 的聋乱、不是 stun、不进 AI 的账）：它只把已经存在的
 * 东西指给你看，信息是唯一的产出。§43 说它无体力消耗——它的代价形状是「你得停下来按住它」，
 * 而深窖的区域脏音（§11）会替你计时。
 */

/** 入场/退场淡变时长（tick）。60tick/s ⇒ 0.5s，§43 原文的两头 */
export const OBSERVE_FADE_TICKS = 30
/** 观察波及半径（m）：一个跨过灰盒地板两格的读数，覆盖「看得见的一屏」 */
export const OBSERVE_RADIUS = 26
/** 波前走满半径的行程（tick）：180 tick = 3 秒，§43 的「显示 3 秒」住在这里 */
export const OBSERVE_TRAVEL_TICKS = 180
/** 按住不松时两颗脉冲的间隔（tick）：0.75s 一声 ping；与行程交叠保证覆盖连续 */
export const OBSERVE_PULSE_GAP = 45

export interface Pulse {
  readonly x: number
  readonly z: number
  readonly birthTick: number
}

/** 观察的读方目标：只认位置与身份，不认识别的东西（敌人与交互物都长这个形状） */
export interface ObserveTarget {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface ObserveMark {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly z: number
  readonly kind: 'enemy' | 'interact'
}

export class ObserveSystem {
  private holding = false
  private prevHolding = false
  /**
   * 包络格数（0..OBSERVE_FADE_TICKS 的**整数**）。刻意不存 0..1 的浮点强度：
   * 1/30 累加三十次只得 0.9999999999999999，`>= 1` 的脉冲闸门就永远不开——
   * 浮点在这种「走满才算满」的账上不能当账本，整数才数得清。
   */
  private _env = 0
  private nextPulseAt = 0
  private readonly pulses: Pulse[] = []
  private readonly marked = new Set<string>()
  /** update 的返回值（本 tick 新生的脉冲）：复用同一数组，稳态零分配 */
  private readonly bornOut: Pulse[] = []
  /** takeMarks 的返回值：同上 */
  private readonly marksOut: ObserveMark[] = []

  /** 长按观察键。held 语义：每 tick 用 `frame.held.has('observe')` 喂，不是边沿 */
  hold(on: boolean): void {
    this.holding = on
  }

  get strength(): number {
    return this._env / OBSERVE_FADE_TICKS
  }

  /** 包络开着没有（有效半径 > 0）——表现层与读方共用的总闸 */
  get active(): boolean {
    return this._env > 0
  }

  /** 活脉冲（表现层画环、读方算覆盖都用它；只读） */
  get livePulses(): readonly Pulse[] {
    return this.pulses
  }

  /** 波前此刻走了多远（m）：线性外扩，走满半径为止 */
  frontRadius(p: Pulse, tick: number): number {
    return Math.min(OBSERVE_RADIUS, ((tick - p.birthTick) * OBSERVE_RADIUS) / OBSERVE_TRAVEL_TICKS)
  }

  /**
   * 每 tick 推进：包络、脉冲的生与死。返回本 tick 新出生的脉冲（通常 0 或 1 颗），
   * main.ts 拿去发大波纹环——逻辑波前与视觉波前用同一份半径算式，不会各走各的。
   */
  update(tick: number, px: number, pz: number): readonly Pulse[] {
    this._env = this.holding ? Math.min(OBSERVE_FADE_TICKS, this._env + 1) : Math.max(0, this._env - 1)
    // 入场淡入走完才发第一颗：涟漪从「完全显形」的那一刻起荡，半途松手不留半张图
    if (this.holding && !this.prevHolding) this.nextPulseAt = tick + OBSERVE_FADE_TICKS
    this.prevHolding = this.holding

    this.bornOut.length = 0
    if (this.holding && this._env >= OBSERVE_FADE_TICKS && tick >= this.nextPulseAt) {
      const p: Pulse = { x: px, z: pz, birthTick: tick }
      this.pulses.push(p)
      this.bornOut.push(p)
      this.nextPulseAt = tick + OBSERVE_PULSE_GAP
    }
    // 退休：波前走满就摘。覆盖的连续性由 GAP < TRAVEL 的新生交叠保证，不靠赖着不走
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      if (tick - this.pulses[i].birthTick > OBSERVE_TRAVEL_TICKS) this.pulses.splice(i, 1)
    }
    return this.bornOut
  }

  /** (x,z) 此刻是否在显形圈内：包络开着，且某颗活脉冲的波前已经扫过它 */
  revealed(x: number, z: number, tick: number): boolean {
    if (this._env <= 0) return false
    const cap = OBSERVE_RADIUS * this.strength
    for (const p of this.pulses) {
      const dx = x - p.x
      const dz = z - p.z
      const r = Math.min(this.frontRadius(p, tick), cap)
      if (dx * dx + dz * dz <= r * r) return true
    }
    return false
  }

  /**
   * 表现层取件：这一 tick 波前**恰好扫到**的目标（每颗脉冲对每个目标只报一次），
   * 敌人与交互物合在同一份返回里、以 kind 分标记的形状（金=敌人、银=交互物）。
   * main.ts 把返回的点画成标记环；取走即清，下一 tick 不会重复报同一批。
   */
  takeMarks(
    enemies: readonly ObserveTarget[],
    interacts: readonly ObserveTarget[],
    tick: number,
  ): readonly ObserveMark[] {
    if (this._env <= 0 || this.pulses.length === 0) {
      this.marksOut.length = 0 // 闸门关着也要交还空账：留着上一趟的标记会让表现层重复画
      return this.marksOut
    }
    const cap = OBSERVE_RADIUS * this.strength
    this.marksOut.length = 0
    this.collect(enemies, 'enemy', tick, cap)
    this.collect(interacts, 'interact', tick, cap)
    return this.marksOut
  }

  private collect(
    targets: readonly ObserveTarget[],
    kind: 'enemy' | 'interact',
    tick: number,
    cap: number,
  ): void {
    for (const p of this.pulses) {
      const front = Math.min(this.frontRadius(p, tick), cap)
      for (const t of targets) {
        const dx = t.x - p.x
        const dz = t.z - p.z
        if (dx * dx + dz * dz > front * front) continue
        const key = `${p.birthTick}:${t.id}`
        if (this.marked.has(key)) continue
        this.marked.add(key)
        this.marksOut.push({ id: t.id, x: t.x, y: t.y, z: t.z, kind })
      }
    }
  }
}
