import { registry } from '@/core/Registry'
import type { ItemData, MovesetData, SlotKey, WeaponData } from '@/data/schema'
import { itemOf } from '@/rpg/Inventory'
import { ATTR_KEYS, progressionData } from '@/rpg/Progression'
import { SLOTS, type EquipMods } from '@/rpg/Equipment'
import { upgradeStep, maxLevelOf, TIMBITE, DROSS, salvageValue } from '@/rpg/Upgrade'
import { sellPrice, stackSellPrice, shopData, CURRENCY } from '@/rpg/Shop'
import { movementName, unlockItemName, SCORE } from '@/rpg/Movements'
import { DEFAULT_BINDS, type ActionName } from '@/core/Input'
import type { RpgRuntime } from '@/rpg/Runtime'
import type { SlotCard } from '@/save/Slots'
import { SAVE_CARD_CSS, saveCards, saveCardHtml, slotLabel, type SaveCardView } from '@/ui/SaveSlots'

/**
 * 调音桩面板（Phase 5-B 的 UI 落点；需求 §41/§44 + progression.md §8.3）。
 *
 * 六页：**调音**（音级/六维分配/洗点）、**装备**（七槽 + 强化）、**行囊**（分类清单）、
 * **谱册**（乐章战技的点亮/升级/装槽，Phase 5-C2）、**交易**（营地买卖，KI-055）、
 * **存档**（手动槽写入/删除，KI-025②）。
 * 用 DOM 而不是 HUD 的 canvas：这是一块要读字、要滚动、要点击的界面，不是战斗中的仪表盘
 * （tech-arch §1 的 UI 分工：HUD 走 canvas，菜单走 DOM overlay）。
 *
 * 它只调 RpgRuntime 的公开方法，不碰玩家、不碰场景；每次生效后回调 `onApply()`，
 * 由 main.ts 统一把派生值灌回玩家——面板自己不写第二份"应用变更"的逻辑。
 */

type Tab = 'tune' | 'gear' | 'bag' | 'moves' | 'trade' | 'save'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'tune', label: '调音', hint: '分配音级点 · 洗点' },
  { id: 'gear', label: '装备', hint: '七槽 · 强化' },
  { id: 'bag', label: '行囊', hint: '分类清点' },
  { id: 'moves', label: '谱册', hint: '乐章战技 · 主动槽' },
  { id: 'trade', label: '交易', hint: '卖装半价 · 残骸按堆卖 · 购消耗品' },
  { id: 'save', label: '存档', hint: '手动槽 · 写入/删除' }
]

const CSS = `
#stakerite { position:fixed; inset:0; display:none; z-index:20; pointer-events:none;
  font-family: Georgia, "Songti SC", "STSong", "SimSun", serif; color:#e8dfcb; }
#stakerite.on { display:block; pointer-events:auto; }
#stakerite .veil { position:absolute; inset:0; background:radial-gradient(ellipse at center, rgba(16,19,28,.72), rgba(7,8,12,.92)); }
#stakerite .panel { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
  width:min(880px, 92vw); max-height:86vh; display:flex; flex-direction:column;
  background:linear-gradient(180deg, rgba(20,23,32,.97), rgba(12,14,20,.97));
  border:1px solid rgba(201,180,88,.34); box-shadow:0 24px 80px rgba(0,0,0,.6); }
#stakerite header { display:flex; align-items:baseline; gap:18px; padding:16px 22px 12px;
  border-bottom:1px solid rgba(201,180,88,.18); }
#stakerite header h1 { margin:0; font-size:19px; letter-spacing:.24em; font-weight:400; color:#c9b458; }
#stakerite header .sub { font-size:12px; opacity:.6; letter-spacing:.08em; }
#stakerite nav { display:flex; gap:2px; padding:10px 22px 0; }
#stakerite nav button { background:none; border:0; border-bottom:2px solid transparent; color:#e8dfcb;
  opacity:.55; font:inherit; font-size:14px; letter-spacing:.16em; padding:8px 16px; cursor:pointer; }
#stakerite nav button.sel { opacity:1; border-bottom-color:#ffb86b; }
#stakerite main { padding:16px 22px 20px; overflow:auto; }
#stakerite h2 { font-size:13px; letter-spacing:.2em; color:#ffb86b; font-weight:400; margin:18px 0 8px; }
#stakerite h2:first-child { margin-top:0; }
#stakerite .row { display:flex; align-items:center; gap:12px; padding:8px 10px; border-radius:2px; }
#stakerite .row:nth-child(odd) { background:rgba(255,255,255,.028); }
#stakerite .row .name { flex:1; font-size:14px; }
#stakerite .row .num { font-variant-numeric:tabular-nums; opacity:.85; min-width:96px; font-size:13px; }
#stakerite .row .note { font-size:12px; opacity:.5; max-width:320px; }
#stakerite .row .act { display:flex; gap:6px; }
#stakerite button.act { background:rgba(201,180,88,.12); border:1px solid rgba(201,180,88,.4);
  color:#e8dfcb; font:inherit; font-size:12px; padding:5px 12px; cursor:pointer; letter-spacing:.08em; }
#stakerite button.act:hover:not(:disabled) { background:rgba(255,184,107,.22); }
#stakerite button.act:disabled { opacity:.3; cursor:default; }
#stakerite .xp { display:flex; align-items:center; gap:12px; margin-bottom:6px; }
#stakerite .bar { flex:1; height:6px; background:rgba(232,223,203,.12); position:relative; overflow:hidden; }
#stakerite .bar i { position:absolute; inset:0 auto 0 0; background:linear-gradient(90deg,#c9b458,#ffb86b); }
#stakerite .foot { padding:10px 22px; border-top:1px solid rgba(201,180,88,.18);
  display:flex; gap:18px; font-size:12px; opacity:.62; letter-spacing:.06em; }
#stakerite .empty { opacity:.45; font-size:13px; padding:10px 2px; }
#stakerite .over { color:#a8695f; border:1px solid rgba(168,105,95,.6); padding:1px 6px; font-size:11px; letter-spacing:.08em; }
#stakerite .tag { font-size:11px; padding:1px 6px; border:1px solid rgba(201,180,88,.45); color:#c9b458; }
#stakerite .cmp { margin:2px 0 10px 12px; padding:8px 12px; border-left:2px solid rgba(201,180,88,.35);
  background:rgba(0,0,0,.18); }
#stakerite .cmp-head, #stakerite .cmp-row { display:grid; grid-template-columns:minmax(84px,1.2fr) 1fr 1.5fr 1fr;
  gap:10px; align-items:baseline; font-size:12.5px; }
#stakerite .cmp-head { opacity:.55; letter-spacing:.14em; font-size:11px; margin-bottom:4px; }
#stakerite .cmp-row .k { opacity:.72; letter-spacing:.06em; }
#stakerite .cmp-row .a, #stakerite .cmp-row .b { font-variant-numeric:tabular-nums; }
#stakerite .cmp-row .b { opacity:.55; }
#stakerite .cmp-row .d { font-variant-numeric:tabular-nums; letter-spacing:.04em; }
#stakerite .cmp-row .d.up { color:#ffb86b; } #stakerite .cmp-row .d.down { color:#a8695f; }
#stakerite .cmp-row .d.flat { opacity:.35; }
/* 存档页：卡片本体与标题屏共用 SAVE_CARD_CSS，这里只给定基准字号与确认条 */
#stakerite .scards { font-size:13px; }
#stakerite .confirm { border:1px solid rgba(201,180,88,.5); background:rgba(201,180,88,.08); margin-bottom:10px; }
#stakerite .confirm .name { font-size:13px; }
`

