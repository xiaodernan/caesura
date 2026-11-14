import { registry } from '@/core/Registry'
import type { UiIntent } from '@/core/Input'
import { ATTR_KEYS } from '@/rpg/Progression'
import { allGearItems } from '@/rpg/Loot'
import type { SlotCard } from '@/save/Slots'
import { SAVE_CARD_CSS, saveCardHtml, saveCards, type SaveCardView } from './SaveSlots'
import type { OriginData, ProgressionData } from '@/data/schema'
import { getLang, setLang, t } from '@/i18n/Lang'

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
#title{position:fixed;inset:0;z-index:60;display:none;flex-direction:column;align-items:center;justify-content:center;gap:2.2vh;background:radial-gradient(ellipse at 50% 40%,#171413 0%,#0b0a0a 70%);color:#e8dfcb;font-family:Georgia,"Songti SC","STSong","SimSun",serif;overflow:hidden}
#title.on{display:flex}
/* == ember rite: ambient spotlight + slow sigil ring (pure CSS, zero JS) == */
#title::before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 64% 50% at 50% 32%,rgba(255,184,107,.085) 0%,rgba(255,184,107,.03) 36%,transparent 70%);animation:tg-breathe 9s ease-in-out infinite}
#title::after{content:'';position:absolute;left:50%;top:36%;width:78vh;height:78vh;transform:translate(-50%,-50%);border:1px solid rgba(201,180,88,.11);border-radius:50%;box-shadow:0 0 14vh rgba(201,180,88,.055),inset 0 0 14vh rgba(201,180,88,.05);pointer-events:none;animation:tg-spin 140s linear infinite}
@keyframes tg-breathe{0%,100%{opacity:.55}50%{opacity:1}}
@keyframes tg-spin{from{transform:translate(-50%,-50%) rotate(0)}to{transform:translate(-50%,-50%) rotate(360deg)}}
/* == drifting ember motes (one i each, deterministic nth-child lanes) == */
#title .embers{position:absolute;inset:0;overflow:hidden;pointer-events:none}
#title .embers i{position:absolute;bottom:-1vh;width:.34vh;height:.34vh;border-radius:50%;background:#ffb86b;opacity:0;box-shadow:0 0 .9vh rgba(255,184,107,.8);animation:tg-rise linear infinite}
#title .embers i:nth-child(1){left:8%;animation-duration:12s;animation-delay:0s}
#title .embers i:nth-child(2){left:15%;animation-duration:9s;animation-delay:2.4s}
#title .embers i:nth-child(3){left:21%;animation-duration:14s;animation-delay:5.1s}
#title .embers i:nth-child(4){left:27%;animation-duration:10s;animation-delay:1.2s}
#title .embers i:nth-child(5){left:33%;animation-duration:15s;animation-delay:7.8s}
#title .embers i:nth-child(6){left:39%;animation-duration:11s;animation-delay:3.6s}
#title .embers i:nth-child(7){left:45%;animation-duration:13s;animation-delay:6.3s}
#title .embers i:nth-child(8){left:51%;animation-duration:9.5s;animation-delay:.8s}
#title .embers i:nth-child(9){left:57%;animation-duration:16s;animation-delay:4.4s}
#title .embers i:nth-child(10){left:63%;animation-duration:12.5s;animation-delay:8.9s}
#title .embers i:nth-child(11){left:70%;animation-duration:10.5s;animation-delay:2.1s}
#title .embers i:nth-child(12){left:77%;animation-duration:14.5s;animation-delay:5.7s}
#title .embers i:nth-child(13){left:84%;animation-duration:11.5s;animation-delay:7.2s}
#title .embers i:nth-child(14){left:91%;animation-duration:13.5s;animation-delay:1.6s}
@keyframes tg-rise{0%{transform:translate3d(0,0,0) scale(1);opacity:0}6%{opacity:.9}45%{opacity:.55}100%{transform:translate3d(3.4vw,-97vh,0) scale(.35);opacity:0}}
/* == headline: liquid-metal gradient glyph + breathing glow == */
#title h1{margin:0;font-size:5.4vh;font-weight:normal;letter-spacing:1.2vh;background:linear-gradient(180deg,#fbf3dc 0%,#eee3c4 30%,#cbb98a 58%,#8d7d55 88%,#6f6242 100%);-webkit-background-clip:text;background-clip:text;color:transparent;animation:tg-glow 7s ease-in-out infinite;text-indent:1.2vh}
@keyframes tg-glow{0%,100%{filter:drop-shadow(0 0 2.1vh rgba(255,214,130,.24))}50%{filter:drop-shadow(0 0 4.6vh rgba(255,214,130,.44))}}
/* == subtitle: flanking gold hairlines == */
#title .sub{font-size:1.9vh;letter-spacing:.6vh;color:#a99c86;position:relative;padding:0 10vw}
#title .sub::before{content:'';position:absolute;top:50%;left:0;width:8vw;height:1px;background:linear-gradient(90deg,transparent,rgba(201,180,88,.75) 70%,rgba(255,205,120,.9))}
#title .sub::after{content:'';position:absolute;top:50%;right:0;width:8vw;height:1px;background:linear-gradient(270deg,transparent,rgba(201,180,88,.75) 70%,rgba(255,205,120,.9))}
#title .cards{display:flex;gap:1.4vw;position:relative;z-index:1}
/* == origin cards: hover lift + top gold sweep + selected gold-ring pulse == */
#title .card{width:15vw;padding:1.6vh 1vw;border:1px solid #3d372e;background:linear-gradient(180deg,rgba(31,28,26,.78) 0%,rgba(23,20,19,.72) 55%,rgba(16,14,13,.78) 100%);cursor:pointer;text-align:center;position:relative;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(201,180,88,.1),0 .8vh 2vh rgba(0,0,0,.35);transition:transform .3s cubic-bezier(.2,.9,.3,1.15),border-color .3s,box-shadow .3s}
#title .card::after{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,217,138,0),transparent);transition:background .3s}
#title .card:hover{transform:translateY(-.75vh);border-color:#6b5f3f;box-shadow:0 1.6vh 3.4vh rgba(0,0,0,.5),0 0 2.2vh rgba(201,180,88,.14)}
#title .card:hover::after{background:linear-gradient(90deg,transparent,rgba(255,217,138,.85),transparent)}
#title .card.sel{border-color:#c9b458;animation:tg-selpulse 2.6s ease-in-out infinite}
@keyframes tg-selpulse{0%,100%{box-shadow:0 0 0 1px rgba(201,180,88,.4),0 0 2.4vh rgba(201,180,88,.24),inset 0 0 2.2vh rgba(201,180,88,.07)}50%{box-shadow:0 0 0 1px rgba(201,180,88,.6),0 0 4.2vh rgba(201,180,88,.44),inset 0 0 3.1vh rgba(201,180,88,.13)}}
#title .card .nm{font-size:2.3vh;color:#ffcf8a;text-shadow:0 0 1.8vh rgba(255,184,107,.4),0 .3vh .6vh rgba(0,0,0,.55)}
#title .card .wp{font-size:1.7vh;color:#c9b458;margin:.6vh 0;letter-spacing:.12em}
#title .card .bl{font-size:1.45vh;color:#96897a;min-height:8vh;line-height:1.55}
#title .card .ps{font-size:1.45vh;color:#e0b87a;margin:.3vh 0}
#title .card .at{font-size:1.5vh;color:#c2b5a0;text-align:left;display:inline-block;line-height:1.6}
#title .acts{display:flex;gap:2vw;font-size:2vh;position:relative;z-index:1}
/* == actions: growing gold underline + selected inner glow == */
#title .act{padding:.8vh 2.4vh;border:1px solid #3d372e;cursor:pointer;color:#c2b5a0;position:relative;letter-spacing:.24em;transition:color .25s,border-color .25s,box-shadow .25s}
#title .act::after{content:'';position:absolute;left:50%;bottom:.35vh;width:0;height:1px;background:#ffb86b;box-shadow:0 0 .8vh rgba(255,184,107,.75);transition:left .3s ease,width .3s ease}
#title .act:hover{color:#ffb86b;border-color:#ffb86b}
#title .act:hover::after{left:12%;width:76%}
#title .act.sel{border-color:#ffb86b;color:#ffb86b;box-shadow:0 0 1.8vh rgba(255,184,107,.28),inset 0 0 1.4vh rgba(255,184,107,.12)}
#title .hint{font-size:1.5vh;color:#6f6759;border-top:1px solid rgba(201,180,88,.14);padding-top:1.1vh;letter-spacing:.18em}
#title .hint.subtle{font-size:1.05vh;opacity:.62;letter-spacing:.12em;border-top:0;padding-top:.42vh;color:rgba(242,237,228,.42);font-style:italic;text-transform:none}
#title .slot.sel .scard{border-color:#c9b458;box-shadow:0 0 2.4vh rgba(201,180,88,.35)}
#title .slot .scard{cursor:default}
#title .scards{font-size:1.7vh}
/* == accessibility: visible keyboard focus ring + reduced-motion kill switch == */
#title .card:focus-visible,#title .act:focus-visible{outline:2px solid #ffd98a;outline-offset:3px}
/* == 天象仪双环（一道虚、一道实）+ 画面压暗 vignette（pure CSS，无图片，仪典级 ambient rite） == */
#title .astro{position:absolute;left:50%;top:34%;width:106vh;height:106vh;transform:translate(-50%,-50%);border:1px dashed rgba(201,180,88,.13);border-radius:50%;pointer-events:none;animation:tg-astro 260s linear infinite;box-shadow:inset 0 0 8vh rgba(201,180,88,.03)}
#title .astro::after{content:'';position:absolute;inset:8vh;border:1px solid rgba(255,222,150,.07);border-radius:50%}
#title .astro::before{content:'';position:absolute;left:50%;top:-.32vh;width:.64vh;height:.64vh;transform:translate(-50%,0);background:radial-gradient(circle,rgba(255,217,138,.9) 0 30%,transparent 62%);border-radius:50%}
@keyframes tg-astro{from{transform:translate(-50%,-50%) rotate(0deg)}to{transform:translate(-50%,-50%) rotate(-360deg)}}
#title .vignette{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 128% 106% at 50% 46%,transparent 52%,rgba(4,4,7,.36) 79%,rgba(3,3,6,.78) 100%)}
#title .astro{opacity:.9}
#title ::-webkit-scrollbar{width:.6vh}
#title ::-webkit-scrollbar-thumb{background:#3d372e;border-radius:1vh}
@media (prefers-reduced-motion: reduce){#title *,#title *::before,#title *::after{animation:none !important;transition:none !important}}
#title .lang-chip{position:absolute;top:26px;left:26px;z-index:5;background:rgba(9,10,15,.4);color:#c9b258;
  border:1px solid rgba(201,180,88,.4);padding:5px 11px;border-radius:2px;font-family:Georgia,serif;font-size:11px;
  letter-spacing:.18em;cursor:pointer;transition:border-color .2s ease,color .2s ease}
