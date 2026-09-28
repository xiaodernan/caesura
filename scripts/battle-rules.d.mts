/** `battle-rules.mjs` 的声明：判据住在 .mjs 里（校验脚本要能被 node 直接跑），测试要能被 `tsc --noEmit`
 *  检查 ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `explore-rules.d.mts` 同一个理由）。 */

/** 校验器报告里那一行的形状：`level` 决定它进 ERROR 还是 WARN 计数 */
export interface BattleFinding {
  level: 'error' | 'warn'
  /** 挂在哪张表上：`battle.json` 或 `regions.json`（引用类判据说的是 region 指错了东西） */
  file: string
  where: string
  msg: string
}

export const BATTLE_TONAL_FIELDS: string[]
export const BATTLE_SILENT_FIELDS: string[]
/** 由上面两支现拼（第三份手抄名单 = 第三个主人）；拼法本身由 `tests/unit/battle-table.test.ts` 钉住 */
export const BATTLE_FIELDS: string[]
/** `pattern` 那一个格子里"第几档八度"有几档；与 `MAX_PATTERN_CELL` 的关系由同一条用例对账（主人是 `music.ts > MOTIF_R1`） */
export const PATTERN_OCTAVE_TIERS: number
/** `pattern` 一项的上界（= 动机音数 × 档数 - 1） */
export const MAX_PATTERN_CELL: number

/** 一项允许的数吗（非负整数且不越界）。测试要能单独点它，拒的一侧逐个数判 */
export function patternCellOk(n: unknown): boolean

/** 表 + 区域 → findings。两个入参都由调用方原样传入（这里只读不改），非数组也有说法而不抛 */
export function battleFindings(rows: unknown, regions: unknown): BattleFinding[]
