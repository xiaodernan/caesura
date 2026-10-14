/**
 * scripts/module-loader-rules.mjs — 「被测试进程内 import 的脚本必须在任何一种检出方式下都加载得动」那条门的判据（纯函数，零依赖）。
 *
 * 立的不是风格，是 KI-118：**`scripts/validate-data.mjs` 第一行那句装饰性的 shebang，在 CRLF 的检出面上加载不动**。
 * 实测四趟（全部在平面 `D:/法环-m133plane` = HEAD 的干净检出上，跑完逐字节验回，`.scratch/ki118/probe-eol.mjs`、
 * `.scratch/ki118/probe-shebang.mjs`）：同一份 HEAD 字节，开发用的工作副本里恰好是 LF ⇒ `tests/unit/ledger-rules.test.ts`
 * 那条「进程内跑真校验器」绿；平面按 `core.autocrlf=true` 检出来是 CRLF ⇒ 同一条腿红在
 * `SyntaxError: Invalid or unexpected token`，报错把那句 `#!` 指到**变换后代码的第 19 行**（那一刻它已不是 shebang，
 * 是非法 token）；改回 LF ⇒ 12 条全绿；改回 CRLF ⇒ 红又回来（同一把锁第二次由读数说话）；
 * **留 CRLF、只删第一行 ⇒ 12 条全绿**。所以因是那句 shebang，行尾只是共犯，修法是把装饰摘掉而不是给某台机器的行尾作保。
 * 机制只量到这四步：`new vm.Script('#!…\r\n…')` 单独跑三种行尾都编译得过（`.scratch/ki118/probe-vm.mjs`）
 * ⇒ 分叉不在 `vm` 那一层而在 vite-node 的 SSR 变换那一层，而"LF 为什么把这一行剥掉了"我没有量到，
 * 所以这里也不写——判据钉的是可复跑的那件事：**这种文件被 vitest 进程内 import 就是加载不动**。
 *
 * 为什么这件事要一条门而不是"知道就行"：这条红**只在干净检出／平面／CI 上出现**，工作副本里那个文件是 LF 就永远绿
 * ——与 KI-114 那一族同一个形状（判据量的那件事在写代码的人脚边看不见）。而且洞会变回形状：谁把那一行抄回来
 * （`git add` 一份带着 shebang 的工作副本就够了），套件立刻又红。
 *
 * 判据的形状是三张名册，全部现推、没有一处手抄：
 * 1. **in-process 名册**：从 `tests/**` 里"看起来是 `scripts/*.mjs` 路径"的字符串字面量按**语法位置**分桶
 *    （`from '…'`／`import('…')`／`const X = '…'` 且那个 X 后来真被 `import(X)` 用过——三种算导入位，
 *    其余是散文或 spawn 路径），再沿脚本之间的 `from './x.mjs'` 走闭包。间接那一桶不是理论兜底：
 *    `validate-data.mjs` 就是被 `ledger-rules.test.ts` 用
 *    `const VALIDATOR_SPEC = '../../scripts/validate-data.mjs'` + `await import(VALIDATOR_SPEC)` 点名的，
 *    只读 `from` 那种抽取器会把它读成"没人 import 它"，于是判据对着一个空集自证干净。
 *    反过来，`const SELF = 'scripts/validate-data.mjs'`（喂 `readFileSync` 数自己有几行）那种只是路径字符串，
 *    不收就用处闸住——它是当场量出来的两处误点之一，收下就把 CLI 脚本拖进了加载名册。
 *    脚本**内部**用兄弟写法（`from './ledger-rules.mjs'`，实测 HEAD 上这样的导入位 22 条），那个形状没有
 *    `scripts/` 段 ⇒ 只有扫脚本本体时才打开 `SIBLING_SCRIPT_RE`；今天闭包没有多带进新名字（种子里 21 份
 *    脚本已被测试直接点全），但那条边走的是同一份读到的字节，不是设想出来的分支。
 * 2. **shebang 名册**：`scripts/*.mjs` 里从第 0 字节起就是 `#!` 的那些。
 * 3. **CLI 命令名册**：在 `package.json`／`scripts/`／`tests/` 的文本里以 `node scripts/<name>.mjs` 出现过的名字。
 *
 * 两条判据：in-process ∩ shebang 必须为空（**摘掉装饰**）；shebang 必须 ⊆ CLI 命令名册（还留着 shebang 的那些
 * 得真有人把它当命令行跑，否则那行既没有读者、又把未来任何一次进程内 import 变成地雷）。
 *
 * 为什么判据住在这里而不是测试文件里（与 `*-rules.mjs` 那十几家同一个理由）：规则要能被喂合成源码，
 * 而 `validate-data.mjs` 一被 import 就去校验真表并 `process.exit`。
 */

