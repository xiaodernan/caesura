import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bus } from '@/core/EventBus'
import { AudioEngine } from '@/audio/AudioEngine'
import { battleScores, duckingRows } from '@/data'
import type { DuckRow } from '@/data/schema'
import { BUS_BASE, DUCK_TC_SEC, activeDucks, deepestFactor, duckFactor, type DuckBusName } from '@/audio/ducking'
import { stripComments, callArgLiterals, unionMembers, schemaBlocks, interfaceFields } from '../../scripts/schema-vocab.mjs'
import { duckFindings, DUCK_FIELDS, DUCK_DB_FLOOR, DUCK_HOLD_MAX_SEC } from '../../scripts/ducking-rules.mjs'
import { FakeAudioContext, FakeNode, fakeWindow, type FakeWindow } from '../support/fakeAudio'

/**
 * docs/audio.md §8.2「Ducking 规则表」第一次有载体（KI-092）。
 *
 * 这张表原本六行全是"写在文档里、没有任何一处代码知道它存在"。本文件只载**能载的那一行**：
 * 「弹反成功 | MUSIC+AMB | -6dB / 300ms」是六行里唯一一句触发口已经在事件总线上真实发射的
 * （发射方：`CombatManager.ts` 的 `bus.emit('combat.parried', …)`，见下面第 15 条用例的普查）。
 * 其余四行缺的是**信号**不是数学（休止的进出、Boss telegraph、菜单开合、同型并发的距离裁决），
 * 它们逐行登记在 `docs/KNOWN_ISSUES.md` 的 KI-092，第 2 条用例把"没载的行必须在账上有名字"本身
 * 变成了判据——文档里的行不会安静地烂着。
 *
 * 量具的四条口径（都是先量过才敢写的）：
 *  - **数字一律从文档现推**：`-6dB`、`300ms`、`MUSIC+AMB` 都从 §8.2 那一行正则抓出来，
 *    测试里没有一处手抄的 −6（抄了就是把测试变成表的复印件，表改了测试不会红）；
 *  - **读调度而不是读差值**：`FakeParam.setTargetAtTime` 只记录事件、不改 `.value`，所以本文件
 *    断言的是"排出去的那一条自动化写了几、值是多少、排在哪个时刻"，绝不拿两次增益相减去猜；
 *  - **总线节点按建图顺序认**（master 之后依 `BUS_BASE` 的键序），不按电平认——电平判据（`busAt`）
 *    在 `AudioEngine` 那一份测试里还要用，但这里 `synth.ts` 里也有 0.45 这种峰值数，按值找会认错人；
 *  - `DUCK_TC_SEC` **不是**设计读数（§8.2 只有休止那一行给了斜率，而那一行今天没载），
 *    所以第 16 条只要求它是"只声明一次、有读者"的常数，不拿它去对文档。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))

/** §8.2 那张表的三列，逐行从文档正文里抓（表就是这张表的主人） */
interface DocDuckRow {
  label: string
  pressed: string
  amount: string
}

function duckTable(): DocDuckRow[] {
  const doc = readFileSync(root + 'docs/audio.md', 'utf8')
  const at = doc.indexOf('### 8.2 Ducking 规则表')
  expect(at, 'docs/audio.md 里找不到 §8.2：这一层的对账对象消失了').toBeGreaterThan(-1)
  const out: DocDuckRow[] = []
  for (const line of doc.slice(at).split('\n').slice(1)) {
    if (line.startsWith('### 8.3')) break
    if (!line.startsWith('|') || line.startsWith('|---')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length !== 3 || cells[0] === '触发源') continue
    out.push({ label: cells[0], pressed: cells[1], amount: cells[2] })
  }
  expect(out.length, '§8.2 的表体一行都没读到 = 量具读的是空气').toBeGreaterThanOrEqual(6)
  return out
}

/** 文档那一列的音量：`-6dB / 300ms` ⇒ −6（表里 `db` 的那个数） */
function dbOf(cell: string): number {
  const m = cell.match(/(-\d+(?:\.\d+)?)dB/)
  expect(m, `这一格里没有 dB 读数：${cell}`).toBeTruthy()
  return Number(m![1])
}

