import { describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovementConfig, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { RpgRuntime } from '@/rpg/Runtime'
import { Equipment } from '@/rpg/Equipment'
import { Inventory, type GearInstance } from '@/rpg/Inventory'

/**
 * KI-029 结案：律色词缀「战技伤害 +4~10%」（progression.md §6 那一行第一次进表）。
 *
 * 悬了两个月的裁决「乘在哪一段」落定：**乘在 activeHitbox 的技能那一支**——
 * 战技伤害离开出手层之前吃 `(1 + skillDmg)`。理由：那是技能底数进入伤害管线的**唯一**出口
 * （近战走 f.damage、回声重演带旧账、tacet 在 strikeEnemy 另乘），一条通道一个主人；
 * 面板显示等级底数不含本乘数（已登记在 KNOWN_ISSUES，等面板批次一起改）。
 */

registerGameData()

const move = (id: string) => registry.get<MovementConfig>('movements').movements.find((m) => m.id === id)!

function makeWorld(rank = 7) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime('origin_tuner')
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(weapon.movesetId))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  void combat
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input

  for (let i = 0; i < 40 && rpg.prog.rank < rank; i++) rpg.prog.addResonance(300)

  /** 点亮页 → 开槽 → 装上 → 灌给玩家（与 main.ts 的 refreshRpg 同口径）；返回动作名 */
  function equipMove(movementId: string, slot: number): string {
    const book = rpg.moves
    const mv = move(movementId)
    const page = book.page(mv.page)!
    if (!book.isLit(page.id)) {
      rpg.inv.add(page.unlock.item, page.unlock.count)
      expect(book.unlockPage(page.id, rpg.inv).ok).toBe(true)
    }
    expect(book.equip(slot, movementId, rpg.prog.rank).ok, `装上 ${movementId}`).toBe(true)
    player.applyRpg(rpg.mods())
    player.setSkills(rpg.skillLoadout())
    return book.cfg.slots[slot].action
  }
  return { time, rhythm, player, rpg, frame, input, equipMove }
}

describe('律色词缀（KI-029：战技伤害 +4~10%）', () => {
  it('装备链：挂 af_timbral 的武器件 → eq.totals().skillDmg → mods().skillDmg', () => {
    const eq = new Equipment()
    const inv = new Inventory('timbral')
    const gear: GearInstance = { uid: 'g-timbral', itemId: 'wp_tuning_sword_item', level: 0, affixes: [{ id: 'af_timbral', value: 0.07 }] }
    inv.gears.push(gear)
    const slot = eq.equip(inv, 'g-timbral')
    expect(slot, '武器件落到武器槽').toBe('weapon')
    expect(eq.totals(inv).skillDmg, '词缀加数原样进汇总').toBe(0.07)
  })

  it('消费腿：skillDmg 0.07 时和弦爆的出手底数 = round(26 × 1.07) = 28；无词缀时底数原样', () => {
    const w = makeWorld(7)
    const action = w.equipMove('mv_chordburst', 0)
    expect(action).toBe('weaponSkill')
    const skill = w.player.skills['weaponSkill']
    expect(skill?.cast.damage, '和弦爆 L1 底伤 26').toBe(26)

    /** 出手后等判定窗开（activeStart），返回窗口内的出手底数 */
    const castAndRead = (): number | undefined => {
      w.player.stats.overdrive = skill.cast.overdriveCost
      expect(w.player.tryStartAction('weaponSkill', w.time.tick), '过载付得起就该出式').toBe(true)
      let dmg: number | undefined
      for (let i = 0; i < 60 && w.player.action; i++) {
        w.time.tick++
        w.player.update(TICK_DT, w.time, w.input, w.time.tick, w.rhythm)
        const hb = w.player.activeHitbox
        if (hb !== null && dmg === undefined) dmg = hb.damage
        w.rhythm.update(TICK_DT)
      }
      return dmg
    }
    expect(castAndRead(), '无律色时底数原样（cast.damage 原样出窗）').toBe(26)

    // 等冷却走完（chordburst 300 tick）再挂词缀出第二式
    for (let i = 0; i < 400 && w.player.skillCooldown('weaponSkill') > 0; i++) { w.time.tick++; w.player.update(TICK_DT, w.time, w.input, w.time.tick, w.rhythm); w.rhythm.update(TICK_DT) }
    // 挂上律色 +7%：底数 = round(26 × 1.07) = 28
    w.player.applyRpg({ ...w.rpg.mods(), skillDmg: 0.07 })
    w.player.setSkills(w.rpg.skillLoadout())
    expect(castAndRead(), 'round(26 × 1.07) = 28（律色乘在出手层）').toBe(28)
  })

  it('数据腿：af_timbral 存在、带 [0.04,0.10] 区间、只落武器/音徽（设计文档 §6 那一行的机器形状）', () => {
    const p = registry.get<{ affixes: { prefix: Array<{ id: string; range?: [number, number]; slots?: string[] }> } }>('progression')
    const aff = p.affixes.prefix.find((a) => a.id === 'af_timbral')
    expect(aff, '律色在前缀池里').toBeTruthy()
    expect(aff!.range).toEqual([0.04, 0.10])
    expect(aff!.slots).toEqual(['weapon', 'seal'])
  })
})


