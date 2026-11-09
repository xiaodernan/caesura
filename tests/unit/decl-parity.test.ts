import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DECL_EXT,
  implPathOf,
  pairScan,
  parityCensus,
  parityFindings,
  valueExportsOf,
} from '../../scripts/decl-parity-rules.mjs'

/**
 * 「`x.d.mts` 说它导出什么」与「`x.mjs` 真导出什么」必须是同一批名字（KI-439）。
 *
 * 前提不是设想而是实测（`.scratch/ki439/probe2.mjs`、`.scratch/ki439/probe3.mjs`：每趟都在真仓库上跑
 * `node_modules/typescript/bin/tsc --noEmit` 加那份刚落地的测试，跑完逐字节验回 sha256）：
 *   ① 往声明里植入一枚实现根本没有的 `export function notAThing` ⇒ tsc rc=0，那份测试 14 条全绿；
 *   ② 把一枚**没人 import** 的常量的声明类型指成 `number` ⇒ 两处同样全绿；
 *   ③ 只摘掉 `export function eolOf` 的 `export` 关键字、留一个同名局部声明在原地 ⇒ tsc 也 rc=0；
 *   ④ 反过来，把一枚**真在被 import** 的名字整行删掉或改名 ⇒ tsc 红一条 TS2305；
 *   ⑤ 对照趟（证明探针自己是活的）：改 `spliceKv` 那枚真在被调用的签名的参数类型 ⇒ tsc 红 8 条。
 * 所以今天的实情是：**只有「导入位点到的名」这一条有人管，而且只在真有人点它时才管**。声明替一个没人在用
 * 的名字撒谎、实现多一枚声明没说过的导出、以及那种「名字还在、`export` 没了」的形状，两侧门禁都读不到——
 * 而套件根本不读 `.d.mts`（① 那趟里它是绿的）。这一门就把这三样按 AST 名册逐名钉住：不再指望编译器，
 * 因为编译器正是被撒谎的那一份骗过去的那位。
 *
 * 总体按**扩展名**收（`.d.mts` 住在哪个目录都算一对），不按目录名筛：`scripts/` 之外此刻还有 `services/`
 * 两份与 `.scratch/keep/` 一份留档件，把它们留在门外就是给漂移留藏处（下面「不按目录名筛」那条腿接住）。
 * 名册与字节走同一个平面：HEAD 那一趟清单走 `git ls-tree`、字节走一次 `git cat-file --batch`；工作副本那
 * 一趟清单走 `git ls-files --cached --others --exclude-standard`（**含未跟踪但未忽略的**，否则新加的声明
 * 要等 `git add` 才进门）、字节从磁盘读。混着读就是拿旧清单配新字节（KI-332 那一族）。
 * 工作副本那趟在并发会话带着未提交的声明改动时会红——那时红的是**它说的那句实情**，按 KI-127 的方式归因，
 * 不把判据改窄。
 *
 * 两侧都读空的那一对不算干净（`blind`），数不出名册的拼法（`export *`／`export =`／`export namespace`）
 * 一律报名而不是当成 0：今天真总体上 0 处（`.scratch/ki439/census.mjs`，两平面同数），所以那两条判据在真
 * 总体上照不到，它们的见证是合成夹具——这正是「未落清单不许白过」那一族的老账。
 *
 * `decl-parity-rules.mjs` 自己也在总体里：它的声明与实现同名这一条由最后一组腿钉住（吃自己的狗粮）。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))

/** 问 `git` 之前先探当场环境（KI-075 结案立的方式：跳不跳由当场读数决定，不由旧登记决定）。 */
const GIT = (() => {
  const probe = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' })
  const err = probe.error ? (probe.error as NodeJS.ErrnoException).code : null
  const top = (probe.stdout ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const here = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const atRoot = top.toLowerCase() === here.toLowerCase()
  if (err) console.warn(`[decl-parity] 响亮跳过真总体那几条腿：本环境 spawn 被当场实测挡下（${err}）—— 换台机器复验`)
  else if (!atRoot)
    console.warn(`[decl-parity] 响亮跳过真总体那几条腿：这里不是工作树根（${top || 'git 没答'} ≠ ${here}）—— 冻结平面里没有可问的 HEAD`)
  return { ok: !err && atRoot }
})()

interface Pair {
  decl: string
  impl: string
  declSrc: string | null
  implSrc: string | null
}

interface Finding {
  kind: string
  decl: string
  impl: string
  name: string
}

/** 一条漂移报成一句人话：kind 只说种类，话说的是那枚名字与那对文件。 */
const say = (f: Finding): string => {
  if (f.kind === 'lying') return `撒谎：${f.impl} 里没有 ${f.name} 这枚值导出，而 ${f.decl} 说它有`
  if (f.kind === 'missing') return `漏写：${f.impl} 导出了 ${f.name}，而 ${f.decl} 没声明它`
  if (f.kind === 'orphan') return `孤儿：${f.decl} 的实现 ${f.impl} 不在这一棵树上`
  if (f.kind === 'blind') return `读空：${f.decl} 与 ${f.impl} 两侧都读出 0 枚值导出`
  return `未名状：${f.name}`
}

/** HEAD 的整棵清单（一次 `ls-tree`，实现存不存在由它判，不去猜 cat-file 的 missing 行长什么样）。 */
function headList(): Set<string> {
  const r = spawnSync('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
  expect(r.error, 'git ls-tree 跑不起来 = 总体读不到，不许拿空集冒充干净').toBeUndefined()
  const all = new Set((r.stdout ?? '').split('\0').filter((n) => n.length > 0))
  expect(all.size, 'HEAD 的树读空了').toBeGreaterThan(0)
  return all
}

/** 一次 `git cat-file --batch` 读回 N 份 blob（路径由下标带回；份数不符就是抽取器读空）。 */
function headBlobs(paths: string[]): Map<string, string> {
  if (paths.length === 0) return new Map()
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
    const h = out.subarray(i, nl).toString('utf8').match(/^([0-9a-f]{40}) (blob) (\d+)$/)
    expect(h, `cat-file 的第 ${map.size + 1} 段 header 读不懂（清单与对象库不一致）：${out.subarray(i, nl).toString('utf8').slice(0, 80)}`).not.toBeNull()
    const size = Number(h![3])
    map.set(paths[map.size], out.subarray(nl + 1, nl + 1 + size).toString('utf8'))
    i = nl + 1 + size + 1
  }
  expect(map.size, `清单给了 ${paths.length} 份而 blob 只读回 ${map.size} 份 = 抽取器读空了`).toBe(paths.length)
  return map
}

/** HEAD 那一趟：声明侧的每份都要读到字节；实现侧读不到就是孤儿（交回判据报名）。 */
function scanHead(): Pair[] {
  const all = headList()
  const decl = [...all].filter((p) => p.endsWith(DECL_EXT)).sort()
  if (decl.length === 0) return []
  const impl = decl.map((d) => implPathOf(d) ?? `${d}（形状不对）`)
  const req = decl.flatMap((d, k) => [d, impl[k]].filter((p) => all.has(p)))
  const blobs = headBlobs(req)
  return decl.map((d, k) => ({
    decl: d,
    impl: impl[k],
    declSrc: blobs.get(d) ?? null,
    implSrc: blobs.get(impl[k]) ?? null,
  }))
}

/** 工作副本那一趟：清单＝索引 + 未跟踪但未忽略，字节＝磁盘。 */
function scanDisk(): Pair[] {
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
  expect(r.error, 'git ls-files 跑不起来 = 总体读不到，不许拿空集冒充干净').toBeUndefined()
  const decl = (r.stdout ?? '').split('\0').filter((n) => n.endsWith(DECL_EXT)).sort()
  const read = (p: string): string | null => {
    try {
      return readFileSync(`${root}${p}`, 'utf8')
    } catch {
      return null
    }
  }
  return decl.map((d) => {
    const impl = implPathOf(d) ?? `${d}（形状不对）`
    return { decl: d, impl, declSrc: read(d), implSrc: read(impl) }
  })
}

const HEAD = GIT.ok ? scanHead() : []
const DISK = GIT.ok ? scanDisk() : []
const drift = (c: { findings: Finding[] }): string[] =>
  c.findings.filter((f) => f.kind === 'lying' || f.kind === 'missing').map(say)

describe('valueExportsOf：名册按 AST 现推，注释里与函数体里的 export 一枚不算', () => {
  const IMPL = [
    'export const A = 1',
    'export let B = 2, C = 3',
    'export function f() { return 1 }',
    'export class K {}',
    "export { D, E as F } from './other.mjs'",
    'export const { G, H } = obj',
    '// export const NOT1 = 1 这是散文',
    '/* export const NOT2 = 2 也是散文 */',
    'function inner() { export const NOT3 = 3 }',
  ].join('\n')

  it('真在用的六种导出形状进同一份值名册，解构展开而 `E as F` 只认 F', () => {
    const r = valueExportsOf(IMPL, 'synthetic.mjs')
    expect(r.names, '名册按名字排序；注释与函数体里那三枚 NOT 不许进').toEqual(['A', 'B', 'C', 'D', 'F', 'G', 'H', 'K', 'f'])
    expect(r.types, '实现侧这里没有类型导出').toEqual([])
    expect(r.unresolved, '带 from 的重导出数得出名字，不算未名状').toEqual([])
  })

  it('类型导出与值导出分两堆：interface／type／`export type { … }` 都只进类型那一堆', () => {
    const DECL = [
      'export interface I { a: string }',
      'export type T = string',
      'export declare const V: number',
      'export declare function w(x: string): void',
      'export type { I as Alias }',
    ].join('\n')
    const r = valueExportsOf(DECL, 'synthetic.d.mts')
    expect(r.names, '只有值的那两枚进名册').toEqual(['V', 'w'])
    expect(r.types, 'interface／type／type-only 重导出进类型那一堆').toEqual(['Alias', 'I', 'T'])
  })

  it('数不出名册的拼法逐条原样带回：`export *`、`export =`、`export namespace`、rest 绑定', () => {
    const star = valueExportsOf("export * from './x.mjs'\nexport namespace N { const a = 1 }", 'synthetic.d.mts')
    const eq = valueExportsOf('const ns = { a: 1 }\nexport = ns', 'synthetic.d.mts')
    const rest = valueExportsOf('export const { a, ...others } = obj', 'synthetic.mjs')
    expect(star.unresolved.length, `export * 与 export namespace 各要报一条：${JSON.stringify(star.unresolved)}`).toBe(2)
    expect(eq.unresolved.length, `export = 要报一条：${JSON.stringify(eq.unresolved)}`).toBe(1)
    expect(rest.unresolved.length, `rest 绑定数不出导出名，要报一条：${JSON.stringify(rest.unresolved)}`).toBe(1)
    expect(rest.names, 'rest 那一格报名，但同层的 `a` 照样进名册').toEqual(['a'])
    expect(star.names, '未名状的那些不该冒充值名册').toEqual([])
  })

  it('implPathOf 只认 `.d.mts` 那一种形状，别的一律 null（不猜实现叫什么）', () => {
    expect(implPathOf(`scripts/x${DECL_EXT}`)).toBe('scripts/x.mjs')
    expect(implPathOf(`services/spring/y${DECL_EXT}`)).toBe('services/spring/y.mjs')
    expect(implPathOf('scripts/x.mts'), '实现若是 .mts，这一格就不认——先让门把形状问清楚').toBeNull()
    expect(implPathOf('scripts/x.d.ts'), '`.d.ts` 不是这一族').toBeNull()
    expect(implPathOf('scripts/x.mjs'), '实现本身不是声明').toBeNull()
  })
})

describe('parityFindings：撒谎与漏写两个方向各点自己的名', () => {
  const CLEAN = {
    decl: 'x/y.d.mts',
    impl: 'x/y.mjs',
    declSrc: 'export interface I { a: string }\nexport function f(a: string): void\nexport const V: number',
    implSrc: 'export function f(a) { return a }\nexport const V = 1',
  }

  it('带 interface 的干净一对不产 finding——那枚 interface 不许被算成撒谎', () => {
    expect(parityFindings(CLEAN).map(say), '真总体上每一对都带 interface：把它们算进值名册会刷出一片假红').toEqual([])
    expect(valueExportsOf(CLEAN.declSrc, CLEAN.decl).types, '那枚 interface 在类型那一堆里，不是不在名册里').toEqual(['I'])
  })

  it('植入一枚实现里没有的导出 ⇒ 撒谎，点名到文件名与名字（探针① 那一向 tsc 读不到）', () => {
    const f = parityFindings({ ...CLEAN, declSrc: `${CLEAN.declSrc}\nexport function notAThing(a: string): void` })
    expect(f.map(say)).toEqual(['撒谎：x/y.mjs 里没有 notAThing 这枚值导出，而 x/y.d.mts 说它有'])
  })

  it('实现多一枚声明没说的导出 ⇒ 漏写', () => {
    const f = parityFindings({ ...CLEAN, implSrc: `${CLEAN.implSrc}\nexport function extra() {}` })
    expect(f.map(say)).toEqual(['漏写：x/y.mjs 导出了 extra，而 x/y.d.mts 没声明它'])
  })

  it('只摘掉 `export` 关键字、留同名局部声明：tsc 实测 rc=0（探针③），这一门按漏写报名', () => {
    const f = parityFindings({ ...CLEAN, declSrc: CLEAN.declSrc.replace('export function f(a: string): void', 'function f(a: string): void') })
    expect(f.map(say), '名字还在、export 没了——编译器的 TS2305 不吃这一形状').toEqual(['漏写：x/y.mjs 导出了 f，而 x/y.d.mts 没声明它'])
  })

  it('实现字节读不到 ⇒ 只报孤儿，不再逐名比对（否则一份坏声明刷出一片假红）', () => {
    const f = parityFindings({ ...CLEAN, implSrc: null })
    expect(f.map(say)).toEqual(['孤儿：x/y.d.mts 的实现 x/y.mjs 不在这一棵树上'])
  })

  it('两侧都读空的那一对记 blind，不许算干净', () => {
    const f = parityFindings({ decl: 'z.d.mts', impl: 'z.mjs', declSrc: 'export {}\n', implSrc: 'export {}' })
    expect(f.map((x) => x.kind), '名册恒真的那一格要能被点名').toEqual(['blind'])
  })
})

describe('parityCensus：总体读数与地板出自同一趟扫描', () => {
  const GOOD = { decl: 'c.d.mts', impl: 'c.mjs', declSrc: 'export function c(): void', implSrc: 'export function c() {}' }
  const BAD = { decl: 'b.d.mts', impl: 'b.mjs', declSrc: 'export function onlyInDecl(): void', implSrc: 'export const inImpl = 1' }
  const EMPTY = { decl: 'n.d.mts', impl: 'n.mjs', declSrc: 'export {}', implSrc: 'export {}' }

  it('对数、参与比对的名数、blind 清单与 findings 同一趟出来，坏对同时报撒谎与漏写', () => {
    const r = parityCensus([GOOD, BAD, EMPTY])
    expect(r.pairs, '三对都该送进去').toBe(3)
    expect(r.compared, '两侧各数一次：干净对 1+1，坏对 1+1，读空对 0').toBe(4)
    expect(r.blind, '读空那对要点名').toEqual(['n.d.mts'])
    expect(r.findings.map(say).sort(), '同一对里两个方向的漂移不许互相吃掉').toEqual([
      '漏写：b.mjs 导出了 inImpl，而 b.d.mts 没声明它',
      '读空：n.d.mts 与 n.mjs 两侧都读出 0 枚值导出',
      '撒谎：b.mjs 里没有 onlyInDecl 这枚值导出，而 b.d.mts 说它有',
    ].sort())
  })

  it('空总体不是干净：0 对就是 0 个读数，接住它的是真总体那几条腿里的地板', () => {
    const r = parityCensus([])
    expect([r.pairs, r.compared, r.findings.length], '空集上逐名比对恒真').toEqual([0, 0, 0])
  })
})

describe('HEAD 的声明 ⇄ 实现逐对同名（主干自证：新克隆里这两份字节也要对得上）', () => {
  it('撒谎与漏写两向在 HEAD 上都是空集，不空就点到文件名与名字级', () => {
    if (!GIT.ok) return
    expect(drift(parityCensus(HEAD)), 'HEAD 上声明与实现不同名的对').toEqual([])
  })

  it('地板：HEAD 的名册不是空集，且每一份声明都至少对出一枚值导出', () => {
    if (!GIT.ok) return
    const c = parityCensus(HEAD)
    expect(c.pairs, 'HEAD 里一份 .d.mts 都没读到 = 名册读空，上面那条是白送的绿').toBeGreaterThan(0)
    expect(c.compared, '名册总数读成 0 = 抽取器被改瞎或后缀形状变了').toBeGreaterThan(0)
    expect(c.blind, '两侧都读空的对：' + c.blind.map((d) => d).join(' ｜ ')).toEqual([])
  })

  it('总体按扩展名收，不按目录名筛：scripts 之外那份声明也在名册里', () => {
    if (!GIT.ok) return
    const outside = HEAD.filter((p) => !p.decl.startsWith('scripts/'))
    expect(outside.map((p) => p.decl), `HEAD 的 services/ 里也有 .d.mts，把它们留在门外就是给漂移留藏处：${outside.length} 份`).not.toEqual([])
    expect(outside.every((p) => p.declSrc !== null), '别处的声明也要真读到字节').toBe(true)
  })

  it('未名状的拼法在 HEAD 上是量出来的数，不是假设的 0', () => {
    if (!GIT.ok) return
    const c = parityCensus(HEAD)
    expect(c.unresolved, `HEAD 上数不出名册的导出拼法：${c.unresolved.join(' ｜ ')}`).toEqual([])
    expect(HEAD.every((p) => p.declSrc !== null), `有声明没读到字节：${HEAD.filter((p) => p.declSrc === null).map((p) => p.decl).join(' ｜ ')}`).toBe(true)
  })
})

describe('同一把尺读工作副本（落库前那一趟：磁盘字节，含还没 git add 的声明）', () => {
  it('磁盘上的每一对也同名，且地板读数不是空集', () => {
    if (!GIT.ok) return
    const c = parityCensus(DISK)
    expect(drift(c), '工作副本里声明与实现不同名的对').toEqual([])
    expect(c.pairs, '工作副本的名册读空了').toBeGreaterThan(0)
    expect(c.blind, '工作副本里两侧读空的对').toEqual([])
  })

  it('两平面的关系可核对：工作副本的名册是 HEAD 的超集，HEAD 里没有一份声明在工作副本读不到', () => {
    if (!GIT.ok) return
    const a = HEAD.map((p) => p.decl)
    const b = DISK.map((p) => p.decl)
    const onlyHead = a.filter((x) => !b.includes(x))
    expect(onlyHead, `在 HEAD 里却不在索引/磁盘里：${onlyHead.join(' ｜ ')}——工作副本那一趟读漏了`).toEqual([])
    expect(b.length, `工作副本 ${b.length} 份少于 HEAD 的 ${a.length} 份 = 落库前的这一趟读得比主干还窄`).toBeGreaterThanOrEqual(a.length)
  })
})

describe('本门的判据模块自己也在总体里（吃自己的狗粮）', () => {
  const SELF = `scripts/decl-parity-rules${DECL_EXT}`
  const SELF_IMPL = 'scripts/decl-parity-rules.mjs'

  it('decl-parity-rules.d.mts 与 .mjs 逐名同名，而名册不是空集', () => {
    const scan = pairScan({
      decl: SELF,
      impl: SELF_IMPL,
      declSrc: readFileSync(`${root}${SELF}`, 'utf8'),
      implSrc: readFileSync(`${root}${SELF_IMPL}`, 'utf8'),
    })
    expect(scan.findings.map(say), '判据模块的声明替自己撒谎就会被本门抓到：' + scan.findings.map(say).join(' ｜ ')).toEqual([])
    expect(scan.declNames.length, '它至少得导出 parityCensus 那几枚，读空就是抽取器没吃下去').toBeGreaterThan(0)
    expect(scan.declNames, '声明侧名册与实现侧名册要逐名相等').toEqual([...scan.implNames].sort())
  })

  it('这份声明已被 git 认领，因而真在总体里（不在就是门对自己免检）', () => {
    if (!GIT.ok) return
    expect(DISK.map((p) => p.decl), `${SELF} 没进总体清单 = 本批的新声明还没被认领`).toContain(SELF)
  })
})
