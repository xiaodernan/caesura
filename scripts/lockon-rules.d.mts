/** `lockon-rules.mjs` 的声明：判据住在 .mjs 里（校验脚本要能被 node 直接跑），测试要能被 `tsc --noEmit`
 *  检查 ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `battle-rules.d.mts` 同一个理由）。 */

/** 校验器报告里那一行的形状：`level` 决定它进 ERROR 还是 WARN 计数 */
export interface LockOnFinding {
  level: 'error' | 'warn'
  /** 挂在哪张表上：这一块住在 `player.json`，所以恒为该值 */
  file: string
  where: string
  msg: string
}

/** `schema.ts > LockOnConfig` 的字段；词表对账（`VOCAB_PAIRS`）读的正是这一张 */
export const LOCKON_FIELDS: string[]
/** 90° 的弧度（角度项那一侧的参照格） */
export const RIGHT_ANGLE_RAD: number

/** `player.json > lockOn` → findings。入参原样传入（这里只读不改），非对象也有说法而不抛 */
export function lockOnFindings(cfg: unknown): LockOnFinding[]
