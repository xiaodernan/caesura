#!/usr/bin/env node
/**
 * scripts/coverage.mjs — 行覆盖率的**测量与棘轮**（TD-004 的结案）。
 *
 * 为什么需要它：架构文档 §6.1 那句「逻辑核心包行覆盖 ≥80%」从写下那天起**从未被测量过**。
 * `scripts/test.mjs` 核对的是另一件事——它保证**每个测试文件都被跑到**，不保证**每行代码被执行**；
 * 两者不能互相冒充（§78）。这条脚本第一次把行数量出来，并把量到的数**钉成地板**：可以涨，不可以跌。
 *
 * 三条判据，只有前两条让门红：
 *   1) 行覆盖 < 地板            ⇒ 红（跌了）
 *   2) 新增**零覆盖**的 src 文件 ⇒ 红（写了却没有任何测试执行过它——§55「没有消费方的东西不占位」的行为版）
 *   3) 覆盖涨了 / 名单里那格已经不是 0 了 ⇒ 只提示，不红
 * 第 3 条不红的理由：那通常是**别人正在推进**的功劳，门不该惩罚进步；但地板文件必须由 `--bless`
 * 重新落一次才作数，所以"提示"不会变成永久的谎。
 *
 * 为什么不挂进 `npm run check`：check 是共享工作区里每批都要跑的门，而覆盖率的涨跌常常落在
 * "某人的模块刚写一半"这种中间态上——那会把别人的在途工作变成我的红。它的定位是**第五道门**：
 * 每批收尾自测跑一次（跑法见 §6.1 与 KNOWN_ISSUES 的 KI-063 行）。
 *
 * 用法：
 *   npm run coverage                     真跑一遍测试并判读
 *   npm run coverage -- --bless          把本次实测写成地板（红跑不许 bless）
 *   node scripts/coverage.mjs --summary=<coverage-summary.json> [--floor=<f.json>]
 *                                        只判读数（不重跑测试）——门自己的测试用这条
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_FLOOR = join(ROOT, 'scripts', 'coverage-floor.json')
/** 地板与实测之间允许的浮点噪声（地板按两位小数**向下**写，实测是原值） */
const EPS = 1e-9
/** 高出地板这么多百分点就提示"把地板抬上来" */
const RAISE_HINT = 0.5

const rel = (p) => String(p).replace(/\\/g, '/').replace(/^\.\/+/, '')
const ROOT_REL = rel(ROOT)
/** istanbul 的键是绝对路径（Windows 上还是反斜杠）：换成仓库相对路径，名单才与 git 同构 */
const toRepoRel = (key) => {
  const k = rel(key)
  const cut = k.startsWith(ROOT_REL + '/') ? k.slice(ROOT_REL.length + 1) : k
  return cut.replace(/^\.\/+/, '')
}

/** vitest 的 json-summary（istanbul 形状）→ 本门的读数。只认 lines 这一维，因为 §6.1 承诺的是**行**覆盖。 */
export function measure(summary) {
  const total = summary.total?.lines ?? { total: 0, covered: 0, pct: 0 }
  const files = Object.entries(summary).filter(([k]) => k !== 'total')
  const zero = []
  const empty = []
  for (const [k, v] of files) {
    const lines = v?.lines ?? { total: 0, covered: 0 }
    if (lines.total === 0) empty.push(toRepoRel(k))
    else if (lines.covered === 0) zero.push(toRepoRel(k))
  }
  return {
    // 向下取整到两位：地板由同一个函数写、由同一个函数读，bless 之后第一次判读必须"恰好等于地板"，
    // 不能因为浮点第 7 位小数的舍入方向差出 0.01 个百分点（那会让 --bless 自己把门弄红）。
    linesPct: Math.floor(Number(total.pct ?? 0) * 100) / 100,
    linesCovered: Number(total.covered ?? 0),
    linesTotal: Number(total.total ?? 0),
    srcFiles: files.length,
    zeroFiles: zero.sort(),
    noLineFiles: empty.sort()
  }
}

/** 判读：errors 让门红，warns 只出声。**纯函数**，两侧都由测试钉住。 */
export function decide(m, floor) {
  const errors = []
  const warns = []
  if (m.linesPct < floor.linesPct - EPS) {
    errors.push(`行覆盖 ${m.linesPct.toFixed(2)}% 低于地板 ${floor.linesPct}%（掉了 ${(floor.linesPct - m.linesPct).toFixed(2)} 个百分点）`)
  } else if (m.linesPct > floor.linesPct + EPS) {
    warns.push(`行覆盖已涨到 ${m.linesPct.toFixed(2)}%（地板 ${floor.linesPct}%）：npm run coverage -- --bless 把地板抬上来`)
  }
  const zeros = new Set(m.zeroFiles)
  for (const f of floor.zeroFiles ?? []) {
    if (!zeros.has(f)) {
      warns.push(`地板名单里的 ${f} 今天不再是零覆盖（要么真被测到了，要么文件已删）：--bless 时把它划掉`)
    }
  }
  const listed = new Set(floor.zeroFiles ?? [])
  for (const f of m.zeroFiles) {
    if (!listed.has(f)) errors.push(`新增零覆盖文件 ${f}：写了没有任何测试执行过的模块`)
  }
  return { errors, warns }
}

function parseArgs(argv) {
  const out = { bless: false, summary: null, floor: DEFAULT_FLOOR }
  for (const a of argv) {
    if (a === '--bless') out.bless = true
    else if (a.startsWith('--summary=')) out.summary = resolve(a.slice('--summary='.length))
    else if (a.startsWith('--floor=')) out.floor = resolve(a.slice('--floor='.length))
    else { console.error(`[coverage] 不认的参数：${a}`); process.exit(2) }
  }
  return out
}

