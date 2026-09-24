import { registry } from '@/core/Registry'
import { ATTR_KEYS } from '@/rpg/Progression'
import { allGearItems } from '@/rpg/Loot'
import type { OriginData, ProgressionData } from '@/data/schema'

/**
 * 开场「定弦」（KI-031② / §2.2）。出身是叙事动作而不是设置项：这一屏在 `loop.start()`
 * 之前把世界按住，选中的那根弦由 `RpgRuntime.restring` 落进成长层——屏上不许有任何
 * 一条写死的出身文案，五张卡全部从 progression.json / weapons.json 现读。
 *
 * 本文件同时住着一个**纯数据侧车** `titleCards()`：不碰 DOM，flow/unit 测试直接吃它，
 * "卡面 == 表"这条对账因此有机器证人；类本身只在构造时挂 DOM（Stakerite 同款模式）。
 */

export interface TitleCard {
  id: string
  name: string
  blurb: string
  weaponName: string
  /** 六维 [{基音,6},…]——label 也来自 attrs 表，不是第二份常数 */
  attrs: { label: string; value: number }[]
  /** §2.2 出身被动那一句话（无被动的出身为 null；文案来自表，不在 UI 里另抄） */
  passive: string | null
}

/** 出身卡面：顺序就是 progression.json origins[] 的顺序（表序即 UI 序，§55） */
export function titleCards(): TitleCard[] {
  const d = registry.get<ProgressionData>('progression')
  const attrLabel = (key: string): string =>
    d.attrs.find((a) => a.key === key)?.displayName ?? key
  return d.origins.map((o: OriginData) => {
    // 武器的中文名住在**装备件**上（weapons.json 没有 displayName——件才是玩家"持有"的东西），
    // 查找与 RpgRuntime 出身造装走的是同一条判据：gear.weaponId === 出身武器。
    const gearItem = allGearItems().find((it) => it.gear?.weaponId === o.weaponId)
    return {
      id: o.id,
      name: o.displayName,
      blurb: o.blurb ?? '',
      weaponName: gearItem?.displayName ?? o.weaponId,
      attrs: ATTR_KEYS.map((k) => ({ label: attrLabel(k), value: o.attrs[k] })),
      passive: o.passive?.label ?? null
    }
  })
}

const CSS = `
#title{position:fixed;inset:0;z-index:60;display:none;flex-direction:column;align-items:center;justify-content:center;gap:2.2vh;background:radial-gradient(ellipse at 50% 40%,#171413 0%,#0b0a0a 70%);color:#e8dfcb;font-family:Georgia,"Songti SC","STSong","SimSun",serif}
#title.on{display:flex}
#title h1{margin:0;font-size:5.4vh;font-weight:normal;letter-spacing:1.2vh;color:#e8dfcb}
#title .sub{font-size:1.9vh;letter-spacing:.6vh;color:#8a7f6d}
#title .cards{display:flex;gap:1.4vw}
#title .card{width:15vw;padding:1.6vh 1vw;border:1px solid #3d372e;background:rgba(23,20,19,.72);cursor:pointer;text-align:center}
#title .card.sel{border-color:#c9b458;box-shadow:0 0 2.4vh rgba(201,180,88,.35)}
#title .card .nm{font-size:2.3vh;color:#ffb86b}
#title .card .wp{font-size:1.7vh;color:#c9b458;margin:.6vh 0}
#title .card .bl{font-size:1.45vh;color:#8a7f6d;min-height:8vh;line-height:1.5}
#title .card .ps{font-size:1.45vh;color:#d0a76a;margin:.3vh 0}
#title .card .at{font-size:1.5vh;color:#b7ab95;text-align:left;display:inline-block}
#title .acts{display:flex;gap:2vw;font-size:2vh}
#title .act{padding:.8vh 2.4vh;border:1px solid #3d372e;cursor:pointer;color:#b7ab95}
#title .act.sel{border-color:#ffb86b;color:#ffb86b}
#title .hint{font-size:1.5vh;color:#5f584c}
`

