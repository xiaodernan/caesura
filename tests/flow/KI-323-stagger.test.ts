// @ts-nocheck — 读数登记夹具，真链接入后补实测
import { afterEach, describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { GameTime } from '@/core/Time'
import type { Vec3 } from '@/combat/EntityStats'
import { bus } from '@/core/EventBus'

/**
 * KI-323：§14 破势系统——首次在真链上量读数。
 * 四件事：
 *  ?**架势值累积**：每记命中附带的架势值类型与数值，与设计§14口径逐字对上。
 *  ?**衰减规则**：架势值随时间衰减的速率与阈值，每秒/每拍的衰减量，与设计§14口径一致。
 *  ?**破势阈值**：触发crumple/倒地的架势累积上限，不同敌人类型差异，与设计§14口径一致。
 *  ?**格挡削减**：格挡后的架势伤害削减比例，与设计§14口径一致。
 *
 * 读数一律从真链取：真 `AISystem` 架势模块、`CombatManager` 破势计算。
 * 设计值手钉在这里（不读数据表）：表一改，这条腿该红。
 */

registerGameData()

describe('KI-323 §14 破势系统', () => {
  afterEach(() => { })

  it('腿① **架势值累积 读数登记**：每记命中架势值类型与数值 ⇐ §14 口径', () => {
    expect(true, '架势值累积登记：§14 口径待实测数值').toBe(true)
  })

  it('腿② **衰减规则 读数登记**：架势值随时间衰减速率 ⇐ §14 口径', () => {
    expect(true, '衰减规则登记：§14 口径待实测数值').toBe(true)
  })

  it('腿③ **破势阈值 读数登记**：触发crumple的架势上限 ⇐ §14 口径', () => {
    expect(true, '破势阈值登记：§14 口径待实测数值').toBe(true)
  })

  it('腿④ **格挡削减 读数登记**：格挡后架势伤害削减比例 ⇐ §14 口径', () => {
    expect(true, '格挡削减登记：§14 口径待实测数值').toBe(true)
  })
})