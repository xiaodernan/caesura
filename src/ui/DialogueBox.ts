import type { DialogueView } from '@/quest/Dialogue'

/**
 * 对话框（Phase 6-B / narrative §3.2 的 subtitlesRequired）。
 *
 * 位置在**画面下三分之一**，不是屏幕中央：这是字幕不是菜单——玩家要能一边读一边看着
 * 说话的人（Phase 7 会在这里加立绘与镜头，本层只负责"字读得清、选得动"）。
 * 纯 DOM：要读中文长句、要滚动、要点击，这些都是 canvas 不擅长的（tech-arch §10.5 的 UI 分工）。
 *
 * 它不认识 Quests / 背包 / 旗标：只把玩家的选择回吐给 main.ts（`onChoose` / `onAdvance`），
 * 效果结算在那边统一做——UI 不做第二个真值。
 */

const CSS = `
#dialogue { position:fixed; left:0; right:0; bottom:0; z-index:22; display:none;
  font-family: Georgia, "Songti SC", "STSong", "SimSun", serif; color:#e8dfcb; pointer-events:none; }
#dialogue.on { display:block; pointer-events:auto; }
#dialogue .wrap { max-width:min(960px, 92vw); margin:0 auto 34px; padding:0 12px; }
#dialogue .box { background:linear-gradient(180deg, rgba(14,16,22,.86), rgba(9,10,15,.94));
  border-left:3px solid rgba(201,180,88,.65); padding:16px 22px 14px; box-shadow:0 14px 40px rgba(0,0,0,.5); }
#dialogue .who { font-size:14px; letter-spacing:.22em; color:#c9b458; margin-bottom:8px; }
#dialogue .who .em { opacity:.5; font-size:12px; letter-spacing:.1em; margin-left:10px; }
#dialogue .line { font-size:17px; line-height:1.75; letter-spacing:.02em; }
#dialogue .choices { margin-top:14px; display:flex; flex-direction:column; gap:2px; }
#dialogue .ch { display:flex; gap:12px; padding:7px 10px; cursor:pointer; border-left:2px solid transparent; }
#dialogue .ch:hover { background:rgba(255,184,107,.10); border-left-color:#ffb86b; }
#dialogue .ch .k { color:#ffb86b; opacity:.85; min-width:16px; font-variant-numeric:tabular-nums; }
#dialogue .ch .t { flex:1; font-size:15px; line-height:1.6; }
#dialogue .ch .s { font-size:11px; opacity:.4; letter-spacing:.1em; align-self:center; }
#dialogue .hint { margin-top:10px; font-size:12px; opacity:.45; letter-spacing:.08em; }
`

const STYLE_LABEL: Record<string, string> = { blunt: '直', poetic: '诗', silent: '默', provoke: '激' }

export interface DialogueHooks {
  /** 玩家选了第 index 个选项（1 起） */
  onChoose: (choiceId: string) => void
  /** 无选项节点：按一下继续 */
  onAdvance: () => void
  /** 玩家主动离开（Esc）——与"说到尽头"不同，调用方据此决定要不要提示 */
  onClose: () => void
}

export class DialogueBox {
  private readonly root: HTMLDivElement
  private view: DialogueView | null = null
  private speakerName: (id: string) => string = (id) => id

  constructor(private readonly hooks: DialogueHooks) {
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
    this.root = document.createElement('div')
    this.root.id = 'dialogue'
    document.body.appendChild(this.root)
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-ch]') as HTMLElement | null
      if (el?.dataset.ch) { this.hooks.onChoose(el.dataset.ch); return }
      if (this.view && this.view.choices.length === 0) this.hooks.onAdvance()
    })
    window.addEventListener('keydown', (e) => this.onKey(e))
  }

  /** 说话人 id → 显示名（由 main.ts 注入 npcs.json 的查表，UI 不自己持有数据表） */
  setSpeakerResolver(fn: (id: string) => string): void { this.speakerName = fn }

  get isOpen(): boolean { return this.view !== null }

  show(view: DialogueView): void {
    this.view = view
    this.root.classList.add('on')
    this.render()
  }

  hide(): void {
    this.view = null
    this.root.classList.remove('on')
    this.root.innerHTML = ''
  }

  private onKey(e: KeyboardEvent): void {
    const v = this.view
    if (!v) return
    if (e.code === 'Escape') { e.preventDefault(); this.hooks.onClose(); return }
    if (v.choices.length > 0) {
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= v.choices.length) {
        e.preventDefault()
        const c = v.choices[n - 1]
        if (c) this.hooks.onChoose(c.id)
      }
      return
    }
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') { e.preventDefault(); this.hooks.onAdvance() }
  }

  private render(): void {
    const v = this.view
    if (!v) return
    const who = this.speakerName(v.speaker)
    const em = v.emotion ? `<span class="em">${v.emotion}</span>` : ''
    const choices = v.choices.map((c) =>
      `<div class="ch" data-ch="${c.id}"><span class="k">${c.index}</span><span class="t">${c.text}</span><span class="s">${STYLE_LABEL[c.style] ?? ''}</span></div>`,
    ).join('')
    const hint = v.choices.length > 0
      ? '1-9 选择 · Esc 离开'
      : '空格 / 回车 继续 · Esc 离开'
    this.root.innerHTML = `
      <div class="wrap"><div class="box">
        <div class="who">${who}${em}</div>
        <div class="line">${v.text}</div>
        ${choices ? `<div class="choices">${choices}</div>` : ''}
        <div class="hint">${hint}</div>
      </div></div>`
  }
}
