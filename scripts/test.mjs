#!/usr/bin/env node
/**
 * scripts/test.mjs — 跑测并**核对覆盖**（零新增依赖，只用 node 内置）。
 *
 * 为什么需要它：本机环境下 vitest 偶尔会因为 `EPERM`（写 SSR 临时缓存被拒）**静默少跑几个测试文件**——
 * 报告里照写 "66 passed"，少的那些不红、也不提。一个会漏跑文件的门禁不是门禁：
 * 坏掉的测试可以长期被跳过而没人发现（2026-09-24 就是这么发现 `--pool=forks` 之前漏得更多的）。
 *
 * 做法：用 JSON reporter 拿到"这次真正跑了哪些文件"，与磁盘上的测试文件对账；
 * 对不上就重跑（最多 3 次），全都不齐才失败并打印差集。**慢一点没关系，漏跑不可接受。**
 *
 * 对账是**双向**的（KI-099）：漏跑要重试，多跑要当场点名并退出。旧写法只算 `missing`，
 * 于是"跑到了名册之外的文件"这一格永远绿——而 vitest 默认的 `include` 打头是仓库级的双星，
 * 它会把 `.scratch/plane_N/tests/…` 那些平面副本收进来（今天实测：一条只管一个文件的筛选器
 * 收到 3 个文件、51 条用例）。多跑的那一份不会让门红，只会让**分母**变成"仓库 + 此刻活着几个平面"，
 * 于是此前每一个"套件共 N 条"的读数都不可复现。收集面本身的收窄在 `vite.config.ts` 的 `test.include`。
 *
 * 红的时候**点名**（KI-072 补上的那一半）：把「几条用例 / 哪几个含红文件 / 每个文件红的是哪几条、
 * 第一条读数是什么」直接打出来，并把那份 JSON 报告留在原地。为什么算一条修复：旧写法只报两个数，
 * 而第二个数取的是 `numFailedTestSuites`——它数的不是文件（同一份报告：88 个文件里含红用例的只有 5 个，
 * 它报 11），于是每一批红的归属都要再花四分钟跑一趟裸 vitest 才知道是谁。
 *
 * 用法：node scripts/test.mjs [vitest 额外参数]
 */
import { execFileSync } from 'node:child_process'
import { formatReds, redTitlesOf, summarizeReds } from './report-reds.mjs'
import { resultLine } from './red-rate-scan.mjs'
import { describeScope, positionalFilters, reconcileRoster, scopeOf, testFilesOnDisk } from './test-scope.mjs'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TESTS = join(ROOT, 'tests')
const MAX_ATTEMPTS = 3
const EXTRA = process.argv.slice(2)

function runOnce(reportPath) {
  // 直接跑本地的 vitest 入口，不走 npx：Windows 上 npx 是 .cmd 垫片，execFileSync 找不到它
  // （那会让"跑不起来"被误报成"测试失败"——第一次实现就踩了这个坑）。
  const entry = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
  const args = [entry, 'run', '--pool=forks', '--reporter=json', `--outputFile=${reportPath}`, ...EXTRA]
  let cleanExit = true
  try {
    execFileSync(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] })
  } catch {
    // 注意：**退出码非零不等于用例失败**。本机那条 EPERM（写 SSR 临时缓存被拒）会被 vitest 记成
    // "Unhandled Errors" 并让进程退出 1，而用例全绿。所以判定只看报告内容，不看退出码。
    cleanExit = false
  }
  try {
    const json = JSON.parse(readFileSync(reportPath, 'utf8'))
    // 报告里的路径是 Windows 反斜杠形状，而期望集在 `test-scope.mjs` 里折成了正斜杠（vitest 在
    // win32 上也是先折再比）⇒ 两边同一个形状再对账，否则"跑到了"会被读成"漏跑了全部"。
    const files = (json.testResults ?? []).map((r) => resolve(r.name).replace(/\\/g, '/'))
    return { json, files, cleanExit }
  } catch {
    return null
  }
}

const onDisk = testFilesOnDisk(TESTS).map((p) => resolve(p))
/**
 * 期望集**跟着筛选器收窄**（KI-078）。原来这一格直接是 `testFilesOnDisk(TESTS)`（HEAD 上还是那句），
 * 于是 `npm run test:flow`（= `node scripts/test.mjs tests/flow`，package.json 里写着的那一条）
 * 拿这一趟跑到的 flow 那 48 个文件去对**整份磁盘名册**（今天 91 个）⇒ 必然判成漏跑，
 * 而重跑三次也一样：差集不会因为重试而消失。它给的建议还是「改用更小的范围」——
 * 那条建议本身就是同一条会失败的命令。筛选器的匹配语义照抄 vitest，见 `test-scope.mjs` 头部。
 */
