/** `phase-status-embed.mjs` 的声明：回填的形状住在 .mjs 里（脚本要能被 `npm run status:embed` 直接跑），
 *  而 `tests/unit/phase-status.test.ts` 要能被 `tsc --noEmit` 检查 ⇒ 中间放这一份声明。缺了它，import 那边就是 TS7016。
 *  导出的每一条都得在 .mjs 里真存在，反过来也是（同名那一族门的同一取舍）。 */

export interface KvChange {
  /** 变了的那一枚 KEY */
  key: string
  /** 文档机读区里原先的值；这一枚 KEY 原先不在块里时是 `—` */
  from: string
  /** 现读的值 */
  to: string
}

export interface SpliceResult {
  /** 嵌好的整份文档（行尾跟文档自己一致） */
  text: string
  /** 这一次用的行尾 */
  eol: '\n' | '\r\n'
  /** 逐 KEY 的旧→新；空数组＝数值一枚没变 */
  changed: KvChange[]
  /** 回填的 KEY 枚数 */
  keys: number
  /** 输出与输入逐字节相同 ⇒ 不需要写盘（幂等的判据） */
  sameBytes: boolean
}

export const ROOT: string
export const DOC_DEFAULT: string
export const STATUS_DEFAULT: string
export const BEGIN: string
export const END: string

/** 只认整行文件自己的行尾；混着两种 ⇒ 抛错，不猜 */
export function eolOf(text: string): '\n' | '\r\n'
/** 现读文本 → KEY=VALUE 行；散文行 / 空集 / 重号各自当场点名 */
export function kvLinesFrom(text: string, source: string): string[]
/** 纯函数：把 kv 行嵌进机读区；KEY 集变了当场抛错 */
export function spliceKv(docText: string, kvLines: string[]): SpliceResult
/** 跑真取数工具拿现读（测试走 `--status=` 时不经过这里） */
export function liveKvLines(statusScript: string): string[]
/** CLI 入口；`--check` 只报不写（不一致 ⇒ 退出码 3） */
export function main(argv?: string[]): number
