import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { registerGameData, progression, items } from '@/data'
import type { ItemData, MovesetData, ProgressionData, WeaponData } from '@/data/schema'
import { Progression, ATTR_KEYS, originOf, originTotal, progressionData } from '@/rpg/Progression'
import { Inventory, itemOf, rollAffixes } from '@/rpg/Inventory'
import { Equipment, SLOTS, equipSeal } from '@/rpg/Equipment'
import { upgradeStep, weaponDamageMul, armorDefMul, maxLevelOf, tryUpgrade, salvageValue } from '@/rpg/Upgrade'
import { LootDirector, allGearItems } from '@/rpg/Loot'
import { RpgRuntime, gearName } from '@/rpg/Runtime'
import { refreshPlayer, type ModsSink } from '@/rpg/Settlement'
import { Rng } from '@/core/Math'

/**
 * 成长系统（Phase 5-B / progression.md）。
 * 这里钉住的都是**设计承诺**：升级反馈、软上限不断崖、强化不赌博、保底不被小怪刷穿、
 * 词缀必须真有一条消费链。数值本身来自 data/json/progression.json，测试不复制一份。
 */

registerGameData()

const prog = (): ProgressionData => progressionData()

describe('音级与遗响（§2.3/§8）', () => {
  it('等级曲线单调递增，且与 progression.md 的前十个锚点一致', () => {
    const c = prog().rankCurve
    for (let i = 1; i < c.length; i++) expect(c[i].xp, `rank ${c[i].rank}`).toBeGreaterThan(c[i - 1].xp)
    // progression.md §2.3 表：2 级 60 / 3 级 75 / 4 级 94 / 5 级 118 / 10 级 361
    expect(c.find((r) => r.rank === 2)!.xp).toBe(60)
    expect(c.find((r) => r.rank === 3)!.xp).toBe(75)
    expect(c.find((r) => r.rank === 4)!.xp).toBe(94)
    expect(c.find((r) => r.rank === 5)!.xp).toBe(118)
    expect(c.find((r) => r.rank === 10)!.xp).toBe(361)
    expect(c[c.length - 1].rank).toBe(prog().maxRank)
  })

  it('一次大额遗响能连升多级，余量结转（Boss 首杀 400 不能被吞掉）', () => {
    const p = new Progression('origin_tuner')
    const g = p.addResonance(400)
    // 60+75+94+118 = 347 ≤ 400 < 347+148 ⇒ 升到 5 级，余 53
    expect(g.ranks).toEqual([2, 3, 4, 5])
    expect(p.rank).toBe(5)
    expect(p.xp).toBe(53)
    expect(p.unspent).toBe(4)
  })

  it('每级 +1 音级点；分配扣点，洗点退点并把花费算在数据表上', () => {
    const p = new Progression('origin_tuner')
    p.addResonance(400)
    expect(p.allocate('str')).toBe(true)
    expect(p.attrs.str).toBe(originOf('origin_tuner').attrs.str + 1)
    expect(p.unspent).toBe(3)
    const cost = p.respecCost()
    expect(cost).toBeGreaterThan(0)
    const refunded = p.respec()
    expect(refunded).toBe(1)
    expect(p.attrs.str).toBe(originOf('origin_tuner').attrs.str)
    expect(p.unspent).toBe(4)
    expect(p.respecCount).toBe(1)
    // 前 3 次 8 折：第二次洗点的价应该低于第一次的报价
    expect(p.respecCost()).toBeLessThanOrEqual(cost)
  })

  it('五出身六维合计一致（定弦只改分布，不改总量，§2.2）', () => {
    const totals = prog().origins.map((o) => originTotal(o))
    expect(new Set(totals).size).toBe(1)
    for (const o of prog().origins) expect(registry.has(o.weaponId)).toBe(true)
  })

  it('软上限是收益递减而不是断崖：第 41 点只有半点，硬上限后只有四分之一点', () => {
    const p = new Progression('origin_tuner')
    const soft = p.effectiveAttr('str', 40)
    const one = p.effectiveAttr('str', 41) - soft
    expect(one).toBeCloseTo(prog().softcap.mul, 5)
    const hard = p.effectiveAttr('str', 60)
    const beyond = p.effectiveAttr('str', 61) - hard
    expect(beyond).toBeCloseTo(prog().softcap.hardMul, 5)
  })

  it('派生值随等级与属性一起动，且升级带来的 HP 增长 ≥3%（§8.1 数值层反馈）', () => {
    const p = new Progression('origin_tuner')
    const before = p.derive(0)
    p.addResonance(prog().rankCurve[0].xp)
    const after = p.derive(0)
    expect(after.hpMax).toBeGreaterThan(before.hpMax)
    expect(after.hpMax / before.hpMax - 1).toBeGreaterThanOrEqual(0.03)
    // 腔体是最直接的 HP 来源；音色给过载上限（§2.4）
    expect(p.derive(0).overdriveMax).toBeGreaterThanOrEqual(prog().derived.overdrive.base)
  })
})

