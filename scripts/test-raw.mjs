#!/usr/bin/env node
/**
 * scripts/test-raw.mjs — `npm run test:raw` 的 raw 腿：vitest 的**原始输出**原样打到控制台
 * （default reporter 照旧），跑完补一份**双向名册对账**（KI-099b，结清 KI-099 的没做②）。
 *
 * 为什么需要它：`test:raw` 原来是裸的 `vitest run --pool=forks`，那条路径上没有名册对账。
 * 收集面（`vite.config.ts` 的 `test.include`）今天把平面副本挡在外面，所以分母不会被污染；
 * 但「这一趟实际跑到多少文件」没人核——本机那条 EPERM 会静默跳过文件，裸 vitest 的
 * `Test Files 149 passed (149)` 照样读起来像全量全绿，而少的那个文件不红、也不提。
 *
 * 定位仍然是「看 vitest 自己怎么说」，不是门禁：**不重试**（重试是 `scripts/test.mjs` 的职责，
 * raw 就是重试三次仍不齐时去看原始输出那条路），红的归属也归 vitest 自己说。
 * 退出码裁决在 `rawExitCode`：红绿由**报告**数出来（与主跑测器同一纪律：本机那条 EPERM
 * 会让 vitest 退出 1 而用例全绿，判定只看报告内容、不看进程退出码）；报告全绿而对不上账 ⇒ 2。
 *
 * JSON 侧报告由本脚本固定（`--outputFile.json`）——它是名册对账的证据源，谁自己指定
 * `--outputFile` 就当场拒：两份同名打架时哪份赢是解析器的实现细节，不赌。
 *
 * 用法：node scripts/test-raw.mjs [vitest 额外参数]
 */
import { execFileSync } from 'node:child_process'
import { positionalFilters, rawExitCode, reconcileRoster, scopeOf, testFilesOnDisk } from './test-scope.mjs'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TESTS = join(ROOT, 'tests')
const EXTRA = process.argv.slice(2)

const clashes = EXTRA.filter((t) => String(t).startsWith('--outputFile'))
if (clashes.length) {
  console.error(`\n[raw] 名册对账的证据源是本脚本固定的 --outputFile.json 侧报告，别自己指定：${clashes.join(' ')}`)
  process.exit(1)
}

const onDisk = testFilesOnDisk(TESTS).map((p) => resolve(p))
const filters = positionalFilters(EXTRA)
const scope = scopeOf(onDisk, filters, ROOT)
if (scope.unmatched.length) {
  // 与主跑测器同一格（KI-078）：圈空的筛选器让 vitest 一个文件都不跑，
  // 而「该跑 0 个、跑到 0 个」读起来就是全绿。开跑之前停，不进 vitest。
  console.error(`\n[raw] 这些参数在磁盘上一个测试文件都没圈到：${scope.unmatched.map((f) => `"${f}"`).join(' ')}`)
  console.error('  要么路径写错了，要么它是某个选项的值而不是位置参数。')
  process.exit(1)
}
const expected = scope.expected

const tmp = mkdtempSync(join(tmpdir(), 'caesura-test-raw-'))
const report = join(tmp, 'report.json')
// 直接跑本地的 vitest 入口，不走 npx（Windows 上 npx 是 .cmd 垫片，execFileSync 找不到它）。
const entry = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const args = [entry, 'run', '--pool=forks', '--reporter=default', '--reporter=json', `--outputFile.json=${report}`, ...EXTRA]
let vitestCode = 0
try {
  execFileSync(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] })
} catch (e) {
  // 退出码非零不等于用例红（本机那条 EPERM 也走这里）——红绿由下面的报告数出来，
  // 这个码只留在「报告都读不出来」那一条路上兜底。stdio 是 inherit，vitest 说了什么上面已经全看见了。
  vitestCode = e.status ?? 1
}

const files = (() => {
  try {
    const json = JSON.parse(readFileSync(report, 'utf8'))
    return (json.testResults ?? []).map((r) => resolve(r.name).replace(/\\/g, '/'))
  } catch {
    return null
  }
})()
if (!files) {
  // 没有侧报告 = 对账没有证据源。这不是「没跑」，是「跑了但对不上账」——不许把它读成绿。
  console.error(`\n[raw] JSON 侧报告没写出来（${report}），名册对账没有证据源；看上面的原始输出定位 vitest 那边的事。`)
  rmSync(tmp, { recursive: true, force: true })
  process.exit(vitestCode !== 0 ? vitestCode : 1)
}

const json = JSON.parse(readFileSync(report, 'utf8'))
const reportGreen = (json.numFailedTests ?? 0) === 0 && (json.numFailedTestSuites ?? 0) === 0
const { missing, extras } = reconcileRoster(expected, files)
const drifted = missing.length + extras.length > 0
console.log(`\n[raw] 名册对账：期望 ${expected.length} / 实跑 ${files.length}` +
  (filters.length ? `（筛选器 ${filters.map((f) => `"${f}"`).join(' ')}）` : `（磁盘名册 ${onDisk.length}）`) +
  (drifted ? ` —— 对不上账：漏 ${missing.length} / 多 ${extras.length}` : '，齐'))
if (!reportGreen && vitestCode !== 0) {
  console.log('[raw] 进程退出码非零且报告里有红，红绿以报告为准（1）。')
} else if (!reportGreen) {
  console.log('[raw] 报告里有红（1）；进程退出码非零来自本机那条 EPERM 的 Unhandled Error，与用例无关。')
} else if (vitestCode !== 0) {
  console.log('[raw] 报告全绿；进程退出码非零来自本机那条 EPERM 的 Unhandled Error，与用例无关。')
}
if (extras.length) {
  console.error('  多跑的（名册之外）：')
  for (const p of extras) console.error(`  - ${p}`)
}
if (missing.length) {
  console.error('  漏跑的（名册之内、这一趟没跑到；主跑测器会重试，raw 不重试）：')
  for (const p of missing) console.error(`  - ${p}`)
}
if (drifted || !reportGreen) {
  console.error(`  完整报告留在 ${report}`)
} else {
  rmSync(tmp, { recursive: true, force: true })
}
process.exit(rawExitCode(reportGreen, { missing, extras }))
