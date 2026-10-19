import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  FOG_DENSITY_MAX, GAMEPLAY_MUL_RANGE, GRADE_MUL_RANGE, PENDING_WEATHER_READINGS, WEATHER_BASELINE_ID,
  WEATHER_FIELDS, WEATHER_GAMEPLAY_FIELDS, WEATHER_GAMEPLAY_RULINGS, WEATHER_READING_FIELDS, weatherFindings,
} from '../../scripts/weather-rules.mjs'
import { interfaceFields, schemaBlocks, unionMembers } from '../../scripts/schema-vocab.mjs'

/**
 * 天气表（KI-094①，需求 §38 / art-direction §8）的两端实测。
 *
 * 形状照 `lockon-table.test.ts` / `ducking-table.test.ts`：判据住在 `scripts/weather-rules.mjs`，
 * 门禁与这份测试读**同一段代码**（`validate-data.mjs` 一被 import 就去校验真表并 `process.exit`）。
 *
 * **这一批为什么值得存在**：入表之前，`regions.json > weatherPresets` 那 8 个名字与需求 §38 的四档
 * 从来没有对过账，而雾密度写死在场景构造参数里。于是"给一区换一个拼错的名字"、"把 0.030 写成 0.3"
 * 这两种改法当天都不会有任何人说话——前者那片区域静默走基线，后者把整区糊成一堵墙。
 * 这份文件量的就是：**这两件事发生的当天必须有人喊**，而且喊得出是哪一个名字。
 */

type Finding = { level: 'error' | 'warn'; file: string; where: string; msg: string }
type Row = Record<string, unknown>

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8')

/** 底 = **真表**（从磁盘读，不手抄：抄一份进来就把"表是主人"换成了注释，而每臂的边界还在按老数算） */
const REAL: Row[] = JSON.parse(read('../../src/data/json/weather.json')) as Row[]
/** 被指到的名字：主人是 regions.json 每区的 `weatherPresets`，与门禁用同一句现推 */
const REFERENCED = [...new Set((JSON.parse(read('../../src/data/json/regions.json')) as { weatherPresets?: string[] }[])
  .flatMap((rg) => rg.weatherPresets ?? []))]
/** §38 那几档：主人是 `schema.ts > WeatherDocId` */
const DOC_IDS = unionMembers(schemaBlocks(read('../../src/data/schema.ts')), 'WeatherDocId') as string[]

const run = (
  rows: unknown,
  opts: Partial<{ docIds: string[] | null; referenced: string[] | null; pending: Record<string, string> | null; rulings: Record<string, string> | null }> = {},
): Finding[] => weatherFindings('weather.json', rows,
  opts.docIds === undefined ? DOC_IDS : opts.docIds,
  opts.referenced === undefined ? REFERENCED : opts.referenced,
  opts.pending === undefined ? PENDING_WEATHER_READINGS : opts.pending,
  opts.rulings === undefined ? WEATHER_GAMEPLAY_RULINGS : opts.rulings)
const errs = (rows: unknown, opts?: Parameters<typeof run>[1]): Finding[] => run(rows, opts).filter((f) => f.level === 'error')
/** 在真表某一行的基础上**各改一处**：红的那一条必然归得到这一格，而不是归到"某处有个错误" */
const patch = (id: string, p: Row): Row[] => REAL.map((r) => (r.id === id ? { ...r, ...p } : r))

/**
 * 关系型判据那几臂用的**合成底**。它只保一件事："这一臂改的只有这一格"——真表上任何一行都同时被
 * pending 账与 §38 名册牵着，把它的 id 改一下就顺手多出第二条 ERROR，那一臂就不再归因了。
 * 读数那几臂（上一节与下面第一组）的底**必须**是真表：抄来的读数不能既当底又当证据。
 */
const SYNTH: Row[] = [
  { id: 'clear', docWeather: 'clear', fogDensity: 0.008 },
  { id: 'fog', docWeather: 'fog', fogDensity: 0.03, contrastMul: 0.6 },
]
const synthErrs = (rows: unknown, referenced: string[] = ['clear', 'fog'], rulings: Record<string, string> = {}): Finding[] =>
  weatherFindings('weather.json', rows, DOC_IDS, referenced, {}, rulings).filter((f) => f.level === 'error')

