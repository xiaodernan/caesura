import { registry } from '@/core/Registry'
import type { ItemData, MovesetData, SlotKey, WeaponData } from '@/data/schema'
import { itemOf } from '@/rpg/Inventory'
import { progressionData } from '@/rpg/Progression'
import { SLOTS, type EquipMods } from '@/rpg/Equipment'
import { t } from '@/i18n/Lang'
import { upgradeStep, maxLevelOf, TIMBITE, DROSS, salvageValue } from '@/rpg/Upgrade'
import { sellPrice, stackSellPrice, shopData, CURRENCY } from '@/rpg/Shop'
import { movementName, unlockItemName, SCORE } from '@/rpg/Movements'
import { keyOf, codeLabel, BINDABLE_ACTIONS, GAMEPLAY_EXIT_ACTIONS, UI_INTENTS, UI_EXIT_INTENTS, type ActionName, type AnswerSource, type Binds, type UiBinds, type UiIntent } from '@/core/Input'
import { GAMEPLAY_BOUNDS, type GameplaySettings } from '@/settings/GameplaySettings'
import { BIND_BOUNDS, type BindChannel } from '@/settings/Bindings'
import { DEFAULT_QUALITY, QUALITY_NAMES, type QualityTier } from '@/settings/Quality'
import { actionLabel, intentLabel, padLabel } from '@/ui/actionLabels'
import type { RpgRuntime } from '@/rpg/Runtime'
import type { SlotCard } from '@/save/Slots'
import { SAVE_CARD_CSS, saveCards, saveCardHtml, slotLabel, type SaveCardView } from '@/ui/SaveSlots'

/**
 * 调音桩面板（Phase 5-B 的 UI 落点；需求 §41/§44 + progression.md §8.3）。
 *
 * 六页（接上把手之后是七页）：**调音**（音级/六维分配/洗点）、**装备**（七槽 + 强化）、**行囊**（分类清单）、
 * **谱册**（乐章战技的点亮/升级/装槽，Phase 5-C2）、**交易**（营地买卖，KI-055）、
 * **存档**（手动槽写入/删除，KI-025②）、**操作**（逐行改键 + 玩法六格，KI-337；没接把手就没有这一页）。
 * 用 DOM 而不是 HUD 的 canvas：这是一块要读字、要滚动、要点击的界面，不是战斗中的仪表盘
 * （tech-arch §1 的 UI 分工：HUD 走 canvas，菜单走 DOM overlay）。
 *
 * 它只调 RpgRuntime 的公开方法，不碰玩家、不碰场景；每次生效后回调 `onApply()`，
 * 由 main.ts 统一把派生值灌回玩家——面板自己不写第二份"应用变更"的逻辑。
 */

type Tab = 'tune' | 'gear' | 'bag' | 'moves' | 'trade' | 'save' | 'ops'

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'tune', label: t('stak.tab.tune'), hint: t('stak.tab.tune.hint') },
  { id: 'gear', label: t('stak.tab.gear'), hint: t('stak.tab.gear.hint') },
  { id: 'bag', label: t('stak.tab.bag'), hint: t('stak.tab.bag.hint') },
  { id: 'moves', label: t('stak.tab.moves'), hint: t('stak.tab.moves.hint') },
  { id: 'trade', label: t('stak.tab.trade'), hint: t('stak.tab.trade.hint') },
  { id: 'save', label: t('stak.tab.save'), hint: t('stak.tab.save.hint') }
]

/**
 * 「操作」页签**不在上面那张表里**：它要 `OpsPanelDeps` 那组把手才有东西可改，
 * 没接把手的面板不该给玩家一个点了没反应的页签（那是假可达）。
 * 页签的名册因此是**现推**的——`tabsOf()` 数的是"这块面板今天接得到什么"（§55 的那条纪律在这里的形状）。
 */
const OPS_TAB: { id: Tab; label: string; hint: string } = { id: 'ops', label: t('stak.tab.ops'), hint: t('stak.tab.ops.hint') }

/**
 * 玩法设置里那六格数值（两格开关另给行：`frameAssist` 与 KI-384 的 `mashGuard`）；步进量是**界面粒度**，不是规格，所以住在面板这侧。
 * KI-359：振动从一行长成两行——`docs/ui-ux.md` §6 那格写的是「0–200% 分（弱/强马达独立）」，
 * 一行两把把手只能画那一个数说两次；两行各占一个字段，注语才不必再替另一列作证。
 * KI-365：长按阈值那一行也骑这一对既有把手（`gameplay()`／`setGameplay(patch)`），所以接线层的名册一格都不长——
 * 它界内的数与「输入缓冲」同形状（整数毫秒），夹取仍由 `clampGameplaySettings` 一个人做，面板不夹一次。
 * KI-384：「连打」那一行同样骑既有 `gtoggle`——它是布尔，不是第七把把手；两行开关共用一个 case，
 * 翻的是各自己那一格（`data-arg` 写的是字段名，面板不认识玩法表）。共用一个分支也就共用一道闸门：
 * 那一步现在先看**当前值是不是布尔**再看名字，否则一个 `data-arg="bufferMs"` 就能把 220 写成 `false`、
 * 被边界夹回默认 200——那是替别一格洗格子，不是「这一枚翻不动」。
 */
type BoolKey = 'frameAssist' | 'mashGuard'
type NumericKey = Exclude<keyof GameplaySettings, BoolKey>
const OPS_NUMERIC: { key: NumericKey; label: string; step: number; note: string; fmt: (v: number) => string }[] = [
  { key: 'bufferMs', label: '输入缓冲', step: 20, note: '§5.1 那一格 · 80–240ms', fmt: (v) => `${Math.round(v)}ms` },
  { key: 'holdMs', label: '按住多久算长按', step: 50, note: '§6 那一格 · 200–800ms，重键松手快过这条线出一记重击，慢过它就只在蓄满时出手', fmt: (v) => `${Math.round(v)}ms` },
  { key: 'shakeScale', label: '镜头抖动', step: 0.1, note: 'combat §10 · 0–150%', fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'rumbleScale', label: '手柄振动·强马达', step: 0.1, note: '§6 · 0–200%，只乘强马达那一路幅值', fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'rumbleWeakScale', label: '手柄振动·弱马达', step: 0.1, note: '§6 · 0–200%，只乘弱马达那一路幅值（与强马达各一把尺）', fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'damageScale', label: '受击伤害', step: 0.05, note: 'gameplay · 70–130%，只乘玩家收到的那一份', fmt: (v) => `${Math.round(v * 100)}%` }
]

/**
 * 菜单那一条通道上唯一的那格数值（KI-345：机制与存档里早就有它，界面里没有）。
 * 步进量与那一节的行名是**界面粒度**，所以住在面板这侧；**界不在这里抄第二份**——
 * 读的是 `BIND_BOUNDS.stickThreshold`，夹它的也是同一句 `clampBindings`（口径 ② 说的那件事）。
 */
const OPS_STICK = {
  key: 'stickThreshold',
  label: '摇杆推过多少算按下',
  step: 0.05,
  note: '§6 那一格 · 25–90%，左摇杆走到菜单行上，过这条线才算按下'
} as const

/**
 * 玩法那一条通道上唯一的那格数值（KI-364，§6 那一格「扳机死区」）。与上面那一把**同一种形状**：
 * 步进量与行名是界面粒度，住在这侧；界读 `BIND_BOUNDS.triggerThreshold`，夹取读 `clampBindings`，
 * 面板既不抄默认也不夹一次。它画的不是「此刻用的那一张表」的键位，而是那张表上唯一的数值格
 * `gameplay.triggerThreshold`——所以它跟着玩法那一节画，消费者是 `Input.padOn` 那一个判据。
 */
const OPS_TRIGGER = {
  key: 'triggerThreshold',
  label: '扳机推过多少算按下',
  step: 0.05,
  note: '§6 那一格 · 5–95%，LT/RT 是模拟量，过这条线才算按下；一道线同时管改键、玩法与菜单三个读者'
} as const

/** 画质档位一行（F2 第一格 UI）：◀▶ 循环四档，面板只负责换，夹取在边界。 */
const OPS_QUALITY = {
  label: '画质档位',
  note: '低/中/高/极高 · 控制粒子生成预算（GPUParticles budgetMul），中=高=发售原样行为'
} as const

/**
 * 面板外壳（**两块 overlay 共用这一份**）：根/遮罩/膜、页头、页签、行、焦点框、页脚……
 *
 * 为什么是个导出的常量：`ui/MapUI.ts`（区域图）要用**同一件壳**。前缀写成 class `.cxs`
 * 而不是某一个 id——谁挂上这个 class 谁就穿上它（`#stakerite` 与 `#mapui` 各挂各的 id）。
 * 抄第二份的结局是：改了一块的圆角、忘了另一块，而这两处永远不会出现在同一个 diff 里。
 */
