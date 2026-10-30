import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { evalCondition } from '@/world/SpawnDirector'
import { STATE_TERM_RE, conditionFlagNames, conditionReadsOf, mergeConditionReads, readCondition } from '../../scripts/condition-rules.mjs'

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
 *
 * **KI-342 为什么要再动一次**（也是量出来的）：上面那批把登记写进了校验器，但**芯留在原地**——两支手抄的
 * 区域循环。植入实测（`.scratch/ki342_probe.mjs`，2026-10-29）：留壳去芯（把往名册里登记那一句挖掉、
 * 外壳与 `conditionFlagNames(` 调用原样留着）之后，同一株幻影旗从 1 条 ERROR 变成 **0 ERROR，而这文件 17 条全绿**。
 * 也就是说 KI-341 买的只是"形状有唯一主人"，"普查真的会走到每一格"那一半没人钉过。芯搬进
 * `condition-rules.mjs > conditionReadsOf` 之后，它第一次能被喂合成陈设量内容，而校验器只剩一次调用＋一次并入。
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

describe('芯住在这里：名册「走到哪一格」、每一格留下那句什么', () => {
  /**
   * 合成陈设（KI-342 的腿只能喂合成数据）：真表今天每一条条件都有**别处**的读方，所以「普查少了这一族」
   * 在真表上只表现为 fewer `where`，量不出芯坏没坏。这里一格一格把它摆出来：两个宿主、跨区同名、
   * 取反、以及四种坏数据形状。
   */
  const SYNTH = [
    {
      id: 'rg_synth_a',
      spawnGroups: [
        { enemyId: 'en_first', condition: 'flag.open && state.rg_synth_a.mood==CALM' },
        { enemyId: 'en_no_condition' },
        null,
        'not-a-group',
      ],
      music: {
        ambienceVariants: [
          { suffix: 'drum', condition: 'flag.drum' },
          { suffix: 'meg', condition: '!flag.gone' },
          { suffix: 'blank' },
        ],
      },
    },
    { id: 'rg_synth_b', spawnGroups: [{ enemyId: 'en_second', condition: 'flag.drum && state.rg_synth_b.gate!=SHUT' }] },
    { id: 'rg_synth_c', music: { ambienceVariants: 'not-an-array' } },
    'not-a-region',
    null,
    { id: 'rg_synth_d', spawnGroups: [{ enemyId: 'en_junk', condition: 42 }] },
  ]
  const roster = conditionReadsOf(SYNTH)

  it('两个宿主各走到一次：旗与值域两张名册的键与 where 都是量出来的（漏一个宿主 = 那一半隐形）', () => {
    expect([...roster.flags.keys()], '取反也登记，名字是去掉 ! 的那一段').toEqual(['flag.open', 'flag.drum', 'flag.gone'])
    expect([...roster.states.keys()], 'state 的键含 state. 前缀整段（与 states.json 同一拼写）').toEqual(['state.rg_synth_a.mood', 'state.rg_synth_b.gate'])
    expect(roster.flags.get('flag.open'), '刷怪闸门那格的 where').toBe(`rg_synth_a.spawnGroups(en_first).condition 'flag.open && state.rg_synth_a.mood==CALM'`)
    expect(roster.states.get('state.rg_synth_b.gate'), '第二区的闸门也是走到过的一格').toBe(`rg_synth_b.spawnGroups(en_second).condition 'flag.drum && state.rg_synth_b.gate!=SHUT'`)
  })

  it('同一把旗被两条宿主读到：第一次那一格留名，后面的不许覆盖（普查那句指路的话只有一个主人）', () => {
    expect(roster.flags.get('flag.drum'), '声床变体先读到 ⇒ 后面 spawnGroups 那句不许把它挪走').toBe(`rg_synth_a.music.ambienceVariants(drum).condition 'flag.drum'`)
  })

  it('坏数据不炸也不登记：非数组 / null 行 / 不是对象的行 / condition 不是字符串 / 宿主本身不是数组', () => {
    expect(roster.flags.has('flag.drum'), '上面那张名册确实建起来了（这一条是给下面那三句当对照）').toBe(true)
    expect(roster.flags.size, 'rg_synth_c 的 ambienceVariants 是字符串、rg_synth_d 的 condition 是数字 ⇒ 都不许进来').toBe(3)
    expect(roster.states.size).toBe(2)
    for (const junk of [undefined, null, 42, 'a string', {}, true]) {
      const r = conditionReadsOf(junk as unknown as never)
      expect(r.flags.size, `非数组陈设 ${JSON.stringify(junk)} 应当给两张空名册，而不是抛`).toBe(0)
      expect(r.states.size).toBe(0)
    }
  })

  it('并入普查那张 Map：已有的条目赢、返回真加进去的格数、名册不是 Map 就当空的', () => {
    const census = new Map([['flag.open', '某处先登记的 where']])
    const added = mergeConditionReads(census, roster.flags)
    expect(added, 'flag.drum 与 flag.gone 是新格，flag.open 已有 ⇒ 2').toBe(2)
    expect(census.get('flag.open'), '别的宿主先登记过就用先那句 where ⇒ 并进来不许覆盖').toBe('某处先登记的 where')
    expect(census.get('flag.gone'), '新格带着它自己的 where 进来').toBe(`rg_synth_a.music.ambienceVariants(meg).condition '!flag.gone'`)
    expect(mergeConditionReads(census, roster.flags), '第二次并：一格都不该再少').toBe(0)
    for (const notAMap of [undefined, null, [], [['flag.x', 'w']], { flag: 'x' }]) {
      const size = census.size
      expect(mergeConditionReads(census, notAMap as unknown as never), `名册形状不对（${JSON.stringify(notAMap)}）就当空的，不抛`).toBe(0)
      expect(census.size).toBe(size)
    }
  })

  it('真表对账：名册的键 = 每一条条件的读方并集，而每一格的 where 指得回真表那一格', () => {
    const real = conditionReadsOf(REGIONS)
    const union = (of: (expr: string) => string[]) => new Set(population.flatMap((p) => of(p.expr)))
    expect([...real.flags.keys()].sort(), '名册少了/多了旗 ⇒ 普查与表达式之间有一条缝').toEqual([...union((e) => conditionFlagNames(e))].sort())
    expect([...real.states.keys()].sort(), '名册少了/多了值域 ⇒ 上面那句旗的对照不覆盖这一族').toEqual(
      [...union((e) => readCondition(e).states.map((s) => s.key))].sort())
    /**
     * 名册每一格的 `where` 必须是真表某一格**逐字**渲染出来的那句。
     * 这里不按 `区域.宿主(身份)` 建索引去比：同一个 enemyId 可以挂两条闸门（真表里
     * `en_murkshell` 就有两行），那一层撞名会把「指路话」这一条评成假红。整串比对没有这个问题。
     */
    const rendered = new Set<string>()
    for (const rg of REGIONS) {
      for (const g of rg.spawnGroups ?? []) if (typeof g.condition === 'string') rendered.add(`${rg.id}.spawnGroups(${g.enemyId}).condition '${g.condition}'`)
      for (const v of rg.music?.ambienceVariants ?? []) if (typeof v.condition === 'string') rendered.add(`${rg.id}.music.ambienceVariants(${v.suffix}).condition '${v.condition}'`)
    }
    for (const [name, where] of [...real.flags, ...real.states]) {
      expect([...rendered], `'${name}' 的 where 不是真表任何一格的逐字读数（指路话是假的）：${where}`).toContain(where)
    }
    expect(real.flags.size, '真表里条件读的旗（今天的读数）').toBeGreaterThanOrEqual(4)
    expect(real.states.size, '真表里条件读的值域（今天的读数）').toBeGreaterThanOrEqual(1)
  })
})

