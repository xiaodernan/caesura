/**
 * KI-364：`node scripts/validate-data.mjs --data-root=<目录>` 这条缝的行为腿。
 *
 * **这一批买的不是新判据，而是入口**：§5.9.143 的 A1v 行量过——往 `src/data/json` 里植入一株幻影旗，
 * 测试那侧看得见，校验器自己报的却是与基线**逐字相同**的 0 ERROR。那份"瞎"没法用一条词表腿修，
 * 因为缺的是"让校验器去吃另一份陈设"的能力本身。有了它，植入才第一次能在**门禁那一侧**被量出来。
 *
 * 所以每条腿都在问同一件事的某一面：注入真的换了数据根吗（③）、换掉之后植入报不报（④⑥）、
 * 不报是不是因为植入本身合法（⑤）、路径拼错与旗名拼错会不会被当成"表很干净"（⑦⑧）、
 * 以及最要紧的一面——**进程内被 import 的那一趟不许吃宿主的 argv**（⑨），因为那份读数要是被 vitest
 * 的参数带跑，`tests/unit/ledger-rules.test.ts` 那条"进程内跑真校验器"的门从此评的就是别的东西。
 *
 * ⑨ 用**子进程里的合成宿主**跑，而不是在本文件里 `import()` 校验器：后者会撞上 ESM 缓存——
 * 同一 worker 里第二趟拿到的是第一趟那一刻的磁盘，而那条不变式已经被 `ledger-rules.test.ts` 钉住
 * （见那里 `validatorRuns` 那段）。子进程既避开缓存，也让 CJK 仓库根上的 `file://` 由 node 自己解码
 * （vite 的动态导入不还原百分号，那条路在 `D:\法环游戏` 这类根上加载不动）。
 *
 * 判据全部**派生**：分母取自校验器自己的 `FILES`（①），植入位取自真表里第一格"没有条件的刷怪组"，
 * ⑤ 的供体旗取自表里已有的纯旗标条件——手抄一个旗名就等于把这条腿钉在我此刻读到的那几个字上。
 *
 * 实测（2026-10-30，`.scratch/ki364_plant_probe.mjs`）：植入位 `rg_whisperwode/en_murkshell`、
 * 供体 `flag.schism_complicit`；幻影旗 ⇒ rc=1／1 条 ERROR 点名 `flag.plant_cond_no_writer`，
 * 供体 ⇒ rc=0／判决行与默认路逐字相同。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { arrayLiterals } from '../../scripts/schema-vocab.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const VALIDATOR = resolve(root, 'scripts/validate-data.mjs')
const JSON_DIR = resolve(root, 'src/data/json')
/** 注入平面住在 `%TEMP%` 而不是仓库根下面：根下的平面副本会进全库文本普查的人口（KI-098 那一族）。 */
const PLANE = mkdtempSync(join(tmpdir(), 'ki364-data-root-'))
const WRAPPER = join(PLANE, 'inproc-host-argv.mjs')
const INJECT_MARK = '⚠ 数据根已注入'
const DEFAULT_HEADER = 'CAESURA 数据校验（KI-015 门禁）'
const PHANTOM = 'flag.plant_cond_no_writer'
const BOGUS_ARCHETYPE = 'plant_not_an_archetype'

/**
 * 把真表目录里的 `*.json` 铺进注入平面（**只铺表**：`src/data/json/navmesh/` 那一格不是校验器读的陈设，
 * 跟着复制只会让这条腿多背一份烘焙产物）。`plantInto` 每次先交回自己那张表的原件，所以植过种之后
 * 平面仍然是「与真表逐字相同的那份陈设」，而 ③ 要的就是这一份干净副本。
 */
const copyAllTables = () => {
  for (const f of readdirSync(JSON_DIR).filter((x) => x.endsWith('.json'))) cpSync(join(JSON_DIR, f), join(PLANE, f))
}
copyAllTables()

afterAll(() => rmSync(PLANE, { recursive: true, force: true }))

