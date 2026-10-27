/**
 * scripts/head-compiles-rules.mjs — 「主干自证」那道门的判据（纯函数 ＋ 一个可独立跑的入口）。
 *
 * 立的不是风格，是 KI-123／KI-125／KI-323 那一族：**主干在编译层是断的，而机器级
 * pre-commit 钩子却绿着**。钩子跑的是 `npm run lint` ＝ `tsc --noEmit`，量的却是
 * **工作树**不是**暂存区** ⇒ 一份文件可以以编译不过的状态被提交，而工作树上留着
 * 编译得过的那一份。KI-323 实测过这个形状：`HEAD` 上 12 条 tsc 红全部住在
 * `tests/flow/KI-320-damage-formula.test.ts` 一个文件里（死导入 ×8、整行未用 ×2、
 * 两个压根不存在的名字 ×2），而钩子当时是绿的。
 *
 * 为什么不用「git worktree ＋ 跑 tsc」那种量法（KI-123／KI-125／KI-321 都用过）：
 * ① **它要一份依赖**（`node_modules`），而给平面挂 junction ＋ `git worktree remove
 * --force` 这套组合**会顺着 junction 把目标目录删空**（KI-323 那批踩过，本机
 * `node_modules` 被删空过一次）；② 它是**子进程**，跑一趟要几十秒，而且量的是"平面上的
 * 字节"，与"主干此刻的字节"之间隔着一层复制。
 *
 * 这一份的做法：**用 TypeScript 的 compiler API，把某一棵提交树的 blob 当作源文件的字节喂进去**。
 * - 根文件名用**仓库里的真路径**（`…/src/…`）⇒ 模块解析照常走真 `node_modules`，
 *   不需要给平面造一份依赖；
 * - 编译器宿主只把**内容**换成那棵树的 blob（`getSourceFile` / `readFile`）⇒ 量到的
 *   就是「那一棵树上此刻那一份字节」；
 * - 没被 git 跟踪的文件**照读工作树**（它们不在树上，不该参与那棵树的编译裁决）。
 *
 * **两棵树都认**：`HEAD`（主干自证：新克隆能不能自证）与**暂存区**（落库前：将要提交的
 * 那一堆字节能不能自证）。后者是**预防性**的那一半——KI-323 的病根就是"钩子量工作树不量
 * 暂存区"，量暂存区才能在那一批落库**之前**把它拦下来。
 *
 * ---
 *
 * ## 一份读数曾经是假的（这扇门自己犯过一次，留在这里当反面教材）
 *
 * 第一版用 `execFileSync(..., { encoding: 'utf8' })` 接 `git cat-file --batch`，然后拿
 * header 里的 **size（字节数）**去切那个**已解码的字符串**。中文源码里一个字符占 3 字节，
 * 于是每切一份 blob 都会多切进下一份的 header，第一版实测：`files=448 blobs=1` ——
 * **448 份里只读回来 1 份**，其余 447 份在编译时**悄悄从磁盘读**。
 * 门于是"量的是工作树，报的是主干绿"——正是它本该抓的那一族形状，它自己长成了那个形状。
 *
 * 现在两处都钉死：① `cat-file` 的输出按 **Buffer** 接（字节下标才作数），切完再转 utf8；
 * ② blob 与请求**按下标配对**（`cat-file --batch` 的输出顺序＝请求顺序，header 里**没有**
 * 路径），不再从 header 里猜路径。
 *
 * 并且这条不是靠"读起来对"来保证的：**报告里带 `served` / `trackedMissed` 两个读数**——
 * `trackedMissed` 恒为 0 才算"树上每一份字节都被喂进去了"，否则这扇门当场说自己是假的。
 *
 * @see tests/unit/head-compiles.test.ts
 */

import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 关心的后缀：源码（`.ts`／`.tsx`／`.mts`／`.cts`）＋ 数据（`resolveJsonModule` 会把 JSON 拉进程序里）。
 *
 * **`.mts`／`.cts` 不能漏**：仓库里 `scripts/*.d.mts` 那 25 份声明文件是**测试 import
 * `scripts/*-rules.mjs` 时被 TypeScript 解析出来的**——它们不在清单里，编译器就会去磁盘上
 * 找它们，于是那一读数里混进了工作树的字节（第一次跑这扇门时 `leaked` 量到 24，就是这 24 份）。
 */
