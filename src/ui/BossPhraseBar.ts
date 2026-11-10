import { bus } from '../core/EventBus'

/**
 * Boss 乐句线 HUD（Phase 7 F3）。
 *
 * <p>零 game 依赖：只读 canvas 渲染器，订阅总线事件，不认识 PlayerController、AISystem、
 * CombatManager 任何一位。显示内容由 `boss.phase` 事件的 `phase/phases/nameKey` 决定，
 * 当前拍位由 `rhythm.beat` 的 `beatInBar/bar` 决定——两条腿各管各的，不互相冒充。
 *
 * 渲染位置：屏幕右侧中条（与左侧调试面板 F3/F4 不冲突，与中间 HUD 不重叠）。
 * 只有 `boss.phase` 事件到过之后才显示（Boss 没出场时屏幕上一格都不画，不冒充"当前有 Boss"）。
 */
export class BossPhraseBar {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly unsub: Array<() => void> = []

  private time = 0
  private cssW = 0
  private cssH = 0
  private dpr = 1

  /** Boss 阶段读数（boss.phase 事件到过才非 null） */
  private phase: number | null = null
  private phases: number | null = null
  private nameKey: string | null = null

  /** 节拍读数（rhythm.beat 事件到过才非 null） */
  private beatInBar = 1

  /** 淡入淡出：Boss 刚换阶段时亮 1.0，随后指数衰减；没有新事件就自己消 */
  private alpha = 0
  private flash = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('[BossPhraseBar] 2d context unavailable')
    this.ctx = ctx

    this.unsub.push(
      bus.on('boss.phase', (p) => {
        this.phase = p.phase
        this.phases = p.phases
        this.nameKey = p.nameKey
        this.alpha = 1
        this.flash = 1
      }),
      bus.on('rhythm.beat', (info) => {
        this.beatInBar = info.beatInBar
      }),
    )
  }

  /** 每帧调用：dt 秒。alpha 自然衰减，flash 用于阶段切换的瞬时高亮。 */
  tick(dt: number): void {
    this.time += dt
    // alpha 指数衰减：2 秒后淡到接近 0（Boss 长时间不换阶段时 HUD 不再刺眼）
    this.alpha = Math.max(0, this.alpha - dt * 0.5)
    this.flash = Math.max(0, this.flash - dt * 3)
  }

  /** 由外部 render loop 调用：把当前状态画到 canvas。 */
  draw(): void {
    const ctx = this.ctx
    if (this.phase === null || this.phases === null) return
    if (this.alpha <= 0.02) return

    this.resize()

    ctx.save()
    ctx.globalAlpha = this.alpha

    // 背景条：半透明深色，闪烁时稍亮
    const barW = 220
    const barH = 34
    const x = this.cssW - barW - 24
    const y = this.cssH / 2 - barH / 2

    ctx.fillStyle = `rgba(20, 14, 24, ${0.75 * this.alpha + 0.15 * this.flash})`
    ctx.fillRect(x, y, barW, barH)

    // 边框：闪烁时琥珀色，平时骨白
    ctx.strokeStyle = this.flash > 0 ? `rgba(255, 184, 107, ${this.alpha})` : `rgba(232, 223, 203, ${0.5 * this.alpha})`
    ctx.lineWidth = 2
    ctx.strokeRect(x, y, barW, barH)

    // 标题：Boss 名称键（nameKey 来自事件，表现层不做本地化——本地化由上层做）
    ctx.fillStyle = `rgba(232, 223, 203, ${this.alpha})`
    ctx.font = 'bold 14px Georgia, "Songti SC", "STSong", "SimSun", serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const label = this.nameKey ?? `phase-${this.phase}`
    ctx.fillText(label, x + 12, y + barH / 2 - 8)

    // 阶段进度：X / Y
    ctx.font = '12px Georgia, "Songti SC", "STSong", "SimSun", serif'
    ctx.fillText(`${this.phase} / ${this.phases}`, x + 12, y + barH / 2 + 10)

    // 拍位指示器：当前拍在小节内的位置（1-based），用 4 个小点表示 4 拍
    const beatsPerBar = 4
    const dotW = 6
    const dotGap = 8
    const dotsStartX = x + barW - 12 - beatsPerBar * (dotW + dotGap)
    for (let i = 0; i < beatsPerBar; i++) {
      const isCurrent = i + 1 === this.beatInBar
      ctx.fillStyle = isCurrent
        ? `rgba(255, 184, 107, ${this.alpha})`
        : `rgba(232, 223, 203, ${0.3 * this.alpha})`
      ctx.beginPath()
      ctx.arc(dotsStartX + i * (dotW + dotGap), y + barH / 2, dotW / 2, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.restore()
  }

  private resize(): void {
    const cssW = this.canvas.clientWidth
    const cssH = this.canvas.clientHeight
    if (cssW === this.cssW && cssH === this.cssH) return
    this.cssW = cssW
    this.cssH = cssH
    // headless 环境没有 window.devicePixelRatio，默认 1；浏览器里会按实际 DPR 缩放
    this.dpr = typeof window !== 'undefined' ? (window.devicePixelRatio ?? 1) : 1
    this.canvas.width = cssW * this.dpr
    this.canvas.height = cssH * this.dpr
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
  }

  /** 调用方负责在不再需要时调用（总线订阅不自动解绑）。 */
  dispose(): void {
    for (const u of this.unsub) u()
    this.unsub.length = 0
  }
}
