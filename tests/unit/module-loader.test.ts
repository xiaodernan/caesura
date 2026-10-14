import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  cliNamedScripts,
  inProcessClosure,
  loaderHazards,
  scriptLiterals,
  shebangOf,
} from '../../scripts/module-loader-rules.mjs'

/**
 * 「被测试进程内 import 的脚本必须在干净检出的字节上也加载得动」（KI-118）。
 *
 * 起因是当场撞上的红，不是设想：KI-115 把全量套件搬到平面（HEAD 的干净检出）上跑，红的第二条不是计数而是
 * `tests/unit/ledger-rules.test.ts` 那条「进程内跑真校验器」——
 * `D:\法环-m133plane\scripts\validate-data.mjs:19  #!/usr/bin/env node  ^  SyntaxError: Invalid or unexpected token`。
 * 同一份 HEAD 字节，开发用的工作副本里那个文件恰好是 LF 就绿，按 `core.autocrlf=true` 检出来是 CRLF 就红。
 * 四趟实测（全部在平面 `D:/法环-m133plane` = HEAD 的干净检出上，跑完逐字节验回，`.scratch/ki118/probe-eol.mjs`、
 * `.scratch/ki118/probe-shebang.mjs`）：CRLF ⇒ 红；同一份改成 LF ⇒ 12 条全绿；改回 CRLF ⇒ 红又回来
 * （同一把锁第二次由读数说话）；**留 CRLF、只删第一行那句 shebang ⇒ 12 条全绿**。
 *
 * **机制只量到这一步，判据也不超过这一步**。原话写成"vm 只认第 0 字节的 shebang"会被当场否证：
 * `new vm.Script('#!/usr/bin/env node\r\nconst x=1')` 单独跑是编译得过的（`.scratch/ki118/probe-vm.mjs`，
 * LF/CRLF/CR 三种行尾都过），所以红不在 `vm` 那一层，而在 vite-node 的 SSR 变换那一层——报错把 `#!` 指到
 * **变换后代码的第 19 行**，那一刻它已经不是 shebang 而是非法 token。为什么 LF 那一份把这一行剥掉了、CRLF 那一份
 * 没剥，我没有量到（要读 vite 内部才能说，而这条门不需要那个说法）。判据钉的是可复跑的那件事：
 * **这种文件在 vitest 进程内加载不动**。把没量到的机制写进注释就是 KI-113 那一族债务的下一个世代。
 *
 * **判据读 HEAD 的 blob，不读工作副本**（与 KI-114「主干自证」同一只手，同一个理由）：这条门要回答的是
 * "新克隆能不能自证"，不是"我这台机器现在绿不绿"。工作副本在这个仓库里不是可信平面——`scripts/validate-data.mjs`
 * 此刻正带着并发会话未提交的注释改动，读它会让判据跟着别人的在途字节变宽变窄。名册走 `git ls-tree`（提交面），
 * 内容走一次 `git cat-file --batch`。唯一读工作副本的是账本那一格：登记这件事本来就发生在工作副本
 * （KI-114 结案时立的同一取舍——否则每一批都在自己的落地提交之前先红一次，而那条红不携带新信息）。
 * 由此得一条**落地顺序**：这条门读 HEAD ⇒ 平面上的提交之前它必然还是红的，所以顺序只能是
 * 提交到平面 → 在平面上跑全量（此刻 HEAD 已含修复）→ 才 `update-ref` 挪主干。
 *
 * 两臂的读数钉在这里（`.scratch/ki118/arms2.mjs`，七臂 + 对照）：**读 HEAD 有一个代价**——HEAD 的 blob 恒是 LF，
 * 所以 `shebangOf` 的 CRLF 那一支在真总体上永远照不到（臂 A3：只红上面那条合成腿，两条判据都不翻），
 * 那一支的唯一见证就是 `shebangOf` 那个 describe 里的 CRLF 那一格。反过来把 `shebangOf` 整个读空（臂 A3b）时
 * 判据① 会翻绿，接住它的是判据② 那格 `shebanged.length ≥ 1` 的地板——地板不是装饰，实测在这一臂。
 * 还有一条更不好听的：注释涂白那条判据（A6）在第一轮的夹具下**一条都不红**，因为我那两条注释里的路径没带引号，
 * 抽取器根本不吃——所以这个 `describe` 里那两条注释现在写成带引号的 `'scripts/commented.mjs'`，绿才真的有内容。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))

/** 问 `git` 之前先探当场环境（KI-075 结案立的方式：跳不跳由当场读数决定，不由旧登记决定）。 */
const GIT = (() => {
  const probe = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' })
  const err = probe.error ? (probe.error as NodeJS.ErrnoException).code : null
  const top = (probe.stdout ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const here = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const atRoot = top.toLowerCase() === here.toLowerCase()
  if (err) console.warn(`[module-loader] 响亮跳过 HEAD 那几条腿：本环境 spawn 被当场实测挡下（${err}）—— 换台机器复验`)
  else if (!atRoot)
    console.warn(`[module-loader] 响亮跳过 HEAD 那几条腿：这里不是工作树根（${top || 'git 没答'} ≠ ${here}）—— 冻结平面里没有可问的 HEAD`)
  return { ok: !err && atRoot }
})()

/** HEAD 的某个前缀下以 `suffix` 结尾的文件名（列的是提交面，与工作副本脏不绿无关）。 */
const headList = (prefix: string, suffix: string): string[] => {
  const r = spawnSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', prefix], { cwd: root, encoding: 'utf8' })
  expect(r.error, `git ls-tree ${prefix} 跑不起来 = 总体读不到，不许拿空集冒充干净`).toBeUndefined()
  return (r.stdout ?? '').split(/\r?\n/).filter((n) => n.endsWith(suffix)).sort()
}

/**
 * 一次 `git cat-file --batch` 读回 N 份 blob（与 `event-rules.test.ts` 同一个helper 形状：
 * 264 份逐份 `git show` 实测 17s，一趟 batch 1.1s）。
 * 请求顺序就是输出顺序 ⇒ 路径由下标带回；header 的 size 是字节数，按字节切完再转 utf8。
 */
const headBlobs = (paths: string[]): Map<string, string> => {
  const r = spawnSync('git', ['cat-file', '--batch'], {
    cwd: root,
    input: paths.map((p) => `HEAD:${p}\n`).join(''),
    maxBuffer: 1 << 28,
  })
  expect(r.error, 'git cat-file --batch 跑不起来 = 这条判据没跑成').toBeUndefined()
  const out = r.stdout as Buffer
  const map = new Map<string, string>()
  let i = 0
  while (i < out.length && map.size < paths.length) {
    const nl = out.indexOf(0x0a, i)
    if (nl < 0) break
    const h = out.slice(i, nl).toString('utf8').match(/^([0-9a-f]{40}) (blob) (\d+)$/)
    expect(h, `cat-file 的第 ${map.size + 1} 段 header 读不懂（读不到对象时它印的是「missing」，那条形状这里没准备——说明名册与对象库不一致）：${out.slice(i, nl).toString('utf8').slice(0, 80)}`).not.toBeNull()
    const size = Number(h![3])
    map.set(paths[map.size], out.slice(nl + 1, nl + 1 + size).toString('utf8'))
    i = nl + 1 + size + 1
  }
  expect(map.size, `名册给了 ${paths.length} 份而 blob 只读回 ${map.size} 份 = 抽取器读空了`).toBe(paths.length)
  return map
}

type ImportSpec = { name: string; spec: string; line: number; file: string }

interface Scan {
  testFiles: string[]
  scriptFiles: string[]
  seeds: ImportSpec[]
  seedNamesOnDisk: number
  names: string[]
  namedBy: Record<string, ImportSpec[]>
  unresolved: ImportSpec[]
  scriptEdges: number
  hazards: { name: string; shebang: string; importers: ImportSpec[] }[]
  shebanged: string[]
  cli: string[]
  shebangNotCli: string[]
  partition: { file: string; total: number; sum: number }[]
}

/** 扫一次 HEAD（下面几条腿共用同一趟扫描 ⇒ 地板与判据必然同源） */
function scanHead(): Scan {
  const testFiles = headList('tests', '.ts')
  const scriptFiles = headList('scripts', '.mjs')
  const blobs = headBlobs([...testFiles, ...scriptFiles, 'package.json'])
  const base = (p: string) => p.split('/').pop() as string
  const bucket = (text: string, file: string, sibling = false) => {
    const b = scriptLiterals(text, file, sibling)
    return { b, specs: [...b.statics, ...b.dynamics, ...b.consts] as ImportSpec[] }
  }
  const partition = testFiles.map((f) => {
    const b = bucket(blobs.get(f) ?? '', f).b
    return { file: f, total: b.total, sum: b.statics.length + b.dynamics.length + b.consts.length + b.prose.length }
  })
  const seeds = testFiles.flatMap((f) => bucket(blobs.get(f) ?? '', f).specs)
  const scriptSpecs: Record<string, ImportSpec[]> = {}
  for (const p of scriptFiles) scriptSpecs[base(p)] = bucket(blobs.get(p) ?? '', base(p), true).specs
  const { names, namedBy, unresolved } = inProcessClosure({ testSpecs: seeds, scriptSpecs })
  const codes: Record<string, string> = {}
  for (const p of scriptFiles) codes[base(p)] = blobs.get(p) ?? ''
  const shebanged = scriptFiles.map(base).filter((n) => shebangOf(codes[n]) !== null)
  const cli = cliNamedScripts([blobs.get('package.json') ?? '', ...scriptFiles.map((p) => blobs.get(p) ?? ''), ...testFiles.map((p) => blobs.get(p) ?? '')].join('\n'))
  return {
    testFiles,
    scriptFiles: scriptFiles.map(base),
    seeds,
    seedNamesOnDisk: new Set(seeds.filter((s) => Object.prototype.hasOwnProperty.call(codes, s.name)).map((s) => s.name)).size,
    names,
    namedBy,
    unresolved,
    scriptEdges: Object.values(scriptSpecs).reduce((a, v) => a + v.length, 0),
    hazards: loaderHazards({ names, namedBy, codes }),
    shebanged,
    cli,
    shebangNotCli: shebanged.filter((n) => !cli.includes(n)),
    partition,
  }
}

let cached: Scan | null = null
const once = (): Scan => (cached ??= scanHead())

describe('shebangOf：只认第 0 字节那一种，两种行尾都算', () => {
  it('第 0 字节起头的 `#!` 就是 shebang，LF 与 CRLF 一样认；不在第 0 字节的不算', () => {
    expect(shebangOf('#!/usr/bin/env node\nimport x from "y"\n'), 'LF 那份也要认：判据不许跟着行尾变窄').toBe('#!/usr/bin/env node')
    expect(shebangOf('#!/usr/bin/env node\r\nimport x from "y"\r\n'), 'CRLF 那份也要认：那正是加载不了的一种').toBe('#!/usr/bin/env node')
    expect(shebangOf('#!只有开头这一条\n'), '返回值不含行尾').toBe('#!只有开头这一条')
    expect(shebangOf('/** 注释 */\n#!/usr/bin/env node\n'), '第 2 行那种 `#!` 不是 shebang（它是语法错，但不是这条门管的那一种）').toBeNull()
    expect(shebangOf('/** 注释 */\nimport x from "y"\n'), '没有 shebang 的文件必须读成 null，不是空串').toBeNull()
    expect(shebangOf(''), '空文件不许被当成"有 shebang"').toBeNull()
  })
})

describe('scriptLiterals：按语法位置分桶，注释里的提及一个不许进', () => {
  // 桶里的名字全部用**盘上真有的脚本**：这份文件自己也在真总体的扫描范围里（`New tests are sites too`），
  // 造一个不存在的名字就会红在"点了名却不在盘上"那条 unresolved 腿上——那是判据在惩罚我自己的散文。
  // 而 SPAWN_TARGET 那一格必须是散文：把它读成 import 就会把带 shebang 的 CLI 拖进 in-process 名册。
  const SRC = [
    "import { a } from '../../scripts/report-reds.mjs'",
    "const SPEC = '../../scripts/test-scope.mjs'",
    'await import(SPEC)',
    "import('../../scripts/schema-vocab.mjs')",
    "const SPAWN_TARGET = 'scripts/coverage.mjs'",
    "spawnSync(node, ['scripts/check-dist.mjs'])",
    "// 判据住在 'scripts/commented.mjs' 里 —— 这是散文，路径带引号也不算导入位",
    "/* 块注释里的 'scripts/block-mentioned.mjs' 同理 */",
    "const CMD = 'node scripts/test.mjs'",
  ].join('\n')

  it('三种导入位各自进各自的桶，spawn 位与被 spawn 用的 const 进 prose', () => {
    const b = scriptLiterals(SRC, 'synthetic.ts')
    expect(b.statics.map((s) => s.name), '静态 from 那一桶').toEqual(['report-reds.mjs'])
    expect(b.dynamics.map((s) => s.name), '直接 import() 那一桶').toEqual(['schema-vocab.mjs'])
    expect(b.consts.map((s) => s.name), 'const 间接那一桶：validate-data.mjs 就是这么被点名的，读不到它等于判据对空集自证干净').toEqual(['test-scope.mjs'])
    expect(b.prose.map((s) => s.name), 'spawn 数组里的路径与被 readFileSync/spawn 用掉的 const 都是散文位').toEqual(['coverage.mjs', 'check-dist.mjs'])
    expect(b.total, '分区必须恰好覆盖匹配到的字面量').toBe(b.statics.length + b.dynamics.length + b.consts.length + b.prose.length)
  })

  it('注释（行注释与块注释）里的路径一个字都不许进桶，而行号仍然对得上', () => {
    const b = scriptLiterals(SRC, 'synthetic.ts')
    const names = [...b.statics, ...b.dynamics, ...b.consts, ...b.prose].map((s) => s.name)
    expect(names, '注释里的脚本名不是导入位：把 commented.mjs 读进来就是拿散文当判据的总体').not.toContain('commented.mjs')
    expect(names, '块注释同理').not.toContain('block-mentioned.mjs')
    expect(names, '那种带空格的命令行串（node scripts/test.mjs）是 spawn 命令而不是 specifier，不该被读成路径').not.toContain('test.mjs')
    expect(b.statics[0].line, '涂白注释后行号必须仍然指向真正那一行').toBe(1)
    expect(b.consts[0].line, 'const 那一条的行号').toBe(2)
  })

  it('兄弟写法 ./x.mjs：脚本本体要算（闭包那条边全靠它），测试文件不算', () => {
    const SRC2 = "import { s } from './ledger-rules.mjs'\nconst p = './report-reds.mjs'\nawait import('./test-scope.mjs')"
    const asScript = scriptLiterals(SRC2, 'validate-data.mjs', true)
    expect(asScript.statics.map((x) => x.name), '脚本本体里的 from 兄弟写法就是一次进程内加载').toEqual(['ledger-rules.mjs'])
    expect(asScript.dynamics.map((x) => x.name), '兄弟写法的 import() 也算').toEqual(['test-scope.mjs'])
    expect(asScript.prose.map((x) => x.name), '那个 const 没被 import() 用过 ⇒ 只是路径字符串').toEqual(['report-reds.mjs'])
    const asTest = scriptLiterals(SRC2, 'who.test.ts')
    expect([asTest.total, asTest.statics.length, asTest.dynamics.length], '测试文件里的 ./x.mjs 相对的是 tests/，不是 scripts/ ⇒ 一条都不该进总体').toEqual([0, 0, 0])
  })
})

describe('inProcessClosure：从测试点到的脚本沿脚本间的 import 走完', () => {
  const scriptSpecs = {
    'seed.mjs': [{ name: 'inner.mjs', spec: './inner.mjs', line: 3, file: 'seed.mjs' }],
    'inner.mjs': [],
    'orphan.mjs': [],
  }

  it('种子与传递进来的都在名册里，被谁点名也要带着', () => {
    const r = inProcessClosure({
      testSpecs: [
        { name: 'seed.mjs', spec: '../../scripts/seed.mjs', line: 7, file: 'a.test.ts' },
        { name: 'orphan.mjs', spec: '../../scripts/orphan.mjs', line: 9, file: 'b.test.ts' },
      ],
      scriptSpecs,
    })
    expect(r.names, '闭包要把脚本之间的 import 也收进来').toEqual(['inner.mjs', 'orphan.mjs', 'seed.mjs'])
    expect(r.namedBy['inner.mjs'].map((s) => s.file), 'inner 是被 seed 点名的，不是被测试').toEqual(['seed.mjs'])
    expect(r.namedBy['seed.mjs'].map((s) => s.line), '谁在测试里点的名要报得出行号').toEqual([7])
  })

  it('点了名但盘上没有的那个脚本进 unresolved 桶，不许静默消失', () => {
    const r = inProcessClosure({
      testSpecs: [{ name: 'ghost.mjs', spec: '../../scripts/ghost.mjs', line: 1, file: 'c.test.ts' }],
      scriptSpecs,
    })
    expect(r.names, '不存在的东西不该进名册').toEqual([])
    expect(r.unresolved.map((s) => `${s.file}:${s.line}`), '拼错的 specifier 要被点名，而不是当作"没人 import"').toEqual(['c.test.ts:1'])
  })

  it('循环 import 不许把闭包走成死循环', () => {
    const r = inProcessClosure({
      testSpecs: [{ name: 'x.mjs', spec: './x.mjs', line: 1, file: 'd.test.ts' }],
      scriptSpecs: {
        'x.mjs': [{ name: 'y.mjs', spec: './y.mjs', line: 1, file: 'x.mjs' }],
        'y.mjs': [{ name: 'x.mjs', spec: './x.mjs', line: 1, file: 'y.mjs' }],
      },
    })
    expect(r.names, '环要停在已见过那一格').toEqual(['x.mjs', 'y.mjs'])
  })
})

describe('loaderHazards：in-process ∩ shebang 必须是空集', () => {
  it('被 import 的脚本带 shebang ⇒ 点名它，并点名是谁 import 的', () => {
    const h = loaderHazards({
      names: ['bad.mjs', 'good.mjs'],
      namedBy: { 'bad.mjs': [{ name: 'bad.mjs', spec: '../../scripts/bad.mjs', line: 12, file: 'who.test.ts' }], 'good.mjs': [] },
      codes: { 'bad.mjs': '#!/usr/bin/env node\nexport const x = 1\n', 'good.mjs': 'export const x = 1\n' },
    })
    expect(h.map((f) => f.name), '只该有那一份带 shebang 的').toEqual(['bad.mjs'])
    expect(h[0].importers.map((s) => s.file), '红的消息要点名牵连方').toEqual(['who.test.ts'])
  })

  it('不在名册里的那份带 shebang 的脚本不算 offender（这条门判的是加载得动，不是风格）', () => {
    const codes: Record<string, string> = { 'good.mjs': 'export const x = 1\n', 'only-cli.mjs': '#!/usr/bin/env node\nclass C {}' }
    const h = loaderHazards({
      names: ['good.mjs'],
      namedBy: { 'good.mjs': [] },
      codes,
    })
    expect(h, '名册里没有它就是空集').toEqual([])
    // 空集要有旁证：那两份 codes 里确实有一份带 shebang，只是它不在名册上——否则这条腿绿在空集上
    expect(Object.keys(codes).filter((n) => shebangOf(codes[n]) !== null), '旁证：带上 shebang 的那份确实在这次的输入里').toEqual(['only-cli.mjs'])
  })
})

describe('真总体（HEAD 的提交面）：名册、两条判据与地板', () => {
  it.skipIf(!GIT.ok)('总体不是空的，而且校验器那份真在名册里（subject 先在册，再谈它的下场）', () => {
    const s = once()
    expect(s.testFiles.length, `HEAD 的 tests/**/*.ts 只读到 ${s.testFiles.length} 份 = 走错面了，这条门在空转`).toBeGreaterThanOrEqual(150)
    expect(s.scriptFiles.length, `HEAD 的 scripts/*.mjs 只读到 ${s.scriptFiles.length} 份 = 总体空了，0 条命中不代表没病`).toBeGreaterThanOrEqual(20)
    expect(s.seeds.length, `测试里导入位的字面量只读到 ${s.seeds.length} 条 = 抽取器读空了`).toBeGreaterThanOrEqual(20)
    expect(s.seedNamesOnDisk, `种子在盘上只点名了 ${s.seedNamesOnDisk} 份脚本 = 抽取器没接到真东西`).toBeGreaterThanOrEqual(20)
    // 闭包只会往大里走：名册 ⊇「种子里盘上真有的那一份」，少一份就是闭包断了
    expect(s.names.length, `in-process 名册只推出 ${s.names.length} 份 = 少于种子在盘上点名的 ${s.seedNamesOnDisk} 份，闭包没接住`).toBeGreaterThanOrEqual(s.seedNamesOnDisk)
    expect(s.scriptEdges, `脚本之间互相 import 的位只读到 ${s.scriptEdges} 条 = 闭包那条边在真总体上没有输入（今天就靠合成用例证明它走得动）`).toBeGreaterThanOrEqual(10)
    expect(s.names, '校验器必须在这张名册里——它就是被 const 间接点名那一桶引进来的（只读 `from` 的抽取器会把它读成"没人 import"）').toContain('validate-data.mjs')
    expect(
      (s.namedBy['validate-data.mjs'] ?? []).map((x) => x.file),
      '点名它的必须是 `ledger-rules.test.ts`（那条进程内跑真校验器的腿）',
    ).toContain('tests/unit/ledger-rules.test.ts')
  })

  it.skipIf(!GIT.ok)('间接那一桶真是一次 import，不是一个路径字符串（机制腿：const 的名字要在同一份文件里被 import() 用过）', () => {
    const src = headBlobs(['tests/unit/ledger-rules.test.ts']).get('tests/unit/ledger-rules.test.ts') ?? ''
    const buckets = scriptLiterals(src, 'tests/unit/ledger-rules.test.ts')
    expect(buckets.consts.map((x) => x.name), '那份测试里 const 间接点名的脚本').toEqual(['validate-data.mjs'])
    const decl = src.split(/\r?\n/).find((l) => l.includes('validate-data.mjs') && /^\s*const\s+\w+/.test(l))
    expect(decl, '找不到那条 const 声明 = 这条腿的前提（间接点名）已经不成立，判据要跟着改').not.toBeUndefined()
    const ident = /^\s*const\s+(\w+)/.exec(decl as string)?.[1]
    expect(ident, '那条 const 的名字要取出来').toBeTruthy()
    expect(new RegExp(`import\\(\\s*${ident}\\b`).test(src), `「const ${ident}」必须真被 import(${ident}) 用过，否则它只是一个路径字符串，不该进 in-process 名册`).toBe(true)
  })

  it.skipIf(!GIT.ok)('判据①：in-process 名册里一份 shebang 都不许有（摘掉装饰，干净检出也加载得动）', () => {
    const s = once()
    expect(
      s.hazards.map((f) => `${f.name}（第 0 字节起：${f.shebang}）被 ${f.importers.map((x) => `${x.file}:${x.line}`).join(', ')} 进程内 import`),
      '这些脚本被测试进程内 import，却以 shebang 开头：实测在干净检出（CRLF）上加载不动（报错把 #! 指到 SSR 变换后代码的第 19 行）。' +
        'package.json 里跑它们用的都是 `node scripts/<name>.mjs`，那一行是装饰，摘掉即可（不要加豁免）。',
    ).toEqual([])
  })

  it.skipIf(!GIT.ok)('判据②：还留着 shebang 的那些必须真被当命令行跑过（否则那行没有读者）', () => {
    const s = once()
    expect(
      s.shebangNotCli,
      `这些脚本带着 shebang，却没有一处 "node scripts/….mjs" 命令把它们当 CLI 跑（CLI 名册现推自 HEAD 的 package.json + scripts/ + tests/，此刻 ${s.cli.length} 个名字：${s.cli.join(' ')}）——那行既没有读者，又把未来任何一次进程内 import 变成地雷`,
    ).toEqual([])
    expect(s.shebanged.length, `只读到 ${s.shebanged.length} 份带 shebang 的脚本 = 名册读空了（HEAD 此刻至少有 CLI 那几份）`).toBeGreaterThanOrEqual(1)
  })

  it.skipIf(!GIT.ok)('分区 census：每份测试里四个桶之和 == 匹配到的字面量总数，且没有 unresolved 的点名', () => {
    const s = once()
    const bad = s.partition.filter((p) => p.total !== p.sum).map((p) => `${p.file}: total=${p.total} 桶和=${p.sum}`)
    expect(bad, '分桶没有覆盖所有匹配到的字面量 ⇒ 有一类被吞掉了（吞掉就是总体悄悄变窄）').toEqual([])
    expect(
      s.unresolved.map((x) => `${x.file}:${x.line} → ${x.spec}`),
      '这些测试或脚本点了 `scripts/*.mjs` 的名（含兄弟写法），而那个文件不在 HEAD 里（拼错或已删）',
    ).toEqual([])
  })

  it('KI-118 在账本里有且只有一行（编号不许只在散文里飘着）', () => {
    const rows = readFileSync(`${root}docs/KNOWN_ISSUES.md`, 'utf8')
      .split(/\r?\n/)
      .filter((l) => /^\|\s*KI-118\s*\|/.test(l))
    expect(rows.length, '账本里没有 KI-118 那一行 = 这条门判的缺陷没登记在册（这一格读工作副本，与 KI-114 同一取舍）').toBe(1)
    expect(rows[0], '登记的这一行必须说清是 shebang × 干净检出这一族').toMatch(/shebang/)
  })
})
