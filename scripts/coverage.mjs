#!/usr/bin/env node
/**
 * scripts/coverage.mjs — 行覆盖率的**测量与棘轮**（TD-004 的结案）。
 *
 * 为什么需要它（KI-063 立项时的账）：架构文档 §6.1 那句「逻辑核心包行覆盖 ≥80%」写下之后的十余周里
 * **从未被测量过**。`scripts/test.mjs` 核对的是另一件事——它保证**每个测试文件都被跑到**，不保证
 * **每行代码被执行**；两者不能互相冒充（§78）。这条脚本第一次把行数量出来，并把量到的数**钉成地板**：
 * 可以涨，不可以跌。
 *
 * 七条判据，只有编号 1/2/4/5/7 让门红：
 *   1) 行覆盖 < 总地板              ⇒ 红（跌了）
 *   2) 新增**零覆盖**的 src 文件     ⇒ 红（写了却没有任何测试执行过它——§55「没有消费方的东西不占位」的行为版）
 *   3) 覆盖涨了 / 名单里那格已经不是 0 了 ⇒ 只提示，不红
 *      （不红的理由：那通常是**别人正在推进**的功劳，门不该惩罚进步；但地板必须由 `--bless` 重落一次
 *      才作数，所以"提示"不会变成永久的谎）
 * —— 以下四条是 KI-064 加的按包判据（§6.1 那句门槛本来就是按包说的）——
 *   4) 任一包的行覆盖 < 该包的地板  ⇒ 红（总覆盖会把小包的回退藏进大包的增长里）
 *   5) 逻辑核心包（`CORE_PACKAGES`）< `CORE_MIN` ⇒ 红，**与地板无关**——地板是"只许涨"的棘轮，
 *      那句 80% 是文档对玩家的承诺，两者不是一个东西：只钉棘轮的话，"某核心包一开始就只有 60%
 *      于是地板也是 60%"照样绿，而那正是 §6.1 说的不合规
 *   6) 今天量到一个没进地板的包（新建目录）⇒ 只提示，等 `--bless` 落账
 *   7) 地板里列着的包今天没有可计行的文件   ⇒ 红（目录改名/删除悄悄让某条门槛失去对象，这条路是关的）
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
 *   node scripts/coverage.mjs --summary=<…> --report=<vitest 的 JSON 报告>
 *                                        让注入读数那条路也吃「红跑上的覆盖率不作数」：报告说红就退 1，
 *                                        说全绿才出读数（KI-384：这条规矩今天只管真跑那一条路）
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_FLOOR = join(ROOT, 'scripts', 'coverage-floor.json')
/** 地板与实测之间允许的浮点噪声（地板按两位小数**向下**写，实测是原值） */
const EPS = 1e-9
/** 高出地板这么多百分点就提示"把地板抬上来" */
const RAISE_HINT = 0.5
/**
 * §6.1 点名的"逻辑核心包"与它们各自的下限。刻意**不放进地板文件**：地板会被 `--bless` 重写，
 * 承诺不该跟着量具一起被顺手改掉。有一条测试（tests/unit/coverage-gate.test.ts）钉住
 * "这份名单 == 架构文档 §6.1 那句话里括号列的名单"，两边任一处改动都会红。
 */
const CORE_PACKAGES = ['combat', 'rpg', 'save', 'quest']
const CORE_MIN = 80
/**
 * **纯类型文件**：只声明 interface/type，编译后是一份空模块，没有一行可以被执行。
 *
 * 量具对"从未被加载过的文件"是逐行记账的（`src/main.ts` 544 行 0 覆盖就是这么来的），
 * 对纯类型文件会得出一个荒唐读数——`schema.ts` 1359 行"0% 覆盖"，而事实上那里**没有任何
 * 一行代码可测**。这道门要抓的是"写了却没人测的模块"，不是"写了类型声明的模块"：
 * `measure()` 本来就把 0 行可计的文件归进 `noLineFiles`（见 printReading），排除它只是
 * 让 vitest 那侧的口径跟上同一条判据。
 *
 * 白名单**必须能被证伪**（tests/unit/coverage-gate.test.ts 钉两条）：
 * 1. 名单里的文件今天仍然纯类型——谁往里加一行可执行语句，测试当场红，逼人把它挪出去、真去测它；
 * 2. 脚本确实把名单传给了 vitest——名单悄悄失效时红的不该是读数，而是这道门自己。
 */
