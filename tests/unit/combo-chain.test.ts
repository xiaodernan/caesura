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
import { RpgRuntime } from '@/rpg/Runtime'

registerGameData()

function makePlayer(comboScaling = 0) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime('origin_tuner')
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  combat.floorAt = () => 0
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.grounded = true
  player.floorY = 0
  player.applyRpg({ ...rpg.mods(), comboScaling })
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.grounded = true
      player.stats.stamina = player.stats.staMax
      player.stats.hp = player.stats.hpMax
      player.stunTicks = 0; player.crumpleTicks = 0
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, player, rpg, tick, frame }
}

describe('之连词缀（KI-029）', () => {
  it('comboDepth + 之连乘数', () => {
    const w = makePlayer(0.05)
    const p = w.player
    // 起手 l1
    w.frame.edges.add('attackLight')
    w.tick(1)
    expect(p.action?.key, 'l1 起手').toBe('l1')
    expect(p.comboDepth, 'depth=1').toBe(1)
    // 推到 active 窗口（l1 activeStart=12）读 hitbox
    for (let i = 0; i < 15 && p.action; i++) { p.grounded = true; w.tick(1) }
    const l1hb = p.activeHitbox
    expect(l1hb, 'l1 hitbox 存在').not.toBeNull()
    expect(l1hb?.damage, 'l1 起手不加成 = 9').toBe(9)
    // 排队 l2（active 窗口内按 attackLight）
    if (p.action) w.frame.edges.add('attackLight')
    // 等 l1 收完 → comboQueued 消费 → l2 立即起手（不是 null）
    while (p.action?.key === 'l1') { p.grounded = true; w.tick(1) }
    expect(p.comboDepth, 'l2 depth=2').toBe(2)
    // 推到 l2 active 窗口
    for (let i = 0; i < 15 && p.action; i++) { p.grounded = true; w.tick(1) }
    const l2hb = p.activeHitbox
    expect(l2hb, 'l2 hitbox 存在').not.toBeNull()
    expect(l2hb?.damage, 'l2 = 9 × 1.05 = 9.45').toBeCloseTo(9.45, 1)
  })
})
