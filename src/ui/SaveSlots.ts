import { registry } from '@/core/Registry'
import { regions } from '@/data'
import type { ProgressionData } from '@/data/schema'
import { allGearItems } from '@/rpg/Loot'
import { AUTOSAVE_SLOT, type SlotCard } from '@/save/Slots'

/**
 * 存档摘要卡的**显示侧车**（KI-025② / 需求 §45、ui-ux §8）。
 *
 * 和 `ui/TitleScreen.ts` 的 `titleCards()` 同族：一个不碰 DOM 的纯函数，把
 * `save/Slots.ts` 给出的**读数**换成**玩家看得懂的一句话**。名字解析放这里而不是放存档层，
 * 是因为存档层今天不认识成长层也不认识数据表（`arch-boundaries` 之外另一条自律：
 * 存档只管"存了什么"，"它叫什么"归显示），也为了让"卡面 == 表"这条对账有机器证人——
 * 屏上任何一格显示名都必须能在表里查到出处，缺了就显示"未知"而不是被 UI 编出来。
 */

/** 读档候选里坏档的原话。ui-ux §8 点名要"明示版本过旧而不是静默清空"，那条在这里落地 */
const PROBLEM_TEXT: Record<string, string> = {
  parse: '存档文件读不出内容（可能不完整）',
  magic: '存档不是本游戏写的（文件头不认识）',
  crc: '存档文件已损坏',
  version: '不是本游戏能读的版本',
  migration: '该存档版本过旧（缺少升级步骤）'
}

/** 手动槽的序号：`slot1 → 槽 I`。表里没有这一格，因为它不是游戏数据而是界面结构 */
const ROMAN = ['', 'I', 'II', 'III']

export interface SaveCardView {
  slot: string
  kind: 'auto' | 'manual'
  label: string
  /** 'empty' | 'ok' | 'restored' | 'blocked' —— 原样透传，让测试与样式都按它分支 */
  state: SlotCard['state']
  /** 卡面上的一行行读数（空槽是一条"空的"） */
  lines: string[]
  /** 黄标/升级标那一枚（null = 不显示） */
  badge: string | null
  /** 能不能按下去：坏档与空槽在"读取"这一侧都不可选 */
  selectable: boolean
  /** 坏档原话（null = 没坏） */
  note: string | null
  /** 数据来源键位（`slot1.prev` / `slot2@backup`），诊断与"详细信息"行用 */
  fromKey: string | null
}

export function slotLabel(slot: string): string {
  if (slot === AUTOSAVE_SLOT) return '自动'
  const n = Number(slot.replace('slot', ''))
  return Number.isInteger(n) && n >= 1 && n <= ROMAN.length - 1 ? `槽 ${ROMAN[n]}` : slot
}

/** 秒 → "1小时02分" / "3分40秒" / "40秒"（不超过一小时也保证有分有秒，读数不许出现 "0.6h"） */
export function playText(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}小时${String(m).padStart(2, '0')}分`
  if (m > 0) return `${m}分${String(s % 60).padStart(2, '0')}秒`
  return `${s}秒`
}

/** epoch ms → "2026-09-26 01:40"（本地时刻，玩家看的是自己手表上的时间）。null ⇒ 如实说未记录 */
export function savedAtText(ms: number | null): string {
  if (ms === null) return '时间未记录'
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const originText = (id: string | null, prog: ProgressionData | undefined): string => {
  if (id === null) return '出身 未知'
  return `出身 ${prog?.origins.find((o) => o.id === id)?.displayName ?? `未知(${id})`}`
}

/**
 * 存档读数 → 卡面。`data === null`（空槽/坏档）时只有标题与说明，不编任何一行读数。
 *
 * 三条刻意的诚实口径：
 * - 出身/武器/区域查不到 id ⇒ 显示 `xx 未知(id)` 而不是把 id 当名字印上去——
 *   那说明表和档不一致（比如区域被改名而老档还写着旧 id），这句话本身就是诊断信息；
 * - v1 老档没有成长数据 ⇒ 音级/出身两格都是"未知"，不拿当前出身冒充；
 * - 缺时间戳（v9 及更早）⇒ "时间未记录"，不是"今天"。
 */
export function saveCards(cards: SlotCard[]): SaveCardView[] {
  const prog = registry.maybeGet<ProgressionData>('progression')
  const gearByWeapon = new Map<string, string>()
  for (const it of allGearItems()) {
    if (it.gear?.weaponId && !gearByWeapon.has(it.gear.weaponId)) gearByWeapon.set(it.gear.weaponId, it.displayName)
  }
  return cards.map((c) => {
    const view: SaveCardView = {
      slot: c.slot, kind: c.kind, label: slotLabel(c.slot), state: c.state,
      lines: [], badge: null, selectable: false, note: null, fromKey: c.fromKey
    }
    if (c.state === 'empty') { view.lines = ['空的']; return view }
    if (c.state === 'blocked' || !c.data) {
      view.lines = ['读不出来']
      view.note = c.problem ? PROBLEM_TEXT[c.problem] ?? '存档不可读' : '存档不可读'
      return view
    }
    const d = c.data
    const region = d.regionId === null ? null : regions.find((r) => r.id === d.regionId)?.displayName ?? null
    view.selectable = true
    view.lines = [
      `${d.rank === null ? '音级 未知' : `音级 ${d.rank}`} · ${originText(d.originId, prog)}`,
      `武器 ${gearByWeapon.get(d.weaponId) ?? `未知(${d.weaponId})`}`,
      `区域 ${d.regionId === null ? '未知' : region ?? `未知(${d.regionId})`}`,
      `游玩 ${playText(d.playSec)}`,
      savedAtText(d.savedAt)
    ]
    // 黄标优先：恢复出来的档比"老版本升级"更要紧——玩家得先知道这一格不是干净的当前档
    view.badge = c.state === 'restored' ? '已恢复备份' : c.migrated ? `由 v${c.schemaVersion} 升级` : null
    return view
  })
}

/**
 * 卡片的样式。两个宿主（标题屏与调音桩面板）共用同一段，所以类名不带宿主前缀——
 * 同一件事在两处看起来不一样，玩家就要重新学一次"这张卡是什么意思"。
 * 黄标用金色底而不是绿色：它说的是"这一格是捡回来的"，是提醒不是奖励。
 *
 * 尺寸一律用 `em` 而不是 vh/vw：**基准字号由宿主给**（标题屏 `#title .scards`，面板
 * `#stakerite .scards`），卡片本身只描述相对关系。写死 vh 的话，同一张卡在大屏上是正文的
 * 1.5 倍、塞进 880px 的面料里就成了溢出的巨字——一张卡的字号不该由屏幕宽度决定。
 */
