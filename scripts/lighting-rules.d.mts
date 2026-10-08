/** `scripts/lighting-rules.mjs` 的类型声明（`tsc --noEmit` 需要它，否则测试 import 会报 TS7016）。 */

export interface LightingFindingRow {
  id?: unknown
  base?: unknown
  sec?: unknown
  accent?: unknown
  emit?: unknown
  sky?: unknown
  dark?: unknown
  grade?: { saturateMul?: unknown; contrastMul?: unknown } | unknown
  note?: unknown
  [k: string]: unknown
}

export interface LightingIssue {
  level: 'error' | 'warn'
  file: string
  where: string
  msg: string
}

/** `schema.ts > LightingRow` 的字段（词表对账读的就是这张名单） */
export const LIGHTING_FIELDS: readonly string[]
/** §2 那六色的字段名（`sky` 单列：文档在三行里明写"无天光"，它是可省的） */
export const LIGHTING_COLOR_FIELDS: readonly string[]
/** LUT 乘数的合法区间 */
export const GRADE_MUL_RANGE: { min: number; max: number }

/** 空数组 = 链是通的（六色合法、乘数有界、两侧引用都交代得清） */
export function lightingFindings(
  file: string,
  rows: readonly LightingFindingRow[] | unknown,
  referenced: readonly string[] | unknown,
): LightingIssue[]
