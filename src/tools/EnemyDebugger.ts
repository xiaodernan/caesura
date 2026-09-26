import type { Enemy } from '@/ai/Enemy'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * F1 · 敌人面板（需求 §54 那一格，§56 目录表里规划的就是这个文件名）。
 *
 * 规划写的是「当前状态/目标/aggro/距离/下一步动作（每敌人浮标签 + 面板列表）」。
 * **面板列表这一半在这里；浮标签那一半不在**——世界坐标投影到屏幕要读相机与场景，那是表现层
 * 另一条通道，本批不为了凑齐一行规划文本去发明它（欠账登记在 KI-058）。
 *
 * 「下一步动作」这句也要按本作的事实读：这只生物的选招是**距离带 + 冷却 + 拍位插槽**三件事的
 * 交集，不是一棵行为树，所以这里给的是输入读数（距离/警戒/当前一式与它的判定窗），而不是画一棵
 * 假的树。"为什么是这一招"由 F4 那块面板负责。
 */
export interface EnemyRow {
  id: string
  kind: string
  state: string
  hp: number
  hpMax: number
  /** 已累积的架势伤害（余量 = poiseMax - poise，面板上两个都给：破势判据读的是累积那一格） */
  poise: number
  poiseMax: number
  alertness: number
  dist: number
  attack: string | null
  /** `当前帧 / 前摇-窗起-窗止-收势`，全 tick；没有出手就是空串 */
  frame: string
  held: string
  tags: string
}

/** 三条"时间被拿走"的账语义各不同（§8 硬直 / KI-017② 命中停顿 / §7.2 时停 / §15.3 聋乱），所以分开写 */
function heldText(e: Enemy): string {
  const parts: string[] = []
  if (e.stunTicks > 0) parts.push(`stun ${e.stunTicks}`)
  if (e.stunStopTicks > 0) parts.push(`stop ${e.stunStopTicks}`)
  if (e.frozenTicks > 0) parts.push(`frozen ${e.frozenTicks}`)
  if (e.deafTicks > 0) parts.push(`deaf ${e.deafTicks}`)
  return parts.join(' ')
}

function tagsText(e: Enemy): string {
  return [
    e.isBoss ? `P${e.bossPhase + 1}` : '',
    e.shellUp ? 'shell' : '',
    e.intangible ? 'phase' : '',
    e.armorBroken ? 'armor-break' : '',
    e.stats.crumpleTicksLeft > 0 ? 'crumple' : '',
    e.stats.fissureLayers > 0 ? `fis${e.stats.fissureLayers}` : '',
    e.buff ? `tune x${e.buff.dmgMul}` : '',
  ].filter(Boolean).join(' ')
}

export function enemyRows(enemies: readonly Enemy[], player: Vec3): EnemyRow[] {
  return enemies.map((e) => {
    const a = e.attack
    const f = a?.spec.frames
    return {
      id: e.id,
      kind: e.data.archetype,
      state: e.state,
      hp: e.stats.hp,
      hpMax: e.stats.hpMax,
      poise: e.stats.poiseAccum,
      poiseMax: e.stats.poiseMax,
      alertness: e.alertness,
      dist: Math.hypot(e.pos.x - player.x, e.pos.z - player.z),
      attack: a ? a.spec.id : null,
      frame: a && f ? `${a.tick}/${f.startup}-${f.activeStart}-${f.activeEnd}/${f.recovery}` : '',
      held: heldText(e),
      tags: tagsText(e),
    }
  })
}

const pad = (v: number, w: number, d = 0): string => v.toFixed(d).padStart(w)

function line(r: EnemyRow): string {
  return [
    r.id.padEnd(9), r.kind.padEnd(9), r.state.padEnd(10),
    `hp ${pad(r.hp, 4)}/${pad(r.hpMax, 4)}`,
    `poi ${pad(r.poise, 4)}/${pad(r.poiseMax, 4)}`,
    `al ${pad(r.alertness, 3)}`,
    `d ${pad(r.dist, 6, 2)}`,
    (r.attack ? `${r.attack} f${r.frame}` : '—').padEnd(30),
    r.held, r.tags,
  ].filter(Boolean).join(' ')
}

/** 组合根只调这一个：给它场上的敌人清单与玩家位置。 */
export function enemyPanelText(enemies: readonly Enemy[], player: Vec3): string {
  const rows = enemyRows(enemies, player)
  if (!rows.length) return 'no enemies on the field'
  const byState = new Map<string, number>()
  for (const r of rows) byState.set(r.state, (byState.get(r.state) ?? 0) + 1)
  const summary = [...byState.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([s, c]) => `${s} ${c}`).join(' · ')
  return [
    `live ${rows.length} · ${summary}`,
    'id        kind      state      hp              poise          alrt  dist   attack / frame(tick)              holds',
    ...rows.map(line),
  ].join('\n')
}