describe('accept 侧：真表零条 ERROR，而它同时是下面每一臂的底', () => {
  it('真表在真名册与真 pending 账下不响（不响是量出来的，不是没跑）', () => {
    expect(REAL.length, '底是空表 = 下面每一臂都在空集合上自证').toBeGreaterThan(0)
    expect(DOC_IDS, '抽取器在真 schema.ts 上读不到 WeatherDocId（门在空转，不是"没有漂移"）').not.toBeNull()
    expect(REFERENCED.length).toBeGreaterThan(0)
    expect(errs(REAL)).toEqual([])
    // 合成底也得是合法的：一条红的底量不出"只红一条"（每一臂的 `toBe(1)` 都靠这句话才有含义）
    expect(synthErrs(SYNTH)).toEqual([])
  })

  it('字段名单与主人现对账：`WEATHER_FIELDS` 就是从 `schema.ts > WeatherRow` 的声明里读回来的', () => {
    const declared = interfaceFields(schemaBlocks(read('../../src/data/schema.ts')), 'WeatherRow')
    expect(declared, '抽取器读不到 WeatherRow').not.toBeNull()
    expect([...(declared as string[])].sort()).toEqual([...WEATHER_FIELDS].sort())
  })

  it('pending 账的两侧都是活的：每个条目今天真的被某区指着，而每个没行的名字真的挂了账', () => {
    const missing = REFERENCED.filter((n) => !REAL.some((r) => r.id === n))
    expect(missing.sort(), '被指到而没行的名字集合换了：pending 账要跟着换，否则这条只是复述判据')
      .toEqual(Object.keys(PENDING_WEATHER_READINGS).sort())
    for (const [name, why] of Object.entries(PENDING_WEATHER_READINGS)) {
      expect(REFERENCED, `'${name}' 挂在 pending 上而没有任何一区指它`).toContain(name)
      expect(why.length, `'${name}' 的理由短到无法在两年后被判断（判据的界是 20 字）`).toBeGreaterThanOrEqual(20)
    }
  })

  it('WARN 那一侧说的是"需求还剩一档 / 这一区走基线"而不是"数据写错"', () => {
    const played = new Set(REAL.map((r) => r.docWeather as string))
    const unplayed = DOC_IDS.filter((d) => !played.has(d))
    const warns = run(REAL).filter((f) => f.level === 'warn')
    expect(warns.filter((w) => w.where.startsWith('§38')).map((w) => w.where).sort(),
      '没人奏的那一档与真表对不上：这条 WARN 的名册由 §38 现推，不是这份测试手点')
      .toEqual(unplayed.map((d) => `§38 ${d}`).sort())
    const baseline = warns.filter((w) => !w.where.startsWith('§38'))
    expect(baseline.map((w) => w.where).sort(), '走基线的那几个名字应当正是 pending 账上那几个')
      .toEqual(Object.keys(PENDING_WEATHER_READINGS).sort())
    for (const w of baseline) expect(w.msg, `'${w.where}' 的 WARN 没说它今天奏什么`).toContain('基线')
  })
})

