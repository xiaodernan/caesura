import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findUntrackedImportTargets,
  importCensus,
  importSpecifiers,
  isLocalSpecifier,
  moduleRefsOf,
  resolveLocal,
  ALIAS_ROOT,
  REF_SHAPES,
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
 *
 * **KI-440 在这一格里加了第二格**（`importCensus`）：被 import 到的每一份 `.mjs` 脚本必须有自己的
 * `.d.mts`；`await import(VAR)` 那种经由本文件顶层常量的引用单独报 `dodge`；参数数不出说明符的动态
 * import 报 `opaque`。两格读同一批位点——抽取器在 KI-440 里从「三个正则扫文本」换成 TypeScript 的 AST，
 * 换嘴的代价与收获都在真总体上量过（`.scratch/ki440/probe-extractor.mjs`，505 份 `.ts`）：
 *   ① 文本版多读 **27 枚**根本不存在的 import——正则体与模板串里的散文被当成了说明符，其中一枚是 `[^`
 *      （`tests/unit/action-labels.test.ts` 读到的是**另一份用来抓 import 的正则自己**），另一枚跨了三行；
 *   ② 文本版少读 **1 枚**真 import：`ledger-rules.test.ts` 那枚 `import(VALIDATOR_SPEC as string)`；
 *   ③ 换成 AST 后同一份总体上「说明符里带反斜杠／括号／尖括号／换行」的枚数 27 → **0**，
 *      而 refs 从 3810 → 3783（少的正是那 27 枚，多的正是那 1 枚——两向都对得上数）。
 * 根因写在 `import-target-rules.mjs` 的文件头：`inString` 是按整条匹配的头（`from` 那个词）判的，
 * 而正则体里的 `from` 在词法上是代码。**地板 `specs ≥ 400` 今天替幻影记了 27 枚的账**，所以那一条
 * 也一并改读同一趟扫描（下面 `CENSUS`），不留第二把尺。
 */
const ROOT = resolve(process.cwd())

const gitLines = (args: string[]): string[] =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }).split(/\r?\n/).filter(Boolean)

/** 索引认领的仓库内路径（`/` 分隔） */
const tracked = new Set(gitLines(['ls-files']))

/**
 * 有声明的那一份：按**扩展名**收，且含「未跟踪但未忽略」的（与 KI-439 的工作副本那一趟同口径——
 * 新加的声明要能在 `git add` 之前就算数，否则落库前那一步读得比主干还窄）。
 */
const declared = new Set(
  gitLines(['ls-files', '--cached', '--others', '--exclude-standard']).filter((p) => p.endsWith('.d.mts')),
)

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

/** 总体只扫这一趟：两格判据、三个地板与形状名册都从它出来（第二趟自己就是 KI-342 那一族的病） */
const POP = worktreeFiles()
const CENSUS = importCensus(POP, { declared })

/** 一条漂移报成一句人话：kind 只说种类，话说的是那枚说明符、那个位点与缺的那一份。 */
const say = (f: { kind: string; file: string; line: number; spec: string | null; target: string | null; decl?: string; text?: string }): string => {
  if (f.kind === 'undeclared') return `未声明：${f.file}:${f.line} import ${f.spec} → ${f.target}，而名册里没有 ${f.decl}`
  if (f.kind === 'dodge') return `躲法：${f.file}:${f.line} 经由变量 import ${f.spec} ⇒ 这条 import 在类型层里看不见`
  if (f.kind === 'opaque') return `数不出：${f.file}:${f.line} import(${f.text}) 的参数不是说明符`
  return `未名状：${f.kind}`
}

