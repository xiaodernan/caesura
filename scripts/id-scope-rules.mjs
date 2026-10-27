/**
 * scripts/id-scope-rules.mjs — 「按号这一族读的是哪片总体」这一格（KI-329，2026-10-28）
 *
 * **病**：这个仓里同一件东西「总体」有**三份手抄**，而按号这一族的三道门各抄了一份：
 *   - `tests/unit/doc-audit.test.ts` 门 B：「src/tests/scripts/docs 里每一处 KI- 按号引用都必须能在账本读到行」
 *     ——它的走查是「目录 × 后缀」两张手抄清单（`.ts|.tsx|.mjs|.md|.json`）。**后缀清单是手抄的 ⇒ 它会漏**：
 *     `scripts/*.d.mts`（**28 份**）**就在 `scripts/` 里、就在它自己写下的范围内**，却因为后缀不在清单里而**一眼没看**；
 *     根上的**具名散文件**（`vite.config.ts` 等 6 份）也不在它的四棵树里——而 `vite.config.ts` 带着 **2 处** KI- 引用。
 *   - `tests/unit/id-table.test.ts`（KI-326 的号段门）与 `tests/unit/registry-table.test.ts`（KI-327 的门 I2）：
 *     **同一份清单的另两抄**（后缀多了 `.mts`／`.py`，目录还是那四棵）⇒ 读 **521** 份，比交付总体少 6 份（差的是那 6 份根散文件）。
 *   - 而这个仓早就有一份**第一等的总体口径**：`scripts/text-corpus.mjs` 的 `walkTextCorpus`
 *     （四棵树 ＋ 根的具名散文件；按**内容**认二进制；致命 UTF-8 解码）——`text-integrity` 那道门早就骑上它了。
 *
 * **为什么值得单独立行**：一条规则的可信度取决于它的**总体**。判据写着「每一处」，而走查漏了一类后缀，
 * 那句「每一处」就是空话——而**空话不会红**（没看过的引用不会变成红，绿是白送的）。
 *
 * **这一格判四件事**（每件都能被合成夹具喂）：
 *   ① **不许有两份总体**：门实际读到的文件集必须**逐份等于**交付总体（两个方向的差集都空）⇒ 谁再手抄一份清单，这格就红。
 *   ② **洞不许悄悄长大**：已入库却落在交付总体之外的文件，按面积归堆；每一堆都必须**有名字、有理由**
 *      （今天只有 `.scratch`（证据区）与根点文件两堆）⇒ 新加一棵树而忘了登记，这格就红。
 *   ③ **带号的已入库文件不许落在走查面之外**：它要么在交付总体里（被按号规则读到），要么在有名有理由的洞里。
 *   ④ **账本自己引的号也要读得到行**：账本不是读者的例外——它自己引的号若读不到行，读者按号去找账同样扑空；
 *      读不到的那几处必须**逐条登记理由**（名册过期也红），而登记过的号**不许在账本以外被人当现行号引用**。
 *
 * **为什么"判据"住在脚本而不是测试文件里**：与 `*-rules.mjs` 那一族同一个理由——
 * 判据要能被**合成夹具**喂（喂一份假的总体／走查面／已入库名册，看它拒不拒），
 * 真库那一腿才量得到「这是不是真的一道门」而不是「作者试过一次」。
 */

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { decodeUtf8, looksBinary, walkTextCorpus } from './text-corpus.mjs'

/**
 * 按号引用的形状：`KI-` ＋ 数字（**任何位数**）。
 *
 * 这里**不做归一**：归一是替写错的人把号擦掉（KI-326 那道门退役它就是为了这个）。
 * 这一格只问「这份文件有没有按号引用」，位数的裁决归 `scripts/id-rules.mjs` 那道门。
 */
export const CITATION_RE = /\bKI-\d+\b/g

