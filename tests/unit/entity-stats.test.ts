import { describe, expect, it } from 'vitest'
import { EntityStats, playerStatsFrom } from '@/combat/EntityStats'
import type { PlayerBaseData } from '@/data/schema'

/**
 * `src/combat/EntityStats.ts`：共享 stat block（GAS-lite，technical-architecture §1.2）。
 *
 * 覆盖最核心的战斗机制：
 * - 体力：spendStamina（门槛语义）vs drain（持续消耗，扣到 0 为止）
 * - 架势：addPoise 累积 ⇒ 破势（需 armCrumple 上弦）
 * - 失谐：addFissure 叠层 ⇒ 满层返回 true
 * - 伤害/治疗 clamp
 */

const armed = (): EntityStats => {
  const s = new EntityStats(100, 100, 50)
  s.crumpleTicks = 108 // §8 R4 破势时长（1.8s * 60）
  s.fissureRules = { maxLayers: 5, idleTicks: 600, decayEveryTicks: 120 }
  return s
}

describe('EntityStats：构造与初始化', () => {
  it('hp/hpMax/stamina/staMax/poisMax 初始化；死=false；regen 默认三段', () => {
    const s = new EntityStats(80, 60, 30)
    expect(s.hp).toBe(80)
    expect(s.hpMax).toBe(80)
    expect(s.stamina).toBe(60)
    expect(s.staMax).toBe(60)
    expect(s.poiseMax).toBe(30)
    expect(s.dead).toBe(false)
    expect(s.regen.hardDelay).toBe(30)
    expect(s.regen.slowPerSec).toBe(22)
    expect(s.regen.fastPerSec).toBe(38)
  })

  it('playerStatsFrom：从 PlayerBaseData 派生', () => {
    const base = { hp: 120, stamina: 40, poise: 50, staminaRegen: { hardDelay: 10, slowPerSec: 10, slowTicks: 30, fastPerSec: 20 } } as PlayerBaseData
    const s = playerStatsFrom(base)
    expect(s.hp).toBe(120)
    expect(s.stamina).toBe(40)
    expect(s.poiseMax).toBe(50)
    expect(s.regen.hardDelay).toBe(10)
  })
})

describe('EntityStats：体力的两个入口', () => {
  it('spendStamina：够 ⇒ 扣减并 true；不够 ⇒ false 且不扣', () => {
    const s = new EntityStats(100, 10, 50)
    expect(s.spendStamina(4, 0)).toBe(true)
    expect(s.stamina).toBe(6)
    expect(s.spendStamina(7, 0)).toBe(false)
    expect(s.stamina).toBe(6)
  })

  it('spendStamina：mods.staCostMul 乘在扣减上（0.5 倍 ⇒ 扣一半）', () => {
    const s = new EntityStats(100, 10, 50)
    s.mods.staCostMul = 0.5
    expect(s.spendStamina(4, 0)).toBe(true)
    expect(s.stamina).toBe(8)
  })

  it('drain：不够也照扣到 0（不是拒绝语义）', () => {
    const s = new EntityStats(100, 10, 50)
    s.drain(15, 0)
    expect(s.stamina).toBe(0)
  })
})

describe('EntityStats：架势 addPoise 与破势', () => {
  it('未上弦 ⇒ 累积满 poiseMax 时抛错（不是静默免疫）', () => {
    const s = new EntityStats(100, 100, 10) // 未 armCrumple
    expect(() => s.addPoise(10, 0)).toThrow()
  })

  it('上弦后累积满 ⇒ 破势（返回 true，crumpleTicksLeft = 上弦值），且架势归零', () => {
    const s = armed()
    expect(s.addPoise(10, 0)).toBe(false)
    expect(s.poiseAccum).toBe(10)
    expect(s.addPoise(40, 1)).toBe(true) // 50 ≥ 50
    expect(s.crumpleTicksLeft).toBe(108)
    expect(s.poiseAccum).toBe(0)
    expect(s.addPoise(100, 2)).toBe(false) // 破势中不再叠（crumpleTicksLeft>0）
  })
})

describe('EntityStats：damage / heal', () => {
  it('damage 减少 hp，夹到 0；hp 到 0 置 dead', () => {
    const s = new EntityStats(100, 100, 50)
    s.damage(30)
    expect(s.hp).toBe(70)
    s.damage(1000)
    expect(s.hp).toBe(0)
    expect(s.dead).toBe(true)
  })

  it('heal 回血，夹到 hpMax', () => {
    const s = new EntityStats(100, 100, 50)
    s.damage(50)
    s.heal(30)
    expect(s.hp).toBe(80)
    s.heal(1000)
    expect(s.hp).toBe(100)
  })
})

describe('EntityStats：震裂 addFissure', () => {
  it('未 arm ⇒ 抛错（不是静默免疫）', () => {
    const s = new EntityStats(100, 100, 50)
    expect(() => s.addFissure(1)).toThrow()
  })

  it('叠层到 maxLayers ⇒ 返回 true，且层数清空', () => {
    const s = armed()
    expect(s.addFissure(1)).toBe(false) // 1
    expect(s.fissureLayers).toBe(1)
    expect(s.addFissure(2)).toBe(false) // 3
    expect(s.fissureLayers).toBe(3)
    expect(s.addFissure(2)).toBe(true) // 5 ⇒ 碎裂
    expect(s.fissureLayers).toBe(0)
  })

  it('layers <= 0 ⇒ false 且不动', () => {
    const s = armed()
    expect(s.addFissure(0)).toBe(false)
    expect(s.fissureLayers).toBe(0)
  })
})

describe('EntityStats：update 的回复曲线', () => {
  it('hardDelay 内不回复（rate = 0）', () => {
    const s = new EntityStats(100, 10, 50)
    s.spendStamina(5, 0) // stamina = 5, lastCostTick = 0
    s.update(1, 10, false) // since = 10 < hardDelay(30) ⇒ 不回复
    expect(s.stamina).toBe(5)
  })

  it('guarding 时回复速率被压到 5/s 以下', () => {
    const s = new EntityStats(100, 50, 50)
    s.spendStamina(40, 0) // stamina = 10, lastCostTick = 0
    s.update(1, 200, true) // since = 200 > slowTicks ⇒ fast 38 → guarding 压到 5
    expect(s.stamina).toBe(15)
  })
})