describe('读数与文档对账：表里写的每一个数都得能从 art-direction 那句读回来', () => {
  /**
   * 文档那一行是**唯一起点**。这两个对象由解析得到而不是抄数：抄进来就等于把"文档是主人"换成
   * "这份测试是主人"，之后美术改 §8 那一行而测试仍然绿（KI-074 那条纪律的同一家族）。
   * 解析读空 ⇒ 下面第一条用例红，所以"看不见"不会变成"没有差异"。
   */
  const lines = read('../../docs/art-direction.md').split(/\r?\n/)
  const fogLine = lines.find((l) => l.includes('指数雾，密度')) ?? ''
  const gradeLine = lines.find((l) => l.includes('不改色板只改')) ?? ''
  const DOC_FOG: Record<string, number> = {}
  for (const m of fogLine.matchAll(/([A-Z][a-z]+)\s+0\.(\d+)/g)) DOC_FOG[m[1].toLowerCase()] = Number(`0.${m[2]}`)
  const DOC_GRADE: Record<string, 'brightnessMul' | 'contrastMul'> = {}
  const DOC_GRADE_MUL: Record<string, number> = {}
  for (const m of gradeLine.matchAll(/(Rain|Fog|Storm)( 对比)?\s*×([0-9.]+)/g)) {
    DOC_GRADE[m[1].toLowerCase()] = m[2] ? 'contrastMul' : 'brightnessMul'
    DOC_GRADE_MUL[m[1].toLowerCase()] = Number(m[3])
  }

  it('先把文档自己量一遍：四档雾密度齐、三条乘数齐（解析读空 ⇒ 这条红，而不是"没有差异"）', () => {
    expect(Object.keys(DOC_FOG).sort()).toEqual(['clear', 'fog', 'rain', 'storm'])
    expect(Object.keys(DOC_GRADE).sort()).toEqual(['fog', 'rain', 'storm'])
    expect(gradeLine).toContain('明度乘数')
  })

  it('表里每一行的三格读数，都能在文档那一行找到出处，而且值逐字相等', () => {
    for (const row of REAL) {
      const doc = row.docWeather as string
      if (row.fogDensity !== undefined) {
        expect(row.fogDensity, `${doc} 的雾密度与 art-direction §8 那句不符`).toBe(DOC_FOG[doc])
      }
      for (const f of ['brightnessMul', 'contrastMul'] as const) {
        if (row[f] === undefined) continue
        expect(DOC_GRADE[doc], `文档没有给 '${doc}' 那一档的 ${f}，表里却写了（那是我编的）`)
          .toBe(f)
        expect(row[f], `${doc} 的 ${f} 与文档那句的乘数不符`).toBe(DOC_GRADE_MUL[doc])
      }
      // 文档给了读数而表里没写 ⇒ 那一格被悄悄丢掉了：区域看起来"没有天气"，而没有人报
      const f = DOC_GRADE[doc]
      if (f && row.fogDensity !== undefined) {
        expect(row[f], `文档给 '${doc}' 写了 ${f}，表里这一行却没带它`).not.toBeUndefined()
      }
    }
  })

  it('基线行的那个 id 与判据用的是同一个字面量（两个平面各写一遍就会有一天不一致）', () => {
    const src = read('../../scripts/weather-rules.mjs')
    const master = src.match(/export const WEATHER_BASELINE_ID = '([^']+)'/)?.[1]
    expect(master, '抽取判据读不到 WEATHER_BASELINE_ID（这条对账在空转）').toBeTypeOf('string')
    expect(WEATHER_BASELINE_ID).toBe(master)
    expect(REAL.map((r) => r.id)).toContain(master)
  })
})