const WANTED_EXT = /\.(ts|tsx|mts|cts|json)$/

/**
 * @typedef {{ files: string[], blobs: Map<string, string>, ok: boolean, why: string }} CommitTree
 * @typedef {{ file: string, line: number, code: number, text: string }} CompileDiagnostic
 */

/**
 * 一次 `git cat-file --batch` 读回 N 份 blob。
 *
 * **输出按 Buffer 接**（字节下标才作数，见文件头那段反面教材）：header 形如
 * `<40 位 sha> blob <字节数>`，随后是原始字节与一个换行。**header 里没有路径**——
 * blob 与请求**按下标配对**（`--batch` 的输出顺序＝请求顺序）。
 *
 * @param {string} root 仓库根
 * @param {string[]} requests 请求串（`HEAD:path` 或裸 sha）
 * @param {NodeJS.ProcessEnv} [env] 子进程环境
 * @returns {string[]} 与 `requests` 同序的内容（读不到的那份是空串）
 */
function catFileBatch(root, requests, env) {
  if (requests.length === 0) return []
  const raw = execFileSync('git', ['cat-file', '--batch'], {
    cwd: root,
    input: requests.join('\n') + '\n',
    maxBuffer: 1 << 26,
    env,
  })
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8')
  const bodies = []
  let i = 0
  while (i < buf.length && bodies.length < requests.length) {
    const nl = buf.indexOf(0x0a, i)
    if (nl < 0) break
    const header = buf.subarray(i, nl).toString('utf8')
    const m = /^([0-9a-f]{40}) (blob) (\d+)$/.exec(header)
    if (!m) {
      // 读不到对象时 git 印的是 `<请求> missing`；跳过这一段继续往下切
      i = nl + 1
      continue
    }
    const size = Number(m[3])
    bodies.push(buf.subarray(nl + 1, nl + 1 + size).toString('utf8'))
    i = nl + 1 + size + 1
  }
  while (bodies.length < requests.length) bodies.push('')
  return bodies
}

/**
 * 读 HEAD 的树与 blob（**主干自证**那一棵）。
 *
 * **为什么不用 `git show` 逐份读**：那一条会撞 `spawnSync` 的 1 MiB 缓冲上限（KI-323
 * 那条红就是这个形状：账本涨过 1 MiB 之后 `git show HEAD:docs/KNOWN_ISSUES.md` 直接
 * `ENOBUFS`）。这里用 `git cat-file --batch` 一次读完所有 blob。
 *
 * @param {string} root 仓库根
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {CommitTree}
 */
export function readHeadTree(root, opts = {}) {
  const env = opts.env ?? process.env
  let list = ''
  try {
    const raw = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD'], {
      cwd: root,
      maxBuffer: 1 << 26,
      env,
    })
    list = (Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8')).toString('utf8')
  } catch (e) {
    return { files: [], blobs: new Map(), ok: false, why: `git ls-tree 跑不起来：${String(e.message).slice(0, 160)}` }
  }
  const files = list.split('\0').filter((n) => n.length > 0 && WANTED_EXT.test(n)).sort()
  if (files.length === 0) return { files: [], blobs: new Map(), ok: false, why: 'HEAD 的树读空了' }

  let bodies
  try {
    bodies = catFileBatch(root, files.map((f) => `HEAD:${f}`), env)
  } catch (e) {
    return { files: [], blobs: new Map(), ok: false, why: `git cat-file --batch 跑不起来：${String(e.message).slice(0, 160)}` }
  }
  const blobs = new Map()
  files.forEach((f, i) => {
    if (bodies[i]) blobs.set(f, bodies[i])
  })
  if (blobs.size === 0) return { files: [], blobs: new Map(), ok: false, why: 'cat-file 一份 blob 也没读回来' }
  if (blobs.size < files.length) {
    return {
      files: [],
      blobs: new Map(),
      ok: false,
      why: `树上 ${files.length} 份只读回 ${blobs.size} 份 blob ⇒ 这一读数不完整，不许当干净`,
    }
  }
  return { files, blobs, ok: true, why: '' }
}