/**
 * 交付总体之外那些「有名字、有理由」的面积（洞要有名 —— 与 `text-corpus.mjs` 的 `ROOT_DOT_FILES` 同一个纪律）。
 *
 * **每一堆都要能回答「谁经过它」**：
 *   - `.scratch`：证据区（变异臂与量具的落地处，**已入库**）。它不是交付件 ⇒「交付总体里只有一套号」这句话管不到它；
 *     判据③盯的是「带按号引用的已入库文件不许落在走查面之外，除非它落在这一堆里」。
 *   - `(根点文件)`：根上的点文件（形状名单在 `text-corpus.mjs` 的 `ROOT_DOT_FILES` 里，各带理由）。
 *     走查对点前缀是瞎的（根循环里那句 `name.startsWith('.')`）⇒ 这些文件天然落在交付总体之外。
 *
 * **根上的具名散文件不在这一堆里**：它们**在**交付总体（根循环收具名文件）⇒ 单独给它们一格
 * `'(根散文件)'` 是为了让「根上的具名文件掉出总体」这件事**红得出来**，而不是被点文件那一格顺带放行。
 */
export const NAMED_HOLES = [
  {
    area: '.scratch',
    why: '证据区：各车道的量具与变异臂落地处（`.scratch/` 下的脚本与日志，**已入库**）。它不是交付件 ⇒ 交付总体那道门管不到它；判据③负责盯住「带按号引用的已入库文件不许落在走查面之外」这一格。',
  },
  {
    area: '(根点文件)',
    why: '根上的点文件（形状名单与理由在 `text-corpus.mjs` 的 `ROOT_DOT_FILES` 里）：机器配置与一次性产物，git 自己读它们；走查对点前缀是瞎的（根循环里那句点前缀判断）⇒ 它们天然落在交付总体之外。',
  },
]

/**
 * 交付总体：四棵树 ＋ 根的具名散文件（口径**出自** `text-corpus.mjs`，不在这里手抄第二份）。
 *
 * 与 `walkTextCorpus` 的差别只有一处：**致命解码**。总体里混进一份不是合法 UTF-8 的文件时，
 * 那份文件的按号引用就**没法读** ⇒ 它必须变成一条可见的读数（`unreadable`），而不是被悄悄跳过。
 *
 * @param {string} root 仓库根（绝对路径）
 * @returns {{ files: {rel: string, text: string}[], unreadable: {rel: string, error: string}[], binaries: string[], missing: string[] }}
 */
export function deliverySurface(root) {
  const { files, binaries, missing } = walkTextCorpus(root)
  const out = []
  const unreadable = []
  for (const f of files) {
    const d = decodeUtf8(f.bytes)
    if (!d.ok) {
      unreadable.push({ rel: f.file, error: d.error })
      continue
    }
    out.push({ rel: f.file, text: d.text })
  }
  return { files: out, unreadable, binaries, missing }
}

/**
 * 已入库的文件名册（`git ls-tree HEAD` ＝ **提交面**）。
 *
 * **为什么取提交面而不是索引**：共享工作树的索引是**各车道共用的**（有人在 staging 区里塞了还没落地的文件，
 * 那份名册就不是"这个仓交出去的东西"）。提交面与工作副本脏不脏无关——这正是本仓好几道门（`event-rules`／
 * `module-loader`／`script-parse`）早就选定的口径。
 *
 * **提交面与工作树要同一个底**：交付总体读的是**工作树**（此刻的文件），所以名册里**此刻不在工作树上的那份**
 * （提交过、但这棵树里没有）单列成 `absent`，不进正文——否则它会变成一个假的"洞"，把判据②红成噪声。
 *
 * **二进制不进这份名册的正文**：二进制没有文本可扫（`text-corpus` 那道门对它们的判据是另一条），
 * 混进来会让「洞的名册」把「有个素材文件」说成「那个面积里的文本没人扫」⇒ 这里把它们单独列出来。
 *
 * @param {string} root 仓库根
 * @returns {{ files: {rel: string, text: string}[], unreadable: {rel: string, error: string}[], binaries: string[], absent: string[], names: string[] }}
 */
