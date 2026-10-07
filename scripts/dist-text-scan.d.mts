/** `dist-text-scan.mjs` 的声明：总体口径住在 .mjs 里（脚本要能被 node 直接跑），
 *  测试要能被 `tsc --noEmit` 检查 ⇒ 中间放这份声明（与 text-corpus.d.mts 同一理由）。 */

export interface DistWalk {
  /** dist/ 目录存在（不存在时 files/binaries 都是空的，findings 里有一条总体红） */
  exists: boolean
  files: CorpusFile[]
  /** 含 NUL 被按内容跳过的路径——dist 里的二进制是**正常**的（图片/字体），与 text-corpus 不同不报错 */
  binaries: string[]
}

export interface CorpusFile {
  /** 以 `dist/` 开头的 POSIX 风格相对路径 */
  file: string
  bytes: Uint8Array
}

export interface CorpusFinding {
  level: 'error'
  file: string
  /** 「总体」/「字节」/「第 N 行」：能指路的那个坐标 */
  where: string
  msg: string
}

export interface ScanDistResult extends DistWalk {
  findings: CorpusFinding[]
}

export const DIST_DIR: string

export function walkDist(root: string): DistWalk
export function scanDist(root: string): ScanDistResult
export function distScanFindings(root: string): CorpusFinding[]
