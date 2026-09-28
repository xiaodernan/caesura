/** `dialogue-rules.mjs` 的声明：判据住在 .mjs 里（校验脚本要能被 node 直接跑），测试要能被
 *  `tsc --noEmit` 检查 ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `lockon-rules.d.mts` 同一个理由）。 */

/** 对话树里一个节点的**出边**：选项指向的 + `next`（都是引擎里真实的"走下去"通路） */
export function dialogueEdges(node: unknown): string[]

/** 从 root/fallback 出发沿边能走到的节点 id 集合。条件一律当"可能成立"（上近似，宁可放过不误报） */
export function reachableNodes(tree: unknown): Set<string>

/** 没有任何一条边指向、也不是 root/fallback 的节点（按 id 升序） */
export function unreachableNodes(tree: unknown): string[]

/** "没有出口的环"：环上每个节点都没有选项 ⇒ 玩家按"继续"出不来。每只环给一条节点路径 */
export function stuckCycles(tree: unknown): string[][]

/** 对话表 → findings（`{ key, at, msg }`），调用方按 `at` 报 ERROR；一棵树最多报两条（孤儿 / 环） */
export function dialogueReachErrors(trees: unknown): Array<{ key: string; at: string; msg: string }>