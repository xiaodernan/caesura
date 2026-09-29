import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  arrayLiterals, assignedLiterals, bracketKeys, calledNames, functionBodies, matchBrace,
} from '../../scripts/schema-vocab.mjs'
import { MAP_WAIVER_FIELDS, mapFindings } from '../../scripts/validator-map-rules.mjs'

/**
 * `FILES` 名册 ⇄ `validateX()` 函数那条缝的两端实测（KI-093，结案 KI-088 没做①）。
 *
 * 形状照 `dialogue-reach.test.ts` / `ducking.test.ts`（同一族理由）：判据住在 `scripts/validator-map-rules.mjs`，
 * 门禁与这份测试读**同一段代码**——`validate-data.mjs` 一被 import 就去校验真表并 `process.exit`。
 *
 * 这一批特别要求"抽取器自己也要有证人"：这道门的三端读数全部由 `schema-vocab.mjs` 的那五个新抽取器从
 * `validate-data.mjs` 的**源码**现推，所以它们一瞎，门就一瞎——而门瞎了的样子与"一切正常"完全相同。
 * 下面第一个 describe 就是给它们配的挡板：字符串里的裸花括号、模板串里嵌套的 `${ {…} }`、正则字符类里的
 * 引号与花括号、块注释里的 `}`、真的配不上对的函数体。**每一条都是一次"抽取器读错了函数边界"的成因**，
 * 而读错边界比读不到更糟：它会给出一个自洽的假答案（"这个函数报的是另一张表"）。
 */

type Reading = { name: string; bodyOk: boolean; subjects: string[] | null; reads: string[] | null; readsVar: boolean }
type Waiver = { name: string; why: string; [k: string]: unknown }

const R = (name: string, over: Partial<Reading> = {}): Reading => ({
  name, bodyOk: true, subjects: null, reads: null, readsVar: false, ...over,
})

// —— 合成世界：两张表、两个各有主人的函数、一个不报表的全局函数（走豁免）——
const ROSTER = ['a.json', 'b.json']
const VA = () => R('validateA', { subjects: ['a.json'], reads: ['a.json'] })
const VB = () => R('validateB', { subjects: ['b.json'], reads: ['b.json'] })
const VG = () => R('validateGlobal')
const CALLS = ['validateA', 'validateB', 'validateGlobal']
const WAIVERS: Waiver[] = [{ name: 'validateGlobal', why: '跨表对账，不报任何一张 JSON' }]
const world = (over: { roster?: string[] | null; validators?: Reading[] | null; calls?: string[] | null; waivers?: Waiver[] } = {}) =>
  mapFindings({
    file: 'synthetic',
    roster: over.roster ?? ROSTER,
    validators: over.validators ?? [VA(), VB(), VG()],
    calls: over.calls ?? CALLS,
    waivers: over.waivers ?? WAIVERS,
  })
/** 一条判据只许被它自己那件事打动：每条臂都断言"恰好这一条红、别的都不红" */
const only = (findings: { where: string; msg: string }[], at: string) => {
  expect(findings.map((f) => f.where)).toEqual([at])
  return findings[0].msg
}

