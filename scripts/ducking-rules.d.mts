/**
 * `ducking-rules.mjs` 的声明：判据住在 .mjs 里（校验脚本要能被 node 直接跑），测试要能被
 * `tsc --noEmit` 检查 ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `burst-rules.d.mts` 同一个理由）。
 */

/** 校验器报告里那一行的形状：`level` 决定它进 ERROR 还是 WARN 计数 */
export interface DuckFinding {
  level: 'error' | 'warn'
  file: string
  where: string
  msg: string
}

/** `schema.ts > DuckRow` 的字段；词表对账（`VOCAB_PAIRS`）读的就是这一张 */
export const DUCK_FIELDS: string[]
/** 每行必带的字段（attackSec/releaseSec 只给休止那一行，可缺省走 DUCK_TC_SEC） */
export const DUCK_REQUIRED_FIELDS: string[]
/** dB 的下界：越过它就不是"压低"而是静音（静音的主人是 battle.json 的 noMusic） */
export const DUCK_DB_FLOOR: number
/** 一次侧链最长的时长（秒）：取自 §8.2 表里最长那一行 */
export const DUCK_HOLD_MAX_SEC: number

/**
 * 一表侧链行 → findings。
 * @param handled 引擎真接的侧链触发口（由调用方从 `AudioEngine.ts` 源码现推；读不到传 null）
 * @param buses 合法总线名（由调用方从 `ducking.ts` 的 `DuckBusName` 现推；读不到传 null）
 */
export function duckFindings(
  file: string,
  rows: unknown,
  handled: string[] | null,
  buses: string[] | null,
): DuckFinding[]