const filters = positionalFilters(EXTRA)
const scope = scopeOf(onDisk, filters, ROOT)

/**
 * 唯一出口（KI-152 第一条腿的落点）：七条终出口全部走这里，每条都留一行机器可读的判决。
 *
 * 为什么这条门要有：`完整报告留在 <tmp>` 那两句只在**红**的两条出口为真，绿的那条把临时目录整个 `rmSync` 掉了。
 * 第一版红率量具照着那句去读报告，八趟全 ENOENT，于是把「读不到」数成「这趟 0 红」，报出 `reds/0`。
 * 人类那几句改一个字，读它的脚本就静默读出垃圾；所以判决走 `red-rate-scan.mjs` 那份**印与读同一把手**的行。
 *
 * `reds/total/ranFiles` 故意**不给默认值**：漏传一个就写不进 JSON（`undefined` 被 stringify 丢掉），
 * 读的那一头当场解析不动 ⇒ 判为"这一趟不可归因"。默认值会把"没数出来"洗成"数出来是 0"，那正是本脚本要防的谎。
 * 期望集取 `scope.expected.length` 而不是 `expected`：圈空那条出口在 `expected` 被赋上之前就要走，
 * 那里没有"这一趟"，但有判决可说。
 */
function finish(kind, { reds, total, ranFiles, redTitles = [], reportKept = false, code = 1 } = {}) {
  console.log(resultLine({ kind, reds, total, ranFiles, expectedFiles: scope.expected.length, redTitles, reportKept }))
  process.exit(code)
}

if (scope.unmatched.length) {
  console.error(`\n[test] 这些参数在磁盘上一个测试文件都没圈到：${scope.unmatched.map((f) => `"${f}"`).join(' ')}`)
  console.error('  要么路径写错了，要么它是某个**选项的值**而不是位置参数（那一律写成 `--选项=值` 的等号形状，')
  console.error('  或把它补进 `test-scope.mjs` 的 `VALUE_OPTS`）。**不退成全量继续判**：')
  console.error('  vitest 遇到圈空的筛选器会一个文件都不跑，而"该跑 0 个、跑到 0 个"读起来就是全绿。')
  finish('scope-unmatched', { reds: 0, total: 0, ranFiles: 0 })
}
const expected = scope.expected

