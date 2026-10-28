import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { evalCondition } from '@/world/SpawnDirector'
import { STATE_TERM_RE, conditionFlagNames, readCondition } from '../../scripts/condition-rules.mjs'

/**
 * 条件语言（`flag.x` / `!flag.x` / `state.K==V` / `state.K!=V`，`&&` 连接）的**两端实测**（KI-341）。
 *
 * 形状照 `dialogue-reach.test.ts` / `ambience-table.test.ts`（同一族理由）：判据住在
 * `scripts/condition-rules.mjs`，门禁与这份测试读**同一段代码**；`validate-data.mjs` 一被 import
 * 就去校验真表并 `process.exit`，所以"喂一串坏条件、看它拒不拒"这一半只有搬出来才量得动。
 *
 * **这一批为什么值得存在**（量出来的，不是推的）：条件语言今天有两个数据宿主
 * （`regions.json > spawnGroups[].condition` 与 `music.ambienceVariants[].condition`），
 * 而旗标的双向对账只认"一个旗名字段"的那几种形状 —— 它**一个都不认识这一族**。
 * 植入实测（`.scratch/ki334_plant.mjs`，2026-10-28）：改一条真条件里的旗名 ⇒ 校验全绿；
 * 一面只被条件读的旗 ⇒ 反倒吃一条"写了没人读 ⇒ 死数据"的假 ERROR。运行时那台机器
 * （`SpawnDirector > evalCondition`）对此一无所知，玩家侧的代价是"那一组永远不刷 / 那张床永远选不到"。
 */

type RegionRow = {
  id: string
  music?: { ambience?: string; ambienceVariants?: Array<{ suffix?: string; condition?: string }> }
  spawnGroups?: Array<{ enemyId?: string; condition?: string }>
}
type StateRow = { key: string; values: string[] }

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const REGIONS = JSON.parse(read('../../src/data/json/regions.json')) as RegionRow[]
const STATES = JSON.parse(read('../../src/data/json/states.json')) as StateRow[]

/** 真表里每一条条件表达式，连着**它自己的载体**（红话要指得出是谁写的） */
const population: Array<{ where: string; expr: string }> = []
for (const rg of REGIONS) {
  for (const g of rg.spawnGroups ?? []) {
    if (typeof g.condition === 'string') population.push({ where: `${rg.id}.spawnGroups(${g.enemyId}).condition`, expr: g.condition })
  }
  for (const v of rg.music?.ambienceVariants ?? []) {
    if (typeof v.condition === 'string') population.push({ where: `${rg.id}.music.ambienceVariants(${v.suffix}).condition`, expr: v.condition })
  }
}

/** 一条表达式在所有可能的世界读数下，运行时与判据**是否给出同一个真值** */
function agreeEverywhere(expr: string): { checked: number; mismatches: string[] } {
  const t = readCondition(expr)
  const flagNames = [...new Set(t.flags.map((f) => f.name))]
  const stateKeys = [...new Set(t.states.map((s) => s.key))]
  const valueChoices = stateKeys.map((k) => {
    const def = STATES.find((s) => s.key === k)
    // 判据读不到的键也要有对照组：那一格取"没写过"（null），运行时按"没有读方 ⇒ 该项为假"处理
    return [null, ...(def ? def.values : [])]
  })
  const subsets: Array<Array<string>> = [[]]
  for (const n of flagNames) subsets.push(...subsets.map((s) => [...s, n]))
  const combos: Array<Array<string | null>> = valueChoices.length === 0 ? [[]] : [[]]
  for (const choices of valueChoices) {
    const next: Array<Array<string | null>> = []
    for (const c of combos) for (const v of choices) next.push([...c, v])
    combos.length = 0
    combos.push(...next)
  }
  let checked = 0
  const mismatches: string[] = []
  for (const fs of subsets) {
    const has = new Set(fs)
    for (const cs of combos) {
      const state = new Map<string, string | null>()
      stateKeys.forEach((k, i) => state.set(k, cs[i]))
      const runtime = evalCondition(expr, (k) => has.has(k), (k) => state.get(k) ?? null)
      const gate = t.flags.every((f) => (f.negated ? !has.has(f.name) : has.has(f.name)))
        && t.states.every((s) => {
          const cur = state.get(s.key) ?? null
          return cur !== null && (s.op === '==' ? cur === s.value : cur !== s.value)
        })
      checked++
      if (runtime !== gate) mismatches.push(`flags=[${fs.join(',')}] states=[${stateKeys.map((k, i) => `${k}=${cs[i] ?? 'null'}`).join(',')}] 运行时=${runtime} 判据=${gate}`)
    }
  }
  return { checked, mismatches }
}