export function trackedFiles(root) {
  const raw = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
  const names = raw.split('\0').filter((s) => s.length > 0).map((s) => s.replace(/\\/g, '/'))
  const files = []
  const unreadable = []
  const binaries = []
  const absent = []
  for (const rel of names) {
    let bytes
    try {
      bytes = readFileSync(`${root}/${rel}`)
    } catch (e) {
      absent.push(rel)
      continue
    }
    if (looksBinary(bytes)) {
      binaries.push(rel)
      continue
    }
    const d = decodeUtf8(bytes)
    if (!d.ok) {
      unreadable.push({ rel, error: d.error })
      continue
    }
    files.push({ rel, text: d.text })
  }
  return { files, unreadable, binaries, absent, names }
}

/**
 * 一份文件里带着哪些按号引用（去重、排序）。
 * @param {string} text
 * @returns {string[]}
 */
export function citedIds(text) {
  if (typeof text !== 'string') return []
  return [...new Set([...text.matchAll(CITATION_RE)].map((m) => m[0]))].sort()
}

/**
 * 一份文件落在总体之外时它属于哪一堆（面积名）。
 *
 * - 根上的**点**文件 ⇒ `(根点文件)`（走查对点前缀是瞎的，那是有理由的洞）；
 * - 根上的**具名**文件 ⇒ `(根散文件)`（**没有登记** ⇒ 掉出总体就红，不许被点文件那一格顺带放行）；
 * - 其余按**第一段路径**归堆（`.scratch/x` ⇒ `.scratch`）。
 *
 * @param {string} rel
 * @returns {string}
 */
export function holeArea(rel) {
  if (!rel.includes('/')) {
    const name = rel.startsWith('.') ? '(根点文件)' : '(根散文件)'
    return name
  }
  return rel.split('/')[0]
}

/**
 * 判据①：门实际读到的文件集必须**逐份等于**交付总体（差集两个方向都空）。
 *
 * **为什么两个方向都要**：只查「少读了」会放过「读了总体以外的东西」；只查「多读了」会放过「少读的那份里藏着没登记的号」。
 *
 * @param {{ scanned: string[], surface: string[] }} input
 * @returns {{ key: string, msg: string }[]}
 */
export function populationFindings({ scanned, surface }) {
  const scannedSet = new Set(scanned ?? [])
  const surfaceSet = new Set(surface ?? [])
  const missing = [...surfaceSet].filter((f) => !scannedSet.has(f)).sort()
  const extra = [...scannedSet].filter((f) => !surfaceSet.has(f)).sort()
  const out = []
  if (missing.length) {
    out.push({
      key: '总体对账',
      msg: `交付总体里有 ${missing.length} 份文件这道门**没读**：${missing.slice(0, 12).join(' ')}${missing.length > 12 ? ' …' : ''}`
        + ` ⇒ 「每一处」这句话在这些文件上是空话（没看过的引用不会变成红，绿是白送的）。`
        + `修法：门读的就是交付总体（\`scripts/id-scope-rules.mjs\` 的 \`deliverySurface\`），不许再手抄一份「目录 × 后缀」清单。`,
    })
  }
  if (extra.length) {
    out.push({
      key: '总体对账',
      msg: `这道门读了 ${extra.length} 份交付总体**之外**的文件：${extra.slice(0, 12).join(' ')}${extra.length > 12 ? ' …' : ''}`
        + ` ⇒ 它的总体与交付总体不是同一件东西（两份口径迟早分家）。`,
    })
  }
  return out
}

/**
 * 判据②：已入库却落在交付总体之外的文件，按面积归堆；每一堆都必须**有名字、有理由**
 * （两个方向都要对：没登记的面积红 ＝ 洞在悄悄长大；登记了却不再出现的面积也红 ＝ 登记过期）。
 *
 * @param {{ tracked: string[], surface: string[], holes: {area: string, why: string}[] }} input
 * @returns {{ key: string, msg: string }[]}
 */