describe('逐字段那一族：非法值当天必须红，而且只红属于它的那一条', () => {
  it('多写一格未知字段 ⇒ 报这一格的名字（拼错键不会静默失效，KI-085 那一族的病）', () => {
    const e = errs(patch('fog', { fogDensitye: 0.03 }))
    expect(e.length).toBe(1)
    expect(e[0].where).toContain('fogDensitye')
  })

  it('id 重复 ⇒ 两行给同一个天气名两套读数，仲裁者没有答案', () => {
    // 合成底：两行都叫 `clear` 而只有一区指它 ⇒ 全场唯一那条 ERROR 就是"重复"本身
    const e = synthErrs([{ id: 'clear', docWeather: 'clear', fogDensity: 0.008 }, { id: 'clear', docWeather: 'fog', fogDensity: 0.03 }], ['clear'])
    expect(e.length, `红的不止重复：${e.map((f) => f.msg).join(' / ')}`).toBe(1)
    expect(e[0].msg).toContain('重复')
  })

  it('docWeather 缺失 / 不在 §38 名册 ⇒ 各红一条，红话里带出名册', () => {
    const missing = errs(patch('fog', { docWeather: undefined }))
    expect(missing.filter((f) => f.where.endsWith('docWeather')).length).toBe(1)
    const bogus = errs(patch('fog', { docWeather: 'snow' }))
    expect(bogus.length).toBe(1)
    expect(bogus[0].msg).toContain('snow')
    expect(bogus[0].msg, '红话没把合法名册说出来 = 改的人要自己去猜').toContain(DOC_IDS[0])
  })

  it('三格读数全没写 ⇒ 这一行奏出来与"没有天气"逐像素相同（§55）', () => {
    // 挑的是 `fog` 而不是基线那一行：基线行空读数会**同时**踩到判据⑤，那一臂就不是"只改一处"了
    const e = synthErrs([{ id: 'fog', docWeather: 'fog' }, SYNTH[0]])
    expect(e.length, `红的不止空读数：${e.map((f) => f.msg).join(' / ')}`).toBe(1)
    expect(e[0].where).toBe('[0]')
    expect(e[0].msg).toContain('三格读数')
  })

  it('雾密度：0 / 负 / 越过上界 各红一条，界本身从判据读而不是抄', () => {
    expect(errs(patch('fog', { fogDensity: 0 })).length).toBe(1)
    expect(errs(patch('fog', { fogDensity: -0.03 })).length).toBe(1)
    const over = errs(patch('fog', { fogDensity: FOG_DENSITY_MAX * 2 }))
    expect(over.length).toBe(1)
    expect(over[0].msg).toContain(String(FOG_DENSITY_MAX))
    expect(errs(patch('fog', { fogDensity: FOG_DENSITY_MAX })), '界本身必须是合法值，否则门把文档逼到没有解').toEqual([])
  })

  it('乘数：1 是"没有后果的读数"、0/负是坏滤镜、越界是数量级手误，三条各说各的', () => {
    const one = errs(patch('fog', { contrastMul: 1 }))
    expect(one.length).toBe(1)
    expect(one[0].msg).toContain('= 1')
    expect(errs(patch('fog', { contrastMul: 0 })).length).toBe(1)
    expect(errs(patch('fog', { contrastMul: -1 })).length).toBe(1)
    const out = errs(patch('fog', { contrastMul: GRADE_MUL_RANGE.max * 2 }))
    expect(out.length).toBe(1)
    expect(out[0].msg).toContain('出界')
    // 越上界与写 1 是两种说法，不能混成一条：一条说"数量级错了"，一条说"这一格没有后果"
    // （所以这里比的是带全角冒号的那一段，而不是裸的 `= 1`——`contrastMul = 10` 里也含 `= 1`）
    expect(out[0].msg).not.toContain('= 1：')
  })
})