/** 真跑一遍 vitest（带 v8 provider），返回 {summary, reportJson, green, failed}。 */
function runVitest() {
  const tmp = mkdtempSync(join(tmpdir(), 'caesura-cov-'))
  const covDir = join(tmp, 'cov')
  const reportJson = join(tmp, 'report.json')
  const entry = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
  const args = [
    entry, 'run', '--pool=forks',
    '--reporter=default', '--reporter=json', `--outputFile.json=${reportJson}`,
    '--coverage', '--coverage.provider=v8', '--coverage.all',
    '--coverage.reporter=json-summary', `--coverage.reportsDirectory=${covDir}`,
    '--coverage.include=src/**/*.ts'
  ]
  try {
    execFileSync(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] })
  } catch {
    // 与 test.mjs 同一条教训：**退出码非零不等于用例失败**（本机那条 EPERM 会被记成 Unhandled Error）。
    // 判定只看报告内容。
  }
  let failedTests = 0
  let failedSuites = 0
  let files = -1
  try {
    const r = JSON.parse(readFileSync(reportJson, 'utf8'))
    failedTests = r.numFailedTests ?? 0
    failedSuites = r.numFailedTestSuites ?? 0
    files = (r.testResults ?? []).length
  } catch { failedTests = -1 }
  if (failedTests !== 0 || failedSuites !== 0) {
    // 顺序很重要：v8 provider 默认 `reportOnFailure: false`，红跑连 coverage 报告都不写。
    // 所以先看测试报告，否则这条"没写出报告"会被读成"量具坏了"——真因是**这次跑红了**。
    const what = failedTests < 0 ? '连测试报告都没拿到' : `${failedTests} 条用例 / ${failedSuites} 个文件失败`
    console.error(`\n[coverage] ${what}——红跑上的覆盖率不作数，先让 npm run test 绿。`)
    process.exit(1)
  }
  const summaryPath = join(covDir, 'coverage-summary.json')
  if (!existsSync(summaryPath)) {
    console.error('[coverage] 用例全绿却没写出 coverage-summary.json（跑不起来 ≠ 覆盖率为 0）：量具坏了，别拿这次的数当账。')
    process.exit(1)
  }
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'))
  rmSync(tmp, { recursive: true, force: true })
  return { summary, files }
}

function printReading(m, src) {
  console.log(`\n[coverage] 行覆盖 ${m.linesPct.toFixed(2)}%（${m.linesCovered}/${m.linesTotal} 行，${m.srcFiles} 个 src 文件，${src}）`)
  if (m.zeroFiles.length) {
    console.log(`[coverage] 零覆盖 ${m.zeroFiles.length} 个：`)
    for (const f of m.zeroFiles) console.log(`  - ${f}`)
  }
  if (m.noLineFiles.length) {
    console.log(`[coverage] 无行可计（纯类型/常量文件，istanbul 记 0 行）${m.noLineFiles.length} 个：${m.noLineFiles.join(' · ')}`)
  }
}

const argv = parseArgs(process.argv.slice(2))
if (argv.bless && argv.summary) {
  console.error('[coverage] 地板只能由真跑写：--bless 不许配 --summary')
  process.exit(2)
}

let m
if (argv.summary) {
  m = measure(JSON.parse(readFileSync(argv.summary, 'utf8')))
  printReading(m, `读数来自 ${rel(argv.summary)}（本次未核对用例是否全绿）`)
} else {
  const { summary, files } = runVitest()
  m = measure(summary)
  printReading(m, `${files} 个测试文件全绿`)
}

if (argv.bless) {
  const prev = existsSync(argv.floor) ? JSON.parse(readFileSync(argv.floor, 'utf8')) : null
  const doc = {
    linesPct: Math.floor(m.linesPct * 100) / 100,
    zeroFiles: m.zeroFiles,
    srcFilesAtMeasure: m.srcFiles,
    linesTotal: m.linesTotal,
    note: '由 npm run coverage -- --bless 写入。linesPct 是地板（只许涨）；zeroFiles 是"今天确实没有任何测试执行过"的 src 文件名单，新增一格当场红。'
  }
  writeFileSync(argv.floor, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log(`\n[coverage] 地板已写：${rel(argv.floor)} = ${doc.linesPct}% + ${doc.zeroFiles.length} 格零覆盖名单`)
  if (prev && doc.linesPct < prev.linesPct) {
    console.warn(`[coverage] 注意：这是一次**下调**（${prev.linesPct}% → ${doc.linesPct}%）。地板下调必须有一个提交信息能解释的理由。`)
  }
  process.exit(0)
}

if (!existsSync(argv.floor)) {
  console.error(`\n[coverage] 还没有地板文件（${rel(argv.floor)}）。先跑一次 npm run coverage -- --bless 建立基线。`)
  process.exit(1)
}
const floor = JSON.parse(readFileSync(argv.floor, 'utf8'))
const { errors, warns } = decide(m, floor)
for (const w of warns) console.warn(`[coverage] 提示：${w}`)
if (errors.length === 0) {
  console.log(`[coverage] 通过：不低于地板 ${floor.linesPct}%，零覆盖名单没有变长（名单 ${floor.zeroFiles.length} 格 / 实测 ${m.zeroFiles.length} 格）`)
  process.exit(0)
}
console.error('\n[coverage] 门红：')
for (const e of errors) console.error(`  ✗ ${e}`)
process.exit(1)