describe('抽取器：门的地基先要自己站得住', () => {
  const body = (src: string, name = 'validateA') => {
    const found = functionBodies(src, 'validate')
    expect(found).not.toBeNull()
    return found?.find((b) => b.name === name)?.body ?? null
  }

  it('模板串里嵌套 `${ {…} }` 的花括号不算层：函数体切到真的那个 }', () => {
    const src = "function validateA() {\n  const s = `x${ { deep: 1 } .deep }y{`\n  const file = 'a.json'\n}\n"
    const b = body(src)
    expect(b).not.toBeNull()
    expect(assignedLiterals(String(b), 'file')).toEqual(['a.json'])
  })

  it('字符串里的裸花括号（被引号包住的左括号与右括号）不打动配对器', () => {
    const src = "function validateA() {\n  const open = '{'\n  const close = '}'\n  const file = 'a.json'\n}\n"
    expect(assignedLiterals(String(body(src)), 'file')).toEqual(['a.json'])
  })

  it('正则字面量里的字符类（`/[}{]/`）与引号不打动配对器', () => {
    const src = "function validateA() {\n  const re = /[}{]/\n  const t = 'a/b'\n  const file = 'a.json'\n}\n"
    expect(assignedLiterals(String(body(src)), 'file')).toEqual(['a.json'])
  })

  it('块注释里的右花括号被先剥掉，切出来的体不含注释内容', () => {
    const src = "function validateA() {\n  /* 这里有一个 } 和一个 {  */\n  const file = 'a.json'\n}\n"
    const b = String(body(src))
    expect(assignedLiterals(b, 'file')).toEqual(['a.json'])
    expect(b).not.toContain('这里有一个')
  })

  it('真的配不上对 ⇒ body 为 null（"读不到"必须能被说成"读不到"）', () => {
    expect(body("function validateA() {\n  const file = 'a.json'\n")).toBeNull()
    expect(matchBrace('{ a { b ', 0)).toBe(-1)
  })

  it('函数体内缩进的 function validateB 不当顶层声明数（体只切外层）', () => {
    const src = "function validateA() {\n  const inner = function validateB() { return 1 }\n  const file = 'a.json'\n}\n"
    expect(functionBodies(src, 'validate')?.map((b) => b.name)).toEqual(['validateA'])
    expect(assignedLiterals(String(body(src)), 'file')).toEqual(['a.json'])
  })

  it('参数表里有嵌套括号/带括号的字符串默认值 ⇒ 体仍然切得对（第一版在这里切错过边界）', () => {
    const paren = "function validateA({ x = (1) } = {}) {\n  const file = 'a.json'\n}\n"
    expect(assignedLiterals(String(body(paren)), 'file')).toEqual(['a.json'])
    const strClose = "function validateA(re = ')') {\n  const file = 'a.json'\n}\n"
    expect(assignedLiterals(String(body(strClose)), 'file')).toEqual(['a.json'])
    expect(functionBodies(strClose, 'validate')?.[0].params).toBe("re = ')'")
  })

  it('参数表没闭合、或闭括号后面不是花括号的声明 ⇒ 整条消失（"被调用却没声明"那一条会把它喊出来）', () => {
    const src = "function validateA(a, b\nconst file = 'a.json'\n"
    expect(functionBodies(src, 'validate')).toBeNull()
    expect(calledNames('validateA()\n', 'validate')).toEqual(['validateA'])
  })

  it('assignedLiterals 只认单引号字面量：模板串与变量传值一律读不到 ⇒ null', () => {
    expect(assignedLiterals("  const file = `a.json`\n  const file2 = name\n", 'file')).toBeNull()
    expect(assignedLiterals("  const file = 'a.json'\n  const file = 'b.json'\n", 'file')).toEqual(['a.json', 'b.json'])
  })

  it("bracketKeys 看得见 data['a.json']，看不见变量式 data[k]", () => {
    expect(bracketKeys("data['a.json']; data['a.json']; data[k]; data['b.json']", 'data')).toEqual(['a.json', 'b.json'])
    expect(bracketKeys('data[k]', 'data')).toBeNull()
  })

  it('calledNames：声明那一行不算调用点，出现过一次就算有', () => {
    expect(calledNames('function validateA() { return 1 }\nvalidateB()\n', 'validate')).toEqual(['validateB'])
    expect(calledNames('function validateA() {}\nvalidateA()\n', 'validate')).toEqual(['validateA'])
    expect(calledNames('// validateC()\n', 'validate')).toBeNull()
  })

  it('arrayLiterals 读得回真名册（读空 ⇒ 下面全部红在空转，不会静默绿）', () => {
    const text = readFileSync(new URL('../../scripts/validate-data.mjs', import.meta.url), 'utf8')
    const roster = arrayLiterals(text, 'FILES')
    expect(roster).not.toBeNull()
    expect(roster?.length).toBeGreaterThan(0)
    expect(roster).toContain('ducking.json')
  })
})

