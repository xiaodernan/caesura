import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AMB_BED_FIELDS, AMB_BELL_FIELDS, AMB_LAYER_FIELDS, AMB_SOURCE_FIELDS, AMB_SOURCE_LAYERS,
  AMB_SOURCE_LAYER_NAMES, AMB_WAVES, MIN_ROOT_CENTS, ambienceFindings,
} from '../../scripts/ambience-rules.mjs'

/**
 * 环境声床表的两端实测（KI-083：§4 的 L2／L3 接上读者，顺带把整张表的判据搬进
 * `scripts/ambience-rules.mjs` —— 搬之前它内联在 `validate-data.mjs` 里，而那个脚本一被 import
 * 就去校验真表并 `process.exit`，所以"喂一张非法床、看它拒不拒"这一半**从来没有量过**。
 * 这一份是那一半的第一次读数：drone／铃点／声源三支的 refuse 臂都在下面。
 *
 * 刻意没量的那一半：`hz`/`peak`/`detune`/`attackSec`/`durSec`/`everySec` 的可闻带。那些走
 * `report.num`/`report.sub`，缺失/非有限/越界三种说法全场共用，不属于这张表（最后一道源码门把它钉在原地）。
 */

type Finding = { level: 'error' | 'warn'; file: string; where: string; msg: string }
type Row = Record<string, unknown>

/** 一条合法颗粒、一条合法动源：所有 refuse 臂都是在它们身上各改一处得到的 */
const SRC_TEX: Row = { layer: 'texture', hz: 1500, pos: { x: 1, y: 0, z: 2 }, peak: 0.02, attackSec: 0.002, durSec: 0.07, everySec: [0.5, 2.2] }
const SRC_MOT: Row = { layer: 'motion', hz: 560, pos: { x: 0, y: 4, z: 0 }, peak: 0.02, attackSec: 1.1, durSec: 3.6, everySec: [10, 24] }
/** 一张合法床：一条 drone 层 + 低通 + 呼吸 + 两条声源 + 铃点（= §4 那张表的一整行） */
const BED_OK: Row = {
  id: 'mus_a_amb',
  layers: [{ hz: 87.31, wave: 'sawtooth', peak: 0.035, detune: -5 }],
  lpHz: 300,
  breath: { hz: 0.07, depth: 0.008 },
  sources: [SRC_TEX, SRC_MOT],
  bell: { scale: [700, 800], everySec: [5, 9], peak: [0.02, 0.05], hammerP: 0.4 },
}
/** `rg_a` 是一个 ±10 的方盒子：声源 `pos` 的框就是它 */
const BOUNDS = { minX: -10, maxX: 10, minY: -10, maxY: 10, minZ: -10, maxZ: 10 }
/** 一区的行。`music.battle`/`music.explore` 一律不给：那两格归 `battle-rules`/`explore-rules` 判 */
const reg = (ambience: string, id = 'rg_a'): Row => ({ id, bounds: BOUNDS, music: { ambience } })
const bed = (patch: Row): Row => ({ ...BED_OK, ...patch })

const run = (beds: unknown, regions: unknown[] = [reg('mus_a_amb')]): Finding[] => ambienceFindings(beds, regions)
const errs = (beds: unknown, regions: unknown[] = [reg('mus_a_amb')]): Finding[] => run(beds, regions).filter((f) => f.level === 'error')
const warns = (beds: unknown, regions: unknown[] = [reg('mus_a_amb')]): Finding[] => run(beds, regions).filter((f) => f.level === 'warn')

/** 真表走文件而不是 `@/data`：那份索引已经把 JSON 当模块解析，判据要读的是**磁盘上**的同一份字节 */
const json = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as T
const REAL_BEDS = (): Row[] => json<Row[]>('../../src/data/json/ambience.json')
const REAL_REGIONS = (): Row[] => json<Row[]>('../../src/data/json/regions.json')

