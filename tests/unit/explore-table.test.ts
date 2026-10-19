import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BEATS_PER_NOTE, EXPLORE_ATONAL_FIELDS, EXPLORE_FIELDS, EXPLORE_FORMS, EXPLORE_TONAL_FIELDS,
  EXPLORE_WAVES, MIN_ROOT_CENTS, exploreFindings,
} from '../../scripts/explore-rules.mjs'

/**
 * 探索曲表的两端实测（KI-079 的第四腿：判据本体搬到 `scripts/explore-rules.mjs` 之后才量得动）。
 *
 * 为什么判据不留在 `validate-data.mjs` 里、也不在这里另写一份：那份脚本一被 import 就去校验真表并
 * `process.exit`，所以"喂一行非法数据、看它拒不拒"在测试里做不了。判据搬进模块之后，**门禁与这份测试跑的是同一段代码**。
 *
 * 刻意没量的那一半：`rootHz`/`peak` 的可闻带。那两格走 `report.num`，缺失/非有限/越界三种说法全场共用，
 * 不属于这张表（最后那条源码门把它钉在原地，不让它悄悄搬回来、或悄悄搬走）。
 */

type Finding = { level: 'error' | 'warn'; file: string; where: string; msg: string }
type Row = Record<string, unknown>

/** 一行合法有调曲 + 一行合法无调曲：所有 refuse 臂都是在它们身上各改一处得到的 */
const TONAL_OK: Row = { id: 'mus_a_explore', form: 'prime', rootHz: 110, beatsPerNote: 1, wave: 'sine', peak: 0.02 }
const ATONAL_OK: Row = { id: 'mus_b_explore', form: null }
/** 一个区域一张曲：`music.battle` 一律不给（KI-080 之后那一格由 `battle-rules` 判，混进来只会多读一条） */
const reg = (explore: string, id = `rg_${explore}`): Row => ({ id, music: { explore } })
/** 各臂只改一处的那只手：其余格仍然合法，所以红的那一条必然属于被改的这格 */
const bad = (patch: Row): Row => ({ ...TONAL_OK, ...patch })
/** 改 id 也要有一只手：两行同 id 会先撞上"id 重复"，那条读数就不是在量这格了 */
const withId = (id: string, patch: Row = {}): Row => ({ ...TONAL_OK, ...patch, id })

const run = (rows: unknown, regions: unknown[] = [reg('mus_a_explore'), reg('mus_b_explore')]): Finding[] =>
  exploreFindings(rows, regions)
const errs = (rows: unknown, regions: unknown[] = [reg('mus_a_explore'), reg('mus_b_explore')]): Finding[] =>
  run(rows, regions).filter((f) => f.level === 'error')

/** 真表走文件而不是 `@/data`：那份索引已经把 JSON 当模块解析，判据要读的是**磁盘上**的同一份字节 */
const json = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as T
const REAL_ROWS = (): Row[] => json<Row[]>('../../src/data/json/explore.json')
const REAL_REGIONS = (): unknown[] => json<unknown[]>('../../src/data/json/regions.json')