export function holeFindings({ tracked, surface, holes }) {
  const surfaceSet = new Set(surface ?? [])
  const outside = (tracked ?? []).filter((f) => !surfaceSet.has(f))
  const counts = new Map()
  for (const f of outside) {
    const area = holeArea(f)
    counts.set(area, (counts.get(area) ?? 0) + 1)
  }
  const declared = new Map((holes ?? []).map((h) => [h.area, h.why]))
  const out = []
  for (const [area, n] of [...counts.entries()].sort()) {
    if (declared.has(area)) continue
    out.push({
      key: '洞的名册',
      msg: `已入库却落在交付总体之外的面积「${area}」有 ${n} 份文件，而名册里没有它的名字`
        + ` ⇒ 洞在悄悄长大（那个面积里的按号引用没人读、那条文本没人扫）。`
        + `修法：把它登记进 \`NAMED_HOLES\` 并写清「谁经过它」，或者把它接进交付总体（\`CORPUS_DIRS\`）。`,
    })
  }
  for (const [area, why] of declared) {
    if (counts.has(area)) continue
    out.push({
      key: '洞的名册',
      msg: `名册登记了洞「${area}」（理由：${why.slice(0, 60)}…），而它今天**一份文件都没有**`
        + ` ⇒ 登记过期了（要么那个面积被搬走了，要么它被接进了交付总体——两种都得改登记）。`,
    })
  }
  return out
}

/**
 * 判据③：带着按号引用的已入库文件，不许落在走查面之外（除非落在有名有理由的洞里）。
 *
 * @param {{ tracked: {rel: string, text: string}[], scanned: string[], holes: {area: string, why: string}[] }} input
 * @returns {{ key: string, msg: string }[]}
 */
export function carrierFindings({ tracked, scanned, holes }) {
  const scannedSet = new Set(scanned ?? [])
  const declared = new Set((holes ?? []).map((h) => h.area))
  const out = []
  for (const f of tracked ?? []) {
    const ids = citedIds(f.text)
    if (!ids.length) continue
    if (scannedSet.has(f.rel)) continue
    const area = holeArea(f.rel)
    if (declared.has(area)) continue
    out.push({
      key: `按号引用 · ${f.rel}`,
      msg: `这份**已入库**的文件带着按号引用（${ids.slice(0, 6).join(' ')}），却不在按号这道门的走查面里`
        + ` ⇒ 读者按号去找账，这条引用既没人检查也没人看见。`
        + `修法：把它接进交付总体，或者给它的面积一个名字（\`NAMED_HOLES\` ＋ 谁经过它）。`,
    })
  }
  return out
}

/**
 * 判据④：账本自己引的号也要读得到行；读不到的那几处必须**逐条登记理由**，
 * 而登记过的号**不许在账本以外被人当现行号引用**。
 *
 * **为什么这一格独立于门 B**：门 B 此前把账本自己排除在走查面之外（`SELF`）⇒
 * 账本那两处读不到行的引用（一个被挪过的旧号、一个臂的叙述里编出来的号）**从来没人判过**——
 * 「读者按号去找账」这件事，账本自己也是读者。
 *
 * @param {{ ledgerText: string, rowIds: string[], exempt: {token: string, why: string}[], ledgerRel: string, registerRel: string, surfaceFiles: {rel: string, text: string}[] }} input
 * @returns {{ key: string, msg: string }[]}
 */