describe('语法这一侧：四形、坏形、以及"读不出来"到底读成什么', () => {
  it('旗标两形：名字与极性都在桶里，state 一项都不许混进来', () => {
    expect(readCondition('flag.a')).toEqual({ flags: [{ name: 'flag.a', negated: false, term: 'flag.a' }], states: [], bad: [] })
    expect(readCondition('!flag.a')).toEqual({ flags: [{ name: 'flag.a', negated: true, term: '!flag.a' }], states: [], bad: [] })
    const two = readCondition('flag.a && !flag.b').flags
    expect(two.map((f) => f.name), '登记进普查的是**去掉 ! 的那一段**——带 ! 的名字永远没有写方').toEqual(['flag.a', 'flag.b'])
    expect(two.map((f) => f.negated)).toEqual([false, true])
  })

  it('状态两形：key 是**整段**（含 state. 前缀）——剥掉前缀就永远查不到 states.json 里那一格', () => {
    const r = readCondition('state.haltrune.camp!=GARRISON')
    expect(r.states).toEqual([{ key: 'state.haltrune.camp', op: '!=', value: 'GARRISON', term: 'state.haltrune.camp!=GARRISON' }])
    expect(STATES.some((s) => s.key === r.states[0].key), '键的拼写必须与 states.json 里那一格逐字相同').toBe(true)
  })

  it('旗与状态混在一条里，两边都登记（只认一种 = 另一半在普查里隐形）', () => {
    const r = readCondition('flag.resolved && state.haltrune.camp==GARRISON')
    expect(r.flags.map((f) => f.name)).toEqual(['flag.resolved'])
    expect(r.states.map((s) => s.key)).toEqual(['state.haltrune.camp'])
    expect(conditionFlagNames('flag.resolved && state.haltrune.camp==GARRISON')).toEqual(['flag.resolved'])
  })

  it('写坏了的形状进 bad 桶，而**运行时把它们读成恒假**（实测，不是注释）', () => {
    const alwaysFalse = (expr: string): boolean => evalCondition(expr, () => true, () => 'anything')
    for (const expr of ['state.haltrune.camp', 'state.haltrune.camp==', 'state.a>1']) {
      const r = readCondition(expr)
      expect(r.bad.length, `'${expr}' 形状不合法却没被点名`).toBe(1)
      expect(r.states).toEqual([])
      expect(alwaysFalse(expr), `'${expr}' 在运行时不是恒假 ⇒ 判据那句"数据门那边会红"的前提变了`).toBe(false)
    }
  })

  it('`!state.K==V`：判据点名，而运行时把它读成**一面叫 "state.K==V" 的旗**——恒假，且旗名是幻影', () => {
    const expr = '!state.haltrune.camp==GARRISON'
    const r = readCondition(expr)
    expect(r.bad.length).toBe(1)
    expect(r.bad[0].why, '判据要说清它到底读成什么，不许含糊成"形状不对"').toContain('恒假')
    expect(r.flags, '这一形不许被当成旗标登记（那会把一个不存在的旗名送进对账）').toEqual([])
    // 恒假不是修辞：`!` 让 term 不再以 `state.` 打头，于是走旗标分支，查的是"state.K==V"这个整串旗名。
    // 三种世界读数全量：有读方、无读方（undefined）两乘，旗名命中与否。
    const keysAsked: string[] = []
    for (const stateOf of [undefined, () => 'GARRISON', () => null] as Array<((k: string) => string | null) | undefined>) {
      for (const hit of [false, true]) {
        const got = evalCondition(expr, (k) => { keysAsked.push(k); return hit }, stateOf)
        expect(got, `stateOf=${stateOf ? 'on' : 'off'} 旗名命中=${hit}`).toBe(hit ? false : true)
      }
    }
    expect([...new Set(keysAsked)], '运行时真正问出口的那个键').toEqual(['state.haltrune.camp==GARRISON'])
  })

  it('`!` 后面没有旗名 ⇒ 点名（运行时那一形是"取反一面空旗"，读成恒真）', () => {
    expect(readCondition('!').bad.map((b) => b.term)).toEqual(['!'])
    expect(evalCondition('!', () => false)).toBe(true)
  })

  it('空串与空白段：桶全空 ⇒ **恒真**（这是"选床那行什么都不要"的形状，不是"谁都选不中"）', () => {
    for (const expr of ['', '   ', 'flag.a && ']) {
      const r = readCondition(expr)
      if (expr === 'flag.a && ') expect(r.flags.map((f) => f.name)).toEqual(['flag.a'])
      else expect(r).toEqual({ flags: [], states: [], bad: [] })
    }
    expect(evalCondition('', () => false), '空条件在运行时是真 ⇒ "恒真"那句话是量出来的').toBe(true)
    expect(evalCondition('flag.a && ', (k) => k === 'flag.a')).toBe(true)
  })

  it('非字符串不炸：三个空桶（数据侧的"缺失/类型错"由 validateRegions 那张嘴说）', () => {
    for (const junk of [undefined, null, 42, true, ['flag.a'], { flag: 'a' }]) {
      expect(readCondition(junk as unknown as string)).toEqual({ flags: [], states: [], bad: [] })
    }
  })

  it('STATE_TERM_RE 与运行时那条是同形：四形逐字都能被它读回来', () => {
    for (const term of ['state.a==B', 'state.a.b_c!=D', 'state.a==B C']) {
      expect(STATE_TERM_RE.test(term), `${term} 应当被这一形读回来`).toBe(true)
    }
    expect(STATE_TERM_RE.test('state.a>=B'), '>= 不是引擎听得懂的一形').toBe(false)
  })
})

