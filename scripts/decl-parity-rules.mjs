/**
 * scripts/decl-parity-rules.mjs — 「声明说它导出了什么」与「实现真导出了什么」是不是同一批名字（KI-439）。
 *
 * **为什么这一格今天没有主人**（五趟实测都在真仓库上跑，跑完逐字节还原；
 * `.scratch/ki439/probe2.mjs`、`.scratch/ki439/probe3.mjs`，每趟都跑 `node_modules/typescript/bin/tsc --noEmit`
 * 与那份刚植入的测试）：
 *   ① 往 `scripts/phase-status-embed.d.mts` 里加一枚实现根本没有的 `export function notAThing`
 *      ⇒ **tsc rc=0，那份测试 14 条全绿**。
 *   ② 把一枚**没人 import** 的常量的声明类型改指成 `number`（实现里它是字符串路径）⇒ 两处同样全绿。
 *   ③ 反过来，把一枚**真在被 import** 的名字从声明里整行删掉／改名 ⇒ tsc 红一条 TS2305。
 *   ④ 只把 `export function eolOf` 的 `export` 摘掉、留一个同名的局部声明在原地 ⇒ **tsc rc=0**
 *      （导入位照样读得到 `eolOf` 这个符号，只是它不再是导出；为什么 TS2459 没出来我没有量到，
 *      要读 TS 内部才说得清，而这条门不需要那个说法——可复跑的那件事就是"它不红"）。
 *   ⑤ 对照趟（证明探针自己是活的）：改 `spliceKv` 那枚真在被调用的签名的参数类型 ⇒ tsc 红 8 条。
 * ③ 那一向有读者，而且读者是 tsc；①②④ 那一向谁也没有——`tsc` 只会照着声明去查调用位，
 * 声明替实现撒谎时它信得毫无阻力；套件更不读 `.d.mts`（① 那趟里它是绿的）。
 * 于是这一门的取舍：**名册按 AST 现推，两侧逐名比**，而不是再指望编译器。它顺带接住 ④ 那种
 * 「名字在、export 没了」的形状——编译器放过，本门按「漏写」报名。
 *
 * **比的是值导出，不是类型导出**：`.d.mts` 里的 `export interface`／`export type` 在运行时不存在，
 * 把它们算进声明那一侧的名册会在真总体上刷出一片假红（HEAD 的 35 对里每一对都带 interface，
 * 实测严格同名才成立）。所以 `valueExportsOf` 把两侧分成 `names`／`types` 两堆，`parityFindings`
 * 只拿 `names` 对 `names`。豁免只有这一条，别的拼法一律报名：`export * from`、`export =`、
 * `export namespace` 这些数不出名字清单的形状，今天真总体上 0 处（`.scratch/ki439/census.mjs` 两平面同数），
 * 一旦出现就走 `unresolved` 那条 finding，而不是让抽取器安静地读空。
 *
 * **两侧都读空的那一对不算干净**（`blind`）：`export {}` 这种文件两侧都是 0 枚名字时，逐名比对恒真；
 * 那是抽取器没吃下去的形状，必须报名。地板与 `compared`（参与比对的名字总数）由同一趟扫描给出，
 * 不再补第二趟循环——第二趟自己就是 KI-342 那一族的病。
 *
 * @see tests/unit/decl-parity.test.ts
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')

/** 声明文件的后缀；实现就是去掉 `.d` 的那一份 `.mjs` */
export const DECL_EXT = '.d.mts'

/** 一条漂移的种类：ASCII 码，报什么话由门决定（与 `import-target-rules.mjs` 的 `reason` 同一取舍） */
export const PARITY_KINDS = ['lying', 'missing', 'orphan', 'unresolved', 'blind']

/**
 * 声明路径 → 实现路径；形状不对就返回 `null`（交回调用方报名，不猜）。
 *
 * @param {string} declPath 仓库内路径，`/` 分隔
 * @returns {string | null}
 */
