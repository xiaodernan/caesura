/**
 * 电影黑边仪典（Phase F-50 · 前端第二十七维）：
 * `cinematics.current` 非空期间，屏幕上下各落一道纯黑幕布，中央偏下落一行「谱题」题字
 * （cinematics.json 的 `note` 字段，调音师对这出戏的声音学注解），右下角六分规印「ESC 跳过」。
 *
 * 设计（纯 DOM/CSS）：
 * - 双幕布由中心向上/下两侧推出（transform: scaleY，带 900ms 缓动）
 * - 题字用 `background-clip:text` 暗金渐变 +「>」引号前缀、mono-ish 字距
 * - 幕布各铺一条 1px 金丝（bar-rule，呼应 Stakerite 的「终局金丝」母题）
 * - win kind（CINE_WIN）题字金饱和度更高；ending kind 偏白银；montage 半透明加快
 * - ESC 跳过提示呼吸（bdr-breathe）
 * - `prefers-reduced-motion` 全关动画与 transition
 * - 不接输入、不关自己、不截断 Cinematics 扇出；只读 `hooks.info()`/`hooks.note(id)`
 *
 * 不声称：画面已验（KI-010）、音效触发、DECIMATED 帧演示；纯装饰层。
 */

const CSS = `
.cine-letterbox { position: fixed; inset: 0; z-index: 38; pointer-events: none; display: none; }
.cine-letterbox.on { display: block; }
.cine-letterbox .cine-bar { position: absolute; left: 0; right: 0; height: 15vh; background: #000;
  transition: transform .9s cubic-bezier(.22,.8,.3,1); will-change: transform; }
.cine-letterbox .cine-bar.cine-top { top: 0; transform: translateY(-100%); border-bottom: 1px solid rgba(201,180,88,.28); }
.cine-letterbox .cine-bar.cine-bottom { bottom: 0; transform: translateY(100%); border-top: 1px solid rgba(201,180,88,.28); }
.cine-letterbox.on .cine-bar.cine-top { transform: translateY(0); }
.cine-letterbox.on .cine-bar.cine-bottom { transform: translateY(0); }
.cine-letterbox .cine-caption { position: absolute; left: 50%; bottom: 6.2vh; transform: translateX(-50%);
  max-width: min(78vw, 62ch); text-align: center; font-size: 13px; letter-spacing: .22em; line-height: 2.1; text-indent: .22em;
  color: rgba(232,223,203,.85); text-shadow: 0 1px 8px rgba(0,0,0,.85); transition: opacity .7s ease .25s; opacity: 0; }
.cine-letterbox.on .cine-caption { opacity: 1; }
.cine-letterbox .cine-caption b { color: rgba(201,180,88,.82); font-weight: 400; letter-spacing: .3em; text-indent: .3em; }
.cine-letterbox .cine-caption::before { content: '「 '; color: rgba(201,180,88,.6); }
.cine-letterbox .cine-caption::after { content: ' 」'; color: rgba(201,180,88,.6); }
.cine-letterbox[data-kind='win'] .cine-caption { background: linear-gradient(180deg, #fdf6dd 0%, #e0cb84 55%, #a08a4c 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; font-size: 15px; }
.cine-letterbox[data-kind='ending'] .cine-caption { color: rgba(232,236,244,.88); }
.cine-letterbox[data-kind='montage'] .cine-caption { opacity: .72; font-size: 12px; }
.cine-letterbox .cine-skip { position: absolute; right: 3.2vw; bottom: 8.5vh; font-size: 10px; letter-spacing: .4em; text-indent: .4em;
  color: rgba(201,180,88,.55); transition: opacity .7s ease .35s; opacity: 0; }
.cine-letterbox.on .cine-skip { opacity: 1; animation: cine-skip-breathe 2.8s ease-in-out infinite; }
@keyframes cine-skip-breathe { 0%, 100% { opacity: .35 } 50% { opacity: .8 } }
.cine-letterbox .cine-mark { position: absolute; left: 3.2vw; bottom: 8.5vh; font-size: 10px; letter-spacing: .5em; text-indent: .5em; color: rgba(201,180,88,.42); }
.cine-letterbox[data-kind='win'] .cine-mark { color: rgba(253,246,221,.55); }
@media (prefers-reduced-motion: reduce) {
  .cine-letterbox .cine-bar { transition: none; }
  .cine-letterbox .cine-caption { transition: none; opacity: 1; }
  .cine-letterbox .cine-skip { animation: none; opacity: 1; }
}
`

export interface CinematicLetterboxHooks {
  /** 每帧读取当前 inplay 的 cinematic id；无激活返回 null */
  info: () => { id: string; kind: string } | null
  /** 按 id 取谱题题字；查不到返回 undefined ⇒ 落通用题字 */
  note: (id: string) => string | undefined
  /** 可选：跳过按键提示（默认 ESC） */
  skipHint?: string
}

const GENERIC_NOTE = '乐句未明 · 暂时屏息'

export class CinematicLetterbox {
  private readonly root: HTMLDivElement
  private readonly caption: HTMLDivElement
  private readonly skip: HTMLDivElement
  private readonly mark: HTMLDivElement
  private readonly hooks: CinematicLetterboxHooks
  private lastId: string | null = null
  private lastNote: string | null = null

  constructor(hooks: CinematicLetterboxHooks) {
    this.hooks = hooks
    CinematicLetterbox.injectCss()
    const mk = (cls: string): HTMLDivElement => {
      const el = document.createElement('div') as HTMLDivElement
      el.className = cls
      el.setAttribute('aria-hidden', 'true')
      return el
    }
    this.root = document.createElement('div')
    this.root.id = 'cine-letterbox'
    this.root.className = 'cine-letterbox'
    this.root.setAttribute('aria-hidden', 'true')
    const top = mk('cine-bar cine-top'), bottom = mk('cine-bar cine-bottom')
    this.caption = mk('cine-caption')
    this.skip = mk('cine-skip')
    this.mark = mk('cine-mark')
    this.root.appendChild(top)
    this.root.appendChild(bottom)
    this.root.appendChild(this.caption)
    this.root.appendChild(this.skip)
    this.root.appendChild(this.mark)
    document.body.appendChild(this.root)
    this.skip.textContent = hooks.skipHint ?? 'ESC · 跳过'
    this.lastId = null
    this.lastNote = null
  }

  static injectCss(): void {
    if (document.getElementById('cine-letterbox-css')) return
    const style = document.createElement('style')
    style.id = 'cine-letterbox-css'
    style.textContent = CSS
    document.head.appendChild(style)
  }

  /** 每帧由 main.ts 的 GameLoop 调用——与 pauseOverlay.update() 同节拍 */
  update(): void {
    const info = this.hooks.info()
    const active = info !== null
    this.root.classList.toggle('on', active)
    this.root.setAttribute('aria-hidden', String(!active))
    if (!active || !info) { this.lastId = null; return }
    const note = this.hooks.note(info.id) ?? GENERIC_NOTE
    if (info.id !== this.lastId || note !== this.lastNote) {
      this.caption.textContent = note
      this.root.setAttribute('data-kind', info.kind)
      this.mark.textContent = info.id
      this.lastId = info.id
      this.lastNote = note
    }
  }

  /** 摘掉 DOM（HMR／重构建友好） */
  dispose(): void {
    this.root.remove()
    this.lastId = null
    this.lastNote = null
  }
}