describe('两侧对账：表 ⇄ 被指到的名字 ⇄ pending 账，三个方向都量', () => {
  it('没有任何一区指着的行 ⇒ 报"这一行永远不会奏"（§55 的死数据）', () => {
    const e = synthErrs([...SYNTH, { id: 'snow', docWeather: 'fog', fogDensity: 0.04 }])
    expect(e.length).toBe(1)
    expect(e[0].where).toBe('[2].id')
    expect(e[0].msg, '红话没点名是哪个名字 = 改的人要去数下标').toContain('snow')
    expect(e[0].msg).toContain('weatherPresets')
  })

  it('被指到而既没行也没挂账的名字 ⇒ ERROR（玩家到那一区会静默走基线而没人知道）', () => {
    const e = errs(REAL, { referenced: [...REFERENCED, 'mystery-gale'] })
    expect(e.length).toBe(1)
    expect(e[0].msg).toContain('mystery-gale')
    expect(e[0].msg).toContain('PENDING_WEATHER_READINGS')
  })

  it('pending 账能销：名字一旦有了行 ⇒ 报"这条该销"；不再被指 ⇒ 条目作废', () => {
    // 真账本今天已经空了（KI-094① 最后那三个名字都落成了行），所以主语从表里现推而不是照着账本抄：
    // 挑一个"表里有行、又真的被某区指着"的名字挂上账 ⇒ 判据必须说该销。
    const landedName = REFERENCED.find((n) => REAL.some((r) => r.id === n))
    expect(landedName, '一个"有行又被指着"的名字都推不出来 ⇒ weather.json 或 regions.json 读空了，这一臂就在空集合上自证')
      .toBeDefined()
    const landed = errs(REAL, { pending: { [landedName as string]: '这一行早就有读数了，账还挂着就是两种交代同时挂' } })
      .filter((f) => f.where.startsWith('PENDING_WEATHER_READINGS.'))
    expect(landed.length, `pending 销账判据没说话：${landed.map((f) => f.msg).join(' / ')}`).toBe(1)
    expect(landed[0].where).toBe(`PENDING_WEATHER_READINGS.${landedName}`)
    expect(landed[0].msg).toContain('该销')
    const dead = errs(REAL, { pending: { ...PENDING_WEATHER_READINGS, 'nobody-uses-this': '这个名字今天没有任何一区指着它，条目留着就是两种交代同时挂' } })
    expect(dead.filter((f) => f.where === 'PENDING_WEATHER_READINGS.nobody-uses-this').length).toBe(1)
    expect(dead.filter((f) => f.where === 'PENDING_WEATHER_READINGS.nobody-uses-this')[0].msg).toContain('作废')
  })

  it('pending 的理由短于 20 字 ⇒ 红（"待办"两个字两年后没人能判断它成不成立）', () => {
    // 底必须是合成表 + 自己写的引用名册：真账本空了，而"名字有行"或"没人指它"这两种挂法都会顺带招来
    // 另一条 ERROR（该销 / 作废），那一臂就不再只归因于理由这一句。这里让 hush 被指着而表里没行
    // ⇒ 判据 ④ 只出 WARN，唯一的 ERROR 就是"理由太短"。
    const ledger = (why: string): Record<string, string> => ({ hush: why })
    const names = ['clear', 'fog', 'hush']
    const e = weatherFindings('weather.json', SYNTH, DOC_IDS, names, ledger('还没做')).filter((f) => f.level === 'error')
    expect(e.length, `只该红理由那一条，实际：${e.map((f) => f.where).join(' / ')}`).toBe(1)
    expect(e[0].where).toBe('PENDING_WEATHER_READINGS.hush')
    // 反向对照：同一本账只把理由写够 ⇒ ERROR 归零，那一格转成"走基线"的 WARN。
    // （合成底只有 clear/fog 两行，所以判据 ② 会为 §38 里没人奏的那几档各出一条 WARN——那是底的话，
    // 不是这一臂的话，所以这里只点名 hush 那一格，不钉 WARN 的总数。）
    const enough = weatherFindings('weather.json', SYNTH, DOC_IDS, names,
      ledger('这一档的读数要等美术在 §38 四档里给它派一档（合成臂用的理由）'))
    expect(enough.filter((f) => f.level === 'error')).toEqual([])
    const hushWarn = enough.filter((f) => f.level === 'warn' && f.where === 'hush')
    expect(hushWarn.length, '名字被指着、挂着账、表里没行 ⇒ 必须有且只有一条"它走基线"的 WARN').toBe(1)
    expect(hushWarn[0].msg).toContain('基线')
  })
})