export function implPathOf(declPath) {
  return declPath.endsWith(DECL_EXT) ? `${declPath.slice(0, -DECL_EXT.length)}.mjs` : null
}

/**
 * 现推一份源码的导出名册。
 *
 * 走 TypeScript 自己的 AST，不数分号也不正则抓 `export`：注释里的散文、函数体里的嵌套形状
 * 都不该进名册，而这三件事用正则要各打一场补丁。
 *
 * **只扫顶层语句**：`export` 在模块里只能出现在顶层，函数体里那一枚是语法错（TS 的错误恢复照样
 * 把它读成一条语句）——跟着递归就会把语法错当成导出名，那正是「抽取器比被抽的东西还宽」的形状。
 *
 * **解构的导出要展开**：`export const { a, b: c } = o` 真导出的名字是 `a` 与 `c`；不展开就会在实现侧
 * 读出一串 `{ a, b: c }` 这种声明永远配不上的"名字"。`export * from`、`export =`、`export namespace`
 * 这三样数不出清单（今天真总体上 0 处），原样进 `unresolved` 报名，不让抽取器安静地读空。
 *
 * @param {string} src 文件全文
 * @param {string} path 只为选 `ScriptKind`（`.mjs` 走 JS，其余走 TS）
 * @returns {{ names: string[], types: string[], unresolved: string[] }}
 */
export function valueExportsOf(src, path) {
  const kind = /\.mjs$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const file = ts.createSourceFile(path, String(src), ts.ScriptTarget.Latest, true, kind)
  const names = new Set()
  const types = new Set()
  const unresolved = []
  const isExported = (node) => (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  const bindName = (target, where) => {
    if (ts.isIdentifier(target)) names.add(target.text)
    else if (ts.isObjectBindingPattern(target) || ts.isArrayBindingPattern(target)) {
      for (const el of target.elements) {
        if (ts.isOmittedExpression(el)) unresolved.push(`${where} 里有空位`)
        else if (el.dotDotDotToken) unresolved.push(`${where} 里有 rest 绑定 ${el.getText()}`)
        else if (el.propertyName || ts.isIdentifier(el.name)) names.add(el.name.getText())
        else bindName(el.name, where) // 嵌套解构：递归到底，露不出名字的那一格自己报名
      }
    } else unresolved.push(`${where} 的绑定形状读不出名字：${target.getText()}`)
  }
  const take = (node) => {
    // `export { a, b as c }` / `export { a } from './x.mjs'`：导出位上的名字是 `name`（`c` 那个方向）
    if (ts.isExportDeclaration(node)) {
      if (!node.exportClause) unresolved.push(`export ${node.isTypeOnly ? 'type ' : ''}* from ${node.moduleSpecifier?.getText() ?? '?'}`)
      else if (ts.isNamespaceExport(node.exportClause)) unresolved.push(`export * as ${node.exportClause.name.text}`)
      else
        for (const e of node.exportClause.elements) {
          if (e.isTypeOnly || node.isTypeOnly) types.add(e.name.text)
          else names.add(e.name.text)
        }
    }
    if (ts.isVariableStatement(node) && isExported(node)) {
      const head = node.declarationList.flags === ts.NodeFlags.Ambient ? 'declare' : 'export'
      for (const d of node.declarationList.declarations) bindName(d.name, `${head} ${d.name.getText()}`)
    }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) && isExported(node) && node.name)
      names.add(node.name.text)
    if (ts.isTypeAliasDeclaration(node) && isExported(node)) types.add(node.name.text)
    if (ts.isInterfaceDeclaration(node) && isExported(node)) types.add(node.name.text)
    if (ts.isModuleDeclaration(node) && isExported(node)) unresolved.push(`export namespace ${node.name.getText()}`)
    if (ts.isExportAssignment(node)) unresolved.push(`export = ${node.expression.getText()}`)
  }
  for (const statement of file.statements) take(statement)
  return { names: [...names].sort(), types: [...types].sort(), unresolved }
}