/**
 * 读**暂存区**的树与 blob（**落库前**那一棵）。
 *
 * 用 `git ls-files -s` 拿"将要提交的那一堆字节"的 sha，再用 `cat-file --batch` 取内容。
 * **没被 `git add` 的文件不在其中** —— 这正是它与工作树的分界：工作树里那些还没入暂存区
 * 的改动**不参与**这次裁决（它们还没打算落库）。
 *
 * `opts.indexFile` 指定一份**旁挂的索引文件**（`GIT_INDEX_FILE`）——测试用它造一份
 * **与真索引无关**的假暂存区，于是"暂存区里有坏字节"这件事可以在不碰真索引的前提下
 * 被验一遍。
 *
 * @param {string} root 仓库根
 * @param {{ env?: NodeJS.ProcessEnv, indexFile?: string }} [opts]
 * @returns {CommitTree}
 */
export function readIndexTree(root, opts = {}) {
  const base = opts.env ?? process.env
  const env = opts.indexFile ? { ...base, GIT_INDEX_FILE: opts.indexFile } : base
  let raw
  try {
    raw = execFileSync('git', ['ls-files', '-s', '-z'], { cwd: root, maxBuffer: 1 << 26, env })
  } catch (e) {
    return { files: [], blobs: new Map(), ok: false, why: `git ls-files 跑不起来：${String(e.message).slice(0, 160)}` }
  }
  const text = (Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8')).toString('utf8')
  /** @type {Array<{ path: string, sha: string, stage: string }>} */
  const entries = []
  for (const chunk of text.split('\0')) {
    if (!chunk) continue
    const tab = chunk.indexOf('\t')
    if (tab < 0) continue
    const meta = chunk.slice(0, tab).split(' ')
    if (meta.length < 3) continue
    entries.push({ path: chunk.slice(tab + 1), sha: meta[1], stage: meta[2] })
  }
  // stage>0 = 合并冲突中（那份索引提交不了）；只取 stage 0
  const picked = entries
    .filter((e) => e.stage === '0' && WANTED_EXT.test(e.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  if (picked.length === 0) return { files: [], blobs: new Map(), ok: false, why: '暂存区读空了' }

  let bodies
  try {
    bodies = catFileBatch(root, picked.map((e) => e.sha), env)
  } catch (e) {
    return { files: [], blobs: new Map(), ok: false, why: `git cat-file --batch 跑不起来：${String(e.message).slice(0, 160)}` }
  }
  const blobs = new Map()
  picked.forEach((e, i) => {
    if (bodies[i]) blobs.set(e.path, bodies[i])
  })
  if (blobs.size < picked.length) {
    return {
      files: [],
      blobs: new Map(),
      ok: false,
      why: `暂存区 ${picked.length} 份只读回 ${blobs.size} 份 blob ⇒ 这一读数不完整，不许当干净`,
    }
  }
  return { files: picked.map((e) => e.path), blobs, ok: true, why: '' }
}

/**
 * 那一棵树的**源码根**：树里 `src/` 与 `tests/` 下的 `.ts`／`.tsx`。
 *
 * 用**树的清单**而不是磁盘的清单：这一门问的是"那一棵树编译不过吗"，没入树的新文件
 * 不该参与裁决（而它们在磁盘上——工作树里那份已经修好了，正是钩子被骗的那个形状）。
 *
 * @param {CommitTree} tree
 * @param {string} root 仓库根
 * @returns {string[]} 仓库里的绝对路径
 */
export function sourceRoots(tree, root) {
  return tree.files
    .filter((f) => f.startsWith('src/') || f.startsWith('tests/'))
    .filter((f) => /\.(ts|tsx|mts|cts)$/.test(f))
    .map((f) => join(root, f))
}

/**
 * 读编译选项（与 `npm run lint` 用的是同一份 tsconfig ⇒ 两道门量的是同一把尺）。
 *
 * **tsconfig 也从树里读**（若树里有它）：否则"主干改了 tsconfig 而门还量着工作树那份"
 * 就是这条门自己的 KI-323。
 *
 * @param {string} root
 * @param {CommitTree} [tree]
 * @returns {{ options: unknown, error?: string }}
 */
export function readCompilerOptions(root, tree) {
  const cfgPath = join(root, 'tsconfig.json')
  const rel = 'tsconfig.json'
  const blob = tree?.blobs.get(rel)
  const readFile = (p) => {
    if (p === cfgPath || p.endsWith('tsconfig.json')) {
      if (blob !== undefined) return blob
      try {
        return readFileSync(p, 'utf8')
      } catch {
        return undefined
      }
    }
    return undefined
  }
  const raw = ts.readConfigFile(cfgPath, readFile)
  if (raw.error) {
    const msg = ts.flattenDiagnosticMessageText(raw.error.messageText, ' ')
    return { options: undefined, error: `tsconfig.json 读不动：${msg}` }
  }
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, root)
  const fatal = (parsed.errors ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error && d.code !== 18003,
  )
  if (fatal.length > 0) {
    return {
      options: undefined,
      error: `tsconfig.json 解析报错：${fatal.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ')}`,
    }
  }
  return { options: { ...parsed.options, noEmit: true } }
}

/**
 * **那一棵树的编译裁决**：把树上的字节喂给 tsc，量它编译不过几处。
 *
 * @param {string} root 仓库根
 * @param {{ tree?: CommitTree }} [opts] 注入树（测试用）
 * @returns {{ ok: boolean, why: string, diagnostics: CompileDiagnostic[], checked: number, served: number, trackedMissed: number, leaked: number }}
 */
export function treeCompileErrors(root, opts = {}) {
  const tree = opts.tree ?? readHeadTree(root)
  if (!tree.ok) {
    return { ok: false, why: tree.why, diagnostics: [], checked: 0, served: 0, trackedMissed: 0, leaked: 0 }
  }

  const roots = sourceRoots(tree, root)
  if (roots.length === 0) {
    return {
      ok: false,
      why: '树里没有 src/tests 的 .ts 文件 ⇒ 总体读空',
      diagnostics: [],
      checked: 0,
      served: 0,
      trackedMissed: 0,
      leaked: 0,
    }
  }

  const { options, error } = readCompilerOptions(root, tree)
  if (!options) {
    return {
      ok: false,
      why: error ?? '编译选项读不到',
      diagnostics: [],
      checked: 0,
      served: 0,
      trackedMissed: 0,
      leaked: 0,
    }
  }

  const host = ts.createCompilerHost(options, false)
  const origGetSourceFile = host.getSourceFile.bind(host)
  const origReadFile = host.readFile.bind(host)
  const origFileExists = host.fileExists.bind(host)

  /** 真路径 → 仓库相对路径（POSIX 斜杠，与 git 的清单同形） */
  const relOf = (fileName) => relative(root, resolve(root, fileName)).split('\\').join('/')
  /** 树上文件的大小写无关索引：模块解析出来的路径大小写未必与清单逐字相同 */
  const lowerIndex = new Map()
  for (const [p] of tree.blobs) lowerIndex.set(p.toLowerCase(), p)
  /** **清单**（`files`）的大小写无关索引：清单是"这一棵树有哪些文件"的唯一口径 */
  const manifestIndex = new Set(tree.files.map((p) => p.toLowerCase()))
  /**
   * 三个诚实读数（这一扇门必须能说出"我到底量了什么"）：
   * - `served`：**从树上喂进去**的源文件份数；
   * - `trackedMissed`：清单里有、编译器来要、却**没能从树上喂进去**的份数（恒为 0）；
   * - `leaked`：编译器来要、**清单里没有**、又住在仓库里（不是 node_modules）的份数
   *   ——那是**工作树漏进来的字节**：树不是自足的（"新克隆能不能自证"）。
   */
  const missed = new Set()
  const leaked = new Set()
  let served = 0

  /** 找树上那一份：先逐字找，再按大小写无关找 */
  const blobOf = (fileName) => {
    const rel = relOf(fileName)
    const exact = tree.blobs.get(rel)
    if (exact !== undefined) return exact
    const lower = lowerIndex.get(rel.toLowerCase())
    if (lower !== undefined) return tree.blobs.get(lower)
    return undefined
  }
  /** 这条路径是不是"住在仓库里、却不在清单上"（node_modules 与仓库外的文件不算） */
  const isWorkingTreeLeak = (fileName) => {
    const rel = relOf(fileName)
    if (rel.startsWith('..')) return false
    if (rel.includes('node_modules/')) return false
    return !manifestIndex.has(rel.toLowerCase())
  }

  host.readFile = (fileName) => {
    const blob = blobOf(fileName)
    if (blob !== undefined) return blob
    return origReadFile(fileName)
  }
  host.fileExists = (fileName) => {
    const rel = relOf(fileName)
    if (tree.blobs.has(rel) || lowerIndex.has(rel.toLowerCase())) return true
    return origFileExists(fileName)
  }
  /** 源码文件缓存：同份别造两次（`getSourceFile` 会被反复问） */
  const sourceCache = new Map()
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const blob = blobOf(fileName)
    if (blob === undefined) {
      const rel = relOf(fileName)
      if (manifestIndex.has(rel.toLowerCase())) missed.add(rel)
      else if (isWorkingTreeLeak(fileName)) leaked.add(rel)
      return origGetSourceFile(fileName, languageVersion, onError, shouldCreate)
    }
    served++
    const cached = sourceCache.get(fileName)
    if (cached) return cached
    // `setParentNodes=false`：**与 `npm run lint`（tsc）同一把尺**——tsc 用的也是 false，
    // 两道门若用不同的尺，同一份字节可能给出不同的裁决，那这道门就量不准。
    const sf = ts.createSourceFile(fileName, blob, languageVersion, false)
    sourceCache.set(fileName, sf)
    return sf
  }

  const program = ts.createProgram({ rootNames: roots, options, host })
  const diags = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
  ]

  /** @type {CompileDiagnostic[]} */
  const out = []
  for (const d of diags) {
    if (d.category !== ts.DiagnosticCategory.Error) continue
    const file = d.file ? relOf(d.file.fileName) : '(程序级)'
    const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0
    out.push({
      file,
      line,
      code: d.code,
      text: ts.flattenDiagnosticMessageText(d.messageText, ' '),
    })
  }
  out.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))

  if (missed.size > 0) {
    // 清单里有却从磁盘读了几份 ⇒ 这一读数掺了工作树的字节，不许当"那一棵树"的读数
    return {
      ok: false,
      why: `清单里 ${missed.size} 份没能喂进去（落到了磁盘上）：${[...missed].slice(0, 5).join(' ')}`,
      diagnostics: out,
      checked: roots.length,
      served,
      trackedMissed: missed.size,
      leaked: leaked.size,
    }
  }
  if (leaked.size > 0) {
    // 编译器来要、清单里没有、又住在仓库里 ⇒ 这一棵树不自足（新克隆会缺件）
    return {
      ok: false,
      why: `这一棵树不自足：${leaked.size} 份工作树里的文件被算了进来：${[...leaked].slice(0, 5).join(' ')}`,
      diagnostics: out,
      checked: roots.length,
      served,
      trackedMissed: 0,
      leaked: leaked.size,
    }
  }
  return {
    ok: out.length === 0,
    why: '',
    diagnostics: out,
    checked: roots.length,
    served,
    trackedMissed: 0,
    leaked: 0,
  }
}

