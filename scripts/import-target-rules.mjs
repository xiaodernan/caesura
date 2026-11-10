/**
 * scripts/import-target-rules.mjs — 「本地 import 的目标必须是被版本库认领的文件」这一格
 * （KI-133 结案时留下的判据缺口，需求 §79 技术债那一族）。
 *
 * **为什么要有这一格**：2026-10-20 之前，主干连续 5 天不接受任何 `.ts` 提交（KI-125），
 * 根因是 `src/main.ts` 早就在 import 四份**从未进过版本库**的模块
 * （`@/vfx/Trails`／`@/vfx/Decals`／`@/vfx/GPUParticles`／`@/ai/Squad`）。
 * 那 7 条 TS2307 只有在**工作树**上偶然被 `tsc` 发现（工作树里恰好有那四份文件的字节），
 * 而任何按 HEAD 检出的平面（CI、别人的克隆、`git stash` 之后、干净 worktree）都看不见它们：
 * 在那些平面上，主干**编译不过**，机器级 pre-commit 因此把全仓的提交通道一起关掉。
 *
 * **这一格量什么**：工作树里每一个**本地** import（`@/…` 别名或 `./`／`../` 相对路径）
 * 解析出来的目标文件，
 *   ① 必须真的存在于磁盘上（否则是悬空 import——`tsc` 会报，但只在工作树上报）；
 *   ② 必须落在 **git 认领的集合**里（`git ls-files`＝索引；提交前钩子看到的正是它）。
 * 裸说明符（`three`／`vitest`／`node:fs`）是包管理器的事，不归这一格。
 *
 * **为什么判据住在脚本里而不是测试文件里**：与 `*-rules.mjs` 那一族同一个理由——
 * 「喂一份坏 import、看它拒不拒」这一半必须在纯模块里量（`validate-data.mjs` 一被 import
 * 就去校验真表并 `process.exit`），门禁与测试读的是同一段代码。
 *
 * **口径**：`@/x` ⇒ `src/x`（`tsconfig.json` 的 `paths`），随后按 `''`／`.ts`／`.tsx`／`.json`／`/index.ts`
 * 四种落点试；相对路径按**发起 import 的那个文件**的目录解析。两级解析（先目录、再文件）
 * 与 bundler 的实际行为一致。
 *
 * **KI-440 换了抽取器的嘴**（原先是三个正则扫涂白后的文本，现在走 TypeScript 的 AST）。换嘴的理由是
 * 在真总体上量出来的两向误差，同一趟对照跑在父提交的字节上（`.scratch/ki440/probe-extractor.mjs`，
 * 范围内 505 份 `.ts`，文本抽到 3810 枚 / AST 抽到 3783 枚）：
 *   ① 文本版**多读 27 枚**根本不存在 import——它把正则字面量与模板串里的散文当成了说明符：
 *      `tests/unit/action-labels.test.ts` 里那枚是 `[^`（它读到的是**另一份用来抓 import 的正则自己**），
 *      `tests/unit/weather-switch.test.ts` 读到跨越三行的 `(three|@\/vfx|...)`，另有
 *      `\.\/text-corpus\.mjs`、`<specifier>`、`${esc}` 等。今天它们没刷红只是因为拼法碰巧不以 `./`／`@/`
 *      开头（`\.` 起头就不算本地）——而地板 `specs ≥ 400` 一直在替这些幻影记账。
 *      根因：`inString` 是按**整条匹配的头**（`from` 那个词）判的，正则体里的 `from` 在词法上是代码，
 *      于是它后面那段引文被照收。
 *   ② 文本版**少读 1 枚**真 import：`tests/unit/ledger-rules.test.ts` 用 `const VALIDATOR_SPEC = '…'`
 *      加 `await import(VALIDATOR_SPEC as string)` 指向校验器，那枚说明符压根不在引文位点上。
 *      这正是 KI-440 的主题：注释写着「走变量是为了躲 TS7016」，代价是这条 import 整体离开了类型层
 *      （`.scratch/ki440/probe-ts7016.mjs` 实测：字面 specifier 指无声明脚本 ⇒ `tsc` rc=2 一条 TS7016；
 *      同一份脚本换成变量 + `as string` ⇒ rc=0，连**路径存在性**都不再被查）。
 * 所以 `moduleRefsOf` 只认 AST 上的 import 位点，`importSpecifiers` 成了它的一个投影——**抽取器只有一个**，
 * KI-133 那一格与 KI-440 这一格读的是同一批说明符。
 *
 * **KI-440 新增的第二格**（`importCensus`）：被 TS 侧 import 到的每一份 `.mjs` 脚本都必须有自己的
 * `.d.mts`；`await import(VAR)` 那种走过变量的引用单独报 `dodge`；数不出说明符的动态 import 报 `opaque`
 * 而不是安静跳过（与 `decl-parity-rules.mjs` 的 `unresolved` 同一取舍）。
 *
 * @see tests/unit/import-targets.test.ts
 * @see scripts/import-target-rules.d.mts
 */