/**
 * 一对（声明 ⇄ 实现）的完整一次扫描：漂移清单 + 两侧各自的名册。
 *
 * 名册跟着 findings 一起返回，是为了让总体那一趟**只解析一次**——地板若由第二趟循环另算一遍，
 * 那一趟自己就是 KI-342 那一族的病。
 *
 * @param {{ decl: string, impl: string, declSrc: string | null, implSrc: string | null }} pair
 *   `implSrc` 为 `null` ⇒ 声明找不到实现（孤儿）；`declSrc` 为 `null` 不该由这里受理（名册就是从声明侧来的）
 * @returns {{ findings: { kind: string, decl: string, impl: string, name: string }[], declNames: string[], implNames: string[] }}
 */
export function pairScan(pair) {
  const findings = []
  if (pair.implSrc === null) {
    return { findings: [{ kind: 'orphan', decl: pair.decl, impl: pair.impl, name: '（实现文件不在这一棵树上）' }], declNames: [], implNames: [] }
  }
  const decl = valueExportsOf(pair.declSrc ?? '', pair.decl)
  const impl = valueExportsOf(pair.implSrc, pair.impl)
  // 数不出名字清单的拼法先报名：两侧任何一侧有，逐名比对就不可信，白过等于把门自己拆掉
  for (const text of [...decl.unresolved, ...impl.unresolved])
    findings.push({ kind: 'unresolved', decl: pair.decl, impl: pair.impl, name: text })
  if (decl.names.length === 0 && impl.names.length === 0)
    findings.push({ kind: 'blind', decl: pair.decl, impl: pair.impl, name: '两侧都读出 0 枚值导出' })
  const implSet = new Set(impl.names)
  const declSet = new Set(decl.names)
  for (const n of decl.names) if (!implSet.has(n)) findings.push({ kind: 'lying', decl: pair.decl, impl: pair.impl, name: n })
  for (const n of impl.names) if (!declSet.has(n)) findings.push({ kind: 'missing', decl: pair.decl, impl: pair.impl, name: n })
  return { findings, declNames: decl.names, implNames: impl.names }
}

/**
 * 一对的漂移清单（`pairScan` 的投影，给只关心红不红的调用方）。
 *
 * @param {{ decl: string, impl: string, declSrc: string | null, implSrc: string | null }} pair
 * @returns {{ kind: string, decl: string, impl: string, name: string }[]}
 */
export function parityFindings(pair) {
  return pairScan(pair).findings
}

/**
 * 整个总体的对账：逐对跑 `pairScan`，并带回**同一趟**扫出来的四个读数。
 *
 * - `pairs`：真的送进对比的对数（门用它接住「名册读空 ⇒ 每条断言白送绿」）；
 * - `compared`：参与比对的值导出名总数（两侧各算一次）；
 * - `blind`：两侧都读空的那些声明路径；
 * - `unresolved`：数不出名册的那些拼法。
 *
 * @param {{ decl: string, impl: string, declSrc: string | null, implSrc: string | null }[]} pairs
 * @returns {{ findings: { kind: string, decl: string, impl: string, name: string }[], pairs: number, compared: number, blind: string[], unresolved: string[] }}
 */
export function parityCensus(pairs) {
  const findings = []
  const blind = []
  const unresolved = []
  let compared = 0
  for (const pair of pairs) {
    const scan = pairScan(pair)
    findings.push(...scan.findings)
    if (scan.findings.some((x) => x.kind === 'blind')) blind.push(pair.decl)
    for (const x of scan.findings) if (x.kind === 'unresolved') unresolved.push(x.name)
    compared += scan.declNames.length + scan.implNames.length
  }
  return { findings, pairs: pairs.length, compared, blind, unresolved }
}
