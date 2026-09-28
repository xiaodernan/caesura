/** `ambience-rules.mjs` 的声明：判据住在 .mjs 里（校验脚本要能被 node 直接跑），测试要能被
 *  `tsc --noEmit` 检查 ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `explore-rules.d.mts` 同一个理由）。 */

/** 校验器报告里那一行的形状：`level` 决定它进 ERROR 还是 WARN 计数 */
export interface AmbienceFinding {
  level: 'error' | 'warn'
  /** 挂在哪张表上：`ambience.json` 或 `regions.json`（引用类判据说的是 region 指错了东西） */
  file: string
  where: string
  msg: string
}

export const AMB_BED_FIELDS: string[]
export const AMB_LAYER_FIELDS: string[]
export const AMB_BELL_FIELDS: string[]
/** §4 的 L2／L3 真位置声源那一支的字段（主人是 `schema.ts > AmbienceSource`） */
export const AMB_SOURCE_FIELDS: string[]
export const AMB_WAVES: Set<string>
/** §4 的两层，顺序 = 文档的层序（L2 在前） */
export const AMB_SOURCE_LAYERS: string[]
/** 上面那两种层的人话读法（只用在报错里） */
export const AMB_SOURCE_LAYER_NAMES: Record<string, string>
/** 「一区一主音」的可辨阈值（音分） */
export const MIN_ROOT_CENTS: number

/** 表 + 区域 → findings。两个入参都由调用方原样传入（这里只读不改），非数组也有说法而不抛 */
export function ambienceFindings(beds: unknown, regions: unknown): AmbienceFinding[]
