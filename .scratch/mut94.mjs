/**
 * KI-094① 的变异探针：八臂，每臂**事前**写下"哪几条用例必须红"，跑完对照，然后把文件按 sha256 还原。
 *
 * 跑法：`node .scratch/mut94.mjs`（必须在仓库根，脚本用绝对路径）
 * 每一臂都是"改掉一个真实机制的值/条件"，不是删代码造成语法崩溃（那种红什么都不证明）。
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const ROOT = 'D:/法环游戏'
const OUT = `${ROOT}/.scratch/mut94_report.json`
const BAK = `${ROOT}/.scratch/mut94_bak`
mkdirSync(BAK, { recursive: true })

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16)

const FILES = [
  'src/vfx/ColorGrade.ts',
  'src/main.ts',
  'scripts/weather-rules.mjs',
  'src/data/json/weather.json',
]
const orig = {}
for (const f of FILES) {
  orig[f] = { bytes: readFileSync(`${ROOT}/${f}`), sha: sha(`${ROOT}/${f}`) }
  writeFileSync(`${BAK}/${f.replace(/[\/.]/g, '_')}`, orig[f].bytes)
}
console.log('备份完成（原文件 sha256 前 16 位）：')
for (const f of FILES) console.log(`  ${f}  ${orig[f].sha}`)

function runTest(rel) {
  const r = spawnSync(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', rel, '--reporter=json', `--outputFile=${OUT}`, '--minWorkers=1', '--maxWorkers=2'],
    { cwd: ROOT, encoding: 'utf8', timeout: 240000 },
  )
  let j = null
  try { j = JSON.parse(readFileSync(OUT, 'utf8')) } catch { j = null }
  if (!j) {
    return { crashed: true, rc: r.status, out: (r.stderr || r.stdout || '').split('\n').slice(0, 6).join(' | ') }
  }
  const failed = []
  let total = 0
  for (const tr of j.testResults || []) {
    for (const a of tr.assertionResults || []) {
      total++
      if (a.status === 'failed') failed.push(a.title)
    }
  }
  return { crashed: false, rc: r.status, failed, total }
}

const ARMS = [
  {
    id: 'A1_天气盖掉失谐',
    file: 'src/vfx/ColorGrade.ts',
    search: 'const next = gradeFilter(this.veil, r ?? {})',
    replace: 'const next = gradeFilter(0, r ?? {})',
    test: 'tests/unit/color-grade.test.ts',
    predict: ['失谐读数落在天气之上'],
    note: '把 veil 输入掐成 0：天气单独往 filter 上写，失谐看不见 = §11 的视觉压力整条消失',
  },
  {
    id: 'A2_去掉"没变就不写"',
    file: 'src/vfx/ColorGrade.ts',
    search: '    if (next === this.applied) return\n',
    replace: '',
    test: 'tests/unit/color-grade.test.ts',
    predict: ['每帧被叫同一个读数'],
    note: 'applied 那格失效 ⇒ 每帧重排 CSS filter',
  },
  {
    id: 'A3_雾那格没有读数也写',
    file: 'src/vfx/ColorGrade.ts',
    search: 'if (fog && typeof density === \'number\') fog.density = density',
    replace: 'if (fog) fog.density = density as unknown as number',
    test: 'tests/unit/color-grade.test.ts',
    predict: ['表里这一行没给雾密度'],
    note: '那一行没说雾 ⇒ 却把别人的雾写成 undefined',
  },
  {
    id: 'A4_换区不喂天气（main.ts）',
    file: 'src/main.ts',
    search: '\n      grade.setRegion(here)',
    replace: '',
    test: 'tests/unit/color-grade.test.ts',
    predict: ['canvas.style.filter` 的赋值点只剩 ColorGrade 一处'],
    note: '第一轮：只写 `toMatch` 的门上这一臂**存活**（开局那次调用替它留着字符串）⇒ 门改成按行首数语句次数，第二轮必须红',
  },
  {
    id: 'A5_表里把 Fog 的对比写成 1',
    file: 'src/data/json/weather.json',
    search: '"contrastMul": 0.6',
    replace: '"contrastMul": 1',
    test: 'tests/unit/weather-table.test.ts',
    predict: ['真表在真名册与真 pending 账下不响', '都能在文档那一行找到出处'],
    note: '乘数 1 是"没有后果的读数"，而文档给的是 ×0.6',
  },
  {
    id: 'A6_雾密度上界收到比文档还小',
    file: 'scripts/weather-rules.mjs',
    search: "export const FOG_DENSITY_MAX = 0.12",
    replace: "export const FOG_DENSITY_MAX = 0.02",
    test: 'tests/unit/weather-table.test.ts',
    predict: ['真表在真名册与真 pending 账下不响', '越过上界'],
    note: '界本身必须是活的：收到 0.02 时真表的 fog 0.03 就该红，而"界从判据读"那条也要跟着改口径',
  },
  {
    id: 'A7_死数据那条判据闭嘴',
    file: 'scripts/weather-rules.mjs',
    search: '    if (!referenced.includes(row.id)) {',
    replace: '    if (false && !referenced.includes(row.id)) {',
    test: 'tests/unit/weather-table.test.ts',
    predict: ['没有任何一区指着的行'],
    note: '判据③关掉 ⇒ §55 的死行从此没人报',
  },
]

const results = []
const only = process.argv[2]
for (const arm of ARMS) {
  if (only && !arm.id.startsWith(only)) continue
  const path = `${ROOT}/${arm.file}`
  const before = readFileSync(path, 'utf8')
  const hits = before.split(arm.search).length - 1
  if (hits !== 1) {
    results.push({ id: arm.id, skip: `搜索串命中 ${hits} 次（要 1 次）：这一臂没落地，不算数` })
    console.log(`\n[${arm.id}] 跳过：搜索串命中 ${hits} 次`);
    continue
  }
  writeFileSync(path, before.replace(arm.search, arm.replace), 'utf8')
  const res = runTest(arm.test)
  copyFileSync(`${BAK}/${arm.file.replace(/[\/.]/g, '_')}`, path)
  const restored = sha(path) === orig[arm.file].sha
  if (!restored) console.log(`!! ${arm.file} 还原后 sha 不一致 — 停，别继续跑后面的臂`)
  if (res.crashed) {
    results.push({ id: arm.id, crashed: true, detail: res.out })
    console.log(`\n[${arm.id}] 运行器崩了（rc=${res.rc}）：${res.out}`)
    continue
  }
  const got = res.failed
  const missed = arm.predict.filter((p) => !got.some((t) => t.includes(p)))
  const extra = got.filter((t) => !arm.predict.some((p) => t.includes(p)))
  const verdict = got.length === 0 ? 'SURVIVED' : missed.length === 0 ? 'CAUGHT' : 'WRONG-CASE'
  results.push({ id: arm.id, verdict, ran: `${res.total - got.length}/${res.total}`, got, missed, extra, restored })
  console.log(`\n[${arm.id}] ${verdict}（跑了 ${res.total} 条，红 ${got.length} 条；还原=${restored}）`)
  console.log(`   事前预测：${arm.predict.join(' / ') || '（故意预测存活）'}`)
  console.log(`   实际红：${got.map((t) => t.slice(0, 40)).join(' / ') || '（无）'}`)
  if (missed.length) console.log(`   预测没兑现：${missed.join(' / ')}`)
  if (extra.length) console.log(`   额外的红：${extra.map((t) => t.slice(0, 40)).join(' / ')}`)
  console.log(`   ${arm.note}`)
}

// 未变异的对照：每一臂跑完都还原了，这里再跑一次两个文件，确认平面回到原样
for (const t of ['tests/unit/color-grade.test.ts', 'tests/unit/weather-table.test.ts']) {
  const res = runTest(t)
  console.log(`\n[对照] ${t}：${res.crashed ? '崩' : `${res.total - res.failed.length}/${res.total} 绿，红 ${res.failed.length}`}，` +
    `文件 sha 全部一致 = ${FILES.every((f) => sha(`${ROOT}/${f}`) === orig[f].sha)}`)
}
console.log('\n汇总：')
for (const r of results) console.log(`  ${r.id}: ${r.verdict || (r.crashed ? 'CRASH' : 'SKIP')}${r.skip ? ' — ' + r.skip : ''}${r.ran ? ` (${r.ran})` : ''}`)
