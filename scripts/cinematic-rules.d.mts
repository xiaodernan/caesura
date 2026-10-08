/** `scripts/cinematic-rules.mjs` 的类型声明（`tsc --noEmit` 需要它，否则测试 import 会报 TS7016）。 */

export interface CinematicRow {
  id?: unknown
  kind?: unknown
  durationMs?: unknown
  lockInput?: unknown
}

export interface CinematicIssue {
  where: string
  why: string
}

/** §6 的预算：单条上限（毫秒） */
export const CINE_MAX_ONE_MS: number
/** §6 的预算：全清单上限（毫秒） */
export const CINE_MAX_TOTAL_MS: number
/** 清单里每条必须交代的字段 */
export const CINE_FIELDS: readonly string[]

/** 空数组 = 守住了 §6 的两条硬约束 */
export function cinematicBudgetErrors(rows: readonly CinematicRow[]): CinematicIssue[]
/** 全清单总时长（毫秒） */
export function cinematicTotalMs(rows: readonly CinematicRow[]): number