describe('门在空转时不许变成绿：三端输入读不到 ⇒ 各自 ERROR，而不是"零条 finding"', () => {
  it('§38 名册读不到（docIds = null）⇒ 说"门在空转"', () => {
    const e = errs(REAL, { docIds: null })
    expect(e.length).toBe(1)
    expect(e[0].msg).toContain('空转')
  })

  it('被引用的名字读空 ⇒ 同样红：两侧都读空时"零条"什么都不证明', () => {
    for (const referenced of [null, []]) {
      const e = errs(REAL, { referenced })
      expect(e.length, `referenced=${JSON.stringify(referenced)} 时门静默了`).toBe(1)
      expect(e[0].msg).toContain('空转')
    }
  })

  it('顶层不是数组 ⇒ 一条形状 ERROR 之后立刻返回，不再逐行装作在判', () => {
    const e = errs({ id: 'clear' })
    expect(e.length).toBe(1)
    expect(e[0].msg).toContain('顶层必须是数组')
  })

  it('基线行被删 / 被抽走雾密度 ⇒ 两条各红一次：那条退路不能是空的', () => {
    const gone = errs(REAL.filter((r) => r.id !== WEATHER_BASELINE_ID))
    expect(gone.some((f) => f.msg.includes('基线行')), `删掉基线行没被点名：${gone.map((f) => f.msg).join(' / ')}`)
      .toBe(true)
    const blind = errs(patch(WEATHER_BASELINE_ID, { fogDensity: undefined }))
    expect(blind.some((f) => f.msg.includes('基线行'))).toBe(true)
  })

  it('`WeatherRow` 里"可以缺的那几格" = 三格读数 + gameplay 一格（判据的口径与 schema 不能各说各话）', () => {
    const declared = interfaceFields(schemaBlocks(read('../../src/data/schema.ts')), 'WeatherRow') as string[]
    const optional = declared.filter((f) => !['id', 'docWeather'].includes(f))
    expect([...WEATHER_READING_FIELDS, 'gameplay'].sort()).toEqual([...optional].sort())
  })
})


/**
 * §5.9.33③ 玩法三腿（`WeatherRow.gameplay`）。**这一族与上面所有臂的根本差别**：读数那边文档给了数，
 * 判据对账"抄没抄对"；这边文档**一个数都没给**（art-direction §8 只给雾密度四档与三条画面乘数，
 * 需求 §38 只剩一句「Storm 期敌人浓度+」）⇒ 判据盯的不再是文档，而是**"每一颗乘数都挂着裁决理由"**。
 * 没有理由的乘数就是拿猜测冒充设计（§77 那条纪律），而理由是会过期的——行一改，账当天就该销。
 */