const PURE_TYPE_FILES = ['src/data/schema.ts']

const rel = (p) => String(p).replace(/\\/g, '/').replace(/^\.\/+/, '')
const ROOT_REL = rel(ROOT)
/** istanbul 的键是绝对路径（Windows 上还是反斜杠）：换成仓库相对路径，名单才与 git 同构 */
const toRepoRel = (key) => {
  const k = rel(key)
  const cut = k.startsWith(ROOT_REL + '/') ? k.slice(ROOT_REL.length + 1) : k
  return cut.replace(/^\.\/+/, '')
}

/** 包 = `src/<目录>/` 那一层；`src/main.ts` 这种散在根上的记成 `(root)`。§6.1 的门槛本来就是按包说的。 */
export function pkgOf(repoRel) {
  const seg = repoRel.split('/')
  return seg.length > 2 ? seg[1] : '(root)'
}

/** vitest 的 json-summary（istanbul 形状）→ 本门的读数。只认 lines 这一维，因为 §6.1 承诺的是**行**覆盖。 */
export function measure(summary) {
  const total = summary.total?.lines ?? { total: 0, covered: 0, pct: 0 }
  const files = Object.entries(summary).filter(([k]) => k !== 'total')
  const zero = []
  const empty = []
  const byPkg = new Map()
  for (const [k, v] of files) {
    const f = toRepoRel(k)
    const lines = v?.lines ?? { total: 0, covered: 0 }
    if (lines.total === 0) empty.push(f)
    else if (lines.covered === 0) zero.push(f)
    const p = pkgOf(f)
    const e = byPkg.get(p) ?? { files: 0, linesTotal: 0, linesCovered: 0 }
    e.files += 1
    e.linesTotal += Number(lines.total ?? 0)
    e.linesCovered += Number(lines.covered ?? 0)
    byPkg.set(p, e)
  }
  // 按包的 pct 由**加总后的**covered/total 现算，再走同一个向下取整——不能把 istanbul 每个文件
  // 已经各自四舍五入过的 pct 再平均一次：那会把"包"读成一个统计上不存在的数。
  const byPackage = {}
  for (const [p, e] of [...byPkg.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    if (e.linesTotal === 0) continue
    byPackage[p] = {
      linesPct: Math.floor((e.linesCovered / e.linesTotal) * 10000) / 100,
      linesCovered: e.linesCovered,
      linesTotal: e.linesTotal,
      files: e.files
    }
  }
  return {
    // 向下取整到两位：地板由同一个函数写、由同一个函数读，bless 之后第一次判读必须"恰好等于地板"，
    // 不能因为浮点第 7 位小数的舍入方向差出 0.01 个百分点（那会让 --bless 自己把门弄红）。
    linesPct: Math.floor(Number(total.pct ?? 0) * 100) / 100,
    linesCovered: Number(total.covered ?? 0),
    linesTotal: Number(total.total ?? 0),
    srcFiles: files.length,
    zeroFiles: zero.sort(),
    noLineFiles: empty.sort(),
    byPackage
  }
}

/** 判读：errors 让门红，warns 只出声。**纯函数**，两侧都由测试钉住。 */
export function decide(m, floor) {
  const errors = []
  const warns = []
  /** 涨幅够大才开口：连同按包那 15 行，每涨 0.01 就提示会把真正要读的两行淹掉。 */
  const raiseHint = (label, got, fl) =>
    `${label}已涨到 ${got.toFixed(2)}%（地板 ${fl}%）：npm run coverage -- --bless 把地板抬上来`
  if (m.linesPct < floor.linesPct - EPS) {
    errors.push(`行覆盖 ${m.linesPct.toFixed(2)}% 低于地板 ${floor.linesPct}%（掉了 ${(floor.linesPct - m.linesPct).toFixed(2)} 个百分点）`)
  } else if (m.linesPct - floor.linesPct >= RAISE_HINT) {
    warns.push(raiseHint('行覆盖', m.linesPct, floor.linesPct))
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
  if (floor.byPackage === undefined) {
    if (Object.keys(m.byPackage).length) {
      warns.push('地板里没有按包格子（KI-063 之前那份旧地板）：--bless 落一次，§6.1 的按包门槛从此才真的有人守')
    }
  } else {
    for (const [pkg, fl] of Object.entries(floor.byPackage)) {
      const got = m.byPackage[pkg]
      if (!got) {
        errors.push(`地板里的包 ${pkg} 今天没有一个可计行的文件：目录改名/删除要连着地板一起改，不许让按包门槛悄悄失去对象`)
        continue
      }
      if (got.linesPct < fl - EPS) {
        errors.push(`包 ${pkg} 行覆盖 ${got.linesPct.toFixed(2)}% 低于该包地板 ${fl}%（掉了 ${(fl - got.linesPct).toFixed(2)} 个百分点）`)
      } else if (got.linesPct - fl >= RAISE_HINT) {
        warns.push(raiseHint(`包 ${pkg} 行覆盖`, got.linesPct, fl))
      }
    }
    for (const pkg of Object.keys(m.byPackage)) {
      if (!(pkg in floor.byPackage)) warns.push(`新包 ${pkg} 没进地板：--bless 落一次（新目录不会自动获得下限）`)
    }
  }
  // §6.1 的那句承诺独立于地板：地板可以钉在 96%，但"核心包各 ≥80%"这一格必须由**测量**守，
  // 否则把地板文件里那一格删掉、或从一开始就低低地钉一次，都能让一条不合规的核心包长期绿着。
  for (const pkg of CORE_PACKAGES) {
    const got = m.byPackage[pkg]
    // 包整个不在测量里 **不**在这里报错：那条账由第 7 条（地板里列着的包消失了）与
    // tests/unit/coverage-gate.test.ts 的"仓库地板体检"分别管，两边各红一次比在这里堆三条重复判决清楚。
    if (!got) continue
    if (got.linesPct < CORE_MIN - EPS) {
      errors.push(`${pkg} 行覆盖 ${got.linesPct.toFixed(2)}% 低于 §6.1 承诺的 ${CORE_MIN}%（这是文档门槛，与地板无关）`)
    }
  }
  return { errors, warns }
}

function parseArgs(argv) {
  const out = { bless: false, summary: null, report: null, floor: DEFAULT_FLOOR }
  for (const a of argv) {
    if (a === '--bless') out.bless = true
    else if (a.startsWith('--summary=')) out.summary = resolve(a.slice('--summary='.length))
    else if (a.startsWith('--report=')) out.report = resolve(a.slice('--report='.length))
    else if (a.startsWith('--floor=')) out.floor = resolve(a.slice('--floor='.length))
    else { console.error(`[coverage] 不认的参数：${a}`); process.exit(2) }
  }
  return out
}

/**
 * 从 vitest 的 JSON 报告派生「这一趟红在哪几个文件」。**纯函数**，红判决只有一个主人：
 * 真跑那一趟与 `--summary`+`--report` 那条注入路都读它——同一道规矩的两条出口不许各说一套。
 *
 * 为什么不用 `numFailedTestSuites`（旧代码拿它当「几个文件失败」印出来）：那个字段数的是**套件节点**——
 * 文件根加上每一层 describe，于是它比红的文件数多出「describe 的层数」那一截；只有红在装载期、
 * 一棵 describe 都没建起来的跑，它才碰巧等于文件数。
 * 为什么不能只看 failed 断言：**装载期就抛**的文件一条断言都没跑，`numFailedTests` 是 0、而文件级
 * `status` 是 `failed`（真报告里就量到过）——只看断言会把一次红跑放行，那是比印错数更坏的改动。
 * ⇒ 两条取并集，且两个数来自同一次 `testResults` 扫描：计数与点名不会互相漂移。
 * 两个形状各有一条腿钉着（tests/unit/coverage-gate.test.ts：「拒绝句数的是文件」不许那格谎数出现在
 * 句子里，「装载期就抛的文件（0 条断言、status=failed）也算红」不许只看断言）。
 */
export function redRunOf(report) {
  const results = Array.isArray(report?.testResults) ? report.testResults : null
  if (!results) return { verdict: 'unknown', cases: 0, files: [], suites: 0 }
  const files = []
  let cases = 0
  for (const t of results) {
    const failed = (t?.assertionResults ?? []).filter((a) => a?.status === 'failed').length
    if (failed === 0 && t?.status !== 'failed') continue
    cases += failed
    files.push({ name: toRepoRel(String(t?.name ?? '(无名文件)')), assertions: failed })
  }
  return { verdict: files.length === 0 ? 'green' : 'red', cases, files, suites: results.length }
}

/** 那句拒绝话：先说几个文件红、共几条失败断言，再把文件逐个点名（截断即不可归因，同 KI-298 那条教训）。 */
export function redRunText(r) {
  const note = r.cases === 0 ? '（没有一条断言跑成：装载期就抛的文件不产出断言）' : ''
  return `${r.files.length} 个文件红，共 ${r.cases} 条失败断言${note}：${r.files.map((f) => f.name).join(', ')}`
}

/** 读一份 vitest 报告并判红绿。读不到／认不出 ⇒ `unknown`：核对不了全绿，就不许出读数。 */
function reportVerdict(path) {
  try {
    return redRunOf(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return { verdict: 'unknown', cases: 0, files: [], suites: 0 }
  }
}

/** 红判决（或"核对不了"）落成的那一句——两条出口共用，措辞只有一个主人。 */
function refusalLine(run, unknownWhat) {
  const what = run.verdict === 'unknown' ? unknownWhat : redRunText(run)
  return `\n[coverage] ${what}——红跑上的覆盖率不作数，先让 npm run test 绿。`
}

/** 真跑一遍 vitest（带 v8 provider），返回 {summary, files}；那一趟红（或报告认不出）就当场拒掉。 */
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
    '--coverage.include=src/**/*.ts',
    // 纯类型文件不进分母（见 PURE_TYPE_FILES 的注释：那里没有一行代码可测）
    ...PURE_TYPE_FILES.map((f) => `--coverage.exclude=${f}`)
  ]
  try {
    execFileSync(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] })
  } catch {
    // 与 test.mjs 同一条教训：**退出码非零不等于用例失败**（本机那条 EPERM 会被记成 Unhandled Error）。
    // 判定只看报告内容。
  }
  const run = reportVerdict(reportJson)
  if (run.verdict !== 'green') {
    // 顺序很重要：v8 provider 默认 `reportOnFailure: false`，红跑连 coverage 报告都不写。
    // 所以先看测试报告，否则这条"没写出报告"会被读成"量具坏了"——真因是**这次跑红了**。
    console.error(refusalLine(run, '连测试报告都没拿到'))
    process.exit(1)
  }
  const summaryPath = join(covDir, 'coverage-summary.json')
  if (!existsSync(summaryPath)) {
    console.error('[coverage] 用例全绿却没写出 coverage-summary.json（跑不起来 ≠ 覆盖率为 0）：量具坏了，别拿这次的数当账。')
    process.exit(1)
  }
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'))
  rmSync(tmp, { recursive: true, force: true })
  return { summary, files: run.suites }
}