export function ledgerSelfFindings({ ledgerText, rowIds, exempt, ledgerRel, registerRel, surfaceFiles }) {
  const out = []
  const rows = new Set(rowIds ?? [])
  const exemptions = exempt ?? []
  const exemptTokens = new Set(exemptions.map((e) => e.token))
  const cited = citedIds(ledgerText)
  for (const token of cited) {
    if (rows.has(token)) continue
    if (exemptTokens.has(token)) continue
    out.push({
      key: `账本自引 · ${token}`,
      msg: `账本自己引着 ${token}，而正册里读不到那一行 ⇒ 读者按号去找账扑空（账本不是读者的例外）。`
        + `修法：把它改成今天真正在册的那个号；若它指的是一笔已退役的旧号，登记进「账本自引豁免名册」（附理由）。`,
    })
  }
  for (const e of exemptions) {
    if (typeof e?.why !== 'string' || e.why.length < 40) {
      out.push({
        key: `账本自引 · ${e?.token ?? '(无名)'}`,
        msg: `豁免名册里 ${e?.token ?? '(无名)'} 这一格的理由短到说不出它为什么读不到行`
          + ` ⇒ 这一格在给一笔没人认领的悬空引用发通行证。`,
      })
    }
    if (!cited.includes(e?.token)) {
      out.push({
        key: `账本自引 · ${e?.token}`,
        msg: `豁免名册里 ${e?.token} 这一格登记了，可账本今天**根本没引它** ⇒ 登记过期了（该删）。`,
      })
    }
    if (rows.has(e?.token)) {
      out.push({
        key: `账本自引 · ${e?.token}`,
        msg: `豁免名册里 ${e?.token} 这一格登记为「读不到行」，而正册里现在**读得到**那一行 ⇒ 登记过期了（该删）。`,
      })
    }
    for (const f of surfaceFiles ?? []) {
      if (f.rel === ledgerRel || f.rel === registerRel) continue
      if (!citedIds(f.text).includes(e?.token)) continue
      out.push({
        key: `账本自引 · ${e?.token}`,
        msg: `${e?.token} 是一笔**读不到行**的悬空引用（豁免名册里登记得清清楚楚），而 ${f.rel} 把它当现行号在用`
          + ` ⇒ 有人按一个空号去找账。修法：改成它今天真正的号。`,
      })
    }
  }
  return out
}

/**
 * 四条判据的合流（调用方只需要一个入口）。
 * @param {{ scanned: string[], surface: string[], tracked: {rel: string, text: string}[], holes: {area: string, why: string}[], ledgerText?: string, rowIds?: string[], exempt?: {token: string, why: string}[], ledgerRel?: string, registerRel?: string }} input
 * @returns {{ key: string, msg: string }[]}
 */
export function scopeFindings({ scanned, surface, tracked, holes, ledgerText, rowIds, exempt, ledgerRel, registerRel }) {
  const trackedNames = (tracked ?? []).map((f) => f.rel)
  return [
    ...populationFindings({ scanned, surface }),
    ...holeFindings({ tracked: trackedNames, surface, holes }),
    ...carrierFindings({ tracked, scanned, holes }),
    ...ledgerSelfFindings({ ledgerText, rowIds, exempt, ledgerRel, registerRel, surfaceFiles: tracked }),
  ]
}

/* ───────────────────────── 判据⑤：总体只有一个出处 ───────────────────────── */

/**
 * 按号判据里**吃文件总体**的那两个入口（它们收的那个 `files` 就是总体本身）。
 *
 * 另两个入口（`scopeFindings`／`ledgerSelfFindings`）收的是别的形状，不在这里点名。
 */
export const GATE_ENTRIES = ['retiredSpellingFindings', 'idReferenceFindings']

/** `const 名字 = 右值` 的绑定（右值只取同一行；带行尾注释的剥掉） */
function constBindings(text) {
  const map = new Map()
  for (const m of text.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/gm)) {
    const rhs = m[2].replace(/\s*\/\/.*$/, '').trim()
    if (!map.has(m[1])) map.set(m[1], [])
    map.get(m[1]).push({ rhs, pos: m.index })
  }
  return map
}

/** 标识符的形状 */
const IDENT = /^[A-Za-z_$][\w$]*$/
/** `<标识符>.files` 的形状 */
const MEMBER_FILES = /^([A-Za-z_$][\w$]*)\.files$/