describe('拒绝侧：一条判据只许被它自己那件事打动', () => {
  it('基线：合成世界本身全绿（先证明"绿"是可能的，那些 0 才有意义）', () => {
    expect(world()).toEqual([])
  })

  it('名册里多一张没人报的表 ⇒ 它只被 JSON.parse 了一遍', () => {
    const msg = only(world({ validators: [VA(), VG()], calls: ['validateA', 'validateGlobal'] }), 'FILES>b.json')
    expect(msg).toContain('只被 JSON.parse')
  })

  it('函数不报表而没登记豁免', () => {
    const msg = only(world({
      validators: [VA(), VB(), VG(), R('validateStray')],
      calls: [...CALLS, 'validateStray'],
    }), 'validateStray')
    expect(msg).toContain('SUBJECT_WAIVERS')
  })

  it('声明了而主循环没调用 ⇒ 这道门从来没跑过', () => {
    const msg = only(world({ calls: ['validateA', 'validateB'] }), 'validateGlobal')
    expect(msg).toContain('从来没跑过')
  })

  it('主循环调用了而没有这个声明 ⇒ 那条调用今天什么都不做', () => {
    const msg = only(world({ calls: [...CALLS, 'validateNope'] }), 'validateNope')
    expect(msg).toContain('拼错的调用')
  })

  it('报的表不在名册 ⇒ 那个段的 ERROR 既不打印也不计数', () => {
    const msg = only(world({
      validators: [VA(), VB(), VG(), R('validateElsewhere', { subjects: ['elsewhere.json'], reads: ['elsewhere.json'] })],
      calls: [...CALLS, 'validateElsewhere'],
    }), 'validateElsewhere>elsewhere.json')
    expect(msg).toContain('既不打印也不计数')
  })

  it('报而不读：ERROR 记在 a.json 名下而函数只读了 b.json', () => {
    const msg = only(world({ validators: [R('validateA', { subjects: ['a.json'], reads: ['b.json'] }), VB(), VG()] }), 'validateA>a.json')
    expect(msg).toContain("data['a.json']")
  })

  it('变量式 data[file] 算读了自己那一张（明写的近似）', () => {
    expect(world({ validators: [R('validateA', { subjects: ['a.json'], reads: null, readsVar: true }), VB(), VG()] })).toEqual([])
  })

  it('一张表有两个报告者是合法形状（判据是 ≥1 个主人，不是恰好 1 个）', () => {
    expect(world({
      validators: [VA(), VB(), VG(), R('validateACoverage', { subjects: ['a.json'], reads: ['a.json'] })],
      calls: [...CALLS, 'validateACoverage'],
    })).toEqual([])
  })

  it('切不出函数体 ⇒ 它报哪张表无从知道，不许当成"它什么都不报"', () => {
    const msg = only(world({ validators: [VA(), VB(), R('validateCut', { bodyOk: false }), VG()] }), 'validateCut')
    expect(msg).toContain('切不出')
  })

  it('豁免该销：函数已经不在了', () => {
    const msg = only(world({ waivers: [...WAIVERS, { name: 'validateGone', why: '它没了' }] }), 'SUBJECT_WAIVERS.validateGone')
    expect(msg).toContain('该销')
  })

  it('豁免该销：它今天有表了', () => {
    const msg = only(world({ waivers: [{ name: 'validateA', why: '它其实报了 a.json' }, ...WAIVERS] }), 'SUBJECT_WAIVERS.validateA')
    expect(msg).toContain('该销')
  })

  it('豁免没写理由 ⇒ 豁免也要有据（空白串与缺格都算没写）', () => {
    expect(only(world({ waivers: [{ name: 'validateGlobal', why: '   ' }] }), 'validateGlobal')).toContain('理由')
    expect(world({ waivers: [{ name: 'validateGlobal' } as Waiver] }).map((f) => f.where)).toContain('validateGlobal')
  })

  it('豁免行多出来的一格没有消费方（§55），而它可能就是那个理由写错的地方', () => {
    const msg = only(world({ waivers: [{ name: 'validateGlobal', why: '跨表对账', whys: '多出来的一格' }] }), 'SUBJECT_WAIVERS.whys')
    expect(msg).toContain('未知字段')
  })

  it('豁免没有 name：那条豁免谁也豁免不了', () => {
    expect(world({ waivers: [{ name: '', why: '空 name' }, ...WAIVERS] }).map((f) => f.where))
      .toEqual(['SUBJECT_WAIVERS', 'SUBJECT_WAIVERS.'])
  })

  it('三端任何一端读空 ⇒ 报"这道门在空转"，绝不退成全量放行', () => {
    const base = { file: 'synthetic', validators: [VA(), VB(), VG()], calls: CALLS, waivers: WAIVERS }
    expect(only(mapFindings({ ...base, roster: [] }), 'synthetic')).toContain('空转')
    expect(only(mapFindings({ ...base, roster: null }), 'synthetic')).toContain('空转')
    expect(only(mapFindings({ ...base, roster: ROSTER, validators: [] }), 'synthetic')).toContain('空转')
    expect(only(mapFindings({ ...base, roster: ROSTER, validators: null }), 'synthetic')).toContain('空转')
    expect(only(mapFindings({ ...base, roster: ROSTER, calls: [] }), 'synthetic')).toContain('空转')
    expect(only(mapFindings({ ...base, roster: ROSTER, calls: null }), 'synthetic')).toContain('空转')
  })
})

/**
 * 真读数：这道门读的就是 `validate-data.mjs` 这一份文件，所以这里**不能**再抄一份名册或函数清单——
 * 抄了就正是本门要消灭的那个东西。读数一律走与校验器同一批抽取器。
 */
