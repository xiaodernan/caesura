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
 * 红的时候**点名**（KI-072 补上的那一半）：把「几条用例 / 哪几个含红文件 / 每个文件红的是哪几条、
 * 第一条读数是什么」直接打出来，并把那份 JSON 报告留在原地。为什么算一条修复：旧写法只报两个数，
 * 而第二个数取的是 `numFailedTestSuites`——它数的不是文件（同一份报告：88 个文件里含红用例的只有 5 个，
 * 它报 11），于是每一批红的归属都要再花四分钟跑一趟裸 vitest 才知道是谁。
 *
 * 用法：node scripts/test.mjs [vitest 额外参数]
 */
import { execFileSync } from 'node:child_process'
import { formatReds, summarizeReds } from './report-reds.mjs'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TESTS = join(ROOT, 'tests')
const MAX_ATTEMPTS = 3
const EXTRA = process.argv.slice(2)

function testFilesOnDisk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...testFilesOnDisk(p))
    else if (entry.name.endsWith('.test.ts')) out.push(p)
  }
  return out
}

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
    const files = (json.testResults ?? []).map((r) => resolve(r.name))
    return { json, files, cleanExit }
  } catch {
    return null
  }
}

const expected = testFilesOnDisk(TESTS).map((p) => resolve(p))
let last = null
let lastMissing = []
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const tmp = mkdtempSync(join(tmpdir(), 'caesura-test-'))
  const report = join(tmp, 'report.json')
  const res = runOnce(report)
  if (!res) {
    rmSync(tmp, { recursive: true, force: true })
    console.error(`\n[test] 第 ${attempt} 次连报告都没写出来（vitest 起不来？）`)
    process.exit(1)
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
    process.exit(1)
  }
  const failed = (res.json.numFailedTests ?? 0) + (res.json.numFailedTestSuites ?? 0)
  if (failed > 0) {
    // 一条用例都没红，但报告说有失败的 suite ⇒ 这是**文件级**的事（import 失败、teardown 炸、
    // 或本机那条 EPERM 被记成 Unhandled Error），不是用例红。分开说，别让两种红共用一个读数。
    console.error(`\n[test] 用例全绿（这一趟跑了 ${sum.total} 条），但报告里有 ${res.json.numFailedTestSuites ?? 0} 个失败的 suite`)
    console.error('  这是**文件级**问题（import 失败、teardown 抛错，或本机那条 EPERM 被记成 Unhandled Error），不是断言红：')
    console.error('  报告里没有一条 status=failed 的用例可点名，所以要用 `npm run test:raw` 看原始输出，别改测试文件。')
    console.error(`  完整报告留在 ${report}`)
    process.exit(1)
  }
  const ran = new Set(res.files)
  const missing = expected.filter((p) => !ran.has(p))
  if (missing.length === 0) {
    rmSync(tmp, { recursive: true, force: true })
    console.log(`\n[test] 覆盖核对通过：${expected.length} 个测试文件全部跑到，${sum.total} 条用例全绿` +
      (res.cleanExit ? '' : '（进程退出码非零，来自本机那条 EPERM 的 Unhandled Error，与用例无关）'))
    process.exit(0)
  }
  lastMissing = missing
  rmSync(tmp, { recursive: true, force: true })
  console.warn(`[test] 第 ${attempt} 次只跑到 ${res.files.length}/${expected.length} 个文件（本机 fs shim 的 EPERM 会让 vitest 静默跳过），重跑…`)
}

console.error(`\n[test] ${MAX_ATTEMPTS} 次都没跑齐：每次都会漏掉下面这些文件 ——`)
for (const p of lastMissing) console.error(`  - ${p.replace(ROOT, '.')}`)
console.error('  这不是测试失败，而是**覆盖不足**：请重跑，或改用更小的范围（npm run test -- tests/unit）。')
void last
process.exit(1)