describe('判据 ⇄ 运行时同语法：真表里每一条条件，在所有世界读数上给出同一个真值', () => {
  it('名册不该是空的（否则这一族在两侧都是空转）', () => {
    expect(population.length, 'regions.json 里的条件表达式').toBeGreaterThanOrEqual(6)
    expect(population.map((p) => p.where).some((w) => w.includes('ambienceVariants')), 'KI-341 新宿主也得在名册里').toBe(true)
  })

  it('真表里没有一条写坏了的形状（有 ⇒ 校验器此刻正在报 ERROR，这条腿先红）', () => {
    const broken = population.filter((p) => readCondition(p.expr).bad.length > 0)
      .map((p) => `${p.where}: ${readCondition(p.expr).bad.map((b) => b.term).join(', ')}`)
    expect(broken, `坏形状的数据躺在真表里：\n${broken.join('\n')}`).toEqual([])
  })

  it('逐条逐读数对账：evalCondition 与从桶里现算的真值一模一样（对照组 = 每一格都真被翻转过）', () => {
    const rows = population.map((p) => ({ where: p.where, ...agreeEverywhere(p.expr) }))
    for (const r of rows) {
      expect(r.mismatches, `${r.where} 两侧读出的真值不同：\n${r.mismatches.join('\n')}`).toEqual([])
    }
    // 空转检查：至少有一条表达式两侧**都**给过 false（全是 true 的对照说明赋值根本没翻动）
    const sawFalse = population.some((p) => {
      const t = readCondition(p.expr)
      return t.bad.length === 0 && agreeEverywhere(p.expr).checked > 1
    })
    expect(sawFalse, '每个组合都量了不止一个读数 ⇒ 赋值在翻动').toBe(true)
  })

  it('条件里读的每一面旗都有名有姓（拼错的形状与真名一样长，只有 census 能抓住它）', () => {
    const names = [...new Set(population.flatMap((p) => conditionFlagNames(p.expr)))].sort()
    expect(names, '旗名全部带 flag. 前缀（与旗标普查的键同一拼写）').toEqual([...names].filter((n) => n.startsWith('flag.')))
    expect(names.length).toBeGreaterThanOrEqual(4)
  })
})

