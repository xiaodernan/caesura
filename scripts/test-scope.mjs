/**
 * scripts/test-scope.mjs — 跑测器的「这一趟该跑到哪些文件」判据 + 磁盘名册 walk（纯函数、只用 node 内置）。
 *
 * 为什么要抽出来（KI-078）：`test.mjs` 一被 import 就会去跑整套测试（顶层就是主流程），
 * 所以它的期望集算法住在里面就等于**没有证人**——`report-reds.mjs` 因为同一个理由被抽出去过一次。
 *
 * 消费者两处（KI-099b 起，磁盘名册 walk 也住这里）：`scripts/test.mjs`（主跑测器：漏跑重试、多跑点名）
 * 与 `scripts/test-raw.mjs`（raw 腿 = `npm run test:raw`，不重试、只对账）。walk 只许有这一份——
 * 两条腿各抄一份的话，哪天一边改了拼写口径，同一次「全量」就会在两条腿上数出两个分母，
 * 对账门自己先打架。
 *
 * 判据的形状：期望集 = 磁盘名册 ∩ 位置参数（筛选器）。而筛选器的语义**照抄 vitest 自己那一份**
 * （`cli-api` 里的 `filterFiles`：win32 先把筛选器折成正斜杠，再对"仓库相对路径"做**大小写不敏感的子串**
 * 匹配，绝对路径的筛选器先折成仓库相对再走同一条判定），不是我自己发明一套 glob。这条纪律是双向的：
 * 我的判据比 vitest **宽** ⇒ 好跑法被误判成漏跑；比它**窄** ⇒ 真被静默跳过的文件没人点名，
 * 而那正是这个脚本存在的全部理由。所以匹配语义不许"近似"（与 vitest 差的那一条分支，理由写在
 * `matchesFilter` 头上）。
 */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const slash = (p) => String(p).replace(/\\/g, '/')

/**
 * 这些选项**吃掉紧跟的下一个参数**当值 ⇒ 那一格不是路径筛选器。
 * 名单不全时的后果是"响亮报错"而不是"静默放行"（见 `scopeOf` 的 `unmatched` 那一格），
 * 所以这里漏一条是可发现的；等号写法（`--reporter=json`）整个 token 都是选项，不走这条路。
 */
export const VALUE_OPTS = new Set([
  '-t', '--testNamePattern',
  '--reporter', '--outputFile',
  '--config', '-c',
  '--dir', '-r', '--root', '--project',
  '--seed', '--shard',
])

/** 位置参数 = 不以 `-` 开头的 token，且不落在某个吃值选项的后面 */
export function positionalFilters(argv) {
  const out = []
  let consumed = false
  for (const tok of argv ?? []) {
    const t = String(tok)
    if (consumed) { consumed = false; continue }
    if (!t.startsWith('-')) { out.push(t); continue }
    // 只有空格写法（`--reporter json`）才有一格"值"要被吃掉；等号写法（`--reporter=json`）整个
    // token 自己就是选项，走不到这一格的成员判断里——所以这里不需要再额外排除含 `=` 的 token。
    if (VALUE_OPTS.has(t)) consumed = true
  }
  return out
}

/** 仓库相对路径（两边都已经是正斜杠）；不在根下面的原样返回 */
function relTo(root, p) {
  const prefix = slash(root).replace(/\/+$/, '') + '/'
  const f = slash(p)
  return f.startsWith(prefix) ? f.slice(prefix.length) : f
}

/**
 * 一个文件是否被一个筛选器圈住——对着 vitest 的 `filterFiles` 抄，但**少一条分支**：
 * 它那边还有一条"筛选器是绝对路径 ⇒ 直接比前缀"，我们这里删了，因为跑测器永远以仓库根为 `dir`，
 * 绝对路径的筛选器折成相对路径后由下面那条 `relativePath` 一样接得住（变异探针量过：摘掉它零红，
 * 也就是说那条分支今天没有证人；KI-078 那一行的"删没有证人的行"就是这一处）。留着的两条 `||`
 * 在筛选器本来就是相对路径时**同值**——那是 vitest 原样，不是我们写的冗余；副作用是
 * "只摘掉一处 `toLowerCase()`"是**等价突变**（探针量过：不咬；两处同时摘才咬）。
 */
export function matchesFilter(file, filter, root) {
  const f = slash(filter)
  const testFile = relTo(root, file).toLowerCase()
  const relativePath = (f.endsWith('/') ? relTo(root, f) + '/' : relTo(root, f)).toLowerCase()
  return testFile.includes(f.toLowerCase()) || testFile.includes(relativePath)
}

