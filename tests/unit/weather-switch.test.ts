import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { QuestData, RegionData } from '@/data/schema'
import { quests, regions } from '@/data'
import { activeWeather, questTrackedFlags, repairBellFlags } from '@/world/WeatherSwitch'
import { PENDING_WEATHER_SWITCHES, weatherSwitchFindings, trackedBellFlags } from '../../scripts/weather-rules.mjs'

/**
 * 「修钟之后这一区的天气换掉」那条切换腿（KI-094②，需求 §38 + IP_SEED §7）。
 *
 * **这一格为什么必须存在**：KI-094① 把画面收成了唯一仲裁者，但当时 `weatherPresets[1]` 上挂着
 * `fog`／`dissonant-storm` 两个有读数的名字而**运行时无一处能奏到它们**——那两行是一等一的死数据
 * （§55）。今天接上的不是"一个 if"，而是一个**能回答"凭什么换"的判据**：
 * 任务线在等的旗（`quests.json > steps[].advanceOn.flags`）× 站在这一区的钟（`kind === 'bell'`）。
 * 于是这份文件量的三件事是：
 *  ① 推导本身的行为（自己的旗换自己的天、别人家的旗不算、不被追踪的旗不算、钟多于格不出界）；
 *  ② 判据（`scripts/weather-rules.mjs`）与读者（`src/world/WeatherSwitch.ts`）在同一条口径上**不许漂**——
 *     这两份实现不能互相 import（一层是 node 侧判据、一层是玩法侧），所以口径一致性只能由第三方来对账；
 *  ③ 校验器对那些"声明了第二格而今天没有条件"的区逐条喊话，而且那本欠账**双向能销**。
 *
 * 最后一组是源码门：这条腿最容易烂掉的方式不是算错，而是某天有人在组合根里手写一张"这面旗改这个区的天"
 * 的对照表——那张表一落地就开始腐烂，而它模仿的正是这里从数据推出来的东西。
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const readJson = <T>(p: string): T => JSON.parse(readFileSync(`${ROOT}${p}`, 'utf8')) as T

type Finding = { level: 'error' | 'warn'; file: string; where: string; msg: string }

/** 底 = **真表**（从磁盘读，不手抄：抄一份进来，判据与读者就都成了注释） */
const REAL_REGIONS = readJson<unknown[]>('src/data/json/regions.json')
const REAL_QUESTS = readJson<unknown[]>('src/data/json/quests.json')
/** 单测参数（与判据签名一一对应） */

/** 值域登记表（S6 对账 weatherSwitch 值域形的 key/in 用）：key → 合法取值 */
const REAL_STATES = new Map((readJson<{ key: string; values: string[] }[]>('src/data/json/states.json'))
  .map((s) => [s.key, { values: s.values }]))

/** 名册推导只吃这一格形状：写开成别名，免得 `[]` 括号配错把"数组"投成"元素"（我第一版就踩了） */
type QuestLike = { steps?: { advanceOn?: { flags?: string[] } }[] }

/** 旗标名册：主人是 `quests.json > steps[].advanceOn.flags`，与门禁 `validateWeather()` 用同一句现推 */
const flagsOf = (qs: unknown[]): string[] => {
  const out = new Set<string>()
  for (const q of qs as QuestLike[]) {
    for (const s of q.steps ?? []) for (const f of s.advanceOn?.flags ?? []) out.add(f)
  }
  return [...out].sort()
}
const QUEST_FLAGS = flagsOf(REAL_QUESTS)
const tracked = new Set(QUEST_FLAGS)

/** 真区里"立着被追踪的旗"的钟：下面每一臂的归属都从这份派生读，不写死区 id */
const REGIONS_WITH_BELLS = (REAL_REGIONS as RegionData[]).filter((rg) => repairBellFlags(rg, tracked).length > 0)

const run = (
  rs: unknown,
  opts: RunOpts = {},
): Finding[] => weatherSwitchFindings('regions.json', rs,
  opts.questFlags === undefined ? QUEST_FLAGS : opts.questFlags,
  opts.pending === undefined ? PENDING_WEATHER_SWITCHES : opts.pending,
  opts.stateDefs ?? REAL_STATES)
