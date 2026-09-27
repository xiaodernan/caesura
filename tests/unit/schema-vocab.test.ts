import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  fieldUnion, interfaceFields, schemaBlocks, stripComments, unionMembers, vocabDriftErrors,
} from '../../scripts/schema-vocab.mjs'
import type { VocabPair } from '../../scripts/schema-vocab.mjs'

/**
 * 词表对账门（KI-074）：`validate-data.mjs` 顶上那十几张 `const X = new Set([...])` 每一张都写着
 * 「与 schema.ts 对齐」——手抄。抄的东西不会失败，只会静悄悄变旧。这道门把它换成"读一次声明，逐张比"。
 *
 * 判据全走**合成 schema 文本**，包括两枚本批踩过的坑：
 * ① 声明自己内部的文档注释不许把字段表切断（第一版按"遇到 `/**` 就截块"写，`MilestoneGrant` 排在
 *    注释后面的两个字段当场消失，门一开就报五条假红）；
 * ② 注释里的举例字面量不许被读成词表成员（所以第一版的截断"想法"是对的、做法是错的：整片剥注释才是）。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))
const SCHEMA = readFileSync(root + 'src/data/schema.ts', 'utf8')
const VALIDATOR = readFileSync(root + 'scripts/validate-data.mjs', 'utf8')

const SYNTH = `
export type Kind = 'a' | 'b' | 'c'

export interface WithComment {
  first?: number
  /**
   * 这一段的注释里写着 'notAMember' 和 another 的话，它们都不算成员；
   * 而下面这个字段必须被读到（第一版在这里断块，就再也读不到了）：
   */
  second?: number
  third: string
}

export interface Prop {
  id: string
  kind: 'spine' | 'core'
  pos: number
}

