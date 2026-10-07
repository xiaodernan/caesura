/**
 * §6 Cinematics 清单（需求 §31）的**预算判据**。
 *
 * 为什么单独一份 .mjs：判据要能被**喂合成夹具**（单元测试），也要能被校验器读**同一份**实现——
 * 与 `weather-rules.mjs` / `ledger-rules.mjs` 同一个理由（`validate-data.mjs` 一被 import 就去校验真表，
 * 判据留在里面就没人 import 得动）。**两份实现 = 第二个主人，必漂。**
 *
 * 判据是 §6 自己写的两条硬约束，不是这里编的：
 *   ① **单条 ≤ 25s**（§6「原则」那句）；
 *   ② **总时长 ≤ 180s**（§6 预算：垂直切片总游玩 60 分钟 × 5%）。
 * 另加两条"数据自洽"的常识：id 唯一、`durationMs` 是正数。
 *
 * ⚠️ 今天这张表**还没有数据**（`cinematic` 字段在 `schema.ts` 里声明了、`src/data/json/` 里没人用），
 * 所以本模块的判据先在合成夹具上跑；`cinematics.json` 落地后**同一个判据直接吃真表**，
 * 不需要改这里一个字。
 */

/** §6 的预算：单条上限（毫秒） */
export const CINE_MAX_ONE_MS = 25_000
/** §6 的预算：全清单上限（毫秒） */
export const CINE_MAX_TOTAL_MS = 180_000
/** 清单里每条必须交代的字段（与将来 `cinematics.json` 的行形状一致） */
export const CINE_FIELDS = ['id', 'kind', 'durationMs']

const isStr = (v) => typeof v === 'string' && v.length > 0
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * 检查一张过场清单是否守住 §6 的两条硬约束。
 * @param {ReadonlyArray<{id?: unknown, kind?: unknown, durationMs?: unknown}>} rows
 * @returns {Array<{where: string, why: string}>} 空数组 = 守住了
 */
export function cinematicBudgetErrors(rows) {
  /** @type {Array<{where: string, why: string}>} */
  const out = []
  if (!Array.isArray(rows)) return [{ where: 'cinematics', why: '清单不是数组（这道门在空转）' }]

  const seen = new Set()
  let total = 0
  let counted = 0
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {}
    const where = isStr(r.id) ? r.id : `cinematics[${i}]`
    for (const f of CINE_FIELDS) {
      if (r[f] === undefined || r[f] === null) out.push({ where, why: `缺字段 ${f}` })
    }
    if (isStr(r.id)) {
      if (seen.has(r.id)) out.push({ where, why: `id 重复（${r.id}）` })
      seen.add(r.id)
    }
    if (r.durationMs === undefined) continue
    if (!isNum(r.durationMs)) {
      out.push({ where, why: 'durationMs 必须是有限数' })
      continue
    }
    if (r.durationMs <= 0) out.push({ where, why: 'durationMs 必须为正' })
    total += r.durationMs
    counted++
    if (r.durationMs > CINE_MAX_ONE_MS) {
      out.push({
        where,
        why: `单条 ${r.durationMs}ms 超过 §6 的 ${CINE_MAX_ONE_MS}ms 上限`,
      })
    }
  }
  if (counted > 0 && total > CINE_MAX_TOTAL_MS) {
    out.push({
      where: 'cinematics',
      why: `全清单 ${total}ms 超过 §6 的 ${CINE_MAX_TOTAL_MS}ms 预算（余量 = ${CINE_MAX_TOTAL_MS - total}ms）`,
    })
  }
  return out
}

/** 全清单总时长（给"余量还有多少"这种读数用） */
export function cinematicTotalMs(rows) {
  let total = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    if (isNum(r?.durationMs) && r.durationMs > 0) total += r.durationMs
  }
  return total
}
