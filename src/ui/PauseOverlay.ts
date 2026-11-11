import { PauseControl } from '@/core/PauseControl'

/**
 * 玩家手动暂停的「止音仪典」（Phase F-45）。
 *
 * 病：玩家按下 Esc 之后 `Time.paused` 变真、玩法冻结，但屏幕上没有一条可见的"发生了什么"——
 * 只是游戏静默了一拍，像驱动落了。
 * 这条 `PauseOverlay` 补的就是那条「时间停了」的弹幕提示。
 *
 * 设计（纯 DOM/CSS，零画布、零 npm、零听觉）：
 * - 两圈同心「墨环」缓慢呼吸 + 字面向上冒「止」的字迹（24px 主字、「STOP」小字双语再解）
 * - 顶/底细金边「止」印 + 右上角「x 回第」时 标签（出唇何时、心室何时）
 * - 仅在玩家控制下显示（pausedByUser=true）；菜单 overlay 自带"面板导航"，那是另一条路：
 *   菜单暂停不会触发本 overlay；只有玩家自己按下 pause/[Esc] 才会亮「止」。
 * - 不接收背景点击、不关自己、不影响游戏运行时输入通道——暂停期间 Esc 仍翻回去，输入主人是 Input
 *
 * 不声称：美术评审通过、音效触发、真 Act一点。Zero JS callbacks per render path beyond update().
 */

const CSS = `
.pause-overlay { position: fixed; inset: 0; z-index: 40; display: none; pointer-events: none;
  font-family: Georgia, "Songti SC", "STSong", "SimSun", serif; color: #e8dfcb; text-align: center; }
.pause-overlay.on { display: flex; pointer-events: none; }
.pause-overlay .panel { position: relative; margin: auto; max-width: 520px; padding: 48px 72px 40px;
  background: radial-gradient(ellipse 80% 60% at 50% 50%, rgba(9,10,15,.85), rgba(9,10,15,.35) 70%, transparent 90%); }
.pause-overlay .ring { position: absolute; left: 50%; top: 50%; width: 220px; height: 220px; border-radius: 50%;
  background: radial-gradient(circle, transparent 38%, rgba(201,180,88,.28) 39%, transparent 41%, rgba(201,180,88,.14) 46%, transparent 49%);
  transform: translate(-50%, -50%); animation: pause-breathe 3.6s ease-in-out infinite alternate; }
.pause-overlay .ring.ring-b { width: 296px; height: 296px;
  background: radial-gradient(circle, transparent 43%, rgba(201,180,88,.16) 44%, transparent 46%);
  animation: pause-breathe-b 4.4s ease-in-out infinite alternate; }
@keyframes pause-breathe { 0% { opacity: .25; transform: translate(-50%, -50%) scale(.96); } 100% { opacity: 1; transform: translate(-50%, -50%) scale(1.04); } }
@keyframes pause-breathe-b { 0% { opacity: .15; transform: translate(-50%, -50%) scale(1.02); } 100% { opacity: .55; transform: translate(-50%, -50%) scale(1.0); } }
.pause-overlay h1 { position: relative; font-size: 68px; letter-spacing: .1em; margin: 0; color: #c9b458;
  background: linear-gradient(180deg, #fbf3dc 8%, #d8c36a 36%, #8f7f43 74%, #fbf3dc 100%);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  text-shadow: none; font-weight: 400; animation: pause-glyph-breathe 2.8s ease-in-out infinite alternate; }
@keyframes pause-glyph-breathe { 0% { opacity: .72; } 100% { opacity: 1; } }
.pause-overlay .sub { position: relative; margin-top: 6px; font-size: 13px; letter-spacing: .6em; color: rgba(201,180,88,.6); text-indent: .6em; }
.pause-overlay .hint { position: relative; margin-top: 22px; font-size: 12px; letter-spacing: .18em; color: rgba(232,223,203,.5); }
.pause-overlay .rule { position: relative; width: 64px; height: 1px; margin: 20px auto 0; background: linear-gradient(90deg, transparent, rgba(201,180,88,.7), transparent); }
@media (prefers-reduced-motion: reduce) {
  .pause-overlay .ring, .pause-overlay .ring.ring-b, .pause-overlay h1 { animation: none; opacity: 1; transform: translate(-50%, -50%); }
}
`

export interface PauseOverlayHooks {
  pause: PauseControl
  /** Only override hook optional; not used by default */
  onToggle?: (paused: boolean) => void
}

export class PauseOverlay {
  private readonly root: HTMLDivElement
  private readonly hooks: PauseOverlayHooks
  private lastPaused = false

  constructor(hooks: PauseOverlayHooks) {
    this.hooks = hooks
    PauseOverlay.injectCss()

    this.root = document.createElement('div')
    this.root.id = 'pause-overlay'
    this.root.className = 'pause-overlay'
    this.root.setAttribute('aria-hidden', 'true')
    this.root.setAttribute('aria-role', 'presentation')
    this.root.innerHTML = `<div class="panel"><div class="ring"></div><div class="ring ring-b"></div><h1 class="glyph">止</h1><div class="sub">PAUSED</div><div class="rule"></div><div class="hint">Esc · 再一次 · 继续</div></div>`
    document.body.appendChild(this.root)
  }

  static injectCss(): void {
    if (document.getElementById('pause-overlay-css')) return
    const style = document.createElement('style')
    style.id = 'pause-overlay-css'
    style.textContent = CSS
    document.head.appendChild(style)
  }

  /** 被 main.ts 每帧调用——真正的紧缩来源是 PauseControl（worldPaused）*/
  update(): void {
    const paused = this.hooks.pause.pausedByUser   // 只看「玩家那一格」，菜单 overlay 不算（不另做一次停摆声明）
    if (paused === this.lastPaused) return
    this.lastPaused = paused
    this.root.classList.toggle('on', paused)
    this.root.setAttribute('aria-hidden', String(!paused))
    this.hooks.onToggle?.(paused)
  }

  /** 销毁（HMR 方便 / 场景切换时调用） */
  dispose(): void {
    this.root.remove()
    this.lastPaused = false
  }

  get isOpen(): boolean { return this.lastPaused }
}
