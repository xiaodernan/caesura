import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BUS_RECEIVERS,
  HEAD_UNDECLARED_LEDGER,
  NAMED_EVENT_METHODS,
  declaredEventNames,
  eventCallSites,
  scanSkeleton,
  undeclaredEventNames,
} from '../../scripts/event-rules.mjs'

/**
 * 「主干自证」门（KI-114）：**只看 `HEAD` 的 blob**，每一次按字面量名走事件总线的调用都要落在同一份 HEAD
 * 的 `GameEvents` 名册里。
 *
 * 立的不是风格，是一族会堵死提交通道的切分。KI-114 的实测：`11a194e`（2026-10-10，标题写着"解锁全项目的
 * 提交通道"）把 `bus.emit('combat.bossTelegraph', undefined)` 提交进主干，而它的类型前提——`GameEvents` 里
 * 那条声明——此刻还住在并发会话**未提交**的 `src/core/EventBus.ts:49`。开发用的工作副本因此是绿的
 * （`tsc` 量的是工作树，别人的字节就在脚边），而 HEAD 单独解成的平面红在 `Enemy.ts(932,16) TS2345`。
 * 机器级 pre-commit 恰好量的是那种平面 ⇒ 其后 26 个提交（`git rev-list --count 11a194e..HEAD`）的"钩子绿"
 * 都踩着别人未提交的字节；新克隆 `npm ci && npm run lint` 现在直接红。
 *
 * **为什么这条门不能就是 `tsc`**：类型检查器能发现这件事，但它只在"有全部未提交字节"的平面上发现。
 * 这里判的是 `HEAD`，而且比 tsc 便宜得多——264 份 blob 一次 `git cat-file --batch`（实测 1.1s，逐份
 * `git show` 要 17s），不需要 node_modules，也不需要整个 TS 程序。
 *
 * **豁免的账住在判据旁边**（`scripts/event-rules.mjs > HEAD_UNDECLARED_LEDGER`，与"先记账后接线"那三份
 * 名单同一只手）：空是目标状态；非空时每条必须点名一笔账本编号，而那一行在账本里不许已写着 Implemented
 * ——**同生同死**：谁把声明提交了，就得当场删掉那一格，否则这里红着说"账销了而名单还挂着"。
 * 读账本走的是**工作副本**而不是 HEAD 的 blob：登记这件事本来就发生在工作副本，读 HEAD 会让这一批
 * 在自己的落地提交之前必红，而那条红不携带任何新信息。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))

/** 问 `git` 之前先探当场环境（KI-075 结案立的方式：跳不跳由当场读数决定，不由旧登记决定）。 */
const GIT = (() => {
  const probe = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' })
  const err = probe.error ? (probe.error as NodeJS.ErrnoException).code : null
  const top = (probe.stdout ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const here = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const atRoot = top.toLowerCase() === here.toLowerCase()
  if (err) console.warn(`[event-rules] 响亮跳过 HEAD 那几条腿：本环境 spawn 被当场实测挡下（${err}）—— 换台机器复验`)
  else if (!atRoot)
    console.warn(`[event-rules] 响亮跳过 HEAD 那几条腿：这里不是工作树根（${top || 'git 没答'} ≠ ${here}）—— 冻结平面里没有可问的 HEAD`)
  return { ok: !err && atRoot }
})()

type CallSite = { name: string; method: string; line: number; file: string }

/**
 * HEAD 的 src+tests 全部 .ts。`ls-tree` 列的是**提交面**，与工作副本脏不脏无关——这正是这条门存在的理由：
 * 它要回答的是"新克隆能不能自证"，不是"我这台机器现在绿不绿"。
 */
const headTs = (): string[] => {
  const r = spawnSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'src', 'tests'], { cwd: root, encoding: 'utf8' })
  expect(r.error, 'git ls-tree 跑不起来 = 总体读不到，不许拿空集冒充干净').toBeUndefined()
  return (r.stdout ?? '').split(/\r?\n/).filter((n) => n.endsWith('.ts')).sort()
}

