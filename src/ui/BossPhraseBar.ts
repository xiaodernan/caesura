import { bus } from '../core/EventBus'
import { t } from '@/i18n/Lang'

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

  /** 由外部 render loop 调用：把当前状态画到 canvas。
   *  Phase F-41 朱砂乐谱（headless 可证、零渐变零阴影）：
   *  - 断牍纸面板（深靛三层背景）+ 双缘金丝 1px 细线 + 左缘朱砂引线
   *  - 右上朱「命」13×13 小印（段印，§9 朱砂规范；Canvas 真绘不自称美术评审）
   *  - 下半截五线制式乐谱：水平 staff 细梁 + 四拍钉（当前拍为朱砂上凸 14px 连珠）
   */
  draw(): void {
    const ctx = this.ctx
    if (this.phase === null || this.phases === null) return
    if (this.alpha <= 0.02) return

    this.resize()

    ctx.save()
    ctx.globalAlpha = this.alpha

    // 断牍纸面板：墨靛三层暗纹（与 dialogues 宣纸皮对仗）
    const barW = 236
    const barH = 74
    const x = this.cssW - barW - 24
    const y = this.cssH / 2 - barH / 2
    ctx.fillStyle = `rgba(15, 13, 20, ${0.82 * this.alpha + 0.1 * this.flash})`
    ctx.fillRect(x, y, barW, barH)
    // 上下缘金丝 1px 细线（闪动时提鲜）+ 左缘朱砂引线 3px
    ctx.fillStyle = `rgba(201, 180, 88, ${0.3 + 0.55 * this.flash})`
    ctx.fillRect(x, y, barW, 1)
    ctx.fillRect(x, y + barH - 1, barW, 1)
    ctx.fillStyle = 'rgba(166, 64, 50, 0.85)'
    ctx.fillRect(x, y, 3, barH)

    // 右上朱「命」印：段印（13×13），flash 时内刻墨晕提鲜
    ctx.fillStyle = 'rgba(166, 64, 50, 0.92)'
    ctx.fillRect(x + barW - 20, y + 6, 13, 13)
    ctx.fillStyle = '#f4e9d8'
    ctx.font = '600 10px Georgia, "Songti SC", "STSong", serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(t('ui.boss.phrase.glyph'), x + barW - 13.5, y + 12.7)

    // 乐句线名（nameKey）+ 段次小字（沿用副标金）
    ctx.fillStyle = '#efe6d2'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.font = '600 13px Georgia, "Songti SC", serif'
    ctx.fillText(this.nameKey ?? `phase-${this.phase}`, x + 12, y + 17)
    ctx.fillStyle = 'rgba(227, 207, 143, 0.85)'
    ctx.font = '10px Georgia, "Songti SC", serif'
    ctx.fillText(t('ui.boss.phrase.phases', { phase: this.phase, phases: this.phases }), x + 12, y + 35)

    // 中央乐谱 staff：一条细梁 + 四拍钉（1-based 对齐 rhythm.beat.beatInBar）
    const staffY = y + barH - 12
    ctx.fillStyle = 'rgba(232, 223, 203, 0.22)'
    ctx.fillRect(x + 12, staffY, barW - 24, 1)
    const beats = 4
    const slot = (barW - 24) / (beats + 1)
    for (let i = 0; i < beats; i++) {
      const bx = x + 12 + slot * (i + 1)
      const cur = i + 1 === this.beatInBar
      ctx.fillStyle = cur ? 'rgba(212, 106, 78, 0.95)' : 'rgba(232, 223, 203, 0.28)'
      ctx.fillRect(bx - 1.5, staffY - (cur ? 7 : 5), 3, cur ? 14 : 10)
      if (cur) {
        ctx.fillStyle = 'rgba(212, 106, 78, 0.75)'
        ctx.beginPath()
        ctx.arc(bx, staffY - 10, 2.6, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Phase F-70「乐相舞动」：flash>0 时画一道金丝闪弧（Boss 换段瞬间的余响·金丝擦过，无动画循环）
    if (this.flash > 0.01) {
      ctx.save()
      ctx.globalAlpha = Math.min(1, this.flash) * this.alpha
      ctx.strokeStyle = `rgba(232, 190, 120, ${0.72 * this.flash})`
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(x + 20, y + 12)
      ctx.quadraticCurveTo(x + barW / 2, y - 8, x + barW - 20, y + 12)
      ctx.stroke()
      // 两枚微朱点位缀（左 1/3 与右 1/3，flash 越亮越醒）
      ctx.fillStyle = `rgba(201, 116, 88, ${0.9 * this.flash})`
      ctx.beginPath()
      ctx.arc(x + barW * 0.33, y + 6, 1.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x + barW * 0.67, y + 6, 1.6, 0, Math.PI * 2)
      ctx.fill()
      // Phase F-74「余辉仪典」：flash 时 panel 右上两枚朱点 breathing 驻留（sine 位移·纯绘制 · 无动画环）
      const breathe = 0.5 + 0.5 * Math.sin(this.time * 2.1)
      ctx.fillStyle = `rgba(212, 106, 78, ${0.35 * this.flash * breathe})`
      ctx.beginPath()
      ctx.arc(x + barW * 0.5 - 12, y + 31, 1.1 + 1.0 * breathe, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x + barW * 0.5 + 12, y + 31, 1.1 + 1.0 * breathe, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
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
