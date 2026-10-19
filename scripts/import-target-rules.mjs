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
 */
import { scanSkeleton } from './event-rules.mjs'

/** `@/` 别名的根（与 `tsconfig.json > compilerOptions.paths` 对齐） */
export const ALIAS_PREFIX = '@/'
export const ALIAS_ROOT = 'src'

/**
 * 解析一个本地说明符时的候选落点（按这个顺序试，第一个存在的算它）。
 *
 * `.json` 在列：`tsconfig.json` 开着 `resolveJsonModule`，而 `src/data/index.ts` 把二十多张数据表
 * 直接 import 进来——不试这一条，那些 import 全会被判成"磁盘上不存在"。
 */
export const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.json', '/index.ts', '/index.tsx']

/**
 * 从源码文本里抽出所有**模块说明符**（含 import / export-from / 动态 import）。
 *
 * 注释先由 `scanSkeleton` 涂白（长度与换行数不变 ⇒ 行号仍对得上），
 * 字符串原样保留——说明符本身就在字符串里。
 *
 * @param {string} src
 * @returns {{spec: string, line: number}[]}
 */
export function importSpecifiers(src) {
  // 复用 `scripts/event-rules.mjs` 的词法骨架：它把注释涂白、**并标出字符串体内**（`inString`）。
  // 字符串里的散文（`const doc = "import { X } from '@/x'"`）必须被跳过——说明符只在代码上下文里才算。
  const { code, inString } = scanSkeleton(src)
  const out = []
  const push = (spec, index) => {
    if (!spec) return
    if (inString[index]) return // 这段说明符落在某个字符串体内 ⇒ 它是散文，不是 import
    out.push({ spec, line: lineOf(code, index) })
  }
  // `from '…'`（import 与 export-from 共用）
  for (const m of code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) push(m[1], m.index)
  // 侧效 import：`import '…'`
  for (const m of code.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) push(m[1], m.index)
  // 动态 import：`import('…')` —— `main.ts` 里那批 `await import('@/vfx/…')` 正是这一族
  for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) push(m[1], m.index)
  return out
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
    for (const { spec, line } of importSpecifiers(f.text)) {
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
  // 路径分隔符统一成 `/`：调用方给 Windows 的 `\` 还是 POSIX 的 `/` 都一样（不统一的话
  // `src\ai\AISystem.ts` 里的 `./Enemy` 会被解析成仓库根下的 `Enemy`——一个"看起来存在"的错答案）
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

/** 行号（1 起） */
function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++
  return line
}

/**
 * 把块注释与行注释的**体**涂白（长度与换行数不变 ⇒ 行号继续对得上）。
 *
 * 与 `scripts/event-rules.mjs` 的 `scanSkeleton` 同一形状，但这里只需要"注释别被当代码"，
 * 字符串要原样留着（说明符就在字符串里）。自己实现一份是为了这一格不依赖另一格的文件布局。
 */
export function blankComments(src) {
  const out = src.split('')
  let state = 'code'
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; out[i] = ' '; out[i + 1] = ' '; i++; continue }
      if (c === '/' && n === '*') { state = 'block'; out[i] = ' '; out[i + 1] = ' '; i++; continue }
      if (c === "'" || c === '"' || c === '`') { state = c; continue }
      continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; continue }
      out[i] = ' '
      continue
    }
    if (state === 'block') {
      if (c === '*' && n === '/') { out[i] = ' '; out[i + 1] = ' '; i++; state = 'code'; continue }
      if (c !== '\n') out[i] = ' '
      continue
    }
    // 字符串体内：只看有没有被反斜杠转义
    if (c === '\\') { i++; continue }
    if (c === state) state = 'code'
  }
  return out.join('')
}