describe('环境声床判据的 accept 侧：合法形状一条 ERROR 都不报', () => {
  it('一张完整的床（drone + 两条声源 + 铃点）⇒ 零条 ERROR，而 §4 的 L4 那句登记仍在', () => {
    expect(errs([BED_OK])).toEqual([])
    // KI-077 登记的那句 WARN 是**刻意**留下的（5–9s 对文档的 30–120s：挪它是听感裁决）：
    // 这一侧钉住"它还在、且只有一条"，不让它被顺手删掉或被复制成两条。
    expect(warns([BED_OK]).length).toBe(1)
    expect(warns([BED_OK])[0].where).toBe('bell.everySec')
  })

  it('两条声源的先后顺序不影响判据（层序是文档的事，不是数据的位置）', () => {
    expect(errs([bed({ sources: [SRC_MOT, SRC_TEX] })])).toEqual([])
  })

  it('`layers: []` 那一支（未竟厅 §4「无 drone」）合法：lpHz/breath 一起缺席才叫"没有 drone"', () => {
    const hall = { id: 'mus_hall_amb', layers: [], sources: [SRC_TEX, SRC_MOT], bell: null }
    expect(errs([hall], [reg('mus_hall_amb')])).toEqual([])
  })

  it('真表 + 真 regions 零条 ERROR，而两条对账的规模不是"读到了空集"', () => {
    const beds = REAL_BEDS()
    const regions = REAL_REGIONS()
    const withBed = regions.filter((r) => typeof (r.music as Row | undefined)?.ambience === 'string')
    expect(beds.length, '真表读不到床').toBeGreaterThan(0)
    expect(withBed.length, '指了环境声床的区域数 ≠ 表里的床数：一区一床那条门今天读的是哪一头？').toBe(beds.length)
    expect(beds.every((b) => Array.isArray(b.sources) && (b.sources as Row[]).length > 0), '真表里有床没有声景').toBe(true)
    expect(errs(beds, regions)).toEqual([])
    // 声景层那两条：每一张床的每一条源都得落在**它自己那一区**的框里（真表上逐条实测，不是抽查）
    const srcCount = beds.reduce((a, b) => a + (b.sources as Row[]).length, 0)
    expect(srcCount, '真表的声源条数比 §4 那张表列出的格还少').toBeGreaterThanOrEqual(14)
  })

  it('KI-083 之后这句登记仍**只是**一条：声景层不新增任何 WARN', () => {
    expect(warns(REAL_BEDS(), REAL_REGIONS()).length, '真表上多出了一句 WARN：哪来的？').toBe(1)
  })
})

