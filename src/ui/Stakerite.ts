import type { ItemData, SlotKey } from '@/data/schema'
import { itemOf } from '@/rpg/Inventory'
import { ATTR_KEYS, progressionData } from '@/rpg/Progression'
import { SLOTS } from '@/rpg/Equipment'
import { upgradeStep, maxLevelOf, TIMBITE, DROSS } from '@/rpg/Upgrade'
import { movementName, unlockItemName, SCORE } from '@/rpg/Movements'
import { DEFAULT_BINDS, type ActionName } from '@/core/Input'
import type { RpgRuntime } from '@/rpg/Runtime'

/**
 * 调音桩面板（Phase 5-B 的 UI 落点；需求 §41/§44 + progression.md §8.3）。
 *
 * 四页：**调音**（音级/六维分配/洗点）、**装备**（七槽 + 强化）、**行囊**（分类清单）、
 * **谱册**（乐章战技的点亮/升级/装槽，Phase 5-C2）。
 * 用 DOM 而不是 HUD 的 canvas：这是一块要读字、要滚动、要点击的界面，不是战斗中的仪表盘
 * （tech-arch §1 的 UI 分工：HUD 走 canvas，菜单走 DOM overlay）。
 *
 * 它只调 RpgRuntime 的公开方法，不碰玩家、不碰场景；每次生效后回调 `onApply()`，
 * 由 main.ts 统一把派生值灌回玩家——面板自己不写第二份"应用变更"的逻辑。
 */

type Tab = 'tune' | 'gear' | 'bag' | 'moves'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'tune', label: '调音', hint: '分配音级点 · 洗点' },
  { id: 'gear', label: '装备', hint: '七槽 · 强化' },
  { id: 'bag', label: '行囊', hint: '分类清点' },
  { id: 'moves', label: '谱册', hint: '乐章战技 · 主动槽' }
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
#stakerite .tag { font-size:11px; padding:1px 6px; border:1px solid rgba(201,180,88,.45); color:#c9b458; }
`

const SLOT_LABEL: Record<SlotKey, string> = {
  weapon: '武器', helm: '头部', cuirass: '躯干', gloves: '臂/手', greaves: '腿', seal: '音徽', sealA: '音徽 A', sealB: '音徽 B'
}

export interface StakeriteHooks {
  /** 面板里任何一次生效（分配/洗点/装备/强化/使用）之后调用，由 main.ts 重算派生值 */
  onApply: () => void
  /** 播报（走既有的 ui.notify 通道） */
  notify: (text: string, kind?: 'info' | 'reward' | 'boss') => void
  /** 消耗品生效（回血/刮失谐的数都来自 items.json 的 use，面板不直接碰玩家状态） */
  onUse: (eff: { heal: number; corruption: number }) => void
}

export class Stakerite {
  private readonly root: HTMLDivElement
  private tab: Tab = 'tune'
  private open = false
  /** 装备页当前选中要强化的件（uid） */
  private gearSel: string | null = null

  constructor(private readonly rpg: RpgRuntime, private readonly hooks: StakeriteHooks) {
    const style = document.createElement('style')
    style.textContent = CSS
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
    this.render()
  }

  close(): void {
    this.open = false
    this.root.classList.remove('on')
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.open) return
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const i = TABS.findIndex((t) => t.id === this.tab)
      const d = e.code === 'ArrowRight' ? 1 : -1
      this.tab = TABS[(i + d + TABS.length) % TABS.length].id
      this.render()
      e.preventDefault()
    }
  }

  private onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null
    if (!el) return
    const act = el.dataset.act!
    const arg = el.dataset.arg ?? ''
    switch (act) {
      case 'tab': this.tab = arg as Tab; break
      case 'alloc': this.alloc(arg as never); break
      case 'respec': this.respec(); break
      case 'equip': this.equip(arg); break
      case 'unequip': this.rpg.unequip(arg as SlotKey); this.hooks.notify('已卸下'); break
      case 'sel': this.gearSel = arg; break
      case 'upgrade': this.upgrade(arg); break
      case 'salvage': this.salvage(arg); break
      case 'use': this.use(arg); break
      case 'lit': this.unlock(arg); break
      case 'mvup': this.upgradeMove(arg); break
      case 'mvequip': this.equipSlot(arg); break
      case 'close': this.close(); break
      default: return
    }
    this.hooks.onApply()
    this.render()
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
          : this.renderMoves()
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
      <div class="row"><span class="name">DEF / 负重上限</span><span class="num">${d.defense} / ${d.loadMax} kg</span></div>
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
    const bag = inv.gears.map((g) => {
      const item = itemOf(g.itemId)
      const worn = Object.values(this.rpg.eq.slots).includes(g.uid)
      const cap = maxLevelOf(item)
      const step = upgradeStep(g.level)
      const canUp = !!step && inv.count(TIMBITE) >= step.timbite && inv.count(DROSS) >= step.dross
      const cost = step ? `${step.timbite} 石 / ${step.dross} 晶` : '已满'
      return `<div class="row">
        <span class="name">${item.displayName}${g.level > 0 ? ` <span class="tag">+${g.level}</span>` : ''}
          ${worn ? '<span class="tag">已装备</span>' : ''}
          <span class="note">${this.affixText(g.affixes)}</span></span>
        <span class="num">${g.level}/${cap} · ${cost}</span>
        <span class="act">
          <button class="act" data-act="equip" data-arg="${g.uid}" ${worn ? 'disabled' : ''}>装备</button>
          <button class="act" data-act="upgrade" data-arg="${g.uid}" ${canUp ? '' : 'disabled'}>强化</button>
          <button class="act" data-act="salvage" data-arg="${g.uid}" ${worn ? 'disabled' : ''}>分解</button>
        </span></div>`
    }).join('') || '<div class="empty">还没有任何装备件。</div>'
    return `<h2>七槽</h2>${slots}
      <h2>行囊中的装备（${inv.gears.length}）</h2>${bag}`
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
      return `<h2>${pg.displayName}${lit ? '' : ' · 全暗'}</h2>${unlock}${rows}`
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
}

/** 面板里要展示的属性键顺序（与 progression.json 一致；改表就跟着改） */
export const ATTR_ORDER = ATTR_KEYS
