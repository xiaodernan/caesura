/** `import-target-rules.mjs` 的声明：判据住在 .mjs 里（node 吃不下 `.ts`），测试要能被 `tsc --noEmit` 检查
 *  ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `event-rules.d.mts` 同一个理由）。
 *
 * 导出集合与 `.mjs` 双向相等由 `tests/unit/decl-parity.test.ts`（KI-439）逐名判——这份文件改一枚名字，
 * 那一门就要跟着改，两侧不齐就是「漏写」或「撒谎」。 */

/** 一条本地 import 的说明符与它所在的行 */
export interface ImportSpecifier {
  spec: string
  line: number
}

/** import 位点上说明符的形状（与 `.mjs` 里 `REF_SHAPES` 那五行同一份名册） */
export type RefShape = 'static' | 'dynamic' | 'alias' | 'alias-as-string' | 'opaque'

/** 一个 import 位点：说明符（数不出时 `null`）、行号、形状，以及够点名的一段源码 */
export interface ModuleRef {
  /** 说明符本体；`shape === 'opaque'` 时数不出来 ⇒ `null` */
  spec: string | null
  /** 说明符自己那一行（1 起；多行 import 报的是 `from` 那行） */
  line: number
  shape: RefShape
  /** 该位点的源码片段（空白折叠、截到 120 字符），只为把 `opaque` 那一条报得出名 */
  text: string
}

/** 探针的读数：磁盘上是什么就是什么 */
export type ProbeKind = 'file' | 'dir' | 'missing'

/** 一条"指向没被 git 认领 / 磁盘上不存在"的本地 import */
export interface UntrackedImport {
  /** 发起 import 的文件（仓库内路径，`/` 分隔） */
  file: string
  line: number
  /** 原始说明符（`@/vfx/Trails` / `./Foo`） */
  spec: string
  /** 解析出来的目标路径（仓库内路径） */
  target: string
  /** `missing`＝磁盘上没有；`untracked`＝磁盘上有但 git 索引不认领 */
  reason: 'missing' | 'untracked'
}

/** `importCensus` 报的三种漂移 */
export type CensusKind = 'undeclared' | 'dodge' | 'opaque'

/** 一条 import 层的漂移：种类 + 发起位点 + 解析出来的目标 */
export interface CensusFinding {
  kind: CensusKind
  file: string
  line: number
  /** 说明符本体；`opaque` 那一条数不出来 ⇒ `null` */
  spec: string | null
  /** 解析出来的仓库内目标；`opaque` 那一条解析不出 ⇒ `null` */
  target: string | null
  /** 只有 `undeclared` 带：缺的那一份声明的路径 */
  decl?: string
  /** 只有 `opaque` 带：那段数不出说明符的源码 */
  text?: string
}

/** 一趟扫描的完整读数：漂移清单与三个地板出自同一趟 */
export interface CensusReport {
  findings: CensusFinding[]
  /** 送进对比的 import 位点总数（地板：读空 ⇒ 上面那份 findings 是白送的绿） */
  refs: number
  /** 被 import 到的 `.mjs` 脚本名册（去重、排序） */
  targets: string[]
  /** 每种形状的位点枚数 */
  shapes: Partial<Record<RefShape, number>>
}

/** `@/` 别名的前缀（`@/vfx/Trails`） */
export const ALIAS_PREFIX: string
/** `@/` 别名的根（与 `tsconfig.json > compilerOptions.paths` 对齐） */
export const ALIAS_ROOT: string
/** import 位点上说明符的形状名册（ASCII 码，报什么话由门决定） */
export const REF_SHAPES: RefShape[]
/** 解析一个本地说明符时的候选落点（按这个顺序试，第一个存在的算它） */
export const RESOLVE_SUFFIXES: string[]
/** 现推每一个 import 位点（AST：正则体、注释与字符串里的散文结构性地进不来） */
export function moduleRefsOf(src: string, path?: string): ModuleRef[]
/** 源码里所有数得出名字的模块说明符（`moduleRefsOf` 的投影） */
export function importSpecifiers(src: string, path?: string): ImportSpecifier[]
/** 是不是本地说明符（裸包名不归这一格） */
export function isLocalSpecifier(spec: string): boolean
/** 本地说明符 → 仓库内候选路径（不判存在性） */
export function resolveLocal(spec: string, fromFile: string): string | null
/** 判据本体：找出指向「没被 git 认领」或「磁盘上不存在」的本地 import */
export function findUntrackedImportTargets(
  files: { file: string; text: string }[],
  tracked: Set<string>,
  opts?: { probe?: (rel: string) => ProbeKind },
): UntrackedImport[]
/** 第二格（KI-440）：被 import 的脚本必须有声明，走过变量的引用与数不出的引用各自报名 */
export function importCensus(
  files: { file: string; text: string }[],
  opts?: { declared?: Set<string> },
): CensusReport