function printReading(m, floor, src) {
  console.log(`\n[coverage] 行覆盖 ${m.linesPct.toFixed(2)}%（${m.linesCovered}/${m.linesTotal} 行，${m.srcFiles} 个 src 文件，${src}）`)
  const listed = floor?.byPackage ?? {}
  const core = new Set(CORE_PACKAGES)
  const rows = Object.entries(m.byPackage).sort((a, b) => a[1].linesPct - b[1].linesPct)
  console.log(`[coverage] 按包（★ = §6.1 点名的逻辑核心包，各须 ≥${CORE_MIN}%；地板 = 该包只许涨的下限）：`)
  for (const [pkg, v] of rows) {
    const fl = listed[pkg]
    const flag = core.has(pkg) ? '★' : ' '
    const need = core.has(pkg) && v.linesPct < CORE_MIN - EPS ? '  ← 未达 §6.1' : ''
    console.log(
      `  ${flag} ${pkg.padEnd(9)} ${v.linesPct.toFixed(2).padStart(7)}%  (${v.linesCovered}/${v.linesTotal} 行, ${v.files} 文件)` +
      (typeof fl === 'number' ? `  地板 ${fl}%` : '  地板 —') + need
    )
  }
  if (m.zeroFiles.length) {
    console.log(`[coverage] 零覆盖 ${m.zeroFiles.length} 个：`)
    for (const f of m.zeroFiles) console.log(`  - ${f}`)
  }
  if (m.noLineFiles.length) {
    console.log(`[coverage] 无行可计（纯类型/常量文件，istanbul 记 0 行）${m.noLineFiles.length} 个：${m.noLineFiles.join(' · ')}`)
  }
  // 排除名单也印出来：门的读数要能自证"分母里少了谁"，否则下一个人会以为 schema.ts 被删了
  console.log(`[coverage] 纯类型文件（不进分母）：${PURE_TYPE_FILES.join(' · ')}`)
}