#title .lang-chip:hover{color:#f0e6c2;border-color:#c9b258}
#title .lang-chip:focus-visible{outline:1px solid #c9b258;outline-offset:2px}
`

/** 静态余烬粒子层：14 粒子、位置/周期/延迟全部写死在 CSS 的 nth-child 里（确定性、无随机、离屏即关） */
const EMBERS = Array.from({ length: 14 }, () => '<i></i>').join('')

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
  /**
   * 名册**问不出来**时的那句话（KI-386）：「没回来」与「问不出来」是两件事——前者只能等，
   * 后者已经等完了、而答案是「不知道」。只有失败那一路会把它写成非 null。
   */
  private rosterFault: string | null = null
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
    /* 这一问有两条路，两条都要有人接（KI-386）。只写成功那一路时，一次抛出把整屏挂在
       「正在查看本机存档…」上——那是一个永远走不到的进行时：`slotsLoaded` 停在 false，
       `chooseNew` 那道门因此永远不许开弦，`canBrowseSlots` 也永远进不了挑档屏，
       玩家既不能开新局也不能看原因，而控制台里还多一条没人认领的 rejection。 */
    void (async () => {
      try {
        this.slotViews = saveCards(await this.hooks.listSlots())
        this.slotsLoaded = true
      } catch (e) {
        this.slotViews = []
        this.rosterFault = String((e as Error)?.message ?? e)
      }
      this.render()
    })()
  }

  get isOpen(): boolean { return this.root.classList.contains('on') }

  /** 有档可读 = 四格里至少一格是 ok / restored（空槽与坏档都不算） */
  get hasSaveable(): boolean { return this.slotsLoaded && this.slotViews.some((v) => v.selectable) }

  /** 有没有"摆着却读不出来"的档：这不影响能不能续，但一定要说出来（§78：坏消息也是消息） */
  get hasBlocked(): boolean { return this.slotViews.some((v) => v.state === 'blocked') }

  /** 名册问过而没答上来（KI-386）：这既不是「有档」也不是「没档」，是「不知道」——但它是一次回答，不是等待 */
  get hasRosterFault(): boolean { return this.rosterFault !== null }

  /** 这一问回过话了没有：成功与失败都算回过，只有「还在路上」不算 */
  private get rosterSettled(): boolean { return this.slotsLoaded || this.rosterFault !== null }

  /**
   * 能不能进挑档屏：**有可读的档**（去续）、**有读不出来的档**（去看原因）、**名册问不出来**
   * （去看「问不出来」这句话）都算。只在前两者才给进的话，「读不出来」这句话就成了死路——
   * 屏上告诉你坏了，又不给看坏在哪（KI-386 把第三种也接进来了：它同样是一句要说出口的话）。
   */
  private get canBrowseSlots(): boolean { return this.hasSaveable || this.hasBlocked || this.hasRosterFault }

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
    // 名册还在路上 ⇒ 此刻**不知道**有没有档要保护。这时候开新弦等于赌「大概没有吧」，
    // 而赌输的代价是玩家下一次休息把自动槽写掉——真丢档。所以这一律不动，等这一次问完（KI-025②）。
    if (!this.rosterSettled) { this.render(); return }
    // 问出来了、且一格都不可读 ⇒ 没有要保护的东西，直接开，不打扰玩家（原样）
    if (!this.hasSaveable && !this.hasRosterFault) { this.hooks.onNew(originId); return }
    // 有可读的档，**或者名册问不出来**：两种都要过确认屏。后者不是「有档」，是「不知道有没有档」——
    // 而「不知道」恰恰是最需要玩家自己承担一次决定的时刻，屏上必须把这句说出来（KI-386）。
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
    const target = e.target as HTMLElement
    if (target.dataset && target.dataset.langToggle !== undefined) {
      setLang(getLang() === 'zh' ? 'en' : 'zh')
      this.render()
      return
    }
    const el = target.closest('[data-act]') as HTMLElement | null
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
        ${c.passive ? `<div class="ps">${t('ui.title.passive')} · ${c.passive}</div>` : ''}
        <div class="at">${c.attrs.map((a) => `${a.label} ${a.value}`).join('<br>')}</div>
      </div>`).join('')
    const cont = this.canBrowseSlots
      ? `<div class="act${this.focus.kind === 'continue' ? ' sel' : ''}" data-act="continue">${
        this.hasSaveable ? t('ui.title.cta.continue')
          // 三种「进得去」各有各的说法：问不出来 ≠ 有档读不出来 ≠ 没档（KI-386）
          : this.hasRosterFault ? t('ui.title.cta.fault')
            : t('ui.title.cta.unreadable')}</div>`
      : ''
    const hint = !this.rosterSettled ? t('ui.title.hint.loading')
      // 失败那一路要说自己的原因：只留一句「坏了」，玩家除了再来一次，没有第二条信息可依据
      : this.rosterFault !== null ? `${t('ui.title.hint.fault')} · ${this.rosterFault}`
        : this.hasSaveable ? t('ui.title.hint.idle')
        // 「没有可续的档」与「有档但读不出来」是两件事：后者要说出来，否则玩家以为自己很干净，
        // 下一次休息就把那一格覆盖了。原因的原话在卡上（挑档屏/存档页都看得到）。
        : this.hasBlocked ? t('ui.title.hint.blocked') : t('ui.title.hint.newgame')
    return `
      <div class="astro" aria-hidden="true"></div>
      <div class="vignette" aria-hidden="true"></div>
      <div class="embers" aria-hidden="true">${EMBERS}</div>
      <h1>${t('ui.title.h1')}</h1>${this.renderLangChip()}
      <div class="sub">${t('ui.title.sub')}</div>
      <div class="cards">${cards}</div>
      <div class="acts">${cont}</div>
      <div class="hint">${hint}</div>
      <div class="hint subtle">${t('ui.title.hint.manual')}</div>`
  }

  private renderSlots(): string {
    const pick = this.slots()
    // 名册问不出来 ⇒ 一格卡都造不出来，但这一屏仍进得来（坏消息不许成死路）：那就让它说那一句
    const fault = this.rosterFault !== null && this.slotViews.length === 0
    const html = fault
      ? `<div class="hint">本机存档问不出来 · ${this.rosterFault}</div>`
      : this.slotViews.map((v) => {
        const i = pick.findIndex((p) => p.slot === v.slot)
        return `<div class="slot${i >= 0 && i === this.focus.index ? ' sel' : ''}">${saveCardHtml(v, ['load'])}</div>`
      }).join('')
    return `
      <div class="astro" aria-hidden="true"></div>
      <div class="vignette" aria-hidden="true"></div>
      <div class="embers" aria-hidden="true">${EMBERS}</div>
      <h1>${t('ui.title.h1')}</h1>${this.renderLangChip()}
      <div class="sub">${fault ? t('ui.title.hint.sub.fault') : t('ui.title.sub.read')}</div>
      <div class="scards">${html}</div>
      <div class="acts"><div class="act" data-act="back">${t('ui.title.back')}</div></div>`
  }

  private renderConfirm(): string {
    const v = this.slotViews.find((x) => x.selectable)
    const line = v ? `${v.label} · ${v.lines.join(' · ')}` : ''
    /* 两种「要先问一句」的措辞不能混：一种是**看得见**有档（原样），一种是**看不见**有没有档（KI-386）。
       后者若照抄前者，就是把一次读失败报成一条确定事实——那正是这一批要治的形状。 */
    const warn = this.rosterFault === null
      ? t('ui.title.confirm.warn.existing')
      : t('ui.title.confirm.warn.fault', { fault: this.rosterFault })
    return `
      <div class="astro" aria-hidden="true"></div>
      <div class="vignette" aria-hidden="true"></div>
      <div class="embers" aria-hidden="true">${EMBERS}</div>
      <h1>${t('ui.title.h1.newgame')}</h1>${this.renderLangChip()}
      <div class="sub">${warn}</div>
      <div class="sub">${line}</div>
      <div class="acts">
        <div class="act${this.focus.index === 0 ? ' sel' : ''}" data-act="new-no">${t('ui.title.confirm.back')}</div>
        <div class="act${this.focus.index === 1 ? ' sel' : ''}" data-act="new-yes">${t('ui.title.confirm.sure')}</div>
      </div>
      <div class="hint">${t('ui.title.hint.confirm')}</div>`
  }

  private renderLangChip(): string {
    const label = getLang() === 'zh' ? 'EN' : '中文'
    return `<button class="lang-chip" data-lang-toggle type="button" aria-label="${label}" title="${label}">${label}</button>`
  }

  private render(): void {
    this.root.innerHTML =
      this.mode === 'slots' ? this.renderSlots()
        : this.mode === 'confirm' ? this.renderConfirm()
          : this.renderString()
  }
}