import { createRequire } from 'node:module'
import { DECL_EXT } from './decl-parity-rules.mjs'

const require = createRequire(import.meta.url)
const ts = require('typescript')

/** `@/` 别名的根（与 `tsconfig.json > compilerOptions.paths` 对齐） */
export const ALIAS_PREFIX = '@/'
export const ALIAS_ROOT = 'src'

/** 被判「有没有声明」的脚本后缀；`.d.mts` 那一份的主人是 `decl-parity-rules.mjs`，这里只引用不另抄 */
const SCRIPT_EXT = '.mjs'

/**
 * 一条 import 位点上说明符的形状。ASCII 码，报什么话由门决定（与 `decl-parity-rules.mjs` 的
 * `PARITY_KINDS` 同一取舍）。
 *
 * - `static`：`import … from 'X'` / `export … from 'X'`（含 `import 'X'` 侧效与 `import type`）；
 * - `dynamic`：`import('X')`，说明符就是那个字面量；
 * - `alias`：`import(VAR)`，`VAR` 是本文件顶层 `const VAR = 'X'`；
 * - `alias-as-string`：`import(VAR as string)`——`as string` 把它整体挪出类型层的那一枚；
 * - `opaque`：动态 import 的参数数不出说明符（模板串、参数、属性访问、没有参数）。
 */
export const REF_SHAPES = ['static', 'dynamic', 'alias', 'alias-as-string', 'opaque']

/**
 * 解析一个本地说明符时的候选落点（按这个顺序试，第一个存在的算它）。
 *
 * `.json` 在列：`tsconfig.json` 开着 `resolveJsonModule`，而 `src/data/index.ts` 把二十多张数据表
 * 直接 import 进来——不试这一条，那些 import 全会被判成"磁盘上不存在"。
 */
export const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.json', '/index.ts', '/index.tsx']

/**
 * 现推一份源码里的**每一个 import 位点**，带上它的形状。
 *
 * 走 TypeScript 的 AST，不扫文本：正则字面量与模板串里的 `from './x'` 在语法上不是 import，
 * 而文本版把它们照收（真总体上 27 枚，见文件头 ①）；反过来 `import(VAR as string)` 指向的那枚
 * 说明符只有 AST 才捞得回来（②）。注释与字符串里的散文这次同样进不来——那一条 AST 是白送的。
 *
 * **别名只做同文件顶层 `const X = '字面量'` 这一层**：那是本仓实际拼法（唯一一处正是
 * `VALIDATOR_SPEC`）。不追跨文件、不追函数参数——追不到的那一些一律落进 `opaque` 报名，
 * 而不是让抽取器安静地读空（与 `decl-parity-rules.mjs` 的 `unresolved` 同一取舍）。
 *
 * @param {string} src 文件全文
 * @param {string} path 只为选 `ScriptKind`（`.mjs` 走 JS，其余走 TS）
 * @returns {{spec: string | null, line: number, shape: string, text: string}[]}
 */
