import type { UiIntent } from '@/core/Input'
import { getLang, t } from '@/i18n/Lang'
import type { DescendRun } from '@/quest/Descend'

/**
 * src/ui/DescendPanel.ts — KI-737「深处」的玩家侧屏。
 *
 * 只做三件事，每一件都从注入的 `DescendRun` 现读：
 *   ① 这一层的标题/声音/指路语/在场的人/可看的六处 —— 全部来自扇区表（已审）或它的确定性复沓；
 *   ② 三条可做的动作 + 它们**此刻**做没做过（已审层读真旗标，复沓层读本次手记）；
 *   ③ 走法：再下一层 / 回上一层 / 回地表。**深度不落存档**（理由写在 `quest/Descend.ts` 的文件头）。
 *
 * 纪律（与调音桩面板、区域图同一条）：
 * - 面板**不自己收自己**：`onRequestClose` 交给持有者（`main.ts` 的 `setOverlay`），世界停摆与输入
 *   交还也在那一处——第一版「遮罩点击直接 hide」在调音桩上翻过车（KI-061），这里不重开一条。
 * - 菜单读数只有 `uiStep` 一个入口（KI-062）；DOM 点击走同一条动作函数，不在监听器里另写一份判断。
 * - 屏幕上不出现码值：动作状态、层号、复沓遭数全部经 `t()` 出来（中英两表都在 `i18n/Lang.ts`）。
 */

const CSS = `
.descend-root { position: fixed; inset: 0; z-index: 42; display: none;
  font-family: Georgia, "Songti SC", "STSong", "SimSun", serif; color: #e8dfcb;
  background: radial-gradient(ellipse 90% 70% at 50% 40%, rgba(10,11,16,.82), rgba(4,5,8,.94) 78%);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
.descend-root.on { display: block; }
.descend-root .dp { position: absolute; inset: 3.2vh 3.2vw; display: grid;
  grid-template-rows: auto minmax(0,1fr) auto auto; gap: 12px; padding: 18px 20px 16px;
  border: 1px solid rgba(201,180,88,.28); border-radius: 3px;
  background: linear-gradient(180deg, rgba(16,17,23,.92), rgba(9,10,15,.94));
  box-shadow: inset 0 0 0 1px rgba(201,180,88,.06), 0 24px 70px rgba(0,0,0,.6); }
.descend-root .dp::before { content: ""; position: absolute; inset: 7px; border: 1px solid rgba(201,180,88,.1);
  border-radius: 2px; pointer-events: none; }
.descend-root header { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.descend-root header h1 { margin: 0; font-size: 26px; letter-spacing: .18em; font-weight: 400;
  color: #e6d79b; text-shadow: 0 0 14px rgba(201,180,88,.22); }
.descend-root header .floor { font-size: 15px; letter-spacing: .12em; color: #c9b458; }
.descend-root header .badge { font-size: 11px; letter-spacing: .14em; padding: 3px 9px; border-radius: 999px;
  border: 1px solid rgba(201,180,88,.34); color: rgba(232,223,203,.72); }
.descend-root header .badge.recur { border-color: rgba(165,68,82,.5); color: #d8a0a8; }
.descend-root .grid { display: grid; grid-template-columns: minmax(0,1.05fr) minmax(0,1.25fr) minmax(0,1fr);
  gap: 16px; min-height: 0; }
.descend-root section { min-width: 0; min-height: 0; overflow: auto; padding: 10px 12px;
  border: 1px solid rgba(201,180,88,.14); border-radius: 2px; background: rgba(255,255,255,.014); }
.descend-root section::-webkit-scrollbar { width: 6px; }
.descend-root section::-webkit-scrollbar-thumb { background: rgba(201,180,88,.24); border-radius: 3px; }
.descend-root h2 { margin: 0 0 8px; font-size: 11px; letter-spacing: .22em; font-weight: 400;
  color: rgba(201,180,88,.66); text-transform: none; }
.descend-root .title { font-size: 18px; line-height: 1.45; color: #efe6cf; word-break: break-word; }
.descend-root .kv { margin-top: 10px; font-size: 13px; line-height: 1.6; color: rgba(232,223,203,.8); }
.descend-root .kv b { display: block; font-weight: 400; font-size: 11px; letter-spacing: .18em;
  color: rgba(201,180,88,.55); margin-bottom: 2px; }
.descend-root ul { list-style: none; margin: 0; padding: 0; }
.descend-root li.mark { position: relative; padding: 5px 0 5px 16px; font-size: 13px; line-height: 1.5;
  color: rgba(232,223,203,.86); border-bottom: 1px dashed rgba(201,180,88,.08); }
.descend-root li.mark::before { content: "·"; position: absolute; left: 3px; color: rgba(201,180,88,.6); }
.descend-root .row { display: flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left;
  padding: 8px 10px; margin-bottom: 6px; font: inherit; font-size: 13px; line-height: 1.45;
  color: #e8dfcb; background: rgba(255,255,255,.02); border: 1px solid rgba(201,180,88,.16);
  border-radius: 2px; cursor: pointer; transition: background .12s, border-color .12s, transform .12s; }
.descend-root .row:hover { background: rgba(201,180,88,.08); border-color: rgba(201,180,88,.34); }
.descend-root .row.sel { background: rgba(201,180,88,.13); border-color: rgba(201,180,88,.62);
  box-shadow: inset 0 0 0 1px rgba(201,180,88,.14); }
.descend-root .row[disabled] { opacity: .42; cursor: default; }
.descend-root .row .st { margin-left: auto; flex: none; font-size: 11px; letter-spacing: .1em;
  color: rgba(201,180,88,.72); }
.descend-root .row.nav { color: rgba(232,223,203,.78); }
.descend-root .row.nav.deep { border-color: rgba(201,180,88,.32); color: #ece2c1; }
.descend-root footer { display: grid; gap: 6px; font-size: 12px; line-height: 1.55;
  color: rgba(232,223,203,.56); }
.descend-root footer .tip { color: rgba(201,180,88,.72); }
.descend-root footer .honest { color: rgba(165,140,120,.78); }
.descend-root footer .journal { color: rgba(232,223,203,.62); }
@media (max-width: 980px) {
  .descend-root .grid { grid-template-columns: minmax(0,1fr); grid-auto-rows: minmax(0,1fr); }
  .descend-root .dp { inset: 2vh 2vw; }
}
@media (prefers-reduced-motion: reduce) { .descend-root .row { transition: none; } }
`

