/**
 * KI-436（结案 KI-434）：受击反应那张表的两半（名册 ⇄ 区间）第一次有**格级**双向对账的机器读者。
 *
 * **为什么这一族测试值得存在**（不是搬个文件就顺手补几条）：KI-433 的变异臂 A6 从区间表里删掉
 * `R4.crumpleDmgMul` 那一格 ⇒ `npm run validate:data` **0 条 finding、退出码 0、照样绿**。
 * 那一格同时住在名册、真表、`schema.ts` 的类型面和运行时里，唯独不在区间表里，于是它的数随便写都不判。
 * `REACTION_FIELDS` 管「认不认」，`REACTION_SPECS` 管「认得的值在不在范围内」，缺的是**两半之间**的那句话。
 * 本文件量的就是这句话有没有牙齿——而且牙齿必须长在**默认路径**上（生产调用不传参），
 * 否则「测试里喂得出坏表而生产根本不读芯」是另一种空转。
 *
 * 判据住在 `scripts/reaction-rules.mjs`，门禁与这份测试读**同一段代码**；`validate-data.mjs` 一被 import
 * 就去校验真表并 `process.exit`，所以「喂两张对不上的表看它拒不拒」那一半只有搬出来才量得动。
 * 行为那一半（破势窗口内那一记真的乘这一格）在 `tests/flow/reaction.test.ts` 与 `moveset-frames3.test.ts`。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  REACTION_FIELDS, REACTION_SPECS, REACTION_TIER_ORDER,
  reactionFindings, reactionLedgerErrors,
} from '../../scripts/reaction-rules.mjs'

type Finding = { level: 'error' | 'warn'; file: string; where: string; msg: string }
type LedgerError = { key: string; msg: string }

const FILE = 'reactions.json'
const TABLE = JSON.parse(
  readFileSync(new URL('../../src/data/json/reactions.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, number>>

const cellsOf = (t: Record<string, string[]>) =>
  Object.entries(t).flatMap(([id, ks]) => ks.map((k) => `${id}.${k}`))
const boundCells = (t: Record<string, Record<string, unknown>>) =>
  Object.entries(t).flatMap(([id, o]) => Object.keys(o).map((k) => `${id}.${k}`))

describe('两张表自己：先把「今天到底漏没漏」钉成读数', () => {
  it('载体不空转：名册与区间都是 5 档 10 格（读到空表会让下面每一条腿白过）', () => {
    expect(Object.keys(REACTION_FIELDS).sort()).toEqual(['R0', 'R1', 'R2', 'R3', 'R4'])
    expect(Object.keys(REACTION_SPECS).sort()).toEqual(['R0', 'R1', 'R2', 'R3', 'R4'])
    expect(cellsOf(REACTION_FIELDS).length, '名册的格数').toBe(10)
    expect(boundCells(REACTION_SPECS).length, '区间的格数').toBe(10)
    expect(REACTION_TIER_ORDER, '分级序点名的是这三档').toEqual(['R1', 'R2', 'R3'])
  })

  it('默认路径：真名册 ⇄ 真区间 0 条漏判，而真表过整条判据 0 finding', () => {
    // 这一条就是「生产调用不传参」那一路：臂 A6 那一刀在 HEAD 上翻不出红，是因为没有这一句
    expect(reactionLedgerErrors(), `两张表对不上：${reactionLedgerErrors().map((e) => e.key).join(' ')}`).toEqual([])
    expect(reactionFindings(FILE, TABLE).filter((f) => f.level === 'error'), '真表应当一条 error 都没有').toEqual([])
  })

  it('这条腿今天不需要豁免的理由（量出来的）：名册那 10 格在真表里全是有限数字', () => {
    // 「每一格都得有界」敢写死，靠的是这一句实话。哪天真加一个字符串格（tag/displayName 那种），
    // 先红的就是这一条，那时要做的决定是"给它配豁免"而不是"把对账松掉"。
    const notNumeric = cellsOf(REACTION_FIELDS).filter((key) => {
      const [id, k] = key.split('.')
      return !Number.isFinite(TABLE[id]?.[k])
    })
    expect(notNumeric, `这些格不是数值，而判据硬要它们有界：${notNumeric.join(' ')}`).toEqual([])
  })

  it('反向不需要豁免的第二半：区间那 10 格在名册里都点得到名', () => {
    const extra = boundCells(REACTION_SPECS).filter((key) => {
      const [id, k] = key.split('.')
      return !(REACTION_FIELDS[id] ?? []).includes(k)
    })
    expect(extra, `区间里有而名册没有的格：${extra.join(' ')}`).toEqual([])
  })
})

describe('格级双向对账：两个方向各有一格，缺一格就少判一片', () => {
  it('名册有而区间无 ⇒ 恰一条，且点名的就是那一格（臂 A6 那一刀的形状）', () => {
    const fields = { ...REACTION_FIELDS, R4: ['crumpleMs', 'bossCrumpleMs', 'crumpleDmgMul'] }
    const specs = { ...REACTION_SPECS, R4: { crumpleMs: { min: 1 }, bossCrumpleMs: { min: 1 } } }
    const errs: LedgerError[] = reactionLedgerErrors({ fields, specs })
    expect(errs.map((e) => e.key)).toEqual(['R4.crumpleDmgMul'])
    expect(errs[0]!.msg).toContain('没人问它的数')
  })

  it('区间有而名册无 ⇒ 恰一条：界在替一格不许写的数据说话', () => {
    const fields = { ...REACTION_FIELDS, R4: ['crumpleMs', 'bossCrumpleMs'] }
    const specs = { ...REACTION_SPECS, R4: { crumpleMs: { min: 1 }, bossCrumpleMs: { min: 1 }, crumpleDmgMul: { min: 1 } } }
    const errs = reactionLedgerErrors({ fields, specs })
    expect(errs.map((e) => e.key)).toEqual(['REACTION_SPECS.R4.crumpleDmgMul'])
  })

  it('档级也算：名册多一档而区间表整档没有 ⇒ 那一档的每一格都报（不许"整档缺席"只报一次）', () => {
    const errs = reactionLedgerErrors({
      fields: { ...REACTION_FIELDS, R5: ['floatMs'] },
      specs: REACTION_SPECS,
    })
    expect(errs.map((e) => e.key)).toEqual(['R5.取值表'])
    expect(errs[0]!.msg).toContain('1 格')
  })

  it('反过来：区间多一档而名册没有 ⇒ 那条派生该销了', () => {
    const errs = reactionLedgerErrors({
      fields: REACTION_FIELDS,
      specs: { ...REACTION_SPECS, R5: { floatMs: { min: 1 } } },
    })
    expect(errs.map((e) => e.key)).toEqual(['REACTION_SPECS.R5'])
  })

  it('两张表读空了要说"在空转"，不许退成"都空所以什么都合法"', () => {
    expect(reactionLedgerErrors({ fields: null, specs: null }).map((e) => e.msg).join('')).toContain('空转')
    expect(reactionLedgerErrors({ fields: {}, specs: {} }).map((e) => e.key)).toEqual(['REACTION_FIELDS'])
    expect(reactionLedgerErrors({ fields: REACTION_FIELDS, specs: null }).map((e) => e.key)).toEqual(['REACTION_SPECS'])
  })

  it('名册某一档写成非数组 ⇒ 那一档等于没判，点名而不是跳过', () => {
    const errs = reactionLedgerErrors({ fields: { ...REACTION_FIELDS, R1: 'stunMs' }, specs: REACTION_SPECS })
    expect(errs.map((e) => e.key)).toEqual(['R1.字段名册'])
  })
})

describe('判据仍然管得住那张表本身（搬家没把旧腿弄丢）', () => {
  const clone = () => JSON.parse(JSON.stringify(TABLE)) as Record<string, Record<string, number>>

  it('浮空档 R5 ⇒ 没有承载体那条照旧响', () => {
    const t = { ...clone(), R5: { floatMs: 100 } }
    const found = reactionFindings(FILE, t).filter((f) => f.level === 'error')
    expect(found.map((f) => f.where)).toEqual(['R5'])
    expect(found[0]!.msg).toContain('没有承载体')
  })

  it('名册外的字段 ⇒ 位置报到 R2.dizzyMs', () => {
    const t = clone()
    t.R2.dizzyMs = 500
    const found = reactionFindings(FILE, t).filter((f: Finding) => f.where === 'R2.dizzyMs')
    expect(found.length).toBe(1)
    expect(found[0]!.msg).toContain('stunMs/displaceM')
  })

  it('缺档 ⇒ R3 整行删掉就报「运行时抛错」那一句', () => {
    const t = clone()
    delete t.R3
    const found = reactionFindings(FILE, t).filter((f) => f.where === 'R3')
    expect(found.length).toBe(1)
    expect(found[0]!.msg).toContain('缺少')
  })

  it('分级序被推翻 ⇒ 硬直那一列先红，位移那一列也红（越重越疼是两句而不是一句）', () => {
    const t = clone()
    t.R1.stunMs = 900 // 比 R2 的 350 还长
    t.R1.displaceM = 5 // 比 R2 的 0.5 还远
    const found = reactionFindings(FILE, t).filter((f) => f.where === 'R1/R2/R3')
    expect(found.length).toBe(2)
    expect(found.map((f) => f.msg).join('')).toContain('硬直时长必须递增')
    expect(found.map((f) => f.msg).join('')).toContain('位移必须递增')
  })

  it('Boss 比小兵破势更短 ⇒ 同一格时长轴的第二个方向也红', () => {
    const t = clone()
    t.R4.bossCrumpleMs = 100
    expect(reactionFindings(FILE, t).filter((f) => f.where === 'R4').length).toBe(1)
  })

  it('顶层不是对象 ⇒ 先说两半的关系，再说形状（结构性漏判不许被数据错误盖住）', () => {
    const found = reactionFindings(FILE, null)
    expect(found.some((f) => f.msg.includes('顶层必须是对象'))).toBe(true)
    // 而两半对账这一段仍然跑过了：默认参数下它是空集，所以这里只证"没被 return 掉"的形状
    expect(found.length, '只有形状那一条 ⇒ 关系判据被数据错误吞掉了').toBeGreaterThan(0)
  })
})

describe('判据只有一个主人，而这条链每一格都有读者', () => {
  const code = (rel: string): string =>
    readFileSync(new URL(rel, import.meta.url), 'utf8')
      .split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

  it('校验器走这份判据，而那四条说法没被抄回校验器里', () => {
    const v = code('../../scripts/validate-data.mjs')
    expect(v, 'validate 不再走这份判据 = 有一条平行实现悄悄长了出来').toContain('reactionFindings(')
    expect(v, '名册/区间又被人抄回校验器里了（判据的主人只有一个）').not.toContain('const REACTION_FIELDS')
    expect(v).not.toContain('const REACTION_SPECS')
    for (const gone of ['硬直时长必须递增', '位移必须递增', 'Boss 不该比小兵破势更短', '在这份 build 里没有承载体']) {
      expect(v, `判据 '${gone}' 又出现在校验器里 = 那句话有了第二个主人`).not.toContain(gone)
    }
  })

  it('那张嘴仍然问数值界，而且拿不到界时不许崩（KI-087 那一族的 TypeError 把整份报告吞掉）', () => {
    const v = code('../../scripts/validate-data.mjs')
    expect(v, 'report.sub 摘掉 ⇒ min/max 那一路的说法从此没人说').toContain('report.sub(file, id, row, REACTION_SPECS[id] ?? {})')
    expect(v, '兜底被删 ⇒ 区间表整档缺席时校验器直接崩，一条 finding 都不印').toContain('?? {}')
  })

  it('搬家的落点只有一处读者：REACTION_FIELDS/SPECS 在 validate-data.mjs 里只剩 import 与那张嘴', () => {
    const v = code('../../scripts/validate-data.mjs')
    const lines = v.split('\n').filter((l) => /REACTION_(FIELDS|SPECS)/.test(l))
    // import 一行 + 浮空档跳过一行 + report.sub 一行。多出来的每一行都是判据长回校验器的证据。
    expect(lines.length, `校验器里还有 ${lines.length} 行读这两张表：\n${lines.join('\n')}`).toBeLessThanOrEqual(4)
    expect(lines.filter((l) => /from '\.\/reaction-rules\.mjs'/.test(l)).length).toBe(1)
  })
})
