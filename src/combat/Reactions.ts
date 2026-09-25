import { msToTicks } from '@/core/Time'
import { registry } from '@/core/Registry'
import type { HitReactionTable } from '@/data/schema'
import type { EntityStats } from './EntityStats'

/**
 * §8 受击反应的运行时（KI-050 起表，KI-052① 把分级接到敌人身上）。与 `combat/Statuses.ts` 同一口径：
 * 数值住在 `data/json/reactions.json`，这里只接线，代码里不写第二份常数。
 * 表里的每一行都必须有承载体：R0（材质发光）/ R1–R3（硬直 + 位移）/ R4（破势）。
 * R5 浮空不写——本作敌人不会离地，那是一行没有腿的承诺。
 */

export function reactionConfig(): HitReactionTable {
  return registry.get<HitReactionTable>('reactions')
}

/** §8 R1–R3 三档换算出的硬直格数与位移米数（受击方是玩家还是敌人都读同一本账） */
export function reactionTier(tier: 'R1' | 'R2' | 'R3'): { stunTicks: number; displaceM: number } {
  const row = reactionConfig()[tier]
  return { stunTicks: msToTicks(row.stunMs), displaceM: row.displaceM }
}

/** R0 那一格的材质发光时长（秒）——`Enemy.onDamaged` 读它，代码里不留第二个 0.15 */
export function materialFlashSeconds(): number {
  return reactionConfig().R0.flashMs / 1000
}

/**
 * R4 破势时长：谁造出 stats 谁负责上弦（`armStats` 同款口径，调用点＝Enemy 与
 * PlayerController 的构造函数，各一处）。没上弦 `addPoise` 会直接抛——
 * 那是接线错误，不是"这具实体免疫破势"。
 */
export function armCrumple(stats: EntityStats, isBoss: boolean): void {
  const r = reactionConfig().R4
  stats.crumpleTicks = msToTicks(isBoss ? r.bossCrumpleMs : r.crumpleMs)
}