describe('判据只有一个主人：嘴巴在校验器里，语法不在', () => {
  const code = (rel: string): string =>
    read(rel).split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

  it('校验器走这份判据，没把条件语言的第二台小机器抄回自己家里', () => {
    const v = code('../../scripts/validate-data.mjs')
    expect(v, "import 换了路 = 门读的不再是判据本体").toContain("from './condition-rules.mjs'")
    for (const call of ['readCondition(', 'conditionFlagNames(']) {
      expect(v, `校验器不再走 ${call} = 有一条平行实现悄悄长了出来`).toContain(call)
    }
    // 第二台机器的形状 = 在本文件里再抄一遍那条状态正则
    expect(v, '状态那一形的正则又被抄回校验器里了（语法的主人只有一个）').not.toContain('state\\.[A-Za-z0-9_.]+)(==|!=)')
  })

  /** 取两个锚点之间那段源码；锚点读不到就是**改了名字** ⇒ 当场抛，不许悄悄返回空串把门送绿 */
  const between = (text: string, from: string, to?: string): string => {
    const i = text.indexOf(from)
    if (i < 0) throw new Error(`校验器源码里读不到锚点 '${from}' = 那一族挪了家，这条门评的是空气`)
    if (!to) return text.slice(i)
    const j = text.indexOf(to, i)
    if (j < 0) throw new Error(`锚点 '${from}' 之后读不到 '${to}'`)
    return text.slice(i, j)
  }

  it('旗标普查认得这一族：两个宿主各登记一次读方（少登记一个 = 那一半又隐形了）', () => {
    const v = code('../../scripts/validate-data.mjs')
    /**
     * 这一条**必须**圈住 `collectFlagUsage` 那一段：整片文件里"有这些词"不算数——
     * `spawnGroups` 在校验器里出现十几次，删掉普查里那一支之后全文件的门照样绿（KI-341 的 C5 臂实测到的正是这一格）。
     */
    const flagRegion = between(v, 'function collectFlagUsage() {', 'function validateWorldstate() {')
    for (const [host, carrier] of [
      ['rg.spawnGroups', 'conditionFlagNames(g.condition)'],
      ['rg.music?.ambienceVariants', 'conditionFlagNames(v.condition)'],
    ] as const) {
      expect(flagRegion, `旗标普查里没有 '${host}' 那一支 ⇒ 它读的条件又对名册隐形`).toContain(host)
      expect(flagRegion, `旗标普查里没有 '${carrier}' 那次登记 ⇒ 那个宿主的条件没有读方名册`).toContain(carrier)
    }
    // 值域那一族同理：`state.K` 也是 states.json 的读方。那一段住在没有名字的裸块里 ⇒ 锚在它自己的第一行代码上
    const stateRegion = between(v, 'const writes = new Map(dialogueInfo.stateWrites)')
    for (const carrier of ['stateReadsOf(g.condition', 'stateReadsOf(v.condition']) {
      expect(stateRegion, `值域双向对账里没有条件语言 '${carrier}' 这一支 ⇒ 只被条件读的那一格会被判成死数据（假 ERROR）`).toContain(carrier)
    }
  })

  it('判据本体自己不发报告：它只返回桶（`report.*` 是校验器那张嘴的事）', () => {
    const r = read('../../scripts/condition-rules.mjs')
    for (const call of ['report.error(', 'report.warn(', 'report.num(', 'report.sub(']) {
      expect(r, 'rules 模块里出现了 ' + call + ' = 它开始自己说话了，那就不止一张嘴').not.toContain(call)
    }
  })

  it('music 那两格字段名单在词表对账里有主人（schema 加一格而名单没人看 = 红）', () => {
    const v = read('../../scripts/validate-data.mjs')
    for (const where of ['MUSIC_FIELDS', 'AMBIENCE_VARIANT_FIELDS']) {
      expect(v, `VOCAB_PAIRS 里少了 '${where}' 这一对`).toContain(`where: '${where}'`)
    }
  })
})