export function moduleRefsOf(src, path = 'module.ts') {
  const kind = /\.mjs$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const file = ts.createSourceFile(path, String(src), ts.ScriptTarget.Latest, true, kind)
  const consts = new Map()
  for (const st of file.statements) {
    if (!ts.isVariableStatement(st)) continue
    for (const d of st.declarationList.declarations)
      if (ts.isIdentifier(d.name) && d.initializer && ts.isStringLiteral(d.initializer)) consts.set(d.name.text, d.initializer.text)
  }
  const out = []
  // 行号钉在**说明符自己**那一行：多行 `import {\n a,\n} from 'x'` 报的是 `from` 那行，与文本版同坐标
  const lineOf = (node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
  const push = (spec, node, shape) =>
    out.push({ spec, line: lineOf(node), shape, text: node.getText().replace(/\s+/g, ' ').slice(0, 120) })
  const walk = (node) => {
    if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) {
      push(node.moduleSpecifier.text, node.moduleSpecifier, 'static')
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0]
      const bare = arg && ts.isAsExpression(arg) ? arg.expression : arg
      if (bare && ts.isStringLiteral(bare)) push(bare.text, bare, 'dynamic')
      else if (bare && ts.isIdentifier(bare) && consts.has(bare.text)) {
        const resolved = consts.get(bare.text)
        const isRelative = resolved.startsWith('./') || resolved.startsWith('../')
        push(consts.get(bare.text), bare, isRelative ? (arg === bare ? 'alias' : 'alias-as-string') : 'dynamic')
      } else push(null, arg ?? node, 'opaque')
    }
    ts.forEachChild(node, walk)
  }
  for (const st of file.statements) walk(st)
  return out
}

/**
 * 源码里所有**数得出名字**的模块说明符（import / export-from / 动态 import / 经由别名的动态 import）。
 *
 * @param {string} src
 * @param {string} [path] 只为选 `ScriptKind`
 * @returns {{spec: string, line: number}[]}
 */
export function importSpecifiers(src, path) {
  return moduleRefsOf(src, path)
    .filter((r) => r.spec !== null)
    .map((r) => ({ spec: r.spec, line: r.line }))
}

/**
 * 判据本体：找出指向「没被 git 认领」或「磁盘上不存在」的本地 import。
 *
 * @param {{file: string, text: string}[]} files 工作树里的源码（路径用 `/` 分隔）
 * @param {Set<string>} tracked 被 git 认领的仓库内路径（`git ls-files` 的形状）
 * @param {{probe?: (rel: string) => 'file' | 'dir' | 'missing'}} [opts]
 *   `probe` 查真实磁盘；不传时退回到"在 tracked 集合里就算存在"。
 * @returns {{file: string, line: number, spec: string, target: string, reason: 'missing' | 'untracked'}[]}
 */
export function findUntrackedImportTargets(files, tracked, opts = {}) {
  const probe = opts.probe ?? ((rel) => (tracked.has(rel) ? 'file' : 'missing'))
  const out = []
  for (const f of files) {
    for (const { spec, line } of importSpecifiers(f.text, f.file)) {
      if (!isLocalSpecifier(spec)) continue
      const base = resolveLocal(spec, f.file)
      const target = base === null ? null : pickExisting(base, probe)
      if (target === null) {
        out.push({ file: f.file, line, spec, target: base ?? spec, reason: 'missing' })
        continue
      }
      if (!tracked.has(target)) {
        out.push({ file: f.file, line, spec, target, reason: 'untracked' })
      }
    }
  }
  return out
}

/** 是不是本地说明符（裸包名不归这一格） */
export function isLocalSpecifier(spec) {
  if (spec.startsWith(ALIAS_PREFIX)) return true
  return spec.startsWith('./') || spec.startsWith('../')
}

/**
 * 本地说明符 → 仓库内候选路径（不判存在性）。
 * `@/vfx/Trails` ⇒ `src/vfx/Trails`；`./Foo`（在 `src/a/b.ts` 里）⇒ `src/a/Foo`。
 * @returns {string|null} null 表示解析不出（不该发生）
 */
export function resolveLocal(spec, fromFile) {
  if (spec.startsWith(ALIAS_PREFIX)) {
    return normalizePath(`${ALIAS_ROOT}/${spec.slice(ALIAS_PREFIX.length)}`)
  }
  // 相对路径（./ 或 ../）相对导入文件所在目录解析；已是仓库根相对路径（scripts/...）直接返回
  if (!spec.startsWith('./') && !spec.startsWith('../')) {
    return normalizePath(spec)
  }
  const from = fromFile.replace(/\\/g, '/')
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''
  const parts = (dir ? dir.split('/') : []).concat(spec.split('/'))
  return normalizePath(parts.join('/'))
}

