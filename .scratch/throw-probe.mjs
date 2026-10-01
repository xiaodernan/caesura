/**
 * KI-023① 投掷块那三条验证器规则的反向实测（跑完逐字节还原 items.json）。
 * 每刀只改一处，读 `node scripts/validate-data.mjs` 的 stdout，数命中门槛的 ERROR 条数。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const FILE = 'src/data/json/items.json'
const orig = readFileSync(FILE, 'utf8')
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12)

const CASES = [
  {
    name: 'A1 只写 throw（删掉 corruption）⇒ 应被接受（0 条 use 相关 ERROR）',
    mutate: (t) => t.replace(/\n   "corruption": -25,/, ''),
    expect: (errs) => errs.filter((l) => l.includes('.use')).length === 0,
  },
  {
    name: 'A2 loudness 改成 2（越过 (0,1]）⇒ 应报 use.throw 区间',
    mutate: (t) => t.replace('"loudness": 0.8', '"loudness": 2'),
    expect: (errs) => errs.some((l) => l.includes('use.throw') && l.includes('合法区间')),
  },
  {
    name: 'A3 speed 改成 "fast"（非数字）⇒ 应报该格必须是有限数字',
    mutate: (t) => t.replace('"speed": 11', '"speed": "fast"'),
    expect: (errs) => errs.some((l) => l.includes('use.throw.speed') && l.includes('有限数字')),
  },
  {
    name: 'A4 把 throw 改名成 toss（没有消费方的用法）⇒ 应报"没有消费方"',
    mutate: (t) => t.replace('"throw": {', '"toss": {'),
    expect: (errs) => errs.some((l) => l.includes('use.toss') && l.includes('没有消费方')),
  },
  {
    name: 'A5 整块 use 清成 {}（一个用法都不写）⇒ 应报"必须至少写…之一"',
    mutate: (t) => t.replace(/"use": \{[\s\S]*?\n  \}/, '"use": {}'),
    expect: (errs) => errs.some((l) => l.includes('必须至少写')),
  },
]

function run() {
  let out = ''
  try {
    out = execFileSync(process.execPath, ['scripts/validate-data.mjs'], { encoding: 'utf8' })
  } catch (e) {
    out = String(e.stdout ?? '') + String(e.stderr ?? '')
  }
  // 只认**findings 行**（`  ERROR  …`）：汇总行 `-- 0 ERROR / 1 WARN` 与 `OK — 无 ERROR / WARN`
  // 里都带这五个字母，按 includes 数出来的读数是假的（第一版就是这么被骗到「对照 22 条」的）。
  return out.split('\n').map((l) => l.trim()).filter((l) => /^ERROR\b/.test(l))
}

try {
  const baseline = run()
  console.log(`对照（未变异）：ERROR ${baseline.length} 条`)
  for (const c of CASES) {
    const mutated = c.mutate(orig)
    if (mutated === orig) {
      console.log(`  ✗ ${c.name} —— 变异没生效（替换没匹配上），这一刀不算测过`)
      continue
    }
    writeFileSync(FILE, mutated)
    const errs = run()
    const ok = c.expect(errs)
    console.log(`  ${ok ? '✓' : '✗'} ${c.name}`)
    for (const l of errs) console.log(`        ${l}`)
  }
} finally {
  writeFileSync(FILE, orig)
  console.log(`还原：items.json sha256 ${sha(readFileSync(FILE, 'utf8'))}（原 ${sha(orig)}）`)
}
