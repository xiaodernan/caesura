import { registry } from '@/core/Registry'
import type { UiIntent } from '@/core/Input'
import { ATTR_KEYS } from '@/rpg/Progression'
import { allGearItems } from '@/rpg/Loot'
import type { SlotCard } from '@/save/Slots'
import { SAVE_CARD_CSS, saveCardHtml, saveCards, type SaveCardView } from './SaveSlots'
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
#title .slot.sel .scard{border-color:#c9b458;box-shadow:0 0 2.4vh rgba(201,180,88,.35)}
#title .slot .scard{cursor:default}
/* 摘要卡的基准字号：卡片那一套是 em（见 SaveSlots.SAVE_CARD_CSS），尺度由宿主给 */
#title .scards{font-size:1.7vh}
`

export interface TitleHooks {
  /** 选定出身开新弦：由 main.ts 调 `rpg.restring(id)` + 开环（确认屏之后才会走到） */
  onNew: (originId: string) => void
  /** 续档：读的是**玩家在这屏上选中的那一格**，不是写死的 autosave（KI-025②） */
  onContinue: (slot: string) => void
  /** 存档名册（`save/Slots.ts`）：卡面从它现读，标题屏自己不碰存储键位 */
  listSlots: () => Promise<SlotCard[]>
}

type Mode = 'string' | 'slots' | 'confirm'

type Focus = { kind: 'card' | 'continue' | 'slot' | 'new'; index: number }

export class TitleScreen {
  private readonly root: HTMLDivElement
  private focus: Focus = { kind: 'card', index: 0 }
  private readonly cards: TitleCard[]
  private mode: Mode = 'string'
  private slotViews: SaveCardView[] = []
  private slotsLoaded = false
  /** 确认屏上待开的那根弦：只有"确认"才把它交出去 */
  private pendingOrigin: string | null = null

  constructor(private readonly hooks: TitleHooks, preselectId?: string) {
    this.cards = titleCards()
    const pre = this.cards.findIndex((c) => c.id === preselectId)
    if (pre >= 0) this.focus = { kind: 'card', index: pre }
    const style = document.createElement('style')
    style.textContent = CSS + SAVE_CARD_CSS
    document.head.appendChild(style)
    this.root = document.createElement('div')
    this.root.id = 'title'
    document.body.appendChild(this.root)
    this.root.addEventListener('click', (e) => this.click(e))
    this.show()
    this.render() // 先画一屏（hint 是"正在查看本机存档…"），名册回来再换：构造即空屏会闪一下白
    // 「有没有档可续」是问名册，不是问主存位的裸 key：以前那种问法看不见恢复位，
    // 于是"卡上说没有可续的存档"与"点 load 其实读得出来"能同时成立（一次假账）。
    void (async () => {
      this.slotViews = saveCards(await this.hooks.listSlots())
      this.slotsLoaded = true
      this.render()
    })()
  }

  get isOpen(): boolean { return this.root.classList.contains('on') }

  /** 有档可读 = 四格里至少一格是 ok / restored（空槽与坏档都不算） */
  get hasSaveable(): boolean { return this.slotsLoaded && this.slotViews.some((v) => v.selectable) }

  /** 有没有"摆着却读不出来"的档：这不影响能不能续，但一定要说出来（§78：坏消息也是消息） */
  get hasBlocked(): boolean { return this.slotViews.some((v) => v.state === 'blocked') }

  /**
   * 能不能进挑档屏：**有可读的档**（去续）或**有读不出来的档**（去看原因）都算。
   * 只在前者才给进的话，"读不出来"这句话就成了死路——屏上告诉你坏了，又不给看坏在哪。
   */
  private get canBrowseSlots(): boolean { return this.hasSaveable || this.hasBlocked }

  show(): void { this.root.classList.add('on') }

  /**
   * 决策完成后整体退场：先灭 `on` 再摘 DOM——`uiStep` 的第一句就是 `isOpen`，所以这一步之后
   * 就算还有人把意图喂过来（`leaveTitle()` 与钩子之间的空档），这一屏也一格都不动。
   * 键盘读数从来不由本屏挂，因此这里也没有监听器要摘（KI-062 第二腿）。
   */
  dispose(): void {
    this.root.classList.remove('on')
    this.root.remove()
  }

  /** 直接进某一段（测试与 live 探针用；不伪装成键盘事件，也不绕过确认屏） */
  async goto(mode: Mode): Promise<void> {
    if (mode === 'slots' && !this.slotsLoaded) await new Promise((r) => setTimeout(r, 0))
    this.mode = mode
    if (mode === 'slots') this.focus = { kind: 'slot', index: 0 }
    this.render()
  }

  private slots(): SaveCardView[] { return this.slotViews.filter((v) => v.selectable) }

  private chooseNew(originId: string): void {
    // 名册还没回来 ⇒ 此刻**不知道**有没有档要保护。这时候开新弦等于赌"大概没有吧"，
    // 而赌输的代价是玩家下一次休息把自动槽写掉——真丢档。所以这一律不动，等读数到齐。
    if (!this.slotsLoaded) { this.render(); return }
    if (!this.hasSaveable) { this.hooks.onNew(originId); return }
    this.pendingOrigin = originId
    this.mode = 'confirm'
    // 焦点落在"取消"：破坏性动作的默认项必须是安全的那一个（需求 §45 的防误删）
    this.focus = { kind: 'new', index: 0 }
    this.render()
  }

  /**
   * 菜单读数的**唯一入口**（KI-062 第二腿，与 `Stakerite` / `MapUI` / `DialogueBox` 同一份约定）：
   * 键码与十字键/摇杆都在 `core/Input.ts` 折成 `UiIntent`，由持有者每帧喂进来，本屏不挂 `keydown`。
   *
   * 三段屏各有各的"后退"，而**定弦屏没有上层可退** ⇒ 它的 `back` 一格效果都没有（不是漏接：
   * 这一屏就是根，`tests/unit/title-screen.test.ts` 里那条"根屏不许自己关掉自己"盯着它）。
   * `slots` 屏的 `←` 仍算后退——那是它原本的说法，手柄上没有"左方向键"这个后退键之外的东西。
   */
  uiStep(intents: ReadonlySet<UiIntent>): void {
    if (!this.isOpen || intents.size === 0) return
    const n = this.cards.length
    switch (this.mode) {
      case 'string':
        if (intents.has('left')) this.focus = { kind: 'card', index: (this.focus.index + n - 1) % n }
        else if (intents.has('right')) this.focus = { kind: 'card', index: (this.focus.index + 1) % n }
        else if (intents.has('up') || intents.has('down')) {
          if (!this.canBrowseSlots) return
          this.focus = { kind: 'continue', index: 0 }
        } else if (intents.has('confirm')) {
          if (this.focus.kind === 'card') this.chooseNew(this.cards[this.focus.index].id)
          else if (this.canBrowseSlots) { this.mode = 'slots'; this.focus = { kind: 'slot', index: 0 } }
          else return
        } else return
        break
      case 'slots': {
        // 焦点只在**可读的那几格**里走；一格都不可读（全是坏档）时这一屏只用来读原因，back 回去
        const m = this.slots().length
        if (intents.has('up')) {
          if (!m) return
          this.focus = { kind: 'slot', index: (this.focus.index + m - 1) % m }
        } else if (intents.has('down')) {
          if (!m) return
          this.focus = { kind: 'slot', index: (this.focus.index + 1) % m }
        } else if (intents.has('confirm')) {
          const v = this.slots()[this.focus.index]
          if (v) this.hooks.onContinue(v.slot)
          return
        } else if (intents.has('back') || intents.has('left')) {
          this.mode = 'string'; this.focus = { kind: 'card', index: 0 }
        } else return
        break
      }
      case 'confirm':
        if (intents.has('left')) this.focus = { kind: 'new', index: 0 }
        else if (intents.has('right')) this.focus = { kind: 'new', index: 1 }
        else if (intents.has('confirm')) {
          if (this.focus.index === 1 && this.pendingOrigin) { const id = this.pendingOrigin; this.pendingOrigin = null; this.hooks.onNew(id) }
          else { this.mode = 'string'; this.pendingOrigin = null }
        } else if (intents.has('back')) { this.mode = 'string'; this.pendingOrigin = null }
        else return
        break
      default:
        return
    }
    this.render()
  }

  private click(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null
    if (!el || el.dataset.disabled) return
    const act = el.dataset.act!
    if (act === 'card') this.chooseNew(el.dataset.arg!)
    else if (act === 'continue') { this.mode = 'slots'; this.focus = { kind: 'slot', index: 0 } }
    else if (act === 'load') this.hooks.onContinue(el.dataset.arg!)
    else if (act === 'back') { this.mode = 'string'; this.focus = { kind: 'card', index: 0 } }
    else if (act === 'new-yes' && this.pendingOrigin) { const id = this.pendingOrigin; this.pendingOrigin = null; this.hooks.onNew(id) }
    else if (act === 'new-no') { this.mode = 'string'; this.pendingOrigin = null }
    else return
    this.render()
  }

  private renderString(): string {
    const cards = this.cards.map((c, i) => `
      <div class="card${this.focus.kind === 'card' && this.focus.index === i ? ' sel' : ''}" data-act="card" data-arg="${c.id}">
        <div class="nm">${c.name}</div>
        <div class="wp">${c.weaponName}</div>
        <div class="bl">${c.blurb}</div>
        ${c.passive ? `<div class="ps">被动 · ${c.passive}</div>` : ''}
        <div class="at">${c.attrs.map((a) => `${a.label} ${a.value}`).join('<br>')}</div>
      </div>`).join('')
    const cont = this.canBrowseSlots
      ? `<div class="act${this.focus.kind === 'continue' ? ' sel' : ''}" data-act="continue">${this.hasSaveable ? '续 · 挑一格回到上次调音桩' : '查看 · 本机有读不出来的存档'}</div>`
      : ''
    const hint = !this.slotsLoaded ? '正在查看本机存档…'
      : this.hasSaveable ? '←/→ 选弦 · Enter 定弦 · ↓ 挑存档'
        // 「没有可续的档」与「有档但读不出来」是两件事：后者要说出来，否则玩家以为自己很干净，
        // 下一次休息就把那一格覆盖了。原因的原话在卡上（挑档屏/存档页都看得到）。
        : this.hasBlocked ? '本机有存档，但读不出来 · ↓ 看是哪一格' : '本机没有可续的存档'
    return `
      <h1>止音纪元</h1>
      <div class="sub">CAESURA · 为她定一根弦</div>
      <div class="cards">${cards}</div>
      <div class="acts">${cont}</div>
      <div class="hint">${hint}</div>`
  }

  private renderSlots(): string {
    const pick = this.slots()
    const html = this.slotViews.map((v) => {
      const i = pick.findIndex((p) => p.slot === v.slot)
      return `<div class="slot${i >= 0 && i === this.focus.index ? ' sel' : ''}">${saveCardHtml(v, ['load'])}</div>`
    }).join('')
    return `
      <h1>止音纪元</h1>
      <div class="sub">挑一格 · Enter 读取 · ← 返回定弦</div>
      <div class="scards">${html}</div>
      <div class="acts"><div class="act" data-act="back">返回定弦</div></div>`
  }

  private renderConfirm(): string {
    const v = this.slotViews.find((x) => x.selectable)
    const line = v ? `${v.label} · ${v.lines.join(' · ')}` : ''
    return `
      <h1>开一根新弦</h1>
      <div class="sub">本机已有可读的存档。开新弦不会立刻动它，但下一次休息会把自动槽写掉。</div>
      <div class="sub">${line}</div>
      <div class="acts">
        <div class="act${this.focus.index === 0 ? ' sel' : ''}" data-act="new-no">取消 · 回去挑存档</div>
        <div class="act${this.focus.index === 1 ? ' sel' : ''}" data-act="new-yes">确认开新弦</div>
      </div>
      <div class="hint">←/→ 选 · Enter 确认</div>`
  }

  private render(): void {
    this.root.innerHTML =
      this.mode === 'slots' ? this.renderSlots()
        : this.mode === 'confirm' ? this.renderConfirm()
          : this.renderString()
  }
}
