import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'

/**
 * 批29：ai/AISystem.ts 的 3 条死分支（cov_b27 排行）。
 * 与批22a-23 同一门禁：每条用例点名它负责的行号，.scratch/check_b29.mjs 按行验亮。
 */

registerGameData()

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>('ms_sword')
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  return { time, rhythm, player, ai }
}

describe('批29 AISystem.ts 死腿（每条用例点名它负责的行）', () => {
  it('L118 syncClock 锁定真腿：boss 进 combat ⇒ 私有拍速接管全场网格；她退场 ⇒ 归还基准', () => {
    const w = makeWorld()
    const boss = w.ai.spawn('en_ostlara', { x: 0, y: 0, z: -5 }, 'b29_118')
    boss.state = 'combat'
    w.ai.update(TICK_DT, w.time.tick++, w.player, w.rhythm)
    expect(w.rhythm.clockOwner, '合格 boss 在场 ⇒ 接管').toBe('boss')
    expect(w.rhythm.bpm, 'en_ostlara 的私有拍速').toBe(108)
    expect(w.rhythm.beatsPerBar).toBe(boss.clockBeatsPerBar)
    boss.stats.damage(999_999) // alive 是 getter（= !stats.dead）：真伤结账让她退场
    w.ai.update(TICK_DT, w.time.tick++, w.player, w.rhythm)
    expect(w.rhythm.clockOwner, 'boss 倒下 ⇒ 区域基准拍归还').toBe('region')
  })

  it('L102 despawn 未知 id ⇒ false（名册里没有的东西回收不动，也不许砸）', () => {
    const w = makeWorld()
    expect(w.ai.despawn('no-such-id'), '从没 spawn 过的 id').toBe(false)
    // 对照：真 id 走 splice 那条腿
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -2 }, 'b29_102')
    expect(w.ai.despawn(e.id)).toBe(true)
    expect(w.ai.despawn(e.id), '回收第二次该落空').toBe(false)
  })

  it('L76 propDamaged 守门腿：缺 damageTarget 或 amount 为 0 ⇒ 原样丢弃，不碰敌人血条', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -2 }, 'b29_76')
    const hp0 = e.stats.hp
    const base = { id: 'pr_core', kind: 'resonant_core', pos: { x: 0, y: 0, z: -2 } }
    bus.emit('world.propDamaged', { ...base, amount: 5 })
    expect(e.stats.hp, '没有 damageTarget ⇒ 这笔账没人接').toBe(hp0)
    bus.emit('world.propDamaged', { ...base, damageTarget: e.data.id, amount: 0 })
    expect(e.stats.hp, '零额伤害 ⇒ 不转移').toBe(hp0)
    // 对照：全参的真事件走 stats.damage 那条腿
    bus.emit('world.propDamaged', { ...base, damageTarget: e.data.id, amount: 5 })
    expect(e.stats.hp, '真事件原样记到她头上（外露器官无甲）').toBeLessThan(hp0)
  })
})