type RunOpts = Partial<{ questFlags: string[] | null; pending: Record<string, string> | null; stateDefs: Map<string, { values: string[] }> | null }>
const errsOf = (rs: unknown, opts?: RunOpts, stateDefs?: Map<string, { values: string[] }> | null): Finding[] =>
  run(rs, { ...opts, stateDefs: stateDefs ?? opts?.stateDefs }).filter((f) => f.level === 'error')

/** 合成区：一口 `kind:'bell'` 的交互物立在哪个旗上，是这套判据唯一的输入 */
const bell = (id: string, setsFlag?: string): Record<string, unknown> =>
  setsFlag === undefined ? { id, kind: 'bell' } : { id, kind: 'bell', setsFlag }
const region = (id: string, presets: string[], inters: Record<string, unknown>[] = []): Record<string, unknown> =>
  ({ id, displayName: id, weatherPresets: presets, interactables: inters })
const asRegion = (r: Record<string, unknown>): RegionData => r as unknown as RegionData
/** 只认这一面旗的读者——用它把"这一格天气是不是这面旗拨的"隔离到唯一变量 */
const only = (flag: string): ((k: string) => boolean) => (k) => k === flag

describe('推导：谁把指针拨到 weatherPresets[1]', () => {
  it('底是活的：名册非空、被追踪的钟非空，而每一口这样的钟都在 quests.json 里真的被某个步骤等着', () => {
    expect(REAL_REGIONS.length, 'regions.json 读空 ⇒ 下面每一臂都在空集合上自证').toBeGreaterThan(0)
    expect(QUEST_FLAGS.length, 'quests.json 里读不到任何 advanceOn.flags ⇒ 切换判据全体空转').toBeGreaterThan(0)
    expect(REGIONS_WITH_BELLS.length, '没有任何一区有"被任务线追踪的钟" ⇒ [1] 那条路今天仍然没有条件，② 就还没落')
      .toBeGreaterThan(0)
    // 逐口钟正面回查磁盘上的任务表：派生用错字段（比如读了 requiresFlag）会在这里红，而不是悄悄挑出另一组钟
    for (const rg of REGIONS_WITH_BELLS) {
      for (const f of repairBellFlags(rg, tracked)) {
        const waited = (REAL_QUESTS as QuestLike[])
          .some((q) => (q.steps ?? []).some((s) => (s.advanceOn?.flags ?? []).includes(f)))
        expect(waited, `'${rg.id}' 的旗 '${f}' 被当成"修好了"的依据，而任务表里没有一个步骤等它`).toBe(true)
      }
    }
  })

  it('一面旗都没立 ⇒ 每一区奏驻留那一格（`[0]`），七区无一例外', () => {
    for (const rg of regions) {
      expect(activeWeather(rg, () => false, tracked), `${rg.id} 在零旗时不奏 [0]`).toBe(rg.weatherPresets[0])
    }
  })

  it('立起**本区**那口钟的旗 ⇒ 该区换成 `[1]`；同一趟里其他区纹丝不动（旗不串区）', () => {
    const switching = REGIONS_WITH_BELLS.filter((rg) => rg.weatherPresets[1] !== undefined)
    expect(switching.length, '没有一区的钟能拨到第二格 ⇒ `[1]` 那条腿今天仍然没有条件，下面那一臂就是在空集合上自证')
      .toBeGreaterThan(0)
    for (const rg of REGIONS_WITH_BELLS) {
      const own = repairBellFlags(rg, tracked)
      expect(own.length, `${rg.id} 的被追踪钟为空 = 这一臂对它没说话`).toBeGreaterThan(0)
      if (rg.weatherPresets[1] === undefined) {
        // 「有钟而只有一格」那一类（今天 = 钟坠院，§8.1 裁决后它的第二格并回基线）。
        // 两侧各自的义务：读者不许奏出 `undefined`（画面那一侧会把它当成"没有天气"而是上一个区的残留），
        // 判据不许沉默（这把钟今天白修，得由 WARN 喊出来而不是由这里的静默交代）。
        expect(activeWeather(rg, only(own[0]), tracked), `${rg.id} 只有驻留那一格，读者却给了别的读数（越界夹取没夹住）`)
          .toBe(rg.weatherPresets[0])
        const shouts = run(REAL_REGIONS).filter((f) => f.level === 'warn' && f.where === rg.id)
        expect(shouts.length, `${rg.id} 有 ${own.length} 面被追踪的钟而天气只有 1 格，判据却不说话 ⇒ 没人知道这把钟拨不动任何东西`)
          .toBe(1)
        expect(shouts[0].msg, 'WARN 要说的是"钟多出来的那一拨没有天气可换"，换成别的话术就是换了判据').toContain('拨不动')
      } else {
        expect(activeWeather(rg, only(own[0]), tracked), `${rg.id} 立了自己的旗还奏 [0]：切换没接上`).toBe(rg.weatherPresets[1])
      }
      for (const other of regions) {
        if (other.id === rg.id) continue
        expect(activeWeather(other, only(own[0]), tracked), `${other.id} 被 '${rg.id}' 的旗拨动了天气`).toBe(other.weatherPresets[0])
      }
    }
  })

  it('立起**别人家**钟的旗 ⇒ 自己的天不变：判据问的是"这一区的钟"，不是"世界上有没有钟被修过"', () => {
    expect(REGIONS_WITH_BELLS.length, '只有一区有钟 ⇒ 这一臂没有对象，换区串扰无从判起').toBeGreaterThan(1)
    const a = REGIONS_WITH_BELLS[0]
    const b = REGIONS_WITH_BELLS[1]
    const flagOfB = repairBellFlags(b, tracked)[0]
    expect(activeWeather(a, only(flagOfB), tracked), `'${b.id}' 的旗拨到了 '${a.id}' 的天上（判据丢掉了区域这一维）`).toBe(a.weatherPresets[0])
  })

  it('敲响倒钟那面**不被任务线追踪**的旗 ⇒ 不改天气：「敲响」不是「修复」，而这件事由数据形状说了算', () => {
    const toll = (REAL_REGIONS as RegionData[])
      .flatMap((rg) => (rg.interactables ?? []).filter((it) => it.kind === 'bell' && typeof it.setsFlag === 'string' && !tracked.has(it.setsFlag)))
      .map((it) => it.setsFlag as string)
    expect(toll.length, '真表里今天没有"立了不被追踪的旗的钟" ⇒ 这一臂在空集合上自证（判据 S4 也会因此空转）')
      .toBeGreaterThan(0)
    const untrackedBellRegion = (regions as RegionData[])
      .find((rg) => (rg.interactables ?? []).some((it) => it.kind === 'bell' && toll.includes(it.setsFlag ?? ''))) as RegionData
    expect(untrackedBellRegion, '那口不被追踪的钟所在的区在装载后的 regions 里找不到 ⇒ 下面那句比较没有对象').toBeDefined()
    for (const f of toll) expect(activeWeather(untrackedBellRegion, only(f), tracked), `'${f}' 拨动了天气，而它不在任务线名册里`)
      .toBe(untrackedBellRegion.weatherPresets[0])
  })

  it('同区两口钟立同一面旗 ⇒ 只拨一格（按**旗**而不是按钟数）', () => {
    // 三格而不是两格：两格时越界夹取会把"重复计数"和"按旗去重"折成同一个读数，那一臂就白写了。
    const r = asRegion(region('rg_two_bells', ['clear', 'fog', 'storm'], [bell('bl_a', 'flag.x'), bell('bl_b', 'flag.x')]))
    expect(activeWeather(r, () => true, new Set(['flag.x']))).toBe('fog')
  })

  it('同区两口钟立**两面**旗 ⇒ 拨到第二格（旗数就是格数，一口钟一格）', () => {
    const r = asRegion(region('rg_two_flags', ['clear', 'fog', 'storm'], [bell('bl_a', 'flag.a'), bell('bl_b', 'flag.b')]))
    const set = new Set(['flag.a', 'flag.b'])
    expect(activeWeather(r, only('flag.a'), set)).toBe('fog')
    expect(activeWeather(r, () => true, set)).toBe('storm')
  })

  it('钟数多于天气格数 ⇒ 停在最后一格而不出界（数组越界会奏出 undefined，而 undefined 会被当成"没有天气"）', () => {
    const r = asRegion(region('rg_three_bells', ['clear', 'fog'], [bell('bl_a', 'flag.a'), bell('bl_b', 'flag.b'), bell('bl_c', 'flag.c')]))
    const set = new Set(['flag.a', 'flag.b', 'flag.c'])
    expect(activeWeather(r, () => true, set)).toBe('fog')
    expect(activeWeather(r, (k) => k !== 'flag.c', set)).toBe('fog')
  })

  it('没有区 / 那一区没声明天气 ⇒ null（画面那侧退成基线，而不是退成"上一个区的天气"）', () => {
    expect(activeWeather(null, () => true, tracked), '不在任何区也要有一个可读的天气').toBeNull()
    expect(activeWeather(asRegion(region('rg_bare', [])), () => true, tracked)).toBeNull()
  })
})
describe('入口二：weatherSwitch（art-direction §8.1.2 选 A，KI-094② 最后两格）', () => {
  /** 值域形的键名就用真表那一格（休垒那口钟的四格），不手写第二份名册 */
  const STATE_KEY = 'state.bells.fourth_dumb'
  const stateRegion = (): Record<string, unknown> =>
    ({ ...region('rg_state', ['clear', 'emberfall']), weatherSwitch: { state: { key: STATE_KEY, in: ['RUNG', 'MELTED', 'SEALED'] } } })

  it('旗形：那面旗立着 ⇒ 换格；没立 ⇒ 驻留（营地的形状）', () => {
    const r = asRegion({ ...region('rg_camp', ['clear', 'fog']), weatherSwitch: { flag: 'flag.brokenbar_resolved' } })
    expect(activeWeather(r, () => false, tracked), '旗没立 ⇒ 还是驻留那一格').toBe('clear')
    expect(activeWeather(r, only('flag.brokenbar_resolved'), tracked), '旗立着 ⇒ 换成第二格').toBe('fog')
    // 别人家的旗不管用（与钣那一股同形：条件必须指向这一区）
    expect(activeWeather(r, only('flag.bell_second_repaired'), tracked), '别的区的旗不该拨动天气').toBe('clear')
  })

  it('值域形：in 里的值算成立，INTACT 不算（休垒的形状）', () => {
    const r = asRegion(stateRegion())
    for (const v of ['RUNG', 'MELTED', 'SEALED']) {
      expect(activeWeather(r, () => false, tracked, () => v), `${v} 落进 in ⇒ 该换格`).toBe('emberfall')
    }
    expect(activeWeather(r, () => false, tracked, () => 'INTACT'), 'INTACT = 还没抉择，不构成换天的理由').toBe('clear')
  })

  it('值域形而不传读者 ⇒ 当不成立（不拿空值去比较）', () => {
    const r = asRegion(stateRegion())
    // 空值比较会把"这个程序没接值域"变成"值域没动"——两者在画面上同样是一片霧，只能在这里分开。
    expect(activeWeather(r, () => true, tracked), '不传 stateValue 时值域形不得唤醒').toBe('clear')
  })

  it('两种来源不叠加：有 weatherSwitch 就不数钟（钟立着也不让位）', () => {
    const r = asRegion({
      ...region('rg_both', ['clear', 'fog', 'storm'], [bell('bl_a', 'flag.bell_second_repaired')]),
      weatherSwitch: { flag: 'flag.never_set' },
    })
    expect(activeWeather(r, only('flag.bell_second_repaired'), tracked), '钟的旗立着，但这一区声明了旗形且那面旗没立 ⇒ 仍然驻留').toBe('clear')
  })
})

