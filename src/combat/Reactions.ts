import { msToTicks } from '@/core/Time'
import { registry } from '@/core/Registry'
import type { HitReactionTable } from '@/data/schema'
import type { EntityStats } from './EntityStats'

/**
 * §8 受击反应的运行时（KI-050）。与 `combat/Statuses.ts` 同一口径：
 * 数值住在 `data/json/reactions.json`，这里只接线，代码里不写第二份常数。
 * 表里刻意只有两行——R1（玩家受击那一行）与 R4（破势时长）。其余等级
 * 在这份 build 里没有承载体（敌人侧由架势/读条打断承担），写进表就是造没有消费方的数据。
 */

export function reactionConfig(): HitReactionTable {
  return registry.get<HitReactionTable>('reactions')
}

/** 玩家受击那一行（§8 玩家侧：一律 R1 等效）换算出的硬直格数 */
export function playerHurtStunTicks(): number {
  return msToTicks(reactionConfig().R1.stunMs)
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
