/** `module-loader-rules.mjs` 的声明：判据住在 `.mjs` 里（node 吃不下 `.ts`），测试要能被 `tsc --noEmit` 检查
 *  ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `event-rules.d.mts`、`lockon-rules.d.mts` 同一个理由）。 */

/** 一个"看起来是脚本路径"的字符串字面量，带着它出现在哪份文件的哪一行 */
export interface Spec {
  name: string
  spec: string
  line: number
  file: string
}

/** 路径形状的字面量按语法位置分四桶（三种导入位 + 散文/spawn 位），`total` 是匹配到的条数 */
export interface ScriptLiterals {
  statics: Spec[]
  dynamics: Spec[]
  consts: Spec[]
  prose: Spec[]
  total: number
}

/** 一个"看起来就是脚本路径"的字面量长什么样（结尾必须是 `scripts/<name>.mjs`） */
export const SCRIPT_PATH_RE: RegExp

/** 脚本**内部**的兄弟写法（`from './ledger-rules.mjs'`）——HEAD 的 scripts/ 里 25 处脚本间 import 全是这个形状 */
export const SIBLING_SCRIPT_RE: RegExp

/** 源码里每个路径形状的字面量按语法位置归类（注释先涂白，长度与行数不变 ⇒ 行号仍对得上）；`sibling` 只在脚本本体上打开 */
export function scriptLiterals(src: string, file: string, sibling?: boolean): ScriptLiterals

/** 只有从第 0 字节起头的 `#!…` 才算 shebang；LF 与 CRLF 两种行尾都要认 */
export function shebangOf(code: string): string | null

/** 从测试点到的脚本出发，沿脚本之间的 `from './x.mjs'` 走完闭包；点了名却不在盘上的单列一桶 */
export function inProcessClosure(input: {
  testSpecs: Spec[]
  scriptSpecs: Record<string, Spec[]>
}): { names: string[]; namedBy: Record<string, Spec[]>; unresolved: Spec[] }

/** 闭包里的脚本有没有 shebang，每条 offender 带上"是谁把它 import 进来的" */
export function loaderHazards(input: {
  names: string[]
  namedBy: Record<string, Spec[]>
  codes: Record<string, string>
}): { name: string; shebang: string; importers: Spec[] }[]

/** 一段文本里被当成命令行跑过的脚本名（`node scripts/<name>.mjs`） */
export function cliNamedScripts(text: string): string[]
