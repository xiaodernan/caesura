import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * KI-063 / TD-004：行覆盖率这道门自己的测试。
 *
 * 判据一律**走真脚本**（`node scripts/coverage.mjs --summary=… --floor=…`），不在测试里重抄一遍
 * decide 的逻辑——一道只在"跑它的人自己试过一次"的门，等于没有门（两侧都必须来自源码）。
 * `--summary` 那条路是脚本自带的"只判读数"入口：让门能被喂夹具，而不是逼测试等 15 秒的真跑。
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = join(ROOT, 'scripts', 'coverage.mjs')
const FLOOR = join(ROOT, 'scripts', 'coverage-floor.json')
const TMP = mkdtempSync(join(tmpdir(), 'caesura-covgate-'))
let seq = 0

interface Row { path: string; covered: number; total: number }

/** istanbul 的 coverage-summary 形状（键是绝对路径 + 反斜杠，和 vitest 在 Windows 上写出的一样） */
function summary(rows: Row[], keyStyle: 'win' | 'posix' = 'win'): string {
  const out: Record<string, unknown> = {}
  const t = rows.reduce((a, r) => ({ total: a.total + r.total, covered: a.covered + r.covered }), { total: 0, covered: 0 })
  const pct = (c: number, tt: number) => (tt === 0 ? 100 : Math.round((c / tt) * 10000) / 100)
  out.total = { lines: { total: t.total, covered: t.covered, skipped: 0, pct: pct(t.covered, t.total) } }
  for (const r of rows) {
    const key = keyStyle === 'win' ? `${ROOT}\\${r.path}` : `${ROOT}/${r.path}`
    out[key] = { lines: { total: r.total, covered: r.covered, skipped: 0, pct: pct(r.covered, r.total) } }
  }
  const p = join(TMP, `sum-${++seq}.json`)
  writeFileSync(p, JSON.stringify(out), 'utf8')
  return p
}

function floorDoc(linesPct: number, zeroFiles: string[]): string {
  const p = join(TMP, `floor-${++seq}.json`)
  writeFileSync(p, JSON.stringify({ linesPct, zeroFiles, note: 'test' }), 'utf8')
  return p
}

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

afterAll(() => rmSync(TMP, { recursive: true, force: true }))

describe('coverage 门的判读（两侧都从脚本走）', () => {
  it('实测恰好等于地板 ⇒ 绿，并且报数带分母', () => {
    const s = summary([{ path: 'src/a.ts', covered: 50, total: 100 }, { path: 'src/b.ts', covered: 25, total: 50 }])
    const f = floorDoc(50, [])
    const r = run(`--summary=${s}`, `--floor=${f}`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('行覆盖 50.00%（75/150 行，2 个 src 文件')
  })

  it('跌 0.01 个百分点就红：地板不是"大概齐"，是硬下限', () => {
    const s = summary([{ path: 'src/a.ts', covered: 49, total: 100 }])
    const r = run(`--summary=${s}`, `--floor=${floorDoc(50, [])}`)
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain('低于地板')
  })

  it('多一个零覆盖文件 ⇒ 红，且点名是哪一个', () => {
    const s = summary([
      { path: 'src/a.ts', covered: 80, total: 100 },
      { path: 'src/newborn.ts', covered: 0, total: 40 }
    ])
    const r = run(`--summary=${s}`, `--floor=${floorDoc(57.14, [])}`)
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain('新增零覆盖文件 src/newborn.ts')
  })

  it('覆盖涨了 ⇒ 不红，但要把地板抬上来的话说出口', () => {
    const s = summary([{ path: 'src/a.ts', covered: 90, total: 100 }])
    const r = run(`--summary=${s}`, `--floor=${floorDoc(50, [])}`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('把地板抬上来')
  })

  it('名单里那一格今天被测到了 ⇒ 不红（那是别人的功劳），但提示要划掉', () => {
    const s = summary([{ path: 'src/a.ts', covered: 90, total: 100 }, { path: 'src/b.ts', covered: 10, total: 10 }])
    const r = run(`--summary=${s}`, `--floor=${floorDoc(90.91, ['src/b.ts'])}`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('今天不再是零覆盖')
  })

  it('纯类型文件（0 行可计）不冒充"没人测的模块"', () => {
    const s = summary([{ path: 'src/a.ts', covered: 50, total: 100 }, { path: 'src/data/schema.ts', covered: 0, total: 0 }])
    const r = run(`--summary=${s}`, `--floor=${floorDoc(50, [])}`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('无行可计')
    expect(r.out).not.toContain('新增零覆盖文件')
  })

  it('Windows 反斜杠键名归一回 src/…：名单形状与 git 路径同构', () => {
    const s = summary([{ path: 'src/a.ts', covered: 0, total: 10 }], 'win')
    const r = run(`--summary=${s}`, `--floor=${floorDoc(0, [])}`)
    expect(r.out).toContain('零覆盖文件 src/a.ts')
    expect(r.out).not.toContain('\\')
  })

  it('没有地板文件 ⇒ 拒绝判读并教怎么建立基线（不许"看起来没问题"）', () => {
    const s = summary([{ path: 'src/a.ts', covered: 1, total: 2 }])
    const r = run(`--summary=${s}`, `--floor=${join(TMP, 'nope.json')}`)
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain('还没有地板文件')
  })

  it('--bless 只能落在真跑上：拿夹具刷地板这条路是关的', () => {
    const s = summary([{ path: 'src/a.ts', covered: 100, total: 100 }])
    const r = run(`--summary=${s}`, `--bless`)
    expect(r.code, r.out).toBe(2)
    expect(r.out).toContain('地板只能由真跑写')
  })
})

describe('仓库里那份地板文件自身', () => {
  it('存在、是 0-100 的数、且名单里每一格今天在磁盘上还认得出来', () => {
    expect(existsSync(FLOOR), 'scripts/coverage-floor.json 必须在册（否则这道门没有下限）').toBe(true)
    const doc = JSON.parse(readFileSync(FLOOR, 'utf8')) as { linesPct: number; zeroFiles: string[] }
    expect(typeof doc.linesPct).toBe('number')
    expect(doc.linesPct).toBeGreaterThan(0)
    expect(doc.linesPct).toBeLessThanOrEqual(100)
    expect(Array.isArray(doc.zeroFiles)).toBe(true)
    for (const f of doc.zeroFiles) {
      expect(f.startsWith('src/'), `名单里这一格不是 src 路径：${f}`).toBe(true)
      expect(existsSync(join(ROOT, f)), `地板名单里的 ${f} 已经从磁盘上消失了：--bless 划掉它`).toBe(true)
    }
    expect(new Set(doc.zeroFiles).size, '名单不许有重复格子').toBe(doc.zeroFiles.length)
  })
})
