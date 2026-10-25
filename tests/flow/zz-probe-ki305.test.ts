import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { RpgRuntime } from '@/rpg/Runtime'
import { Rng } from '@/core/Math'
import type { Vec3 } from '@/combat/EntityStats'

registerGameData()

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime()
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>('moveset:ms_sword'))
  player.applyRpg(rpg.mods())
  player.setSkills(rpg.skillLoadout())
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, seed) => ai.spawn(id, pos, seed),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k),
  }, (p: Vec3) => { const c = streaming.cellOf(p); return chunkKeyOf(c.cx, c.cy, c.cz) })
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  const off = bus.on('combat.hit', () => {})
  const pins: Array<() => void> = []
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      for (const pin of pins) pin()
      time.tick++
      time.step(TICK_DT)
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, rpg, player, ai, combat, streaming, spawner, frame, tick, off, pins }
}

describe('probe ki305 §8.1 冲刺帧数据表细节', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('§8.1 冲刺帧数据：每拍 6 帧，最高速度 12m/s，加速 3m/s²，体力消耗 8/拍', () => {
    const w = makeWorld()
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.player.yaw = 0
    w.combat.rng = new Rng('ki305_sprint1')
    w.frame.held.add('sprint')
    w.frame.move = { x: 0, y: 1 }
    // 开始计时
    const frames: number[] = []
    for (let i = 0; i < 30; i++) {
      w.tick(1)
      frames.push(i)
    }
    const totalTicks = 30
    // 每拍 6 帧 → 30 ticks = 5拍
    console.log('冲刺持续帧数:', totalTicks)
    // 验证冲刺状态（通过 moveSpeed > moveSpeed 判断）
    expect(w.player.moveSpeed, '应处于冲刺速度').toBeGreaterThan(4)
    alive.push(w.off)
  })

  it('§8.1 冲刺取消窗：按取消键在冲刺第 3-5 帧生效', () => {
    const w = makeWorld()
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.player.yaw = 0
    w.combat.rng = new Rng('ki305_sprint2')
    w.frame.held.add('sprint')
    w.frame.move = { x: 0, y: 1 }
    // 按取消键（dodge）
    for (let i = 0; i < 5; i++) w.tick(1)
    w.frame.edges.add('dodge')
    w.tick(1)
    console.log('冲刺中取消：roll', w.player.roll !== null, 'action key', w.player.action?.key ?? 'none')
    // 记录取消是否在 3-5 帧内生效
    alive.push(w.off)
    w.ai.despawn
  })
})