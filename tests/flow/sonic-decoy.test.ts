import { afterEach, describe, expect, it } from 'vitest'
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
import { RpgRuntime } from '@/rpg/Runtime'

/**
 * KI-023① 收尾：音色晶投掷——§15.3 解法循环的最后一块。
 *
 * 「投掷音色晶到 A 点→其转向 A→玩家在 B 输出」：T 键抛出一颗晶（抛物线、伤害恒 0、
 * 穿过所有人），落地碎裂时发一声 0.8 的伪声源——她（以及一切靠听的敌人）扑向碎响处，
 * 玩家在别处输出。投掷本身不发声：诱饵的全部价值就在于「那一声不在你这里」。
 * 伪声源的消费方早已就绪（`AISystem` 的 hear 路由 + 她的 huntsSound），这里补的是道具本体。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

registerGameData()

const SPEC = { speed: 11, range: 15, radius: 0.35, gravity: 14, loudness: 0.8, offsetY: 1.2 }

function makeWorld(crystals = 3) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(60, 1)
  const rpg = new RpgRuntime('origin_tuner')
  rpg.inv.add('it_timbre_crystal', crystals)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  combat.floorAt = () => 0 // 地面在 y=0：晶的碎裂走『落地』这条出口（生产由 Surface 注入）
  combat.crystalSource = () => ({
    available: rpg.inv.count('it_timbre_crystal'),
    consume: () => { rpg.inv.remove('it_timbre_crystal', 1) },
    spec: SPEC
  })
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
  return { time, rhythm, player, ai, combat, rpg, tick, frame, input }
}

describe('音色晶投掷（KI-023①：声东击西的最后一块）', () => {
  it('T 键投掷：扣一颗晶、弹体起飞、落地碎裂在射程内发一声 0.8 的伪声源', () => {
    const w = makeWorld(3)
    const noises: Array<{ pos: { x: number; z: number }; loudness: number }> = []
    alive.push(bus.on('sound.source', (e) => noises.push({ pos: { x: e.pos.x, z: e.pos.z }, loudness: e.loudness })))
    w.frame.edges.add('throwCrystal')
    w.tick(1)
    expect(w.rpg.inv.count('it_timbre_crystal'), '扣掉一颗').toBe(2)
    expect(w.combat.projectiles.list().some((p) => p.kind === 'crystal'), '晶在飞').toBe(true)
    // 等落地（抛物线 + 14 重力，射程 15 ⇒ 一秒多）
    for (let i = 0; i < 120 && noises.length === 0; i++) w.tick()
    expect(noises.length, '碎裂的伪声源恰好一声').toBe(1)
    expect(noises[0].loudness, '响度来自 item 数据的 throw.loudness').toBe(0.8)
    const dist = Math.hypot(noises[0].pos.x - w.player.pos.x, noises[0].pos.z - w.player.pos.z)
    expect(dist, `落点在玩家前方一段距离（实测 ${dist.toFixed(2)}m）`).toBeGreaterThan(4)
  })

  it('空手按 T：一颗都不扣、没有弹体，只说一声（连投限速别刷屏）', () => {
    const w = makeWorld(0)
    const notes: string[] = []
    alive.push(bus.on('ui.notify', (p) => notes.push(p.text)))
    w.frame.edges.add('throwCrystal')
    w.tick(1)
    expect(w.combat.projectiles.list().length, '没有弹体').toBe(0)
    w.frame.edges.add('throwCrystal')
    w.tick(25)
    expect(notes.filter((n) => n.includes('没有音色晶')).length, '20 tick 限速内只说一次').toBe(1)
  })

  it('声东击西端到端：她扑向碎响处，不是玩家的真实站位', () => {
    const w = makeWorld(2)
    // 她在 30m 外沉睡（听觉 40 之内、huntsSound maxRange 45 之内）
    const myriad = w.ai.spawn('en_myriad', { x: 0, y: 0, z: -30 }, 'decoy-e2e')
    const crystalSpot = { x: 8, y: 0, z: -4 } // 投掷方向前方 8m：她的碎响点与玩家本位分开
    w.player.yaw = Math.atan2(crystalSpot.x - w.player.pos.x, crystalSpot.z - w.player.pos.z)
    w.player.camYawRef = w.player.yaw + Math.PI
    const playerAt = { ...w.player.pos }
    w.frame.edges.add('throwCrystal')
    w.tick(1)
    for (let i = 0; i < 140; i++) {
      w.tick()
      if (myriad.pos.x !== 0 || myriad.pos.z !== -30) break // 她动了就停表
    }
    const dCrystal = Math.hypot(myriad.pos.x - crystalSpot.x, myriad.pos.z - crystalSpot.z)
    const dPlayer = Math.hypot(myriad.pos.x - playerAt.x, myriad.pos.z - playerAt.z)
    expect(dCrystal, `她瞬移到碎响处（实测 ${dCrystal.toFixed(2)}m）`).toBeLessThan(1.5)
    expect(dPlayer, `玩家的真实站位没有被暴露（实测 ${dPlayer.toFixed(2)}m）`).toBeGreaterThan(4)
  })

  it('晶不是武器：飞行与碎裂全程零 combat.hit、零伤害事件', () => {
    const w = makeWorld(1)
    const victim = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -6 }, 'crystal-pass') // 弹道会穿过它
    const hits: number[] = []
    alive.push(bus.on('combat.hit', (h) => hits.push(h.damage)))
    w.frame.edges.add('throwCrystal')
    w.tick(1)
    for (let i = 0; i < 120; i++) w.tick()
    expect(victim.stats.hp, '穿过它时一分血不掉（诱饵不是武器）').toBe(victim.stats.hpMax)
    expect(hits.length, '全程没有一条命中事件').toBe(0)
  })
})
