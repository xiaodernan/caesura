/** `test-scope.mjs` 的声明：判据住在 .mjs 里（跑测脚本要能被 node 直接跑），测试要能被
 *  `tsc --noEmit` 检查 ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `report-reds.d.mts` 同一理由）。 */

export interface Scope {
  /** 这一趟该跑到的测试文件（已折成正斜杠）；`unmatched` 非空时它是空的 */
  expected: string[]
  /** 一个文件都没圈到的筛选器——调用方必须在开跑之前为它停下来 */
  unmatched: string[]
  /** 这一趟到底带没带范围（决定印出来那句话该不该说"全部"） */
  scoped: boolean
}

export const VALUE_OPTS: Set<string>

/** 位置参数（= 筛选器）：不吃掉 `-t <名字模式>` 那一类选项的值 */
export function positionalFilters(argv: readonly string[] | undefined): string[]

export function matchesFilter(file: string, filter: string, root: string): boolean

export function scopeOf(files: readonly string[], filters: readonly string[], root: string): Scope

export function describeScope(filters: readonly string[], expectedCount: number, diskCount: number): string
