/**
 * scripts/perf-budget-rules.mjs —— perf-probe 预算对账（纯函数，可合成输入喂）。
 *
 * KI-454 的附律：把 Phase 9 的 perf-probe（`tests/flow/perf-probe.test.ts`）从"只记不裁"
 * 变成一扇真门——`measure-probe.mjs` 把探头读数交来，这里只回答"超预算没有"。
 * 读数里缺 p95Ms 时返回一条"读不出"——量不出就不裁判（§5.7：不猜性能）。
 *
 * 输入 reading 是探头那一行的 JSON：{ probe, camp, enemies, ticks, simulatingMs, meanMs, p50Ms, p95Ms, p99Ms, maxMs, over2ms, over2msPct }
 * 输入 budgetP95 是预算上限（ms），undefined = 不裁判。
 *
 * 输出 字符串数组（空数组 = 在预算内）。
 */

/** 一个探头读数对照预算，返回条目（空 = 在预算内） */
export function budgetFindings(reading, budgetP95) {
  const out = []
  if (budgetP95 === undefined) return out // 不裁判
  if (!Number.isFinite(reading?.p95Ms)) {
    out.push('读数里没有 p95Ms——量不出就不裁判（读不出，不要说 0）')
    return out
  }
  if (reading.p95Ms > budgetP95) {
    out.push(`p95=${reading.p95Ms} 超预算 ${budgetP95}（meanMs=${reading.meanMs} maxMs=${reading.maxMs} over2ms=${reading.over2ms}）`)
  }
  return out
}

/**
 * 从 argv 读出 --budget=<ms> 与 --report=<path>。
 * 返回 { budgetP95?: number, reportPath?: string } — 缺省时字段未定义，旧行为逐字节保持。
 * 任何重复 flag 或未知参数 ⇒ 抛异常（fail-closed；调用方决定 exit 2）。
 */
export function parseBudgetArgs(argv) {
  const out = {}
  for (const a of argv) {
    if (a.startsWith('--budget=')) {
      if (out.budgetP95 !== undefined) {
        throw new Error(`--budget 只允许给一次，拿到了第二个：${JSON.stringify(a)}`)
      }
      const v = Number(a.slice('--budget='.length))
      if (!Number.isFinite(v) || v <= 0) {
        throw new Error(`--budget=<ms> 必须是正数，拿到了：${JSON.stringify(a)}`)
      }
      out.budgetP95 = v
    } else if (a.startsWith('--report=')) {
      if (out.reportPath !== undefined) {
        throw new Error(`--report 只允许给一次，拿到了第二个：${JSON.stringify(a)}`)
      }
      out.reportPath = a.slice('--report='.length)
    } else {
      throw new Error(`不认识的参数：${JSON.stringify(a)}；只认 --budget=<ms> 与 --report=<path>`)
    }
  }
  return out
}