let last = null
let lastMissing = []
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const tmp = mkdtempSync(join(tmpdir(), 'caesura-test-'))
  const report = join(tmp, 'report.json')
  const res = runOnce(report)
  if (!res) {
    rmSync(tmp, { recursive: true, force: true })
    console.error(`\n[test] 第 ${attempt} 次连报告都没写出来（vitest 起不来？）`)
    finish('no-report', { reds: 0, total: 0, ranFiles: 0 })
  }
  last = res
  /**
   * 红的归属要点名，不能只报数。旧写法是
   * `${numFailedTests} 条用例 / ${numFailedTestSuites} 个文件`——那个 `M` 数的**不是文件**
   * （实测同一份报告：88 个文件里含红用例的只有 5 个，而它报 11），于是每一批红的归属都要
   * 再跑一趟裸 vitest 才知道是谁。数与点名的逻辑抽进 `report-reds.mjs`（那边有单元测试钉着），
   * 这里只负责印出来 + 决定退不退。
   */
  const sum = summarizeReds(res.json, ROOT)
  if (sum.nRed > 0) {
    // 红的那一趟**不删报告**：点名只是第一眼，真正的归属还要看 message 的第 2/3 行与堆栈，
    // 而那要同一份报告（重跑一次就要四分钟，而且未必复现同一批红）。
    console.error(`\n[test] ${formatReds(sum)}`)
    console.error(`  完整报告留在 ${report}`)
    finish('red', {
      reds: sum.nRed,
      total: sum.total,
      ranFiles: sum.ranFiles,
      // **名单不许在这里截一刀**（KI-298）。原来这一格是
      // `sum.files.flatMap((f) => f.reds.map((a) => a.name)).slice(0, 5)`：
      // 红 6 条时判决行只点 5 个名字，而 `reds` 仍然数 6 ⇒ 读判决行做归因的量具
      // （`scripts/red-rate-scan.mjs` 的 `byTitle`）会造出一份**少名字**的归因表，
      // 「没点名」被读成「没红」。名单的**唯一**产地是 `redTitlesOf`（`scripts/report-reds.mjs`），
      // 它不截断；读者那头还有一道完整性校验（点名数 == 红数，否则整趟不可归因）。
      redTitles: redTitlesOf(sum),
      reportKept: true,
    })
  }
  const failed = (res.json.numFailedTests ?? 0) + (res.json.numFailedTestSuites ?? 0)
  if (failed > 0) {
    // 一条用例都没红，但报告说有失败的 suite ⇒ 这是**文件级**的事（import 失败、teardown 炸、
    // 或本机那条 EPERM 被记成 Unhandled Error），不是用例红。分开说，别让两种红共用一个读数。
    console.error(`\n[test] 用例全绿（这一趟跑了 ${sum.total} 条），但报告里有 ${res.json.numFailedTestSuites ?? 0} 个失败的 suite`)
    console.error('  这是**文件级**问题（import 失败、teardown 抛错，或本机那条 EPERM 被记成 Unhandled Error），不是断言红：')
    console.error('  报告里没有一条 status=failed 的用例可点名，所以要用 `npm run test:raw` 看原始输出，别改测试文件。')
    console.error(`  完整报告留在 ${report}`)
    finish('suite-red', { reds: 0, total: sum.total, ranFiles: sum.ranFiles, reportKept: true })
  }
  const { missing, extras } = reconcileRoster(expected, res.files)
  if (extras.length > 0) {
    // **多跑**也要点名（KI-099）。旧写法只算 `missing`，于是这一格永远绿：vitest 的默认 `include`
    // 是仓库级的，它会从根走进 `.scratch/plane_*/tests/**`（冻结平面上的副本），那些文件被无声加进总数，
    // 套件读数于是描述的是"仓库 + 此刻活着几个平面"。这里不给重试：名册与收集面是两份写死的判据，
    // 重试不会让它们相等（与 KI-078 那句"差集不会因为重试而消失"同一条理由）。
    rmSync(tmp, { recursive: true, force: true })
    console.error(`\n[test] 这一趟跑到了 ${res.files.length} 个文件，但磁盘名册（tests/ 下 ${onDisk.length} 个）只认其中 ${expected.length} 个。多出来的是：`)
    for (const p of extras) console.error(`  - ${p}`)
    console.error('  两种成因，按上面那串路径分辨：①**测试文件不在 `tests/` 下面**（例如 `.scratch/plane_*` 里的副本，')
    console.error('  而 `vite.config.ts` 的 `test.include` 没有把它挡在外面）；②`tests/` 下出现了这份 walk 不认的拼写')
    console.error('  （这里只收 `.test.ts`，而 vitest 的 include 还吃 `.spec`、`.tsx`、`.mts`）。')
    console.error('  该改的是**放它进来的那一步**：把文件移回 `tests/` 并按 `.test.ts` 命名，或让 `test.include` 与本文件的')
    console.error('  `testFilesOnDisk` 同一套拼写。别把这条判据删掉来"修红"——分母一旦不可复现，之前每一个绿色数字都作废。')
    finish('extras', { reds: 0, total: sum.total, ranFiles: sum.ranFiles })
  }
  if (missing.length === 0) {
    rmSync(tmp, { recursive: true, force: true })
    console.log(`\n[test] 覆盖核对通过：${describeScope(filters, expected.length, onDisk.length)}，${sum.total} 条用例全绿` +
      (res.cleanExit ? '' : '（进程退出码非零，来自本机那条 EPERM 的 Unhandled Error，与用例无关）'))
    finish('green', { reds: 0, total: sum.total, ranFiles: sum.ranFiles, code: 0 })
  }
  lastMissing = missing
  rmSync(tmp, { recursive: true, force: true })
  console.warn(`[test] 第 ${attempt} 次只跑到 ${res.files.length}/${expected.length} 个文件${filters.length ? `（范围：${filters.join(' ')}）` : ''}（本机 fs shim 的 EPERM 会让 vitest 静默跳过），重跑…`)
}

console.error(`\n[test] ${MAX_ATTEMPTS} 次都没跑齐：每次都会漏掉下面这些文件 ——`)
for (const p of lastMissing) console.error(`  - ${p}`)
console.error(filters.length
  ? `  这不是测试失败，而是**覆盖不足**（范围 ${filters.join(' ')} 内）。重跑；仍然不齐就用 \`npm run test:raw -- ${filters.join(' ')}\` 看 vitest 自己怎么说。`
  : '  这不是测试失败，而是**覆盖不足**：请重跑。全量名册就是这一趟的期望集，没有更小的范围可退。')
const lastSum = summarizeReds(last.json, ROOT)
finish('coverage-void', { reds: 0, total: lastSum.total, ranFiles: lastSum.ranFiles })