/**
 * 一次 `git cat-file --batch` 读回 N 份 blob（逐文件 `git show` 实测 17s，这一趟 1.1s）。
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

let cached: { files: number; declared: string[]; declaredInEventBus: string[]; sites: CallSite[]; dynamic: { method: string; line: number; file: string }[]; nameless: { method: string; line: number; file: string }[]; offenders: CallSite[] } | null = null
/** 扫一次 HEAD（几条腿共用同一趟扫描 ⇒ 地板与读数必然同源） */
function scanHead() {
  if (cached) return cached
  const paths = headTs()
  const blobs = headBlobs(paths)
  const declared = new Set<string>()
  for (const text of blobs.values()) for (const n of declaredEventNames(text)) declared.add(n)
  const sites: CallSite[] = []
  const dynamic: { method: string; line: number; file: string }[] = []
  const nameless: { method: string; line: number; file: string }[] = []
  for (const [file, text] of blobs) {
    const r = eventCallSites(text, file)
    sites.push(...r.sites)
    dynamic.push(...r.dynamic)
    nameless.push(...r.nameless)
  }
  cached = {
    files: paths.length,
    declared: [...declared].sort(),
    declaredInEventBus: declaredEventNames(blobs.get('src/core/EventBus.ts') ?? ''),
    sites,
    dynamic,
    nameless,
    offenders: undeclaredEventNames({ declared: [...declared], sites }),
  }
  return cached
}

const SRC_RE = /^src\//