const SLOT_LABEL: Record<SlotKey, string> = {
  weapon: '武器', helm: '头部', cuirass: '躯干', gloves: '臂/手', greaves: '腿', seal: '音徽', sealA: '音徽 A', sealB: '音徽 B'
}

/**
 * §44「Current vs New」的行表（需求 §44 / ui-ux §3.3，差值每一行都必须可见）。
 *
 * `get` 只读 `EquipMods`，也就是只读引擎自己算出来的那套乘数——面板不认识任何数值表，也不做加法：
 * 两栏都来自 `Equipment.totals` / `Equipment.preview`（`KI-027` 记着为什么不能"把这件的属性加到当前上"：
 * 强化倍率、词缀、音徽 A/B、噪音的加总偏移都在 `totals` 里，抄一份加法就会和装完之后不一致）。
 * 唯一特殊的是「重击底数」：那一格住在 `movesets.json` 的帧表里，不在乘数表里，所以单独取。
 * `always` 的行即使没变化也留着（攻击力 / 防御 / 负重是玩家做决定的那三件事，缺了它们要自己心算）。
 */
type CmpRow = {
  label: string
  get: (m: EquipMods) => number
  /** 绝对值怎么读（一栏里的数） */
  fmt: (v: number) => string
  /** 差值怎么读（中间那一栏）：乘数行的差不能写成「×1.05」，那是比值不是差 */
  dfmt: (v: number) => string
  always?: boolean
}

const pct = (v: number): string => `${Math.round(v * 1000) / 10}%`
const dpct = (v: number): string => `${v > 0 ? '+' : ''}${Math.round(v * 1000) / 10}%`
const mul = (v: number): string => `×${Math.round(v * 1000) / 1000}`
const dmul = (v: number): string => `${v > 0 ? '+' : ''}${Math.round(v * 1000) / 1000}`
const int = (v: number): string => `${Math.round(v)}`
const dint = (v: number): string => `${v > 0 ? '+' : ''}${Math.round(v)}`
const one = (v: number): string => `${Math.round(v * 10) / 10}`
const done = (v: number): string => `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}`
const dticks = (v: number): string => `${v > 0 ? '+' : ''}${Math.round(v)} tick`
/** 重击那一记的底数：帧表里的 damage × 手里那把的强化倍率（真正的伤害还要过属性补正与减伤，这里不假装是最终值） */
function heavyBase(m: EquipMods): number {
  if (!m.weaponId) return 0
  const w = registry.maybeGet<WeaponData>(m.weaponId)
  if (!w) return 0
  const ms = registry.maybeGet<MovesetData>(`moveset:${w.movesetId}`)
  const h = ms?.actions['h']
  return h ? h.damage * m.weaponDamageMul : 0
}

const CMP_ROWS: CmpRow[] = [
  { label: '重击底数', get: heavyBase, fmt: int, dfmt: dint, always: true },
  { label: '防御', get: (m) => m.defense, fmt: int, dfmt: dint, always: true },
  { label: '负重', get: (m) => m.weight, fmt: one, dfmt: done, always: true },
  { label: '暴击率', get: (m) => m.critRate, fmt: pct, dfmt: dpct },
  { label: '架式伤害', get: (m) => m.poiseDmgMul, fmt: mul, dfmt: dmul },
  { label: '体力回复', get: (m) => m.staminaRegenMul, fmt: mul, dfmt: dmul },
  { label: '处决倍率', get: (m) => m.execMul, fmt: mul, dfmt: dmul },
  { label: '噪音系数', get: (m) => m.noiseMul, fmt: mul, dfmt: dmul },
  { label: '完美格挡窗', get: (m) => m.perfectBlockBonusTicks, fmt: dticks, dfmt: dticks },
  { label: '轻击前摇', get: (m) => m.lightStartupTicks, fmt: dticks, dfmt: dticks },
  { label: '对钟甲加成', get: (m) => m.bellBonus, fmt: pct, dfmt: dpct },
  { label: '弹反额外过载', get: (m) => m.restOverdrive, fmt: int, dfmt: dint }
]