describe('环境声床判据的 refuse 侧：§4 的 L2／L3（声源那一支）', () => {
  /** 每条臂只改一处：其余格仍然合法，所以红的那一条必然属于被改的这格 */
  const ARMS: Array<{ name: string; row: Row; at: string }> = [
    { name: '层名写错（`textures`）', row: bed({ sources: [{ ...SRC_TEX, layer: 'textures' }, SRC_MOT] }), at: '.sources[0].layer' },
    { name: '层名漏写', row: bed({ sources: [{ ...SRC_TEX, layer: undefined }, SRC_MOT] }), at: '.sources[0].layer' },
    { name: '声源多出一格表外字段', row: bed({ sources: [{ ...SRC_TEX, radiusM: 9 }, SRC_MOT] }), at: '.sources[0].radiusM' },
    { name: '整格 `sources` 缺席', row: (() => { const b = { ...BED_OK }; delete b.sources; return b })(), at: '.sources' },
    { name: '`sources` 写成空数组', row: bed({ sources: [] }), at: '.sources' },
    { name: '声源不是对象', row: bed({ sources: [42, SRC_MOT] }), at: '.sources[0]' },
    { name: '只有 L2：少了物理动源那一层', row: bed({ sources: [SRC_TEX] }), at: '.sources' },
    { name: '只有 L3：少了颗粒声纹那一层', row: bed({ sources: [SRC_MOT] }), at: '.sources' },
    { name: '声源落在本区 bounds 之外', row: bed({ sources: [{ ...SRC_TEX, pos: { x: 20, y: 0, z: 0 } }, SRC_MOT] }), at: '.sources[0].pos' },
    { name: '`pos` 不是对象', row: bed({ sources: [{ ...SRC_TEX, pos: 'near' }, SRC_MOT] }), at: '.sources[0].pos' },
    { name: '间隔写成 [长, 短]', row: bed({ sources: [{ ...SRC_TEX, everySec: [9, 2] }, SRC_MOT] }), at: '.sources[0].everySec' },
    { name: '间隔两端不是数', row: bed({ sources: [{ ...SRC_TEX, everySec: [1, 'x'] }, SRC_MOT] }), at: '.sources[0].everySec' },
  ]
  for (const [i, arm] of ARMS.entries()) {
    it(`臂 ${i + 1}：'${arm.name}' ⇒ 报恰好一条，挂在 ${arm.at} 那一格`, () => {
      const e = errs([arm.row])
      expect(e.length, `红的不止一条（${e.map((x) => `${x.where}: ${x.msg}`).join(' / ')}）：这格之外还有别的东西在响`).toBe(1)
      expect(e[0].where, '红在了别处').toBe(`mus_a_amb${arm.at}`)
      expect(e[0].file).toBe('ambience.json')
    })
  }

  it('对照臂：同一张床什么都不改 ⇒ 零条 ERROR（上面十二条的红才真的来自被改的那一格）', () => {
    expect(errs([BED_OK])).toEqual([])
  })

  it('"少一层"那句话点名是哪一层（两张层名册的读法要从判据自己的映射里取）', () => {
    const missMotion = errs([bed({ sources: [SRC_TEX] })])[0].msg
    expect(missMotion, '少了 motion 却没说清是哪一层').toContain(AMB_SOURCE_LAYER_NAMES.motion)
    const missTexture = errs([bed({ sources: [SRC_MOT] })])[0].msg
    expect(missTexture).toContain(AMB_SOURCE_LAYER_NAMES.texture)
    expect(AMB_SOURCE_LAYERS, '层序（L2 在前）变了：§4 的层号与这句话对不上').toEqual(['texture', 'motion'])
  })

  /**
   * 框是从**床自己那一区**取的：同一张床、同两条源，换成一只更小的框就从"全合法"翻成"两条都越界"。
   * 这一臂同时钉住"逐条源各判一次"（不是只判第一条）。
   */
  it('框从床自己那一区取：同一张床换一只更小的框就从零条翻成两条，各自点名那一区', () => {
    const box = (r: number): Row => ({ minX: -r, maxX: r, minY: -r, maxY: r, minZ: -r, maxZ: r })
    // 两条源刻意都**远离**框边界（不是踩在 maxX 上）：边界上的等号属于另一种读法，不该混进这一臂
    const bedIn = bed({ sources: [{ ...SRC_TEX, pos: { x: 5, y: 0, z: 5 } }, { ...SRC_MOT, pos: { x: 0, y: 4, z: 0 } }] })
    expect(errs([bedIn], [{ id: 'rg_wide', bounds: box(10), music: { ambience: 'mus_a_amb' } }]),
      '±10 的框里这两条源本来合法').toEqual([])
    const tight = errs([bedIn], [{ id: 'rg_tight', bounds: box(3), music: { ambience: 'mus_a_amb' } }])
    expect(tight.length, '换成 ±3 的框之后两条源都越界，应该各红一条').toBe(2)
    for (const e of tight) {
      expect(e.where.endsWith('.pos'), 'red at: ' + e.where).toBe(true)
      expect(e.msg, '越界那句话要点名是哪一区的框').toContain('rg_tight')
    }
  })
})