describe('背包与装备（§5）', () => {
  it('堆叠件受 stack 上限约束并返回实收数量；装备件每次都生成独立实例', () => {
    const inv = new Inventory(1)
    const salve = itemOf('it_echo_salve')
    expect(inv.add('it_echo_salve', salve.stack + 5)).toBe(salve.stack)
    expect(inv.count('it_echo_salve')).toBe(salve.stack)
    const a = inv.addGear('wp_tuning_sword_item')
    const b = inv.addGear('wp_tuning_sword_item')
    expect(a.uid).not.toBe(b.uid)
    expect(inv.gears.length).toBe(2)
  })

  it('稀有度决定词缀数量，且词缀池只给该部位能出的（§5.3 部位池）', () => {
    const common = itemOf('ar_mutewrap_helm')
    const rare = itemOf('ar_tracewrists')
    expect(rollAffixes(common, new Rng(7)).length).toBe(0)
    const rareAffixes = rollAffixes(rare, new Rng(7))
    expect(rareAffixes.length).toBe(2)
    for (const a of rareAffixes) {
      const def = [...prog().affixes.prefix, ...prog().affixes.suffix].find((x) => x.id === a.id)!
      if (def.slots) expect(def.slots).toContain('gloves')
    }
  })

  it('音徽件能真的掷出音徽池的词缀（词缀 slots 用的是"件"的槽位词表，不是装备实例的 A/B）', () => {
    // 这条是 validate:data 抓出来的真 bug：词缀 slots 曾写成 ['weapon','sealA','sealB']，
    // 而音徽件声明的 slot 是 'seal' ⇒ 池子永远匹配不上，音徽永远拿不到随机词缀（但测试数量上照样"有词缀"）
    const seal = itemOf('seal_darkscore')
    expect(seal.gear!.slot).toBe('seal')
    const prog2 = prog()
    const pools = [...prog2.affixes.prefix, ...prog2.affixes.suffix].filter((a) => a.slots?.includes('seal'))
    expect(pools.length, '音徽池不能是空的').toBeGreaterThan(0)
    // 抽一件没有固定词缀的稀有音徽（seal_firstbeat 固定了 af_keen，所以它只补数值）
    const rolled = rollAffixes(seal, new Rng(11))
    expect(rolled.length).toBeGreaterThan(0)
  })

  it('装备汇总：DEF/重量/词缀都进 totals，噪音乘数被夹住不会变成负数', () => {
    const inv = new Inventory(2)
    const eq = new Equipment()
    const boots = inv.addGear('ar_silent_boots') // 固定 静默（noiseMul 负值）
    eq.equip(inv, boots.uid)
    const t = eq.totals(inv)
    expect(t.weight).toBe(itemOf('ar_silent_boots').gear!.weight)
    expect(t.defense).toBeGreaterThan(0)
    expect(t.noiseMul).toBeLessThan(1)
    expect(t.noiseMul).toBeGreaterThan(0)
    // 再叠一件静默也不会把乘数推到 0 以下
    const cuirass = inv.addGear('ar_choir_hood')
    eq.equip(inv, cuirass.uid)
    expect(eq.totals(inv).noiseMul).toBeGreaterThan(0)
  })

  it('音徽进 A/B 两槽而不是覆盖第一枚（seal 槽位语义）', () => {
    const inv = new Inventory(3)
    const eq = new Equipment()
    const s1 = inv.addGear('seal_firstbeat')
    const s2 = inv.addGear('seal_darkscore')
    expect(equipSeal(eq, s1.uid)).toBe('sealA')
    expect(equipSeal(eq, s2.uid)).toBe('sealB')
    expect(eq.equipped(inv, 'sealA')!.uid).toBe(s1.uid)
    expect(eq.equipped(inv, 'sealB')!.uid).toBe(s2.uid)
  })

  it('负重超载的判据是「重量 > 上限」，上限由基音给出（§5.1）', () => {
    const inv = new Inventory(4)
    const eq = new Equipment()
    const p = new Progression('origin_tuner')
    const loadMax = p.derive(0).loadMax
    eq.equip(inv, inv.addGear('ar_mutewrap_helm').uid)
    expect(eq.isOverloaded(inv, loadMax)).toBe(false)
    // 把上限压到比身上装备还轻 ⇒ 立刻算超载（判据只有一条，不在别处再判一次）
    expect(eq.isOverloaded(inv, 0)).toBe(true)
  })

  it('背包快照往返：堆叠、装备实例、强化等级、词缀数值逐字段复原', () => {
    const inv = new Inventory(5)
    inv.add('it_timbite', 137)
    const g = inv.addGear('ar_drummer_cuirass')
    g.level = 3
    const snap = inv.snapshot()
    const back = new Inventory(5)
    back.restore(snap)
    expect(back.count('it_timbite')).toBe(137)
    expect(back.gearByUid(g.uid)!.level).toBe(3)
    expect(back.gearByUid(g.uid)!.affixes).toEqual(g.affixes)
  })
})

