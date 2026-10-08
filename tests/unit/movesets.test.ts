import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { registerGameData, weaponsRaw } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { interfaceFields, schemaBlocks } from '../../scripts/schema-vocab.mjs'

/**
 * §64 acceptance ④: frame data is read from the data table (no hardcoded
 * numbers in code). These assert the greatsword + spear 段 timings match the
 * combat.md §4.2/§4.3 spec that was authored into movesets.json.
 */
registerGameData()

const gs = registry.get<MovesetData>('moveset:ms_greatsword').actions
const sp = registry.get<MovesetData>('moveset:ms_spear').actions

describe('weapon frame data comes from the table (§55/§64)', () => {
  it('greatsword 27f startup / 9f active / 24f recovery L1, and charged stacks 震裂×3', () => {
    expect(gs['l1'].startup).toBe(27)
    expect(gs['l1'].activeEnd - gs['l1'].activeStart).toBe(9)
    expect(gs['l1'].recovery).toBe(60) // 27 + 9 + 24
    expect(gs['charged'].fissureLayers).toBe(3)
    expect(gs['charged'].damage).toBe(80)
    expect(gs['l1'].hitbox && 'radius' in gs['l1'].hitbox && gs['l1'].hitbox.radius).toBe(3.0)
  })

  it('spear has a 5-hit light chain and long reach (3.2m)', () => {
    expect(sp['l1'].next).toBe('l2')
    expect(sp['l4'].next).toBe('l5')
    expect(sp['l5']).toBeTruthy()
    expect(sp['l1'].hitbox && 'radius' in sp['l1'].hitbox && sp['l1'].hitbox.radius).toBe(3.2)
    expect(sp['jump'].fissureLayers).toBe(1)
  })

  it('weapons carry archetype + noise scaling used by the sim (greatsword is a noise source)', () => {
    const gw = registry.get<WeaponData>('wp_fortissimo_greatsword')
    const sw = registry.get<WeaponData>('wp_drawpin_spear')
    expect(gw.archetype).toBe('greatsword')
    expect(gw.noiseMul).toBeGreaterThan(1)
    expect(sw.archetype).toBe('spear')
  })
})

/**
 * KI-039 的**定价闸门**（数据侧，不靠跑战斗）。
 *
 * 为什么放在这里而不只放在 gate5：KI-039 那 2× 的节奏差是**从帧表里读出来的**，
 * 而跑一次对照要 600+ tick、还混进了 AI 出招与架势打断的噪声。这条闸门只看每把武器
 * 的第一记轻击，量的是「这家族的持续输出被定在什么档」，所以 KI-037 补新武器时它当场就会响。
 *
 * 口径：持续 DPS 用 `l1.damage / l1.recovery`（这一记从起手到收势的整段墙钟成本，
 * 与 `boss-budget.test.ts` 那把「蓄力一记 / 74 tick」的尺子同源）。
 *
 * **KI-037 落地时的分族重裁（2026-10-08）**：泛音弓与音叉杖入表后，"全班一把尺子"的 1.25×
 * 当场红了——弓 l1 = 10/36 = 0.278、杖 l1 = 7/32 = 0.219，对大剑 21/60 = 0.35 分别是
 * 1.26× 与 1.60×。裁决：**近战四族（直剑/大剑/枪/无鸣）之间 ≤1.25× 一字不改**；
 * 弓/杖换另一把尺——「l1 持续 dps 不得超过近战家族最大值」。两条理由：
 * ① 设计红线「谁先杀完同一只敌人」对全班有效，而"更慢"是文档写死的定价：
 *    progression.md §4 build7 明写音叉杖「自身伤害面板最低」；
 * ② 这条闸自己的限制①早就声明"不吃枪的射程与风筝优势"——弓/杖的价住在射程、分叉、
 *    战技射程 +25% 上，站桩轻击这道闸结构上看不见它们。
 * 分族不是放水：近战带仍咬在 1.167×，弓/杖仍被近战天花板压着，且**新 archetype 必须
 * 在这里显式站队**（familyOf 抛错）——不许有第三把谁也没裁决过的尺子悄悄混进来。
 */
