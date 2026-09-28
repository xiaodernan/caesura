/** `explore-rules.mjs` 的声明：判据住在 .mjs 里（校验脚本要能被 node 直接跑），测试要能被 `tsc --noEmit`
 *  检查 ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `ledger-rules.d.mts` 同一个理由）。 */

/** 校验器报告里那一行的形状：`level` 决定它进 ERROR 还是 WARN 计数 */
export interface ExploreFinding {
  level: 'error' | 'warn'
  /** 挂在哪张表上：`explore.json` 或 `regions.json`（引用类判据说的是 region 指错了东西） */
  file: string
  where: string
  msg: string
}

export const EXPLORE_TONAL_FIELDS: string[]
export const EXPLORE_ATONAL_FIELDS: string[]
/** 由上面两支现拼（第三份手抄名单 = 第三个主人）；拼法本身由 `tests/unit/explore-table.test.ts` 钉住 */
export const EXPLORE_FIELDS: string[]
export const EXPLORE_FORMS: Set<string>
export const EXPLORE_WAVES: Set<string>
/** 一个音占几拍：1 = 原样、2 = 扩张、0.5 = 压缩 */
export const BEATS_PER_NOTE: Set<number>
/** 「一区一主音」的可辨阈值（音分） */
export const MIN_ROOT_CENTS: number

/** 表 + 区域 → findings。两个入参都由调用方原样传入（这里只读不改），非数组也有说法而不抛 */
export function exploreFindings(rows: unknown, regions: unknown): ExploreFinding[]
