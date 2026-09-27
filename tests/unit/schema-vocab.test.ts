import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  arrayLiterals, callArgLiterals, fieldUnion, interfaceFields, objectKeys,
  refFieldUnion, schemaBlocks, stripComments, unionMembers, vocabDriftErrors,
} from '../../scripts/schema-vocab.mjs'
import type { VocabCorpus, VocabPair } from '../../scripts/schema-vocab.mjs'

/**
 * 词表对账门（KI-074 立判据，KI-076 把**载体**泛化）。
 * `validate-data.mjs` 顶上那二十来张 `const X = new Set([...])` 每一张都写着「与某处对齐」——手抄。
 * 抄的东西不会失败，只会静悄悄变旧。这道门把它换成"读一次主人，逐张比"。
 *
 * 判据全走**合成文本**，包括这几批踩过的坑：
 * ① 声明自己内部的文档注释不许把字段表切断（第一版按"遇到 `/**` 就截块"写，`MilestoneGrant` 排在
 *    注释后面的两个字段当场消失，门一开就报五条假红）；
 * ② 注释里的举例字面量不许被读成词表成员（所以第一版的截断"想法"是对的、做法是错的：整片剥注释才是）；
 * ③（KI-076）接口块不许越过它自己那对花括号——`EquipMods` 后面那句 `export const EMPTY_MODS = { defense: 0, … }`
 *    的初值行会被读成字段，`defense/execMul/bellBonus` 各出现两次；
 * ④（KI-076）`objectKeys` 的花括号要从赋值号后面开始配，不能从声明里第一个开始——
 *    `SHAKE_TABLE: Record<string, { amp: … }>` 的类型标注自带花括号，读回来的"行键"是 `["amp"]`；
 * ⑤（KI-076）单行接口（`export interface HitboxCone { shape: 'cone'; … }`）也是宿主，只认缩进两格的
 *    那一版让 `Hitbox` 整条引用链读不到。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))
const read = (p: string) => readFileSync(root + p, 'utf8')

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

/** 单行接口：字段不在行首，两格缩进那条认不到（KI-076 之前 Hitbox 就是这么哑掉的） */
export interface Box { shape: 'cone'; radius: number }
export interface Sphere { shape: 'sphere'; radius: number }
export type Shapes = Box | Sphere

export interface Mods {
  defense: number
  weight: number
}
/** 接口块必须在它自己的 \`}\` 收尾：下面这张初值表的行不是字段 */
export const INIT: Mods = {
  defense: 999,
  ghost: 1
}

export const TABLE: Record<string, { amp: number; dur: number }> = {
  graze: { amp: 0.3, dur: 0.1 },
  hurt: { amp: 1.2, dur: 0.25 },
  /** 注释里的 ghostLine: 4 不算行键 */
  boss: { amp: 4.0, dur: 0.9 }
}

export const ROSTER = ['fissure', 'mute', 'echo'] as const

export function useThem(): void {
  eat('ps_one')
  eat(variable)
  eat('ps_two')
}