/**
 * 一个右值的来源分类：
 *   'total'   —— 交付总体（`deliverySurface(root).files` 或它的别名）
 *   'fixture' —— 当场拼出来的合成夹具（`[{ rel, text }, …]`）
 *   'unknown' —— 第三样东西（自己抄了一份总体）⇒ 红
 *
 * **按位置解析**：同名变量在不同作用域里指的是不同的东西（真库腿用交付总体、夹具腿用当场拼的数组），
 * 所以绑定表带位置，取**离调用点最近的那一个在前**的那个。
 */
function classifySource(rhs, bindings, at, seen = new Set()) {
  const e = rhs.trim()
  if (seen.has(e)) return 'unknown'
  const nextSeen = new Set(seen)
  nextSeen.add(e)
  if (/^\[\s*\{/.test(e)) return 'fixture'
  // `deliverySurface(root).files` —— 与「先存成 surface 再取 .files」是同一件东西，只是少一个中间变量。
  if (/^deliverySurface\s*\([^()]*\)\s*\.files$/.test(e)) return 'total'
  const member = MEMBER_FILES.exec(e)
  if (member) {
    const base = member[1]
    for (const b of [...(bindings.get(base) ?? [])].sort((x, y) => y.pos - x.pos)) {
      if (b.pos >= at) continue
      if (/^deliverySurface\s*\(/.test(b.rhs)) return 'total'
      const c = classifySource(b.rhs, bindings, b.pos, nextSeen)
      if (c !== 'unknown') return c
    }
    return 'unknown'
  }
  if (IDENT.test(e)) {
    for (const b of [...(bindings.get(e) ?? [])].sort((x, y) => y.pos - x.pos)) {
      if (b.pos >= at) continue
      const c = classifySource(b.rhs, bindings, b.pos, nextSeen)
      if (c !== 'unknown') return c
    }
    return 'unknown'
  }
  if (/^\[\s*[A-Za-z_$]/.test(e)) {
    const inner = e.slice(1, -1)
    const first = inner.split(',')[0].trim()
    if (first.startsWith('{')) return 'fixture'
    if (IDENT.test(first)) {
      for (const b of [...(bindings.get(first) ?? [])].sort((x, y) => y.pos - x.pos)) {
        if (b.pos >= at) continue
        if (b.rhs.trim().startsWith('{')) return 'fixture'
      }
    }
    return 'unknown'
  }
  return 'unknown'
}

/**
 * 一个文件里"喂给按号判据的文件集"从哪儿来。
 *
 * 两种合法来源：**交付总体**（`deliverySurface(root).files`）与**当场拼出来的合成夹具**；
 * 第三样东西（自己抄的一份目录 × 后缀清单）⇒ 红。
 *
 * @param {string} text 文件全文
 * @returns {{ expr: string, kind: string, pos: number }[]} 总体取用点
 */
export function populationSites(text) {
  if (typeof text !== 'string') return []
  const out = []
  // ① 判据入口的 `files:` 实参（**调用**，不是函数声明）
  for (const entry of GATE_ENTRIES) {
    const re = new RegExp(`\\b${entry}\\s*\\(\\s*\\{([^}]*)\\}`, 'g')
    for (const m of text.matchAll(re)) {
      const before = text.slice(Math.max(0, m.index - 24), m.index)
      if (/\bfunction\s*$/.test(before)) continue
      const body = m[1]
      const fm = /\bfiles\s*:\s*([A-Za-z_$][\w$.]*)/.exec(body)
      if (fm) {
        out.push({ expr: fm[1], kind: entry, pos: m.index })
        continue
      }
      if (/(?:^\s*|[{,]\s*)files\s*(?:[,}])/.test(body)) out.push({ expr: 'files', kind: entry, pos: m.index })
    }
  }
  // ② 自己扫按号引用的循环（`for (const f of X)` 里出现 `.text.matchAll(/KI-`）
  for (const m of text.matchAll(/for\s*\(\s*(?:const|let)\s+[A-Za-z_$][\w$]*\s+of\s+([A-Za-z_$][\w$.]*)\s*\)/g)) {
    const braceAt = text.indexOf('{', m.index)
    if (braceAt < 0) continue
    let depth = 0
    let end = -1
    for (let i = braceAt; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') {
        depth--
        if (depth === 0) { end = i; break }
      }
    }
    const body = text.slice(braceAt, end < 0 ? text.length : end)
    if (!/\.text\.matchAll\(\s*\/KI-/.test(body)) continue
    out.push({ expr: m[1], kind: '自扫引用的循环', pos: m.index })
  }
  return out
}

/**
 * 判据⑤：按号这一族的总体**只有一个出处**。
 *
 * **病**：三道按号门各抄了一份「目录 × 后缀」清单（2026-10-28 实测：门 B 读 492 份、号段门与门 I2 读 521 份，
 * 而交付总体是 527 份）⇒ 漏掉的那几类文件（`scripts/*.d.mts` 28 份、根上的具名散文件 6 份）里的按号引用，
 * **没有一条被任何门看见**。绿是白送的：没看过的引用不会变红。
 *
 * **这一格判**：喂给按号判据的文件集，只有两种合法来源——
 *   ① **交付总体**（`scripts/id-scope-rules.mjs` 的 `deliverySurface(root).files`，或它的别名）；
 *   ② **当场拼出来的合成夹具**（`[{ rel, text }, …]`）；
 * 第三样东西（自己抄的一份清单）⇒ 红。而"合法来源①"的那几处**至少要有三处**（今天三道门各一处），
 * 少一处就是某道门把自己的总体丢了。
 *
 * **为什么「已入库名册」（提交面）不算合法来源**：那一份读的是 **HEAD 的 blob**，
 * 而按号门要判的是**此刻工作副本里的文本**——按提交面读会把还没提交的改动整片漏掉，
 * 而漏掉的东西不会变红（绿是白送的）。提交面在判据②③里另有它自己的位置（洞与载体）。
 *
 * @param {{ files: {rel: string, text: string}[], ownerRel?: string, minGates?: number }} input
 * @returns {{ key: string, msg: string }[]}
 */
export function populationSourceFindings({ files, ownerRel = 'scripts/id-scope-rules.mjs', minGates = 3 }) {
  const out = []
  const owners = []
  let unknown = 0
  for (const f of files ?? []) {
    if (!f?.rel || !f.rel.startsWith('tests/')) continue
    const text = f.text ?? ''
    const sites = populationSites(text)
    if (!sites.length) continue
    const bindings = constBindings(text)
    for (const s of sites) {
      const src = classifySource(s.expr, bindings, s.pos)
      if (src === 'total') {
        owners.push(`${f.rel}（${s.kind}）`)
        continue
      }
      if (src === 'fixture') continue
      unknown++
      out.push({
        key: `总体出处 · ${f.rel}`,
        msg: `这里喂给「${s.kind}」的文件集（${s.expr}）既不是交付总体，也不是当场拼出来的合成夹具`
          + ` ⇒ 它是**第三样东西**：某处自己抄了一份总体清单。`
          + `修法：真库那一腿的总体取自 \`${ownerRel}\` 的 \`deliverySurface(root).files\`（或它的别名）；`
          + `合成夹具那一腿就地写 \`[{ rel, text }, …]\`。`,
      })
    }
  }
  if (owners.length < minGates) {
    out.push({
      key: '总体出处',
      msg: `只有 ${owners.length} 处按号判据吃的是交付总体（地板 ${minGates}）`
        + `${owners.length ? `：${owners.join('、')}` : '：一处都没有'}`
        + ` ⇒ 按号这一族的某道门把自己的总体丢了（或者某道门整个没了）。`
        + `修法：让每一道按号门都吃 \`${ownerRel}\` 的交付总体。`,
    })
  }
  return out
}