import { scanSkeleton } from './event-rules.mjs'

/**
 * 一个"看起来就是脚本路径"的字面量长什么样：结尾必须是 `scripts/<name>.mjs`，前面允许任意层 `../` 与目录段。
 * 刻意不收 `'node scripts/test.mjs'` 那种带空格的命令行串（那是 spawn 命令，不是 specifier）。
 */
export const SCRIPT_PATH_RE = /^(?:\.\.\/)*(?:[\w.-]+\/)*scripts\/([\w.-]+\.mjs)$/

/**
 * 脚本**内部**的兄弟写法：`import { x } from './ledger-rules.mjs'`。
 * 这条必须有，否则闭包那条边是死的——实测 HEAD 的 `scripts/` 里 25 处脚本间 import 全是这个形状
 * （`validate-data.mjs` 一家就 16 处），而它们一个都不含 `scripts/` 段。
 * 只对脚本本体打开：测试文件里的 `'./x.mjs'` 相对的是 `tests/unit/`，不是 `scripts/`。
 */
export const SIBLING_SCRIPT_RE = /^\.(?:\/|\\)([\w.-]+\.mjs)$/

/**
 * 源码里每个路径形状的字面量，按它出现的语法位置归类。块注释与行注释在 `scanSkeleton` 那一层就涂白了
 * （它保证长度与行数不变 ⇒ 报出来的行号仍对得上），所以散文里「判据住在 `scripts/x-rules.mjs`」那类句子
 * 不进任何桶——那是这条门最容易骗自己的地方。
 *
 * @param {string} src 源码（测试文件或脚本本体）
 * @param {string} file 报数时用的名字
 * @param {boolean} [sibling] 是否把 `'./x.mjs'` 那种兄弟写法也算脚本路径（只有脚本本体该打开，见 SIBLING_SCRIPT_RE）
 * @returns {{ statics: Spec[], dynamics: Spec[], consts: Spec[], prose: Spec[], total: number }}
 */
