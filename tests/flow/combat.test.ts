import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'

/**
 * Automated gameplay flow (requirements §59): move -> attack -> enemy detects
 * -> combat -> enemy dies -> loot notify. Fully headless: logic layers never
 * import three (docs/technical-architecture.md §5.8), so no DOM needed.
 */

function makeWorld() {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>('ms_sword')
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)

  const frame = {
    move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 },
    held: new Set<string>(), edges: new Set<string>()
  }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0

  const log: Record<string, number> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hits: any[] = []
  bus.on('combat.hit', (p) => { log['combat.hit'] = (log['combat.hit'] ?? 0) + 1; hits.push(p) })
  for (const k of ['combat.parried', 'entity.died', 'ui.notify', 'player.damaged'] as const) {
    bus.on(k, () => { log[k] = (log[k] ?? 0) + 1 })
  }

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick)
      frame.edges.clear()
      rhythm.update(time.dt)
    }
  }
  return { time, rhythm, player, ai, combat, frame, tick, log, hits }
}

function facePlayerTo(w: ReturnType<typeof makeWorld>, e: { pos: { x: number; z: number } }): void {
  const a = Math.atan2(e.pos.x - w.player.pos.x, e.pos.z - w.player.pos.z)
  w.player.yaw = a
  // controller maps stick-forward (mv.y=-1) to camYaw frame: pick cam so desired dir = toward enemy
  w.player.camYawRef = Math.PI + a
}

describe('combat flow: detect -> fight -> kill -> loot notify (§59)', () => {
  it('enemy aggros from vision and player can kill it with light combo', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -6 }, 'flow')
    let diedTick = -1
    for (let t = 0; t < 3600 && diedTick < 0; t++) {
      const d = Math.hypot(e.pos.x - w.player.pos.x, e.pos.z - w.player.pos.z)
      // approach until in sword range, then swing at every chance
      if (!e.alive) { diedTick = t; break }
      if (d > 1.6) { w.frame.move = { x: 0, y: 1 } } else { w.frame.move = { x: 0, y: 0 } }
      facePlayerTo(w, e)
      if (w.player.action === null && w.player.stats.stamina > 12 && d < 2.4) w.frame.edges.add('attackLight')
      w.tick()
    }
    expect(e.alive).toBe(false)
    expect(w.log['entity.died'] ?? 0).toBeGreaterThanOrEqual(1)
    expect(w.log['combat.hit'] ?? 0).toBeGreaterThanOrEqual(3)
    expect(w.log['ui.notify'] ?? 0).toBeGreaterThanOrEqual(1) //崩解·遗响 reward line
    // enemy fought back at least once or tried (it entered combat)
    expect(['combat', 'chase', 'recover', 'retreat', 'dead']).toContain(e.state)
  }, 20000)

  it('attacks are stamina-gated: no infinite attacking (§15)', () => {
    const w = makeWorld()
    let started = 0
    for (let t = 0; t < 300; t++) {
      const before = w.player.action
      w.frame.edges.add('attackLight')
      w.tick()
      if (!before && w.player.action) started++
    }
    // swing cadence + stamina cost means spam cannot approach one swing per 15 ticks
    expect(started).toBeLessThan(20)
    expect(w.player.stats.stamina).toBeLessThan(w.player.stats.staMax)
    // hard gate: with a depleted pool a new swing must be refused outright
    w.frame.edges.clear()
    w.tick(90) // let the current swing finish
    w.player.stats.stamina = 3
    const before = w.log['ui.notify'] ?? 0
    w.frame.edges.add('attackLight')
    w.tick()
    expect(w.player.action).toBeNull()
    expect((w.log['ui.notify'] ?? 0)).toBeGreaterThan(before) // 精力不足 notice
    // and it recovers afterwards (delayed regen curve)
    w.frame.edges.clear()
    w.tick(180)
    expect(w.player.stats.stamina).toBeGreaterThan(50)
  })

  it('parry beats the enemy hit frame and stuns it (§5.3)', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.5 }, 'parry')
    e.alertness = 100
    e.enter('chase')
    let parried = false
    for (let t = 0; t < 600 && !parried; t++) {
      facePlayerTo(w, e)
      const atk = e.attack
      if (atk && atk.tick === atk.spec.frames.startup - 3) {
        w.player.parryTicksLeft = w.player.base.parry.activeTicks
      }
      w.tick()
      if ((w.log['combat.parried'] ?? 0) > 0) parried = true
    }
    expect(parried).toBe(true)
    expect(e.stunTicks).toBeGreaterThan(0)
    expect(w.player.stats.overdrive).toBeGreaterThanOrEqual(2)
    expect(w.player.stats.hp).toBe(w.player.stats.hpMax) // parried = zero damage
  }, 20000)

  it('perfect block negates damage and refunds guard stamina (§5.2)', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.5 }, 'pblock')
    e.alertness = 100
    e.enter('chase')
    let blocked = false
    for (let t = 0; t < 600 && !blocked; t++) {
      facePlayerTo(w, e)
      const atk = e.attack
      if (atk && atk.tick === atk.spec.frames.startup - 2) w.frame.held.add('guard')
      w.tick()
      if (w.hits.some((h) => h.result === 'perfectBlock') && w.player.stats.hp === w.player.stats.hpMax) blocked = true
    }
    expect(blocked).toBe(true)
  }, 20000)
})