export const PANEL_CSS = `
.cxs { position:fixed; inset:0; display:none; z-index:20; pointer-events:none;
  font-family: Georgia, "Songti SC", "STSong", "SimSun", serif; color:#e8dfcb; }
.cxs.on { display:block; pointer-events:auto; }
.cxs .veil { position:absolute; inset:0; background:radial-gradient(ellipse at center, rgba(16,19,28,.72), rgba(7,8,12,.92)); }
.cxs .panel { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
  width:min(880px, 92vw); max-height:86vh; display:flex; flex-direction:column;
  background:linear-gradient(180deg, rgba(20,23,32,.97), rgba(12,14,20,.97));
  border:1px solid rgba(201,180,88,.34); box-shadow:0 24px 80px rgba(0,0,0,.6); }
.cxs header { display:flex; align-items:baseline; gap:18px; padding:16px 22px 12px;
  border-bottom:1px solid rgba(201,180,88,.18); }
.cxs header h1 { margin:0; font-size:19px; letter-spacing:.24em; font-weight:400; color:#c9b458; }
.cxs header .sub { font-size:12px; opacity:.6; letter-spacing:.08em; }
.cxs nav { display:flex; gap:2px; padding:10px 22px 0; }
.cxs nav button { background:none; border:0; border-bottom:2px solid transparent; color:#e8dfcb;
  opacity:.55; font:inherit; font-size:14px; letter-spacing:.16em; padding:8px 16px; cursor:pointer; }
.cxs nav button.sel { opacity:1; border-bottom-color:#ffb86b; }
.cxs main { padding:16px 22px 20px; overflow:auto; }
.cxs h2 { font-size:13px; letter-spacing:.2em; color:#ffb86b; font-weight:400; margin:18px 0 8px; }
.cxs h2:first-child { margin-top:0; }
.cxs .row { display:flex; align-items:center; gap:12px; padding:8px 10px; border-radius:2px; }
.cxs .row:nth-child(odd) { background:rgba(255,255,255,.028); }
.cxs .row .name { flex:1; font-size:14px; }
.cxs .row .num { font-variant-numeric:tabular-nums; opacity:.85; min-width:96px; font-size:13px; }
.cxs .row .note { font-size:12px; opacity:.5; max-width:320px; }
.cxs .row .act { display:flex; gap:6px; }
.cxs button.act { background:rgba(201,180,88,.12); border:1px solid rgba(201,180,88,.4);
  color:#e8dfcb; font:inherit; font-size:12px; padding:5px 12px; cursor:pointer; letter-spacing:.08em; }
.cxs button.act:hover:not(:disabled) { background:rgba(255,184,107,.22); }
/* §218 键盘/手柄导航的焦点框：描边而不是换底色——底色那条通道已被"能不能点"（disabled 发暗）
   占用了，而"禁用"与"正被选中"可以同时成立，两种状态不许抢同一个视觉通道 */
.cxs button.act.focus { outline:2px solid #b9e6ff; outline-offset:1px; }
.cxs button.act:disabled { opacity:.3; cursor:default; }
/* KI-368「存取哪一半」那一行的使用中那一枚：走边框与底色那条通道（页签那排 sel 用的是下划线，
   焦点框用的是 outline），三条视觉通道各说一件事——「是哪一枚」「能不能点」「焦点在哪儿」不抢同一个位置 */
.cxs button.act.sel { background:rgba(255,184,107,.3); border-color:#ffb86b; }
.cxs .foot { padding:10px 22px; border-top:1px solid rgba(201,180,88,.18);
  display:flex; gap:18px; font-size:12px; opacity:.62; letter-spacing:.06em; }
.cxs .empty { opacity:.45; font-size:13px; padding:10px 2px; }
.cxs .over { color:#a8695f; border:1px solid rgba(168,105,95,.6); padding:1px 6px; font-size:11px; letter-spacing:.08em; }
.cxs .tag { font-size:11px; padding:1px 6px; border:1px solid rgba(201,180,88,.45); color:#c9b458; }
/* == ember rite panel skin: 追加仪典皮肤——同级选择器后写覆盖，先排版后点金 == */
.cxs .veil { background:radial-gradient(ellipse 92% 82% at 50% 38%, rgba(26,22,18,.78) 0%, rgba(7,8,12,.94) 78%); }
.cxs .panel { border:1px solid rgba(201,180,88,.42); background:linear-gradient(180deg, rgba(30,27,24,.97) 0%, rgba(18,17,18,.985) 40%, rgba(10,11,14,.98) 100%);
  box-shadow:0 0 0 1px rgba(0,0,0,.55), 0 0 0 2px rgba(201,180,88,.07), 0 30px 90px rgba(0,0,0,.68), inset 0 1px 0 rgba(255,222,150,.1), inset 0 0 60px rgba(201,180,88,.04); }
.cxs header { background:linear-gradient(180deg, rgba(255,214,130,.05), transparent); border-bottom:1px solid rgba(201,180,88,.28); }
.cxs header h1 { background:linear-gradient(180deg, #fbf3dc, #cbb98a 55%, #8d7d55); -webkit-background-clip:text; background-clip:text; color:transparent;
  filter:drop-shadow(0 0 1.1vh rgba(255,214,130,.32)); letter-spacing:.3em; }
.cxs header h1::before { content:'✦ '; -webkit-text-fill-color:#c9b458; filter:none; }
.cxs nav button { transition:opacity .22s, color .22s, text-shadow .22s, border-color .22s; }
.cxs nav button:hover { opacity:.85; }
.cxs nav button.sel { color:#ffcf8a; text-shadow:0 0 1.4vh rgba(255,184,107,.5); border-bottom-color:#ffb86b; box-shadow:0 2px 12px -6px rgba(255,184,107,.65); }
.cxs main { scrollbar-width:thin; scrollbar-color:rgba(201,180,88,.35) transparent; }
.cxs main::-webkit-scrollbar { width:6px; }
.cxs main::-webkit-scrollbar-thumb { background:rgba(201,180,88,.32); border-radius:3px; }
.cxs .row { transition:background .18s ease; }
.cxs .row:hover { background:rgba(255,184,107,.055); }
.cxs h2 { display:flex; align-items:center; gap:10px; }
.cxs h2::before { content:''; display:inline-block; width:22px; height:1px; background:linear-gradient(90deg, #ffb86b, transparent); }
.cxs button.act { transition:background .2s, border-color .2s, box-shadow .2s, transform .12s; }
.cxs button.act:active:not(:disabled) { transform:translateY(1px); }
.cxs button.act:focus-visible { outline:2px solid #ffd98a; outline-offset:2px; }
.cxs button.act.sel { box-shadow:0 0 14px -4px rgba(255,184,107,.6), inset 0 0 10px -4px rgba(255,184,107,.35); }
.cxs .foot { background:linear-gradient(0deg, rgba(255,214,130,.05), transparent); border-top:1px solid rgba(201,180,88,.28); }
.cxs .tag { box-shadow:inset 0 0 8px -4px rgba(201,180,88,.45); }
/* == panel filigree · 四角窠臼（双刻线拱线 + 玉光角点，零新增节点） == */
.cxs .panel {
  background-image:
    linear-gradient(to right,  rgba(255,222,150,.42) 0 2px, transparent 2px),
    linear-gradient(to bottom, rgba(255,222,150,.42) 0 2px, transparent 2px),
    linear-gradient(to left,   rgba(255,222,150,.42) 0 2px, transparent 2px),
    linear-gradient(to bottom, rgba(255,222,150,.42) 0 2px, transparent 2px),
    linear-gradient(to right,  rgba(255,222,150,.42) 0 2px, transparent 2px),
    linear-gradient(to top,    rgba(255,222,150,.42) 0 2px, transparent 2px),
    linear-gradient(to left,   rgba(255,222,150,.42) 0 2px, transparent 2px),
    linear-gradient(to top,    rgba(255,222,150,.42) 0 2px, transparent 2px);
  background-size: 22px 1px, 1px 22px, 22px 1px, 1px 22px, 22px 1px, 1px 22px, 22px 1px, 1px 22px;
  background-position:
    left 10px top 17px,   left 17px top 10px,
    right 10px top 17px,  right 17px top 10px,
    left 10px bottom 17px, left 17px bottom 10px,
    right 10px bottom 17px, right 17px bottom 10px;
  background-repeat: no-repeat;
}
`