describe('探索曲判据的 accept 侧：合法形状一条都不报', () => {
  it('有调那一支补齐六格、无调那一支只有两格 ⇒ 零条（两支各自的必填由这条站住）', () => {
    expect(errs([TONAL_OK, ATONAL_OK])).toEqual([])
  })

  it('三种音高变形 × 三档每音拍数全收（表里真用着的组合一个都不该被误判）', () => {
    // 每行自己的主音隔开 100 音分：九行同音会被"一区一主音"那条先吃掉，读数就归不到这格了
    const rows = [...EXPLORE_FORMS].flatMap((form, i) => [...BEATS_PER_NOTE].map((bn, j) => {
      const k = i * 3 + j
      return withId(`mus_row_${k}_explore`, { form, beatsPerNote: bn, rootHz: Number((110 * 2 ** (k * 100 / 1200)).toFixed(4)) })
    }))
    expect(rows.length, '组合数不是 9 = 这两张名单少了一档，上面那条的读数就没支点').toBe(9)
    expect(errs(rows, rows.map((r) => reg(String(r.id))))).toEqual([])
  })

  it('真表 + 真 regions 在这份判据上零条 ERROR，而"一区一张"的比例不是碰巧读到了空集', () => {
    const rows = REAL_ROWS()
    const regions = REAL_REGIONS() as Row[]
    const withExplore = regions.filter((r) => typeof (r.music as Row | undefined)?.explore === 'string')
    expect(rows.length, '真表读不到行').toBeGreaterThan(0)
    expect(withExplore.length, '指了探索曲的区域数 ≠ 表里的行数：那条"一区一张"的门今天读的是哪一头？')
      .toBe(rows.length)
    expect(errs(rows, regions)).toEqual([])
  })

  it('KI-080 之后这张判据不再发任何 WARN：那句"战斗曲指向一张不存在的表"连同话术一起消失了', () => {
    // 双向挡板。KI-079 写下的承诺是「谁建了 battle.json 并接上读者，这一条连同话术一起消失」，
    // 所以今天它必须读作零条；而任何人把那段登记抄回来（或新加一句"暂时登记"的 WARN）都会在这里红。
    expect(run([TONAL_OK]).filter((f) => f.level === 'warn'), '合成一侧冒出了一句 WARN：登记的口径变了？').toEqual([])
    const withBattle = run([TONAL_OK], [{ id: 'rg_a', music: { explore: 'mus_a_explore', battle: 'mus_x' } }])
      .filter((f) => f.level === 'warn')
    expect(withBattle, '`music.battle` 的悬空登记又回来了：那张表今天存在，判据住在 `battle-rules.mjs` 而不是这里')
      .toEqual([])
    expect(run([], REAL_REGIONS()).filter((f) => f.level === 'warn'), '真 regions 上仍有一句战斗曲登记 = 那句话没人销')
      .toEqual([])
    // 而这里"沉默"是有前提的：那一格今天归另一张嘴管。这条臂里 explore 自己是合法的，所以零条 ERROR 才对。
    expect(errs([TONAL_OK], [{ id: 'rg_a', music: { explore: 'mus_a_explore', battle: 'mus_x' } }]),
      '探索曲这一侧对不存在的 `battle` 该完全不管（管它是 battle-table 那条用例的事）').toEqual([])
  })
})