describe('§5.9.33③ gameplay 三腿：文档没给数，所以每颗乘数都得挂着裁决理由（G1–G4）', () => {
  it('真表：声明 gameplay 的行与裁决账上的条目一一对应，一个不多一个不少', () => {
    const withGp = REAL.filter((r) => (r as Row).gameplay !== undefined).map((r) => r.id as string)
    expect(withGp.sort()).toEqual(Object.keys(WEATHER_GAMEPLAY_RULINGS).sort())
    for (const [name, why] of Object.entries(WEATHER_GAMEPLAY_RULINGS)) {
      expect(why.length, `'${name}' 的裁决理由短于 20 字：判据 G1 当天就会红`).toBeGreaterThanOrEqual(20)
    }
  })

  it('G1：声明了 gameplay 而账上没有理由 ⇒ 红，而且红在这一行的 gameplay 上', () => {
    const found = errs(patch('dissonant-storm', { gameplay: { ambienceGain: 1.5 } }), { rulings: {} })
    expect(found).toHaveLength(1)
    expect(found[0].where).toBe('[2].gameplay')
    expect(found[0].msg).toContain('WEATHER_GAMEPLAY_RULINGS')
  })

  it('G1：理由短于 20 字 ⇒ 红在账本名下（一句"待办"两年后没人能判断它成不成立）', () => {
    const found = errs(patch('dissonant-storm', { gameplay: { ambienceGain: 1.5 } }), { rulings: { 'dissonant-storm': '风暴就该更响一点' } })
    expect(found).toHaveLength(1)
    expect(found[0].where).toBe('WEATHER_GAMEPLAY_RULINGS.dissonant-storm')
  })

  it('G1 关不死：账本读不到（null）时不放行，照样拦——没有账不等于没有乘数', () => {
    const found = errs(REAL, { rulings: null })
    expect(found.some((f) => f.where === '[2].gameplay'), 'rulings = null 时 G1 应当照样红，而不是退成"没账就没判"').toBe(true)
  })

  it('G2：账上挂着而行已经不声明 gameplay ⇒ 假账该销（两种交代同时挂着就是没人知道信哪个）', () => {
    const found = errs(patch('dissonant-storm', { gameplay: undefined }))
    expect(found.some((f) => f.where === 'WEATHER_GAMEPLAY_RULINGS.dissonant-storm' && f.msg.includes('该销'))).toBe(true)
  })

  it('G3：1 = 没有后果的读数、0/负 = 静默关掉、越界 = 数量级手误、非数字 = 形状错，四条各说各的', () => {
    const one = errs(patch('dissonant-storm', { gameplay: { concentrationMul: 1 } }))
    expect(one).toHaveLength(1)
    expect(one[0].where).toBe('[2].gameplay.concentrationMul')
    expect(one[0].msg).toContain('没有后果')

    const zero = errs(patch('dissonant-storm', { gameplay: { corruptionMul: 0 } }))
    expect(zero).toHaveLength(1)
    expect(zero[0].msg).toContain('静默关掉')

    const over = errs(patch('dissonant-storm', { gameplay: { ambienceGain: 15 } }))
    expect(over).toHaveLength(1)
    expect(over[0].msg).toContain('出界')

    const text = errs(patch('dissonant-storm', { gameplay: { ambienceGain: '1.5' } }))
    expect(text).toHaveLength(1)
    expect(text[0].msg).toContain('有限数字')
  })

  it('G3：gameplay 不是对象 / 里面多一格未知字段 ⇒ 各红一条，且红话点名那一格', () => {
    const shape = errs(patch('dissonant-storm', { gameplay: 1.5 }))
    expect(shape).toHaveLength(1)
    expect(shape[0].where).toBe('[2].gameplay')

    const extra = errs(patch('dissonant-storm', { gameplay: { ambienceGain: 1.5, spawnMul: 2 } }))
    expect(extra).toHaveLength(1)
    expect(extra[0].where).toBe('[2].gameplay.spawnMul')
  })

  it('G4：基线行声明 gameplay ⇒ 红（五个欠读数的名字会静默继承一套谁也没裁决过的乘数）', () => {
    const rows = patch(WEATHER_BASELINE_ID, { gameplay: { ambienceGain: 1.5 } })
    const rulings = { ...WEATHER_GAMEPLAY_RULINGS, [WEATHER_BASELINE_ID]: '基线非中性只是为了量 G4 这一臂，跑完当场还原' }
    const found = errs(rows, { rulings })
    expect(found.some((f) => f.where === `WeatherRow.${WEATHER_BASELINE_ID}.gameplay` && f.msg.includes('基线行'))).toBe(true)
  })

  it('三腿名单与 `WeatherGameplay` 的声明逐字相等（加腿要连消费方一起加，§55）', () => {
    const declared = interfaceFields(schemaBlocks(read('../../src/data/schema.ts')), 'WeatherGameplay')
    expect(declared, '抽取器读不到 WeatherGameplay').not.toBeNull()
    expect([...(declared as string[])].sort()).toEqual([...WEATHER_GAMEPLAY_FIELDS].sort())
  })

  it('合成底也过：只写 gameplay 不写读数的行今天合法（读数判据为它让了一条活路）', () => {
    const rows: Row[] = [
      { id: 'clear', docWeather: 'clear', fogDensity: 0.008 },
      { id: 'gust', docWeather: 'rain', gameplay: { ambienceGain: 0.5 } },
    ]
    expect(synthErrs(rows, ['clear', 'gust'], { gust: '合成底：只为量"只写玩法腿"这一臂而存在的一行' })).toEqual([])
  })

  it('乘数区间从判据现读而不是抄：G3 的界与 `GAMEPLAY_MUL_RANGE` 是同一个数', () => {
    expect(GAMEPLAY_MUL_RANGE.min).toBeGreaterThan(0)
    expect(GAMEPLAY_MUL_RANGE.max).toBeGreaterThan(GAMEPLAY_MUL_RANGE.min)
    const under = errs(patch('dissonant-storm', { gameplay: { corruptionMul: GAMEPLAY_MUL_RANGE.min / 2 } }))
    expect(under).toHaveLength(1)
    expect(under[0].msg).toContain(`${GAMEPLAY_MUL_RANGE.min}`)
  })
})
