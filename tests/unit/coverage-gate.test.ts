import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

function floorDoc(linesPct: number, zeroFiles: string[], byPackage?: Record<string, number>): string {
  const p = join(TMP, `floor-${++seq}.json`)
  const doc: Record<string, unknown> = { linesPct, zeroFiles, note: 'test' }
  if (byPackage) doc.byPackage = byPackage
  writeFileSync(p, JSON.stringify(doc), 'utf8')
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

describe('按包判据（KI-064：§6.1 那句门槛本来就是按包说的）', () => {
  /** 四个核心包各占一格：save 给一个可改的覆盖数，其余钉满，让"只让被测的那条规则出声"。 */
  const coreRows = (saveCovered: number): Row[] => [
    { path: 'src/combat/a.ts', covered: 100, total: 100 },
    { path: 'src/rpg/a.ts', covered: 100, total: 100 },
    { path: 'src/save/a.ts', covered: saveCovered, total: 100 },
    { path: 'src/quest/a.ts', covered: 100, total: 100 }
  ]

  it('某个包的行覆盖跌 0.01 ⇒ 红，并且点名是哪一个包', () => {
    const s = summary(coreRows(90))
    const r = run(`--summary=${s}`, `--floor=${floorDoc(97.5, [], { combat: 100, rpg: 100, save: 90.01, quest: 100 })}`)
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain('包 save 行覆盖 90.00% 低于该包地板 90.01%')
  })

  it('核心包低于 80% ⇒ 红，**即使它的地板就钉在 70%**（棘轮救不了不合规）', () => {
    const s = summary(coreRows(70))
    const r = run(`--summary=${s}`, `--floor=${floorDoc(92.5, [], { combat: 100, rpg: 100, save: 70, quest: 100 })}`)
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain('低于 §6.1 承诺的 80%（这是文档门槛，与地板无关）')
  })

  it('非核心包低于 80% ⇒ 不红（那条承诺只给了四个核心包，别拿它管表现层）', () => {
    const s = summary([...coreRows(100), { path: 'src/audio/a.ts', covered: 10, total: 100 }])
    const r = run(`--summary=${s}`, `--floor=${floorDoc(82, [], { combat: 100, rpg: 100, save: 100, quest: 100, audio: 10 })}`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).not.toContain('门红')
  })

  it('今天量到一个没进地板的新包 ⇒ 绿，但"落账"那句话要说出口', () => {
    const s = summary([...coreRows(100), { path: 'src/ui/a.ts', covered: 50, total: 100 }])
    const r = run(`--summary=${s}`, `--floor=${floorDoc(90, [], { combat: 100, rpg: 100, save: 100, quest: 100 })}`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('新包 ui 没进地板')
  })

  it('地板里列着的包今天没有文件 ⇒ 红（目录改名不许让某条门槛悄悄失去对象）', () => {
    const s = summary(coreRows(100))
    const r = run(`--summary=${s}`, `--floor=${floorDoc(100, [], { combat: 100, rpg: 100, save: 100, quest: 100, fight: 90 })}`)
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain('地板里的包 fight 今天没有一个可计行的文件')
  })

  it('旧地板（KI-063 那份，没有按包格子）⇒ 不红，但提示要落一次账', () => {
    const s = summary(coreRows(100))
    const r = run(`--summary=${s}`, `--floor=${floorDoc(100, [])}`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('地板里没有按包格子')
  })

  it('涨幅不到 0.5 个百分点 ⇒ 不开口；到了才提示抬地板（15 个包每包一句会把要读的两行淹掉）', () => {
    const s = summary(coreRows(100))
    const by = { combat: 100, rpg: 100, save: 100, quest: 100 }
    const small = run(`--summary=${s}`, `--floor=${floorDoc(99.6, [], by)}`)
    expect(small.code, small.out).toBe(0)
    expect(small.out).not.toContain('行覆盖已涨到')
    const big = run(`--summary=${s}`, `--floor=${floorDoc(99, [], by)}`)
    expect(big.code, big.out).toBe(0)
    expect(big.out).toContain('行覆盖已涨到 100.00%')
  })

  it('某个包涨得够多 ⇒ 点名那个包（按包的棘轮也要出声，不只是总覆盖）', () => {
    const s = summary(coreRows(100))
    const r = run(`--summary=${s}`, `--floor=${floorDoc(100, [], { combat: 100, rpg: 100, save: 99, quest: 100 })}`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('包 save 行覆盖已涨到 100.00%')
  })

  it('读数里星号只打在 §6.1 点名的那四个包上', () => {
    const s = summary([...coreRows(100), { path: 'src/audio/a.ts', covered: 90, total: 100 }])
    const r = run(`--summary=${s}`, `--floor=${floorDoc(98, [], { combat: 100, rpg: 100, save: 100, quest: 100, audio: 90 })}`)
    expect(r.code, r.out).toBe(0)
    for (const pkg of ['combat', 'rpg', 'save', 'quest']) expect(r.out).toContain(`★ ${pkg}`)
    expect(r.out).not.toContain('★ audio')
  })

  it('包的 pct 由加总后的行现算，不是把 istanbul 每个文件各自四舍五入过的 pct 再平均', () => {
    // 同一个包里 2/3 与 1/6：真值是 3/9 = 33.33%，而"两个文件的 pct 取平均"会读出 41.67%。
    const s = summary([
      { path: 'src/ui/a.ts', covered: 2, total: 3 },
      { path: 'src/ui/b.ts', covered: 1, total: 6 },
      ...coreRows(100).slice(1)
    ])
    const r = run(`--summary=${s}`, `--floor=${floorDoc(65.7, [], { ui: 33.33, rpg: 100, save: 100, quest: 100 })}`)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toMatch(/ui\s+33\.33%/)
    expect(r.out).not.toMatch(/ui\s+41\.67%/)
  })

  it('import 这份脚本不许顺手跑整套测试（顶层副作用是 KI-064 自己撞出来的地雷）', () => {
    const url = pathToFileURL(SCRIPT).href
    const r = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(url)}).then((m) => console.log(typeof m.measure))`], {
      encoding: 'utf8',
      timeout: 20000
    })
    expect(r.status, r.stderr).toBe(0)
    expect(String(r.stdout).trim()).toBe('function')
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

  it('按包那一格：四个核心包都在且各 ≥80，每个键今天在磁盘上还认得出来', () => {
    const doc = JSON.parse(readFileSync(FLOOR, 'utf8')) as { byPackage?: Record<string, number> }
    const bp = doc.byPackage
    expect(bp, '地板必须有 byPackage（KI-064 起）：没有它就等于按包门槛没人守').toBeTruthy()
    const script = readFileSync(SCRIPT, 'utf8')
    const listed = [...(script.match(/const CORE_PACKAGES = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
    const min = Number(script.match(/const CORE_MIN = (\d+)/)?.[1])
    expect(listed.length, '脚本里 CORE_PACKAGES 不许是空的').toBeGreaterThan(0)
    expect(Number.isFinite(min) && min > 0, '脚本里 CORE_MIN 必须是个正数').toBe(true)
    for (const pkg of listed) {
      expect(pkg in (bp as Record<string, number>), `地板里缺了核心包 ${pkg}`).toBe(true)
      expect((bp as Record<string, number>)[pkg], `核心包 ${pkg} 的地板低于 §6.1 的 ${min}%`).toBeGreaterThanOrEqual(min)
    }
    for (const pkg of Object.keys(bp as Record<string, number>)) {
      const v = (bp as Record<string, number>)[pkg]
      expect(v, `包 ${pkg} 的地板不是 0-100 的数`).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
      if (pkg === '(root)') continue
      expect(existsSync(join(ROOT, 'src', pkg)), `地板里的包 ${pkg} 在磁盘上没有 src/${pkg}/ 这一层`).toBe(true)
    }
  })

  it('脚本里的名单 == 架构文档 §6.1 那句话里的名单（改任一侧都必须两边一起改）', () => {
    const script = readFileSync(SCRIPT, 'utf8')
    const listed = [...(script.match(/const CORE_PACKAGES = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
    const min = script.match(/const CORE_MIN = (\d+)/)?.[1]
    const doc = readFileSync(join(ROOT, 'docs', 'technical-architecture.md'), 'utf8')
    const line = doc.match(/覆盖率门槛：逻辑核心包（([^）]*)）行覆盖 ≥(\d+)%/)
    expect(line, '§6.1 那句按包门槛的话还在文档里吗？它是这道门的另一半，删了它门就变成自说自话').not.toBeNull()
    expect(line![1].split('/')).toEqual(listed)
    expect(line![2]).toBe(min)
  })
})

describe('纯类型文件的排除名单（schema.ts 那 1359 行不是"没测的代码"）', () => {
  const SCHEMA = join(ROOT, 'src', 'data', 'schema.ts')

  it('名单里的文件今天仍然纯类型：谁往里加一行可执行语句，这条就红', () => {
    const script = readFileSync(SCRIPT, 'utf8')
    const raw = script.match(/const PURE_TYPE_FILES = \[([^\]]*)\]/)?.[1] ?? ''
    const listed = [...raw.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(listed.length, '排除名单不许是空的：空名单说明这段口径没人守').toBeGreaterThan(0)
    for (const f of listed) {
      expect(existsSync(join(ROOT, f)), `名单里的 ${f} 今天在磁盘上不在了：口径要跟着改，别留一格失效的豁免`).toBe(true)
      const src = readFileSync(join(ROOT, f), 'utf8')
      const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      // ① 不许出现任何可执行声明（interface/type 的成员都是类型，落不到 JS 里）
      // 用 [^\S\n]* 而不是 \s*：后者会跨行吞掉空白，把 `default: string` 这种成员名读成 `export default`
      expect(noComments, `${f} 里出现了可执行声明：它不再是纯类型文件，把 ${f} 从名单里挪出去并真去测它`)
        .not.toMatch(/^[^\S\n]*(export[^\S\n]+)?(const|let|var|function|class|enum)\b/m)
      // ② 不许出现副作用 import（那会让这个文件在运行时真的被加载，排除的理由就变了）
      expect(noComments, `${f} 里出现了非 type 的 import：它不再是"编译后为空"的文件`)
        .not.toMatch(/^\s*import\s+(?!type\b)/m)
      // ③ 顶层每一行只许是类型声明本身或它自己的收尾大括号
      const topLines = noComments.split('\n').filter((l) => l.length > 0 && !/^\s/.test(l))
      for (const l of topLines) {
        expect(l, `${f} 顶层出现了类型声明之外的行：${l.slice(0, 60)}`).toMatch(
          /^(import type |export (interface|type) |export type \{|})/
        )
      }
    }
  })

  it('脚本确实把名单交给了 vitest（名单失效时红的该是这道门，不是读数）', () => {
    const script = readFileSync(SCRIPT, 'utf8')
    expect(script, '排除名单必须被组装进 vitest 的命令行，否则 schema.ts 会把 1359 行类型声明算成 0 覆盖')
      .toContain('...PURE_TYPE_FILES.map((f) => `--coverage.exclude=${f}`)')
  })

  it('地板的零覆盖名单里不许有纯类型文件（那不是"没人测的模块"）', () => {
    const script = readFileSync(SCRIPT, 'utf8')
    const listed = [...((script.match(/const PURE_TYPE_FILES = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g))].map((m) => m[1])
    const doc = JSON.parse(readFileSync(FLOOR, 'utf8')) as { zeroFiles: string[] }
    for (const f of listed) {
      expect(doc.zeroFiles, `${f} 是纯类型文件，不该出现在零覆盖名单里（它一行代码都没有）`).not.toContain(f)
    }
    expect(existsSync(SCHEMA)).toBe(true)
  })
})