describe('环境声床判据的 refuse 侧：drone／铃点那两支（KI-077 内联时从没量过的那些）', () => {
  const ARMS: Array<{ name: string; row: Row; at: string }> = [
    { name: '有 drone 层却没写呼吸（静止的 drone 是电流声）', row: (() => { const b = { ...BED_OK }; delete b.breath; return b })(), at: '.breath' },
    // 这两臂各自把**另一格**去掉：留着它就是"同一条错报两条"，而这一条验的是被改的那一格
    { name: '没有 drone 层却写了低通（给一张不存在的图配参数）', row: bed({ layers: [], breath: undefined }), at: '.lpHz' },
    { name: '没有 drone 层却写了呼吸', row: bed({ layers: [], lpHz: undefined }), at: '.breath' },
    { name: 'drone 波形写了 `custom`（OscillatorNode.type 里它不算波形）', row: bed({ layers: [{ hz: 87.31, wave: 'custom', peak: 0.035, detune: 0 }] }), at: '.layers[0].wave' },
    { name: 'drone 层多出一格表外字段', row: bed({ layers: [{ hz: 87.31, wave: 'sine', peak: 0.035, detune: 0, gain: 1 }] }), at: '.layers[0].gain' },
    { name: '整格 `bell` 缺席（读不出是"没有事件"还是"忘了写"）', row: (() => { const b = { ...BED_OK }; delete b.bell; return b })(), at: '.bell' },
    { name: '铃点名册是空的（有事件位却永远掷不出音）', row: bed({ bell: { scale: [], everySec: [5, 9], peak: [0.02, 0.05], hammerP: 0 } }), at: '.bell.scale' },
    { name: '铃点名册里同一个音出现两次', row: bed({ bell: { scale: [700, 700], everySec: [5, 9], peak: [0.02, 0.05], hammerP: 0 } }), at: '.bell.scale[1]' },
    { name: '铃点表多出一格表外字段', row: bed({ bell: { scale: [700], everySec: [5, 9], peak: [0.02, 0.05], hammerP: 0, decay: 1 } }), at: '.bell.decay' },
    { name: '声床多出一格表外字段', row: bed({ texture: [] }), at: '.texture' },
  ]
  for (const [i, arm] of ARMS.entries()) {
    it(`臂 ${i + 1}：'${arm.name}' ⇒ 报恰好一条，挂在 ${arm.at} 那一格`, () => {
      const e = errs([arm.row])
      expect(e.length, `红的不止一条（${e.map((x) => `${x.where}: ${x.msg}`).join(' / ')}）`).toBe(1)
      expect(e[0].where).toBe(`mus_a_amb${arm.at}`)
    })
  }
})

describe('环境声床判据的结构性脏数据与对账', () => {
  it('id 重复 / id 缺失 / 行不是对象 / 顶层不是数组：四种脏数据各说一条', () => {
    const dup = errs([BED_OK, { ...BED_OK, sources: [SRC_TEX, SRC_MOT] }])
    expect(dup.filter((e) => e.msg.includes('id 重复')).length, '同一张床写了两遍必须恰好说一次').toBe(1)
    expect(errs([bed({ id: '' })]).some((e) => e.msg.includes('id 缺失或非字符串')), '空字符串 id 没算缺失').toBe(true)
    expect(errs([1]).some((e) => e.msg === '必须是对象'), '一行数字被读成了"没有床"').toBe(true)
    expect(errs(null).map((e) => e.msg), '顶层不是数组时那一句话说岔了').toEqual(['顶层必须是数组'])
  })

  it('双向对账两个方向都红：区域指一张不存在的床、表里留一张没人指的床', () => {
    const both = errs([BED_OK], [{ id: 'rg_x', bounds: BOUNDS, music: { ambience: 'mus_typo_not_in_table' } }])
    expect(both.length, `实测 ${both.length} 条：${both.map((e) => e.msg).join(' / ')}`).toBe(2)
    expect(both.filter((e) => e.msg.includes('指它当环境声床')).length, '悬空引用那一条没说').toBe(1)
    expect(both.filter((e) => e.msg.includes('没有任何区域指它')).length, '孤儿床那一条没说').toBe(1)
  })

  it('两个区共用一张床要红（一区一张是 §1.2 的承诺），而且红在 regions 名下', () => {
    const shared = errs([BED_OK], [reg('mus_a_amb', 'rg_one'), reg('mus_a_amb', 'rg_two')])
    expect(shared.length).toBe(1)
    expect(shared[0].file, '这条讲的是 regions 指错了东西').toBe('regions.json')
    expect(shared[0].msg).toContain('共用同一张声床')
  })

  /**
   * 「一区一主音」的两侧都敲：阈值内必须红、阈值外必须不红，而那个阈值是从判据读的（不是这里挑两个数）。
   * 这一段是 KI-083 从校验器搬过来的——搬之前它同样一条 refuse 臂都没有。
   */
  it('两个 drone 主音的音分差：阈值内红一条、阈值外零条', () => {
    const other = Number((87.31 * 2 ** ((MIN_ROOT_CENTS - 10) / 1200)).toFixed(4))
    const { lpHz, breath, bell, ...rest } = BED_OK as Row & { lpHz: number; breath: Row; bell: Row }
    const bedB = (hz: number): Row => ({ ...rest, id: 'mus_b_amb', layers: [{ hz, wave: 'sine', peak: 0.05, detune: 0 }], lpHz, breath, bell, sources: [SRC_TEX, SRC_MOT] })
    const regions = [reg('mus_a_amb', 'rg_a'), reg('mus_b_amb', 'rg_b')]
    expect(MIN_ROOT_CENTS, '阈值本身要看得见，否则下面两条的说法没有支点').toBe(50)
    const near = errs([BED_OK, bedB(other)], regions)
    expect(near.length, `差 ${MIN_ROOT_CENTS - 10} 音分没红：两区听成同一个地方`).toBe(1)
    expect(near[0].msg).toContain('一区一主音')
    const far = Number((87.31 * 2 ** ((MIN_ROOT_CENTS + 10) / 1200)).toFixed(4))
    expect(errs([BED_OK, bedB(far)], regions), '差 60 音分也红了 = 把可辨的差别判死').toEqual([])
  })
})