export interface StakeriteHooks {
  /** 面板里任何一次生效（分配/洗点/装备/强化/使用）之后调用，由 main.ts 重算派生值 */
  onApply: () => void
  /** 播报（走既有的 ui.notify 通道） */
  notify: (text: string, kind?: 'info' | 'reward' | 'boss') => void
  /** 消耗品生效（回血/刮失谐的数都来自 items.json 的 use，面板不直接碰玩家状态） */
  onUse: (eff: { heal: number; corruption: number }) => void
}

/**
 * 存档页的三个动作（KI-025②）。全部以回调给出，面板不认识存储键位也不认识 `SaveGame`：
 * 名册的读法只有一条（`save/Slots.ts` 的候选顺序），写入/删除的落盘只有一处（`save/Serializer.ts`）。
 * 面板这里如果自己去拼 `localStorage.setItem('caesura.save.slot1', …)`，那条"一条候选顺序一个主人"
 * 的纪律当场就破了——所以这里只给函数，不给存储对象。
 */
export interface SavePanelDeps {
  /** 现读名册（进页、写入/删除之后各读一次；不做缓存刷新） */
  list: () => Promise<SlotCard[]>
  /** 把**当前局面**写进指定手动槽（返回快照；面板不读它的字段，只按成功/失败说话） */
  write: (slot: string) => Promise<unknown>
  /** 抹掉一个槽的全部副本（含备份位）；返回 false = 那一格本来就没有东西 */
  erase: (slot: string) => Promise<boolean>
}

export class Stakerite {
  private readonly root: HTMLDivElement
  private tab: Tab = 'tune'
  private open = false
  /** 装备页当前选中要强化的件（uid） */
  private gearSel: string | null = null
  /** 存档页的卡面（名册读数经 `saveCards` 换成的显示口径） */
  private saveViews: SaveCardView[] = []
  /** 等待确认的那一笔：写入/删除都是**覆盖或清掉玩家的东西**，所以一律两步 */
  private pending: { slot: string; act: 'write' | 'erase' } | null = null
  /** 落盘进行中（按钮不给第二次点击的机会） */
  private saving = false

  constructor(private readonly rpg: RpgRuntime, private readonly hooks: StakeriteHooks, private readonly saves: SavePanelDeps) {
    const style = document.createElement('style')
    style.textContent = CSS + SAVE_CARD_CSS
    document.head.appendChild(style)
    this.root = document.createElement('div')
    this.root.id = 'stakerite'
    document.body.appendChild(this.root)
    this.root.addEventListener('click', (e) => this.onClick(e))
    window.addEventListener('keydown', (e) => this.onKey(e))
  }

  get isOpen(): boolean { return this.open }

  toggle(): void { this.open ? this.close() : this.show() }

  show(): void {
    this.open = true
    this.root.classList.add('on')
    if (this.tab === 'save') this.refreshSaves()
    this.render()
  }