/** 文档那一列的时长：斜杠**之后**的那一段才是"压多久"，斜杠之前是给每条总线各自的 dB */
function holdOf(cell: string): number {
  const tail = cell.includes('/') ? cell.split('/')[1]! : cell
  const ms = tail.match(/(\d+(?:\.\d+)?)ms/)
  if (ms) return Number(ms[1]) / 1000
  const sec = tail.match(/(\d+(?:\.\d+)?)s/)
  expect(sec, `这一格里没有时长读数：${cell}`).toBeTruthy()
  return Number(sec![1])
}

/**
 * 文档的「被压对象」列写成 `MUSIC+AMB` 这种全行大写。名册（`DuckBusName`）才是主人，
 * 所以这里只做两件事：按 `+` 拆开、除 `AMB` 这一处文档缩写外一律小写化，
 * 然后**要求结果落进名册**——别名表写错了不会静默通过，会红在"不是图上的一条总线"那句上。
 */
function targetsFromDoc(cell: string, roster: string[]): string[] {
  return cell
    .split('+')
    .map((s) => s.trim())
    .filter((s) => /^[-\d.]/.test(s) === false)
    .map((s) => (s === 'AMB' ? 'ambience' : s.toLowerCase()))
    .map((s) => {
      expect(roster, `文档里说压 '${s}'，而名册（ducking.ts > DuckBusName）里没有这一条总线`).toContain(s)
      return s
    })
}

const ROSTER = unionMembers(schemaBlocks(readFileSync(root + 'src/audio/ducking.ts', 'utf8')), 'DuckBusName') as string[]
const TABLE = duckTable()
const PARRY_DOC = TABLE.find((r) => r.label === '弹反成功') as DocDuckRow
const PARRY_ROW = duckingRows.find((r) => r.label === '弹反成功') as DuckRow

function srcFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`
    if (statSync(p).isDirectory()) out.push(...srcFiles(p))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

/**
 * 普查结果一律换算成相对 root 的正斜杠名。
 * 这条不是排版：绝对路径混进 `toEqual(['src/…'])` 会红，而混进 `not.toContain('src/…')`**会静默通过**——
 * 后者正好是"发射方不该是音频层自己"那一句，所以这里先把形状统一，再让断言说话。
 */
const rel = (f: string): string => (f.startsWith(root) ? f.slice(root.length) : f).replace(/\\/g, '/')

/* ---------------- 假音频世界（与 audio-engine.test.ts 同一套路子） ---------------- */

const live: Array<() => void> = []
let made: FakeAudioContext[] = []
let w: FakeWindow = null as unknown as FakeWindow

function installWindow(opts: { suspended?: boolean; resumeStalls?: boolean } = {}): void {
  class Spy extends FakeAudioContext {
    constructor() {
      super()
      if (opts.suspended) this.state = 'suspended'
      // autoplay 策略拒绝时 resume() 照样兑现，但 state 仍是 suspended：那条 if 的第二侧
      if (opts.resumeStalls) this.resume = (): Promise<void> => Promise.resolve()
      made.push(this)
    }
  }
  w = fakeWindow(Spy)
  w.install()
}

const LAST = (): FakeAudioContext => made[made.length - 1]

/** 建图之后的那五条 gain：`master` + 按 `BUS_BASE` 键序的四条总线（总线先于音乐层的任何节点建立） */
function busNodes(ctx: FakeAudioContext): { master: FakeNode } & Record<DuckBusName, FakeNode> {
  const gains = ctx.nodes.filter((n) => n.kind === 'gain')
  expect(gains.length, '建图阶段连 master 加四条总线都还没排满').toBeGreaterThanOrEqual(5)
  const out = { master: gains[0] } as { master: FakeNode } & Record<DuckBusName, FakeNode>
  ;(Object.keys(BUS_BASE) as DuckBusName[]).forEach((k, i) => {
    const n = gains[i + 1]
    expect(n.gain.value, `第 ${i + 1} 条总线该是 '${k}'，但它建出来的电平不是 BUS_BASE 的那个数`).toBe(BUS_BASE[k])
    out[k] = n
  })
  return out
}

/** 侧链在一条总线上排过的自动化（`kind:'target'`）——本文件唯一承认的读数来源 */
const ducksOn = (n: FakeNode) => n.gain.events.filter((e) => e.kind === 'target')

/** 开一只已建图、已开声的引擎：返回引擎自己（到期那一格要由它的 `update()` 兑现，不是别人的） */
function liveEngine(): { engine: AudioEngine; ctx: FakeAudioContext; buses: ReturnType<typeof busNodes> } {
  installWindow()
  const engine = new AudioEngine()
  w.dispatch('pointerdown')
  const ctx = LAST()
  const buses = busNodes(ctx)
  return { engine, ctx, buses }
}

const parry = (): void => { bus.emit('combat.parried', { attackerId: 'enemy_1', defenderId: 'player' }) }

beforeEach(() => { made = [] })

afterEach(() => {
  while (live.length) live.pop()!()
  w?.uninstall()
})

describe('§8.2 那一行 ⇄ ducking.json（三个数都从文档现推）', () => {
  it('弹反那一行：targets/db/holdSec 与文档那一行的字一模一样', () => {
    expect(PARRY_DOC, '§8.2 里找不到「弹反成功」那一行 = 主人改名了，这条对账先失效').toBeTruthy()
    expect(PARRY_ROW, 'ducking.json 里没有「弹反成功」这一行：文档那一行今天还没有载体').toBeTruthy()
    expect(PARRY_ROW.targets).toEqual(targetsFromDoc(PARRY_DOC.pressed, ROSTER))
    expect(PARRY_ROW.db).toBe(dbOf(PARRY_DOC.amount))
    expect(PARRY_ROW.holdSec).toBeCloseTo(holdOf(PARRY_DOC.amount), 9)
    // label 就是文档第一列的原字：它是对账的键，不是给人看的注释
    expect(PARRY_ROW.label).toBe(PARRY_DOC.label)
  })

  it('表里不许有文档没有的行；而没载的每一行都必须在 KI-092 的账上有名字', () => {
    const labels = TABLE.map((r) => r.label)
    for (const row of duckingRows) expect(labels, `ducking.json 发明了文档没有的一行：${row.label}`).toContain(row.label)
    // 反向：文档里有、数据里没有 ⇒ 必须有登记，否则"没做"就是安静地烂着
    const ledger = readFileSync(root + 'docs/KNOWN_ISSUES.md', 'utf8')
    const at = ledger.indexOf('KI-092')
    expect(at, 'KNOWN_ISSUES.md 里没有 KI-092 这一节：未落格没有地方记账').toBeGreaterThan(-1)
    const section = ledger.slice(at, at + 4000)
    for (const doc of TABLE) {
      if (duckingRows.some((r) => r.label === doc.label)) continue
      expect(section, `§8.2 的「${doc.label}」既没有载体也没有在 KI-092 里点名`).toContain(doc.label)
    }
  })

  it('判据的两条界都比文档更宽：合法表不许被界拒掉', () => {
    const dbs = [...TABLE.flatMap((r) => [...r.amount.matchAll(/-(\d+(?:\.\d+)?)dB/g)].map((m) => -Number(m[1])))]
    expect(dbs.length, '§8.2 里一个 dB 读数都没抓到 = 这条对账在空转').toBeGreaterThan(0)
    for (const db of dbs) expect(db, `文档自己的读数 ${db}dB 被 DUCK_DB_FLOOR 拒了：界比文档还紧`).toBeGreaterThan(DUCK_DB_FLOOR)
    // 表里最长的那一行（Boss telegraph 的 1.5s）就是上界的证人
    const telegraph = TABLE.find((r) => r.label.includes('telegraph')) as DocDuckRow
    expect(holdOf(telegraph.amount)).toBe(DUCK_HOLD_MAX_SEC)
  })

  it('「万籁战 MUSIC=0」不是侧链行：静音的主人是 battle.json 的 noMusic', () => {
    const wanlai = TABLE.find((r) => r.label.includes('万籁')) as DocDuckRow
    expect(wanlai.amount).not.toMatch(/-\d/) // 那一格写的是 0，不是负数 ⇒ 它不是一次"压低"
    expect(duckingRows.some((r) => r.label.includes('万籁')), '万籁那一行不该进侧链表：它归 battle.json 管').toBe(false)
    expect(battleScores.some((b) => 'noMusic' in b && b.noMusic === true), '而 §6.3 那句"本 Boss 无配乐"在数据里是有的').toBe(true)
  })
})

describe('侧链的数学（不建图就该有断言）', () => {
  it('duckFactor：−6dB 约等于一半，0dB 不压', () => {
    expect(duckFactor(0)).toBe(1)
    expect(duckFactor(-6)).toBeCloseTo(0.5012, 4)
    expect(duckFactor(-6)).toBeCloseTo(0.5, 2) // 「−6dB ≈ 一半」这条听感口径的锚
    expect(duckFactor(-12)).toBeLessThan(duckFactor(-6))
  })

  it('同一条总线叠两次取最深，不做 dB 相加', () => {
    const f6 = duckFactor(-6)
    const folded = deepestFactor([
      { bus: 'music', factor: f6, until: 9 },
      { bus: 'music', factor: f6, until: 9 },
    ])
    // 相加会得出 −12dB（f6²），而文档没有任何一行这么写：这条断言就是那条裁决的证人
    expect(folded.music).toBe(f6)
    expect(folded.music).not.toBeCloseTo(f6 * f6, 6)
  })

  it('取最深是"取最小增益"，不是"取最后写的那一个"', () => {
    const folded = deepestFactor([
      { bus: 'music', factor: 0.5, until: 9 },
      { bus: 'music', factor: 0.25, until: 9 },
      { bus: 'music', factor: 0.7, until: 9 },
    ])
    expect(folded.music).toBe(0.25)
  })

  it('没被请求的总线不出现在折叠结果里（不许替四条总线各排一条没人要的斜坡）', () => {
    expect(Object.keys(deepestFactor([{ bus: 'ambience', factor: 0.5, until: 9 }]))).toEqual(['ambience'])
    expect(Object.keys(deepestFactor([]))).toEqual([])
  })

  it('activeDucks：到点那一拍就不算', () => {
    const r = { bus: 'music', factor: 0.5, until: 1 }
    expect(activeDucks([r], 0.999)).toEqual([r])
    expect(activeDucks([r], 1)).toEqual([])
  })
})

describe('数据 ⇄ 行为（假 AudioContext）', () => {
  it('一次弹反：music+ambience 压到基准×factor，sfx/ui 一格都不动', () => {
    const { ctx, buses } = liveEngine()
    // 建图之后不该有任何人在总线上排自动化：那四条"开场斜坡"是没人听见的历史事件在说话
    for (const k of Object.keys(BUS_BASE) as DuckBusName[]) expect(ducksOn(buses[k]), `建图时 '${k}' 就被压了一次`).toEqual([])
    const at = ctx.currentTime
    parry()
    const db = dbOf(PARRY_DOC.amount)
    for (const k of PARRY_ROW.targets as DuckBusName[]) {
      const ev = ducksOn(buses[k])
      expect(ev.length, `'${k}' 该被压一次`).toBe(1)
      expect(ev[0].value).toBeCloseTo(BUS_BASE[k] * duckFactor(db), 12)
      expect(ev[0].at, '排在当前时刻之后的斜坡不该存在：检波是即时的').toBe(at)
    }
    for (const k of (['sfx', 'ui'] as DuckBusName[])) {
      expect(ducksOn(buses[k]), `'${k}' 不在表里那一行的 targets 上，却被压了`).toEqual([])
    }
  })

  it('到期不是自动事件：没人泵这一帧，压制就一直挂着（这条与下一条是一对）', () => {
    const { ctx, buses } = liveEngine()
    parry()
    expect(ducksOn(buses.music).length).toBe(1)
    ctx.advance(PARRY_ROW.holdSec + 0.05)
    expect(ducksOn(buses.music).length, '请求自己会过期，但把电平写回去的必须是那一帧的 update：这里两样都没发生').toBe(1)
  })

  it('到期由这一帧的 update 兑现：弹回去写的就是 BUS_BASE 那个数', () => {
    const { engine, ctx, buses } = liveEngine()
    parry()
    expect(ducksOn(buses.music).length).toBe(1)
    ctx.advance(PARRY_ROW.holdSec + 0.05)
    engine.update(1 / 60)
    const ev = ducksOn(buses.music)
    expect(ev.length, '到期了却没有"弹回"这一条自动化').toBe(2)
    expect(ev[1].value, '弹回去的那个值必须是 BUS_BASE 本身，不是上一次的目标值').toBe(BUS_BASE.music)
    expect(ev[1].at).toBe(ctx.currentTime)
    engine.update(1 / 60)
    expect(ducksOn(buses.music).length, '已经回到基准还在排：那一格是没人要的第四次斜坡').toBe(2)
  })

  it('压着的那段时间里每帧 update 不重复排同一条斜坡', () => {
    const { engine, ctx, buses } = liveEngine()
    parry()
    for (let i = 0; i < 5; i++) {
      ctx.advance(0.02)
      engine.update(1 / 60)
    }
    expect(ducksOn(buses.music).length, '同一个系数被排了多次 = 每帧一条新斜坡，听感上是一次咔哒').toBe(1)
  })

  it('第二次弹反延长窗口而不加深', () => {
    const { engine, ctx, buses } = liveEngine()
    parry()
    ctx.advance(PARRY_ROW.holdSec * 0.7)
    parry()
    expect(ducksOn(buses.music).length, '加深了：同一电平又排了一条').toBe(1)
    ctx.advance(PARRY_ROW.holdSec * 0.5) // 距第一次 1.2×hold：第一次早该到期，第二次还剩 0.5×hold
    engine.update(1 / 60)
    expect(ducksOn(buses.music).length, '窗口被第二声延长了，这里却提前弹回了').toBe(1)
    ctx.advance(PARRY_ROW.holdSec)
    engine.update(1 / 60)
    const ev = ducksOn(buses.music)
    expect(ev.length).toBe(2)
    expect(ev[1].value).toBe(BUS_BASE.music)
  })

  it('首次手势前：一条请求都不留，建图之后也不会突然压一次', () => {
    installWindow()
    const engine = new AudioEngine()
    parry()
    expect(made.length, '没有手势就不该有 AudioContext').toBe(0)
    w.dispatch('pointerdown')
    const ctx = LAST()
    const buses = busNodes(ctx)
    engine.update(1 / 60)
    for (const k of Object.keys(BUS_BASE) as DuckBusName[]) {
      expect(ducksOn(buses[k]), `'${k}' 在建图之后被一次手势之前的弹反压了：那是没人听见的历史事件`).toEqual([])
    }
  })

  it('resume 被 autoplay 拒（state 仍是 suspended）：不排斜坡也不炸', () => {
    installWindow({ suspended: true, resumeStalls: true })
    const engine = new AudioEngine()
    w.dispatch('pointerdown')
    const ctx = LAST()
    expect(ctx.state).toBe('suspended')
    parry()
    engine.update(1 / 60)
    const buses = busNodes(ctx)
    for (const k of Object.keys(BUS_BASE) as DuckBusName[]) expect(ducksOn(buses[k])).toEqual([])
  })

  it('这个触发口在游戏里真的会响：发射方普查（不能只在表里活着）', () => {
    const files = srcFiles(root + 'src')
    for (const row of duckingRows) {
      const emitters = files.filter((f) => {
        const t = stripComments(readFileSync(f, 'utf8'))
        return t.includes(`bus.emit('${row.trigger}'`)
      })
      expect(emitters.length, `没有任何代码 emit '${row.trigger}'：这一行数据死在表里（§55）`).toBeGreaterThan(0)
      expect(emitters.map(rel), '发射方不该是音频层自己（那是自说自话）').not.toContain('src/audio/AudioEngine.ts')
    }
  })
})

describe('只有一个主人（源码判据）', () => {
  const engineText = stripComments(readFileSync(root + 'src/audio/AudioEngine.ts', 'utf8'))

  it('四条总线电平只写在 BUS_BASE 一处：建图与侧链都按名字读它', () => {
    const mkArgs = [...engineText.matchAll(/\bmk\(([^)]*)\)/g)].map((m) => m[1])
    expect(mkArgs.length, '建图那只 mk() 读不到 = 这一层换形状了，本条判据要跟着改').toBeGreaterThan(0)
    for (const a of mkArgs) expect(a, `mk(${a})：总线电平又变成字面量了，那侧链弹回去时就得再抄一份数`).toContain('BUS_BASE[')
    for (const v of Object.values(BUS_BASE)) {
      // 小数点要转义：不转义的话 `0.9` 也能匹配 `0x9`，那条判据就不是在判电平
      const re = new RegExp(`\\.gain\\.value = ${String(v).replace('.', '\\.')}\\b`)
      expect(re.test(engineText), `引擎里还留着第二份总线电平 ${v}`).toBe(false)
    }
  })

  it('引擎里不出现总线名的字符串字面量（名册的主人只有一个）', () => {
    expect([...engineText.matchAll(/'(sfx|music|ambience|ui)'/g)].map((m) => m[1]), '总线名在引擎里被写成了字面量').toEqual([])
    // DuckBusName 只声明一次：ducking.ts 里那条联合
    const duckText = stripComments(readFileSync(root + 'src/audio/ducking.ts', 'utf8'))
    expect(unionMembers(schemaBlocks(duckText), 'DuckBusName')).toEqual(ROSTER)
    expect(ROSTER).toEqual(Object.keys(BUS_BASE)) // 少一格或多一格都编译不过，这条只是把那句话变成读数
  })

  it('duckingRows 只有一份运行时读者，而那张表的六格都有读者', () => {
    const readers = srcFiles(root + 'src').filter((f) => {
      const t = stripComments(readFileSync(f, 'utf8'))
      return t.includes('duckingRows')
    })
    expect(readers.map(rel).sort()).toEqual(['src/audio/AudioEngine.ts', 'src/data/index.ts'])
    const read = [...engineText.matchAll(/row\.([A-Za-z]+)/g)].map((m) => m[1])
    const runtime = ['trigger', 'targets', 'db', 'holdSec']
    for (const f of runtime) expect(read, `运行时没读 row.${f}：那一格成了只有校验器在管的死字段`).toContain(f)
    // id/label 的读者是判据与文档对账，不是运行时：这句话要有读数
    const rules = stripComments(readFileSync(root + 'scripts/ducking-rules.mjs', 'utf8'))
    expect(rules).toContain('row.id')
    expect(rules).toContain('row.label')
    const schemaText = stripComments(readFileSync(root + 'src/data/schema.ts', 'utf8'))
    expect(interfaceFields(schemaBlocks(schemaText), 'DuckRow')).toEqual(DUCK_FIELDS)
    expect(duckingRows.every((r) => DUCK_FIELDS.every((f) => r[f as keyof DuckRow] !== undefined)), '有一行缺字段').toBe(true)
  })

  it('时间常数只有一个主人：DUCK_TC_SEC 声明一次、被侧链读一次', () => {
    const users = srcFiles(root + 'src').filter((f) => stripComments(readFileSync(f, 'utf8')).includes('DUCK_TC_SEC'))
    expect(users.map(rel).sort()).toEqual(['src/audio/AudioEngine.ts', 'src/audio/ducking.ts'])
    expect([...engineText.matchAll(/DUCK_TC_SEC/g)].length, 'DUCK_TC_SEC 在引擎里被用了不止一次（每条总线的斜坡各排一遍才是对的）').toBe(2)
    expect(DUCK_TC_SEC).toBeGreaterThan(0)
  })

  it('校验器的两张白名单来自源码，不是手抄名单', () => {
    const v = readFileSync(root + 'scripts/validate-data.mjs', 'utf8')
    expect(v.replace(/\s+/g, ''), 'validateDucking 不再从 AudioEngine 现推触发口名单').toContain(`callArgLiterals(engineText,'onDuckTrigger')`.replace(/\s+/g, ''))
    expect(v.replace(/\s+/g, ''), 'validateDucking 不再从 ducking.ts 现推总线名册').toContain(`unionMembers(schemaBlocks(duckText),'DuckBusName')`.replace(/\s+/g, ''))
    // 而且这两个抽取器在真文件上读得到东西（空读数会让门安静地闭上）
    const handled = callArgLiterals(engineText, 'onDuckTrigger')
    expect(handled, '读不到 onDuckTrigger 的字面量实参 = 触发口那半边对账在空转').toBeTruthy()
    for (const row of duckingRows) expect(handled as string[]).toContain(row.trigger)
    expect(ROSTER.length).toBeGreaterThan(0)
  })
})

describe('判据的拒绝面（合成行，真表一个字都不动）', () => {
  const H = ['combat.parried']
  const B = ['sfx', 'music', 'ambience', 'ui']
  const base = (): DuckRow => ({ ...PARRY_ROW })
  const run = (rows: unknown, handled: string[] | null = H, buses: string[] | null = B) => duckFindings('ducking.json', rows, handled, buses)
  const errWhere = (rows: unknown, handled?: string[] | null, buses?: string[] | null) => run(rows, handled, buses).map((f) => `${f.level}:${f.where}`)

  it('接受侧：真表过判据一条都不报（拒绝面全部实测过，接受面也得量一次）', () => {
    expect(run(duckingRows)).toEqual([])
  })

  it('名单读不到 ⇒ 门自曝"在空转"，绝不退成"什么都合法"', () => {
    const a = run(duckingRows, null)
    expect(a.length).toBe(1)
    expect(a[0].msg).toContain('空转')
    const b = run(duckingRows, H, null)
    expect(b.length).toBe(1)
    expect(b[0].msg).toContain('空转')
    expect(run(duckingRows, [], B)[0].msg).toContain('空转')
  })

  it('关系侧三拒：口不存在 / 口没人用 / 总线不在名册', () => {
    const r1 = run([{ ...base(), trigger: 'combat.nope' }])
    expect(errWhere([{ ...base(), trigger: 'combat.nope' }])).toEqual(['error:[0].trigger', 'error:ducking.json'])
    expect(r1[0].msg).toContain('combat.parried') // 报错要把"引擎只认这几个口"念出来
    expect(errWhere([])).toEqual(['error:ducking.json']) // 反向：表空了，引擎那个口就白接了
    const r2 = run(duckingRows, ['combat.parried', 'combat.executed'])
    expect(r2.length).toBe(1)
    expect(r2[0].msg).toContain('combat.executed')
    expect(errWhere([{ ...base(), targets: ['master'] }])).toEqual(['error:[0].targets'])
    expect(run([{ ...base(), targets: ['master'] }])[0].msg).toContain('DuckBusName')
  })

  it('数字侧：db 只许往下压且不越过静音界，holdSec 只许在 0 与文档最长那一行之间', () => {
    for (const [cell, where] of [
      [{ db: 0 }, '[0].db'],
      [{ db: 3 }, '[0].db'],
      [{ db: DUCK_DB_FLOOR }, '[0].db'], // 界本身是开区间：等于下界就是静音，那一格归 battle.json
      [{ db: DUCK_DB_FLOOR - 20 }, '[0].db'],
      [{ db: Number.NaN }, '[0].db'],
      [{ holdSec: 0 }, '[0].holdSec'],
      [{ holdSec: -1 }, '[0].holdSec'],
      [{ holdSec: DUCK_HOLD_MAX_SEC + 0.5 }, '[0].holdSec'],
      [{ holdSec: Number.POSITIVE_INFINITY }, '[0].holdSec'],
    ] as Array<[Partial<DuckRow>, string]>) {
      expect(errWhere([{ ...base(), ...cell }]), `非法读数没被拒：${JSON.stringify(cell)}`).toEqual([`error:${where}`])
    }
    // 合法端的两个极端：刚好在界内要放行
    expect(run([{ ...base(), db: DUCK_DB_FLOOR + 1 }])).toEqual([])
    expect(run([{ ...base(), holdSec: DUCK_HOLD_MAX_SEC }])).toEqual([])
  })

  it('形状侧：顶层、行、字段名、空值、重复 id 各有自己的那句', () => {
    expect(errWhere('x')).toEqual(['error:ducking.json'])
    // 行不是对象 ⇒ 那一行整个没被认下 ⇒ 反向对账（引擎那个口没人用）跟着一起报，两条都要在
    expect(errWhere(['not an object'])).toEqual(['error:[0]', 'error:ducking.json'])
    expect(errWhere([{ ...base(), extra: 1 }])).toEqual(['error:[0].extra'])
    expect(errWhere([{ ...base(), id: '' }])).toEqual(['error:[0].id']) // id 不参与触发口对账 ⇒ 只有它自己那一条
    expect(errWhere([{ ...base(), label: '   ' }])).toEqual(['error:[0].label'])
    expect(errWhere([{ ...base(), targets: [] }])).toEqual(['error:[0].targets'])
    expect(errWhere([{ ...base(), trigger: '' }])).toEqual(['error:[0].trigger', 'error:ducking.json'])
    expect(errWhere([base(), base()])).toEqual(['error:[1].id'])
  })
})