/** 调音桩自己那几块（遗响条 / §44 的双栏对比 / 存档页确认条）：别的面板不用，也就不必共享 */
const CSS = `
.cxs .xp { display:flex; align-items:center; gap:12px; margin-bottom:6px; }
.cxs .bar { flex:1; height:6px; background:rgba(232,223,203,.12); position:relative; overflow:hidden; }
.cxs .bar i { position:absolute; inset:0 auto 0 0; background:linear-gradient(90deg,#c9b458,#ffb86b); }
.cxs .meter { display:inline-block; vertical-align:middle; width:72px; height:6px; margin-left:8px;
  background:rgba(232,223,203,.12); position:relative; overflow:hidden; }
.cxs .meter i { position:absolute; inset:0 auto 0 0; background:linear-gradient(90deg,#c9b458,#ffb86b); }
.cxs .cmp { margin:2px 0 10px 12px; padding:8px 12px; border-left:2px solid rgba(201,180,88,.35);
  background:rgba(0,0,0,.18); }
.cxs .cmp-head, .cxs .cmp-row { display:grid; grid-template-columns:minmax(84px,1.2fr) 1fr 1.5fr 1fr;
  gap:10px; align-items:baseline; font-size:12.5px; }
.cxs .cmp-head { opacity:.55; letter-spacing:.14em; font-size:11px; margin-bottom:4px; }
.cxs .cmp-row .k { opacity:.72; letter-spacing:.06em; }
.cxs .cmp-row .a, .cxs .cmp-row .b { font-variant-numeric:tabular-nums; }
.cxs .cmp-row .b { opacity:.55; }
.cxs .cmp-row .d { font-variant-numeric:tabular-nums; letter-spacing:.04em; }
.cxs .cmp-row .d.up { color:#ffb86b; } .cxs .cmp-row .d.down { color:#a8695f; }
.cxs .cmp-row .d.flat { opacity:.35; }
/* 存档页：卡片本体与标题屏共用 SAVE_CARD_CSS，这里只给定基准字号与确认条 */
.cxs .scards { font-size:13px; }
.cxs .confirm { border:1px solid rgba(201,180,88,.5); background:rgba(201,180,88,.08); margin-bottom:10px; }
.cxs .confirm .name { font-size:13px; }
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
  /**
   * 「我要收起来了」的唯一出口（KI-061 补的洞）。面板**不许**自己 hide 自己：
   * 遮罩点击那条路以前直接 `close()`，于是 DOM 上的面板没了、`time.paused` 与 `input.enabled`
   * 却还挂着 —— 点一下背景就等于把游戏冻死在看不见的地冻里（Esc 只能再解开一半，
   * 因为 `input.enabled` 只有 `setPanelOpen` 那一处会恢复）。
   * 所以关闭的决定权交给持有者（`main.ts` 的 `setPanelOpen(false)`），面板只负责"提出"。
   */
  onRequestClose: () => void
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

/**
 * 改完一行之后面板要听的三件事（KI-348 起**两节同一份**）。
 * 与上面那条纪律一起成立：端口说的是"面板要听什么"，不是 `BindingsStore` 长什么样——
 * 所以这里按结构声明、不 import 边界那侧的类型名。但**结构本身在这个文件里只许写一次**：
 * 玩法那一格今天抄一份、菜单那一格另抄一份，将来加第四件事就得改两处，而漏掉的那一处
 * 不会红——它只会让某一节的措辞停在旧形状上（这正是本批要收掉的那条不对称的形状）。
 */
type RowSwap<V> = { displaced: V | null; moved: boolean; onto: 'keyboard' | 'pad' }

/**
 * 「操作」页的把手（KI-337）。与 `SavePanelDeps` 同一条口径：面板只拿函数，
 * 不认识 `BindingsStore`/`GameplaySettingsStore`，也不认识默认值——
 * 它要是能自己去拼一张默认表，§55 那句"默认值只有一个主人"当场就有了第二个读者
 * （`arch-boundaries` 那条闸门就是管这个的）。
 */
export interface OpsPanelDeps {
  /** 现读此刻生效的五格玩法设置（显示用；写回走 `setGameplay`） */
  gameplay: () => GameplaySettings
  /** 写一格玩法设置。夹取在信任边界里，面板只负责给一个步进量 */
  setGameplay: (patch: Partial<GameplaySettings>) => void
  /**
   * 画质档（Phase 7 F2）：读现档、写新档。面板只负责◀▶循环四档，
   * 夹取与信任边界由 `QualityStore.clampQuality` 统一做（面板不夹一次）。
   */
  quality: () => number
  setQuality: (tier: QualityTier) => void
  /**
   * 行覆盖率总地板（Phase 7 / KI-407）。面板只负责显示，不做判断。
   * **由装配处传入的那个函数说了算**（`makeOpsHandles` 不再读 `scripts/coverage-floor.json`）：
   * 浏览器 bundle 里 `process`／`readFileSync` 都不存在，那段老代码在浏览器里会静默抛错被吞 ⇒
   * 屏幕上永远是 0%，而测试里传的 `() => 95.58` 从来不被走到。今天由调用方决定给什么数。
   */
  coverage: () => number
  /**
   * 把一个动作绑到某把键。`code` 有两种拼写（KI-343）：`KeyboardEvent.code` 或 `Pad<n>`，
   * **认哪一种由 `BindingsStore.rebind` 回答**（语法本身就是路由），面板只是把捕获那侧给的字符串原样交过去。
   * KI-348 起交回的是 `RowSwap`（与菜单那一格同一份形状）：那一把原本归谁、它搬家没有、
   * 以及这一次写进了哪张表——面板要说的三句话读这三样，而不是自己去查旧表，也不按"我等的是哪种传感器"猜。
   * 返回 `null` 说的是边界**拒绝了这一次目标**（越界或畸形的 `Pad<n>`）：拒绝了就没有交换，
   * 也就没有一句说明可画——KI-343 那一版把拒绝读成「原本没有别人」，那是替一次没发生的写圆场。
   */
  rebind: (action: ActionName, code: string) => RowSwap<ActionName> | null
  /**
   * KI-342 那一格「无」：把这一行从键盘通道上摘掉。摘格子与记名单这两半都住在
   * `BindingsStore.unbind`——面板既不算"没写＝默认"，也不该自己拼一张名单。
   * KI-389 起它回答得出拒绝（boolean），与 `unbindPad` 同一条：那一行是出口时面板要答得出"关不掉"。
   */
  unbind: (action: ActionName) => boolean
  /**
   * 玩法那一行的手柄那一格「无」（KI-346）：与上面那一把同一条纪律（摘格子 + 记名单两半都在 store），
   * 区别只有两件：它写的是 `gameplay.padUnbound`（**每表一份**，不是每通道一份），
   * 而且它**回答得出拒绝**——名册外的 `data-arg` 返回假、一格不动，面板因此不必自己再持有一份名册。
   */
  unbindPad: (action: ActionName) => boolean
  /**
   * 把一个动作绑回它在默认表上的那一格。`via` 说回的是哪条通道，默认 `'key'`（KI-343）。
   * 返回值 = "这一行在那条通道上有默认键吗"：没有的那些（走路四格与 `throwCrystal`、`ability1..3`
   * 在手柄上没有默认键）面板要说出来，不许画一个按了没反应的按钮冒充可达。
   */
  resetKey: (action: ActionName, via: 'key' | 'pad') => boolean
  /** 整张键位回默认 */
  resetAll: () => void
  /**
   * 菜单那一行的「改键」（KI-344）。**单元是整组**：`confirm` 在默认表上是四把等价键，
   * 所以这一行改的就是那一整组——交出去的仍然只是"这一行 + 一枚目标"，
   * 折成一把、摘哪几把、别人少了哪一把，全由 `BindingsStore.rebindUi` 算，面板不自己数。
   * `code` 有两种拼写（KI-345 起这一节也认 `Pad<n>`）：**哪一串落到哪张表由边界回答**，
   * 面板只是把捕获那侧给的字符串原样交过去，既不解析也不猜。
   * 返回值说三件事：那一把原本归谁（null = 空着）、它是**少了一把**还是**整组搬了家**、
   * 以及这一次真正写进了哪张表（`onto`）——措辞与记号跟着落点走，跟着传感器猜就会说谎。
   * 返回 `null` 说的是边界**拒绝了这一次目标**（名册外的意图、越界或畸形的 `Pad<n>`）：
   * 拒绝了就没有交换，也就没有一句说明可画。
   * 形状就是上面的 `RowSwap`（KI-348 起两节共用一份声明）。
   */
  rebindUi: (intent: UiIntent, code: string) => RowSwap<UiIntent> | null
  /**
   * 菜单那一行的「无」（KI-344）。返回值 = 这一行**关不关得掉**：
   * `UI_EXIT_INTENTS` 那几格的答案永远是不能（关掉就是把这个屏变成陷阱），
   * 面板拿它说话，那一格既不静默、也不谎称已关掉。
   */
  unbindUi: (intent: UiIntent) => boolean
  /**
   * 菜单那一行的手柄那一格「无」（KI-346）：两半与 `unbindPad` 同一条纪律，而那道拒绝与
   * `unbindUi` 读的是**同一份名册**——「菜单必须走得出去」说的是这条通道走得出，不是"键盘那半走得出"，
   * 所以出口那一行两列都关不掉（`UI_EXIT_INTENTS` 因此是两张表共用的一个主人）。
   */
  unbindUiPad: (intent: UiIntent) => boolean
  /**
   * 菜单那一行的「回默认」：**整组**回来。返回值 = 这一行在那条通道上有没有家（名册外的名字没有）。
   * `via`（KI-345）默认 `'key'`，`'pad'` 回的是手柄那一列——一行有两个家，两把把手各回各的，
   * 绝不一键抹两条（与玩法那一节 KI-343 立的口径同形）。
   */
  resetUi: (intent: UiIntent, via: 'key' | 'pad') => boolean
  /**
   * 摇杆阈值那一格（KI-345）：**交回来的是夹过那一个数**，不是面板写进去的那一个。
   * 界住在 `BIND_BOUNDS`，治住在 `clampBindings`，面板只给一个步进量——所以它读回的是生效值，
   * 屏幕上那个数与消费者手里那个数不可能是两个（那是 ui-ux §8 反对的假读数）。
   */
  setStickThreshold: (v: number) => number
  /**
   * 扳机那条线那一格（KI-345 起这一对把手的形状）：**交回来的同样是夹过那一个数**。
   * 界住在 `BIND_BOUNDS`、治住在 `clampBindings`，面板只给一个步进量——屏幕上那一串百分比与
   * 消费者手里那一条线因此不可能是两个数（那是 ui-ux §8 反对的假读数）。
   */
  setTriggerThreshold: (v: number) => number
  /**
   * 改键捕获的三个把手（背后是 `Input.armKeyCapture()` 那一组）。
   * 面板自己不许挂 `keydown`（源码闸门钉着），所以"下一枚物理键"这件事只能问 `Input`。
   * `arm(via)`（KI-343）：这一次等的是键盘还是手柄——等谁就必须只让谁作答，
   * 否则玩家在面板上用摇杆走到那一行、顺手按了一下 A，那一行就被绑走了。
   */
  capture: { arm(via: 'key' | 'pad'): void; cancel(): void; take(only?: AnswerSource): string | null }
  /**
   * 配置文件那三盒（KI-362，KI-363 加第四把）：与 `capture` 同一种形状——几把把手、一位主人（`BindingsStore`），
   * 而**面板手里没有那三格本身**：`list()` 交回的只是「每一格里有没有东西」那三个布尔，
   * 不是三张表。要表的话面板就能自己去拼「载入哪一张」，那等于让运行时那张表多一个书写者（§55）。
   * `load(i)`／`store(i)`／`clear(i)` 的返回值都是**边界那句裁决**：前者假 = 那一格是空的，
   * `store` 的 null = 没有那一格，`clear` 的假 = 那一格本来就没东西；
   * 这几种拒绝各有各的话，面板照着说，不自己兜底也不替玩家圆场。
   *
   * KI-368 起 `load`／`store` 多一枚**可选**的通道：那是屏上那枚选择要递出去的东西，落点由边界的 `withChannel` 说
   * （不递 ⇒ 逐字仍是 KI-362 那一次整张）。`clear` 与 `list` 不收这一枚——请回空的始终是那一整格，
   * 「半满的盒」不是一种存在感（KI-367 那句「落盘仍是整张」在界面上的另一半）。
   */
  profiles: {
    list(): boolean[]
    load(i: number, ch?: BindChannel): boolean
    store(i: number, ch?: BindChannel): 'new' | 'overwritten' | null
    clear(i: number): boolean
  }
}

/**
 * 「操作」页两节的**节名**（KI-344）。页脚用它点名「等的是哪一节」，两个 `<h2>` 也读它：
 * 菜单里叫「后退」的那一行与玩法里叫「后退」的那一行（`moveDown`）在同一屏上同名，
 * 只有节名能把它们分开——而这个名字有第二个书写者的话，页脚就开始指错地方。
 */
const OPS_SECTIONS = Object.freeze({ gameplay: '玩法键位', ui: '菜单导航' })

/**
 * 屏上那枚「存取哪一半」（KI-368）：名册与两种叫法在这里一次写全——`label` 是屏上那一枚的名字，
 * `half` 是回声里那半张的叫法。`both` 那一句是空的：默认那一档的三句回声与 KI-362 时代逐字相同，
 * 给 KI-362 那句玩家已经读了三批的话改口要单独一批，不夹在本批里。
 *
 * **这里没有「哪些格算哪一条通道」**：那张划分表住在 `BIND_CHANNELS`（`src/settings/Bindings.ts`），
 * 本格只是它的读者。面板抄一份名单就是那张表第二个书写者的开始——KI-367 立「划分表只有一张」那条纪律，
 * 头号反例就长在这一屏上。
 */
const PROF_CHANS = ['both', 'kb', 'pad'] as const
type ProfChan = typeof PROF_CHANS[number]
const PROF_CHAN: Record<ProfChan, { label: string; half: string }> = Object.freeze({
  both: { label: '两半一起', half: '' },
  kb: { label: '只键鼠', half: '键鼠那一半' },
  pad: { label: '只手柄', half: '手柄那一半' }
})

/**
 * 正在等一枚键的那一行（KI-344 之后是判别联合）。
 * 三条事实必须同生同灭，所以写成一条记录而不是三个字段：谁在等、在哪一节、等哪种传感器
 * 分家写就是让"这一枚键该给谁"有两个书写者（漏掉一边 = 等键盘时按手柄被记进等键盘那一次）。
 * 等键状态只有面板这一份，`Input` 那边只有机制。
 * KI-345 起两节的 `via` 是**同一种形状**（菜单那一节也有手柄那一列了）——联合里那条窄成 `'key'` 的
 * 分支因此收成两格通用的那一个。
 */
type AwaitingRow =
  | { channel: 'gameplay'; action: ActionName; via: 'key' | 'pad' }
  | { channel: 'ui'; intent: UiIntent; via: 'key' | 'pad' }

/**
 * 刚发生过交换的那一格：把「这一把原本归谁」说出来一次，然后随下一次操作消失。
 * KI-348 起两节是**同一个形状**（各自的行名 + 同一份 `RowSwap`）：菜单那半先有 `onto` 与 `moved`，
 * 玩法那半今天也拿到同一三件事——于是渲染两节读的是同一个字段名，"措辞跟着落点走"这一句
 * 在两条通道上第一次有同一个兑现处（以前玩法那节按 `via` 分支，说的却是另一张表上的事）。
 * 记号里**不留** `via`：那是"我在等哪种传感器"，属于 `AwaitingRow`，不属于"边界究竟写了哪张表"。
 */
type SwapNote =
  | ({ channel: 'gameplay'; action: ActionName; code: string } & RowSwap<ActionName>)
  | ({ channel: 'ui'; intent: UiIntent; code: string } & RowSwap<UiIntent>)

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
  /**
   * §218「焦点记忆」：每页各自记住上次选中的那一行（按 `navRows` 的行号，不是 DOM 元素——
   * 面板每次动作后都整块重绘 innerHTML，抓住元素等于抓住一具尸体）。
   */
  private focusByTab: Partial<Record<Tab, number>> = {}
  /** 刚渲染出来的那一页正文（`navRows` 与焦点框都从它这里数行，不另抄名单） */
  private lastBody = ''
  /**
   * 屏幕上那一块字（KI-385）。它不是第二份数据，是「上一次画出去的字」的一个副本——
   * 改口的判据要问的是「此刻要画的字与它是否相同」，所以留的是字面而不是某个主人的版本计数：
   * 版本计数会因为某一条写方忘记涨它而停在昨天，字面不会。
   */
  private lastHtml = ''
  /** 正在等一枚物理键的那一行（见 `AwaitingRow`：为什么是联合而不是一串字段） */
  private awaiting: AwaitingRow | null = null
  /** 刚发生过交换的那一格（见 `SwapNote`：那一行在那一次操作里说过一次，之后就消失） */
  private swapNote: SwapNote | null = null
  /**
   * 屏上那枚「存取哪一半」（KI-368）：这一屏**唯一**的一时状态，主人只有面板。
   * 它不是一格设置——不进存档、不进那两个 store、也不进运行时那张表（那三盒在档里的形状因此一格没长）；
   * 它只决定下一次「存入」「载入」递不递边界那枚通道，默认 `both` ⇒ 逐字仍是 KI-362 那一次。
   * 三行共用这一枚，不是一行一枚：一屏两枚就是让「这一按动的是哪一半」有两个答案。
   */
  private profChan: ProfChan = 'both'

  constructor(private readonly rpg: RpgRuntime, private readonly hooks: StakeriteHooks, private readonly saves: SavePanelDeps,
    /**
     * 槽位标签与「操作」页那两列的读数来源（KI-336／KI-344）：读 `Input` 手里**此刻生效**的那两张表。
     * 这里原先直接读 `DEFAULT_BINDS`，而它上面那句「改键之后面板不会说谎」在绑定还是常量的年代
     * 是空头支票——键位变成数据之后，这一格才是那句注释的兑现处；短名换算也交回 `keyOf`/`codeLabel` 那唯一的主人。
     * `uiBinds`（KI-344）是菜单那一节读的那一张：两节各有各的表，但主人仍是同一个 `Input`。
     */
    private readonly bindsSource: { readonly binds: Binds; readonly uiBinds: UiBinds } | null = null,
    /** 「操作」页的把手（KI-337）；没接就没有那一页（见 `OPS_TAB`） */
    private readonly ops: OpsPanelDeps | null = null) {
    const style = document.createElement('style')
    style.textContent = PANEL_CSS + CSS + SAVE_CARD_CSS
    document.head.appendChild(style)
    this.root = document.createElement('div')
    this.root.id = 'stakerite'
    this.root.classList.add('cxs') // 穿上共用那件壳（见 PANEL_CSS）
    document.body.appendChild(this.root)
    this.root.addEventListener('click', (e) => this.onClick(e))
  }

  get isOpen(): boolean { return this.open }

  // 这里曾经有过一枚 `toggle()`（开↔关自己翻），它是 KI-061「关闭只认一个主人」那句的第二个主人：
  // 全仓库没有任何地方叫它——面板的开合只在组合根 `setOverlay` 那一处走 `show()`/`close()`
  // （2026-11-10 KI-437 用 `git grep '\.toggle(' HEAD -- src` 量过：src 里那一处是 `lock.toggle()`，属主是 LockOn）。

  show(): void {
    this.open = true
    this.navUsed = false   // 每次打开都从"没有焦点框"开始（焦点行号仍按页记着，§218 的焦点记忆是跨页不是跨开场）
    this.root.classList.add('on')
    if (this.tab === 'save') this.refreshSaves()
    this.render()
  }

  close(): void {
    this.open = false
    this.root.classList.remove('on')
    this.pending = null
    this.standDown()
  }

  /**
   * 撤掉"正在等一枚键"这件事（关面板 / 换页 / 换行 / 换页签都算）。
   * 两边都要动是对的：`awaitingKey` 是面板的话，`capture.cancel()` 是 `Input` 的话——
   * 只撤一边就会留下一枚"没人认领的下一枚键"，玩家按下去什么也不发生，那比不响更糟。
   */
  private standDown(): void {
    if (this.awaiting === null) return
    this.awaiting = null
    this.ops?.capture.cancel()
  }

  /**
   * 等待那一格说得出**哪几种传感器算答案**（KI-360）。为什么这一句要按"那一行归哪一节"分岔，
   * 而不是全 panel 统一一句：鼠标那三格（`MouseLeft`／`MouseRight`／`MouseMiddle`）住在**玩法**那张表里，
   * 菜单那一列的读者只有 `keydown` 那一条路——`Bindings.rebindUi` 因此收不下鼠标码（收了就是一个
   * 永远不被读的格子，§55）。屏上若替菜单那一行也说"点鼠标也算"，那是一句边界不认的承诺。
   */
  private awaitSensorLabel(w: AwaitingRow): string {
    if (w.via === 'pad') return '手柄键'
    return w.channel === 'gameplay' ? '键（或鼠标）' : '键'
  }

  /** 页签名册现推（§55）：接得到把手才有「操作」这一页 */
  private tabsOf(): { id: Tab; label: string; hint: string }[] {
    return this.ops ? [...TABS, OPS_TAB] : TABS
  }

  /** 换页：进存档页就现取名册（离开时把未确认的那一笔撤掉，别把确认条留在别的页里） */
  private setTab(tab: Tab): void {
    this.tab = tab
    this.pending = null
    this.swapNote = null
    this.standDown()
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
    /* KI-360 那一声「另外发明的握手」（账本 KI-343 ④／KI-344 ④／KI-346 ③ 欠的就是这一格）：
       鼠标现在会替等待作答，而作答挂在 window 的按下上——于是**按在控制件上的那一下同时是两件事**：
       面板的一下，和那一行等的一枚答案。不撤，点「解绑」就顺手把左键绑进正等着的那一行、
       点滑杆就把滑杆变成改键。撤的方式是把它读走再重新武装：只 `cancel` 会让面板还挂着「等待中」
       而 `Input` 已经不听了（那正是 KI-337 抓过的"半截等待"），所以撤答案必须连着把等待续上。
       KI-361 补的是这一句里多撤的那一半：撤的是**这一下自己答的那一枚**，不是"袋里恰好有东西"。
       同一帧里玩家先按下一把键、又点了一下别处，那把键是那一行等的答案——连着重新武装它，
       屏幕上既不绑也没有一句说明，玩家只知道"我按了它没反应"（账本 KI-360 还欠① 点名的就是这一格）。 */
    const waiting = this.awaiting
    if (waiting !== null && this.ops && this.ops.capture.take('mouse') !== null) this.ops.capture.arm(waiting.via)
    this.run(el.dataset.act!, el.dataset.arg ?? '', !!el.dataset.disabled)
  }

  /**
   * 面板里**每一个**动作的唯一点发口：鼠标点击与手柄/键盘确认都走这里（§218 的"全路径可达"
   * 要求两条路落在同一个 handler 上，否则键盘那条会变成一套需要各自对齐的实现）。
   * `disabled` 是那一行的按钮当前是否禁用（浏览器替鼠标挡了 `disabled`，键盘/手柄这条路没人挡，
   * 所以这里必须自己挡 —— 让"买不起"的条目被 Enter 买下去不是可达性，是 bug）。
   */
  private run(act: string, arg: string, disabled = false): void {
    if (disabled && act !== 'close' && act !== 'tab') return
    // 存档那一页的三个动作各自收尾（都是异步或纯 UI 状态，不重算派生值也不共用尾部逻辑）
    if (act === 'write' || act === 'erase') {
      if (this.saving || this.savesOf(arg) === null) return
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
      case 'arm': this.armKey(arg as ActionName, 'key'); return
      case 'armpad': this.armKey(arg as ActionName, 'pad'); return
      case 'armui': { const i = this.uiRow(arg); if (i !== null) this.armUi(i); return }
      case 'armuipad': { const i = this.uiRow(arg); if (i !== null) this.armUi(i, 'pad'); return }
      case 'unarm': this.standDown(); this.render(); return
      case 'resetkey': this.resetOneKey(arg as ActionName, 'key'); break
      case 'resetpad': this.resetOneKey(arg as ActionName, 'pad'); break
      case 'resetui': { const i = this.uiRow(arg); if (i !== null) this.resetOneUi(i, 'key'); break }
      case 'resetuipad': { const i = this.uiRow(arg); if (i !== null) this.resetOneUi(i, 'pad'); break }
      case 'unbind': this.unbindKey(arg as ActionName); break
      case 'unbindpad': this.unbindPadKey(arg as ActionName); break
      case 'unbindui': { const i = this.uiRow(arg); if (i !== null) this.unbindOneUi(i); break }
      case 'unbinduipad': { const i = this.uiRow(arg); if (i !== null) this.unbindOneUiPad(i); break }
      case 'resetall': this.ops?.resetAll(); this.swapNote = null; this.hooks.notify('键位整张回到默认'); break
      case 'profstore': this.storeProfile(arg); break
      case 'profload': this.loadProfile(arg); break
      case 'profclear': this.clearProfileRow(arg); break
      case 'profchan': this.setProfChan(arg); return
      case 'gstep': this.stepGameplay(arg); break
      case 'ustep': this.stepStick(arg); break
      case 'tstep': this.stepTrigger(arg); break
      case 'qstep': this.stepQuality(arg); break
      case 'gtoggle': {
        /* KI-384：两枚开关共用这一个分支，而 `arg` 是屏上任意一枚按钮递进来的名字。闸门写在「当前值是不是布尔」上，
           不写在名字上——落到数值格那一步写进去的是 `false`，边界会把它当错型夹回**默认**：那不是「翻不动」，是替别一格洗格子。 */
        const cur = this.ops?.gameplay()[arg as keyof GameplaySettings]
        if (typeof cur === 'boolean') this.ops?.setGameplay({ [arg]: !cur } as Partial<GameplaySettings>)
        break
      }
      case 'close': this.requestClose(); break
      default: return
    }
    this.hooks.onApply()
    this.render()
  }

  /** 面板不自己关自己：把"收起来"这个请求交给持有者（见 `StakeriteHooks.onRequestClose`） */
  private requestClose(): void { this.hooks.onRequestClose() }

  /* ------------------------------ 导航（§218） ------------------------------ */

  /**
   * 当前这一页上"可被选中的行"：**从刚渲染出来的那段 HTML 里读**，不另抄一份名单。
   * 抄一份就会和渲染漂移（多一个按钮、少一个按钮，行号就全体错位，而焦点是按行号记的）。
   * 遮罩（`data-act="close"`）与页签按钮（切页有 ←→/肩键专门管）不算行。
   * 这一份是**唯一的行定义**：`navRows` 与 `markFocus` 都读它，否则"焦点框画在哪"和
   * "Enter 执行哪一行"就有两套坐标，而两套坐标迟早会差一格。
   */
  private navTags(html: string): string[] {
    return (html.match(/<button\b[^>]*>/g) ?? []).filter((t) => {
      const act = t.match(/data-act="([^"]*)"/)?.[1]
      return !!act && act !== 'close' && act !== 'tab'
    })
  }

  private navRows(): { act: string; arg: string; disabled: boolean; tag: string }[] {
    return this.navTags(this.lastBody).map((tag) => ({
      act: tag.match(/data-act="([^"]*)"/)![1],
      arg: tag.match(/data-arg="([^"]*)"/)?.[1] ?? '',
      disabled: /\bdisabled\b/.test(tag),
      tag,
    }))
  }

  /** 焦点在导航键按下时才点亮（鼠标用户不该看见一个孤零零的框） */
  private navUsed = false

  /** 把焦点框画在第 N 个可导航按钮上——行的定义只有 `navTags` 一处，这里按它取到就替换 */
  private markFocus(html: string): string {
    const tags = this.navTags(html)
    const target = this.focusRow()
    if (target < 0 || target >= tags.length) return html
    const tag = tags[target]
    const at = html.indexOf(tag)
    if (at < 0) return html
    const patched = /class="/.test(tag)
      ? tag.replace(/class="([^"]*)"/, 'class="$1 focus"')
      : tag.replace('<button', '<button class="focus"')
    return html.slice(0, at) + patched + html.slice(at + tag.length)
  }

  private focusRow(): number {
    const n = this.navRows().length
    if (n === 0) return 0
    const f = this.focusByTab[this.tab] ?? 0
    return f < n ? f : n - 1   // 行数会因强化/购买而变少：焦点钳回最后一行，不躲进空气里
  }

  private moveFocus(delta: number): void {
    this.standDown()   // 等键途中换了行 ⇒ 那一行不再等（不然下一枚键会绑到玩家已经走开的那一行）
    const n = this.navRows().length
    if (!n) return
    // 第一次按导航键只是**把框亮出来**（停在记住的那一行上），不顺手挪一格：
    // 否则"按下键"这个动作被数了两次——既出现焦点框又往下走一行，玩家看到的选中项和他按的次数差一格。
    if (!this.navUsed) { this.navUsed = true; this.render(); return }
    this.focusByTab[this.tab] = (((this.focusRow() + delta) % n) + n) % n  // 回绕：列表是环，§218 的摇杆语义
    this.render()
  }

  private page(delta: number): void {
    const tabs = this.tabsOf()
    const i = tabs.findIndex((t) => t.id === this.tab)
    this.setTab(tabs[(i + delta + tabs.length) % tabs.length].id)
  }

  /**
   * 菜单读数的**唯一入口**（KI-062）：意图由 `core/Input.ts` 的 UI 通道给（键盘码、手柄十字键、
   * 左摇杆、肩键在那儿已经折成同一组 `UiIntent`），本方法只负责把它们落到"走行 / 走页 / 执行 / 后退"上。
   *
   * 这里刻意**不再挂任何 `keydown` 监听器**：DOM 一条、菜单一条就是两个主人，一次 ↓ 会被数两遍
   * （框刚亮起来又立刻挪一格）。现在键盘也走同一条意图通道，面板只认这一个入口
   * （`tests/unit/ui-intents.test.ts` 里有源码门钉着）。
   */
  uiStep(intents: ReadonlySet<UiIntent>): void {
    if (!this.open) return
    // 捕获排在意图**之前**问：武装那一拍两条通道一格都不发（见 `Input.armKeyCapture` 上那段理由），
    // 所以"玩家按下了要绑的那把键"这一帧递进来的 `intents` 是空的——先问捕获，那枚键才有读者。
    if (this.awaiting !== null && this.takeCapturedKey()) return
    // KI-385：一帧里没人按把手，屏上那些**主人不在面板手里**的读数（此刻生效那两张表／那八格／那三盒／
    // 页眉页脚那几格 `rpg` 的数）也可能已经变了——以前这一句直接 `return`，于是那一屏从这一帧起停在昨天。
    // 现在也走 `render`，而它先问的是「此刻要画的字与屏幕上那块字是否相同」：相同就一个 DOM 写都不发生，
    // 所以这一句既不是「每帧重排整屏」，也不需要一个谁都能忘记涨的版本号。
    if (intents.size === 0) { this.render(); return }
    // 左右与肩键都落在换页上：面板只有一维列表可走，横向语义就是"翻页"（§5.2 的肩键切页）
    if (intents.has('pagePrev') || intents.has('left')) { this.page(-1); return }
    if (intents.has('pageNext') || intents.has('right')) { this.page(1); return }
    if (intents.has('up')) { this.moveFocus(-1); return }
    if (intents.has('down')) { this.moveFocus(1); return }
    if (intents.has('confirm')) {
      const row = this.navRows()[this.focusRow()]
      if (!row) return
      this.navUsed = true
      this.run(row.act, row.arg, row.disabled)
      return
    }
    if (intents.has('back')) {
      /* 等键途中先退那一步等待，而不是把面板整层退掉。KI-343 之后离散的两条来源（键码与手柄按钮）
         在等待途中本来就被捕获挡成"一条意图都不发"，所以走到这里的 `back` 只剩两种来历：模拟量之外的
         未来来源，以及走查桩直接递进来的意图。留着不是装饰——`back` 若真落进来而这里不挡，退的就是
         整层面板，而 `close()` 里那句 standDown 会把"玩家正在改的那一行"一起带走（腿在 controls-page）。 */
      if (this.awaiting !== null) { this.standDown(); this.render(); return }
      // 「Back 永远后退一层」：确认条还挂着时先撤确认，否则才退面板（解冻由持有者做，见 onRequestClose）
      if (this.pending) { this.pending = null; this.render() } else this.requestClose()
    }
  }

  /**
   * 读走那一枚键。返回 true = 这一帧被"改键"这件事消费掉了，不再走意图。
   * `Escape` 是**取消**而不是绑成 Escape——§5.1 那一行没写"把后退绑走"，而玩家按 Escape 的本意
   * 就是退出等待；把它绑上去会同时偷走面板唯一的后退键。
   */
  private takeCapturedKey(): boolean {
    const code = this.ops?.capture.take()
    if (code === null || code === undefined) return false   // 还没按：让这一帧的意图照常走（手柄还能用 ↑↓ 换行，换行即撤等待）
    const waiting = this.awaiting
    this.standDown()
    if (code === 'Escape' || waiting === null) { this.render(); return true }
    this.swapNote = this.noteOf(waiting, code)
    this.render()
    return true
  }

  /**
   * 「这一格原本归谁」由搬家规则回答（`rebind` / `rebindUi` 的返回值），面板不自己解析 `Pad<n>`、
   * 也不自己查旧表——那会让目标拼写出现第二个读者（语法只有一个主人正是 KI-343 的立足点）。
   * KI-348 起两节走的是同一条形状：交回来的三件事原样铺进那一格的说明，面板这里**不加**第四个字段、
   * 也不把 `waiting.via` 抄进来——等的是哪种传感器是 `AwaitingRow` 的事，说出来的是边界写了哪张表。
   * 返回 `null` 说的是**边界拒绝了这一次目标**：菜单那半是名册外的意图名或"说了要手柄但那把不存在"，
   * 玩法那半是越界或畸形的 `Pad<n>`（`Pad20`／`Pad07`）。
   * 拒绝了就没有交换，也就没有一句说明可画——替玩家圆场的那句「这一把原本是空着的」正是 ui-ux §8 反对的假读数。
   */
  private noteOf(waiting: AwaitingRow, code: string): SwapNote | null {
    if (waiting.channel === 'ui') {
      const swap = this.ops?.rebindUi(waiting.intent, code)
      return swap ? { channel: 'ui', intent: waiting.intent, code, ...swap } : null
    }
    const swap = this.ops?.rebind(waiting.action, code)
    return swap ? { channel: 'gameplay', action: waiting.action, code, ...swap } : null
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
    if (!p) return
    // saving 先置位、pending **留到落盘之后再清**：确认条上那句「落盘中…」读的是 saving，
    // 而那一行的渲染条件是 pending 还在——先清 pending 就等于把这句话永远留在纸上
    // （玩家点下确认的那一瞬间行会整条消失，慢存储上看起来像「点了没反应」）。
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
      this.pending = null
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

  /**
   * 此刻要画的那一整块字（页眉那两格、当前那一页的正文、页脚那三格全在这一句里），**不碰 DOM**。
   * KI-385 把它从 `render` 里分出来只为一件事：同一句问两遍——玩家按了一下要问，
   * 一帧里没人按也要问（见 `uiStep`）。答案是一块字而不是一份版本号，所以改口的覆盖面
   * 天生等于画出去的那些字：给任何一个主人加版本计数都会留下「某条写方忘了涨它」的那种停昨天。
   */
  private compose(): string {
    const raw = this.tab === 'tune' ? this.renderTune()
      : this.tab === 'gear' ? this.renderGear()
        : this.tab === 'bag' ? this.renderBag()
          : this.tab === 'moves' ? this.renderMoves()
            : this.tab === 'trade' ? this.renderTrade()
              : this.tab === 'save' ? this.renderSave()
                : this.renderOps()
    this.lastBody = raw
    const body = this.navUsed ? this.markFocus(raw) : raw
    return `
      <div class="veil" data-act="close"></div>
      <div class="panel">
        <header>
          <h1>调音桩</h1>
          <span class="sub">音级 ${this.rpg.prog.rank} · 遗响 ${this.rpg.prog.xp}${this.rpg.prog.unspent > 0 ? ` · 未分配 ${this.rpg.prog.unspent}` : ''}</span>
        </header>
        <nav>${this.tabsOf().map((t) => `<button data-act="tab" data-arg="${t.id}" class="${t.id === this.tab ? 'sel' : ''}">${t.label}</button>`).join('')}</nav>
        <main>${body}</main>
        <div class="foot">
          <span>${this.awaiting === null ? '← → 换页 · ↑ ↓ 选行 · Enter 执行 · Backspace 后退'
            : `等待一枚${this.awaitSensorLabel(this.awaiting)} · ${OPS_SECTIONS[this.awaiting.channel]} · ${this.awaiting.channel === 'ui' ? intentLabel(this.awaiting.intent) : actionLabel(this.awaiting.action)}（Escape 取消）`}</span><span>Tab 收起</span>
          <span>音色石 ${this.rpg.inv.count(TIMBITE)}</span><span>残晶 ${this.rpg.inv.count(DROSS)}</span>
          <span>乐谱残页 ${this.rpg.inv.count(SCORE)}</span>
        </div>
      </div>`
  }

  /** 画那一屏：字没变就一个 DOM 写都不许有（每次整块重排是既有做法，本批只让它先问一句「变了吗」） */
  private render(): void {
    if (!this.open) return
    const html = this.compose()
    if (html === this.lastHtml) return
    this.lastHtml = html
    this.root.innerHTML = html
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
      // 到顶看的是**稀有度上限**，不是表的最后一行：表里有 2..10，而素声件 +3 就到顶。
      // 只问 upgradeStep 会让一件到顶的素声件继续报「40 石 / 1 晶」——那一格它永远走不到，
      // 而材料够时强化按钮还会亮着（点下去才被告知「已到该稀有度的强化上限」）。
      const step = g.level < cap ? upgradeStep(g.level) : null
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
    return keyOf(action, this.bindsSource?.binds) ?? '—'
  }

  private renderMoves(): string {
    const book = this.rpg.moves
    const inv = this.rpg.inv
    const rank = this.rpg.prog.rank
    const pages = book.cfg.pages.map((pg) => {
      const lit = book.isLit(pg.id)
      // 解锁源二形（KI-037）：item 页数实物，flag 页见证事件——按钮判据两形共用 canUnlock
      const src = pg.unlock.flag
        ? `<span class="num">${unlockItemName(pg.id)} · ${book.hasFlag(pg.unlock.flag) ? '已见证' : '未见证'}</span>`
        : (() => { const have = inv.count(pg.unlock.item ?? ''); return `<span class="num">${itemOf(pg.unlock.item ?? '').displayName} ${have}/${pg.unlock.count ?? 1}</span>` })()
      const unlock = `<div class="row"><span class="name">解锁源<span class="note">${pg.desc}</span></span>
        ${src}
        <span class="act"><button class="act" data-act="lit" data-arg="${pg.id}" ${lit || !book.canUnlock(pg.id, inv) ? 'disabled' : ''}>${lit ? '已点亮' : '点亮'}</button></span></div>`
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

  /* ------------------------------- 操作（KI-337） ------------------------------- */

  /**
   * 点「改键」＝武装那一行**那一条通道**；已在等同一行的同一通道就撤（再点一次是"我改主意了"，
   * 不是第二次武装）。同一行点**另一条**通道 = 换目标传感器，不是撤销：等手柄时改主意要绑键盘，
   * 按下去就该开始听键盘（两条通道各自一把把手，正因为一次等待只认一个来源）。
   */
  private armKey(action: ActionName, via: 'key' | 'pad'): void {
    if (!this.ops) return
    if (this.awaiting?.channel === 'gameplay' && this.awaiting.action === action && this.awaiting.via === via) { this.standDown(); this.render(); return }
    this.awaiting = { channel: 'gameplay', action, via }
    this.swapNote = null
    this.ops.capture.arm(via)
    this.render()
  }

  /**
   * 菜单那一行的「改键」（KI-344）：与玩法那一节同一个撤／换规则——同一行点**另一条**通道是换目标
   * 传感器，不是撤销。KI-345 起这一节也听手柄：`via` 说的就是这一次等哪种传感器，
   * 而那一枚键落到哪张表由 `rebindUi` 回答（面板不知道也不该知道那张表长什么样，更不解析 `Pad<n>`）。
   */
  private armUi(intent: UiIntent, via: 'key' | 'pad' = 'key'): void {
    if (!this.ops) return
    if (this.awaiting?.channel === 'ui' && this.awaiting.intent === intent && this.awaiting.via === via) { this.standDown(); this.render(); return }
    this.awaiting = { channel: 'ui', intent, via }
    this.swapNote = null
    this.ops.capture.arm(via)
    this.render()
  }

  /**
   * 菜单那一节的三把把手共用的一道闸（KI-344）：`data-arg` 是字符串，DOM 那侧谁都能写，
   * 而名册外的名字**连名字都没有** ⇒ 不交给边界、不响一声、也不画一句凭空的说明
   * （与存档卡面那一处 `savesOf` 同一口径：查不到就不动）。判据读的是 `core/Input.ts` 那份名册，这里不另抄清单。
   */
  private uiRow(arg: string): UiIntent | null {
    return (UI_INTENTS as readonly string[]).includes(arg) ? arg as UiIntent : null
  }

  /**
   * 一行回默认：交回给 `BindingsStore.resetKey`，默认格是它算的，不是面板抄的。
   * `via` 决定回的是哪条通道——两半各自有家，「键盘回默认」不许抹平手柄那一次改键，反之亦然
   * （那条腿在 `bindings-data`，页面上这一格也有）。
   * 先撤等待与「解绑」同一句理由：等键的是别的那一行时这一格点得动，不撤的话后来那一枚键
   * 会被吞进一个已经改过主子的行。
   * 返回值说的是"这一行在那条通道上有没有家"：面板拿它说话，就不必自己去读默认表
   * （那是 §55 要给第二个主人的那一格）。
   */
  private resetOneKey(action: ActionName, via: 'key' | 'pad'): void {
    if (!this.ops) return
    this.standDown()
    const hasHome = this.ops.resetKey(action, via)
    this.swapNote = null
    const where = via === 'pad' ? '手柄' : '键盘'
    this.hooks.notify(hasHome
      ? `${actionLabel(action)} 回到默认那一格`
      : `${actionLabel(action)} 在${where}上没有默认键 ⇒ 这一行没动`)
  }

  /**
   * 一行「无」（KI-342）：面板只说"这一格我不要"，两半——摘掉它占的格子、把名字记进名单——
   * 都住在 `BindingsStore.unbind` 里。先撤等待不是装饰：正在等键的是**别的那一行**时这一格点得动
   * （自己那一行的按钮组里没有「解绑」），不撤的话后来那一枚键会被吞进一个已经改过主子的行。
   */
  private unbindKey(action: ActionName): void {
    if (!this.ops) return
    this.standDown()
    this.swapNote = null
    if (!this.ops.unbind(action)) { this.hooks.notify(`${actionLabel(action)} ${GAMEPLAY_EXIT_ACTIONS.includes(action) ? '这一行两列都关不掉 ⇒ 一格都没动' : '不在名册上 ⇒ 一格都没动'}`); return }
    this.hooks.notify(`${actionLabel(action)} 在键盘上解绑（手柄那侧不动）`)
  }

  /**
   * 玩法那一行的手柄那一格「无」（KI-346）：面板说的仍然只是"这一列我不要"，
   * 摘格子与记名单两半都住在 `BindingsStore.unbindPad` 里。
   * 这一把**回答得出拒绝**（`data-arg` 是 DOM 里谁都能写的字符串）：名册外的名字 store 说假，
   * 面板就把那句"不在名册上"说出来——静默会让玩家以为自己按坏了，而谎称"已关掉"会让他去按一把没绑的键。
   * 先撤等待与键盘那一把同一条理由：正在等键的是别的那一行时这一格点得动，不撤的话后来那枚按钮
   * 会被吞进一次已经改过主子的等待。
   */
  private unbindPadKey(action: ActionName): void {
    if (!this.ops) return
    this.standDown()
    this.swapNote = null
    if (!this.ops.unbindPad(action)) { this.hooks.notify(`${actionLabel(action)} ${GAMEPLAY_EXIT_ACTIONS.includes(action) ? '这一行两列都关不掉 ⇒ 一格都没动' : '不在名册上 ⇒ 一格都没动'}`); return }
    this.hooks.notify(`${actionLabel(action)} 在手柄上解绑（键盘那侧不动）`)
  }

  /**
   * 菜单那一行的手柄那一格「无」（KI-346）：与玩法那一把同一条纪律，而那句拒绝读的是**同一份名册**——
   * 「菜单必须走得出去」管的是这条通道的两张表，所以出口那一行两列都关不掉（不是只锁键盘那一半）。
   */
  private unbindOneUiPad(intent: UiIntent): void {
    if (!this.ops) return
    this.standDown()
    this.swapNote = null
    if (!this.ops.unbindUiPad(intent)) { this.hooks.notify(`${intentLabel(intent)} 这一行两列都关不掉 ⇒ 一格都没动`); return }
    this.hooks.notify(`${intentLabel(intent)} 在菜单手柄上解绑（键盘那侧与玩法都不受影响）`)
  }

  /**
   * 菜单那一行的「无」（KI-344）：面板说的仍然只是"这一格我不要"，
   * 摘格子与记名单两半都住在 `BindingsStore.unbindUi` 里。
   * 那句拒绝不是装饰：`back` 那一行屏幕上没有把手，被硬点到时（`run` 的那道闸门只挡 `disabled`）
   * 要回答的是"这一行关不掉"——静默会让玩家以为自己按坏了，而谎称"已关掉"会把这一屏变成陷阱。
   */
  private unbindOneUi(intent: UiIntent): void {
    if (!this.ops) return
    this.standDown()
    this.swapNote = null
    if (!this.ops.unbindUi(intent)) { this.hooks.notify(`${intentLabel(intent)} 这一行关不掉 ⇒ 一格都没动`); return }
    this.hooks.notify(`${intentLabel(intent)} 在菜单里解绑（玩法与手柄都不受影响）`)
  }

  /**
   * 菜单那一行的「回默认」：整组回来由边界算，面板只把它的答案说成一句人话（与 `resetOneKey` 同一位）。
   * `via`（KI-345）决定回的是哪条通道：那一行在键盘上有四把、在手柄上有一把，两个家各有各的把手，
   * 一键抹两条会把玩家另一只手刚挪过的那一把也洗掉。
   */
  private resetOneUi(intent: UiIntent, via: 'key' | 'pad' = 'key'): void {
    if (!this.ops) return
    this.standDown()
    const hasHome = this.ops.resetUi(intent, via)
    this.swapNote = null
    const where = via === 'pad' ? '手柄' : '菜单'
    this.hooks.notify(hasHome
      ? `${intentLabel(intent)} 整组回到默认那几把`
      : `${intentLabel(intent)} 在${where}里没有默认键 ⇒ 这一行没动`)
  }

  /**
   * `data-arg` = `"<格名>:<-1|1>"`。面板只加一个**步进而不是夹取**：
   * 界在哪由 `GAMEPLAY_BOUNDS` 说（读它的主人，不抄第二份），越界怎么治由 `clampGameplaySettings` 说。
   * 到端点的按钮写成 `disabled`，而键盘/手柄那条路没人替玩家挡 `disabled`——所以 `run` 上面那道
   * 闸门（KI-061③ 立的）在这里正是干这件事的。
   *
   * 落格到三位小数是因为步长里有 0.1 与 0.05：连按十次 `1 − 0.1` 会得到 0.8999999999999999，
   * 那个数会被原样写进存档，而存档要的是**往返不漂移**（面板给的是界面粒度，不该顺手给出二进制粒度）。
   */
  private stepGameplay(arg: string): void {
    const spec = OPS_NUMERIC.find((n) => n.key === arg.split(':')[0])
    const dir = Number(arg.split(':')[1])
    if (!this.ops || !spec || !Number.isFinite(dir)) return
    const g = this.ops.gameplay()
    const next = Math.round((g[spec.key] + spec.step * Math.sign(dir)) * 1000) / 1000
    this.ops.setGameplay({ [spec.key]: next } as Partial<GameplaySettings>)
  }

  /**
   * 阈值那一格的 ◀ ▶（KI-345）：与 `stepGameplay` 同一条纪律——面板只给一个**步进量**，
   * 界由 `BIND_BOUNDS` 说、夹取由 `clampBindings` 说，所以这里连"夹一下"都不做（做了就是第二个治数的人）。
   * 落格到两位小数：步长是 0.05，连按十次 `0.9 − 0.05` 会拖出二进制尾巴，而存档要的是往返不漂移
   * （面板给的是界面粒度，不该顺手给出二进制粒度）。
   * 读的是**此刻生效**那一个数（`bindsSource.uiBinds`），不是面板自己记的上一次步进——
   * 别人（存档、调音桩以外的另一块面板）改了表，这一格下一次点就得从真值走，而不是从猜测走。
   */
  private stepStick(arg: string): void {
    const parts = arg.split(':')
    if (!this.ops || parts[0] !== OPS_STICK.key) return
    const dir = Number(parts[1])
    const cur = this.bindsSource?.uiBinds.stickThreshold
    if (!Number.isFinite(dir) || cur === undefined) return
    this.ops.setStickThreshold(Math.round((cur + OPS_STICK.step * Math.sign(dir)) * 100) / 100)
  }

  /**
   * 扳机那条线的 ◀ ▶（KI-364）：与上面那一格同一条纪律——面板只给一个步进量，界由 `BIND_BOUNDS` 说、
   * 夹取由 `clampBindings` 说，这里连"夹一下"都不做。落格到两位小数同一个理由：连按十次 0.05
   * 会拖出二进制尾巴，而存档要的是往返不漂移。读的也是**此刻生效**那一个数（`bindsSource.binds`）。
   */
  private stepTrigger(arg: string): void {
    const parts = arg.split(':')
    if (!this.ops || parts[0] !== OPS_TRIGGER.key) return
    const dir = Number(parts[1])
    const cur = this.bindsSource?.binds.triggerThreshold
    if (!Number.isFinite(dir) || cur === undefined) return
    this.ops.setTriggerThreshold(Math.round((cur + OPS_TRIGGER.step * Math.sign(dir)) * 100) / 100)
  }

  /**
   * 画质档位 ◀▶（F2 UI）：面板只负责循环四档，夹取由 `QualityStore.clampQuality` 统一做。
   * `data-arg` 是 `1`（下一档）或 `-1`（上一档），绕回边界。
   */
  private stepQuality(arg: string): void {
    if (!this.ops) return
    const dir = Number(arg)
    if (!Number.isFinite(dir)) return
    const cur = this.ops.quality()
    const next = ((cur + Math.sign(dir) + 4) % 4) as QualityTier
    this.ops.setQuality(next)
  }

  /**
   * 那一枚「存取哪一半」（KI-368）。**只换状态、不做事**：它不改任何一格键、不碰那三盒、也没有回声——
   * 一次「选择」同时把「存入」也做掉，就是 KI-361 反对的那一类（同一双手上的两件事被并成一次）。
   * 界外那一枚什么都不改：`data-arg` 是从 DOM 来的字符串，谁都能写，「界外通道」必须与「界外下标」同位
   * （`bindChannel`／`profileSlot` 在边界立的那条口径，在这一屏由这一格守）。
   */
  private setProfChan(arg: string): void {
    const next = PROF_CHANS.find((c) => c === arg)
    if (!next) return
    this.profChan = next
    this.render()
  }

  /** 使用中那一枚换成要递给边界的那一枚：`both` ⇒ `undefined`，不带那枚就逐字是 KI-362 那一次整张 */
  private profTarget(): BindChannel | undefined {
    return this.profChan === 'both' ? undefined : this.profChan
  }

  /**
   * 配置文件那三把里的头两把（KI-362）：面板只把 `data-arg` 换成一个下标，剩下的全是边界的事——
   * 「哪一盒有东西」由 `profileFlags()` 说，「这一存算新录还是覆盖」由 `storeProfile` 的返回值说，
   * 「空盒载入不了」由 `loadProfile` 那个 false 说。面板不另抄一份磁带名单、也不自己数第几次，
   * 否则「这一盒存过没有」就有了第二个主人（与 `unbound` 那份名单同一条纪律，§55）。
   * **拒绝那两格面板一句不说**：那一行的「空」与 `disabled` 已经把话说完，而 `run` 上面那道闸门
   * （KI-345 立的）连 Enter 都挡在门外——再补一句「是空的」，屏幕上没有一格会去读它。
   * 这一格不是想出来的口径，是覆盖率门量出来的：那两行当时是 `ui` 包 2207 行里唯一没读者的 2 行
   * （99.95%，而它自己的地板钉在 100%），于是「没有读者的分支」第一次有了名字。
   *
   * KI-368 起这两把各递一枚边界认得的通道（`profTarget()`）：分家在 KI-367 就落在数据里，这一批接的是那只手。
   * 回声跟着落点走——玩家按的是「只抄走键鼠那一半」，屏幕上就不能再说「已存入配置文件 1」（那一句说的是整张）。
   */
  private storeProfile(arg: string): void {
    const i = Number(arg)
    const answer = this.ops?.profiles.store(i, this.profTarget())
    if (answer === undefined || answer === null) return
    const half = PROF_CHAN[this.profChan].half
    this.hooks.notify(`${answer === 'new' ? `已存入配置文件 ${i + 1}` : `已覆盖配置文件 ${i + 1}`}${half ? ` · 只抄走${half}` : ''}`)
  }

  /** 载入是唯一会换掉运行时表的那一把：换完了上一行的键名跟着真值走，而那句过期的「刚交换」要收掉 */
  private loadProfile(arg: string): void {
    const i = Number(arg)
    if (!this.ops?.profiles.load(i, this.profTarget())) return
    this.swapNote = null
    const half = PROF_CHAN[this.profChan].half
    this.hooks.notify(`已载入配置文件 ${i + 1}${half ? ` · 只请回${half}` : ''}`)
  }

  /**
   * 「清空」这一把（KI-363）说的是 KI-362 那条欠账裁决过的第二半：在档上「清空了」与「没写过」是
   * 同一句话（三盒全空 ⇒ 存档那一格整个不写），在界面上不是——玩家按下去那一次要有回声，
   * 而初始那个空态没人按过，没有回声。回声对不对得起一次真做成了的事，由边界那个布尔回答。
   * 拒绝那一次一句不说，与上面两把同一条口径：那一行的「空」与两把 `disabled` 已经把话说完。
   * 清完**不**收 `swapNote`：这一把动的是磁带，玩家手里那张表一个字都没变（KI-362 ④ 的另一半）。
   * KI-368 那一枚「存取哪一半」**管不到这一把**：请回空的始终是那一整格，所以这句回声也不提那一半——
   * 提了就等于说出不存在的那一档（半盒就是一只满盒，「半满的盒」不是第四种存在感）。
   */
  private clearProfileRow(arg: string): void {
    const i = Number(arg)
    if (!this.ops?.profiles.clear(i)) return
    this.hooks.notify(`已清空配置文件 ${i + 1}`)
  }

  /**
   * 那一格「刚交换」说明的唯一写法（KI-348：两节同一个主人）。
   * 措辞跟着 `onto` 走——落进键盘那张说「这把键」，落进手柄那张说「这一把」；面板不许按
   * 「我等的是哪种传感器」猜，那是 `AwaitingRow` 的事（KI-345 立这一句时只有菜单那半兑现）。
   * 三种真话：那一格原本没人（不许编一位原主人）／有人被换出去**且它换了家**（才叫交换）／
   * 有人少了这一把但没搬家（`moved=false` 只说得出这个，说不说得出「它还有别的键」另说）。
   * `movedWord` 是唯一按节不同的一格：玩法那一行一把键，菜单那一行是一整组，
   * 「已交换」与「它整组搬了家」说的是同一件事，但后一句里的「整组」在玩法那张表上没有对应物。
   */
  private swapNoteText = <V,>(s: RowSwap<V>, name: (v: V) => string, movedWord: string): string =>
    s.displaced === null
      ? (s.onto === 'pad' ? '这一把原本没有别人' : '这把键原本是空着的')
      : `${s.onto === 'pad' ? '这一把' : '这把键'}原本归 ${name(s.displaced)} ⇒ `
        + (s.moved ? movedWord : '它少了这一把，没搬去别处')

  /**
   * 「操作」页：`docs/ui-ux.md` §5.1 那句「全动作逐行可改」的玩家入口，外加 KI-112 那五格玩法设置的第一次露面
   * （五格早就有真实消费者，缺的从来不是机制，是把手）。
   *
   * 三条口径写给下一个改这里的人：
   * ① 键名一律走 `keyOf` + `bindsSource.binds`（**此刻生效**那张表）。抄默认表就是
   *    `arch-boundaries` 那条闸门要抓的形状，而它抓的是 import，不是注释。
   * ② 面板不算交换、不算夹取、不算默认格——这三件事各有主人（`BindingsStore.rebind`、
   *    `clampGameplaySettings`、`defaultBindings()`），面板手里只有函数。
   * ③ 数值格用步进按钮（◀ ▶）而不是 `<input type="range">`：这一屏要 §7 那句「全路径手柄可达」，
   *    而拖拽在键盘与手柄上都是需要另外发明的第二条路；§3.8 那句「滑块实时预览」由 `.meter`
   *    那一槽承担（它是读数，不是控件）。
   * ④ 「无」那一格（KI-342）读的是 `binds.unbound`，写的是 `ops.unbind`——面板只负责把两半画出来，
   *    算两半的是边界与 store。这里不许出现"看起来没键就当成解绑"那种推断：没键有两种来历
   *    （玩家关的、与这张表里没人认领），HUD 那一列把两种都读成"不画这一行"，而这一屏必须分清。
   *    KI-346 起这两种来历各有写法：关掉的画「无」，没人认领的画「—」——一句"没键"不再有两种读法。
   * ⑤ 两条通道各一列、各一把「改键」与一把「解绑」把手（KI-343 立两列，KI-346 补齐第二把「解绑」）：
   *    一列画键盘那一把，一列画手柄上那几把（一键多用是默认表的设计，闪避在 0 与 12 上，所以那一列
   *    画的是一串而不是一个）。「等待中」只属于其中一条通道，页脚因此要说清等的是哪种传感器；
   *    撤的那一枚 Escape 也只撤这一条。**一行四个家 ⇒ 关掉的是其中一格**：两把「解绑」写的是两份名单
   *    （`unbound` 与 `padUnbound` 各管各的那张表），一把「解绑」绝不许顺路关另一列；同理两把「回默认」
   *    各退各的名单。登记在这里的旧口径（"手柄那张不回补，所以那一列没有「无」"）已经被 KI-346 推翻：
   *    会混是因为只有一份名单，名单改成每表一份之后「这一格我不要」与「这一格没人认领」第一次能分开写。
   * ⑥ 菜单那一节（KI-344）**单元是整组，不是一枚键**：`confirm` 默认挂在 Enter/Space/KeyE 上，
   *    点一次「改键」按下一枚键，得到的那一行就只剩这一把，被拿走的那一把若还有其余等价键则由
   *    边界回补（`moved` 说的就是这件事，两种结果面板都画得出，因为它自己不算）。「无」在这一节站得住，
   *    正因为这条通道有回补那一拍——没有回补的通道里，"没键"与"关掉了"是两回事（见 ⑤ 的末段）。
   *    「哪几行不许关」不写在这里：读的是 `UI_EXIT_INTENTS`，那句话「菜单必须走得出去」的主人只有一位，
   *    而 KI-346 起它管的是这条通道的**两张表**（出口那一行两把「解绑」都不画，`clampBindings` 把
   *    档里手写的 `ui.padUnbound: ['back']` 也丢掉）——那句话说的是"走得出"，不是"键盘那半走得出"。
   *    KI-345 给这一节补上**手柄那一列**：两列、两把「改键」、两把「回默认」，与玩法那一节同一个形状，
   *    KI-346 再补上第二把「解绑」⇒ 四把把手一节一行，两节同形。
   *    同一节里还多了一格数值（摇杆阈值）：它属于这条通道，所以跟着这一节画，不混进「手感」那一节
   *    ——一节两来源就会让"这一格改的是哪份档"有第二种说法。
   */
  private renderOps(): string {
    if (!this.ops) return '<div class="empty">这一页没有把手就没有内容——页签也就不会出现（见 tabsOf）。</div>'
    const binds = this.bindsSource?.binds
    const uiBinds = this.bindsSource?.uiBinds
    const waiting = this.awaiting
    /** 两节的行名今天会重名（菜单的「后退」与玩法的「后退」），所以"谁在等"要先问节、再问行 */
    const gameSwap = this.swapNote?.channel === 'gameplay' ? this.swapNote : null
    const keys = BINDABLE_ACTIONS.map((a) => {
      const shown = binds ? keyOf(a, binds) : null
      /** 玩家点名「无」的那几格（名单只有一个书写者：`clampBindings`，见 `Binds.unbound`） */
      const off = binds !== undefined && binds.unbound.includes(a)
      /** 手柄那一列上的「无」（KI-346）：问的是**另一份名单**，与上面那一格各管各的表 */
      const padOff = binds !== undefined && binds.padUnbound.includes(a)
      /** 「这一行关不关得掉」由名册回答（KI-389：`GAMEPLAY_EXIT_ACTIONS` 的三个读者之一就是这个界面），
       *  面板不自己数"哪些行看起来不能关"——与菜单那一节 `locked` 那一格同一条形状（KI-344） */
      const locked = GAMEPLAY_EXIT_ACTIONS.includes(a)
      /** 手柄那侧此刻的几把：问的是**同一张运行时表**，不另抄默认手柄表；下标升序，显示名只有一个主人 */
      const padIdx = binds ? Object.keys(binds.padButtons).map(Number).filter((i) => binds.padButtons[i] === a).sort((x, y) => x - y) : []
      const padShown = padIdx.map(padLabel).join('、')
      const armed = waiting !== null && waiting.channel === 'gameplay' && waiting.action === a ? waiting.via : null
      const justSwapped = gameSwap !== null && gameSwap.action === a ? gameSwap : null
      const note = armed ? (armed === 'pad' ? '按手柄上一枚键绑定 · Escape 取消' : '按键或点鼠标绑定 · Escape 取消')
        : justSwapped ? this.swapNoteText(justSwapped, actionLabel, '已交换')
          : off && padOff ? '两条都关掉了：这一行此刻键盘与手柄都不发'
            : off ? (padIdx.length
              ? `键盘这一格已关掉 · 手柄上还有 ${padIdx.length} 把`
              : '键盘这一格已关掉，而手柄那侧也没有这个动词')
            : padOff ? `手柄这一列已关掉 · 键盘上还有 ${shown}`
              : locked ? `「${actionLabel(a)}」不许关掉：世界必须停得下来`
                : binds === undefined ? '没接键位来源 ⇒ 这一列不给键名（键名只有运行时那一个主人）' : ''
      const arm = `<button class="act" data-act="arm" data-arg="${a}">${armed === 'key' ? '等待中' : '改键'}</button>`
      const armPad = `<button class="act" data-act="armpad" data-arg="${a}">${armed === 'pad' ? '等待中' : '手柄'}</button>`
      const cancel = `<button class="act" data-act="unarm">取消</button>`
      /**
       * 一行四个家 ⇒ 两把「无」各关一列（KI-346），关掉之后各自的出口也各回各的列：
       * 「回默认」只把自己那一列的名单退掉，另一列那句「不要」不许顺路收回（那是玩家另一只手说的话）。
       * 等键中这一支不画任何「无」：一边等一枚键、一边说这一列不要键，是矛盾的两格。
       */
      const acts = armed === null
        ? `${arm}${armPad}${off || locked
            ? `<button class="act" data-act="resetkey" data-arg="${a}">回默认</button>`
            : `<button class="act" data-act="unbind" data-arg="${a}">解绑</button>`}${locked ? ''
            : padOff
              ? `<button class="act" data-act="resetpad" data-arg="${a}">手柄回默认</button>`
              : `<button class="act" data-act="unbindpad" data-arg="${a}">手柄解绑</button>`}`
        : `${arm}${armPad}<button class="act" data-act="${armed === 'pad' ? 'resetpad' : 'resetkey'}" data-arg="${a}">${armed === 'pad' ? '手柄回默认' : '回默认'}</button>${cancel}`
      /**
       * 记号挂在**被写进的那一列**（`onto` 由边界给）而且**真搬家才挂**（`moved` 同一条裁决）——两节到这里
       * 用同一个条件（KI-348）。以前这一格按 `via`（我等的是哪种传感器）挂：等键盘、按下却是一枚手柄键
       * 那一次，记号挂到了根本没被写的那一列上，而菜单那一节早就按 `onto` 挂了——同一件事两个主人。
       * 搬进一把空着的格子时也不能挂：那一行同时说「原本没有别人」和「刚交换」就是自己跟自己矛盾。
       */
      const movedMark = justSwapped?.displaced && justSwapped.moved ? ' <span class="over">刚交换</span>' : ''
      return `<div class="row"><span class="name">${actionLabel(a)}<span class="note">${note}</span></span>
        <span class="num">${shown ?? (off ? '无' : '—')}${justSwapped?.onto === 'keyboard' ? movedMark : ''}${binds !== undefined && (off || shown === null) && !padIdx.length ? ' <span class="over">没有键</span>' : ''}</span>
        <span class="num">${padShown || (padOff ? '无' : '—')}${justSwapped?.onto === 'pad' ? movedMark : ''}</span>
        <span class="act">${acts}</span></div>`
    }).join('')
    const uiWait = waiting?.channel === 'ui' ? waiting.intent : null
    const uiWaitVia = waiting?.channel === 'ui' ? waiting.via : null
    const uiSwap = this.swapNote?.channel === 'ui' ? this.swapNote : null
    const menu = UI_INTENTS.map((i) => {
      /** 那一列画的是**整组**：一个意图在现表上占几把就画几把（只画第一把就是把"等价键"这个设计藏起来） */
      const codes = uiBinds ? Object.keys(uiBinds.keyboard).filter((c) => uiBinds.keyboard[c] === i).sort() : []
      /** 手柄那一列（KI-345）：问的是**同一张运行时表**，下标升序，显示名只有一个主人（`padLabel`） */
      const padIdx = uiBinds ? Object.keys(uiBinds.padButtons).map(Number).filter((n) => uiBinds.padButtons[n] === i).sort((x, y) => x - y) : []
      const padShown = padIdx.map(padLabel).join('、')
      /** 玩家点名「无」的那几格（名单只有一个书写者：`clampBindings`，见 `UiBinds.unbound`） */
      const off = uiBinds !== undefined && uiBinds.unbound.includes(i)
      /** 手柄那一列的「无」（KI-346）：另一份名单、另一张表，与上面那一格各管各的 */
      const padOff = uiBinds !== undefined && uiBinds.padUnbound.includes(i)
      /** 「这一行关不关得掉」由名册回答（`UI_EXIT_INTENTS` 的三个读者之一就是这个界面），面板不自己数"哪些行看起来不能关" */
      const locked = UI_EXIT_INTENTS.includes(i)
      const armed = uiWait === i ? uiWaitVia : null
      const justSwapped = uiSwap !== null && uiSwap.intent === i ? uiSwap : null
      const note = armed ? (armed === 'pad' ? '按手柄上一枚键绑定 · Escape 取消' : '按任意键绑定 · Escape 取消')
        : justSwapped ? this.swapNoteText(justSwapped, intentLabel, '它整组搬了家')
          : off && padOff ? '两条都关掉了：这一行此刻键盘与手柄都不发'
            : off ? (padIdx.length
              ? `键盘这一组已关掉 · 手柄上还有 ${padIdx.length} 把`
              : '键盘这一组已关掉，而手柄那侧也没有这个意图')
            : padOff ? `手柄这一组已关掉 · 键盘上还有 ${codes.length} 把`
              : locked ? `「${intentLabel(i)}」不许关掉：菜单必须走得出去` : ''
      const arm = `<button class="act" data-act="armui" data-arg="${i}">${armed === 'key' ? '等待中' : '改键'}</button>`
      const armPad = `<button class="act" data-act="armuipad" data-arg="${i}">${armed === 'pad' ? '等待中' : '手柄'}</button>`
      const reset = `<button class="act" data-act="resetui" data-arg="${i}">回默认</button>`
      const cancel = `<button class="act" data-act="unarm">取消</button>`
      /**
       * 等键中与「无」那几格露出「回默认」，而关不掉的那几格两把「解绑」都没有（KI-344 立键盘那一半，
       * KI-346 把它扩到两列：「菜单必须走得出去」说的是这条通道走得出，不是"键盘那半走得出"）。
       * 「回默认」回的是**正在等的那一条通道**（KI-345：一行有两个家，两把把手各回各的，绝不一键抹两条）；
       * 而关掉之后那一列的出口也各回各的列——另一列那句「不要」是玩家另一只手说的话，不许顺路收回。
       */
      const acts = armed === null
        ? `${arm}${armPad}${off || locked ? reset : `<button class="act" data-act="unbindui" data-arg="${i}">解绑</button>`}${locked ? ''
            : padOff ? `<button class="act" data-act="resetuipad" data-arg="${i}">手柄回默认</button>`
              : `<button class="act" data-act="unbinduipad" data-arg="${i}">手柄解绑</button>`}`
        : `${arm}${armPad}<button class="act" data-act="${armed === 'pad' ? 'resetuipad' : 'resetui'}" data-arg="${i}">${armed === 'pad' ? '手柄回默认' : '回默认'}</button>${cancel}`
      /** 记号挂在**被写进的那一列**上（`onto` 由边界给）：两列各有各的格子集合，混挂就是让另一列替这一列作证 */
      const movedMark = justSwapped?.displaced && justSwapped.moved ? ' <span class="over">整组搬家</span>' : ''
      return `<div class="row"><span class="name">${intentLabel(i)}<span class="note">${note}</span></span>
        <span class="num">${codes.map(codeLabel).join('、') || '无'}${justSwapped?.onto === 'keyboard' ? movedMark : ''}</span>
        <span class="num">${padShown || (padOff ? '无' : '—')}${justSwapped?.onto === 'pad' ? movedMark : ''}</span>
        <span class="act">${acts}</span></div>`
    }).join('')
    const g = this.ops.gameplay()
    const numbers = OPS_NUMERIC.map((n) => {
      const b = GAMEPLAY_BOUNDS[n.key]
      const v = g[n.key]
      const frac = Math.max(0, Math.min(1, (v - b.min) / (b.max - b.min)))
      return `<div class="row"><span class="name">${n.label}<span class="note">${n.note}</span></span>
        <span class="num">${n.fmt(v)}<span class="meter"><i style="width:${(frac * 100).toFixed(1)}%"></i></span></span>
        <span class="act"><button class="act" data-act="gstep" data-arg="${n.key}:-1" ${v <= b.min ? 'disabled' : ''}>◀</button>
          <button class="act" data-act="gstep" data-arg="${n.key}:1" ${v >= b.max ? 'disabled' : ''}>▶</button></span></div>`
    }).join('')
    /** 画质档位一行（F2 UI）：◀▶ 循环 0→3，读 `ops.quality()`，写 `ops.setQuality()`。 */
    const q = this.ops.quality()
    const qName = QUALITY_NAMES[q as QualityTier] ?? QUALITY_NAMES[DEFAULT_QUALITY]
    const qPrev = QUALITY_NAMES[(q - 1 + 4) % 4 as QualityTier]
    const qNext = QUALITY_NAMES[(q + 1) % 4 as QualityTier]
    const qualityRow = `<div class="row"><span class="name">${OPS_QUALITY.label}<span class="note">${OPS_QUALITY.note}</span></span>
      <span class="num">${qName} (${q})</span>
      <span class="act"><button class="act" data-act="qstep" data-arg="-1">◀ ${qPrev}</button>
        <button class="act" data-act="qstep" data-arg="1">${qNext} ▶</button></span></div>`
    /**
     * 摇杆阈值那一行（KI-345）：它属于**菜单那一条通道**（消费者是 `Input` 读 `liveUi.stickThreshold`
     * 那一拍），所以它跟着那一节画，不混进「手感与练习辅助」——那一节的四格各有各的 store，
     * 一节两来源就是让"这一格改的是哪份档"有第二个说法。界读 `BIND_BOUNDS`（那两个字的主人），
     * 数读**此刻生效**的那一份（`bindsSource.uiBinds`），面板既不抄默认也不夹取。
     */
    const thB = BIND_BOUNDS.stickThreshold
    const th = uiBinds ? uiBinds.stickThreshold : null
    const stickFrac = th === null ? 0 : Math.max(0, Math.min(1, (th - thB.min) / (thB.max - thB.min)))
    const stick = `<div class="row"><span class="name">${OPS_STICK.label}<span class="note">${OPS_STICK.note}</span></span>
        <span class="num">${th === null ? '没接键位来源 ⇒ 这一格不给读数，也不给把手（读数只有运行时那一个主人）' : `${Math.round(th * 100)}%`}<span class="meter"><i style="width:${(stickFrac * 100).toFixed(1)}%"></i></span></span>
        <span class="act"><button class="act" data-act="ustep" data-arg="${OPS_STICK.key}:-1" ${th === null || th <= thB.min ? 'disabled' : ''}>◀</button>
          <button class="act" data-act="ustep" data-arg="${OPS_STICK.key}:1" ${th === null || th >= thB.max ? 'disabled' : ''}>▶</button></span></div>`
    /**
     * 扳机那条线那一行（KI-364）：它属于**玩法那一条通道**（`gameplay` 那张表上唯一的数值格，
     * 消费者是 `Input.padOn` 那一个判据），所以它跟着那一节画，不混进「手感与练习辅助」——
     * 那一节的五格各有各的 store，一节两来源就是让"这一格改的是哪份档"有第二个说法。
     * 界读 `BIND_BOUNDS`，数读**此刻生效**那一份（`bindsSource.binds`），面板既不抄默认也不夹取。
     */
    const tgB = BIND_BOUNDS.triggerThreshold
    const tg = binds ? binds.triggerThreshold : null
    const trigFrac = tg === null ? 0 : Math.max(0, Math.min(1, (tg - tgB.min) / (tgB.max - tgB.min)))
    const trigger = `<div class="row"><span class="name">${OPS_TRIGGER.label}<span class="note">${OPS_TRIGGER.note}</span></span>
        <span class="num">${tg === null ? '没接键位来源 ⇒ 这一格不给读数，也不给把手（读数只有运行时那一个主人）' : `${Math.round(tg * 100)}%`}<span class="meter"><i style="width:${(trigFrac * 100).toFixed(1)}%"></i></span></span>
        <span class="act"><button class="act" data-act="tstep" data-arg="${OPS_TRIGGER.key}:-1" ${tg === null || tg <= tgB.min ? 'disabled' : ''}>◀</button>
          <button class="act" data-act="tstep" data-arg="${OPS_TRIGGER.key}:1" ${tg === null || tg >= tgB.max ? 'disabled' : ''}>▶</button></span></div>`
    /**
     * 配置文件那三行（KI-362，KI-363 加第三把）：这一节画的不是「此刻用的那张表」，而是**那三盒**——
     * 所以它的读数只有一个来源 `ops.profiles.list()`（边界的 `profileFlags()`），面板自己不留任何磁带状态。
     * 格数也不在这里写死：三行是 `PROFILE_SLOTS` 那一位主人给的，多一格少一格都是抄写漂移。
     * 三个把手各做一件事：「存入」把此刻那张抄进盒里、**不换键**；只有「载入」才把盒里那张请回运行时；
     * 「清空」把那一盒请回空态、同样**不换键**（它既不是「回默认」，也不把手里那张倒回去）。
     * 空盒的「载入」与「清空」一起写 `disabled`——「没有东西可载入」与「没有东西可清空」读的是同一个布尔，
     * 而键盘那条路没人替玩家挡（§218）；「存入」永远点得动，它抄的是此刻那张，没有空不空这一说。
     *
     * KI-368 在那三行之前多一行「存取哪一半」：它画的不是磁带而是**下一次按下去的落点**，读数只有一个来源
     * `this.profChan`（面板那一时状态的主人），`.num` 与那一枚 `sel` 读的是同一个字段——两枚各说各的就是两个主人。
     * 那三行的注语因此从「抄走此刻那一张」改成「按使用中那一枚抄」：默认那一枚之下两句话等价，
     * 而停在「只键鼠」时旧句子说的不是屏上会发生的事。
     */
    const chanRow = `<div class="row"><span class="name">存取哪一半<span class="note">这一枚只管「存入」与「载入」两把：使用中哪一枚，按下去就动整张还是那半张（默认「两半一起」，逐字仍是 KI-362 那一次）。「清空」不受它管——请回空的始终是那一整盒，而半盒就是一只满盒。</span></span>
        <span class="num">${PROF_CHAN[this.profChan].label}</span>
        <span class="act">${PROF_CHANS.map((c) => `<button class="act${c === this.profChan ? ' sel' : ''}" data-act="profchan" data-arg="${c}">${PROF_CHAN[c].label}</button>`).join('')}</span></div>`
    const tapes = this.ops.profiles.list()
    const profiles = tapes.map((filled, i) => {
      const note = filled
        ? '这一盒里始终是一张完整的表 · 「载入」按上面那一枚「存取哪一半」请回（整张或那半张），再按「存入」就是覆盖它，按「清空」就把它请回空（手里那张不动）'
        : '还没有录过 · 「存入」按上面那一枚抄此刻那张（不改任何键），空盒的「载入」与「清空」一起点不动'
      return `<div class="row"><span class="name">配置文件 ${i + 1}<span class="note">${note}</span></span>
        <span class="num">${filled ? '已存' : '空'}</span>
        <span class="act"><button class="act" data-act="profload" data-arg="${i}" ${filled ? '' : 'disabled'}>载入</button>
          <button class="act" data-act="profstore" data-arg="${i}">存入</button>
          <button class="act" data-act="profclear" data-arg="${i}" ${filled ? '' : 'disabled'}>清空</button></span></div>`
    }).join('')
    return `<h2>${OPS_SECTIONS.gameplay}（每行两列：键盘那一把 · 手柄那几把。逐行可改，两条通道各一把「改键」与一把「解绑」把手）</h2>${keys}${trigger}
      <div class="row"><span class="name">整张回默认<span class="note">每行那两格「解绑」写的是名单（键盘与手柄各一份，玩法与菜单各一对，共四份），删存档里的一格写的只是"这一行我没动过"⇒ 回默认。两件事各有各的写法，不靠同一个空缺冒充。</span></span>
        <span class="act"><button class="act" data-act="resetall">全部回默认</button></span></div>
      <h2>${OPS_SECTIONS.ui}（单元是整组：一行画的是它此刻握着的每一把等价键，改这一行就是只留你按下的那一把。两列、两条通道各一把「改键」与一把「解绑」；关不掉的那一行两把「解绑」都不画）</h2>${menu}${stick}
      <h2>手感与练习辅助</h2>${numbers}${qualityRow}
      <div class="row"><span class="name">行覆盖率地板<span class="note">\`npm run coverage -- --bless\` 生成的总地板（KI-407），只读不做判断。面板不修改，只展示。</span></span>
        <span class="num">${(this.ops?.coverage?.() ?? 0).toFixed(2)}%</span>
        <span class="act"><span class="num">地板</span></span></div>
      <div class="row"><span class="name">帧辅助<span class="note">输入缓冲在 ${Math.round(g.bufferMs)}ms 之外再多保一帧（+1 tick，与逻辑 tick 同一把尺）</span></span>
        <span class="num">${g.frameAssist ? '开' : '关'}</span>
        <span class="act"><button class="act" data-act="gtoggle" data-arg="frameAssist">${g.frameAssist ? '关掉' : '打开'}</button></span></div>
      <div class="row"><span class="name">连打涨价<span class="note">§6 那一格 · 开着：同一式每用一次过载价涨一档（§7.2 休止斩／终止那两行，涨幅住在表里）。关掉：不再涨，而先前涨的那一截从翻到「关」的那一下起也不再收——重新打开从底价重新起算</span></span>
        <span class="num">${g.mashGuard ? '开' : '关'}</span>
        <span class="act"><button class="act" data-act="gtoggle" data-arg="mashGuard">${g.mashGuard ? '关掉' : '打开'}</button></span></div>
      <h2>配置文件（每行三把：「存入」按上面那一枚抄、不改任何键 · 「载入」才把盒里那一张请回运行时 · 「清空」只把那盒请回空，手里那张照样不动）</h2>${chanRow}${profiles}
      <div class="row"><span class="name">口径<span class="note">改完立刻生效并跟着存档走（v14 的 settings.bindings／settings.gameplay 两格，四份「无」的名单住在 settings.bindings.{gameplay,ui}.{unbound,padUnbound}，扳机那条线住在 settings.bindings.gameplay.triggerThreshold——加格不推版本，老档没这一格就是默认 50%；配置文件那三盒住在 settings.bindingsProfiles，一盒装的是按下「存入」那一刻的整张键位表：键盘与手柄两半、玩法那两份「无」的名单，连扳机与摇杆那两条线一起。而这一节上面那八格数值（缓冲、抖动、两把振动、受击、帧辅助、长按、连打）住在 settings.gameplay，跟着档走、不跟着盒走——切一盒不会把它们一起切走。一盒没写过、或三盒全清空 ⇒ 这一格整个不写，「清空过」没有第二种写法）；键鼠与手柄那两条通道：数据那一侧从 KI-367 起能各自存、各自取（那两把把手的第二枚参数只认 kb／pad 两枚），而屏上那一枚「存取哪一半」从 KI-368 起把它接到了把手上——使用中那一枚决定「存入」与「载入」按下去动的是整张还是那半张（默认「两半一起」，逐字仍是 KI-362 那一次）；「清空」不受它管，请回空的始终是那一整盒。而这一格从档里读回来时若只写了一条通道（手改的、或别人写的档），缺的那半读成默认那一份——不是这份档此刻在用的那一张，按下「载入」就把玩家手里那一半换掉了；挡得住这一刀的只有上面那两枚（这是 KI-369 从世界那侧量到的形状）。按档独立的配置文件还没接，登记在下面那一行的「还欠」。</span></span></div>`
  }

  private pendingText(act: 'write' | 'erase', slot: string, state: SlotCard['state']): string {
    const label = slotLabel(slot)
    if (act === 'erase') return `删除 ${label} —— 这一格${state === 'empty' ? '本来是空的' : '的存档（含备份位）'}会被清掉。`
    return `写入 ${label} —— ${state === 'empty' ? '这一格现在是空的' : '这一格已有的存档会被当前局面覆盖'}。`
  }
}
