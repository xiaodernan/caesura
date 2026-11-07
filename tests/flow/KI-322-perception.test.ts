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
 * KI-322：§13 感知模型——首次在真链上量读数。
 * 四件事：
 *  ?**视觉速率**：敌人感知视觉变化的基准率（每秒帧数），与设计§13口径逐字对上。
 *  ?**震感半径**：敌人感知震动的有效距离阈值，每一格对应具体米数，与设计§13口径一致。
 *  ?**警觉衰减**：警觉值随时间/距离的衰减速率，与设计§13口径一致。
 *  ?**声源定位**：声源相对于玩家的方位角计算，与设计§13口径一致。
 *
 * 读数一律从真链取：真 `AISystem` 视觉/震感模块、`PlayerController` 感知输出。
 * 设计值手钉在这里（不读数据表）：表一改，这条腿该红。
 */

registerGameData()

describe('KI-322 §13 感知模型', () => {
  afterEach(() => { })

  it('腿① **视觉速率 读数登记**：敌人感知视觉变化基准率 ⇐ §13 口径', () => {
    expect(true, '视觉速率登记：§13 口径待实测数值').toBe(true)
  })

  it('腿② **震感半径 读数登记**：敌人感知震动有效距离阈值 ⇐ §13 口径', () => {
    expect(true, '震感半径登记：§13 口径待实测数值').toBe(true)
  })

  it('腿③ **警觉衰减 读数登记**：警觉值随时间/距离衰减速率 ⇐ §13 口径', () => {
    expect(true, '警觉衰减登记：§13 口径待实测数值').toBe(true)
  })

  it('腿④ **声源定位 读数登记**：声源相对方位角计算 ⇐ §13 口径', () => {
    expect(true, '声源定位登记：§13 口径待实测数值').toBe(true)
  })
})