describe('探索曲判据的 refuse 侧：逐条臂各红一条，说得出为什么', () => {
  /** 每张词表的"表外那个词"都不许在表里（否则那一臂悄悄变成合法数据，红的是我对表的理解而不是门） */
  const GUARDS: Array<[string, boolean]> = [
    ['augmentation', EXPLORE_FORMS.has('augmentation')],
    ['custom', EXPLORE_WAVES.has('custom')],
    ['3', BEATS_PER_NOTE.has(3)],
  ]
  it('三条臂挑的表外词真的在表外（词表哪天长了这个词，那条臂就得换一个词，而不是悄悄空转）', () => {
    for (const [word, inList] of GUARDS) expect(inList, `'${word}' 现在是合法值了：那条臂的"表外"不成立`).toBe(false)
  })

  const ARMS: Array<{ name: string; row: Row; at: string }> = [
    { name: '音高变形写了扩张（§1.2 里扩张是**节奏**档，不是 form 的一个词）', row: bad({ form: 'augmentation' }), at: '.form' },
    { name: '波形写了 custom（drone 与旋律都不发这种波）', row: bad({ wave: 'custom' }), at: '.wave' },
    { name: '每音拍数写了 3（既不是原样也不是扩张/压缩）', row: bad({ beatsPerNote: 3 }), at: '.beatsPerNote' },
    { name: 'form 漏写（判别联合的两支都不认 undefined）', row: bad({ form: undefined }), at: '.form' },
    { name: 'wave 漏写', row: bad({ wave: undefined }), at: '.wave' },
    { name: '多出一格表外字段（加字段要连消费方一起加）', row: bad({ transposition: 5 }), at: '.transposition' },
  ]
  for (const [i, arm] of ARMS.entries()) {
    it(`臂 ${i + 1}：'${arm.name}' ⇒ 报恰好一条，挂在 ${arm.at} 那一格`, () => {
      const e = errs([arm.row], [reg('mus_a_explore')])
      expect(e.length, '红的不止一条：这格之外还有别的东西在响，读数归不了因').toBe(1)
      expect(e[0].where, '红在了别处').toBe(`mus_a_explore${arm.at}`)
      expect(e[0].file).toBe('explore.json')
    })
  }

  it('对照臂：同一行什么都不改 ⇒ 零条（上面六条的红才真的来自被改的那一格）', () => {
    expect(errs([TONAL_OK], [reg('mus_a_explore')])).toEqual([])
  })

  it('无调那一支多写一格音高参数 = 给一条不存在的旋律配数（四格各试一次，每试一次红一条）', () => {
    const extra = ['rootHz', 'beatsPerNote', 'wave', 'peak']
    expect(extra.length, '这四格与"有调那支比无调多出来的字段"不是同一批：判据与测试对不上账')
      .toBe(EXPLORE_TONAL_FIELDS.filter((k) => !EXPLORE_ATONAL_FIELDS.includes(k)).length)
    for (const k of extra) {
      const e = errs([{ ...ATONAL_OK, [k]: k === 'rootHz' ? 110 : 1 }], [reg('mus_b_explore')])
      expect(e.length, `${k} 混进了无调那一支却没红`).toBe(1)
      expect(e[0].where, `红在了别处而不是 ${k} 那一格`).toBe(`mus_b_explore.${k}`)
    }
  })

  it('id 重复 / id 缺失 / 行不是对象 / 顶层不是数组：四种结构性脏数据各说一条', () => {
    const dup = errs([TONAL_OK, { ...TONAL_OK }], [reg('mus_a_explore')])
    expect(dup.filter((e) => e.msg.includes('id 重复')).length, '同一张曲写了两遍必须恰好说一次').toBe(1)
    const blank = errs([{ ...TONAL_OK, id: '' }], [reg('mus_a_explore')])
    expect(blank.some((e) => e.msg.includes('id 缺失或非字符串')), '空字符串 id 没算缺失').toBe(true)
    const notObj = errs([1], [])
    expect(notObj.some((e) => e.msg === '必须是对象'), '一行数字被读成了"没有行"').toBe(true)
    expect(errs(null, []).map((e) => e.msg), '顶层不是数组时那一句话说岔了').toEqual(['顶层必须是数组'])
  })

  it('双向对账两个方向都红：区域指一张不存在的曲、表里留一行没人指的曲', () => {
    // 这一臂天生两条一起响：区域改指了别处，`mus_a_explore` 那一行就成了没人指的曲。
    // 分开的说法要各在一条上，否则"两条"可以来自同一条判据响两遍。
    const both = errs([TONAL_OK], [{ id: 'rg_x', music: { explore: 'mus_typo_not_in_table' } }])
    expect(both.length, `实测 ${both.length} 条：${both.map((e) => e.msg).join(' / ')}`).toBe(2)
    expect(both.filter((e) => e.msg.includes('指它当探索曲')).length, '悬空引用那一条没说').toBe(1)
    expect(both.filter((e) => e.msg.includes('没有任何区域指它')).length, '孤儿行那一条没说').toBe(1)
    const orphan = errs([TONAL_OK], [])
    expect(orphan.length, '没人指的曲那一行没红 = §55 死数据这一半没门').toBe(1)
    expect(orphan[0].where).toBe('mus_a_explore')
  })

  it('两张区共用一张曲要红（一区一张是 §1.2 的承诺），而且红在 regions 名下', () => {
    const shared = errs([TONAL_OK], [reg('mus_a_explore', 'rg_one'), reg('mus_a_explore', 'rg_two')])
    expect(shared.length).toBe(1)
    expect(shared[0].file, '这条讲的是 regions 指错了东西，挂在 explore.json 名下就找不到它').toBe('regions.json')
    expect(shared[0].msg).toContain('共用同一张探索曲')
  })

  /**
   * 「一区一主音」的两侧都敲：差在阈值内必须红、差在阈值外必须不红。
   * 音分差由 `MIN_ROOT_CENTS` 本身推出来（不是手挑两个数），否则阈值一动这里就悄悄失真。
   */
  it('两个主音的音分差：阈值内红一条、阈值外零条（50 音分那一格是从判据读的，不是这里挑的）', () => {
    const at = (cents: number): Row => bad({ id: 'mus_c_explore', rootHz: Number((110 * 2 ** (cents / 1200)).toFixed(4)) })
    expect(MIN_ROOT_CENTS, '阈值本身要看得见，否则下面两条的说法没有支点').toBe(50)
    const both = [reg('mus_a_explore'), reg('mus_c_explore')]
    expect(errs([TONAL_OK, at(MIN_ROOT_CENTS - 10)], both).length, '差 40 音分没红：听不出换了区的那两条被放过了')
      .toBe(1)
    expect(errs([TONAL_OK, at(MIN_ROOT_CENTS + 10)], both), '差 60 音分也红了 = 这条门把可辨的差别也判死')
      .toEqual([])
  })

  it('主音互撞只在两边都写得出数时判：一侧缺数时不冒音分那条（NaN 比较永远为假 = 门会静默失灵）', () => {
    const e = errs([TONAL_OK, bad({ id: 'mus_c_explore', rootHz: undefined })], [reg('mus_a_explore'), reg('mus_c_explore')])
    expect(e.some((x) => x.msg.includes('一区一主音')), 'rootHz 缺失时居然冒出了音分对比').toBe(false)
    expect(e, 'rootHz 的可闻带由 report.num 管，判据这一份不该顺手报它').toEqual([])
  })
})