export interface TitleHooks {
  /** 选定出身开新弦：由 main.ts 调 `rpg.restring(id)` + 开环 */
  onNew: (originId: string) => void
  /** 续档（只有存在自动存档时才可能走到） */
  onContinue: () => void
}

type Focus = { kind: 'card' | 'continue'; index: number }

export class TitleScreen {
  private readonly root: HTMLDivElement
  private focus: Focus = { kind: 'card', index: 0 }
  private readonly cards: TitleCard[]
  private readonly onKey = (e: KeyboardEvent): void => { this.key(e) }

  constructor(private readonly hooks: TitleHooks, hasSave: boolean, preselectId?: string) {
    this.cards = titleCards()
    const pre = this.cards.findIndex((c) => c.id === preselectId)
    if (pre >= 0) this.focus = { kind: 'card', index: pre }
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
    this.root = document.createElement('div')
    this.root.id = 'title'
    document.body.appendChild(this.root)
    this.root.dataset.hasSave = hasSave ? '1' : '0'
    this.root.addEventListener('click', (e) => this.click(e))
    window.addEventListener('keydown', this.onKey)
    this.render()
    this.show()
  }

  get isOpen(): boolean { return this.root.classList.contains('on') }

  show(): void { this.root.classList.add('on') }

  /** 决策完成后整体退场（DOM 与监听都不留——总线纪律同款：谁挂的谁摘） */
  dispose(): void {
    window.removeEventListener('keydown', this.onKey)
    this.root.remove()
  }

  /** 程序化选新弦（live 探针与测试走这条，不依赖键盘事件真的抵达） */
  pickNew(originId: string): void { this.hooks.onNew(originId) }

  private key(e: KeyboardEvent): void {
    if (!this.isOpen) return
    const hasSave = this.root.dataset.hasSave === '1'
    const n = this.cards.length
    switch (e.code) {
      case 'ArrowLeft': this.focus = { kind: 'card', index: (this.focus.index + n - 1) % n }; break
      case 'ArrowRight': this.focus = { kind: 'card', index: (this.focus.index + 1) % n }; break
      case 'ArrowDown': case 'ArrowUp':
        if (hasSave) this.focus = this.focus.kind === 'card' ? { kind: 'continue', index: 0 } : { kind: 'card', index: this.focus.index }
        break
      case 'Enter':
        if (this.focus.kind === 'card') this.hooks.onNew(this.cards[this.focus.index].id)
        else if (hasSave) this.hooks.onContinue()
        break
      default: return
    }
    e.preventDefault()
    this.render()
  }

  private click(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null
    if (!el) return
    const act = el.dataset.act!
    if (act === 'card') this.hooks.onNew(el.dataset.arg!)
    else if (act === 'continue') this.hooks.onContinue()
  }

  private render(): void {
    const hasSave = this.root.dataset.hasSave === '1'
    const cards = this.cards.map((c, i) => `
      <div class="card${this.focus.kind === 'card' && this.focus.index === i ? ' sel' : ''}" data-act="card" data-arg="${c.id}">
        <div class="nm">${c.name}</div>
        <div class="wp">${c.weaponName}</div>
        <div class="bl">${c.blurb}</div>
        ${c.passive ? `<div class="ps">被动 · ${c.passive}</div>` : ''}
        <div class="at">${c.attrs.map((a) => `${a.label} ${a.value}`).join('<br>')}</div>
      </div>`).join('')
    const cont = hasSave
      ? `<div class="act${this.focus.kind === 'continue' ? ' sel' : ''}" data-act="continue">续 · 回到上次调音桩</div>`
      : ''
    this.root.innerHTML = `
      <h1>止音纪元</h1>
      <div class="sub">CAESURA · 为她定一根弦</div>
      <div class="cards">${cards}</div>
      <div class="acts">${cont}</div>
      <div class="hint">←/→ 选弦 · Enter 定弦 · ${hasSave ? '↓ 续档' : '本机没有可续的存档'}</div>`
  }
}