/**
 * @param files 磁盘上的测试文件（绝对路径，正/反斜杠都吃）
 * @param filters `positionalFilters` 的产物
 * @param root 仓库根（vitest 那边是 `config.dir`，今天就是根目录）
 * @returns {{ expected: string[], unmatched: string[], scoped: boolean }}
 *   `expected` = 这一趟该跑到的集合；`unmatched` = **一个文件都没圈到**的筛选器。
 *   后一格不许被消化成"那就按全量判"：写错的路径会让 vitest 一个文件都不跑，而
 *   "该跑 0 个、跑到 0 个"读起来就是全绿——那是这个门禁最坏的一种谎。调用方见到非空 `unmatched`
 *   要**在开跑之前**停下来点名（四分钟都不必花）。
 *   没有筛选器 ⇒ 期望集 = 全量磁盘名册（KI-078 之前的唯一行为，也是默认那条不许变松的那条）。
 */
export function scopeOf(files, filters, root) {
  const all = (files ?? []).map(slash)
  const fs = (filters ?? []).map((f) => String(f))
  if (!fs.length) return { expected: all, unmatched: [], scoped: false }
  const unmatched = fs.filter((f) => !all.some((p) => matchesFilter(p, f, root)))
  if (unmatched.length) return { expected: [], unmatched, scoped: true }
  const expected = all.filter((p) => fs.some((f) => matchesFilter(p, f, root)))
  return { expected, unmatched: [], scoped: true }
}

/**
 * 磁盘名册 walk：递归 `dir`，只收 `.test.ts`。名册的**唯一主人**（KI-099b 起）——
 * 主跑测器与 raw 腿都从这里拿；谁本地再抄一份，同一次「全量」就会在两条腿上数出两个分母。
 */
export function testFilesOnDisk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...testFilesOnDisk(p))
    else if (entry.name.endsWith('.test.ts')) out.push(p)
  }
  return out
}

/**
 * 期望集 ⇄ 这一趟真跑到的文件集，**双向**对账（KI-099）。
 *
 * 为什么"只查漏跑"不够（这一格是 KI-099 的现场）：`scripts/test.mjs` 从写下来起只算
 * `missing = expected 里没跑到的`，于是它保护的是"少跑"这一个方向。而**多跑**从来没人看：
 * vitest 默认的 `include` 打头是仓库级的双星（从根往下走），它会把
 * `.scratch/plane_N/tests/…` 里那些与本批无关的平面副本一起收进来——今天实测一条
 * `tests/unit/text-integrity` 的筛选器收到 **3 个文件 / 51 条用例**，而磁盘那一名册里
 * 只有 1 个文件。多跑的那两份被无声加进总数：任何"套件一共 N 条"的读数从此描述的是
 * "仓库 + 此刻活着几个平面"，不是一个可复现的分母——而门禁的数字要能被别人复核。
 *
 * 返回两个方向的差集，调用方**两个都要拒**：`missing` 可以重试（本机 EPERM 会静默跳过），
 * `extras` 不可以（名册与收集面是两份写死的判据，重试不会让它们相等）。
 */
export function reconcileRoster(expected, ran) {
  const exp = (expected ?? []).map(slash)
  const got = [...new Set((ran ?? []).map(slash))]
  const expSet = new Set(exp)
  const gotSet = new Set(got)
  return {
    missing: exp.filter((p) => !gotSet.has(p)),
    extras: got.filter((p) => !expSet.has(p)),
  }
}

/**
 * raw 腿的退出码裁决（KI-099b）。红绿由**报告**数出来（`reportGreen`），不是进程退出码——
 * 本机那条 EPERM 会让 vitest 记一条 Unhandled Error 并退出 1 而用例全绿（`scripts/test.mjs`
 * 头上那句"判定只看报告内容"就是这一课）。裁决三格：报告说了红 ⇒ **1**（红优先于对账，
 * 被叫来看红的人不能被对账挡住视线）；报告全绿而对不上账（`missing`/`extras` 任一非空）⇒ **2**
 * ——分母没被核过的「全绿」不许读成绿，且与「用例红」的 1 分开，调用方分得清是哪一类；
 * 全绿且对上账 ⇒ 0。
 */
export function rawExitCode(reportGreen, { missing = [], extras = [] } = {}) {
  if (!reportGreen) return 1
  return missing.length + extras.length > 0 ? 2 : 0
}

/** 给人看的那一句：范围是筛选器**说**的，不是脚本自己猜的（`diskCount` 一起印，好让"圈窄了"看得见） */
export function describeScope(filters, expectedCount, diskCount) {
  if (!filters.length) return `${expectedCount} 个测试文件全部跑到（磁盘名册 ${diskCount}）`
  return `筛选器 ${filters.map((f) => `"${f}"`).join(' ')} 圈定的 ${expectedCount} 个文件全部跑到（磁盘名册 ${diskCount}）`
}