function realWorld() {
  const text = readFileSync(new URL('../../scripts/validate-data.mjs', import.meta.url), 'utf8')
  const validators = (functionBodies(text, 'validate') ?? []).map((b) => R(b.name, {
    bodyOk: b.body !== null,
    subjects: b.body === null ? null : assignedLiterals(String(b.body), 'file'),
    reads: b.body === null ? null : bracketKeys(String(b.body), 'data'),
    readsVar: b.body !== null && /\bdata\[file\]/.test(String(b.body)),
  }))
  const block = /const SUBJECT_WAIVERS = \[([\s\S]*?)\n\]/.exec(text)?.[1] ?? ''
  const waivers = [...block.matchAll(/\{\s*name:\s*'([^']*)',\s*why:\s*'([^']*)'/g)].map((m) => ({ name: m[1], why: m[2] }))
  return { text, input: { file: 'scripts/validate-data.mjs', roster: arrayLiterals(text, 'FILES'), validators, calls: calledNames(text, 'validate'), waivers } }
}

describe('接受侧：真读数为 0，而那个 0 是在这份源码上量出来的', () => {
  it('今天的名册 ⇄ 函数完全对上（0 条 finding）', () => {
    const { input } = realWorld()
    expect(input.roster).not.toBeNull()
    expect(input.validators.length).toBeGreaterThan(0)
    expect(mapFindings(input)).toEqual([])
  })

  it('门读的确实是这一份源码：抽掉名册里的一张表 ⇒ 只红那一张的报告者；挂一张幽灵表 ⇒ 只红那一条没人报', () => {
    const { input } = realWorld()
    const stripped = (input.roster ?? []).filter((f) => f !== 'shop.json')
    expect(mapFindings({ ...input, roster: stripped }).map((f) => f.where)).toEqual(['validateShop>shop.json'])
    expect(mapFindings({ ...input, roster: [...(input.roster ?? []), 'ghost.json'] }).map((f) => f.where)).toEqual(['FILES>ghost.json'])
  })

  it('今天确实没有一张表没有主人、也没有一个函数没有调用点（这两个"没有"是判据的产物，不是散文）', () => {
    const { input } = realWorld()
    const owned = new Set(input.validators.flatMap((v) => v.subjects ?? []))
    expect((input.roster ?? []).filter((f) => !owned.has(f))).toEqual([])
    expect(input.validators.map((v) => v.name).filter((n) => !(input.calls ?? []).includes(n))).toEqual([])
    // 今天没有任何函数同时报两张表 ⇒ `data[file]` 那条近似还没有代价
    expect(input.validators.filter((v) => (v.subjects?.length ?? 0) > 1).map((v) => v.name)).toEqual([])
  })

  it('豁免表只留今天真的不报表的那几个函数，而且逐条写了理由', () => {
    const { input } = realWorld()
    const subjectless = input.validators.filter((v) => (v.subjects ?? []).length === 0).map((v) => v.name).sort()
    expect(input.waivers.map((x) => x.name).sort()).toEqual(subjectless)
    expect(input.waivers.length).toBeGreaterThan(0)
    for (const x of input.waivers) expect(x.why.trim().length).toBeGreaterThan(20)
  })
})

describe('接线：那道门必须是推导，不是又一份抄本', () => {
  it('validateValidatorMap 用抽取器现推三端，且不抄任何 .json 名字', () => {
    const { text } = realWorld()
    const fn = functionBodies(text, 'validateValidatorMap')?.find((b) => b.name === 'validateValidatorMap')
    expect(fn).toBeDefined()
    const b = String(fn?.body)
    for (const call of ['functionBodies(', 'assignedLiterals(', 'bracketKeys(', 'calledNames(', 'arrayLiterals(', 'mapFindings(', 'readFileSync(']) {
      expect(b, `接线里少了 ${call} ⇒ 那一端很可能被抄成了名单`).toContain(call)
    }
    expect(b).not.toMatch(/\.json'/)
  })

  it('它自己被调用（否则它就是它要抓的那种哑门），而且它不报任何表所以登记在豁免里', () => {
    const { input } = realWorld()
    expect(input.calls ?? [], '调用点读不到 validateValidatorMap ⇒ 这道门自己就是它要抓的那种哑门').toContain('validateValidatorMap')
    expect(input.waivers.map((x) => x.name)).toContain('validateValidatorMap')
    expect(input.validators.find((v) => v.name === 'validateValidatorMap')?.subjects).toBeNull()
  })

  it('SUBJECT_WAIVERS 向 KI-086 的覆盖普查交代了自己（一张手抄名单不许没人问）', () => {
    const { text } = realWorld()
    expect(text).toMatch(/name:\s*'SUBJECT_WAIVERS',\s*master:/)
  })

  it('豁免表的行只用 MAP_WAIVER_FIELDS 那两格（导出的白名单在这里有消费者）', () => {
    const { text } = realWorld()
    const block = /const SUBJECT_WAIVERS = \[([\s\S]*?)\n\]/.exec(text)?.[1] ?? ''
    const keys = [...block.matchAll(/(\w+):\s*'/g)].map((m) => m[1])
    expect(keys.length).toBeGreaterThan(0)
    expect([...new Set(keys)].filter((k) => !MAP_WAIVER_FIELDS.includes(k))).toEqual([])
  })
})