describe('判据只有一个主人：嘴巴在校验器里，语法不在', () => {
  const code = (rel: string): string =>
    read(rel).split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

  it('校验器走这份判据，没把条件语言的第二台小机器抄回自己家里', () => {
    const v = code('../../scripts/validate-data.mjs')
    expect(v, "import 换了路 = 门读的不再是判据本体").toContain("from './condition-rules.mjs'")
    // KI-342：`conditionFlagNames(` 不再是校验器-call 的了（芯整颗搬走），改钉这三句
    for (const call of ['readCondition(', 'conditionReadsOf(', 'mergeConditionReads(']) {
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

  /**
   * KI-342 重写这一条。KI-341 那版钉的是「普查里有这两支循环、循环里调了 `conditionFlagNames(`」——
   * 而留壳去芯实测把这种钉法评的是空气坐实了：登记那一句挖掉，外壳原样，17 条全绿（`.scratch/ki342_probe.mjs`）。
   * 芯搬走之后校验器只剩两个动作，于是这两格各有名字可钉：**调用芯一次** ＋ **把自己那张 Map 交出去并入**。
   * 反面同样钉：普查那一段不许再自己切表达式（那＝芯又抄回家里，只是抄得比原来短）。
   */
  it('两张普查各自调用芯一次、把自己那张 Map 交出去（芯挪回校验器 / 没人并 = 红）', () => {
    const v = code('../../scripts/validate-data.mjs')
    /**
     * 两条都**必须**圈住各自那一段：整片文件里"有这些词"不算数——
     * `spawnGroups` 在校验器里出现十几次，删掉普查里那一支之后全文件的门照样绿（KI-341 的 C5 臂实测到的正是这一格）。
     */
    const flagRegion = between(v, 'function collectFlagUsage() {', 'function validateWorldstate() {')
    expect(flagRegion, '旗标普查不再调用 conditionReadsOf( ⇒ "走到哪一格"又被手抄回这里了').toContain('conditionReadsOf(')
    expect(flagRegion, '旗标普查没有把名册并进 read 这张 Map ⇒ 条件读的那些旗又对旗标双向对账隐形').toContain('mergeConditionReads(read, ')
    expect(flagRegion, '旗标普查又开始自己逐个切表达式 ⇒ 芯搬回来了（第二台小机器悄悄长了出来）').not.toContain('conditionFlagNames(')
    expect(flagRegion, '旗标普查又开始自己切表达式 ⇒ 芯搬回来了').not.toContain('readCondition(')
    // 值域那一族同理：`state.K` 也是 states.json 的读方。那一段住在没有名字的裸块里 ⇒ 锚在它自己的第一行代码上
    const stateRegion = between(v, 'const writes = new Map(dialogueInfo.stateWrites)')
    expect(stateRegion, '值域普查不再调用 conditionReadsOf( ⇒ 同一颗芯又被抄了一遍').toContain('conditionReadsOf(')
    expect(stateRegion, "值域普查没有把名册并进 reads ⇒ 只被条件读的那一格会被判成死数据（假 ERROR）").toContain('mergeConditionReads(reads, ')
    expect(stateRegion, '值域普查又开始自己走宿主 ⇒ 芯搬回来了').not.toContain('stateReadsOf(')
    expect(stateRegion, '值域普查又开始自己切表达式 ⇒ 同一颗芯被抄了第二遍').not.toContain('readCondition(')
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