describe('判据只有一个主人：名单由两支现拼，校验器只是那张嘴', () => {
  /** 源码切片而不是再抄一份：`EXPLORE_FIELDS` 的"派生"只能由它自己的声明行说话（比相等证明不了拼法） */
  it('`EXPLORE_FIELDS` 的右边引用两支字段表、不含任何字段名字面量', () => {
    const src = readFileSync(new URL('../../scripts/explore-rules.mjs', import.meta.url), 'utf8')
    const decl = /export const EXPLORE_FIELDS = (.*)/.exec(src)
    expect(decl, '那一行换了形状：这条判据要跟着换').not.toBeNull()
    const rhs = decl?.[1] ?? ''
    expect(rhs).toContain('EXPLORE_TONAL_FIELDS')
    expect(rhs).toContain('EXPLORE_ATONAL_FIELDS')
    expect(/'id'/.test(rhs), `右边出现了字段名字面量（${rhs}）= 第三份手抄名单又长回来了`).toBe(false)
    expect(EXPLORE_FIELDS.length, '拼出来的白名单比两支的并集大/小 = 去重那一步没生效')
      .toBe(new Set([...EXPLORE_TONAL_FIELDS, ...EXPLORE_ATONAL_FIELDS]).size)
  })

  it('校验器里既没有第二份词表判据，也没有把数值可闻带搬过来', () => {
    const code = readFileSync(new URL('../../scripts/validate-data.mjs', import.meta.url), 'utf8')
      .split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(code, 'validateExplore 不再走这份判据 = 有一条平行实现悄悄长了出来').toContain('exploreFindings(')
    for (const gone of ['EXPLORE_FORMS.has', 'EXPLORE_WAVES.has', 'BEATS_PER_NOTE.has', 'MIN_ROOT_CENTS']) {
      expect(code, `判据 '${gone}' 又被人抄回校验器里了（判据的主人只有一个）`).not.toContain(gone)
    }
    expect(code, 'rootHz 的可闻带不再走 report.num = 那三种说法出现了第二个主人').toContain('.rootHz`, row.rootHz')
  })

  it('词表对账仍然管着这四张名单（搬走判据不等于搬走门）', () => {
    const code = readFileSync(new URL('../../scripts/validate-data.mjs', import.meta.url), 'utf8')
    for (const where of ['EXPLORE_FORMS', 'EXPLORE_TONAL_FIELDS', 'EXPLORE_ATONAL_FIELDS', 'EXPLORE_WAVES']) {
      expect(code, `VOCAB_PAIRS 里少了 '${where}' 这一对：schema 加了成员而名单没人看`).toContain(`where: '${where}'`)
    }
  })
})
