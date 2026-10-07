/** `text-integrity.mjs` 的声明（KI-082）。判据住在 `.mjs` 里（校验脚本要能被 node 直接跑），
 *  测试要能被 `tsc --noEmit` 检查 ⇒ 中间放这一份，与 `battle-rules.d.mts` 同一个理由（缺它就是 TS7016）。 */

/** 一处坏字符的位置：行号与列号都是 1 基（`index` 是文本里的码元下标，给切片用） */
export interface MojibakeHit {
  line: number
  column: number
  index: number
}

/** 校验器报告里那一行的形状：这条判据只会报 ERROR（`level` 留成字面量，与那一族 findings 同形） */
export interface MojibakeFinding {
  level: 'error'
  file: string
  where: string
  msg: string
}

/** 那一族里唯一被认作「写坏了」的字符，源码里一律写成转义 `\uFFFD` */
export const MOJIBAKE_CHAR: string

/** 一段文本里所有 U+FFFD 的位置（按文本先后）。入参不是字符串 ⇒ 空数组，不抛 */
export function findMojibake(text: unknown): MojibakeHit[]

/** 「表名 + 原文」的清单 → findings（同一行报一条，带上下文与修法）。非数组 ⇒ 空数组 */
export function mojibakeFindings(entries: ReadonlyArray<{ file: string; text: unknown }> | unknown): MojibakeFinding[]

/** 一处游离控制字符的位置：行/列 1 基，`code` 是码点（报告要点出 `U+0008` 这种写法） */
export interface StrayControlHit {
  line: number
  column: number
  index: number
  code: number
}

/** 允许留在文本里的控制字符（TAB/LF/CR = 排版，不是损伤）；码点表，判据与测试读同一份 */
export const ALLOWED_CONTROL: number[]

/** 一段文本里所有不该存在的 C0 控制字符（按文本先后）。入参不是字符串 ⇒ 空数组，不抛 */
export function findStrayControl(text: unknown): StrayControlHit[]

/** 「文件 + 原文」的清单 → findings（同一行报一条，把每个码点都点出来） */
export function strayControlFindings(entries: ReadonlyArray<{ file: string; text: unknown }> | unknown): MojibakeFinding[]