/**
 * 命令行入口：`node scripts/head-compiles-rules.mjs [--index]`。
 *
 * - 不带参数 ⇒ 量 **HEAD**（主干自证：主干此刻编译不过几处）。
 * - 带 `--index` ⇒ 量**暂存区**（落库前：将要提交的那一堆字节编译不过几处）。
 *
 * **退出码是这里的裁决**（0 = 那一棵树上编译得过；1 = 编译不过，红消息逐条点名）。
 *
 * @returns {number} 退出码
 */
export function main() {
  const useIndex = process.argv.includes('--index')
  const label = useIndex ? '暂存区' : '主干(HEAD)'
  const r = treeCompileErrors(ROOT, useIndex ? { tree: readIndexTree(ROOT) } : {})
  if (!r.ok && r.why !== '') {
    console.error(`[head-compiles] 这道门没跑成（不是"干净"）：${r.why}`)
    return 1
  }
  if (r.diagnostics.length === 0) {
    console.log(
      `[head-compiles] ${label}自证：${r.checked} 份源码编译通过，0 条红` +
        `（喂进去 ${r.served} 份树上字节，漏 ${r.trackedMissed} 份，漏进来的工作树字节 ${r.leaked} 份）。`,
    )
    return 0
  }
  console.error(`[head-compiles] ${label}编译不过 —— ${r.diagnostics.length} 条：`)
  for (const d of r.diagnostics.slice(0, 60)) {
    console.error(`  ${d.file}:${d.line}  TS${d.code}  ${d.text}`)
  }
  if (r.diagnostics.length > 60) console.error(`  …另有 ${r.diagnostics.length - 60} 条`)
  return 1
}

if (process.argv[1] && existsSync(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main())
}
