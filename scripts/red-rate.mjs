#!/usr/bin/env node
/**
 * scripts/red-rate.mjs — 把一个"偶尔会红"的说法量成一个**红率**：同一范围连跑 N 趟，报 `reds/N`，两种环境各量一遍。
 *
 * 为什么要有它（KI-152）：登记的那条红只在负载重的一趟出现，其它趟全绿。这种账既不能靠"再来一次看运气"结案，
 * 也不能一次红就加 sleep 或放宽断言（那等于把判据改成"跑得动就算过"）。要的是**复现率**：
 * `idle` 与 `loaded` 各 N 趟，`reds/N` 两边都报，读数决定改法。
 *
 * 第一版为什么没量出任何东西（`.scratch/ki152/red-rate.log`）：它照着跑测器那句 `完整报告留在 <tmp>` 去读报告，
 * 而那句只在**红**的两条出口为真——绿的那条出口把临时目录整个删了。八趟全 ENOENT，于是每趟"0 红"，
 * 报出 `reds/0`：**零分母长得和零红一样整齐**。这一版的分母全部来自 `test.mjs` 那行机器可读判决
 * （`red-rate-scan.mjs`，印与读同一把手），读不懂的那一趟记成"不可归因"，不进红率；
 * 一趟都归不了因时 `rateOf` 直接把整批读数标成作废。
 *
 * 用法：node scripts/red-rate.mjs <筛选器…> [--runs=8] [--modes=idle,loaded] [--workers=<CPU 数>]
 *        [--expect-cases=N] [--budget-ms=N]
 * 退出码：0 = 两种环境都没有红且可归因；1 = 量到了红（读数就是它的理由）；
 *         2 = 有趟次不可归因或负载没生效 ⇒ **这批没有读数**（不是"没病"）。
 *
 * 只读，不改任何东西：它跑的是仓库里那条 `node scripts/test.mjs`，与门禁同一条腿。
 */
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseResultLine, rateOf } from './red-rate-scan.mjs'
import { positionalFilters, scopeOf, testFilesOnDisk } from './test-scope.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TESTS = join(ROOT, 'tests')

const argv = process.argv.slice(2)
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? dflt : hit.slice(name.length + 3)
}
const filters = positionalFilters(argv)
const N = Number(opt('runs', 8))
const modes = String(opt('modes', 'idle')).split(',').map((m) => m.trim()).filter(Boolean)
const WORKERS = Number(opt('workers', cpus().length))
const expectCases = opt('expect-cases', '') === '' ? null : Number(opt('expect-cases', ''))

/** 期望文件数**从盘上现推**，不从任何一趟的输出里捡：跑次给的分母会被那次截断一起缩小（KI-099 那一课）。 */
const onDisk = testFilesOnDisk(TESTS)
const scope = scopeOf(onDisk, filters, ROOT)
if (scope.unmatched.length) {
  console.error(`[red-rate] 筛选器在磁盘上一个测试文件都没圈到：${scope.unmatched.join(' ')} ⇒ 不开跑（零文件的"0 红"没有内容）`)
  process.exit(2)
}
const expectFiles = scope.expected.length
if (!Number.isInteger(N) || N < 1) {
  console.error(`[red-rate] --runs 要是 ≥1 的整数，收到 ${opt('runs', 8)}`)
  process.exit(2)
}

console.log(`[red-rate] 根 = ${ROOT}`)
console.log(`[red-rate] 范围 ${filters.join(' ') || '(全量)'} ⇒ 期望 ${expectFiles} 个文件；每环境 ${N} 趟；CPU 核 ${cpus().length}，负载用 ${WORKERS} 个忙循环`)
if (expectCases === null) {
  console.log('[red-rate] 没给 --expect-cases：分母只要求**各趟一致且 >0**（要钉死一个数就从 `it(` 的静态数量现推后传进来）')
}