type Verdict = { err: number; warn: number; line: string }
type Run = { status: number | null; stdout: string; stderr: string; out: string; verdict: Verdict }

const spawn = (args: string[]) => {
  const r = spawnSync(process.execPath, [VALIDATOR, ...args], { cwd: root, encoding: 'utf8' })
  expect(r.error, `spawn 校验器没跑起来 = 这一趟没有任何读数（${(r.error as Error | undefined)?.message ?? ''}）`).toBeUndefined()
  return r
}

const verdictOf = (out: string): Verdict => {
  const m = /总计：(\d+) ERROR \/ (\d+) WARN/.exec(out)
  expect(m, `校验器没打印判决行，这一趟没有可核对的读数：\n${out.slice(0, 400)}`).not.toBeNull()
  return { err: Number(m![1]), warn: Number(m![2]), line: m![0] }
}

/**
 * 跑校验器并**要求它有判决行**（评表的那些趟）。
 * 跑不起来不算读数：`spawnSync` 失败时 `status` 是 null，拿那样一趟去断"0 ERROR"就是一条假绿。
 */
const runValidator = (args: string[]): Run => {
  const r = spawn(args)
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out, verdict: verdictOf(out) }
}

/** 拒绝的那些趟（⑦⑧）**以没有判决行为判据**，所以它们走这一份不解析判决的壳。 */
const runRefusal = (args: string[]) => {
  const r = spawn(args)
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

let defaultRun: Run | null = null
/** 默认路（真表）那一趟只跑一次，被 ②③⑤⑨ 当基线用——它同时也是 `npm run validate:data` 的门禁读数。 */
const defaultPath = (): Run => (defaultRun ??= runValidator([]))

const lines = (out: string) => out.split(/\r?\n/)

/** 把某张表交回原件、按 `mutate` 改一格、写进注入平面并跑校验器；`mutate` 返回那格的位置标签。 */
const plantInto = (table: string, mutate: (json: any[]) => string): Run & { site: string } => {
  cpSync(join(JSON_DIR, table), join(PLANE, table))
  const json = JSON.parse(readFileSync(join(JSON_DIR, table), 'utf8')) as any[]
  const site = mutate(json)
  writeFileSync(join(PLANE, table), JSON.stringify(json, null, 2), 'utf8')
  return { ...runValidator([`--data-root=${PLANE}`]), site }
}

/** 表里第一格"没有条件"的刷怪组 ⇒ 植入位（往一格本来就没有条件的空位种旗，牵连的判据最少）。 */
const bareSlot = (regions: any[]): { regionId: string; enemyId: string } => {
  for (const rg of regions ?? []) {
    for (const g of rg?.spawnGroups ?? []) if (g && typeof g.condition !== 'string') return { regionId: rg.id, enemyId: g.enemyId }
  }
  throw new Error('真表里每一格刷怪组都挂着条件 ⇒ 植入位没了，这条腿的前提（往一格空位种旗）要跟着改')
}

/** 表里已有的纯旗标条件（**有写方、今天就是绿的**）⇒ ⑤ 的供体，用来证明 ④ 的红归因于旗名而不是那一格本身。 */
const donorCondition = (regions: any[], site: { regionId: string; enemyId: string }): string => {
  for (const rg of regions ?? []) {
    for (const g of rg?.spawnGroups ?? []) {
      const c = g?.condition
      if (typeof c === 'string' && /^flag\.[A-Za-z0-9_.]+$/.test(c) && !(rg.id === site.regionId && g.enemyId === site.enemyId)) return c
    }
  }
  throw new Error('真表里找不到一条纯旗标形状的条件 ⇒ 供体没了，⑤ 那条"植入合法旗不报红"的对照失去证人')
}

const slotLabel = (s: { regionId: string; enemyId: string }) => `${s.regionId}.spawnGroups(${s.enemyId}).condition`

describe('校验器的数据根：注入吃得下、默认路一个字节都不变、宿主 argv 不算命令行', () => {
  it('①分母自证：注入平面里的 *.json 名册 == 校验器自己声明的 FILES（而且没读空）', () => {
    const roster = arrayLiterals(readFileSync(VALIDATOR, 'utf8'), 'FILES')
    expect(roster, '读不到 `const FILES = [...]` = 这条腿在对着空集自证干净').not.toBeNull()
    expect(roster!.length, `校验器声明只读 ${roster!.length} 份表 = 名册读空了`).toBeGreaterThanOrEqual(20)
    const planeJson = readdirSync(PLANE).filter((f) => f.endsWith('.json')).sort()
    const realJson = readdirSync(JSON_DIR).filter((f) => f.endsWith('.json')).sort()
    expect(planeJson, '注入平面与真表目录不是同一份陈设 = 复制那一步漏了东西').toEqual(realJson)
    expect(
      planeJson,
      '注入平面的 *.json 名册 ⇄ 校验器声明要读的 FILES 对不上 ⇒ 这一趟评的根本不是那份总体',
    ).toEqual([...roster!].sort())
  })

  it('②默认路：一个注入行都不许有，并且按门禁的合同以 0 退出', () => {
    const d = defaultPath()
    expect(d.status, `真表这一趟该以 0 退出（>0 就是 npm run validate:data 红）：${d.out.slice(0, 300)}`).toBe(0)
    expect(lines(d.out)[0], '默认路的表头').toContain(DEFAULT_HEADER)
    expect(lines(d.out).filter((l) => l.startsWith(INJECT_MARK)), '没注入却打印了注入行 = 读数说不清自己评的是哪份表').toEqual([])
    expect(d.verdict.err, '真表此刻的 ERROR 数（钉的是"出厂表干净"，不是某个手抄的数）').toBe(0)
  })

  it('③注入一份干净副本：判决与默认路逐字相同，而输出必须自己承认换了数据根', () => {
    const d = defaultPath()
    copyAllTables()
    const clean = runValidator([`--data-root=${PLANE}`])
    expect(clean.status, `注入一份与真表逐字相同的陈设却红了：\n${clean.out.slice(0, 600)}`).toBe(0)
    expect(clean.verdict.line, '同一份陈设从两条路读，判决行不该差一个字').toBe(d.verdict.line)
    const injectLines = lines(clean.out).filter((l) => l.startsWith(INJECT_MARK))
    expect(injectLines, '注入行必须出现：读数要能指出自己评的不是 src/data/json').toHaveLength(1)
    expect(injectLines[0], '那一行要点名注入的到底是哪个目录').toContain(PLANE)
    expect(
      lines(clean.out).filter((l) => !l.startsWith(INJECT_MARK)),
      '除注入那一行以外，整份输出与默认路逐行相同 ⇒ 注入没顺手改掉任何判据的算法',
    ).toEqual(lines(d.out))
  })

  it('④植入一株没有写方的条件旗：校验器自己报红，并且点名那面旗与那一格', () => {
    const regions = JSON.parse(readFileSync(join(JSON_DIR, 'regions.json'), 'utf8')) as any[]
    const site = bareSlot(regions)
    const p = plantInto('regions.json', (json) => {
      const slot = bareSlot(json)
      for (const rg of json) for (const g of rg?.spawnGroups ?? []) if (rg.id === slot.regionId && g.enemyId === slot.enemyId) g.condition = PHANTOM
      return slotLabel(slot)
    })
    expect(p.site, '植入位由真表现推，两趟读到的该是同一格').toBe(slotLabel(site))
    expect(p.status, '植入幻影旗却以 0 退出 = 校验器对植入仍然是瞎的（§5.9.143 的 A1v 那一格）').toBe(1)
    expect(p.verdict.err, `植入只该多出这一条红：\n${p.out.slice(0, 600)}`).toBe(1)
    const charged = lines(p.out).filter((l) => l.includes(PHANTOM))
    expect(charged.filter((l) => l.trim().startsWith('ERROR')), '植入的旗名要出现在 ERROR 行里，红才归因得上').toHaveLength(1)
    expect(charged[0], 'ERROR 行要点名是哪一格挂着的条件在读它').toContain(p.site)
  })

  it('⑤同一格植入一株有写方的旗：不报红 ⇒ ④ 的红归因于旗名，不归因于那一格', () => {
    const regions = JSON.parse(readFileSync(join(JSON_DIR, 'regions.json'), 'utf8')) as any[]
    const site = bareSlot(regions)
    const donor = donorCondition(regions, site)
    const p = plantInto('regions.json', (json) => {
      const slot = bareSlot(json)
      for (const rg of json) for (const g of rg?.spawnGroups ?? []) if (rg.id === slot.regionId && g.enemyId === slot.enemyId) g.condition = donor
      return slotLabel(slot)
    })
    expect(p.site).toBe(slotLabel(site))
    expect(p.status, `植入合法供体 '${donor}' 却红了 ⇒ 那条红不是幻影旗带来的：\n${p.out.slice(0, 600)}`).toBe(0)
    expect(p.verdict.line, '供体那一趟的判决与默认路逐字相同').toBe(defaultPath().verdict.line)
  })

  it('⑥换一族也吃得下：注入平面里的非法 archetype 同样报红（这条缝不是旗标专用的）', () => {
    const weapons = JSON.parse(readFileSync(join(JSON_DIR, 'weapons.json'), 'utf8')) as any[]
    const first = weapons.find((w: any) => w && typeof w.archetype === 'string')
    expect(first, '武器表里没有一行带 archetype ⇒ 这一族的植入位没了').toBeTruthy()
    const p = plantInto('weapons.json', (json) => {
      const row = json.find((w: any) => w && typeof w.archetype === 'string')
      row.archetype = BOGUS_ARCHETYPE
      return row.id as string
    })
    expect(p.status, '非法原型没报红 = 注入只改了打印出来的目录名，没改数据根').toBe(1)
    expect(p.verdict.err).toBe(1)
    const charged = lines(p.out).filter((l) => l.trim().startsWith('ERROR') && l.includes(BOGUS_ARCHETYPE))
    expect(charged.map((l) => l.trim()), `植入非法原型该只报这一条红（植入位 ${p.site}）`).toHaveLength(1)
    expect(charged[0], 'ERROR 行要点名是哪一行武器').toContain(p.site)
    expect(charged[0], 'ERROR 行要点名那个非法的原型拼写').toContain(BOGUS_ARCHETYPE)
  })

  it('⑦数据根拼错 ⇒ exit 2 并点名路径，而且不许打印判决行', () => {
    const bogus = join(PLANE, 'no-such-table-dir')
    expect(existsSync(bogus), '这条腿要的是一格不存在的目录').toBe(false)
    const r = runRefusal([`--data-root=${bogus}`])
    expect(r.status, '指向不存在的目录却以 0 退出 = 拼错的路径被当成"表很干净"').toBe(2)
    expect(r.stderr, '要把那格不存在的路径原样印出来').toContain(bogus)
    expect(r.out.includes('总计：'), '拒绝的那一趟不该产出一份判决').toBe(false)
  })

  it('⑧认不出的旗 ⇒ exit 2 并说明只认 --data-root=；拼错的旗名（--data-roott）也算认不出', () => {
    const unknown = runRefusal(['--nope'])
    expect(unknown.status, '未知参数被忽略 ⇒ 这一趟退回真表，而 stdout 里那份 0 ERROR 与"植入被抓住"长得一样').toBe(2)
    expect(unknown.stderr, '要交代这扇门只吃哪一面旗').toContain('--data-root=<目录>')
    expect(unknown.out.includes('总计：')).toBe(false)
    // 旗名少写一个字母（`--data-roott=<平面>`）时，**丢掉它并退回真表**是最坏的那种失败。
    const typo = runRefusal([`--data-roott=${PLANE}`])
    expect(typo.status, '拼错的旗被静默忽略 ⇒ 这一趟评的是真表，而读数看不出来').toBe(2)
    expect(typo.stderr, '拒绝的话要把那面拼错的旗原样说出来').toContain('--data-roott=')
    expect(typo.out.includes('总计：')).toBe(false)
  })

  it('⑨进程内 import 时读的是宿主形状的 argv ⇒ 照旧吃真表，不吃宿主的旗', () => {
    const d = defaultPath()
    const bogus = join(PLANE, 'no-such-table-dir-for-inproc')
    writeFileSync(WRAPPER, `// KI-364 腿⑨的合成宿主：argv[1] 是盘上真存在的另一个文件，后面挂着两格校验器不该吃的参数。
// 这正是 tests/unit/ledger-rules.test.ts 进程内 import 校验器那一刻的形状（argv[1] = vitest 的 worker 入口）。
// 校验器有些打印自带前导换行（判决行「总计：」前面那一格空行就是它），所以捕获时按行折叠：那趟读数的行形状要与 CLI 那趟一致。
const sentinel = new Error('__exit__')
const lines = []
const errs = []
let code = null
let threw = null
const real = { log: console.log, error: console.error, exit: process.exit }
process.argv = [process.execPath, process.argv[1], '--data-root=' + process.env.KI364_BOGUS_ROOT, '--nope']
console.log = (...a) => { for (const l of a.map(String).join(' ').split('\\n')) lines.push(l) }
console.error = (...a) => { for (const l of a.map(String).join(' ').split('\\n')) errs.push(l) }
process.exit = (c) => { code = c === undefined ? 0 : c; throw sentinel }
try {
  await import(process.env.KI364_VALIDATOR)
} catch (e) {
  if (e !== sentinel) threw = String((e && e.message) || e)
} finally {
  console.log = real.log; console.error = real.error; process.exit = real.exit
}
real.log('RESULT:' + JSON.stringify({ code, threw, header: lines[0] ?? null, injected: lines.filter((l) => l.startsWith(${JSON.stringify(
      INJECT_MARK,
    )})), judgment: lines.find((l) => l.startsWith(${JSON.stringify('总计：')})) ?? null, refused: lines.concat(errs).filter((l) => /未知参数|指向的目录不存在/.test(l)) }))
`, 'utf8')
    const inproc = spawnSync(process.execPath, [WRAPPER], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, KI364_VALIDATOR: pathToFileURL(VALIDATOR).href, KI364_BOGUS_ROOT: bogus },
    })
    expect(inproc.error, `合成宿主没跑起来 = 这条腿没有任何读数（${(inproc.error as Error | undefined)?.message ?? ''}）`).toBeUndefined()
    const m = /^RESULT:(.*)$/m.exec(inproc.stdout ?? '')
    expect(m, `合成宿主要打印一行 RESULT：\n${(inproc.stdout ?? '').slice(0, 400)}\n--STDERR--\n${(inproc.stderr ?? '').slice(0, 400)}`).not.toBeNull()
    const res = JSON.parse(m![1]) as {
      code: number | null; threw: string | null; header: string | null; injected: string[]; judgment: string | null; refused: string[]
    }
    expect(res.threw, `进程内 import 校验器崩了 ⇒ 这一趟没有读数：${res.threw}`).toBeNull()
    expect(res.code, '宿主 argv 里那两格参数不该被当成校验器自己的命令行（exit 2 = 它吃了宿主的旗）').toBe(0)
    expect(res.judgment, '进程内那一趟的判决行要与默认路逐字相同').toBe(d.verdict.line)
    expect(res.header, '表头也要是默认路那一份').toBe(lines(d.out)[0])
    expect(res.injected, '没注入却打印注入行').toEqual([])
    expect(res.refused, '拒绝那两格只该发生在被当命令行跑的那一趟').toEqual([])
    // 同一串参数、同一个校验器，只把 argv[1] 换成校验器自己 ⇒ 必须是响的。少了这一句，⑨ 可以靠
    // "参数压根没传进去"白过。
    const cli = runRefusal([`--data-root=${bogus}`, '--nope'])
    expect(cli.status, '同样的参数当命令行跑却不拒绝 ⇒ 这条腿的对照塌了（⑨ 的绿不再说明任何事）').toBe(2)
  })
})