describe('KI-039：武器家族的轻击定价必须互相咬住（重量的回报不落在通关时间上）', () => {
  /** 近战四族：互相之间 ≤1.25×（KI-039 原始口径，一字未改） */
  const MELEE = new Set(['straight_sword', 'greatsword', 'spear', 'needle'])
  /** 远程两族：另一把尺，见上面的分族重裁 */
  const RANGED = new Set(['bow', 'staff'])
  const familyOf = (a: string): 'melee' | 'ranged' => {
    if (MELEE.has(a)) return 'melee'
    if (RANGED.has(a)) return 'ranged'
    throw new Error(`archetype '${a}' 没被 KI-039 分族重裁覆盖 ⇒ 新家族必须在这里显式站队，不许悄悄跳过定价闸`)
  }
  const rows = weaponsRaw.map((w) => {
    const a = registry.get<MovesetData>(`moveset:${w.movesetId}`).actions['l1']
    if (!a) throw new Error(`movesets: ${w.movesetId} 没有 l1，玩家第一记轻击打不出来`)
    return { id: w.id, archetype: w.archetype, perHit: a.damage, cycle: a.recovery, dps: a.damage / a.recovery }
  })

  it('每把武器都有 l1 定价，且每个 archetype 都归了族（新家族不许悄悄溜过闸门）', () => {
    expect(rows.length, 'weapons.json 一把都没有 ⇒ 这条闸门在自证空集').toBeGreaterThan(0)
    for (const r of rows) {
      expect(() => familyOf(r.archetype), `${r.id} 的 archetype '${r.archetype}' 没有站队`).not.toThrow()
    }
  })

  it('近战四族之间 sustained DPS 极差 ≤1.25×', () => {
    const melee = rows.filter((r) => familyOf(r.archetype) === 'melee')
    expect(melee.length, '近战家族一把都没有 ⇒ 这把尺在自证空集').toBeGreaterThan(0)
    const sorted = [...melee].sort((x, y) => x.dps - y.dps)
    const spread = sorted[sorted.length - 1].dps / sorted[0].dps
    const detail = melee.map((r) => `${r.id} ${r.perHit}/${r.cycle}=${r.dps.toFixed(3)}`).join(' | ')
    expect(spread, `近战轻击持续输出极差 ${spread.toFixed(2)}×（${detail}）> 1.25× ⇒ 某一边顺带赢下了通关时间`).toBeLessThanOrEqual(1.25)
  })

  it('弓/杖的 l1 持续 dps 不得超过近战家族最大值（远程的价不住在站桩轻击上）', () => {
    const melee = rows.filter((r) => familyOf(r.archetype) === 'melee')
    const ranged = rows.filter((r) => familyOf(r.archetype) === 'ranged')
    expect(melee.length, '近战一把都没有 ⇒ 天花板是空集，下面谁都能过').toBeGreaterThan(0)
    expect(ranged.length, '远程一把都没有 ⇒ 这条在自证空集').toBeGreaterThan(0)
    const ceiling = Math.max(...melee.map((r) => r.dps))
    for (const r of ranged) {
      expect(r.dps, `${r.id} 的 l1 dps ${r.dps.toFixed(3)} 超过近战天花板 ${ceiling.toFixed(3)} ⇒ 远程顺带赢下了通关时间`).toBeLessThanOrEqual(ceiling)
    }
  })

  it('单发最重的那把同时也是收势最长的那把（否则"重"只是文案）', () => {
    const byHit = [...rows].sort((x, y) => y.perHit - x.perHit)[0]
    const byCycle = [...rows].sort((x, y) => y.cycle - x.cycle)[0]
    expect(byCycle.id, `最重=${byHit.id}，最慢=${byCycle.id} ⇒ 重量没换来代价`).toBe(byHit.id)
  })
})