describe('判据新臂：S1 双主人 / S6 形状（weatherSwitch 落地）', () => {
  it('S6：同时写旗形与值域形 ⇒ ERROR（一个第二格只能有一个主人）', () => {
    const out = errsOf([{ ...region('rg_two_forms', ['clear', 'fog']), weatherSwitch: { flag: 'flag.x', state: { key: 'state.bells.fourth_dumb', in: ['RUNG'] } } }], { pending: {} })
    expect(out.map((f) => f.where), 'S6 要在形状就把这种区拦下来').toEqual(['rg_two_forms.weatherSwitch'])
    expect(out[0].msg).toContain('同时')
  })

  it('S6：一个都不写（空对象）/ 空白 flag / 空的 in ⇒ 各自一条 ERROR', () => {
    expect(errsOf([{ ...region('rg_empty', ['clear', 'fog']), weatherSwitch: {} }], { pending: {} })[0].where).toBe('rg_empty.weatherSwitch')
    expect(errsOf([{ ...region('rg_blank', ['clear', 'fog']), weatherSwitch: { flag: '  ' } }], { pending: {} })[0].where).toBe('rg_blank.weatherSwitch')
    expect(errsOf([{ ...region('rg_noin', ['clear', 'fog']), weatherSwitch: { state: { key: 'state.bells.fourth_dumb', in: [] } } }], { pending: {} })[0].where)
      .toBe('rg_noin.weatherSwitch.state.in')
  })

  it('S6：值域形的 key 不在 states.json / in 里有非法取值 ⇒ 各自一条 ERROR', () => {
    const states = new Map([['state.bells.fourth_dumb', { values: ['INTACT', 'RUNG', 'MELTED', 'SEALED'] }]])
    const badKey = errsOf([{ ...region('rg_badkey', ['clear', 'fog']), weatherSwitch: { state: { key: 'state.nope', in: ['RUNG'] } } }], { pending: {}, stateDefs: states })
    expect(badKey.map((f) => f.where)).toEqual(['rg_badkey.weatherSwitch.state.key'])
    expect(badKey[0].msg).toContain('states.json')
    const badVal = errsOf([{ ...region('rg_badval', ['clear', 'fog']), weatherSwitch: { state: { key: 'state.bells.fourth_dumb', in: ['RUNG', 'NOPE'] } } }], { pending: {}, stateDefs: states })
    expect(badVal.map((f) => f.where)).toEqual(['rg_badval.weatherSwitch.state.in'])
    expect(badVal[0].msg).toContain('INTACT')
  })

  it('S1：声明了 weatherSwitch 而只有一格天气 ⇒ ERROR（那一格条件成立了也没有第二格可换）', () => {
    const out = errsOf([{ ...region('rg_one_slot_switch', ['clear']), weatherSwitch: { flag: 'flag.x' } }], { pending: {} })
    expect(out.map((f) => f.where)).toEqual(['rg_one_slot_switch.weatherSwitch'])
  })

  it('S1：weatherSwitch 与本区被追踪的钣同时在场 ⇒ ERROR（两种来源不叠加）', () => {
    const out = errsOf([{ ...region('rg_both_src', ['clear', 'fog'], [bell('bl_a', 'flag.bell_second_repaired')]), weatherSwitch: { flag: 'flag.x' } }], { pending: {} })
    expect(out.map((f) => f.where), '只报区本身，不报钟也不报旗（问题在于两个主人，不在任何一个）').toEqual(['rg_both_src'])
    expect(out[0].msg).toContain('不叠加')
  })

  it('销账：区有了 weatherSwitch 而账还挂着 ⇒ ERROR 说该销（与钣一族同形）', () => {
    const out = errsOf([{ ...region('rg_now_declared', ['clear', 'fog']), weatherSwitch: { flag: 'flag.x' } }],
      { pending: { rg_now_declared: '这条待办已经过期，它该被判据喊出来而不是静静留着（够长的理由）' } })
    expect(out.map((f) => f.where)).toEqual(['PENDING_WEATHER_SWITCHES.rg_now_declared'])
  })
})


