import { describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'

/** KI-013 碎甲视觉反馈：plateBreakTick 让 ActorVisuals 播碎裂缩放动画（30 tick），然后永久隐去。 */
registerGameData()

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, player, ai, combat, tick, frame, input }
}

describe('碎甲视觉反馈（KI-013：plateBreakTick 驱动 ActorVisuals 动画）', () => {
  it('震裂碎裂 ⇒ armorBroken=true + plateBreakTick 记录了那一刻', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_hanged_knight', { x: 0, y: 0, z: -2 }, 'abv')
    expect(e.data.ai.armorFront, '悬钟骑士有正面甲').toBeTruthy()
    expect(e.armorBroken).toBe(false)
    expect(e.plateBreakTick).toBe(0)
    // 走真通道：强攻蓄力塞满震裂 → 碎裂
    w.player.pos = { x: 0, y: 0, z: -3.2 }
    w.player.yaw = 0
    w.player.stats.stamina = w.player.stats.staMax
    w.frame.held.add('attackHeavy')
    w.tick(1)
    w.frame.held.delete('attackHeavy')
    w.tick(1)
    // 蓄力重击命中（底伤 + 震裂层）
    for (let i = 0; i < 80; i++) { w.player.stats.stamina = w.player.stats.staMax; w.player.stats.hp = w.player.stats.hpMax; w.player.stunTicks = 0; w.player.crumpleTicks = 0; w.tick() }
    // 可能需要多次命中才能打满震裂层 — 持续攻击
    let guard = 0
    while (!e.armorBroken && guard < 200) {
      w.player.pos = { x: 0, y: 0, z: -3.2 }
      w.player.yaw = 0
      w.player.stats.stamina = w.player.stats.staMax
      w.player.stunTicks = 0; w.player.crumpleTicks = 0
      w.frame.held.add('attackHeavy')
      w.tick(1)
      w.frame.held.delete('attackHeavy')
      w.tick(1)
      for (let i = 0; i < 80; i++) { w.player.stats.hp = w.player.stats.hpMax; w.player.stunTicks = 0; w.player.crumpleTicks = 0; w.tick() }
      guard++
    }
    expect(e.armorBroken, '真通道打碎甲').toBe(true)
    expect(e.plateBreakTick, '碎甲时刻有记录').toBeGreaterThan(0)
  })
})