/**
 * KI-037①：泛音弓 / 音叉杖入表。帧表**逐格**对账 combat.md §4.4/§4.5——
 * 与 §4.1/§4.2/§4.3 同一把尺：文档写几帧，表里就得是几帧。
 *
 * `recovery` 的语义是「起手 + 判定 + 收势」的整段墙钟（KI-039 口径），所以
 * `recovery - startup - (activeEnd - activeStart)` 正好是文档那一格后摇：
 * 速射 15+0+21=36、破鸣箭 36+0+36=72、跳跃 12+0+18=30、满弓 20+6+27=53；
 * 音叉杖 L1 13+6+13=32、L4 17+6+21=44、鸣和弦 24+9+27=60、共振弹 20+6+24=50。
 */
describe('KI-037：弓/杖帧表逐格对账 combat.md §4.4/§4.5', () => {
  const bow = registry.get<MovesetData>('moveset:ms_bow').actions
  const staff = registry.get<MovesetData>('moveset:ms_staff').actions

  it('泛音弓速射：15f 拉弓 / 即时判定 / 21f 后摇，弹速 40、移动中散布 +4°', () => {
    expect(bow['l1'].startup).toBe(15)
    expect(bow['l1'].activeEnd - bow['l1'].activeStart).toBe(0)
    expect(bow['l1'].recovery).toBe(36) // 15 + 0 + 21
    expect(bow['l1'].damage).toBe(10)
    expect(bow['l1'].stamina).toBe(10)
    expect(bow['l1'].poise).toBe(6)
    expect(bow['l1'].next).toBe('l2')
    const p = bow['l1'].projectile!
    expect(p.kind).toBe('arrow')
    expect(p.speed).toBe(40)
    expect(p.range).toBe(45)
    expect(p.moveSpreadDeg, '文档「移动中散布 +4°」').toBe(4)
  })

  it('泛音弓近身轻击：弓身横扫 12/6/12，6 伤害且不占弹数（没有 projectile）', () => {
    expect(bow['l2'].startup).toBe(12)
    expect(bow['l2'].activeEnd - bow['l2'].activeStart).toBe(6)
    expect(bow['l2'].recovery).toBe(30) // 12 + 6 + 12
    expect(bow['l2'].damage).toBe(6)
    expect(bow['l2'].stamina).toBe(6)
    expect(bow['l2'].poise).toBe(4)
    expect(bow['l2'].hitbox && 'angleDeg' in bow['l2'].hitbox && bow['l2'].hitbox.angleDeg).toBe(90)
    expect(bow['l2'].projectile, '横扫不发射弹体').toBeUndefined()
  })

  it('破鸣箭：36f 拉弓 + 36f 后摇，26 伤害震裂×2', () => {
    expect(bow['h'].startup).toBe(36)
    expect(bow['h'].activeEnd - bow['h'].activeStart).toBe(0)
    expect(bow['h'].recovery).toBe(72) // 36 + 0 + 36
    expect(bow['h'].damage).toBe(26)
    expect(bow['h'].stamina).toBe(20)
    expect(bow['h'].poise).toBe(30)
    expect(bow['h'].fissureLayers).toBe(2)
    expect(bow['h'].projectile!.speed, '粗箭 30m/s').toBe(30)
  })

  it('满弓：主箭 18 + 泛音分叉 2 枝 12°、枝伤 60%，主箭锥内自动吸附', () => {
    const c = bow['charged']
    expect(c.startup).toBe(20)
    expect(c.activeEnd - c.activeStart).toBe(6)
    expect(c.recovery).toBe(53) // 20 + 6 + 27（§4.4 后摇 450ms/27f）
    expect(c.damage).toBe(18)
    expect(c.stamina).toBe(14)
    expect(c.poise).toBe(10)
    const p = c.projectile!
    expect(p.burst, 'count 含主箭：1 主 + 2 枝').toEqual({ count: 3, everyTicks: 1 })
    expect(p.spreadDeg).toBe(12)
    expect(p.branchDamageMul, '枝伤 = 60%').toBe(0.6)
    expect(p.assistConeDeg, '主箭优先最近目标').toBe(45)
  })

  it('跳跃射击：12f 起手 + 18f 落地后摇，0.55g 简化弹道', () => {
    const j = bow['jump']
    expect(j.startup).toBe(12)
    expect(j.activeEnd - j.activeStart).toBe(0)
    expect(j.recovery).toBe(30) // 12 + 0 + 18
    expect(j.damage).toBe(12)
    expect(j.stamina).toBe(12)
    expect(j.projectile!.gravity, '10.8 = 0.55 × 19.6（§4.4 滞空感）').toBeCloseTo(10.8, 5)
  })

  it('音叉杖 L1-L4：13/12/12/17f 起手、6f 判定，尾段震裂×2且不再派生', () => {
    const startups = [13, 12, 12, 17]
    const cycles = [32, 31, 32, 44]
    const dmg = [7, 7, 8, 10]
    const keys = ['l1', 'l2', 'l3', 'l4'] as const
    keys.forEach((k, i) => {
      expect(staff[k].startup, `${k} 起手`).toBe(startups[i])
      expect(staff[k].activeEnd - staff[k].activeStart, `${k} 判定窗 100ms`).toBe(6)
      expect(staff[k].recovery, `${k} 整段`).toBe(cycles[i])
      expect(staff[k].damage, `${k} 伤害`).toBe(dmg[i])
      expect(staff[k].stamina, `${k} 体力`).toBe(8)
      expect(staff[k].hitbox, `${k} 是敲击不是弹道`).toBeTruthy()
    })
    expect(staff['l1'].next).toBe('l2')
    expect(staff['l3'].next).toBe('l4')
    expect(staff['l4'].fissureLayers, '尾段挂震裂×2').toBe(2)
    expect(staff['l4'].next, '尾段不再派生').toBeUndefined()
  })

  it('鸣和弦：自身为中心 r=3m 全周扩散环，20 伤害 8 目标', () => {
    const h = staff['h']
    expect(h.startup).toBe(24)
    expect(h.activeEnd - h.activeStart).toBe(9)
    expect(h.recovery).toBe(60) // 24 + 9 + 27
    expect(h.damage).toBe(20)
    expect(h.stamina).toBe(22)
    expect(h.poise).toBe(25)
    const hb = h.hitbox!
    expect(hb.shape).toBe('ring')
    expect(hb.shape === 'ring' && hb.inner).toBe(0.3)
    expect(hb.shape === 'ring' && hb.outer).toBe(3)
    expect(hb.shape === 'ring' && hb.forward, 'forward=0 ⇒ 以自身为圆心，不吃朝向').toBe(0)
    expect(h.multi, '解围神技：一记八个').toBe(8)
  })

  it('共振弹：24m/s、32 伤害、射程 22m（短于弓的 45m）', () => {
    const c = staff['charged']
    expect(c.damage).toBe(32)
    expect(c.stamina).toBe(26)
    expect(c.poise).toBe(20)
    expect(c.recovery).toBe(50) // 20 + 6 + 24
    const p = c.projectile!
    expect(p.kind).toBe('note')
    expect(p.speed).toBe(24)
    expect(p.range).toBe(22)
    expect(p.spreadDeg, '杖不分享叉（分叉是弓的独有腿）').toBeUndefined()
  })

  it('杖没有跳跃/跑动动作，弓没有跑动攻击：表里没写就是没有', () => {
    expect(staff['jump']).toBeUndefined()
    expect(staff['run']).toBeUndefined()
    expect(bow['run']).toBeUndefined()
    expect(bow['jump'], '弓有跳跃射击').toBeTruthy()
  })
})

