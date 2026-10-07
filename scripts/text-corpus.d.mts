/** `text-corpus.mjs` 的声明：总体口径住在 .mjs 里（脚本要能被 node 直接跑），
 *  而测试要能被 `tsc --noEmit` 检查 ⇒ 两边中间放一份这份声明（与 report-reds/text-integrity 同一族理由）。 */

export interface CorpusFile {
  /** 仓库相对的 POSIX 路径 */
  file: string
  bytes: Uint8Array
}

export interface CorpusWalk {
  files: CorpusFile[]
  /** 含 NUL 而被跳过的路径——今天全库应为空，非空就是要人回答「这是谁」 */
  binaries: string[]
  /** 名册里声明、但仓库里不存在的目录——非空就是「这道门读的总体比它以为的少一棵树」 */
  missing: string[]
}

export interface DecodeResult {
  ok: boolean
  text: string
  error: string
}

export interface CorpusFinding {
  level: 'error'
  file: string
  /** 「第 N 行」/「字节」/「名册」/「入参」：能指路的那个坐标 */
  where: string
  msg: string
}

export const CORPUS_DIRS: string[]
export const SKIP_DIRS: Set<string>

export function looksBinary(bytes: unknown): boolean
export function decodeUtf8(bytes: Uint8Array): DecodeResult
export function walkTextCorpus(root: string): CorpusWalk
export function corpusFindings(root: string): CorpusFinding[]
