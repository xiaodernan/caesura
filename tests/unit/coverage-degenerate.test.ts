/**
 * 覆盖率量具的「空报表丢了 source map」检测（`scripts/coverage.mjs > degenerateEmptyReports`）。
 *
 * 为什么单开一条：从未被任何测试 import 的文件走 v8 provider 的 `(empty-report)` 分支，它的
 * **可执行行数**由 `vitenode.transformRequest` 返回的 source map 决定。`getSources()` 把那次
 * transform 的异常 `.catch(() => void 0)` 吞掉之后会退回**原始源码** ⇒ 分母变成"文件行数"
 * （含空行与注释）⇒ 同一棵代码凭空掉 3 个点，报出来是一句假的「覆盖率低于地板」。
 *
 * 判据一律**走真脚本**（`--summary` 入口），不在测试里重抄检测逻辑——与 `coverage-gate.test.ts`
 * 同一条纪律：门自己的判据必须来自源码，不能是测试里的第二份实现。
 *
 * 三条腿：① 退化形态 exit 2 且点名文件、且**不许**报成「低于地板」；
 *          ② 可执行行数（< 文件行数）不误判；③ 有覆盖的文件不参与。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = join(ROOT, 'scripts', 'coverage.mjs')
const FLOOR = join(ROOT, 'scripts', 'coverage-floor.json')
const TMP = mkdtempSync(join(tmpdir(), 'caesura-covdegen-'))
let seq = 0

/** 按 `wc -l` 的口径数物理行（末尾换行不算多一行） */
function physicalLines(rel: string): number {
  const lines = readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/)
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
}

/** istanbul 的 coverage-summary 形状（键是绝对路径，和 vitest 在 Windows 上写出的一样） */
function summaryFor(rel: string, total: number, covered: number): string {
  const pct = total === 0 ? 100 : Math.round((covered / total) * 10000) / 100
  const out: Record<string, unknown> = {
    total: { lines: { total, covered, pct } },
    [join(ROOT, rel)]: { lines: { total, covered, pct } },
  }
  const p = join(TMP, `sum-${++seq}.json`)
  writeFileSync(p, JSON.stringify(out), 'utf8')
  return p
}

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

afterAll(() => rmSync(TMP, { recursive: true, force: true }))

/** 一个真实的、从未被 import 的 src 文件（它的物理行数是稳定的读数） */
const REAL = 'src/world/PlaceholderArena.ts'

describe('coverage 量具：空报表丢 source map 的检测（§78 量具坏了 ≠ 覆盖率掉了）', () => {
  it('零覆盖 + total 恰好等于文件行数 ⇒ exit 2，且不许报成「低于地板」', () => {
    const physical = physicalLines(REAL)
    const r = run(`--summary=${summaryFor(REAL, physical, 0)}`, `--floor=${FLOOR}`)
    expect(r.code, r.out).toBe(2)
    expect(r.out).toContain('量具坏了')
    expect(r.out).toContain(REAL)
    expect(r.out, '这是量具坏了，不是覆盖率掉了').not.toContain('低于地板')
  })

  it('零覆盖但 total 是可执行行数（< 文件行数）⇒ 走正常判读，不报量具坏了', () => {
    const physical = physicalLines(REAL)
    const r = run(`--summary=${summaryFor(REAL, physical - 1, 0)}`, `--floor=${FLOOR}`)
    expect(r.out).not.toContain('量具坏了')
  })

  it('有覆盖的文件不参与（真 coverage 不经过空报表）', () => {
    const physical = physicalLines(REAL)
    const r = run(`--summary=${summaryFor(REAL, physical, 5)}`, `--floor=${FLOOR}`)
    expect(r.out).not.toContain('量具坏了')
  })
})