/**
 * KI-047：玩家出手的底数只住一处——`movesets.json` 每一记的 `damage`。
 *
 * 武器表曾带一件 `atkBase`，全仓库没有消费方，却"看起来像价格"：这正是 KI-039 的
 * 错价能在整轮验收里活下来的形状。裁决按 KI-038 先例删字段（而非把帧表改成倍率），
 * 删除的代价是「同一架式的两把武器永远同价」从巧合变成契约——所以补两条腿：
 * ① 武器↔moveset 必须一对一（validator 同款检查在跑测里也钉住）；
 * ② 武器表里不许再长出 atkBase（`validate-data.mjs` 的 WEAPON_FIELDS 白名单是它的表亲，
 *    反向实测：把 atkBase 塞回 weapons.json ⇒ 两道门各自当场红）。
 *
 * **KI-097（2026-10-07）把这一格的名单拆成了从声明现推**：这个字段集在这里曾是这个文件里的
 * **第三抄**——第一抄 `WEAPON_FIELDS` 住 validate-data 且由 VOCAB_PAIRS 与声明对账，第二抄
 * 就是 `WeaponData` 声明自己，而这份 `CONSUMED` 手抄本没有任何人对账：抄不会失败，只会
 * 静悄悄变旧（声明长了新字段、数据用了它，这里忘了跟 ⇒ 当场红；声明删了字段、这里没删 ⇒
 * 一条谁也不会再触发的死名单继续绿）。现在它由 `interfaceFields(schemaBlocks(...), 'WeaponData')`
 * 每次现推。`atkBase` 由此**两侧都有界**：数据侧由逐键 membership 兜着，声明侧由一条具名
 * `not.toContain` 兜着——两侧同时复活也必有一边红（只兜数据侧时，把声明也一起改回来就能全绿）。
 */