/**
 * 「空报表丢了 source map」的兜底检测（§78：量具坏了 ≠ 覆盖率掉了）。
 *
 * 从未被任何测试 import 的文件走 v8 provider 的 `(empty-report)` 分支，它的**可执行行数**
 * 由 `vitenode.transformRequest` 返回的 source map 决定。`getSources()` 把那次 transform 的
 * 异常 `.catch(() => void 0)` 吞掉之后会退回**原始源码** —— 于是分母变成"文件行数"
 * （含空行与注释），同一棵代码的覆盖率会凭空掉几个点，报出来是一句假的"覆盖率掉了"。
 *
 * 判据：零覆盖文件的 `lines.total` **恰好等于**它的物理行数，且文件里确实有空行/注释行
 * （否则"每一行都可执行"的文件会误判）。命中即 exit 2：这不是地板该背的账，也**不许**
 * 借此 `--bless` 把地板下调（下调＝放松棘轮＝免掉这笔债）。
 */
function degenerateEmptyReports(summary) {
  const out = []
  for (const [key, data] of Object.entries(summary)) {
    if (key === 'total') continue
    if (!data?.lines || data.lines.covered !== 0) continue
    const relPath = toRepoRel(key)
    const abs = join(ROOT, relPath)
    if (!existsSync(abs)) continue
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/)
    // 末尾换行会让 split 多出一格空串：按 `wc -l` 的口径（数换行）折掉它
    const physical = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
    const hasNonCode = lines.some((l) => /^\s*(\/\/|\/\*|\*|$)/.test(l))
    if (data.lines.total === physical && hasNonCode) out.push(`${relPath}（${data.lines.total} 行 = 文件行数）`)
  }
  return out
}

