/** `test-scope.mjs` 的声明：判据住在 .mjs 里（跑测脚本要能被 node 直接跑），测试要能被
 *  `tsc --noEmit` 检查 ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `report-reds.d.mts` 同一理由）。 */

export interface Scope {
  /** 这一趟该跑到的测试文件（已折成正斜杠）；`unmatched` 非空时它是空的 */
  expected: string[]
  /** 一个文件都没圈到的筛选器——调用方必须在开跑之前为它停下来 */
  unmatched: string[]
  /** 这一趟到底带没带范围（决定印出来那句话该不该说"全部"） */
  scoped: boolean
}

export const VALUE_OPTS: Set<string>

/** 位置参数（= 筛选器）：不吃掉 `-t <名字模式>` 那一类选项的值 */
export function positionalFilters(argv: readonly string[] | undefined): string[]

export function matchesFilter(file: string, filter: string, root: string): boolean

export function scopeOf(files: readonly string[], filters: readonly string[], root: string): Scope

/**
 * 磁盘名册 walk（递归，只收 `.test.ts`）——名册的**唯一主人**（KI-099b 起）：
 * 主跑测器与 raw 腿都从这里拿，谁本地再抄一份，同一次「全量」就会在两条腿上数出两个分母。
 *
 * 走查途中消失的子树被**跳过**（不抛，KI-332）；顶层读不到仍会抛（空名册会读成全绿）。
 * `opts.readdir` 是接缝：合成夹具用它把「某一层没了」摆出来。
 */
export function testFilesOnDisk(
  dir: string,
  opts?: { readdir?: (dir: string) => { name: string; isDirectory(): boolean }[] }
): string[]

/**
 * 名册 ⇄ 这一趟真跑到的文件集，**双向**差集（KI-099）：两边都折成正斜杠再比，
 * `ran` 会先去重。`missing` 可以靠重跑消掉（本机 EPERM 的静默跳过），`extras` 不行
 * （名册与收集面是两份写死的判据）——调用方对后者要当场退出。
 */
export function reconcileRoster(
  expected: readonly string[] | undefined,
  ran: readonly string[] | undefined
): { missing: string[]; extras: string[] }

/**
 * raw 腿（`npm run test:raw`）的退出码裁决（KI-099b）：红绿由报告数出来（`reportGreen`），
 * 不是进程退出码（本机那条 EPERM 会让 vitest 退出 1 而用例全绿）。报告说了红 ⇒ 1
 * （红优先于对账）；全绿但对不上账（`missing`/`extras` 任一非空）⇒ 2；全绿且对上账 ⇒ 0。
 */
export function rawExitCode(
  reportGreen: boolean,
  diff?: { missing?: readonly string[]; extras?: readonly string[] }
): number

export function describeScope(filters: readonly string[], expectedCount: number, diskCount: number): string
