/** `red-rate-scan.mjs` 的声明：判决行的印与读住在 .mjs 里（跑测器要能被 node 直接跑），
 *  而测试要能被 `tsc --noEmit` 检查 ⇒ 两边中间放一份这份声明。缺了它，import 那边就是 TS7016。 */

/** 与 `KINDS` 同一张名单；跑测器那边有一条腿按名字双向对账（多一条少一条都红）。 */
export type VerdictKind =
  | 'green'
  | 'red'
  | 'suite-red'
  | 'extras'
  | 'coverage-void'
  | 'scope-unmatched'
  | 'no-report'

export interface Verdict {
  kind: VerdictKind
  /** 红的用例条数，数出来的（与 `formatReds` 那句同一个来源：同一份报告的同一对数） */
  reds: number
  /** 这一趟收集到的用例总数 = 红率的分母 */
  total: number
  /** 这一趟真跑到的文件数 */
  ranFiles: number
  /** 跑测器按筛选器算出的期望文件数 */
  expectedFiles: number
  /** 红用例的名字（**全量**，不截断：点名数必须与 `reds` 相等，否则这份读数不可信 —— KI-298） */
  redTitles: string[]
  /** 那份 JSON 报告这次留下没有——`false` 时任何去读它的代码都会 ENOENT，第一版量具就死在这一格 */
  reportKept: boolean
}

export interface VerdictInput extends Omit<Verdict, 'redTitles'> {
  redTitles?: string[]
}

/** 一趟的读数可以带调用方自己的字段（mode、exit、firsts…），`rateOf` 只看 `parsed` 与 `secs` */
export interface RateRow extends Record<string, unknown> {
  parsed: Verdict | null
  secs: number
}

export interface RatePin {
  /** 从盘上现推的用例数（不是从某一趟的输出里捡的） */
  expectTotal?: number | null
  /** 从盘上现推的期望文件数 */
  expectFiles?: number | null
}

export interface RateTally {
  runs: number
  /** 进了红率的趟数——报数时用的分母就是它，不是 `runs` */
  counted: number
  reds: number
  voids: Array<{ i: number; why: string }>
  byTitle: Record<string, number>
  secsMedian: number | null
  /** 非 null ⇒ 这批读数不成立（零分母，或者分母被不可归因的趟次缩小了） */
  unusable: string | null
}

export declare const RESULT_PREFIX: string
export declare const KINDS: readonly VerdictKind[]

export function resultLine(r: VerdictInput): string
export function parseResultLine(text: string): Verdict | null
export function median(xs: Array<number | null | undefined>): number | null
export function rateOf(rows: readonly RateRow[], pin?: RatePin): RateTally