export const SAVE_CARD_CSS = `
.scards{display:flex;gap:1.4em;flex-wrap:wrap}
.scard{min-width:15em;padding:.9em .8em;border:1px solid #3d372e;background:rgba(23,20,19,.72);text-align:left}
.scard.empty{opacity:.5}
.scard.blocked{border-color:#7a3b3b}
.scard.restored{border-color:#c9a458}
.scard .hd{font-size:1.25em;color:#ffb86b;display:flex;gap:.5em;align-items:center}
.scard .badge{font-size:.72em;padding:.1em .45em;border-radius:.2em;background:#c9a458;color:#171413}
.scard .lns{font-size:.95em;color:#b7ab95;line-height:1.6;margin:.4em 0}
.scard .note{font-size:.88em;color:#d98a8a}
.scard .src{font-size:.78em;color:#5f584c}
.scard .acts{display:flex;gap:1em;margin-top:.5em;font-size:.95em}
.scard .btn{padding:.3em .8em;border:1px solid #3d372e;cursor:pointer;color:#b7ab95}
.scard .btn:hover{background:rgba(255,184,107,.18)}
.scard .btn.off{opacity:.4;cursor:not-allowed}
.scard .btn.off:hover{background:none}
`

/**
 * 卡片的 HTML。`actions` 决定这一屏给不给"读取/写入/删除"——同一张卡在标题屏只能读，
 * 在调音桩只能写与删：**能做什么由位置决定**，不是由卡自己决定。
 * 不可选（空槽/坏档）时按钮一律 `disabled`，但卡面照旧渲染，玩家才看得见"为什么按不动"。
 */
export function saveCardHtml(v: SaveCardView, actions: Array<'load' | 'write' | 'erase'>): string {
  const btn = (a: 'load' | 'write' | 'erase', text: string, enabled: boolean): string =>
    `<span class="btn${enabled ? '' : ' off'}" data-act="${a}" data-arg="${v.slot}"${enabled ? '' : ' data-disabled="1"'}>${text}</span>`
  const canWrite = v.kind === 'manual'
  const canErase = v.kind === 'manual' && v.state !== 'empty'
  const acts = actions.map((a) =>
    a === 'load' ? btn('load', '读取', v.selectable)
      : a === 'write' ? btn('write', '写入此处', canWrite)
        : btn('erase', '删除', canErase)).join('')
  return `<div class="scard ${v.state}" data-slot="${v.slot}">
  <div class="hd">${v.label}${v.badge ? `<span class="badge">${v.badge}</span>` : ''}</div>
  <div class="lns">${v.lines.map((l) => `<div>${l}</div>`).join('')}</div>
  ${v.note ? `<div class="note">${v.note}</div>` : ''}
  ${v.fromKey ? `<div class="src">来源 ${v.fromKey}</div>` : ''}
  <div class="acts">${acts}</div>
</div>`
}
