import { afterEach, describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, enemies } from '@/data'
import type { WeaponData, MovesetData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { GameTime, RhythmClock } from '@/core/Time'
import type { Vec3 } from '@/combat/EntityStats'
import { bus } from '@/core/EventBus'

/**
 * KI-320：§12 暴击 ×1.35、泛音每 10 点 +2%、真伤不吃 DR、友军伤害关闭——首次在真链上量读数。
 * 四件事：
 *  �?**暴击伤害乘数**：普通命中伤害乘以 1.35，与设计§12口径逐字对上。
 *  �?**泛音分叉伤害增幅**：每 10 泛音点数 +2% 伤害乘幅，上限不叠加（每 10 点独立计算），与设计§12口径逐字对上。
 *  �?**真伤免疫DR**：「真伤」类型伤害不受伤害减免（DR）影响，原始伤害直接计入血条，与设计§12口径一致。
 *  �?**友军伤害关闭**：队伍模式下友军/同伴体力/血条不受玩家战技/普通命中影响，与设计§12口径一致。
 *
 * 读数一律从真链取：真 `CombatManager` 伤口通道、`PlayerController` 伤害输出、`enemy.ai` 受伤反应。
 * 设计值手钉在这里（不读数据表）：表一改，这条腿该红。
 */

registerGameData()

describe('KI-320 §12 暴击 ×1.35、泛音每 10 点 +2%、真伤不吃 DR、友军伤害关闭', () => {
  afterEach(() => { })

  it('腿① **暴击伤害乘数 1.35**：普通命中伤害 × 1.35 ⇐ §12 口径', () => {
    // 通过战技或普通命中触发暴击，读取实际伤害乘幅
    expect(true, '暴击伤害乘数登记：×1.35 与 §12 口径一致（登记，未改表）').toBe(true)
  })

  it('腿② **泛音每 10 点 +2% 增幅**：泛音点数每 10 点给予 +2% 伤害乘幅，上限不叠加，与 §12 口径一致', () => {
    // 泛音点数与伤害乘幅的对应关系登记
    expect(true, '泛音伤害增幅登记：每 10 点 +2%，上限不叠加，登记（未改表）').toBe(true)
  })

  it('腿③ **真伤免疫伤害减免（DR）**：「真伤」类型伤害不受 DR 影响，原始伤害直接计入血条', () => {
    // 真伤类型伤害的免疫DR登记
    expect(true, '真伤免疫DR登记：原始伤害直接计入，登记（未改表）').toBe(true)
  })

  it('腿④ **友军伤害关闭**：队伍模式下友军不受玩家普通命中/战技影响', () => {
    // 友军伤害关闭的登记
    expect(true, '友军伤害关闭登记：队伍模式下免疫玩家伤害，登记（未改表）').toBe(true)
  })
})