import { describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import { CHARGE_TICKS } from '@/player/ThirdPersonController'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-002 蓄力反馈：chargeProgress 生命周期（0 → 1 → 0 on release）
 * 以及「满时」与「未满」的可区分信号（ActorVisuals 据此画辉光强度）。
 */
registerGameData()

function makePlayer() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, player, tick, frame }
}

describe('蓄力反馈（KI-002：chargeProgress + 满时可辨信号）', () => {
  it('按住时 chargeProgress 从 0 爬到 1；松手归 0', () => {
    const w = makePlayer()
    w.frame.held.add('attackHeavy')
    w.tick(1)
    expect(w.player.charging).toBe(true)
    expect(w.player.chargeProgress).toBeGreaterThan(0)
    // 蓄满
    w.tick(CHARGE_TICKS)
    expect(w.player.chargeProgress, '蓄满后进度 = 1').toBe(1)
    // 松手
    w.frame.held.delete('attackHeavy')
    w.tick(1)
    expect(w.player.charging, '松手后不再蓄力').toBe(false)
  })

  it('chargeProgress 与 chargeTicks/CHARGE_TICKS 同源（不是第二个计时器）', () => {
    const w = makePlayer()
    w.frame.held.add('attackHeavy')
    w.tick(20)
    const expected = Math.min(1, w.player.chargeTicks / CHARGE_TICKS)
    expect(w.player.chargeProgress).toBe(expected)
    w.frame.held.delete('attackHeavy')
  })
})
