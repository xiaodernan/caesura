import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findUntrackedImportTargets,
  importSpecifiers,
  isLocalSpecifier,
  resolveLocal,
  ALIAS_ROOT,
} from '../../scripts/import-target-rules.mjs'

/**
 * KI-133 留的判据缺口：**本地 import 的目标必须被 git 认领**。
 *
 * 这一格量的是"提交之前就该红"的那件事：`src/main.ts` 早就在 import 四份从未进过版本库的模块，
 * 而那 7 条 TS2307 只有在工作树上偶然被 `tsc` 发现——任何按 HEAD 检出的平面（CI、别人的克隆、
 * 干净 worktree）都编译不过，主干的提交通道因此关掉了 5 天（KI-125）。
 *
 * 读数取**工作树**的文件（新建但还没 `git add` 的模块也要被看见）与 **git 索引**的认领集合
 * （`git ls-files`＝提交前钩子看到的那一份）⇒ 语义就是"提交前的那一刻能不能过"。
 */
const ROOT = resolve(process.cwd())

const gitLines = (args: string[]): string[] =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }).split(/\r?\n/).filter(Boolean)

/** 索引认领的仓库内路径（`/` 分隔） */
const tracked = new Set(gitLines(['ls-files']))

/** 工作树里 src/ 与 tests/ 下的 .ts 文件 */
const walk = (dir: string, acc: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (e.name.endsWith('.ts')) acc.push(p)
  }
  return acc
}

const worktreeFiles = (): { file: string; text: string }[] => {
  const out: { file: string; text: string }[] = []
  for (const root of ['src', 'tests']) {
    const dir = resolve(ROOT, root)
    if (!existsSync(dir)) continue
    for (const p of walk(dir)) {
      out.push({ file: p.slice(ROOT.length + 1).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') })
    }
  }
  return out
}

describe('import 目标必须被 git 认领（KI-133 的判据缺口）', () => {
  /** 探针：磁盘上是什么就是什么（文件／目录／没有） */
  const probe = (rel: string): 'file' | 'dir' | 'missing' => {
    const p = resolve(ROOT, rel)
    if (!existsSync(p)) return 'missing'
    return statSync(p).isDirectory() ? 'dir' : 'file'
  }

  it('工作树里没有一条本地 import 指向未被版本库认领的文件', () => {
    const files = worktreeFiles()
    const offenders = findUntrackedImportTargets(files, tracked, { probe })
    expect(
      offenders.map((o) => `${o.file}:${o.line} ${o.spec} → ${o.target}（${o.reason === 'missing' ? '磁盘上不存在' : '没被 git 认领'}）`),
      '这些 import 指向的文件既不在磁盘上、也不在 git 索引里：任何按 HEAD 检出的平面都编译不过（KI-125 那一族）',
    ).toEqual([])
  })

  it('判据的判据：抽取器在真树上读得到足够多的说明符（空扫描不许白送绿）', () => {
    const files = worktreeFiles()
    expect(files.length, '工作树里的 .ts 文件数').toBeGreaterThanOrEqual(150)
    let specs = 0
    for (const f of files) specs += importSpecifiers(f.text).length
    expect(specs, '抽出来的说明符数（本地＋裸包名）').toBeGreaterThanOrEqual(400)
  })

  it('别名与相对路径都解析成仓库内路径', () => {
    expect(isLocalSpecifier('@/vfx/Trails')).toBe(true)
    expect(isLocalSpecifier('./Foo')).toBe(true)
    expect(isLocalSpecifier('../Foo')).toBe(true)
    expect(isLocalSpecifier('three')).toBe(false)
    expect(isLocalSpecifier('vitest')).toBe(false)
    expect(resolveLocal('@/vfx/Trails', 'src/main.ts')).toBe(`${ALIAS_ROOT}/vfx/Trails`)
    expect(resolveLocal('./Foo', 'src/a/b.ts')).toBe('src/a/Foo')
    expect(resolveLocal('../Foo', 'src/a/b.ts')).toBe('src/Foo')
  })

  it('反向实测：一条指向未跟踪模块的 import 会被这条门抓住（且指名道姓）', () => {
    const synthetic = [
      { file: 'src/main.ts', text: "import { Trails } from '@/vfx/Trails'\n" },
      { file: 'src/other.ts', text: "const m = await import('@/vfx/GhostModule')\n" },
      { file: 'src/rel.ts', text: "import x from './NotThere'\n" },
      { file: 'src/pkg.ts', text: "import * as THREE from 'three'\n" },
    ]
    const trackedSet = new Set(['src/vfx/Trails.ts'])
    // 探针说"GhostModule 在磁盘上存在，但没被 git 认领"——那正是 KI-125 那一族的形状
    const probe = (rel: string): 'file' | 'dir' | 'missing' =>
      rel === 'src/vfx/Trails.ts' || rel === 'src/vfx/GhostModule.ts' ? 'file' : 'missing'
    const offenders = findUntrackedImportTargets(synthetic, trackedSet, { probe })
    expect(offenders.map((o) => o.reason).sort()).toEqual(['missing', 'untracked'])
    const ghost = offenders.find((o) => o.spec === '@/vfx/GhostModule')
    expect(ghost, '动态 import 也得被抓住（main.ts 里那批 await import 正是这一族）').toBeDefined()
    expect(ghost?.reason).toBe('untracked')
    expect(offenders.find((o) => o.spec === './NotThere')?.reason).toBe('missing')
    // 裸包名不归这一格（那是包管理器的事）
    expect(offenders.some((o) => o.spec === 'three')).toBe(false)
  })

  it('反向实测：注释与字符串里的 import 不算调用点（散文不是 import）', () => {
    const src = [
      "// import { Ghost } from '@/vfx/Ghost'",
      "/* import { Ghost2 } from '@/vfx/Ghost2' */",
      "const doc = \"import { Ghost3 } from '@/vfx/Ghost3'\"",
      "import { Real } from '@/vfx/Trails'",
    ].join('\n')
    const specs = importSpecifiers(src).map((s) => s.spec)
    expect(specs, '只有真 import 算；注释与字符串里的散文不算').toEqual(['@/vfx/Trails'])
  })

  it('反向实测：已跟踪的模块 import 不被报（判据不许把正常事说成病）', () => {
    const offenders = findUntrackedImportTargets(
      [{ file: 'src/main.ts', text: "import { Trails } from '@/vfx/Trails'\n" }],
      new Set(['src/vfx/Trails.ts']),
      { probe: (rel) => (rel === 'src/vfx/Trails.ts' ? 'file' : 'missing') },
    )
    expect(offenders).toEqual([])
  })
})