describe('强化（§5.4：无失败、无销毁）', () => {
  it('武器满强化的累计倍率与设计表一致（+10 ≈ +79%）', () => {
    expect(weaponDamageMul(0)).toBe(1)
    // §5.4 合计栏写「≈+79%」，那就是这张表逐格相加的取整说法（0.06×2+0.07×2+0.08×2+0.09×2+0.10×2 = 0.80）
    expect(weaponDamageMul(10)).toBeCloseTo(1.8, 6)
    expect(armorDefMul(10)).toBeCloseTo(2.06, 6)
    // 每级收益都是正的（"慢曲线"不等于"有的级不涨"）
    for (let i = 1; i <= 10; i++) expect(weaponDamageMul(i)).toBeGreaterThan(weaponDamageMul(i - 1))
  })

  it('强化上限由稀有度封顶（素声 +3 / 师传 +10）', () => {
    expect(maxLevelOf(itemOf('ar_mutewrap_helm'))).toBe(3)
    expect(maxLevelOf(itemOf('ar_tracewrists'))).toBe(7)
    expect(maxLevelOf(itemOf('seal_firstbeat'))).toBe(7)
  })

  it('材料不够时**一分不扣**；够则扣完就升级', () => {
    const inv = new Inventory(6)
    const g = inv.addGear('wp_tuning_sword_item')
    const step = upgradeStep(0)!
    inv.add('it_timbite', step.timbite - 1)
    inv.add('it_dross', step.dross)
    const poor = tryUpgrade(inv, g.uid)
    expect(poor.ok).toBe(false)
    expect(poor.reason).toBe('poor')
    expect(inv.count('it_timbite'), '失败不许扣材料').toBe(step.timbite - 1)
    expect(g.level).toBe(0)
    inv.add('it_timbite', 1)
    const ok = tryUpgrade(inv, g.uid)
    expect(ok.ok).toBe(true)
    expect(g.level).toBe(1)
    expect(inv.count('it_timbite')).toBe(0)
  })

  it('分解给残晶与音色石，且等级越高拆得越多（重复件有去处，§6.3）', () => {
    const low = salvageValue(itemOf('ar_scavenger_cuirass'), 0)
    const high = salvageValue(itemOf('ar_scavenger_cuirass'), 5)
    expect(low.dross).toBeGreaterThan(0)
    expect(high.dross).toBeGreaterThan(low.dross)
  })
})