describe('import 目标必须被 git 认领（KI-133 的判据缺口）', () => {
  /** 探针：磁盘上是什么就是什么（文件／目录／没有） */
  const probe = (rel: string): 'file' | 'dir' | 'missing' => {
    const p = resolve(ROOT, rel)
    if (!existsSync(p)) return 'missing'
    return statSync(p).isDirectory() ? 'dir' : 'file'
  }

  it('工作树里没有一条本地 import 指向未被版本库认领的文件', () => {
    const offenders = findUntrackedImportTargets(POP, tracked, { probe })
    expect(
      offenders.map((o) => `${o.file}:${o.line} ${o.spec} → ${o.target}（${o.reason === 'missing' ? '磁盘上不存在' : '没被 git 认领'}）`),
      '这些 import 指向的文件既不在磁盘上、也不在 git 索引里：任何按 HEAD 检出的平面都编译不过（KI-125 那一族）',
    ).toEqual([])
  })

  it('判据的判据：抽取器在真树上读得到足够多的说明符（空扫描不许白送绿）', () => {
    expect(POP.length, '工作树里的 .ts 文件数').toBeGreaterThanOrEqual(150)
    expect(CENSUS.refs, '同一趟扫描读到的 import 位点总数（本地＋裸包名）').toBeGreaterThanOrEqual(3000)
    expect(
      POP.reduce((n, f) => n + importSpecifiers(f.text, f.file).length, 0),
      '投影出来的说明符枚数与位点数对不上 ⇒ 有一边读空了',
    ).toBe(CENSUS.refs - (CENSUS.shapes.opaque ?? 0))
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

describe('import 层的声明对账（KI-440：被 import 的脚本要有 .d.mts，走过变量的引用要报名）', () => {
  it('真总体上三种漂移各 0 枚', () => {
    expect(CENSUS.findings.map(say), '未声明／躲法／数不出三张名单').toEqual([])
  })

  /**
   * 地板与名册全部从 `CENSUS` 这一趟出来。
   *
   * 「`findings` 为空」有两种：一种是真的干净，一种是总体读空了（`src`/`tests` 走查失效、抽取器换了嘴
   * 却不认这批拼法）。前者是绿，后者是白送的绿——所以这一格先钉总体：脚本名册、声明名册、形状账本
   * 三样都要有量，且形状账本的总和必须等于位点总数（少一枚就是有一类位点没进账）。
   */
  it('地板出自同一趟扫描：总体、脚本名册与形状账本都不许读空', () => {
    expect(CENSUS.targets.length, '被 .ts 侧 import 到的 .mjs 脚本数').toBeGreaterThanOrEqual(30)
    expect(declared.size, '仓库里的 .d.mts 声明数').toBeGreaterThanOrEqual(30)
    expect(
      [...new Set(CENSUS.targets.map((t) => t.slice(t.lastIndexOf('.'))))].sort(),
      '脚本名册的后缀：非 .mjs 混进来＝未声明那一判据在评一个不存在的人群',
    ).toEqual(['.mjs'])
    expect(
      Object.values(CENSUS.shapes).reduce((n, v) => n + v, 0),
      '形状账本之和 ≠ 位点总数 ⇒ 有一类位点没进账',
    ).toBe(CENSUS.refs)
  })

  /**
   * 冗余复述（第二条路）：名册自己算一遍「缺声明」，与 `findings` 里的 `undeclared` 对不上就是判据坏了。
   * 只比对同一份 targets／declared，不重跑抽取器——重跑是第二把尺。
   */
  it('第二条路：名册与声明直接对账，数出来的缺声明清单也是空', () => {
    const missingDecl = CENSUS.targets.filter((t) => !declared.has(`${t.slice(0, -'.mjs'.length)}${'.d.mts'}`))
    expect(missingDecl, '脚本名册里每一份的配对声明都要在名册里').toEqual([])
    for (const t of CENSUS.targets) {
      expect(existsSync(resolve(ROOT, t)), `名册说 ${t} 被 import 到，磁盘上就得真有它`).toBe(true)
    }
  })

  /**
   * 本批的主题那一枚，钉成不会漂的具名主语：校验器那趟 import 现在住在类型层里。
   *
   * 四条各自指着 KI-440 改掉的那一件事——形状回到 `dynamic`（字面 specifier）、配对声明进了 git 名册、
   * 声明里确实写着那个唯一被外部读到的值导出、而躲法那半句源码不再出现在发起文件里。
   * 谁把 `import(VAR as string)` 加回来，`shape` 那条先红；谁删声明，`declared` 那条先红。
   */
  it('具名主语：validate-data 那枚 import 回到类型层，配对声明在场', () => {
    const hits = POP.flatMap((f) =>
      moduleRefsOf(f.text, f.file)
        .filter((r) => r.spec !== null && resolveLocal(r.spec as string, f.file) === 'scripts/validate-data.mjs')
        .map((r) => ({ ...r, file: f.file })),
    )
    expect(hits.length, '指向 scripts/validate-data.mjs 的 import 位点数').toBe(1)
    const ref = hits[0]
    expect(ref.file).toBe('tests/unit/ledger-rules.test.ts')
    expect(ref.shape, '字面 specifier ⇒ dynamic；换成 import(VAR as string) 就离开类型层（本批的起因）').toBe('dynamic')
    expect(declared.has('scripts/validate-data.d.mts'), 'KI-439 那道门要的配对声明要在 git 名册里').toBe(true)
    const decl = readFileSync(resolve(ROOT, 'scripts/validate-data.d.mts'), 'utf8')
    expect(decl, '声明要写得出那个唯一被外面读到的值导出').toContain('GRANT_FIELDS')
    // 躲法回来了没有？按**位点形状**判，不按源码字节找 `as string`：那个文件现在正把旧写法写在注释里
    // 作史料（散文里点名一枚 token 就会被按字节找它的门当成调用点——同一族的病，KI-440 自己撞过一次）。
    const own = importCensus(POP.filter((f) => f.file === ref.file), { declared })
    expect(own.findings.map(say), '发起文件里不该再有经由变量的 import').toEqual([])
  })

  it('植入：缺声明的 .mjs 目标被报未声明，且点名缺的那一份；补上声明就转绿', () => {
    const files = [{ file: 'src/a.ts', text: "import { x } from './ghost.mjs'\n" }]
    const red = importCensus(files, { declared: new Set() })
    expect(red.findings.map(say).sort(), '未声明要说清发起位点与缺的路径').toEqual([
      '未声明：src/a.ts:1 import ./ghost.mjs → src/ghost.mjs，而名册里没有 src/ghost.d.mts',
    ])
    // 两侧：声明在场 ⇒ 同一条 import 不再被报（判据不许把正常事说成病）
    expect(importCensus(files, { declared: new Set(['src/ghost.d.mts']) }).findings).toEqual([])
    // 非 .mjs 的目标不归这一格（那是 KI-133 那一格的事）
    expect(importCensus([{ file: 'src/a.ts', text: "import { y } from './y'\n" }], { declared: new Set() }).findings).toEqual([])
  })

  it('植入：经由本文件顶层常量的动态 import 报 dodge——即使声明齐了也报', () => {
    const alias = ["const SPEC = './x.mjs'", 'const m = await import(SPEC)\n'].join('\n')
    const asString = ["const SPEC = './x.mjs'", 'const m = await import(SPEC as string)\n'].join('\n')
    const declaredX = new Set(['src/x.d.mts'])
    for (const [text, shape] of [
      [alias, 'alias'],
      [asString, 'alias-as-string'],
    ] as const) {
      const c = importCensus([{ file: 'src/a.ts', text }], { declared: declaredX })
      expect(c.shapes[shape], `${shape} 要进账`).toBe(1)
      expect(c.findings.map(say), '声明在场，报的是形状不是缺声明').toEqual([
        `躲法：src/a.ts:2 经由变量 import ./x.mjs ⇒ 这条 import 在类型层里看不见`,
      ])
    }
    // 两侧：同一枚说明符写成字面量 ⇒ dodge 消失（这一格抓的是「走过变量」，不是动态 import 本身）
    expect(
      importCensus([{ file: 'src/a.ts', text: "const m = await import('./x.mjs')\n" }], { declared: declaredX }).findings,
      '字面量的动态 import 照样在类型层里，不该被算成躲法',
    ).toEqual([])
  })

  it('植入：数不出说明符的动态 import 报 opaque 并带回源码，而不是安静跳过', () => {
    const files = [
      { file: 'src/t1.ts', text: "const p = 'x'\nawait import(`./mod/${p}`)\n" },
      { file: 'src/t2.ts', text: 'function load(p: string) {\n  return import(p)\n}\n' },
      { file: 'src/t3.ts', text: 'await import(cfg.spec)\n' },
      { file: 'src/t4.ts', text: 'await import()\n' },
    ]
    const c = importCensus(files, { declared })
    expect(c.refs, 'opaque 也要进位点总数（漏一类＝地板跟着撒谎）').toBe(4)
    expect(c.shapes.opaque, '四种拼法各自一枚').toBe(4)
    expect(c.findings.every((f) => f.kind === 'opaque' && f.spec === null), 'opaque 数不出说明符，但一定报名').toBe(true)
    const said = c.findings.map(say)
    expect(said.length).toBe(4)
    expect(said.join('\n'), '红时要能看出是哪一段源码').toContain('`./mod/${p}`')
    expect(said.join('\n')).toContain('import(cfg.spec)')
    expect(said.join('\n')).toContain('import(p)')
    expect(said.join('\n')).toContain('import()')
  })

  /**
   * 27 枚幻影的解药：正则字面量与模板串在 AST 上不是 import 位点。
   * 这里放的正是本仓真出现过的那几种拼法，包括**旧抽取器自己的那条正则**（它读到过 `[^`）。
   */
  it('正则体与模板串里的 import 散文一枚都不算；export-from／侧效／import type 都算 static', () => {
    const src = [
      "const RE = /from ['\"]\\.\\/Ghost['\"]/g",
      "const OLD = /import\\s*{[^}]*}\\s*from\\s*['\"]([^'\"]+)['\"]/",
      "const note = `把 import { A } from './Ghost2' 写在散文里`",
      "import { Real } from './Real'",
      "export { Real } from './Real2'",
      "import './side-effect'",
      "import type { T } from './types'",
    ].join('\n')
    const refs = moduleRefsOf(src, 'src/a.ts')
    expect(refs.map((r) => r.spec), '只有真位点算；幻影拼法一枚不进').toEqual(['./Real', './Real2', './side-effect', './types'])
    expect(refs.every((r) => r.shape === 'static'), '这四种拼法都是 static').toBe(true)
    // 行号钉在说明符自己那一行（多行 import 报 `from` 那行）——上一格那批位点的坐标与文本版同尺
    expect(refs.map((r) => r.line), '每条各自的行号').toEqual([4, 5, 6, 7])
  })

  it('形状名册 ⇄ 账本：出现过的形状必须是 REF_SHAPES 里写过的', () => {
    expect(Object.keys(CENSUS.shapes).sort(), '门里没写过的形状＝判据在评一个未名状的东西').toEqual(
      Object.keys(CENSUS.shapes).filter((k) => REF_SHAPES.includes(k as never)).sort(),
    )
    // 真总体上今天没有 alias／alias-as-string／opaque ⇒ 各自 0 枚；账本不写零，但名册要留着这三行
    expect(REF_SHAPES.slice().sort()).toEqual(['alias', 'alias-as-string', 'dynamic', 'opaque', 'static'])
    expect(REF_SHAPES.length, '名册一枚不许被删（删了就是把一类位点隐形）').toBe(5)
  })
})
