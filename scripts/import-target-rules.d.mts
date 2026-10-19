/** `import-target-rules.mjs` 的声明：判据住在 .mjs 里（node 吃不下 `.ts`），测试要能被 `tsc --noEmit` 检查
 *  ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `event-rules.d.mts` 同一个理由）。 */

/** 一条本地 import 的说明符与它所在的行 */
export interface ImportSpecifier {
  spec: string
  line: number
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

/** `@/` 别名的前缀（`@/vfx/Trails`） */
export const ALIAS_PREFIX: string
/** `@/` 别名的根（与 `tsconfig.json > compilerOptions.paths` 对齐） */
export const ALIAS_ROOT: string
/** 解析一个本地说明符时的候选落点（按这个顺序试，第一个存在的算它） */
export const RESOLVE_SUFFIXES: string[]
/** 抽出所有模块说明符（含 import / export-from / 动态 import；注释与字符串里的散文不算） */
export function importSpecifiers(src: string): ImportSpecifier[]
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
/** 把块注释与行注释的体涂白（长度与换行数不变 ⇒ 行号继续对得上） */
export function blankComments(src: string): string
