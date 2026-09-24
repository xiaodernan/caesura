import { describe, expect, it } from 'vitest'
import { registerGameData } from '@/data'
import { registry } from '@/core/Registry'
import { originOf, ATTR_KEYS } from '@/rpg/Progression'
import { RpgRuntime } from '@/rpg/Runtime'
import { allGearItems } from '@/rpg/Loot'
import { titleCards } from '@/ui/TitleScreen'
import type { ProgressionData } from '@/data/schema'

/**
 * KI-031②「定弦」的两条腿：`RpgRuntime.restring`（成长层的换弦原语）与 `titleCards()`
 * （标题屏的纯数据侧车——卡面全部现读表，DOM 类本身不进 headless 测试）。
 *
 * restring 的守卫是设计承诺本身：定弦只发生在开演之前。攒了进度还想换出身，
 * 那是洗点（§8.3），代价与玩法都另有主人——这里要的是**拒绝**，不是静默覆盖。
 */

registerGameData()

const gearIdsOf = (rpg: RpgRuntime): string[] =>
  rpg.inv.gears.map((g) => g.itemId).sort()

function freshRpg(): RpgRuntime {
  return new RpgRuntime('origin_tuner', 4242)
}

describe('restring：换弦换的是底、装与手里那把（不是叠一份）', () => {
  it('tuner→drummer：originId/六维/武器/装备件全部翻面，种子原样保留', () => {
    const rpg = freshRpg()
    const seedBefore = rpg.inv.rng.state().seed
    rpg.restring('origin_drummer')
    const want = originOf('origin_drummer')
    expect(rpg.prog.originId).toBe('origin_drummer')
    for (const k of ATTR_KEYS) expect(rpg.prog.attrs[k], `六维按新出身的底（${k}）`).toBe(want.attrs[k])
    expect(rpg.mods().weaponId, '手里那把跟着出身武器翻面').toBe(want.weaponId)
    const wantItems = [...(want.gearIds ?? []), gearWithWeapon(want.weaponId)].sort()
    expect(gearIdsOf(rpg), '背包里就是新出身那一套').toEqual(wantItems)
    expect(rpg.inv.rng.state().seed, '掉落 RNG 的归属不换弦——种子是这一局的，不是出身的').toBe(seedBefore)
  })

  it('旧出身的件被摘干净：uid 集合前后不相交（证明"摘"这条腿真的在走）', () => {
    const rpg = freshRpg()
    const oldUids = new Set(rpg.inv.gears.map((g) => g.uid))
    rpg.restring('origin_player')
    for (const g of rpg.inv.gears) expect(oldUids.has(g.uid), `旧件 ${g.itemId} 的实例还赖在包里`).toBe(false)
    // 槽位指向的必须都是新实例
    for (const uid of Object.values(rpg.eq.slots)) expect(rpg.inv.gearByUid(uid!), '槽位悬空（指向已摘掉的旧件）').toBeTruthy()
  })

  it('换过去再换回来：件与六维和全新定弦同型（restring 是幂等的换弦，不是有损迁移）', () => {
    const a = freshRpg()
    a.restring('origin_choir')
    a.restring('origin_tuner')
    const b = freshRpg()
    expect(gearIdsOf(a)).toEqual(gearIdsOf(b))
    expect(a.mods()).toEqual(b.mods())
  })

  it('守卫：攒了进度就拒（rank2 或已有遗响都不许再定弦），未知出身按 originOf 的措辞炸', () => {
    const rpg = freshRpg()
    rpg.prog.rank = 2
    expect(() => rpg.restring('origin_drummer')).toThrow(/开演之前/)
    rpg.prog.rank = 1
    rpg.prog.xp = 5
    expect(() => rpg.restring('origin_drummer')).toThrow(/遗响 5/)
    const clean = freshRpg()
    expect(() => clean.restring('origin_nobody')).toThrow('Progression: unknown origin "origin_nobody"')
  })
})

describe('titleCards：卡面就是表（§55——改表立刻反映到脸上）', () => {
  it('数量/顺序/内容全从 progression.json 现读，武器名从 weapons.json 现读', () => {
    const d = registry.get<ProgressionData>('progression')
    const cards = titleCards()
    expect(cards.map((c) => c.id), '表序即卡序').toEqual(d.origins.map((o) => o.id))
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i], o = d.origins[i]
      expect(c.name).toBe(o.displayName)
      expect(c.blurb).toBe(o.blurb)
      expect(c.weaponName, '武器名住在装备件上（weapons.json 没有中文名——件才是持有的东西）')
        .toBe(allGearItems().find((it) => it.gear?.weaponId === o.weaponId)!.displayName)
      expect(c.attrs.map((a) => a.value), '六维逐格对上').toEqual(ATTR_KEYS.map((k) => o.attrs[k]))
      expect(c.attrs.map((a) => a.label), 'label 也来自 attrs 表').toEqual(d.attrs.map((a) => a.displayName))
    }
  })

  it('改表法：出身 displayName 现场改名立刻上脸，还原后分毫不差', () => {
    const d = registry.get<ProgressionData>('progression')
    const row = d.origins.find((o) => o.id === 'origin_scavenger')!
    const backup = row.displayName
    row.displayName = '临时试验名'
    expect(titleCards().find((c) => c.id === 'origin_scavenger')!.name).toBe('临时试验名')
    row.displayName = backup
    expect(titleCards().find((c) => c.id === 'origin_scavenger')!.name).toBe(backup)
  })
})

/** 出身武器对应的装备件 id（与 RpgRuntime 构造里同一条查找——侧车用它是为了不在测试里抄第二份 gearIds） */
function gearWithWeapon(weaponId: string): string {
  return allGearItems().find((it) => it.gear?.weaponId === weaponId)!.id
}
