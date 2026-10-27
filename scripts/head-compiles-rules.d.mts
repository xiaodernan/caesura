/** `head-compiles-rules.mjs` 的声明：判据住在 .mjs 里（node 吃不下 `.ts`），测试要能被 `tsc --noEmit`
 * 检查 ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `event-rules.d.mts` 同一个理由）。 */

/** 一棵提交树的快照：`files` 是清单（这一棵树有哪些文件），`blobs` 是它们的字节 */
export interface CommitTree {
  files: string[]
  blobs: Map<string, string>
  /** 这一读数本身完整吗（false ⇒ `why` 说清哪儿没读成，不许当"干净"） */
  ok: boolean
  why: string
}

/** 一条编译红 */
export interface CompileDiagnostic {
  file: string
  line: number
  code: number
  text: string
}

/**
 * 一次编译裁决 + **三个诚实读数**：
 * - `checked`：根文件份数；
 * - `served`：真的从树上喂进去的份数；
 * - `trackedMissed`：清单里有却没能喂进去的份数（**恒为 0** 才算这道门是真的）；
 * - `leaked`：工作树里的文件被算了进来的份数（**恒为 0** 才算这一棵树是自足的）。
 */
export interface CompileReport {
  ok: boolean
  why: string
  diagnostics: CompileDiagnostic[]
  checked: number
  served: number
  trackedMissed: number
  leaked: number
}

/** 读树时的可选参数（`env` 用来给子进程换环境） */
export interface TreeReadOptions {
  env?: Record<string, string | undefined>
}

/** 读暂存区时的可选参数：`indexFile` 指向一份**旁挂的索引**（`GIT_INDEX_FILE`） */
export interface IndexReadOptions extends TreeReadOptions {
  indexFile?: string
}

/** 读 HEAD 的树与 blob（主干自证那一棵） */
export function readHeadTree(root: string, opts?: TreeReadOptions): CommitTree
/** 读暂存区的树与 blob（落库前那一棵） */
export function readIndexTree(root: string, opts?: IndexReadOptions): CommitTree
/** 那一棵树里 `src/` 与 `tests/` 下的源码根（绝对路径） */
export function sourceRoots(tree: CommitTree, root: string): string[]
/** 读编译选项（tsconfig 也从树里读） */
export function readCompilerOptions(root: string, tree?: CommitTree): { options: unknown; error?: string }
/** 把树上的字节喂给 tsc，量它编译不过几处 */
export function treeCompileErrors(root: string, opts?: { tree?: CommitTree }): CompileReport
/** 命令行入口（`--index` 量暂存区，不带参数量 HEAD）；返回退出码 */
export function main(): number
