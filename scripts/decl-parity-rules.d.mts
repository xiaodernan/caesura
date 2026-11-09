/** `decl-parity-rules.mjs` 的声明：判据住在 .mjs 里（node 吃不下 `.ts`），测试要能被 `tsc --noEmit` 检查
 *  ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `event-rules.d.mts` 同一个理由）。
 *  这份声明自己就是本门总体里的一对：导出的每一条都得在 .mjs 里真存在，反过来也是（KI-439）。 */

/** 抽取器的读数：值名册、类型名册、数不出名册的拼法 */
export interface ExportNames {
  /** 值导出名（`export const`／`function`／`class`／`enum`／`export { … }`） */
  names: string[]
  /** 类型导出名（`export interface`／`type`；运行时不存在，不参与逐名比对） */
  types: string[]
  /** `export * from`／`export =`／`export namespace` 这一类说不清名册的拼法，逐条原样带回 */
  unresolved: string[]
}

/** 送进对比的一对文件：路径 + 两侧字节（`implSrc` 为 `null` ⇒ 实现不在这一棵树上） */
export interface ParityPair {
  decl: string
  impl: string
  declSrc: string | null
  implSrc: string | null
}

/** 一条漂移 */
export interface ParityFinding {
  /** `lying`＝声明有实现没有 ／ `missing`＝实现有声明没有 ／ `orphan`＝找不到实现 ／
   *  `unresolved`＝数不出名册的拼法 ／ `blind`＝两侧都读出 0 枚值导出 */
  kind: string
  decl: string
  impl: string
  /** 那枚名字；`orphan`／`unresolved`／`blind` 时是说明文本 */
  name: string
}

/** 一对的一次完整扫描：findings 与两侧名册同一趟出来 */
export interface PairScan {
  findings: ParityFinding[]
  declNames: string[]
  implNames: string[]
}

/** 整个总体的读数 */
export interface CensusReport {
  findings: ParityFinding[]
  /** 送进对比的对数（0 ⇒ 名册读空，门不许白绿） */
  pairs: number
  /** 参与比对的值导出名总数（两侧各算一次） */
  compared: number
  /** 两侧都读空的那些声明路径 */
  blind: string[]
  /** 数不出名册的那些拼法 */
  unresolved: string[]
}

/** 声明文件的后缀；实现就是去掉 `.d` 的那一份 `.mjs` */
export const DECL_EXT: string
/** 一条漂移的种类 */
export const PARITY_KINDS: string[]
/** 声明路径 → 实现路径（形状不对返回 `null`，不猜） */
export function implPathOf(declPath: string): string | null
/** 现推一份源码的导出名册（走 TypeScript 的 AST） */
export function valueExportsOf(src: string, path: string): ExportNames
/** 一对的一次完整扫描：漂移清单 + 两侧名册 */
export function pairScan(pair: ParityPair): PairScan
/** 一对的漂移清单（`pairScan` 的投影） */
export function parityFindings(pair: ParityPair): ParityFinding[]
/** 整个总体的对账 + 同一趟扫出来的读数 */
export function parityCensus(pairs: ParityPair[]): CensusReport