  close(): void {
    this.open = false
    this.root.classList.remove('on')
    this.pending = null
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.open) return
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const i = TABS.findIndex((t) => t.id === this.tab)
      const d = e.code === 'ArrowRight' ? 1 : -1
      this.setTab(TABS[(i + d + TABS.length) % TABS.length].id)
      e.preventDefault()
    }
  }

  /** 换页：进存档页就现取名册（离开时把未确认的那一笔撤掉，别把确认条留在别的页里） */
  private setTab(tab: Tab): void {
    this.tab = tab
    this.pending = null
    if (tab === 'save') this.refreshSaves()
    this.render()
  }

  /** 名册是异步的（存储层给 Promise）：回来时若已换页/关面板就不重绘 */
  private refreshSaves(): void {
    void this.saves.list().then((cards) => {
      this.saveViews = saveCards(cards)
      if (this.open && this.tab === 'save') this.render()
    })
  }

  private onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null
    if (!el) return
    const act = el.dataset.act!
    const arg = el.dataset.arg ?? ''
    // 存档那一页的三个动作各自收尾（都是异步或纯 UI 状态，不重算派生值也不共用尾部逻辑）
    if (act === 'write' || act === 'erase') {
      if (el.dataset.disabled || this.saving || this.savesOf(arg) === null) return
      this.pending = { slot: arg, act }
      this.render()
      return
    }
    if (act === 'confirm') { this.runPending(); return }
    if (act === 'cancel') { this.pending = null; this.render(); return }
    switch (act) {
      case 'tab': this.setTab(arg as Tab); break
      case 'alloc': this.alloc(arg as never); break
      case 'respec': this.respec(); break
      case 'equip': this.equip(arg); break
      case 'unequip': this.rpg.unequip(arg as SlotKey); this.hooks.notify('已卸下'); break
      case 'sel': this.gearSel = arg; break
      case 'upgrade': this.upgrade(arg); break
      case 'salvage': this.salvage(arg); break
      case 'use': this.use(arg); break
      case 'sell': this.sell(arg); break
      case 'sell-stack': this.sellStacks(arg); break
      case 'buy': this.buy(arg); break
      case 'lit': this.unlock(arg); break
      case 'mvup': this.upgradeMove(arg); break
      case 'pslearn': this.learnPassive(arg); break
      case 'mvequip': this.equipSlot(arg); break
      case 'close': this.close(); break
      default: return
    }
    this.hooks.onApply()
    this.render()
  }

  /** 按槽位找卡面（点到的按钮一定在卡上，但 `data-arg` 是字符串——查不到就不动） */
  private savesOf(slot: string): SaveCardView | null {
    return this.saveViews.find((v) => v.slot === slot) ?? null
  }

  /**
   * 执行已确认的那一笔，然后**重新取名册**再画：写/删之后卡面上的数字必须来自存储，
   * 不是面板凭"我刚写过了"替它编的——那是 ui-ux §8 反对的那类假读数。
   */
  private runPending(): void {
    const p = this.pending
    this.pending = null
    if (!p) return
    this.saving = true
    this.render()
    const label = slotLabel(p.slot)
    const job = p.act === 'write'
      ? this.saves.write(p.slot).then(() => { this.hooks.notify(`已写入 ${label}`, 'reward') })
      : this.saves.erase(p.slot).then((gone) => {
        this.hooks.notify(gone ? `已删除 ${label}` : `${label}本来就是空的`, gone ? 'reward' : 'info')
      })
    void job.catch(() => this.hooks.notify(`${p.act === 'write' ? '写入' : '删除'}失败：存储没有答应`, 'info')).then(() => this.saves.list()).then((cards) => {
      this.saveViews = saveCards(cards)
      this.saving = false
      if (this.open && this.tab === 'save') this.render()
    })
  }

  private alloc(attr: never): void {
    if (!this.rpg.prog.allocate(attr)) { this.hooks.notify('没有未分配的音级点', 'info'); return }
  }

  private respec(): void {
    const r = this.rpg.respec()
    if (!r.ok) {
      this.hooks.notify(r.reason === 'poor' ? `音色石不足（需 ${r.cost}）` : '没有可退回的音级点', 'info')
      return
    }
    this.hooks.notify(`洗点完成 · 退回 ${r.refunded} 点 · 花费 ${r.cost} 音色石`, 'reward')
  }

  private equip(uid: string): void {
    const r = this.rpg.equip(uid)
    if (!r.ok) { this.hooks.notify('这件装备进不了那个槽位', 'info'); return }
    this.hooks.notify(`装备 · ${this.label(uid)}`)
  }

  private upgrade(uid: string): void {
    const r = this.rpg.upgrade(uid)
    if (!r.ok) {
      this.hooks.notify(
        r.reason === 'maxed' ? '已到该稀有度的强化上限'
          : r.reason === 'poor' ? '材料不足（音色石 + 残晶）'
            : '找不到这件装备', 'info')
      return
    }
    this.gearSel = uid
    this.hooks.notify(`强化 +${r.level} · 消耗 ${r.spent!.timbite} 石 / ${r.spent!.dross} 晶`, 'reward')
  }

  private salvage(uid: string): void {
    const v = this.rpg.salvage(uid)
    if (!v) return
    if (this.gearSel === uid) this.gearSel = null
    this.hooks.notify(`分解 · 残晶 +${v.dross} · 音色石 +${v.timbite}`, 'reward')
  }

  /** 卖装备（§6.3）：拿到的只有底数的半价，强化过的那部分留在世界里不回来——所以播报把件名念出来而不是「+3」 */
  private sell(uid: string): void {
    const name = this.label(uid)
    const r = this.rpg.sell(uid)
    if (!r.ok) { this.hooks.notify(r.reason === 'missing' ? '包里已经没有这一件了' : '这种东西不能卖', 'info'); return }
    if (this.gearSel === uid) this.gearSel = null
    this.hooks.notify(`售出 · ${name} · 音色石 +${r.price}`, 'reward')
  }

  /**
   * 卖整堆残骸/素材（KI-059，需求 §6 收入表「出售战利品（残骸→石）」）。
   * 播报把**件数 × 单价**都念出来：这一腿是 n 次同价乘法，只报总数就看不出"哪一格错了"。
   */
  private sellStacks(itemId: string): void {
    const item = itemOf(itemId)
    const have = this.rpg.inv.count(itemId)
    const r = this.rpg.sellStacks(itemId, have)
    if (!r.ok) {
      this.hooks.notify(have <= 0 ? `${item.displayName}：包里已经没有这一件了` : `${item.displayName}：营地不收这类货`, 'info')
      return
    }
    this.hooks.notify(`售出 · ${item.displayName} ×${r.count} @${stackSellPrice(itemId)} · 音色石 +${r.price}`, 'reward')
  }

  /** 买消耗品（§6.2）：失败的原因有三种，说出来比按钮变灰更有信息（按钮照旧禁用，这里兜住竞态） */
  private buy(entryId: string): void {
    const entry = shopData().stock.find((s) => s.id === entryId)
    const r = this.rpg.buy(entryId)
    if (!r.ok) {
      this.hooks.notify(
        r.reason === 'unknown' ? '清单上没有这一项'
          : r.reason === 'poor' ? `音色石不足（需 ${entry?.price ?? '?'}）`
            : `${entry ? itemOf(entry.item).displayName : '这一项'}已经带满`, 'info')
      return
    }
    this.hooks.notify(`购入 · ${itemOf(r.itemId!).displayName} · 音色石 −${r.price}`, 'reward')
  }

  private use(itemId: string): void {
    const item = itemOf(itemId)
    const r = this.rpg.useItem(itemId)
    if (!r.ok) { this.hooks.notify('这件东西不能用', 'info'); return }
    // 播报把数值念出来：让玩家知道这一口下去到底换到了什么（失谐是负数=往下刮）
    const eff = [r.heal > 0 ? `生命 +${r.heal}` : '', r.corruption < 0 ? `失谐 ${r.corruption}` : ''].filter(Boolean).join(' · ')
    this.hooks.notify(`使用 · ${item.displayName}${eff ? ` · ${eff}` : ''}`, 'reward')
    this.hooks.onUse({ heal: r.heal, corruption: r.corruption })
  }

  private label(uid: string): string {
    const g = this.rpg.inv.gearByUid(uid)
    if (!g) return uid
    const item = itemOf(g.itemId)
    return g.level > 0 ? `${item.displayName} +${g.level}` : item.displayName
  }

  /* ------------------------------ 谱册 ------------------------------ */

  /** 点亮一页 = 把数据里点名的那件东西花掉。扣不动就不亮（`MovementBook.unlockPage` 已保证顺序） */
  private unlock(pageId: string): void {
    const r = this.rpg.moves.unlockPage(pageId, this.rpg.inv)
    if (!r.ok) {
      this.hooks.notify(
        r.reason === 'lit' ? '这一页已经亮着'
          : r.reason === 'poor' ? `解锁物不足（需 ${unlockItemName(pageId)}）`
            : '谱册里没有这一页', 'info')
      return
    }
    this.hooks.notify(`谱册点亮 · ${this.rpg.moves.page(pageId)?.displayName ?? pageId}`, 'reward')
  }

  /** §7.3 被动研读（KI-036）：扣费在 book.learnPassive（同一本书的同一套纪律），这里只播报 */
  private learnPassive(id: string): void {
    const r = this.rpg.moves.learnPassive(id, this.rpg.inv)
    const def = this.rpg.moves.cfg.passives?.find((d) => d.id === id)
    if (r.ok) this.hooks.notify(`被动研读 · ${def?.displayName ?? id}`, 'reward')
    else this.hooks.notify(def ? `${def.displayName}：研读不动（${r.reason}）` : '研读不动', 'info')
  }

  private upgradeMove(id: string): void {
    const r = this.rpg.moves.upgrade(id, this.rpg.inv)
    if (!r.ok) {
      const need = this.rpg.moves.upgradeNeed(id)
      this.hooks.notify(
        r.reason === 'max' ? `${movementName(id)} 已到这一页的上限`
          : r.reason === 'dark' ? '这一式还在没点亮的页里'
            : `材料不足（需 ${need?.timbite ?? '?'} 石 / ${need?.score ?? '?'} 残页）`, 'info')
      return
    }
    this.hooks.notify(`${movementName(id)} · 第 ${this.rpg.moves.levelOf(id)} 级`, 'reward')
  }

  /** `data-arg` = `"<槽序号>:<战技id>"`；id 留空＝卸下那槽 */
  private equipSlot(arg: string): void {
    const i = Number(arg.slice(0, arg.indexOf(':')))
    const id = arg.slice(arg.indexOf(':') + 1) || null
    const r = this.rpg.moves.equip(i, id, this.rpg.prog.rank)
    if (!r.ok) {
      this.hooks.notify(
        r.reason === 'locked-slot' ? `第 ${i + 1} 槽要到音级 ${this.rpg.moves.slotRank(i)} 才开`
          : r.reason === 'dark' ? '还没学会这一式'
            : '这个槽位不存在', 'info')
      return
    }
    this.hooks.notify(id ? `装入 · ${movementName(id)}` : '已卸下', 'info')
  }

  /* ------------------------------- 渲染 ------------------------------- */

  private render(): void {
    if (!this.open) return
    const body = this.tab === 'tune' ? this.renderTune()
      : this.tab === 'gear' ? this.renderGear()
        : this.tab === 'bag' ? this.renderBag()
          : this.tab === 'moves' ? this.renderMoves()
            : this.tab === 'trade' ? this.renderTrade()
              : this.renderSave()
    this.root.innerHTML = `
      <div class="veil" data-act="close"></div>
      <div class="panel">
        <header>
          <h1>调音桩</h1>
          <span class="sub">音级 ${this.rpg.prog.rank} · 遗响 ${this.rpg.prog.xp}${this.rpg.prog.unspent > 0 ? ` · 未分配 ${this.rpg.prog.unspent}` : ''}</span>
        </header>
        <nav>${TABS.map((t) => `<button data-act="tab" data-arg="${t.id}" class="${t.id === this.tab ? 'sel' : ''}">${t.label}</button>`).join('')}</nav>
        <main>${body}</main>
        <div class="foot">
          <span>← → 切换页</span><span>Tab 收起</span>
          <span>音色石 ${this.rpg.inv.count(TIMBITE)}</span><span>残晶 ${this.rpg.inv.count(DROSS)}</span>
          <span>乐谱残页 ${this.rpg.inv.count(SCORE)}</span>
        </div>
      </div>`
  }

  private renderTune(): string {
    const p = this.rpg.prog
    const need = p.xpToNext()
    const d = p.derive(this.rpg.eq.totals(this.rpg.inv).defense)
    const m = this.rpg.mods() // 负重那一行要说「现在多重 / 上限多少 / 超没超」，这三件事都在 mods() 里
    const frac = need === null ? 1 : Math.min(1, p.xp / need)
    const rows = p.data.attrs.map((a) => {
      const v = p.attrs[a.key]
      const eff = p.effectiveAttr(a.key)
      const softNote = eff < v - 0.001 ? `<span class="note">软上限折算后 ${eff.toFixed(1)}</span>` : ''
      return `<div class="row">
        <span class="name">${a.displayName}<span class="note" style="margin-left:10px">${a.desc}</span></span>
        ${softNote}
        <span class="num">${v}</span>
        <span class="act"><button class="act" data-act="alloc" data-arg="${a.key}" ${p.unspent > 0 ? '' : 'disabled'}>+1</button></span>
      </div>`
    }).join('')
    const milestones = p.data.milestones.map((m) =>
      `<div class="row"><span class="name">音级 ${m.rank}</span><span class="note">${m.label}</span>
       <span class="num">${p.rank >= m.rank ? '已达成' : ''}</span></div>`).join('')
    return `
      <div class="xp"><span class="tag">遗响</span><div class="bar"><i style="width:${(frac * 100).toFixed(1)}%"></i></div>
        <span class="num">${need === null ? '已抵上限' : `${p.xp} / ${need}`}</span></div>
      <h2>六音级属性 · 未分配 ${p.unspent}</h2>
      ${rows}
      <div class="row"><span class="name">洗点</span><span class="note">退回全部已分配点（前 3 次 8 折）</span>
        <span class="num">${p.respecCost()} 音色石</span>
        <span class="act"><button class="act" data-act="respec">洗点</button></span></div>
      <h2>派生</h2>
      <div class="row"><span class="name">生命 / 体力 / 架势</span><span class="num">${d.hpMax} / ${d.staminaMax} / ${d.poiseMax}</span></div>
      <div class="row"><span class="name">DEF / 负重</span><span class="num">${d.defense} / ${Math.round(m.weight * 10) / 10} · 上限 ${m.loadMax} kg</span>
        <span class="note">${m.overloaded ? '<span class="over">超载 · 翻滚与疾跑禁用、体力回复 −40%</span>' : '未超载'}</span></div>
      <div class="row"><span class="name">暴击率 / 暴击倍率 / 过载上限</span><span class="num">${(d.critRate * 100).toFixed(1)}% / ${d.critMul.toFixed(2)}× / ${d.overdriveMax}</span></div>
      <h2>里程碑</h2>
      ${milestones}`
  }

  private renderGear(): string {
    const inv = this.rpg.inv
    const slots = SLOTS.map((s) => {
      const g = this.rpg.eq.equipped(inv, s)
      const name = g ? this.label(g.uid) : '—'
      const act = g ? `<button class="act" data-act="unequip" data-arg="${s}">卸下</button>` : ''
      return `<div class="row"><span class="name">${SLOT_LABEL[s]}</span><span class="name">${name}</span>
        <span class="act">${act}</span></div>`
    }).join('')
    // §44 建议星标（KI-060）：每格分数最高的那件挂 ★。它是**建议不是闸门**——
    // 下面每一行的"装备"按钮一律可点，权重表不同意玩家的选择不等于玩家不能选。
    const stars = new Set(Object.values(this.rpg.eq.adviceStars(inv)))
    const bag = inv.gears.map((g) => {
      const item = itemOf(g.itemId)
      const worn = Object.values(this.rpg.eq.slots).includes(g.uid)
      const cap = maxLevelOf(item)
      const step = upgradeStep(g.level)
      const canUp = !!step && inv.count(TIMBITE) >= step.timbite && inv.count(DROSS) >= step.dross
      const cost = step ? `${step.timbite} 石 / ${step.dross} 晶` : '已满'
      const star = stars.has(g.uid) ? ' <span class="tag">★ 建议</span>' : ''
      const score = this.rpg.eq.adviceDelta(inv, g.uid)
      return `<div class="row">
        <span class="name">${item.displayName}${g.level > 0 ? ` <span class="tag">+${g.level}</span>` : ''}${star}
          ${worn ? '<span class="tag">已装备</span>' : ''}
          <span class="note">${this.affixText(g.affixes)}</span></span>
        <span class="num">${g.level}/${cap} · ${cost}${worn || score === 0 ? '' : ` · 建议分 ${score > 0 ? '+' : ''}${score.toFixed(1)}`}</span>
        <span class="act">
          <button class="act" data-act="equip" data-arg="${g.uid}" ${worn ? 'disabled' : ''}>装备</button>
          <button class="act" data-act="upgrade" data-arg="${g.uid}" ${canUp ? '' : 'disabled'}>强化</button>
          <button class="act" data-act="salvage" data-arg="${g.uid}" ${worn ? 'disabled' : ''}>分解</button>
        </span></div>${worn ? '' : this.compareBlock(g.uid, item)}`
    }).join('') || '<div class="empty">还没有任何装备件。</div>'
    return `<h2>七槽</h2>${slots}
      <h2>行囊中的装备（${inv.gears.length}）</h2>${bag}`
  }

  /**
   * §44 的那块双栏对比。差值用 ▲/▼/— 三种形状而不是只靠颜色（ui-ux §7 的双编码口径：色觉异常时
   * 形状独立承载信息）。
   *
   * **刻意不做"更适合当前 Build"的星标建议**：那需要一张维度权重表，而权重是数值不是排版，
   * 抄进代码就是 §55 禁的那第二类答案；它的落点（`player.json` 或一张 ui 表）要动 `schema.ts`
   * 与验证器，那两份文件正被并行会话写。登记在 KI-027。
   */
  private compareBlock(uid: string, item: ItemData): string {
    const inv = this.rpg.inv
    const next = this.rpg.eq.preview(inv, uid)
    if (!next) return ''
    const cur = this.rpg.eq.totals(inv)
    const g = inv.gearByUid(uid)
    const wornUid = this.rpg.eq.slots[next.slot]
    const wornGear = wornUid ? inv.gearByUid(wornUid) : null
    const curName = wornGear ? this.label(wornGear.uid) : '空槽'
    const rows = CMP_ROWS.map((r) => {
      const a = r.get(cur)
      const b = r.get(next.mods)
      const d = b - a
      const cls = Math.abs(d) < 1e-9 ? 'flat' : d > 0 ? 'up' : 'down'
      const mark = cls === 'flat' ? '—' : cls === 'up' ? '▲' : '▼'
      // 「—」 也带数：一行只写一个破折号，等于要求玩家自己心算 19 − 17
      const dtxt = ` ${cls === 'flat' ? '0' : r.dfmt(d)}`
      return { r, a, b, cls, html: `<span class="d ${cls}">${mark}${dtxt}</span>` }
    }).filter((x) => x.cls !== 'flat' || x.r.always)
    const line = (label: string, a: string, d: string, b: string): string =>
      `<div class="cmp-row"><span class="k">${label}</span><span class="a">${a}</span>${d}<span class="b">${b}</span></div>`
    const special = line('特殊', this.affixText(wornGear?.affixes ?? []), '<span class="d flat">→</span>',
      this.affixText(g?.affixes ?? []))
    return `<div class="cmp"><div class="cmp-head"><span>${SLOT_LABEL[next.slot]}</span>
      <span>当前 · ${curName}</span><span>差值</span><span>换上 · ${item.displayName}${g && g.level > 0 ? ` +${g.level}` : ''}</span></div>
      ${rows.map((x) => line(x.r.label, x.r.fmt(x.a), x.html, x.r.fmt(x.b))).join('')}
      ${special}</div>`
  }

  private affixText(affixes: { id: string; value: number }[]): string {
    if (!affixes.length) return '素声 · 无词缀'
    const all = [...progressionData().affixes.prefix, ...progressionData().affixes.suffix]
    return affixes.map((a) => {
      const def = all.find((x) => x.id === a.id)
      const v = def?.behavior ? `+${a.value}` : `${a.value > 0 ? '+' : ''}${Math.round(a.value * 1000) / 10}%`
      return `${def?.displayName ?? a.id} ${v}`
    }).join(' · ')
  }

  private renderBag(): string {
    const kinds: { id: ItemData['kind']; label: string }[] = [
      { id: 'currency', label: '通货' }, { id: 'material', label: '素材' },
      { id: 'consumable', label: '消耗品' }, { id: 'lore', label: '叙事' }, { id: 'key', label: '关键' }
    ]
    const sections = kinds.map((k) => {
      const list = this.rpg.inv.list(k.id)
      if (!list.length) return ''
      const rows = list.map((x) => {
        const use = x.item.use ? `<button class="act" data-act="use" data-arg="${x.itemId}">使用</button>` : ''
        return `<div class="row"><span class="name">${x.item.displayName}<span class="note">${x.item.desc}</span></span>
          <span class="num">×${x.count}</span><span class="act">${use}</span></div>`
      }).join('')
      return `<h2>${k.label}</h2>${rows}`
    }).join('')
    return sections || '<div class="empty">行囊空空。</div>'
  }

  /** 槽位显示绑定本身，而不是面板里再抄一份 'R'/'C'——改键之后面板不会说谎 */
  private keyFor(action: ActionName): string {
    const code = Object.entries(DEFAULT_BINDS.keyboard).find(([, a]) => a === action)?.[0]
    return code ? code.replace(/^(Key|Digit|Mouse)/, '') : '—'
  }

  private renderMoves(): string {
    const book = this.rpg.moves
    const inv = this.rpg.inv
    const rank = this.rpg.prog.rank
    const pages = book.cfg.pages.map((pg) => {
      const lit = book.isLit(pg.id)
      const have = inv.count(pg.unlock.item)
      const unlock = `<div class="row"><span class="name">解锁源<span class="note">${pg.desc}</span></span>
        <span class="num">${itemOf(pg.unlock.item).displayName} ${have}/${pg.unlock.count}</span>
        <span class="act"><button class="act" data-act="lit" data-arg="${pg.id}" ${lit || have < pg.unlock.count ? 'disabled' : ''}>${lit ? '已点亮' : '点亮'}</button></span></div>`
      const rows = book.cfg.movements.filter((m) => m.page === pg.id).map((m) => {
        const lv = book.levelOf(m.id)
        const need = book.upgradeNeed(m.id)
        const canUp = !!need && inv.count(TIMBITE) >= need.timbite && inv.count(SCORE) >= need.score
        const cost = lv <= 0 ? '未点亮' : need ? `L${lv}/${m.levels.length} · ${need.timbite} 石 / ${need.score} 残页` : `L${lv}/${m.levels.length} · 已满`
        return `<div class="row"><span class="name">${m.displayName}<span class="note">${m.desc}</span></span>
          <span class="num">${cost}</span>
          <span class="act"><button class="act" data-act="mvup" data-arg="${m.id}" ${canUp ? '' : 'disabled'}>乐谱研读</button></span></div>`
      }).join('')
      // §7.3 被动栏（KI-036）：页底常驻。数值语义由每条被动自己的 desc 说（数据表带 values）
      const passives = (book.cfg.passives ?? []).filter((ps) => ps.page === pg.id).map((ps) => {
        const lv = book.passiveLevel(ps.id)
        const max = ps.values.length
        const cost = book.cfg.passiveCost?.[Math.min(lv, max - 1)]
        const canLearn = lit && lv < max && !!cost && inv.count(TIMBITE) >= cost.timbite && inv.count(SCORE) >= cost.score
        const value = lv > 0 ? ps.values[lv - 1] : null
        const num = lv >= max ? `L${lv}/${max} · 已满` : cost ? `L${lv}/${max} · ${cost.timbite} 石 / ${cost.score} 残页` : `L${lv}/${max}`
        return `<div class="row"><span class="name">被动 · ${ps.displayName}<span class="note">${ps.desc}${value !== null ? `（当前 ${value}）` : ''}</span></span>
          <span class="num">${num}</span>
          <span class="act"><button class="act" data-act="pslearn" data-arg="${ps.id}" ${canLearn ? '' : 'disabled'}>${lv > 0 ? '再研读' : '研读'}</button></span></div>`
      }).join('')
      return `<h2>${pg.displayName}${lit ? '' : ' · 全暗'}</h2>${unlock}${rows}${passives}`
    }).join('')
    const known = book.cfg.movements.filter((m) => book.levelOf(m.id) > 0)
    const slots = book.cfg.slots.map((def, i) => {
      const open = book.slotOpen(i, rank)
      const cur = book.slots[i]
      const pick = known.map((m) => `<button class="act" data-act="mvequip" data-arg="${i}:${m.id}" ${open ? '' : 'disabled'}>${m.displayName}</button>`).join('')
      const drop = cur ? `<button class="act" data-act="mvequip" data-arg="${i}:">卸下</button>` : ''
      return `<div class="row"><span class="name">第 ${def.index} 槽 · 键 ${this.keyFor(def.action)}
          <span class="note">${open ? '' : `未开启 · 需音级 ${book.slotRank(i)}`}</span></span>
        <span class="num">${cur ? movementName(cur) : '空'}</span>
        <span class="act">${drop}${pick || '<span class="note">尚未学会任何一式</span>'}</span></div>`
    }).join('')
    return `${pages}
      <h2>主动槽（装进去才打得出）</h2>${slots}
      <h2>口径</h2>
      <div class="row"><span class="name">战技伤害标尺<span class="note">不吃武器强化倍率，按音色列折算</span></span>
        <span class="num">${Object.entries(book.cfg.damage.scaling).map(([k, v]) => `${k.toUpperCase()} +${v}/点`).join(' · ')} · 过载每层 +${Math.round(book.cfg.damage.perOverdriveLayer * 100)}%</span></div>`
  }

  /* ------------------------------- 交易 ------------------------------- */

  /**
   * 营地交易页（KI-055）。三个区块各自从数据取价：卖装备与卖残骸都读 `items.json` 的 `value × shop.sell.mul`
   * （同一条式子在 `Shop.saleUnit`，面板不算第二次），买侧读 `shop.json` 的 `price`——面板里不出现第二个价格来源。
   * 每一行都同时给"卖"和"拆"两个数：§6.3 的意图是**鼓励分解**（残晶回流），只报卖价就会让玩家
   * 以为卖是正解；把两个数并排放，选择才是玩家做的而不是排版替他做的。
   */
  private renderTrade(): string {
    const inv = this.rpg.inv
    const shop = shopData()
    const mulPct = Math.round(shop.sell.mul * 100)
    const sell = inv.gears.map((g) => {
      const item = itemOf(g.itemId)
      const worn = Object.values(this.rpg.eq.slots).includes(g.uid)
      const price = sellPrice(g.itemId)
      const sv = salvageValue(item, g.level)
      return `<div class="row">
        <span class="name">${item.displayName}${g.level > 0 ? ` <span class="tag">+${g.level}</span>` : ''}
          ${worn ? '<span class="tag">已装备</span>' : ''}
          <span class="note">档价 ${item.value ?? 0} × ${mulPct}% · 分解另一算（残晶 ${sv.dross} + 石 ${sv.timbite}）</span></span>
        <span class="num">${price} 石</span>
        <span class="act"><button class="act" data-act="sell" data-arg="${g.uid}">售出</button></span></div>`
    }).join('') || '<div class="empty">行囊里没有可卖的装备。</div>'
    const buy = shop.stock.map((e) => {
      const item = itemOf(e.item)
      const have = inv.count(item.id)
      const can = have < item.stack && inv.count(CURRENCY) >= e.price
      return `<div class="row">
        <span class="name">${item.displayName}<span class="note">${e.note ?? item.desc}</span></span>
        <span class="num">${e.price} 石 · 持有 ${have}/${item.stack}</span>
        <span class="act"><button class="act" data-act="buy" data-arg="${e.id}" ${can ? '' : 'disabled'}>购入</button></span></div>`
    }).join('')
    // 残骸/素材那一栏（KI-059）：读的是**包里的实际数量**，不是全表——收摊上不卖的东西一律不占行。
    // 单价与装备腿同一条式子（`Shop.saleUnit`），所以这里只做乘法、不再出现第二个舍入点。
    const stacks = inv.list()
      .filter((x) => x.count > 0 && stackSellPrice(x.itemId) > 0)
      .map((x) => {
        const unit = stackSellPrice(x.itemId)
        return `<div class="row">
          <span class="name">${x.item.displayName}<span class="note">档价 ${x.item.value ?? 0} × ${mulPct}% · 持有 ${x.count}（整堆一次卖出）</span></span>
          <span class="num">${unit}/件 · 共 ${unit * x.count} 石</span>
          <span class="act"><button class="act" data-act="sell-stack" data-arg="${x.itemId}">全部售出</button></span></div>`
      }).join('') || '<div class="empty">包里没有被营地收购的残骸或素材。</div>'
    return `<h2>购入（营地商队 · 只收消耗品）</h2>${buy}
      <h2>售出（装备实例 · 强化等级不折价）</h2>${sell}
      <h2>售出（残骸与素材 · 按数量）</h2>${stacks}
      <div class="row"><span class="name">口径<span class="note">买来的消耗品不能再卖（可买的类别与可卖的类别不相交）；卖装备与卖残骸用同一个系数、同一次取整。§6.3 的红线：买→卖这一圈必定亏。</span></span></div>`
  }

  /* ------------------------------- 存档 ------------------------------- */

  /**
   * 存档页（KI-025②）。卡面与标题屏同一张卡、同一段 CSS，只有能做的动作不同：
   * 这一页给"写入/删除"不给"读取"——读档要把整个世界推倒重来，那是标题屏的位置才该干的事；
   * 反过来标题屏不能在这里写手动槽。**能做什么由位置决定**，两处都不是卡自己决定。
   *
   * 两步确认（`pending` → `confirm`）不是仪式：写入会覆盖那一格原有的档，删除拿不回来。
   * 落盘之后一律重新取名册再画——卡上的数字来自存储，不是面板凭"我刚才写过了"替它填的。
   */
  private renderSave(): string {
    const p = this.pending
    const target = p ? this.savesOf(p.slot) : null
    const confirm = p && target
      ? `<div class="row confirm"><span class="name">${this.pendingText(p.act, p.slot, target.state)}
          <span class="note">${this.saving ? '落盘中…' : '这一步会动到硬盘上的东西，确认才做。'}</span></span>
        <span class="act"><button class="act" data-act="confirm" ${this.saving ? 'disabled' : ''}>确认</button>
          <button class="act" data-act="cancel">取消</button></span></div>`
      : ''
    const cards = this.saveViews.map((v) => saveCardHtml(v, ['write', 'erase'])).join('')
    return `<h2>手动存档槽（只有站在调音桩前才写得进去）</h2>${confirm}
      <div class="scards">${cards || '<div class="empty">名册还在读…</div>'}</div>
      <div class="row"><span class="name">口径<span class="note">自动档在每个检查点自己落盘，这一页不动它；读档请回标题屏。删掉的是主存位与备份位两处，删完不可恢复。</span></span></div>`
  }

  private pendingText(act: 'write' | 'erase', slot: string, state: SlotCard['state']): string {
    const label = slotLabel(slot)
    if (act === 'erase') return `删除 ${label} —— 这一格${state === 'empty' ? '本来是空的' : '的存档（含备份位）'}会被清掉。`
    return `写入 ${label} —— ${state === 'empty' ? '这一格现在是空的' : '这一格已有的存档会被当前局面覆盖'}。`
  }
}

/** 面板里要展示的属性键顺序（与 progression.json 一致；改表就跟着改） */
export const ATTR_ORDER = ATTR_KEYS