describe('掉落（§9：种子化 + 保底）', () => {
  it('同一颗种子掷出同一串掉落（可复现 QA，§10）', () => {
    const run = (): string[] => {
      const inv = new Inventory('seed-A')
      const loot = new LootDirector(inv, new Progression('origin_tuner'))
      const out: string[] = []
      for (let i = 0; i < 20; i++) {
        for (const g of loot.grant('loot_tympanus')) {
          // uid 是全局自增的（唯一性要求），种子决定的是**掉什么**，不是它叫 g 几号
          const what = g.type === 'gear' ? inv.gearByUid(g.id)!.itemId : g.id
          out.push(`${g.type}:${what}:${g.count}`)
        }
      }
      return out
    }
    expect(run()).toEqual(run())
  })

  it('保底：连续第 10 件装备强制 ≥稀有，且计数跨表累计（刷小怪刷不出保底）', () => {
    const inv = new Inventory('pity')
    const loot = new LootDirector(inv, new Progression('origin_tuner'))
    let rareOrBetter = 0
    let gears = 0
    // loot_murkshell 的装备档只有「素声」⇒ 唯一能出稀有的途径就是保底
    for (let i = 0; i < 4000 && gears < 10; i++) {
      for (const g of loot.grant('loot_murkshell')) {
        if (g.type !== 'gear') continue
        gears++
        const item = inv.gearByUid(g.id)!
        const rarity = itemOf(item.itemId).gear!.rarity
        const idx = prog().rarity.findIndex((r) => r.id === rarity)
        if (idx >= prog().rarity.findIndex((r) => r.id === 'rare')) rareOrBetter++
        if (gears === 10) expect(g.pity, '第 10 件应当被标成保底').toBe(true)
      }
    }
    expect(gears).toBe(10)
    expect(rareOrBetter).toBeGreaterThanOrEqual(1)
  })

  it('首杀专属只给一次（§9.3 Boss 首杀唯一）', () => {
    const inv = new Inventory('first')
    const loot = new LootDirector(inv, new Progression('origin_tuner'))
    const enemy = registry.get<import('@/data/schema').EnemyData>('en_phantome')
    const first = loot.onEnemyKilled(enemy)
    const again = loot.onEnemyKilled(enemy)
    expect(first.some((g) => g.id === 'it_score_fragment')).toBe(true)
    expect(again.some((g) => g.id === 'it_score_fragment')).toBe(false)
  })

  it('掉落池只出装备件，且每张表引用的物品/装备档都真实存在（无悬空引用）', () => {
    for (const it of allGearItems()) expect(it.gear, it.id).toBeTruthy()
    const rarityIds = new Set(prog().rarity.map((r) => r.id))
    for (const it of items) {
      if (it.gear) expect(rarityIds.has(it.gear.rarity), `${it.id} rarity`).toBe(true)
    }
  })
})