describe('判据只有一个主人：名单在 rules 里、嘴巴在校验器里', () => {
  const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

  it('校验器只当那张嘴：走 `ambienceFindings(`，没有第二份判据，也没把可闻带搬走', () => {
    const code = read('../../scripts/validate-data.mjs').split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(code, 'validateAmbience 不再走这份判据 = 有一条平行实现悄悄长了出来').toContain('ambienceFindings(')
    for (const gone of ['AMB_WAVES.has(', 'AMB_SOURCE_LAYERS.includes(', 'MIN_ROOT_CENTS', 'const AMB_BED_FIELDS =']) {
      expect(code, `判据 '${gone}' 又被人抄回校验器里了（判据的主人只有一个）`).not.toContain(gone)
    }
    expect(code, '声源那三格的数值可闻带没留在校验器 = 那三种说法出现了第二个主人').toContain('.attackSec')
    expect(code).toContain('.durSec')
  })

  it('判据本体自己不发报告：它只返回 findings（`report.*` 是校验器那张嘴的事）', () => {
    // 注释行不算代码：模块头那段注释**该**提到 `report.num`（它解释"那一半为什么留在校验器里"），
    // 把注释一起扫进来的门会把解释本身判成违规。下面这四张嘴各有括号，注释里那两处没有。
    const code = read('../../scripts/ambience-rules.mjs')
    for (const call of ['report.error(', 'report.warn(', 'report.num(', 'report.sub(']) {
      expect(code, 'rules 模块里出现了 ' + call + ' = 它开始自己说话了，那就不止一张嘴').not.toContain(call)
    }
    expect(code).toContain('export function ambienceFindings(')
  })

  it('词表对账仍然管着这六张名单（判据搬走 ≠ 门搬走）', () => {
    const code = read('../../scripts/validate-data.mjs')
    for (const where of ['AMB_BED_FIELDS', 'AMB_LAYER_FIELDS', 'AMB_BELL_FIELDS', 'AMB_SOURCE_FIELDS', 'AMB_WAVES', 'AMB_SOURCE_LAYERS']) {
      expect(code, `VOCAB_PAIRS 里少了 '${where}' 这一对：schema 加了成员而名单没人看`).toContain(`where: '${where}'`)
    }
  })

  it('运行时白名单与 schema 的六张声明逐张同长（名单是 import 来的，不是抄来的）', () => {
    const schema = read('../../src/data/schema.ts')
    const fieldsOf = (iface: string): string[] => {
      const block = new RegExp(`${iface} \\{([\\s\\S]*?)\\n\\}`).exec(schema)?.[1] ?? ''
      return [...block.matchAll(/^ {2}([A-Za-z0-9_]+)\??:/gm)].map((m) => m[1])
    }
    expect(AMB_BED_FIELDS).toEqual(fieldsOf('AmbienceBed'))
    expect(AMB_BED_FIELDS, '`sources` 不在声床字段里 = §4 的 L2/L3 又回不到数据侧').toContain('sources')
    expect(AMB_LAYER_FIELDS).toEqual(fieldsOf('AmbienceLayer'))
    expect(AMB_BELL_FIELDS).toEqual(fieldsOf('AmbienceBell'))
    expect(AMB_SOURCE_FIELDS).toEqual(fieldsOf('AmbienceSource'))
    expect([...AMB_WAVES]).toEqual(['sine', 'square', 'sawtooth', 'triangle'])
  })
})