export type Later = 'z'
`
const B = schemaBlocks(SYNTH)
const CORPUS: VocabCorpus = { text: SYNTH, blocks: B }
const corpusFor = (from: string): VocabCorpus | null => (from === 'synth.ts' ? CORPUS : null)

describe('声明怎么读：字面量联合、接口字段、接口里的内联联合、引用链、对象表、数组名册、调用点', () => {
  it('`unionMembers` 读到顶层别名的成员，且不把注释与下一条声明的成员混进来', () => {
    expect(unionMembers(B, 'Kind')).toEqual(['a', 'b', 'c'])
    expect(unionMembers(B, 'Later')).toEqual(['z'])
    expect(unionMembers(B, 'Nope'), '读不到就是 null（调用方要把它报成"门在空转"）').toBeNull()
  })

  it('`interfaceFields`：夹在字段之间的注释既不截断名单，也不贡献字段', () => {
    expect(interfaceFields(B, 'WithComment')).toEqual(['first', 'second', 'third'])
    const flat = stripComments(SYNTH)
    expect(flat, '注释整片剥掉（剥一半是最坏的做法）').not.toContain('notAMember')
    expect(unionMembers(schemaBlocks(stripComments(SYNTH) + "\nexport type Fake = 'x' // 注释里有 'y'\n"), 'Fake')).toEqual(['x'])
  })

  it('`interfaceFields`：接口块在它自己的 \`}\` 收尾，后面那张初值表不是它的字段（KI-076）', () => {
    expect(interfaceFields(B, 'Mods'), 'defense/weight 各一条，INIT 的初值行一条不许混进来').toEqual(['defense', 'weight'])
    expect(interfaceFields(B, 'Mods'), '第一版切到"下一条 export type|interface"为止 ⇒ ghost 与重复的 defense 都进来了').not.toContain('ghost')
  })

  it('`fieldUnion` 读接口里那一行的内联联合：多行与单行两种排版都认', () => {
    expect(fieldUnion(B, 'Prop', 'kind')).toEqual(['spine', 'core'])
    expect(fieldUnion(B, 'Box', 'shape'), '单行接口：字段跟在 \`{\` 后面，不在行首').toEqual(['cone'])
    expect(fieldUnion(B, 'Sphere', 'shape')).toEqual(['sphere'])
    expect(fieldUnion(B, 'Prop', 'nope')).toBeNull()
    expect(fieldUnion(B, 'Nope', 'kind')).toBeNull()
  })

  it('`refFieldUnion` 从引用链现推成员集合，不再手抄一遍接口名', () => {
    expect(refFieldUnion(B, 'Shapes', 'shape'), 'Shapes = Box | Sphere ⇒ 两个 shape 各读一次').toEqual(['cone', 'sphere'])
    expect(refFieldUnion(B, 'Shapes', 'nope'), '任一环节读不到就整条返回 null（宁可报空转，也不交一个残缺集合冒充"没有漂移"）').toBeNull()
    expect(refFieldUnion(B, 'Nope', 'shape')).toBeNull()
  })

  it('`objectKeys` 读 `export const X = { … }` 的顶层键：跳过类型标注的花括号、跳过注释、不进嵌套', () => {
    expect(objectKeys(SYNTH, 'TABLE'), '三行行键，嵌套对象内部的 amp/dur 与注释里的 ghostLine 都不算').toEqual(['graze', 'hurt', 'boss'])
    expect(objectKeys(SYNTH, 'NOPE_TABLE')).toBeNull()
  })

  it('`arrayLiterals` 读 `export const X = [...] as const`（主人是一张数组而不是一条 type）', () => {
    expect(arrayLiterals(SYNTH, 'ROSTER')).toEqual(['fissure', 'mute', 'echo'])
    expect(arrayLiterals(SYNTH, 'NOPE')).toBeNull()
  })

  it('`callArgLiterals` 只认字面量实参：变量传进来的那条读不到（所以这张普查只对"调用点全是字面量"的载体成立）', () => {
    expect(callArgLiterals(SYNTH, 'eat')).toEqual(['ps_one', 'ps_two'])
    expect(callArgLiterals(SYNTH, 'sleep')).toBeNull()
  })
})

describe('对账：两侧谁多谁少都逃不掉，豁免要带理由也要能销，载体读不到要自曝', () => {
  const pair = (over: Partial<VocabPair>): VocabPair => ({
    at: 'Kind', from: 'synth.ts', name: '种类', source: (c) => unionMembers(c.blocks, 'Kind'),
    copied: ['a', 'b', 'c'], ...over,
  })
  const errs = (pairs: VocabPair[]) => vocabDriftErrors({ pairs, corpusFor })

  it('相等 ⇒ 一声不响；少抄 ⇒ 说"改表的人会被不存在的问题挡住"；多抄 ⇒ 说"主人那一侧不认识"', () => {
    expect(errs([pair({})])).toEqual([])
    const less = errs([pair({ copied: ['a', 'b'] })])
    expect(less.map((e) => e.key)).toEqual(['vocab:Kind'])
    expect(less[0].msg).toContain('synth.ts 里有 c')
    expect(less[0].from, '报错要带载体文件名，调用方才知道把它印在哪一段').toBe('synth.ts')
    const more = errs([pair({ copied: ['a', 'b', 'c', 'ghost'] })])
    expect(more[0].msg).toContain('校验器的名单里有 ghost')
    expect(more[0].msg).toContain('KI-047')
  })

  it('读不到声明 ⇒ 报"门在空转"，不是静默跳过', () => {
    const e = errs([{ at: 'Nope', from: 'synth.ts', name: '不存在', source: (c) => unionMembers(c.blocks, 'Nope'), copied: ['a'] }])
    expect(e.map((x) => x.key)).toEqual(['carrier:Nope'])
    expect(e[0].msg).toContain('空转')
    expect(e[0].msg).toContain('synth.ts')
  })

  it('载体整个读不到 ⇒ 也是空转，而且点名是哪个文件（不是"没有漂移"）', () => {
    const e = errs([{ at: 'Kind', from: 'gone.ts', name: '种类', source: (c) => unionMembers(c.blocks, 'Kind'), copied: ['a'] }])
    expect(e.map((x) => x.key)).toEqual(['carrier:Kind'])
    expect(e[0].msg).toContain('gone.ts 读不到')
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

  it('`subset`：整张表允许只抄一角（少抄不报、多抄照报），但理由必须写', () => {
    const p = (over: Partial<VocabPair>): VocabPair => pair({ copied: ['a'], subset: true, ...over })
    expect(errs([p({ whySubset: '这张表本来就只占一角' })]), '少抄 b/c 不报（这才是 subset 存在的理由）').toEqual([])
    expect(errs([p({})])[0].msg, 'subset 却不写理由 ⇒ 红').toContain('有据')
    const ghost = errs([p({ copied: ['a', 'ghost'], whySubset: 'x' })])
    expect(ghost.map((x) => x.key), '声明里没有的项，subset 也护不住').toEqual(['vocab:Kind'])
    expect(ghost[0].msg).toContain('synth.ts 不认识')
  })

  it('两种豁免同时挂 ⇒ 判据自己拒绝（那等于谁都不在看）', () => {
    const e = errs([pair({ copied: ['a'], subset: true, whySubset: 'x', allowMissing: ['c'], whyMissing: 'y' })])
    expect(e.map((x) => x.msg).join('\n')).toContain('两种豁免同时挂')
  })
})

describe('今天的真载体：五张新对账在真文件上零条，抽取也逐张读得到东西', () => {
  /**
   * 这一段与 `validate-data.mjs` 里的 `VOCAB_PAIRS` 是**两份独立写出来的**读数：那里的 `copied` 是
   * 校验器真正拿去判数据的那张表，这里的期望值是测试自己抄的一份，专管"抽取在真文件上还读得到吗"。
   * 两边都对上才算数——所以这里钉的是**读回来的形状**（条数、点名几个成员），不是再抄一遍白名单。
   */
  const corpora: Record<string, VocabCorpus> = {}
  const realCorpus = (from: string): VocabCorpus | null => {
    if (!(from in corpora)) {
      try { const text = read(from); corpora[from] = { text, blocks: schemaBlocks(text) } }
      catch { corpora[from] = null as unknown as VocabCorpus }
    }
    return corpora[from] ?? null
  }

  it('十张 schema.ts 名单逐张与声明相等（或按登记的子集关系成立）——KI-074 那条，换成新 API 后原样钉住', () => {
    const S = (at: string, f: (c: VocabCorpus) => string[] | null, copied: string[], over: Partial<VocabPair> = {}): VocabPair =>
      ({ at, from: 'src/data/schema.ts', source: f, copied, ...over })
    const pairs: VocabPair[] = [
      S('AttrKey', (c) => unionMembers(c.blocks, 'AttrKey'), ['str', 'dex', 'ton', 'vig', 'ovr', 'fis']),
      S('SlotKey', (c) => unionMembers(c.blocks, 'SlotKey'), ['weapon', 'helm', 'cuirass', 'gloves', 'greaves', 'seal', 'sealA', 'sealB']),
      S('SlotKey/装备件', (c) => unionMembers(c.blocks, 'SlotKey'), ['weapon', 'helm', 'cuirass', 'gloves', 'greaves', 'seal', 'sealB'],
        { allowMissing: ['sealA'], whyMissing: '今天没有任何一件装备声明 sealA' }),
      S('ItemKind', (c) => unionMembers(c.blocks, 'ItemKind'), ['currency', 'material', 'consumable', 'weapon', 'armor', 'seal', 'lore', 'key']),
      S('MilestoneGrant', (c) => interfaceFields(c.blocks, 'MilestoneGrant'), ['loadFlat', 'parryWhiffMs', 'execMulPct', 'overdriveFlat', 'corruptionStayPct']),
      S('MovementFrame', (c) => interfaceFields(c.blocks, 'MovementFrame'), ['startup', 'activeStart', 'activeEnd', 'recovery', 'poise', 'hitStopMs', 'hitbox', 'multi', 'shake', 'sfx', 'vfx', 'loudness']),
      S('MovementLevel', (c) => interfaceFields(c.blocks, 'MovementLevel'), ['cooldownTicks', 'damage', 'trueDamage', 'fissureLayers', 'muteTicks', 'distance', 'freezeTicks', 'echoCharges', 'silenceTicks', 'silenceDmgBonus']),
      S('PropRef.kind', (c) => fieldUnion(c.blocks, 'PropRef', 'kind'), ['soundspine', 'resonance_core']),
      S('InteractableRef.kind', (c) => fieldUnion(c.blocks, 'InteractableRef', 'kind'), ['checkpoint', 'elevator', 'bridge', 'soundwall', 'gather', 'chest', 'npc', 'teleport', 'gate', 'bell', 'inspect', 'shop']),
      S('ProjectileSpec.kind', (c) => fieldUnion(c.blocks, 'ProjectileSpec', 'kind'), ['spear', 'note', 'shard']),
      S('DialogueCondition', (c) => interfaceFields(c.blocks, 'DialogueCondition'), ['flags', 'relation', 'quest', 'hasItem', 'state']),
      S('DialogueEffects', (c) => interfaceFields(c.blocks, 'DialogueEffects'), ['setRelation', 'setFlags', 'clearFlags', 'startQuest', 'advanceQuest', 'giveItem', 'takeItem', 'notify', 'setState']),
    ]
    expect(vocabDriftErrors({ pairs, corpusFor: realCorpus })).toEqual([])
  })

  it('四种形状的载体各读得出东西（读不到就是 null ⇒ 下面的对账会自己报空转）', () => {
    expect(objectKeys(read('src/player/CameraRig.ts'), 'SHAKE_TABLE')).toEqual(
      ['graze', 'normal', 'hurt', 'parry', 'heavy', 'boss', 'execute', 'stomp'])
    expect(arrayLiterals(read('src/core/EventBus.ts'), 'STATUS_IDS')).toHaveLength(5)
    expect(unionMembers(schemaBlocks(read('src/core/Input.ts')), 'ActionName'), '输入层的动作全集').toHaveLength(20)
    expect(callArgLiterals(read('src/rpg/Settlement.ts'), 'passiveValue')).toEqual(
      ['ps_metronomefoot', 'ps_tympanicguard', 'ps_featherrest'])
    expect(refFieldUnion(schemaBlocks(read('src/data/schema.ts')), 'Hitbox', 'shape')).toEqual(['cone', 'sphere', 'ring'])
  })

  it('五张新名单逐张与主人对上（豁免按登记的子集成立）', () => {
    const pairs: VocabPair[] = [
      {
        at: 'SHAKE_TABLE', from: 'src/player/CameraRig.ts', source: (c) => objectKeys(c.text, 'SHAKE_TABLE'),
        copied: ['graze', 'normal', 'heavy', 'boss', 'stomp'], allowMissing: ['hurt', 'parry', 'execute'], whyMissing: '代码直接发',
      },
      { at: 'STATUS_IDS', from: 'src/core/EventBus.ts', source: (c) => arrayLiterals(c.text, 'STATUS_IDS'), copied: ['fissure', 'mute', 'echo', 'corruption', 'overdrive'] },
      { at: 'ActionName', from: 'src/core/Input.ts', source: (c) => unionMembers(c.blocks, 'ActionName'), copied: ['weaponSkill', 'weaponSkillB'], subset: true, whySubset: '战技只占两条' },
      { at: "passiveValue('…')", from: 'src/rpg/Settlement.ts', source: (c) => callArgLiterals(c.text, 'passiveValue'), copied: ['ps_metronomefoot', 'ps_tympanicguard', 'ps_featherrest'] },
      { at: 'Hitbox', from: 'src/data/schema.ts', source: (c) => refFieldUnion(c.blocks, 'Hitbox', 'shape'), copied: ['cone', 'sphere', 'ring'] },
    ]
    expect(vocabDriftErrors({ pairs, corpusFor: realCorpus })).toEqual([])
  })

  /**
   * 打印段的反向判据（源码门，KI-058 那套剥注释写法）。
   * 这条不是装饰：对账门第一次上线时四条植入实测全部"不咬"，根因是报告循环只走 11 份 JSON，
   * 挂在 `schema.ts` 段名下的 ERROR 既不打印也不计数。修的是循环，可修完之后谁都能把它改回去。
   * KI-076 起段名不再只有 schema.ts（震镜表红在 CameraRig.ts 名下），所以这条更要钉着。
   */
  it('报告循环要走"FILES ∪ 报过事的其他段名"，跨文件的检查不许报进虚空', () => {
    const code = read('scripts/validate-data.mjs').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    expect(code, 'sections 必须并入 report.rows 里出现过的段名').toContain('new Set(report.rows.map((x) => x.file))')
    expect(code, 'errTotal 要按 sections 累加，不是按 FILES').toMatch(/for \(const f of sections\)/)
  })
})
