/** `scripts/perf-budget-rules.mjs` 的声明：perf-probe 预算对账。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。
 */

/** 一个探头读数对照预算，返回条目（空 = 在预算内）。 */
export function budgetFindings(
  reading: ({ p95Ms?: number; meanMs?: number; maxMs?: number; over2ms?: number } & Record<string, unknown>) | undefined,
  budgetP95: number | undefined,
): string[]

/** 从 argv 读出 --budget=<ms> 与 --report=<path>。 */
export function parseBudgetArgs(argv: readonly string[]): { budgetP95?: number; reportPath?: string }