describe('总装（RpgRuntime）：装备/升级/洗点/使用道具的编排', () => {
  it('出身自带装备被穿上，武器指向正确的 WeaponData', () => {
    const rt = new RpgRuntime('origin_drummer')
    const m = rt.mods()
    expect(m.weaponId).toBe('wp_fortissimo_greatsword')
    expect(m.weight).toBeGreaterThan(0)
    expect(m.hpMax).toBeGreaterThan(100)
    expect(rt.inv.gears.length).toBeGreaterThan(0)
  })

  it('换武器会改武器伤害倍率与 weaponId（强化跟着件走，不跟着槽走）', () => {
    const rt = new RpgRuntime('origin_tuner')
    const spear = rt.inv.addGear('wp_drawpin_spear_item')
    expect(rt.equip(spear.uid).ok).toBe(true)
    expect(rt.mods().weaponId).toBe('wp_drawpin_spear')
    // 强化到 +3 之后，倍率跟着那把枪走
    rt.inv.add('it_timbite', 500)
    rt.inv.add('it_dross', 50)
    for (let i = 0; i < 3; i++) expect(rt.upgrade(spear.uid).ok).toBe(true)
    expect(rt.mods().weaponDamageMul).toBeCloseTo(weaponDamageMul(3), 6)
  })

  it('洗点要花钱：钱不够不退款，钱够才退点', () => {
    const rt = new RpgRuntime('origin_tuner')
    rt.prog.addResonance(400)
    rt.prog.allocate('str')
    rt.prog.allocate('str')
    const cost = rt.prog.respecCost()
    expect(rt.respec()).toMatchObject({ ok: false, reason: 'poor' })
    rt.inv.add('it_timbite', cost)
    const res = rt.respec()
    expect(res.ok).toBe(true)
    expect(res.refunded).toBe(2)
    expect(rt.inv.count('it_timbite')).toBe(0)
  })

  it('没花过点的角色洗不出东西：钱够但不退款也不扣钱（nothing 腿）', () => {
    const rt = new RpgRuntime('origin_tuner') // 出身底子原封未动：没有已分配的点
    const cost = rt.prog.respecCost()
    rt.inv.add('it_timbite', cost) // 钱够 ⇒ 进不到 poor 腿，走的是「洗完发现没点可退」
    const before = rt.prog.unspent
    expect(rt.respec()).toMatchObject({ ok: false, refunded: 0, cost, reason: 'nothing' })
    expect(rt.inv.count('it_timbite'), '没洗成不许扣钱').toBe(cost)
    expect(rt.prog.unspent).toBe(before)
  })

  it('gearName：注册件给中文名，未知 id 原样回落（面板不显示空串）', () => {
    expect(gearName('wp_tuning_sword_item')).toBe(itemOf('wp_tuning_sword_item').displayName)
    expect(gearName('it_no_such_gear_xyz')).toBe('it_no_such_gear_xyz')
  })

  it('refreshPlayer：装备栏换了武器，手里那把必须跟着换（换装腿）', () => {
    const rt = new RpgRuntime('origin_tuner')
    const spear = rt.inv.addGear('wp_drawpin_spear_item')
    expect(rt.equip(spear.uid).ok).toBe(true)
    expect(rt.mods().weaponId).toBe('wp_drawpin_spear')
    const calls: Array<{ w: unknown; ms: unknown }> = []
    const player = {
      weapon: { id: 'wp_tuning_sword' }, // 手里还握着出身那把
      stats: { poiseDecayMul: 1 },
      applyRpg: () => {}, setSkills: () => {}, setBeatGrace: () => {}, setExecCancel: () => {},
      equip: (w: unknown, ms: unknown) => calls.push({ w, ms }),
    } as unknown as ModsSink
    refreshPlayer(rt, player)
    const wd = registry.get<WeaponData>('wp_drawpin_spear')
    expect(calls).toEqual([{ w: wd, ms: registry.get<MovesetData>(`moveset:${wd.movesetId}`) }])
  })

  it('使用消耗品会真的消耗一件（数量不会凭空虚增）', () => {
    const rt = new RpgRuntime('origin_tuner')
    expect(rt.useItem('it_echo_salve').ok).toBe(false)
    rt.inv.add('it_echo_salve', 2)
    expect(rt.useItem('it_echo_salve')).toMatchObject({ ok: true, heal: itemOf('it_echo_salve').use!.heal })
    expect(rt.inv.count('it_echo_salve')).toBe(1)
  })

  it('只写投掷用法的消耗品不能被「研读」吃掉（`use` 认三种，研读那条腿只认两种）', () => {
    /**
     * 今天表里**没有**这样的道具（`it_timbre_crystal` 同时有 `corruption` 那一条腿），所以这一格是
     * 合成的：它钉的是"schema 与验证器认下的形状，每条腿都要说得清自己吃不吃它"。KI-023① 之前
     * `use` 只认 heal/corruption，这个形状根本写不出来；认下之后 `useItem` 若照旧"先扣再算"，
     * 一颗只会被扔出去的晶石被研读一次就 `ok:true, 0, 0`——那是白吃一件。
     */
    registry.register('it_probe_throw_only', {
      id: 'it_probe_throw_only', nameKey: 'item.probe', displayName: '探针晶', kind: 'consumable',
      stack: 5, value: 0, desc: '只写 throw 的探针（不进任何表）',
      use: { throw: { speed: 11, range: 15, radius: 0.35, gravity: 14, loudness: 0.8 } },
    } as ItemData)
    const rt = new RpgRuntime('origin_tuner')
    rt.inv.add('it_probe_throw_only', 2)
    expect(rt.useItem('it_probe_throw_only'), '没有研读效果 ⇒ 不许报 ok').toMatchObject({ ok: false, heal: 0, corruption: 0 })
    expect(rt.inv.count('it_probe_throw_only'), '更不许扣掉一件').toBe(2)
  })

  it('快照往返：音级/属性/背包/装备/首杀记录一起回来', () => {
    const rt = new RpgRuntime('origin_player')
    rt.prog.addResonance(200)
    rt.inv.add('it_timbite', 42)
    const spear = rt.inv.addGear('wp_drawpin_spear_item', 2)
    rt.equip(spear.uid)
    rt.loot.onEnemyKilled(registry.get<import('@/data/schema').EnemyData>('en_phantome'))
    const timbite = rt.inv.count('it_timbite')
    const snap = rt.snapshot()

    const back = new RpgRuntime('origin_tuner') // 故意换出身：读档必须盖掉它
    back.restore(snap)
    expect(back.prog.rank).toBe(rt.prog.rank)
    expect(back.prog.attrs).toEqual(rt.prog.attrs)
    expect(back.prog.originId).toBe('origin_player')
    expect(back.inv.count('it_timbite')).toBe(timbite)
    expect(back.mods().weaponId).toBe('wp_drawpin_spear')
    expect(back.mods().weaponDamageMul).toBeCloseTo(weaponDamageMul(2), 6)
    expect(back.loot.isFirstKill('en_phantome')).toBe(false)
  })

  it('属性名与槽位表完整（漏一维就会有一个属性永远无法分配）', () => {
    expect(prog().attrs.map((a) => a.key).sort()).toEqual([...ATTR_KEYS].sort())
    for (const a of prog().attrs) {
      expect(a.softcap).toBeLessThan(a.hardcap)
      expect(a.desc.length, `${a.key} 要有世界内解释`).toBeGreaterThan(4)
    }
    expect(SLOTS).toContain('weapon')
    for (const it of items as ItemData[]) {
      // 装备件声明的槽位要么是七个实槽之一，要么是 'seal'（音徽：可入 A 或 B）
      if (it.gear) expect([...SLOTS, 'seal']).toContain(it.gear.slot)
    }
  })

  it('每个词缀都有一条真实消费链（数据里不许有"没人读的 +5%"）', () => {
    const inv = new Inventory(9)
    const eq = new Equipment()
    const prog2 = progression
    const consumable = [...prog2.affixes.prefix, ...prog2.affixes.suffix]
    expect(consumable.length).toBeGreaterThan(0)
    for (const a of consumable) expect(a.stat ?? a.behavior, `${a.id} 必须有 stat 或 behavior`).toBeTruthy()
    // 静默（noiseMul）这条链路能一路走到 totals：找一件带它的装备穿上看数值
    const boots = inv.addGear('ar_silent_boots')
    eq.equip(inv, boots.uid)
    expect(eq.totals(inv).noiseMul).not.toBe(1)
  })
})