describe('判据 ⇄ 读者：同一句口径在两个平面各写了一遍，所以必须逐区对账', () => {
  it('`scripts/weather-rules.mjs > trackedBellFlags` 与 `src/world/WeatherSwitch.ts > repairBellFlags` 在真表上逐区逐字相同（含顺序）', () => {
    let compared = 0
    for (const rg of regions) {
      const reader = repairBellFlags(rg, tracked)
      const judge = [...new Set(trackedBellFlags(rg, tracked))]
      compared++
      expect(judge, `${rg.id}：判据挑出的钟与读者挑出的钟不是一份（两份账已经开始漂）`).toEqual(reader)
    }
    expect(compared, 'regions 读空 ⇒ 上面那句"逐区相同"是空集合上的真话').toBe(regions.length)
  })

  it('名册的两个来源对账：`questTrackedFlags(真 quests)` ⇄ 直接从磁盘推的那一份', () => {
    const fromLoader = [...questTrackedFlags(quests as QuestData[])].sort()
    expect(fromLoader.length, '@/data 装载后的任务表读不出旗标 ⇒ 运行时名册是空的，切换永远停在 [0]').toBeGreaterThan(0)
    expect(fromLoader, '装载后的名册与磁盘上的名册不一致（大概是 data/index.ts 丢了 advanceOn 那一格）').toEqual(QUEST_FLAGS)
  })

  it('校验器那条名册推导**执行的必须是同一句**：把它自己的表达式拿出来对真 quests.json 求值，结果要等于运行时的名册', () => {
    // `validate-data.mjs` 一被 import 就去校验真表并 `process.exit`（KI-075），所以这条对账不能靠 import。
    // 但只 grep "`advanceOn` 这个词还在"是不够的：把那句换成 `requiresFlag` 今天挑出同一批钟（两条判据在此
    // 重合），换掉的当天没有任何人说话。于是这里**把它写的表达式取出来就地求值**——改的如果是那句的输入，
    // 求出来的名册立刻与运行时那份不一致，红。
    const validator = readFileSync(`${ROOT}scripts/validate-data.mjs`, 'utf8').replace(/\r\n/g, '\n')
    const expr = validator.match(/const questFlags = ([\s\S]*?)\n {2}for \(const f of weatherSwitchFindings/)?.[1]
    expect(expr, '读不到校验器里 questFlags 那条推导（它换了写法 ⇒ 这条对账在空转）').toBeTypeOf('string')
    const isArr = (v: unknown): boolean => Array.isArray(v)
    const isObj = (v: unknown): boolean => !!v && typeof v === 'object' && !Array.isArray(v)
    const isStr = (v: unknown): boolean => typeof v === 'string' && v.length > 0
    const data: Record<string, unknown> = { 'quests.json': REAL_QUESTS }
    const evaluate = new Function('data', 'isArr', 'isObj', 'isStr', `return (${expr})`) as
      ((...a: unknown[]) => string[])
    const fromValidator = [...new Set(evaluate(data, isArr, isObj, isStr))].sort()
    expect(fromValidator.length, '校验器那句在真 quests.json 上求出空名册 ⇒ S1–S5 全体空转').toBeGreaterThan(0)
    expect(fromValidator, '校验器推的名册 ⇄ 运行时 `questTrackedFlags` 推的名册不是同一份（两份账已经开始漂）')
      .toEqual(QUEST_FLAGS)
  })

  it('真表在真账本下零条 ERROR，而 WARN 的位点**由数据派生**而不是数出来的', () => {
    const out = run(REAL_REGIONS)
    expect(out.filter((f) => f.level === 'error'), '真表响了一条切换判据的 ERROR').toEqual([])
    // 期望集全部现推：S1（有第二格、没有钟、挂着账的那些区）+ S3（钟数与格数不齐的区）+ S4（立了不被追踪的旗的钟）
    const expected: string[] = []
    const s1Sites: string[] = []
    for (const rg of REAL_REGIONS as RegionData[]) {
      const bells = repairBellFlags(rg, tracked).length
      const slots = Math.max((rg.weatherPresets?.length ?? 0) - 1, 0)
      if (slots > 0 && bells === 0 && PENDING_WEATHER_SWITCHES[rg.id] !== undefined) s1Sites.push(rg.id)
      // S3 只在"有钟"时才开口（没钟也没第二格 = 这一区压根不参与切换，不是不齐）
      if (bells > 0 && bells !== slots) expected.push(rg.id)
      for (const it of rg.interactables ?? []) {
        if (it.kind !== 'bell') continue
        if (typeof it.setsFlag !== 'string' || !tracked.has(it.setsFlag)) expected.push(`${rg.id}.interactables(${it.id})`)
      }
    }
    // 账本的每一条今天都还得对着一个"欠条件的区"：对不上就是死条目（该销）或漏账（该挂），两种都是 ERROR
    expect(s1Sites.sort(), 'PENDING_WEATHER_SWITCHES 与"真表里那些有第二格却没有条件的区"已经不是同一份')
      .toEqual(Object.keys(PENDING_WEATHER_SWITCHES).sort())
    expected.push(...s1Sites)
    expect(out.filter((f) => f.level === 'warn').map((f) => f.where).sort(), 'WARN 的位点变了：要么是新的区欠条件，要么是新增/改名的钟')
      .toEqual(expected.sort())
  })
})

describe('判据臂：每一臂只改一个形状，红的那条必须归得到它', () => {
  const SYNTH = [region('rg_plain', ['clear']), region('rg_switch', ['clear', 'fog'], [bell('bl_one', 'flag.bell_second_repaired')])]

  it('合成底自己先合法：零条 ERROR（一条红的底量不出"只红一条"）', () => {
    expect(errsOf(SYNTH, { pending: {} })).toEqual([])
  })

  it('S1：声明了第二格而区内没有钟，也没挂账 ⇒ ERROR 指名那一区（那一格天气今天永远不响）', () => {
    const out = errsOf([region('rg_ghost', ['clear', 'fog'])], { pending: {} })
    expect(out.length, `只该红一条，实际：${out.map((f) => f.where).join(' / ')}`).toBe(1)
    expect(out[0].where).toBe('rg_ghost.weatherPresets')
    expect(out[0].msg).toContain('PENDING_WEATHER_SWITCHES')
  })

  it('S1 的退路：同一区挂进账本 ⇒ 那条 ERROR 换成 WARN（欠账可以挂，不能不挂）', () => {
    const withLedger = run([region('rg_ghost', ['clear', 'fog'])], { pending: { rg_ghost: '这一区的变化走的不是修钟那条腿，天气条件欠叙事裁决（合成臂用的理由）' } })
    expect(withLedger.filter((f) => f.level === 'error')).toEqual([])
    expect(withLedger.filter((f) => f.level === 'warn').map((f) => f.where)).toEqual(['rg_ghost'])
  })

  it('S1 销账：区里放了一口被追踪的钟而账还挂着 ⇒ ERROR 说该销（两种交代不许同时挂）', () => {
    const out = errsOf([region('rg_fixed', ['clear', 'fog'], [bell('bl_b', 'flag.bell_second_repaired')])],
      { pending: { rg_fixed: '这条待办已经过期了，它该被判据喊出来而不是静静留着' } })
    expect(out.map((f) => f.where)).toEqual(['PENDING_WEATHER_SWITCHES.rg_fixed'])
  })

  it('账本自己的死条目：区不存在 / 区只剩一格 / 理由短到没法判断 ⇒ 各自一条 ERROR', () => {
    const out = errsOf([region('rg_one_slot', ['clear']), region('rg_short', ['clear', 'fog'])], {
      pending: {
        rg_missing: '这一区根本不在名册里，条目挂着就是第二种假账（够长的理由）',
        rg_one_slot: '这一区已经只剩驻留那一格天气，没有要切换的第二格了（够长的理由）',
        rg_short: '太短',
      },
    })
    expect(out.map((f) => f.where).sort()).toEqual(['PENDING_WEATHER_SWITCHES.rg_missing', 'PENDING_WEATHER_SWITCHES.rg_one_slot', 'PENDING_WEATHER_SWITCHES.rg_short'])
  })

  it('S2：一面被追踪的旗被两区的钟同时立 ⇒ ERROR 指名那面旗（"这面旗改谁的天"没有答案）', () => {
    const out = errsOf([
      region('rg_a', ['clear', 'fog'], [bell('bl_a', 'flag.bell_second_repaired')]),
      region('rg_b', ['clear', 'still'], [bell('bl_b', 'flag.bell_second_repaired')]),
    ], { pending: {} })
    expect(out.map((f) => f.where), '共享旗没有报错，或者顺带把两区各报一条：判据把归属问题当成了每区的问题')
      .toEqual(['flag.bell_second_repaired'])
  })

  it('S3：一口钟配两格可换 ⇒ WARN（多出来的那格永远等不到读者；钟数与格数要一起改）', () => {
    const out = run([region('rg_slow', ['clear', 'fog', 'storm'], [bell('bl_a', 'flag.bell_second_repaired')])], { pending: {} })
    expect(out.filter((f) => f.level === 'error')).toEqual([])
    expect(out.filter((f) => f.level === 'warn').map((f) => f.where)).toEqual(['rg_slow'])
  })

  it('S4：钟立的旗不在任务线名册里 ⇒ WARN；一口不立任何旗的钟 ⇒ 另一条 WARN（它没有拨天气的出口）', () => {
    // 只有驻留那一格 ⇒ S1 不参与，这一臂里唯一会响的就是 S4 那两条
    const out = run([region('rg_toll', ['clear'], [bell('bl_untracked', 'flag.not_in_quest'), bell('bl_silent')])], { pending: {} })
    expect(out.filter((f) => f.level === 'error')).toEqual([])
    expect(out.filter((f) => f.level === 'warn').map((f) => f.where).sort()).toEqual([
      'rg_toll.interactables(bl_silent)', 'rg_toll.interactables(bl_untracked)',
    ])
  })

  it('S5：名册读空 ⇒ 报"门在空转"而不是"每区都没条件"；regions 读空同理', () => {
    for (const empty of [null, []]) {
      const out = errsOf(REAL_REGIONS, { questFlags: empty, pending: PENDING_WEATHER_SWITCHES })
      expect(out.length, `questFlags = ${JSON.stringify(empty)} 时应当只有一条空转 ERROR`).toBe(1)
      expect(out[0].msg).toContain('空转')
    }
    expect(errsOf([], { pending: {} })[0]?.msg).toContain('空转')
    // 反证：空名册如果退成"合法"，下面这句就会红——它确保上面那两条不是碰巧。
    // 期望的不是"某一条数"而是"每一个有第二格却没有钟的区各报一条"：数会随数据漂，判据那句话不会。
    // weatherSwitch 落地之后，"第二格没主人"的区已经为零（休垒与营地各自声明了一格）。
    // 所以这里的对照集改成"把声明摘掉之后才缺主人的区"——在合成表上做，不动真表。
    const unmet = (REAL_REGIONS as RegionData[]).map((rg) => ({ ...rg, weatherSwitch: undefined }))
      .filter((rg) => (rg.weatherPresets?.length ?? 0) > 1 && repairBellFlags(rg as RegionData, tracked).length === 0)
    expect(unmet.length, '摘掉 weatherSwitch 之后没有任何一区缺主人 ⇒ 这句反证的对照集是空的，它什么也没反证')
      .toBeGreaterThan(0)
    expect(errsOf(unmet as unknown, { questFlags: QUEST_FLAGS, pending: null }).map((f) => f.where).sort(),
      '真名册下响的必须是"有第二格而区内没钟"的那几区（摘掉账本 ⇒ 每一笔欠账都得自己站出来）')
      .toEqual(unmet.map((rg) => `${rg.id}.weatherPresets`).sort())
  })
})

describe('源码门：这条腿不许退化成组合根里一张手抄的对照表', () => {
  const main = readFileSync(`${ROOT}src/main.ts`, 'utf8')
  const switchSrc = readFileSync(`${ROOT}src/world/WeatherSwitch.ts`, 'utf8')
  /** 注释里的名字不算代码：把 `* `／`//` 那些行整行剔掉再找字面量 */
  const codeOnly = (t: string): string => t.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l)).join('\n')

  it('main.ts 里既没有区 id 也没有旗标名：天气那一腿的全部输入都从表里推', () => {
    expect(main, '组合根里出现了 `weatherPresets`：那是把推导搬回手写表的第一步').not.toMatch(/weatherPresets/)
    expect(main).toMatch(/questTrackedFlags\(/)
    expect(main).toMatch(/activeWeather\(/)
  })

  it('`world/WeatherSwitch.ts` 自己也不认识任何一区、一口钟、一面旗（推导住在数据里，不住在源码里）', () => {
    const body = codeOnly(switchSrc)
    expect(body.match(/\b(?:rg|bl|flag)_[a-z0-9_]+/g) ?? [], '逻辑层里出现了写死的区 id / 钟 id / 旗标名')
      .toEqual([])
    expect(switchSrc, 'WeatherSwitch 碰了 three 或画面层：那一层只该接一个天气名').not.toMatch(/from '(three|@\/vfx|@\/ui)/)
  })

  it('`ColorGrade` 那边已经不再认识区域：`setRegion` 这个方法整个不存在（认识区域就等于抄了第二份判据）', () => {
    const grade = readFileSync(`${ROOT}src/vfx/ColorGrade.ts`, 'utf8')
    expect(grade).not.toMatch(/setRegion/)
    expect(grade, '仲裁者 import 了 RegionData：画面层又认识区域了').not.toMatch(/RegionData/)
    expect(grade).toMatch(/activeWeather/) // 它至少在注释里指名了推导的主人
  })
})