export interface DescendPanelDeps {
  run: DescendRun
  /** 面板不自己收自己（KI-061 的教训） */
  onRequestClose: () => void
  /** KI-739：只报「发生了什么」（下了一层 / 做了一件事），送什么字段由宿主决定 */
  onEvent?: (type: string, meta: { dep: number }) => void
}

type Row = { kind: 'act'; index: number } | { kind: 'nav'; nav: 'descend' | 'ascend' | 'surface' | 'close' }

export class DescendPanel {
  private readonly root: HTMLDivElement
  private readonly deps: DescendPanelDeps
  private open = false
  private focus = 0

  constructor(deps: DescendPanelDeps) {
    this.deps = deps
    DescendPanel.injectCss()
    this.root = document.createElement('div')
    this.root.id = 'descend-panel'
    this.root.className = 'descend-root'
    this.root.setAttribute('aria-hidden', 'true')
    this.root.setAttribute('role', 'dialog')
    this.root.setAttribute('aria-label', t('ui.descend.title'))
    document.body.appendChild(this.root)
    // 菜单读数只有 `uiStep` 一个入口；DOM 点击只负责把「点了第几行」翻译成同一个动作函数
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement | null)?.closest('[data-row]') as HTMLElement | null
      if (!el) return
      const row = this.rows()[Number(el.dataset.row)]
      if (!row) return
      this.focus = Number(el.dataset.row)
      this.activate()
      this.render()
    })
  }

  get isOpen(): boolean { return this.open }

  show(): void {
    this.open = true
    this.focus = 0
    this.root.classList.add('on')
    this.root.setAttribute('aria-hidden', 'false')
    this.render()
  }

  close(): void {
    this.open = false
    this.root.classList.remove('on')
    this.root.setAttribute('aria-hidden', 'true')
  }

  /** 菜单通道（KI-062）：只在开着且有边沿时才动 */
  uiStep(intents: ReadonlySet<UiIntent>): void {
    if (!this.open || intents.size === 0) return
    if (intents.has('back')) { this.deps.onRequestClose(); return }
    const n = this.rows().length
    if (!n) return
    if (intents.has('up')) { this.focus = (this.focus + n - 1) % n; this.render(); return }
    if (intents.has('down')) { this.focus = (this.focus + 1) % n; this.render(); return }
    if (intents.has('confirm')) { this.activate(); this.render() }
  }

  private rows(): Row[] {
    const floor = this.deps.run.floor()
    const acts: Row[] = (floor?.actions ?? []).map((_, i) => ({ kind: 'act' as const, index: i }))
    return [
      ...acts,
      { kind: 'nav', nav: 'descend' },
      { kind: 'nav', nav: 'ascend' },
      { kind: 'nav', nav: 'surface' },
      { kind: 'nav', nav: 'close' },
    ]
  }

  private activate(): void {
    const row = this.rows()[this.focus]
    if (!row) return
    const run = this.deps.run
    if (row.kind === 'act') { run.choose(row.index); this.deps.onEvent?.('descend-act', { dep: run.depth }); return }
    if (row.nav === 'descend') { run.descend(); this.deps.onEvent?.('descend-floor', { dep: run.depth }) }
    else if (row.nav === 'ascend') run.ascend()
    else if (row.nav === 'surface') run.surface()
    else this.deps.onRequestClose()
  }

  private render(): void {
    const run = this.deps.run
    const floor = run.floor()
    if (!floor) return
    // 表里的 zh/en 是**两条独立的正典文本**，不是一条机器翻译：面板按当前语言整段挑一边，
    // 不做拼接（中英夹杂就是这条规则的反面）。`getLang()` 是唯一读数口。
    const zh = getLang() !== 'en'
    const s = floor.sector
    const rows = this.rows()
    const actRows = rows.filter((r): r is { kind: 'act'; index: number } => r.kind === 'act')
    const navRow = (nav: 'descend' | 'ascend' | 'surface' | 'close', label: string, cls = ''): string => {
      const i = rows.findIndex((r) => r.kind === 'nav' && r.nav === nav)
      return `<button class="row nav ${cls}${i === this.focus ? ' sel' : ''}" data-row="${i}">${label}</button>`
    }
    const marks = s.marks.map((m) => `<li class="mark">${zh ? m.zh : m.en}</li>`).join('')
    const acts = actRows.map((r) => {
      const a = floor.actions[r.index]
      const done = run.done(floor.depth, r.index)
      return `<button class="row${r.index === this.focus ? ' sel' : ''}" data-row="${r.index}"${done ? ' disabled' : ''}>
        <span>${zh ? a.labelZh : a.labelEn}</span>
        <span class="st">${done ? t('ui.descend.done') : ''}</span></button>`
    }).join('')

    this.root.innerHTML = `
      <div class="dp">
        <header>
          <h1>${t('ui.descend.title')}</h1>
          <span class="floor">${t('ui.descend.floor', { n: floor.depth })}</span>
          <span class="badge${floor.charted ? '' : ' recur'}">${
            floor.charted ? t('ui.descend.charted', { n: run.charted }) : t('ui.descend.recurrence', { n: floor.recurrence })
          }</span>
        </header>
        <div class="grid">
          <section>
            <h2>${t('ui.descend.here')}</h2>
            <div class="title">${zh ? s.titleZh : s.titleEn}</div>
            <div class="kv"><b>${t('ui.descend.sound')}</b>${zh ? s.soundZh : s.soundEn}</div>
            <div class="kv"><b>${t('ui.descend.guide')}</b>${zh ? s.guideZh : s.guideEn}</div>
            <div class="kv"><b>${t('ui.descend.person')}</b>${zh ? s.personZh : s.personEn}</div>
          </section>
          <section>
            <h2>${t('ui.descend.marks', { n: s.marks.length })}</h2>
            <ul>${marks}</ul>
          </section>
          <section>
            <h2>${t('ui.descend.actions')}</h2>
            ${acts}
            <h2 style="margin-top:12px">${t('ui.descend.nav')}</h2>
            ${navRow('descend', t('ui.descend.descend'), 'deep')}
            ${navRow('ascend', t('ui.descend.ascend'))}
            ${navRow('surface', t('ui.descend.surface'))}
            ${navRow('close', t('ui.descend.close'))}
          </section>
        </div>
        <footer>
          <div class="tip">${t('ui.descend.tip', { charted: run.charted })}</div>
          <div class="honest">${t('ui.descend.honest', { charted: run.charted })}</div>
          <div class="journal">${t('ui.descend.journal', { n: run.journal.length })}</div>
        </footer>
      </div>`
  }

  private static injectCss(): void {
    if (document.getElementById('descend-panel-css')) return
    const style = document.createElement('style')
    style.id = 'descend-panel-css'
    style.textContent = CSS
    document.head.appendChild(style)
  }
}
