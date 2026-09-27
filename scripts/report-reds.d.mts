/** `report-reds.mjs` 的声明：门禁的读数逻辑住在 .mjs 里（脚本要能被 node 直接跑），
 *  而测试要能被 `tsc --noEmit` 检查 ⇒ 两边中间放一份这份声明。缺了它，import 那边就是 TS7016。 */

export interface RedCase {
  /** `describe > it` 的全名（报告里没有就退到 title） */
  name: string
  /** 第一条失败消息的第一行非空文本（堆栈不在这里，在那份留在原地的报告里） */
  first: string
}

export interface RedFile {
  /** 仓库相对的 POSIX 路径 */
  file: string
  reds: RedCase[]
}

export interface RedSummary {
  /** 这一趟跑过的用例总数（含绿的） */
  total: number
  /** 红的条数（数出来的，不是 `numFailedTests` 抄来的——两者应当一致，不一致就是报告自己矛盾） */
  nRed: number
  /** 跑到的文件数（含没有红用例的那些） */
  ranFiles: number
  files: RedFile[]
}

export function summarizeReds(json: unknown, root?: string): RedSummary
export function formatReds(sum: RedSummary): string
