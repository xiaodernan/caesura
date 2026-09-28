/** `burst-rules.mjs` 的声明：判据住在 .mjs 里（校验脚本要能被 node 直接跑），测试要能被 `tsc --noEmit`
 *  检查 ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `lockon-rules.d.mts` / `battle-rules.d.mts` 同一个理由）。 */

/** 校验器报告里那一行的形状：`level` 决定它进 ERROR 还是 WARN 计数 */
export interface BurstFinding {
  level: 'error' | 'warn'
  /** findings 挂在哪张表上：由调用方（校验器）传进来，判据自己不认识文件名 */
  file: string
  where: string
  msg: string
}

/** `schema.ts > ProjectileBurst` 的字段；词表对账（`VOCAB_PAIRS`）读的正是这一张 */
export const BURST_FIELDS: string[]
/** `schema.ts > BurstFeint` 的字段 */
export const FEINT_FIELDS: string[]
/** 逻辑 tick 频率（Hz）：主人是 `src/core/Time.ts > TICK_HZ`，一致性由 `burst-table.test.ts` 对账 */
export const TICK_HZ: number

/** 一处连发 → findings。入参原样传入（这里只读不改），非对象也有说法而不抛 */
export function burstFindings(file: string, where: string, burst: unknown): BurstFinding[]