function busyWorkers() {
  const kids = []
  for (let i = 0; i < WORKERS; i++) {
    kids.push(spawn(process.execPath, ['-e', 'const t = Date.now() + 300000; while (Date.now() < t) {}'], { stdio: 'ignore' }))
  }
  return kids
}

function runOnce(mode) {
  const kids = mode === 'loaded' ? busyWorkers() : []
  const t0 = Date.now()
  let r
  try {
    r = spawnSync(process.execPath, ['scripts/test.mjs', ...filters], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
  } finally {
    for (const k of kids) k.kill()
  }
  const secs = (Date.now() - t0) / 1000
  const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  const parsed = parseResultLine(text)
  // 只有判决自己说报告还在（红的那两条出口不删临时目录）才去读它——那一读能拿到断言的第一句读数，
  // 而"读不到"恰恰是第一版整批作废的成因，所以这里由**旗**决定读不读，不由运气决定。
  let firsts = []
  if (parsed?.reportKept && parsed.kind === 'red') {
    const m = /完整报告留在 (\S+report\.json)/.exec(text)
    if (m) {
      try {
        const rep = JSON.parse(readFileSync(m[1].replace(/\\/g, '/'), 'utf8'))
        firsts = (rep.testResults ?? [])
          .flatMap((f) => (f.assertionResults ?? []).filter((a) => a.status === 'failed'))
          .map((a) => ({ title: a.title ?? a.fullName ?? '(无名)', first: String((a.failureMessages ?? [])[0] ?? '').split(/\r?\n/).find((l) => l && l.trim())?.slice(0, 160) ?? '' }))
      } catch (e) {
        firsts = [{ title: '(判决说报告还在，却读不到)', first: String((e && e.code) ?? e) }]
      }
    }
  }
  return { mode, secs, parsed, exit: r.status, firsts }
}

let worst = 0
const lastTally = new Map()
for (const mode of modes) {
  console.log(`\n=== ${mode} ===`)
  const rows = []
  for (let i = 1; i <= N; i++) {
    const row = runOnce(mode)
    rows.push(row)
    const p = row.parsed
    console.log(
      `${mode} #${String(i).padStart(2)} ${row.secs.toFixed(1)}s ` +
        (p ? `${p.kind} reds=${p.reds}/${p.total} files=${p.ranFiles}/${p.expectedFiles} exit=${row.exit}` : `无判决行 exit=${row.exit}`),
    )
    for (const f of row.firsts) console.log(`        × ${f.title} —— ${f.first}`)
  }
  const tally = rateOf(rows, { expectTotal: expectCases, expectFiles })
  console.log(
    `⇒ ${mode}：reds/${tally.counted} = ${tally.reds}（跑 ${tally.runs} 趟，不可归因 ${tally.voids.length} 趟，中位用时 ${tally.secsMedian ?? '—'}s）`,
  )
  for (const v of tally.voids) console.log(`   不可归因 #${v.i + 1}：${v.why}`)
  for (const [t, c] of Object.entries(tally.byTitle)) console.log(`   红过 ${c} 趟：${t}`)
  if (tally.unusable) {
    console.log(`   ⚠ ${tally.unusable}`)
    worst = Math.max(worst, 2)
  }
  if (tally.reds > 0) worst = Math.max(worst, 1)
  lastTally.set(mode, tally)
}

/** 负载那一格必须自己证明负载生效了：中位用时不比空载慢，就等于"两种环境"其实是一种。 */
const idleMed = lastTally.get('idle')?.secsMedian
const loadedMed = lastTally.get('loaded')?.secsMedian
if (idleMed != null && loadedMed != null) {
  if (!(loadedMed > idleMed)) {
    console.log(`\n⚠ 负载没生效：loaded 中位 ${loadedMed}s ≤ idle 中位 ${idleMed}s ⇒ "loaded" 那一格的读数不作数`)
    worst = Math.max(worst, 2)
  } else {
    console.log(`\n负载生效：idle 中位 ${idleMed}s → loaded 中位 ${loadedMed}s（×${(loadedMed / idleMed).toFixed(2)}）`)
  }
}
process.exit(worst)