/**
 * CLI 主体。**刻意包在 main() 里**：这份模块被 import 过一次的现场是——`import()` 它的人
 * 看见的不是"取两个纯函数"，而是 40 秒的整套测试跑（顶层副作用）。判"我是被直接运行的"用
 * argv[1] 的绝对路径与 import.meta.url 对照；对不上就只导出、不运行。
 */
function main() {
  const argv = parseArgs(process.argv.slice(2))
  if (argv.bless && (argv.summary || argv.report)) {
    console.error('[coverage] 地板只能由真跑写：--bless 不许配 --summary/--report')
    process.exit(2)
  }
  if (argv.report && !argv.summary) {
    console.error('[coverage] --report 只在配 --summary 时有意义：真跑那一趟自己就有报告，再注入一份是两套来源、没有裁决者。')
    process.exit(2)
  }
  if (argv.report && !existsSync(argv.report)) {
    console.error(`[coverage] --report 指向的文件不存在：${argv.report}（拒绝在参数层：拿一份读不到的报告核对「全绿」等于没核对）`)
    process.exit(2)
  }
  /** 地板先读一次（可能还不存在）：printReading 要把"每包的地板"并排印出来，bless 也要拿它做下调对照。 */
  const floor = existsSync(argv.floor) ? JSON.parse(readFileSync(argv.floor, 'utf8')) : null

  let m
  let raw
  if (argv.summary) {
    /** 注入读数时，「红跑上的覆盖率不作数」这条规矩由谁执行：`--report` 给了就执行，没给就如实说没核对。 */
    let src = `读数来自 ${rel(argv.summary)}（本次未核对用例是否全绿）`
    if (argv.report) {
      const run = reportVerdict(argv.report)
      if (run.verdict !== 'green') {
        console.error(refusalLine(run, `--report 那份报告里没有可用的 testResults 名单（${rel(argv.report)}）`))
        process.exit(1)
      }
      src = `读数来自 ${rel(argv.summary)}（用例全绿由 ${rel(argv.report)} 核对：那份报告里 ${run.suites} 个文件、无红文件）`
    }
    raw = JSON.parse(readFileSync(argv.summary, 'utf8'))
    m = measure(raw)
    printReading(m, floor, src)
  } else {
    const { summary, files } = runVitest()
    raw = summary
    m = measure(summary)
    printReading(m, floor, `${files} 个测试文件全绿`)
  }

  // 先验量具、再判地板：空报表丢了 source map 时分母是文件行数 ⇒ 这一趟的读数不作数。
  // 放在 `--bless` 之前是刻意的：否则一次退化的测量会把地板**下调**写进文件（放松棘轮）。
  const degenerate = degenerateEmptyReports(raw)
  if (degenerate.length) {
    console.error('\n[coverage] 量具坏了：空报表丢了 source map ⇒ 分母退化成**文件行数**（含空行/注释），')
    console.error('           同一棵代码会凭空掉几个点。这不是覆盖率掉了，别拿这次的数当账：')
    for (const d of degenerate) console.error(`  - ${d}`)
    console.error('           成因：从未被 import 的文件走 (empty-report)，行数由 transform 的 source map 决定；')
    console.error('           那次 transform 抛的错被 provider 的 `.catch(() => void 0)` 吞了 ⇒ 退回原始源码行数。')
    console.error('           处理：在能拿到 source map 的环境里重量一次；**地板不许因此下调**（KI-330 的同一族）。')
    process.exit(2)
  }

  if (argv.bless) {
    const doc = {
      linesPct: Math.floor(m.linesPct * 100) / 100,
      byPackage: Object.fromEntries(Object.entries(m.byPackage).map(([p, v]) => [p, v.linesPct])),
      zeroFiles: m.zeroFiles,
      srcFilesAtMeasure: m.srcFiles,
      linesTotal: m.linesTotal,
      note: '由 npm run coverage -- --bless 写入。linesPct 是总地板、byPackage 是按包地板（都只许涨）；zeroFiles 是"今天确实没有任何测试执行过"的 src 文件名单，新增一格当场红。§6.1 那句"逻辑核心包各 ≥80%"**不写在这里**——它是脚本里的常量（CORE_PACKAGES/CORE_MIN），地板会被 bless 顺手重写，承诺不该跟着量具一起漂。'
    }
    writeFileSync(argv.floor, JSON.stringify(doc, null, 2) + '\n', 'utf8')
    console.log(`\n[coverage] 地板已写：${rel(argv.floor)} = ${doc.linesPct}% + ${Object.keys(doc.byPackage).length} 个包的地板 + ${doc.zeroFiles.length} 格零覆盖名单`)
    if (floor && doc.linesPct < floor.linesPct) {
      console.warn(`[coverage] 注意：总地板这是一次**下调**（${floor.linesPct}% → ${doc.linesPct}%）。地板下调必须有一个提交信息能解释的理由。`)
    }
    for (const [pkg, pct] of Object.entries(doc.byPackage)) {
      const before = floor?.byPackage?.[pkg]
      if (typeof before === 'number' && pct < before) {
        console.warn(`[coverage] 注意：包 ${pkg} 的地板下调了（${before}% → ${pct}%）——同样的理由要能写进提交信息。`)
      }
    }
    process.exit(0)
  }

  if (!floor) {
    console.error(`\n[coverage] 还没有地板文件（${rel(argv.floor)}）。先跑一次 npm run coverage -- --bless 建立基线。`)
    process.exit(1)
  }
  const { errors, warns } = decide(m, floor)
  for (const w of warns) console.warn(`[coverage] 提示：${w}`)
  if (errors.length === 0) {
    console.log(`[coverage] 通过：不低于总地板 ${floor.linesPct}%、${Object.keys(floor.byPackage ?? {}).length} 个包各自不低于自己的地板、零覆盖名单没有变长（名单 ${floor.zeroFiles.length} 格 / 实测 ${m.zeroFiles.length} 格）`)
    process.exit(0)
  }
  console.error('\n[coverage] 门红：')
  for (const e of errors) console.error(`  ✗ ${e}`)
  process.exit(1)
}

/** 只有"被直接运行"才跑 CLI；被 import（脚手架、以后的测试）时只交出纯函数。 */
const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (invoked === import.meta.url) main()
