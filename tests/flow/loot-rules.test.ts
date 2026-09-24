import { describe, expect, it } from 'vitest'
import { registerGameData } from '@/data'
import { registry } from '@/core/Registry'
import { itemOf, rollAffixes } from '@/rpg/Inventory'
import { RpgRuntime } from '@/rpg/Runtime'
import { allGearItems } from '@/rpg/Loot'
import type { ProgressionData, RegionData } from '@/data/schema'

/**
 * KI-030①②：区域上修（§9.4）与丰谐幸运（§6.2）——掉落细则第一次有「歪权重」这根杠杆。
 *
 * 量具选 `loot_chest_t2`：一条必中的 gear roll（无 chance 无逐条保底），band 是
 * uncommon 40 / rare 40 / rareplus 20。上修只抬高段的权重 ⇒ **低段的归一化占比单调下降**，
 * 而同一个 `weighted` 每 roll 恰好消耗一个 draw（`Rng` 的实现如此），两条腿的 RNG 轨道
 * 逐 roll 对齐 ⇒ 同种子下「B 的 ≥地板 集合 ⊇ A 的」是**逐点成立**的确定性命题，
 * 不需要统计容差——这是本文件敢写死断言的全部理由。
 */

registerGameData()

const T2 = 'loot_chest_t2'
const progData = (): ProgressionData => registry.get<ProgressionData>('progression')
const floorIdx = (): number => progData().rarity.map((r) => r.id).indexOf(progData().pity.floorRarity)

interface GearRow { itemId: string; rarity: string; pity: boolean }

function farmGear(seed: number, n: number, before: (r: RpgRuntime) => void = () => {}): { rpg: RpgRuntime; seq: GearRow[] } {
  const rpg = new RpgRuntime('origin_tuner', seed)
  before(rpg)
  const seq: GearRow[] = []
  for (let i = 0; i < n; i++) {
    for (const g of rpg.loot.grant(T2)) {
      if (g.type !== 'gear') continue
      const itemId = rpg.inv.gearByUid(g.id)?.itemId ?? '?'
      seq.push({ itemId, rarity: itemOf(itemId).gear?.rarity ?? '?', pity: g.pity === true })
    }
  }
  return { rpg, seq }
}

const rIdx = (id: string): number => progData().rarity.findIndex((r) => r.id === id)
const isHi = (s: GearRow): boolean => rIdx(s.rarity) >= floorIdx()
const hiCount = (seq: GearRow[]): number => seq.filter(isHi).length
const hiSet = (seq: GearRow[]): number[] => seq.map((s, i) => i).filter((i) => isHi(seq[i]))

describe('KI-030① 区域上修：深窖的权重真的歪了，别的区域一格都不歪', () => {
  it('同种子 A/B：深窖腿的 ≥地板 集合逐点包含平原腿，且涨幅被 band 数学卡住', () => {
    const a = farmGear(2024, 200)
    const b = farmGear(2024, 200, (r) => r.loot.setRegion('rg_earless_deeps'))
    expect(a.seq.length).toBe(200)
    expect(b.seq.length).toBe(200)
    const sa = new Set(hiSet(a.seq))
    for (const i of sa) expect(hiSet(b.seq).includes(i), `roll ${i}：上修只能抬不能压，A 的高段必须也是 B 的高段`).toBe(true)
    expect(hiCount(b.seq), '1.5× 在无保底位上必然多出高段').toBeGreaterThan(hiCount(a.seq))
    // 上界：非保底位最多全变高段。每 10 件一个保底（两腿同位），200 件里 ≥ 地板 不可能超过 200
    expect(hiCount(b.seq)).toBeLessThan(200)
  })

  it('负对照：没写 loot 字段的区域与无区域逐件相等——上修不是全局氛围', () => {
    const none = farmGear(777, 120)
    const other = farmGear(777, 120, (r) => r.loot.setRegion('rg_whisperwode'))
    expect(other.seq).toEqual(none.seq)
  })

  it('改表法：mul 1.5→3 高段再涨一截；atOrAbove→epic（band 里没有的档）回落成无修——门槛真跟着表走', () => {
    const row = registry.get<RegionData>('rg_earless_deeps').loot!.rarityBoost!
    const { mul, atOrAbove } = row
    try {
      const base = farmGear(31, 150)
      row.mul = 3
      const strong = farmGear(31, 150, (r) => r.loot.setRegion('rg_earless_deeps'))
      expect(hiCount(strong.seq), '×3 必须严格盖过 ×1.5').toBeGreaterThan(hiCount(base.seq))
      const sa = new Set(hiSet(base.seq))
      for (const i of sa) expect(hiSet(strong.seq).includes(i), '×3 只能抬不能压').toBe(true)
      row.atOrAbove = 'epic' // t2 的 band 够不到 epic ⇒ 门槛以上无档可歪
      const outOfBand = farmGear(31, 150, (r) => r.loot.setRegion('rg_earless_deeps'))
      expect(hiCount(outOfBand.seq), '门槛落在 band 外 ⇒ 权重乘了个寂寞，逐点回到无修').toBe(hiCount(base.seq))
      expect(outOfBand.seq.map((s) => s.rarity)).toEqual(base.seq.map((s) => s.rarity))
    } finally {
      row.mul = mul
      row.atOrAbove = atOrAbove
    }
    const restored = new Set(hiSet(farmGear(31, 60, (r) => r.loot.setRegion('rg_earless_deeps')).seq))
    for (const i of hiSet(farmGear(31, 60).seq)) expect(restored.has(i), '还原 mul 后深窖仍须盖过平原的每一格高段').toBe(true)
  })
})