describe('KI-047：底数单一来源——帧表，武器表不再带价格', () => {
  const declared = interfaceFields(schemaBlocks(readFileSync(new URL('../../src/data/schema.ts', import.meta.url), 'utf8')), 'WeaponData')

  it('名单从 WeaponData 现推（KI-097）：读空了先红，读数不许拿空集自证', () => {
    expect(declared, '抽取器在真 schema.ts 上读不到 WeaponData（接口改名/搬家 ⇒ 下面每条都在空集上过）').not.toBeNull()
    expect((declared as string[]).length, '字段数掉到 9 以下 ⇒ 声明被削或抽取被削（KI-097 落地时 11 个）').toBeGreaterThanOrEqual(9)
    for (const must of ['id', 'movesetId']) {
      expect(declared, `WeaponData 连 ${must} 都没了`).toContain(must)
    }
  })

  it('weapons.json 的每一格都在 WeaponData 声明的字段集里，atkBase 声明侧也不许复活', () => {
    for (const w of weaponsRaw) {
      for (const k of Object.keys(w)) {
        expect(declared, `${w.id} 带着 WeaponData 没声明的字段 '${k}'（§55）`).toContain(k)
      }
    }
    expect(declared, 'atkBase 是 KI-047 删掉的死价格——数据侧逐键兜着，声明侧在这里；两侧一起复活也要有一边红').not.toContain('atkBase')
  })

  it('武器↔moveset 一对一：共用一张架式表 = 两把武器永远同价', () => {
    const owners = new Map<string, string>()
    for (const w of weaponsRaw) {
      const prev = owners.get(w.movesetId)
      expect(prev, `${w.id} 与 ${prev} 共用 ${w.movesetId} ⇒ 定价没法分开`).toBeUndefined()
      owners.set(w.movesetId, w.id)
    }
    expect(owners.size, '空集不自证').toBe(weaponsRaw.length)
  })

  it('每把武器的第一记轻击在帧表里真的有底数（删 atkBase 后价格的唯一住处）', () => {
    for (const w of weaponsRaw) {
      const l1 = registry.get<MovesetData>(`moveset:${w.movesetId}`).actions['l1']
      expect(l1.damage, `${w.id} 的 ${w.movesetId}/l1 没有 damage ⇒ 玩家出手为 0`).toBeGreaterThan(0)
    }
  })
})