export function scriptLiterals(src, file, sibling = false) {
  const { code } = scanSkeleton(String(src))
  const out = { statics: [], dynamics: [], consts: [], prose: [], total: 0 }
  const re = /(['"`])([^'"`\n]*)\1/g
  const usage = (ident) => new RegExp(`\\bimport\\(\\s*${ident.replace(/\$/g, '\\$')}\\b`).test(code)
  let m
  while ((m = re.exec(code))) {
    const hit = SCRIPT_PATH_RE.exec(m[2]) ?? (sibling ? SIBLING_SCRIPT_RE.exec(m[2]) : null)
    if (!hit) continue
    out.total++
    const line = code.slice(0, m.index).split('\n').length
    // 字面量前面那一小段：它的尾巴决定这个字面量站在哪个语法位置上
    const before = code.slice(Math.max(0, m.index - 40), m.index).replace(/\s+$/, '')
    const item = { name: hit[1], spec: m[2], line, file }
    const decl = /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=$/.exec(before)
    if (/import\($/.test(before)) out.dynamics.push(item)
    else if (/\bfrom$/.test(before)) out.statics.push(item)
    // `const X = '…'` 只有在那个 X 后来真被 `import(X)` 用过才算导入位。实测两处会骗人：
    // `validate-data.mjs` 的 `const SELF = 'scripts/validate-data.mjs'`（喂 readFileSync 数自己有几行）与
    // `world-graph.test.ts` 的 `const VD`（读源码现推抽取器）——都只是路径字符串。把它们读成 import
    // 会把 CLI 脚本拖进 in-process 名册，于是那条 shebang 判据红在别人的形状上（合成用例里那条是 coverage.mjs）。
    else if (decl && usage(decl[1])) out.consts.push(item)
    else out.prose.push(item)
  }
  return out
}

/**
 * 只有从**第 0 字节**起头的 `#!…` 才是 shebang。行尾两种（LF 与 CRLF）都要认——这条判据不许跟着行尾变宽变窄，
 * 那正是 KI-118 的机制：LF 那份加载得了、CRLF 那份加载不了，而判据要管的是"任何一种检出都得加载得了"。
 *
 * @param {string} code 文件全文
 * @returns {string | null} 那一行的内容（不含行尾），没有则 null
 */
export function shebangOf(code) {
  const s = String(code)
  if (!s.startsWith('#!')) return null
  const nl = s.indexOf('\n')
  return nl < 0 ? s : s.slice(0, nl).replace(/\r$/, '')
}

/**
 * 从测试点到的那些脚本出发，沿脚本之间的 `from './x.mjs'` 走完闭包（间接那一层不是装饰：
 * 测试直接 import 的是 `validate-data.mjs`，而 `validate-data.mjs` 自己 import 了 `ledger-rules.mjs` 那一家）。
 *
 * @param {{ testSpecs: Spec[], scriptSpecs: Record<string, Spec[]> }} input
 *   `testSpecs`：所有测试文件里**导入位**的字面量（statics + dynamics + consts 拼起来）
 *   `scriptSpecs`：每个脚本自己的导入位字面量，键是 basename
 * @returns {{ names: string[], namedBy: Record<string, Spec[]>, unresolved: Spec[] }}
 *   `unresolved`：点了名但 `scripts/` 里没有那个文件（拼错的 specifier 或被删掉的脚本），单列一桶不许吞
 */
export function inProcessClosure({ testSpecs, scriptSpecs }) {
  const namedBy = {}
  const names = []
  const unresolved = []
  const queue = [...testSpecs]
  const seen = new Set()
  while (queue.length) {
    const spec = queue.shift()
    if (!Object.prototype.hasOwnProperty.call(scriptSpecs, spec.name)) {
      unresolved.push(spec)
      continue
    }
    if (!seen.has(spec.name)) {
      seen.add(spec.name)
      names.push(spec.name)
      namedBy[spec.name] = []
      for (const inner of scriptSpecs[spec.name]) queue.push(inner)
    }
    namedBy[spec.name].push(spec)
  }
  return { names: names.sort(), namedBy, unresolved }
}

/**
 * 闭包里的脚本有没有从第 0 字节起的 shebang。每一条 offender 都带上"是谁把它 import 进来的"，
 * 因为这条门的红必须一眼看得出牵连（KI-072 那条纪律：报数要报得出归属）。
 *
 * @param {{ names: string[], namedBy: Record<string, Spec[]>, codes: Record<string, string> }} input
 * @returns {{ name: string, shebang: string, importers: Spec[] }[]}
 */
export function loaderHazards({ names, namedBy, codes }) {
  const out = []
  for (const name of names) {
    const head = shebangOf(codes[name] ?? '')
    if (head !== null) out.push({ name, shebang: head, importers: namedBy[name] ?? [] })
  }
  return out
}

/**
 * 从一段文本里数出被当成命令行跑过的脚本名（`node scripts/<name>.mjs`，允许前面带目录段）。
 * 这一张名册读的是**原文**而不是涂白后的代码：注释里写着 `node scripts/check-dist.mjs` 通常就是在描述一条真命令。
 *
 * @param {string} text
 * @returns {string[]}
 */
export function cliNamedScripts(text) {
  const out = new Set()
  const re = /node\s+(?:[\w./-]*\/)?scripts\/([\w.-]+\.mjs)/g
  let m
  while ((m = re.exec(String(text)))) out.add(m[1])
  return [...out].sort()
}

/**
 * 一个"看起来是脚本路径"的字面量记录
 * @typedef {{ name: string, spec: string, line: number, file: string }} Spec
 */