describe('KI-030② 丰谐：幸运住在装备账上，每次掷骰现查', () => {
  it('戴上落到 sealB、面板读到 0.15、卸下归零——管线从数据到 totals 全程通', () => {
    const rpg = new RpgRuntime('origin_tuner', 5)
    expect(rpg.eq.totals(rpg.inv).lootLuck).toBe(0)
    const g = rpg.inv.addGear('seal_bountiful')
    const res = rpg.equip(g.uid)
    expect(res.ok).toBe(true)
    expect(res.slot, '署名徽只进 B 槽（slot 写在件上，Runtime 按件路由）').toBe('sealB')
    expect(rpg.eq.totals(rpg.inv).lootLuck).toBeCloseTo(0.15, 10)
    rpg.unequip('sealB')
    expect(rpg.eq.totals(rpg.inv).lootLuck).toBe(0)
  })

  it('普通音徽先占 A 槽：它挤不走丰谐，两枚同戴时幸运照记', () => {
    const rpg = new RpgRuntime('origin_tuner', 5)
    rpg.equip(rpg.inv.addGear('seal_bountiful').uid)
    const seal = rpg.inv.addGear('seal_upbeat')
    expect(rpg.equip(seal.uid).slot, 'A 槽空着 ⇒ 普通徽落 A，不顶 B').toBe('sealA')
    expect(rpg.eq.totals(rpg.inv).lootLuck).toBeCloseTo(0.15, 10)
  })

  it('同种子 A/B + 中途卸下：戴时逐点占优，卸下后稀有度序列与对照腿逐格相等——现查不快照，且不追吃随机数', () => {
    const a = farmGear(88, 160)
    const rpg = new RpgRuntime('origin_tuner', 88)
    rpg.equip(rpg.inv.addGear('seal_bountiful').uid)
    const bSeq: GearRow[] = []
    const farm = (n: number) => {
      for (let i = 0; i < n; i++) {
        for (const g of rpg.loot.grant(T2)) {
          if (g.type !== 'gear') continue
          const itemId = rpg.inv.gearByUid(g.id)?.itemId ?? '?'
          bSeq.push({ itemId, rarity: itemOf(itemId).gear?.rarity ?? '?', pity: g.pity === true })
        }
      }
    }
    farm(80)
    rpg.unequip('sealB')
    farm(80)
    const setB1 = new Set(hiSet(bSeq.slice(0, 80)))
    for (const i of hiSet(a.seq.slice(0, 80))) expect(setB1.has(i), `roll ${i}：A 的高段必须也是 B 的高段`).toBe(true)
    expect(hiCount(bSeq.slice(0, 80)), '1.15× 在 80 件里必然落进 [40/115, 40/100) 的带').toBeGreaterThan(hiCount(a.seq.slice(0, 80)))
    // 80 件后卸下：此后两腿权重完全相同、每 roll 的随机数消耗与结果无关 ⇒ 轨道同点
    expect(bSeq.slice(80).map((s) => s.rarity), '卸下之后的每一格都和没戴过一样——幸运不给自己加戏也不改线')
      .toEqual(a.seq.slice(80).map((s) => s.rarity))
  })

  it('泄漏守卫：全注册表逐件掷词缀，lootLuck 只可能落在 slot=sealB 的件上', () => {
    const luckAffixes = progData().affixes.prefix.filter((a) => a.stat === 'lootLuck').map((a) => a.id)
    expect(luckAffixes, '目前幸运词缀就该只有丰谐一枚').toEqual(['af_bountiful'])
    for (const it of allGearItems()) {
      if (it.gear?.slot === 'sealB') continue
      for (let t = 0; t < 60; t++) {
        const rolled = rollAffixes(it)
        expect(rolled.some((r) => luckAffixes.includes(r.id)), `${it.id} 掷出了幸运词缀 ⇒ slots 过滤漏了`).toBe(false)
      }
    }
  })

  it('数据对账：署名徽与丰谐的字段就是裁决本身（定值区间 + 只住 sealB + 表里那句话说 +15%）', () => {
    const seal = itemOf('seal_bountiful')
    expect(seal.gear?.slot).toBe('sealB')
    expect(seal.gear?.rarity).toBe('rare')
    expect(seal.gear?.affixes).toEqual(['af_bountiful'])
    const af = progData().affixes.prefix.find((a) => a.id === 'af_bountiful')!
    expect(af.stat).toBe('lootLuck')
    expect(af.range).toEqual([0.15, 0.15])
    expect(af.slots).toEqual(['sealB'])
    expect(af.desc).toContain('15%')
  })
})
