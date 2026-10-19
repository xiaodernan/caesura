import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  arrayLiterals, callArgLiterals, dirListing, fieldUnion, handCopiedLists, importedNames, interfaceFields, objectKeys,
  refFieldUnion, schemaBlocks, setLiterals, stripComments, unionMembers, vocabCoverageErrors, vocabDriftErrors,
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
      S('MilestoneGrant', (c) => interfaceFields(c.blocks, 'MilestoneGrant'), ['loadFlat', 'parryWhiffMs', 'execMulPct', 'overdriveFlat', 'corruptionStayPct', 'bowForkBranches', 'rollStaminaFlat']),
      S('MovementFrame', (c) => interfaceFields(c.blocks, 'MovementFrame'), ['startup', 'activeStart', 'activeEnd', 'recovery', 'poise', 'hitStopMs', 'hitbox', 'multi', 'shake', 'sfx', 'vfx', 'loudness']),
      S('MovementLevel', (c) => interfaceFields(c.blocks, 'MovementLevel'), ['cooldownTicks', 'damage', 'trueDamage', 'fissureLayers', 'muteTicks', 'distance', 'freezeTicks', 'echoCharges', 'silenceTicks', 'silenceDmgBonus']),
      S('PropRef.kind', (c) => fieldUnion(c.blocks, 'PropRef', 'kind'), ['soundspine', 'resonance_core']),
      S('InteractableRef.kind', (c) => fieldUnion(c.blocks, 'InteractableRef', 'kind'), ['checkpoint', 'elevator', 'bridge', 'soundwall', 'gather', 'chest', 'npc', 'teleport', 'gate', 'bell', 'inspect', 'shop']),
      S('ProjectileSpec.kind', (c) => fieldUnion(c.blocks, 'ProjectileSpec', 'kind'), ['spear', 'note', 'shard', 'arrow']),
      S('DialogueCondition', (c) => interfaceFields(c.blocks, 'DialogueCondition'), ['flags', 'relation', 'quest', 'hasItem', 'state']),
      S('DialogueEffects', (c) => interfaceFields(c.blocks, 'DialogueEffects'), ['setRelation', 'setFlags', 'clearFlags', 'startQuest', 'advanceQuest', 'giveItem', 'takeItem', 'notify', 'setState']),
    ]
    expect(vocabDriftErrors({ pairs, corpusFor: realCorpus })).toEqual([])
  })

  it('四种形状的载体各读得出东西（读不到就是 null ⇒ 下面的对账会自己报空转）', () => {
    expect(objectKeys(read('src/player/CameraRig.ts'), 'SHAKE_TABLE')).toEqual(
      ['graze', 'normal', 'hurt', 'parry', 'heavy', 'boss', 'execute', 'stomp'])
    expect(arrayLiterals(read('src/core/EventBus.ts'), 'STATUS_IDS')).toHaveLength(5)
    // 22 = 20 + `throwCrystal`（KI-023① 的 T 键音色晶）+ `observe`（KI-105 的 V 键声纹观察）。
    // **数与名字一起钉**：只报一个数的话，
    // 将来任何一格增删都只能靠"撞红"来定位，而撞红只说"不是 22"，说不出变的是谁。
    const actions = unionMembers(schemaBlocks(read('src/core/Input.ts')), 'ActionName')
    expect(actions, '输入层的动作全集').toHaveLength(22)
    expect(actions, 'KI-023① 加的那一格').toContain('throwCrystal')
    expect(actions, 'KI-105 加的那一格').toContain('observe')
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
/**
 * KI-086：抽取器补上两种新形状，并把「还剩几张手抄名单没交代」换成机器读数。
 * 这一段钉两件事：①新形状读得回来（读不回来时返回 null 而不是空集——空集会把所有成员判成非法）；
 * ②覆盖面判据的每一臂都咬得住，包括它自己那两条反向判据（「登记了豁免却没写理由」「豁免该销了」）。
 */
const SYNTH2 = `
import { AMB_A, AMB_B } from './ambience-rules.mjs'
import {
  AMB_C,
  AMB_D,
} from './explore-rules.mjs'

const PRIVATE_SET = new Set(['one', 'two'])
export const PUBLIC_SET = new Set(['three'] as const)
const ROSTER = ['r1', 'r2'] as const
export const DERIVED = new Set(OTHER_LIST)
declare const OTHER_LIST: string[]

export interface Outer {
  plain: string
  ai: {
    pickOrder: 'random' | 'cycle'
  }
  trailing: number
}

export function localScope(): void {
  if (true) {
    const DEEP_TABLE = new Set(['x'])
    void DEEP_TABLE
  }
}
`

describe('KI-086：模块级 Set / 数组名册的普查、import 进来的名字、嵌套对象里那一格', () => {
  it('`setLiterals` 读私有 `const X = new Set([…])`：主人不必是 export，也不必是数组', () => {
    expect(setLiterals(SYNTH2, 'PRIVATE_SET')).toEqual(['one', 'two'])
    expect(setLiterals(SYNTH2, 'PUBLIC_SET'), 'export 与 `as const` 都拦不住它').toEqual(['three'])
  })

  it('`setLiterals`：从别人派生的那一种读不到就是 null（拿空集冒充词表会把所有成员判成非法）', () => {
    expect(setLiterals(SYNTH2, 'DERIVED')).toBeNull()
    expect(setLiterals(SYNTH2, 'NOPE')).toBeNull()
  })

  it('`handCopiedLists` 按缩进读数：两格算进来（校验器的 ADVICE_AXES 正是这张形状），四格以深读不到', () => {
    const names = handCopiedLists(SYNTH2)
    expect(names).toEqual(['PRIVATE_SET', 'PUBLIC_SET', 'ROSTER'])
    expect(names, '四格缩进今天读不到 ⇒ KI-086 没做③：一张藏在三层嵌套里的抄本可以躲过覆盖面').not.toContain('DEEP_TABLE')
    expect(handCopiedLists('export function f(): void {\n  const TWO_SPACE = new Set([\'x\'])\n}\n'),
      '两格会被算进来：`validate-data.mjs` 里的 ADVICE_AXES 就是函数顶上这张表，它由 VOCAB_UNPAIRED 交代').toEqual(['TWO_SPACE'])
    expect(names, '派生集合（`new Set(OTHER)`）不在这张普查里').not.toContain('DERIVED')
  })

  it('`importedNames` 认单行与多行 import：覆盖普查靠它区分「住在本文件」与「住在规则模块」', () => {
    expect(importedNames(SYNTH2)).toEqual(['AMB_A', 'AMB_B', 'AMB_C', 'AMB_D'])
    expect(importedNames('const A = 1\n'), '一条 import 都没有 ⇒ null，喊空转由调用方负责').toBeNull()
  })

  it('`fieldUnion` 认得嵌在嵌套对象里的那一格（KI-086 之前只认两格缩进 ⇒ 读成 null）', () => {
    expect(fieldUnion(schemaBlocks(SYNTH2), 'Outer', 'pickOrder')).toEqual(['random', 'cycle'])
    expect(fieldUnion(schemaBlocks(SYNTH2), 'Outer', 'plain'), '没有字面量联合的字段照旧 null').toBeNull()
  })
})

describe('KI-086：覆盖面对账——每张手抄名单要么有主人、要么写明为什么没有主人', () => {
  const P = (where: string): VocabPair => ({ at: where, from: 'synth.ts', source: () => ['a'], copied: ['a'], where })
  const cov = (over: Partial<Parameters<typeof vocabCoverageErrors>[0]>) =>
    vocabCoverageErrors({ file: 'synth.ts', census: ['A_LIST', 'B_LIST'], pairs: [], unpaired: [], ...over })

  it('两张都有主人 ⇒ 一声不响；漏掉一张 ⇒ 红在它自己的名下，并给出两条路选一条', () => {
    expect(cov({ pairs: [P('A_LIST'), P('B_LIST')] })).toEqual([])
    const e = cov({ pairs: [P('A_LIST')] })
    expect(e.map((x) => x.key)).toEqual(['coverage:B_LIST'])
    expect(e[0].msg).toContain('没有任何交代')
    expect(e[0].from, '报错要落在被普查的那份文件段名下').toBe('synth.ts')
  })

  it('豁免要写理由：`VOCAB_UNPAIRED` 挂着一张名单却没有 `why` ⇒ 红（豁免也要有据）', () => {
    expect(cov({ unpaired: [{ name: 'A_LIST', why: '主人是别处的测试' }, { name: 'B_LIST', why: '同上' }] })).toEqual([])
    const e = cov({ unpaired: [{ name: 'A_LIST', why: 'x' }, { name: 'B_LIST', why: '' }] })
    expect(e.map((x) => x.key)).toEqual(['coverage:B_LIST'])
    expect(e[0].msg).toContain('没写理由')
  })

  it('豁免要能销：名单已经从文件里消失，`VOCAB_UNPAIRED` 还挂着它 ⇒ 红（KI-073 同族）', () => {
    const e = cov({ census: ['A_LIST'], unpaired: [{ name: 'A_LIST', why: 'x' }, { name: 'GONE_LIST', why: 'y' }] })
    expect(e.map((x) => x.key)).toEqual(['coverage:GONE_LIST'])
    expect(e[0].msg).toContain('该销了')
  })

  it('两种交代同时挂 ⇒ 判据自己拒绝（那等于谁都不在看，KI-076 的 subset/allowMissing 同族）', () => {
    const e = cov({ census: ['A_LIST'], pairs: [P('A_LIST')], unpaired: [{ name: 'A_LIST', why: 'x' }] })
    expect(e.map((x) => x.msg).join('\n')).toContain('两种交代同时挂')
  })

  it('反向：入表名单必须在文件里真存在（本文件普查到 或 import 进来），否则红——这条同时是抽取器的自曝器', () => {
    const gone = cov({ census: ['A_LIST', 'B_LIST'], pairs: [P('A_LIST'), P('B_LIST'), P('C_LIST')] })
    expect(gone.map((x) => x.key)).toEqual(['coverage:C_LIST'])
    expect(gone[0].msg).toContain('普查不到它')
    const imported = cov({ census: ['A_LIST'], imported: ['B_LIST'], pairs: [P('A_LIST'), P('B_LIST')] })
    expect(imported, '从规则模块 import 进来的名字也算交代').toEqual([])
    const empty = cov({ census: null, pairs: [P('A_LIST'), P('B_LIST')] })
    expect(empty.map((x) => x.key), '普查读空 ⇒ 每张已入表的本地名单各红一次，不静默变绿')
      .toEqual(['coverage:A_LIST', 'coverage:B_LIST'])
  })
})

describe('KI-086 的真载体：新形状在真文件上读得回来，门本体还在被调用', () => {
  it('`PSEUDO_ACTIONS` 住在 AI 模块里：私有 Set，既不是 export 也不是数组', () => {
    expect(setLiterals(read('src/ai/Enemy.ts'), 'PSEUDO_ACTIONS')).toEqual(['chase', 'backstep', 'hold'])
  })

  it('`EnemyData.ai.pickOrder` 四格缩进也读得到（KI-086 之前这张是 null ⇒ 门在空转）', () => {
    expect(fieldUnion(schemaBlocks(read('src/data/schema.ts')), 'EnemyData', 'pickOrder')).toEqual(['random', 'cycle'])
  })

  it('校验器那份文件里两种读数都非空——任一边读空，覆盖面都会自己红（不是静默绿）', () => {
    const text = read('scripts/validate-data.mjs')
    const census = handCopiedLists(text) ?? []
    expect(census.length, '三十来张手抄名单，少一大截就说明抽取器读不动今天这个形状了').toBeGreaterThan(30)
    expect(census).toContain('VOCAB_PAIRS')
    expect(importedNames(text) ?? [], '规则模块搬进来的名字也算交代').toContain('AMB_BED_FIELDS')
  })

  it('门本体还在被调用：删掉 `vocabCoverageErrors(...)` 而留着函数，一切照绿、没人会发现', () => {
    const code = read('scripts/validate-data.mjs').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    expect(code).toContain('vocabCoverageErrors(')
    expect(code, '普查读数必须来自抽取器，不许手抄').toContain('handCopiedLists(selfCorpus.text)')
  })
})

/**
 * KI-086 没做① 的结案：`FILES`（校验器读哪几份 JSON）的真主人是 `src/data/json/` **目录**，
 * 而 `corpusFor(from)` 原来只收"一份文件"——那个形状今天没有，于是这张名单只能挂着"没有主人"豁免。
 * 现在它有第六种主人：一个目录。两侧都从源码现推，测试不许再手抄第三份。
 */
const DIR_SYNTH = `
ambience.json
battle.json
notes.txt
README.md
dup.json
dup.json
`

describe('KI-088：第六种主人是一个目录 —— 读法、两个方向各自说话、以及校验器那份真名册', () => {
  it('`dirListing` 按后缀挑名字：别的后缀不算、重复只留一次、一项不剩时是 null', () => {
    expect(dirListing(DIR_SYNTH, '.json')).toEqual(['ambience.json', 'battle.json', 'dup.json'])
    expect(dirListing(DIR_SYNTH, '.md'), '换一种后缀读到的是另一种集合').toEqual(['README.md'])
    expect(dirListing(DIR_SYNTH, '.toml'), '读不到任何一项 ⇒ null（门在空转），不是"这个目录是空的"').toBeNull()
    expect(dirListing('  \n\n', '.json')).toBeNull()
  })

  it('`arrayLiterals` 不再要求 `export`：没导出的那张名册也读得回来（测试由此能**从源码推**而不是再抄一份）', () => {
    expect(arrayLiterals("const FILES = ['a.json', 'b.json']\n", 'FILES')).toEqual(['a.json', 'b.json'])
    expect(arrayLiterals(SYNTH, 'ROSTER'), 'export + as const 那一族照旧读得到').toEqual(['fissure', 'mute', 'echo'])
  })

  const base: VocabPair = {
    at: 'DIR', from: 'dir/', name: '名册', where: 'FILES',
    source: (c) => dirListing(c.text, '.json'), copied: ['a.json'],
  }
  const drift = (pairs: VocabPair[], listing: string) =>
    vocabDriftErrors({ pairs, corpusFor: (from) => (from === 'dir/' ? { text: listing, blocks: new Map() } : null) })

  it('两个方向各说自己的话：给了 `missHint`/`extraHint` 就不再说那句通用措辞（主人是目录时那句是假的）', () => {
    const miss = drift([{ ...base, missHint: 'MISS-HINT' }], 'a.json\nb.json')
    expect(miss.map((x) => x.key)).toEqual(['vocab:DIR'])
    expect(miss[0].msg).toContain('MISS-HINT')
    expect(miss[0].msg, '通用措辞说的是"改表的人被一个不存在的问题挡住"——目录里多出一份文件时没人被挡住，是那份文件没人校验').not.toContain('改表的人会被一个不存在的问题挡住')
    const extra = drift([{ ...base, copied: ['a.json', 'ghost.json'], extraHint: 'EXTRA-HINT' }], 'a.json')
    expect(extra.map((x) => x.key)).toEqual(['vocab:DIR'])
    expect(extra[0].msg).toContain('EXTRA-HINT')
    expect(extra[0].msg).not.toContain('要么该进声明、要么就是死词')
  })

  it('没给提示时通用措辞照旧（默认路径不许被新参数悄悄吞掉，两边都要有读数）', () => {
    const miss = drift([base], 'a.json\nb.json')
    expect(miss[0].msg).toContain('改表的人会被一个不存在的问题挡住')
    expect(miss[0].msg, '`where` 提供指路，缺它才退到默认文件名').toContain('FILES')
    const extra = drift([{ ...base, copied: ['a.json', 'ghost.json'] }], 'a.json')
    expect(extra[0].msg).toContain('要么该进声明、要么就是死词')
    expect(extra[0].from).toBe('dir/')
  })

  it('真载体：`FILES` 与 `src/data/json/` 目录双向对账 0 条，两侧读数都从源码现推', () => {
    const roster = arrayLiterals(read('scripts/validate-data.mjs'), 'FILES')
    expect(roster, '读不回来就等于这张门两侧比的是空集，KI-088 的 `arrayLiterals` 放宽当场失效').not.toBeNull()
    const real = readdirSync(root + 'src/data/json').filter((n) => n.endsWith('.json')).sort()
    expect([...(roster ?? [])].sort()).toEqual(real)
    expect(real.length, '非空守卫：目录读到 0 份时上面那条 toEqual 会连"两侧都读空"一起放行').toBeGreaterThanOrEqual(20)
    const errs = vocabDriftErrors({
      pairs: [{ ...base, at: 'src/data/json/ 目录', from: 'dir/', name: '校验器要读的表名册', copied: roster ?? [] }],
      corpusFor: (from) => (from === 'dir/' ? { text: real.join('\n'), blocks: new Map() } : null),
    })
    expect(errs, '今天这一趟必须真的干净（否则新门一开就带着红落地）').toEqual([])
  })

  it('接线：`corpusFor` 真走目录那一支，且 `FILES` 从"没有主人"改成了"有主人"（删掉那半句分支而留着判据，一切照绿）', () => {
    const src = read('scripts/validate-data.mjs')
    const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    expect(code).toContain("from.endsWith('/')")
    expect(code).toContain('readdirSync(resolve(ROOT, from))')
    expect(code).toContain("at: 'src/data/json/ 目录'")
    expect(code, '那个尾斜杠就是"主人是一个目录"的记号，抄漏它 ⇒ readFileSync 读到 EISDIR ⇒ 门在空转').toContain("from: 'src/data/json/',")
    expect(code).toContain('copied: FILES')
    expect(handCopiedLists(src), '覆盖面普查读得到 FILES ⇒ 它现在由 VOCAB_PAIRS 交代').toContain('FILES')
  })
})