export type Later = 'z'
`
const B = schemaBlocks(SYNTH)

describe('schema.ts 的声明怎么读：字面量联合、接口字段、接口里的内联联合', () => {
  it('`unionMembers` 读到顶层别名的成员，且不把注释与下一条声明的成员混进来', () => {
    expect(unionMembers(B, 'Kind')).toEqual(['a', 'b', 'c'])
    expect(unionMembers(B, 'Later')).toEqual(['z'])
    expect(unionMembers(B, 'Nope'), '读不到就是 null（调用方要把它报成"门在空转"）').toBeNull()
  })

  it('`interfaceFields`：夹在字段之间的注释既不截断名单，也不贡献字段', () => {
    expect(interfaceFields(B, 'WithComment')).toEqual(['first', 'second', 'third'])
    const flat = stripComments(SYNTH)
    expect(flat, '注释整片剥掉（剥一半是最坏的做法）').not.toContain('notAMember')
    expect(unionMembers(schemaBlocks(stripComments(SYNTH) + '\nexport type Fake = \'x\' // 注释里有 \'y\'\n'), 'Fake')).toEqual(['x'])
  })

  it('`fieldUnion` 读接口里那一行的内联联合', () => {
    expect(fieldUnion(B, 'Prop', 'kind')).toEqual(['spine', 'core'])
    expect(fieldUnion(B, 'Prop', 'nope')).toBeNull()
    expect(fieldUnion(B, 'Nope', 'kind')).toBeNull()
  })
})

describe('对账：两侧谁多谁少都逃不掉，豁免要带理由也要能销', () => {
  const pair = (over: Partial<VocabPair>): VocabPair => ({
    at: 'Kind', name: '种类', source: (b) => unionMembers(b, 'Kind'),
    copied: ['a', 'b', 'c'], ...over,
  })
  const errs = (pairs: VocabPair[]) => vocabDriftErrors({ blocks: B, pairs })

  it('相等 ⇒ 一声不响；少抄 ⇒ 说"改表的人会被不存在的问题挡住"；多抄 ⇒ 说"类型不认识"', () => {
    expect(errs([pair({})])).toEqual([])
    const less = errs([pair({ copied: ['a', 'b'] })])
    expect(less.map((e) => e.key)).toEqual(['vocab:Kind'])
    expect(less[0].msg).toContain('schema.ts 里有 c')
    const more = errs([pair({ copied: ['a', 'b', 'c', 'ghost'] })])
    expect(more[0].msg).toContain('校验器的名单里有 ghost')
    expect(more[0].msg).toContain('KI-047')
  })

  it('读不到声明 ⇒ 报"门在空转"，不是静默跳过', () => {
    const e = errs([{ at: 'Nope', name: '不存在', source: (b) => unionMembers(b, 'Nope'), copied: ['a'] }])
    expect(e.map((x) => x.key)).toEqual(['schema:Nope'])
    expect(e[0].msg).toContain('空转')
  })

  it('子集关系要带理由，而且理由过期当天就该响', () => {
    const okCase = errs([pair({ copied: ['a', 'b'], allowMissing: ['c'], whyMissing: '今天没人声明 c' })])
    expect(okCase, '登记了理由的子集 ⇒ 绿').toEqual([])
    expect(errs([pair({ copied: ['a', 'b'], allowMissing: ['c'] })])[0].msg, '少抄却不写理由 ⇒ 红').toContain('有据')
    const stale = errs([pair({ copied: ['a', 'b', 'c'], allowMissing: ['c'], whyMissing: '今天没人声明 c' })])
    expect(stale[0].msg, 'c 其实抄上了 ⇒ 那条豁免该销').toContain('豁免该销')
    const both = errs([pair({ copied: ['a'], allowMissing: ['c'], whyMissing: 'x' })])
    expect(both.map((x) => x.key).length, '缺 b 又缺理由之外的账，两件事各报一次').toBeGreaterThanOrEqual(1)
    expect(both.some((x) => x.msg.includes('b'))).toBe(true)
  })
})

describe('今天的真表：对账门必须在真 schema 上零条，且它自己打印得出来', () => {
  const blocks = schemaBlocks(SCHEMA)
  it('十张名单逐张与 schema.ts 相等（或按登记的子集关系成立）', () => {
    const pairs: VocabPair[] = [
      { at: 'AttrKey', source: (b) => unionMembers(b, 'AttrKey'), copied: ['str', 'dex', 'ton', 'vig', 'ovr', 'fis'] },
      { at: 'SlotKey', source: (b) => unionMembers(b, 'SlotKey'), copied: ['weapon', 'helm', 'cuirass', 'gloves', 'greaves', 'seal', 'sealA', 'sealB'] },
      { at: 'ItemKind', source: (b) => unionMembers(b, 'ItemKind'), copied: ['currency', 'material', 'consumable', 'weapon', 'armor', 'seal', 'lore', 'key'] },
      { at: 'MilestoneGrant', source: (b) => interfaceFields(b, 'MilestoneGrant'), copied: ['loadFlat', 'parryWhiffMs', 'execMulPct', 'overdriveFlat', 'corruptionStayPct'] },
      { at: 'MovementFrame', source: (b) => interfaceFields(b, 'MovementFrame'), copied: ['startup', 'activeStart', 'activeEnd', 'recovery', 'poise', 'hitStopMs', 'hitbox', 'multi', 'shake', 'sfx', 'vfx', 'loudness'] },
      { at: 'MovementLevel', source: (b) => interfaceFields(b, 'MovementLevel'), copied: ['cooldownTicks', 'damage', 'trueDamage', 'fissureLayers', 'muteTicks', 'distance', 'freezeTicks', 'echoCharges', 'silenceTicks', 'silenceDmgBonus'] },
      { at: 'PropRef.kind', source: (b) => fieldUnion(b, 'PropRef', 'kind'), copied: ['soundspine', 'resonance_core'] },
      { at: 'InteractableRef.kind', source: (b) => fieldUnion(b, 'InteractableRef', 'kind'), copied: ['checkpoint', 'elevator', 'bridge', 'soundwall', 'gather', 'chest', 'npc', 'teleport', 'gate', 'bell', 'inspect', 'shop'] },
      { at: 'ProjectileSpec.kind', source: (b) => fieldUnion(b, 'ProjectileSpec', 'kind'), copied: ['spear', 'note', 'shard'] },
    ]
    expect(vocabDriftErrors({ blocks, pairs })).toEqual([])
  })

  /**
   * 打印段的反向判据（源码门，KI-058 那套剥注释写法）。
   * 这条不是装饰：对账门第一次上线时四条植入实测全部"不咬"，根因是报告循环只走 11 份 JSON，
   * 挂在 `schema.ts` 段名下的 ERROR 既不打印也不计数。修的是循环，可修完之后谁都能把它改回去。
   */
  it('报告循环要走"FILES ∪ 报过事的其他段名"，跨文件的检查不许报进虚空', () => {
    const code = VALIDATOR.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    expect(code, 'sections 必须并入 report.rows 里出现过的段名').toContain('new Set(report.rows.map((x) => x.file))')
    expect(code, 'errTotal 要按 sections 累加，不是按 FILES').toMatch(/for \(const f of sections\)/)
  })
})