/** 归一化 `.` 与 `..`（`@/../scripts/x` ⇒ `scripts/x`：别名根之上也可以走） */
function normalizePath(p) {
  const stack = []
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') { stack.pop(); continue }
    stack.push(seg)
  }
  return stack.join('/')
}

/**
 * 在候选落点里挑第一个存在的。
 *
 * **目录 import**：`import { x } from '@/data'` 指的是 `src/data` 这个**目录**——
 * 它的真目标是 `src/data/index.ts`（bundler 的 `index` 解析）。所以命中目录时要往里再走一步，
 * 否则每个目录 import 都会被误判成"指向一个没被认领的路径"（这一族在本仓有二十多处）。
 */
function pickExisting(base, probe) {
  for (const s of RESOLVE_SUFFIXES) {
    const cand = base + s
    const kind = probe(cand)
    if (kind === 'file') return cand
    if (kind === 'dir') {
      const idx = cand + '/index.ts'
      return probe(idx) === 'file' ? idx : cand
    }
  }
  return null
}

/** 动态 import 参数数不出名字时，带回源码片段的上限（够点名，不够当第二份文件） */
const OPAQUE_TEXT_LEN = 120

/**
 * 第二格（KI-440）：被 TS 侧 import 到的每一份脚本都要有自己的声明，而**走过变量**的引用要报名。
 *
 * 三种判决，各自一条腿：
 * - `undeclared`：本地说明符指到一份 `.mjs`，而 `.d.mts` 名册里没有它配的那一份。这一格的代价是实测的
 *   （`tsc` 见字面 specifier ⇒ rc=2 一条 TS7016）；补上声明之后，那一枚 import 才回到类型层。
 * - `dodge`：`import(VAR)` / `import(VAR as string)` 这种经由本文件顶层常量的引用。它报的是**形状**而不是
 *   目标——声明补齐之后 `as string` 那半句就失去了理由，而类型层照样看不见它：路径写错、名字写错、
 *   导出改名，`tsc` 一声不响（`.scratch/ki440/probe-ts7016.mjs` 的 P3：rc=0，0 条 error）。
 * - `opaque`：动态 import 的参数数不出说明符（模板串、函数参数、属性访问、没有参数）。今天真总体上 0 处，
 *   所以这一条在真总体上照不到——它的见证是合成夹具，报名而不安静跳过（与 `decl-parity-rules.mjs`
 *   的 `unresolved` 同一取舍）。
 *
 * `targets`（被 import 到的 `.mjs` 脚本名册）与 `shapes`（每种形状的枚数）由**同一趟**扫描给出：
 * 地板若由第二趟循环另算，那一趟自己就是 KI-342 那一族的病。
 *
 * @param {{file: string, text: string}[]} files 源码（路径用 `/` 分隔，相对仓库根）
 * @param {{declared?: Set<string>}} [opts] `declared` ＝ 仓库内 `.d.mts` 路径的集合；不传 ⇒ 一律算未声明
 * @returns {{findings: {kind: string, file: string, line: number, spec: string | null, target: string | null, decl?: string, text?: string}[], refs: number, targets: string[], shapes: Record<string, number>}}
 */
export function importCensus(files, opts = {}) {
  const declared = opts.declared ?? new Set()
  const findings = []
  const targets = new Set()
  const shapes = {}
  let refs = 0
  for (const f of files) {
    for (const r of moduleRefsOf(f.text, f.file)) {
      refs++
      shapes[r.shape] = (shapes[r.shape] ?? 0) + 1
      if (r.shape === 'opaque') {
        findings.push({ kind: 'opaque', file: f.file, line: r.line, spec: null, target: null, text: r.text.slice(0, OPAQUE_TEXT_LEN) })
        continue
      }
      const target = resolveLocal(r.spec, f.file)
      if (r.shape !== 'static' && r.shape !== 'dynamic')
        findings.push({ kind: 'dodge', file: f.file, line: r.line, spec: r.spec, target })
      if (!isLocalSpecifier(r.spec) || !r.spec.endsWith(SCRIPT_EXT) || target === null) continue
      targets.add(target)
      const decl = `${target.slice(0, -SCRIPT_EXT.length)}${DECL_EXT}`
      if (!declared.has(decl))
        findings.push({ kind: 'undeclared', file: f.file, line: r.line, spec: r.spec, target, decl })
    }
  }
  return { findings, refs, targets: [...targets].sort(), shapes }
}