describe('主干自证：事件名 ⇄ GameEvents 声明（KI-114）', () => {
  it('对照：合成名册与合成调用点完全对上 ⇒ 一条 offender 都不许报', () => {
    const bus = "export interface GameEvents { 'a.one': undefined; 'b.two': { x: number } }\n"
    const caller = "bus.emit('a.one', undefined)\nbus.on('b.two', (p) => p.x)\n"
    const offenders = undeclaredEventNames({
      declared: declaredEventNames(bus),
      sites: eventCallSites(caller, 'caller.ts').sites,
    })
    expect(offenders, '对照臂自己就该干净；这里红了说明抽取器把合法写法读成了违规').toEqual([])
  })

  it('拒的一侧：用了却没声明 ⇒ offender 把事件名、方法、文件、行号都点名', () => {
    const bus = "export interface GameEvents { 'a.one': undefined }\n"
    const caller = ['line one', "bus.emit('zz.fresh', {})"].join('\n')
    const off = undeclaredEventNames({
      declared: declaredEventNames(bus),
      sites: eventCallSites(caller, 'src/x/Fake.ts').sites,
    })
    expect(off.length, '植进去的那一条没被抓出来 = 判据在空转').toBe(1)
    expect(off[0], '红消息要能指到那一行，所以四个字段都得带着').toEqual({ name: 'zz.fresh', method: 'emit', line: 2, file: 'src/x/Fake.ts' })
  })

  it('声明合并不算违规：主接口没写而别处 `declare module` 写了 ⇒ 名册取并集', () => {
    const main = 'export interface GameEvents { log: undefined }\n'
    const aug = "declare module '../core/EventBus' {\n  interface GameEvents {\n    'ai.callAlly': { fromId: string }\n  }\n}\n"
    const declared = [...new Set([...declaredEventNames(main), ...declaredEventNames(aug)])]
    expect(declared, '声明合并那份没被读到 = 抽取器只认第一个文件').toContain('ai.callAlly')
    expect(undeclaredEventNames({ declared, sites: eventCallSites("bus.emit('ai.callAlly', { fromId: 'e1' })", 'caller.ts').sites })).toEqual([])
  })

  it('深度陷阱：嵌套类型的字段名与联合字面量都不许进名册（进了就是把任何真违规白送）', () => {
    const bus = "export interface GameEvents { 'combat.hit': { result: 'hit' | 'block'; point: { x: number } } }\n"
    const declared = declaredEventNames(bus)
    expect(declared, '名册里只该有深度 1 那一个键').toEqual(['combat.hit'])
    // 名册窄了才算判据还活着：拿一个嵌套词去发射，必须红
    const off = undeclaredEventNames({ declared, sites: eventCallSites("bus.emit('result', 'x')", 'caller.ts').sites })
    expect(off.map((o) => o.name), '嵌套字段名被当成了声明 ⇒ 这条门已经白名单化').toEqual(['result'])
  })

  it('括号陷阱：函数类型成员的形参名不进名册', () => {
    const declared = declaredEventNames("export interface GameEvents { 'x': (a: number, b: string) => void }\n")
    expect(declared, '形参 a / b 不是事件名').toEqual(['x'])
  })

  it('可选成员与方括号：`?:` 算声明，数组类型里的冒号不算', () => {
    const declared = declaredEventNames("export interface GameEvents { 'a.b'?: undefined; 'c.d': { k: string }[] }\n")
    expect(declared, '两种写法都要认出名册，而 `k:` 在方括号里不是事件名').toEqual(['a.b', 'c.d'])
  })

  it('散文陷阱①：注释里写的 `bus.on(...)` 不是调用点（AudioEngine 的注释实测有三处那样的句子）', () => {
    const src = ['/** 判据数源码里 bus.on(`x`) 的处数 */', '// bus.on(`y`)', "bus.on('real.event', fn)"].join('\n')
    const { sites, dynamic } = eventCallSites(src, 'src/audio/AudioEngine.ts')
    expect(sites.map((s) => s.name), '注释里的两行都算成了调用点 = 散文被读成代码').toEqual(['real.event'])
    expect(dynamic, '涂白之后注释里不该再剩下可被误判的形状').toEqual([])
  })

  it('散文陷阱②：字符串字面量里的 `bus.on(` 也不算（`tests/unit/audio-engine.test.ts` 就这么写它的判据）', () => {
    const src = "const probe = (l) => l.includes('bus.on(')\nbus.emit('ui.notify', { msg: 'bus.on(\"not\")' })\n"
    const sites = eventCallSites(src, 'tests/unit/audio-engine.test.ts').sites
    expect(sites.map((s) => s.name), '那句源码文本检查被读成了一次真订阅').toEqual(['ui.notify'])
  })

  it('假接收者不算总线：`el.emit(...)`（假 DOM）与 `w.on(...)`（window）不在判据的总体上', () => {
    const { sites, dynamic } = eventCallSites("el.emit('mousedown', { button: 0 }); w.on('resize', fn)", 'tests/unit/input-device.test.ts')
    expect(sites, 'FakeEl / window 的 on-emit 与事件总线无关，收进来就是把假阳性当病').toEqual([])
    expect(dynamic, '它们也不该记成"动态名"——那不是这条判据的总体').toEqual([])
  })

  it('动态名如实报数而不是当作干净：`bus.on(key, fn)` 进 dynamic，不进 sites', () => {
    const { sites, dynamic } = eventCallSites('bus.on(key, fn)\nthis.subs.push(bus.on(key, fn))', 'src/audio/AudioEngine.ts')
    expect(sites).toEqual([])
    expect(dynamic.length, '两处算不出名字的调用点必须两处都记下来').toBe(2)
    expect(dynamic.map((d) => d.line), '行号要指着那两行').toEqual([1, 2])
  })

  it('模板字面量分两种：无插值算名字，有插值算动态', () => {
    const { sites, dynamic } = eventCallSites('bus.on(`audio.sfx`, fn)\nbus.on(`${row.trigger}`, fn)', 't.ts')
    expect(sites.map((s) => s.name), '没有插值的模板字面量就是个字面量名').toEqual(['audio.sfx'])
    expect(dynamic.length, '插值出来的名字这条判据看不见，必须如实进 dynamic').toBe(1)
  })

  it('退订闭包字段 `this.off()`：不是带名字的总线调用 ⇒ 进 nameless，既不当 offender 也不被吞', () => {
    // 这是 census 那条门第一次红时揪出来的形状（总体 309 ⇔ 归类 306，差的就是三处 `dispose(): void { this.off() }`）：
    // 那个 `off` 是构造时 `bus.on(...)` 的返回值（`EventBus.on` 在 :124 返回 `() => void`），与 `EventBus.off(key, fn)` 撞名。
    const src = 'private readonly off: () => void\nconstructor() { this.off = bus.on("ai.seen", fn) }\ndispose(): void { this.off() }\n'
    const { sites, dynamic, nameless } = eventCallSites(src, 'src/quest/PatrolWatch.ts')
    expect(sites.map((s) => s.name), '构造里那一次真订阅要照常认出').toEqual(['ai.seen'])
    expect(nameless, '空参数表那一次要如实报出来（吞掉它 = census 相等那条门红，而红话说不清差在哪）').toEqual([{ method: 'off', line: 3, file: 'src/quest/PatrolWatch.ts' }])
    expect(dynamic, '它是空括号，不是"名字算不出来"——两类要分开报，混在一起就把机制说丢了').toEqual([])
    // 反向：真带名字的 `this.off(key, fn)`（EventBus 自己 :128/:132 就这么写）必须仍进 sites
    expect(eventCallSites("off(k, f) { this.off('ai.seen', f) }", 'src/core/EventBus.ts').sites.map((s) => [s.name, s.method]),
      '把空参那一类做成"一律不算调用点"就会连这一条一起瞎掉').toEqual([['ai.seen', 'off']])
  })

  it('同名发三次 ⇒ 一条 offender，报第一处（红消息不许把一处手误说成三处）', () => {
    const src = "bus.emit('zz.x', 1)\nbus.emit('zz.x', 2)\nbus.on('zz.x', fn)"
    const off = undeclaredEventNames({ declared: ['ok.y'], sites: eventCallSites(src, 'caller.ts').sites })
    expect(off, '去重 + 保第一处').toEqual([{ name: 'zz.x', method: 'emit', line: 1, file: 'caller.ts' }])
  })

  it('未闭合的引号不猜名字：那种行走 dynamic，不许把后面整篇吞进一个"名字"里', () => {
    const src = "bus.emit('oops\nbus.emit('ui.notify', { msg: 'ok' })\n"
    const { sites, dynamic } = eventCallSites(src, 'caller.ts')
    expect(dynamic.length, '第一行没有闭合引号 ⇒ 只记动态，不拿后面的文本拼一个假名字').toBe(1)
    expect(dynamic[0].line).toBe(1)
    expect(sites.map((s) => s.name), '第二行仍然是合法调用点，不许被上一行带崩').toEqual(['ui.notify'])
  })

  it('scanSkeleton 长度与行数不变，注释涂白而字符串留下（行号判据的地基）', () => {
    const src = "/* 块\n注释 */\nconst s = '带 // 的字符串'\n// 行注释 bus.on('x')\n"
    const { code, inString } = scanSkeleton(src)
    expect(code.length, '涂白是按字符替换的，长度变了行号就全错').toBe(src.length)
    expect(code.split('\n').length).toBe(src.split('\n').length)
    expect(code.includes("bus.on('x')"), '行注释的体没被涂白').toBe(false)
    expect(code.includes("'带 // 的字符串'"), '字符串要原样留下（事件名要从里面读）').toBe(true)
    expect(inString[src.indexOf('带')], '那个 // 在字符串体内，不该被当注释起点').toBe(1)
  })

  it('方法名册双向对账：NAMED_EVENT_METHODS 必须等于从两份源码现推出来的那个集合（漏一条就少扫一片）', () => {
    const busSrc = readFileSync(root + 'src/core/EventBus.ts', 'utf8')
    const audio = readFileSync(root + 'src/audio/AudioEngine.ts', 'utf8')
    const generic = [...busSrc.matchAll(/^ {2}([a-zA-Z]+)<K extends keyof E>\(/gm)].map((m) => m[1])
    const helper = [...audio.matchAll(/^ {2}private ([a-zA-Z]+)<K extends keyof GameEvents>\(/gm)].map((m) => m[1])
    const derived = [...new Set([...generic, ...helper])].sort()
    expect(generic.length, '从 EventBus 现推的泛型方法一条都没读到 = 那个类的写法变了，先更新判据再谈别的').toBeGreaterThanOrEqual(5)
    expect(helper, 'AudioEngine 的私有订阅口形状变了 ⇒ 名册里那条 subscribe 是谁的？').toEqual(['subscribe'])
    expect([...NAMED_EVENT_METHODS].sort(), `总线上吃字面量名的方法就是这些：${derived.join(' ')} ⇒ 名单要跟着源码改`).toEqual(derived)
    expect([...BUS_RECEIVERS].sort(), 'src 里的总线调用只走这两个接收者（下面那条 census 门量它）').toEqual(['bus', 'this'])
  })

  it('每一张 `*-rules.mjs` 都配一份同名 `.d.mts`，导出集合双向相等（缺声明就是测试里 TS7016）', () => {
    const names = readdirSync(root + 'scripts').filter((n) => n.endsWith('-rules.mjs')).sort()
    expect(names.length, 'scripts/ 里一张规则模块都没读到 = 总体空了').toBeGreaterThanOrEqual(12)
    const exportsOf = (text: string): string[] =>
      [...new Set([...scanSkeleton(text).code.matchAll(/^export\s+(?:function|const)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]))].sort()
    for (const n of names) {
      const mjs = exportsOf(readFileSync(`${root}scripts/${n}`, 'utf8'))
      const dtsPath = `${root}scripts/${n.replace(/\.mjs$/, '.d.mts')}`
      expect(existsSync(dtsPath), `${n} 没有同名的 .d.mts ⇒ 测试 import 它是 TS7016，而门禁照跑`).toBe(true)
      const dts = exportsOf(readFileSync(dtsPath, 'utf8'))
      expect(mjs.length, `${n} 一条导出都没读到 = 抽取器读空`).toBeGreaterThan(0)
      expect(mjs.filter((x) => !dts.includes(x)), `${n} 导出了而 .d.mts 没声明`).toEqual([])
      expect(dts.filter((x) => !mjs.includes(x)), `${n.replace('.mjs', '.d.mts')} 声明了而 .mjs 没有 = 那份声明在描述一个不存在的部位`).toEqual([])
    }
  })

  it.skipIf(!GIT.ok)('地板：HEAD 的总体不是空的（读空了的那条绿不算判据，算没跑）', () => {
    const s = scanHead()
    expect(s.files, `HEAD 的 src+tests .ts 只读到 ${s.files} 份 = 名册读空`).toBeGreaterThanOrEqual(150)
    expect(s.declared.length, `名册只读到 ${s.declared.length} 个事件名 = 抽取器没抽到东西`).toBeGreaterThanOrEqual(30)
    expect(s.sites.length, `只读到 ${s.sites.length} 个按字面量名的总线调用 = 总体上没东西可判`).toBeGreaterThanOrEqual(400)
    expect(s.sites.filter((x) => SRC_RE.test(x.file)).length, 'src 里一个总线调用都没有？').toBeGreaterThanOrEqual(100)
  })

  it.skipIf(!GIT.ok)('名册确实分散在多个文件（不读声明合并就会误报，这条把"为什么要合并"钉成读数）', () => {
    const s = scanHead()
    const extra = s.declared.filter((n) => !s.declaredInEventBus.includes(n))
    expect(extra.length, `只读 EventBus.ts 就能得到整份名册的话，合并那条分支就是死代码（现在它多认了 ${extra.length} 个）`).toBeGreaterThanOrEqual(5)
  })

  it.skipIf(!GIT.ok)('src 里 `.<方法>(` 的接收者集合恰好是名单那两个（census 相等：判据不许自己变窄）', () => {
    const s = scanHead()
    // 总体 = HEAD 的 src 里每一处 `.emit(/.on(/…(` 的调用形状（注释与字符串已由 scanSkeleton 涂白/标记）
    const receivers = new Set<string>()
    let total = 0
    const paths = headTs().filter((p) => SRC_RE.test(p))
    for (const [, text] of headBlobs(paths)) {
      const { code, inString } = scanSkeleton(text)
      for (const m of code.matchAll(new RegExp(`([A-Za-z_$][\\w$.]*)\\.(${NAMED_EVENT_METHODS.join('|')})\\s*\\(`, 'g'))) {
        if (inString[m.index!]) continue
        total++
        receivers.add(m[1])
      }
    }
    expect(total, 'src 里一处总线方法调用都没读到 = 总体空了，相等是假的').toBeGreaterThanOrEqual(200)
    const srcSites = s.sites.filter((x) => SRC_RE.test(x.file)).length
    const srcDynamic = s.dynamic.filter((x) => SRC_RE.test(x.file)).length
    const srcNameless = s.nameless.filter((x) => SRC_RE.test(x.file)).length
    // 三类相加 = 总体。差集形状是 `this.off()`：那个 `off` 是 `bus.on(...)` 返回的退订闭包字段
    // （`PatrolWatch/WorldStates/Settlement` 各一处），这条判据读不出它的事件名，也不能把它吞掉。
    expect(srcSites + srcDynamic + srcNameless,
      `总体 ${total} 条里抽取器只归类了 ${srcSites} 具名 + ${srcDynamic} 动态 + ${srcNameless} 空参 ⇒ 差 ${total - srcSites - srcDynamic - srcNameless} 条既没被认下也没被如实报出`).toBe(total)
    expect([...receivers].sort(), '出现了第三种接收者写法 ⇒ 先回答"它是不是事件总线"：是就加进 BUS_RECEIVERS（这条跟着改），不是（假 DOM、window）就换别的方法名，别蹭总线的 API').toEqual(
      [...BUS_RECEIVERS].sort(),
    )
  })

  it.skipIf(!GIT.ok)('HEAD 上的 offender 集合恰好等于账上挂着的那几笔（销一笔必须同时删一格，多一笔必须登记）', () => {
    const s = scanHead()
    const actual = s.offenders.map((o) => o.name).sort()
    const booked = Object.keys(HEAD_UNDECLARED_LEDGER).sort()
    expect(
      actual,
      `主干上这些事件名被按字面量用了却没在 HEAD 的 GameEvents 里声明：\n` +
        s.offenders.map((o) => `  ${o.name}  ← ${o.file}:${o.line} (.${o.method}())`).join('\n') +
        `\n账上挂着的是 [${booked.join(' ')}]。多出来的要么登记进 scripts/event-rules.mjs 的 HEAD_UNDECLARED_LEDGER` +
        `并在 docs/KNOWN_ISSUES.md 立一行，要么把声明补进 EventBus；账上那条已经不在实际里的 ⇒ 声明落地了，删格子并结案。`,
    ).toEqual(booked)
  })

  it('豁免名单每一条都要点名一笔账本编号，而那一行在账本里不许写着 Implemented（同生同死）', () => {
    const entries = Object.entries(HEAD_UNDECLARED_LEDGER)
    expect(entries.length, '豁免名单读空 = 这条判据在看一个空集合（名单非空时它才有活干，空时这一条只证明它没被绕过）').toBeGreaterThanOrEqual(0)
    const ledger = readFileSync(root + 'docs/KNOWN_ISSUES.md', 'utf8')
    for (const [name, reason] of entries) {
      const ki = reason.match(/KI-\d{3}/)?.[0]
      expect(ki, `${name} 的豁免理由没点名任何 KI 编号 = 一笔没有出处的白名单`).toBeTruthy()
      expect(reason.length, `${name} 的豁免理由短到说不出谁欠谁（${reason}）`).toBeGreaterThanOrEqual(120)
      const row = ledger.split(/\r?\n/).find((l) => l.startsWith(`| ${ki} `))
      expect(row, `豁免点名 ${ki}，而账本里没有那一行 = 挂在一笔不存在的债上`).toBeTruthy()
      const cells = row!.split('|').map((c) => c.trim()).filter((c) => c !== '')
      const status = cells[cells.length - 1]
      expect(['Open', 'Partial', 'Placeholder', 'Implemented', 'Blocked'], `${ki} 那一行的状态列读到了不认识的值：${status}`).toContain(status)
      expect(status, `${ki} 在账本里已写着 Implemented，豁免却还挂着 ⇒ 名单该删了`).not.toBe('Implemented')
    }
  })
})
