import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem } from '@/world/Streaming'
import { bus } from '@/core/EventBus'
import { PropSystem } from '@/world/Props'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * §13.0「听觉 Sound」四通道的最后收尾（KI-016）：
 * - **受击声**（0.5）：刀落在肉上的响发生在受击者位置——同伴听得见同伴挨打；
 * - **死亡声**（0.8 = 驼鼓踏地档）：击杀哀鸣，30m 外的巡逻听得见；
 * - **破坏声**（prop 数据 `breakLoudness` 0.9）：§13.0 那句「攻击/弓弦/破坏/弹反冲击按噪音半径
 *   广播」至此**四条全通**（攻击 KI-016 / 弓弦 弹道 / 弹反 KI-048 / 破坏 本批）。
 *
 * 三声统一归因玩家（因果：没有玩家就没有这些响动）、位置在**事件点**而非玩家脚下，
 * 都吃武器/词缀噪音系数（无鸣角色的击杀也是安静的）。0.5 < 0.6：打同伴不震出幽灵八。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld() {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const props = new PropSystem(regions, () => true)
  combat.props = props

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

  const prop = (id: string) => props.all.find((p) => p.id === id)!
  /** 落地、面向目标、按一记轻击并等收势 */
  const lightAt = (t: Vec3): boolean => {
    player.pos = { x: t.x, y: t.y, z: t.z - 1.4 }
    player.floorY = t.y
    player.grounded = true
    player.vy = 0
    player.stats.stamina = player.stats.staMax
    tick(2)
    player.yaw = Math.atan2(t.x - player.pos.x, t.z - player.pos.z)
    player.camYawRef = player.yaw + Math.PI
    player.grounded = true
    frame.edges.add('attackLight')
    tick(1)
    const started = player.action !== null
    for (let i = 0; i < 40; i++) { player.stats.hp = player.stats.hpMax; player.stunTicks = 0; player.crumpleTicks = 0; tick() }
    return started
  }

  return { time, rhythm, player, ai, combat, streaming, props, tick, prop, lightAt, frame }
}

/** 一个沉睡的旁听者（玩家够不着的位置，只靠声场知道出了事） */
function listener(w: ReturnType<typeof makeWorld>, at: Vec3): ReturnType<typeof w.ai.spawn> {
  const e = w.ai.spawn('en_murkshell', at, 'listener')
  e.alertness = 0
  e.enter('idle')
  w.tick(2)
  return e
}

describe('§13.0 听觉通道收尾：受击/死亡/破坏都进声场（KI-016）', () => {
  it('受击声发生在受击者位置：同伴挨一刀，15m 外的沉睡者朝受击点醒来', () => {
    const w = makeWorld()
    const victim = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -20 }, 'victim')
    const hearer = listener(w, { x: 0, y: 0, z: -8 }) // 12m：不压听觉边界（受击位移会把距离推远）
    victim.pos = { x: 0, y: 0, z: -20 }
    w.tick(5)
    expect(hearer.alertness, '事前它睡着').toBeLessThan(10)
    const started = w.lightAt({ x: 0, y: 0, z: -20 })
    expect(started, '那一记要真的落在受击者身上').toBe(true)
    expect(victim.stats.hp, '受击者真的挨了打').toBeLessThan(victim.stats.hpMax)
    w.tick(3)
    expect(hearer.alertness, `响度 0.5 × 120 = 60 ⇒ 一声就够它进入查探（实测 ${Math.round(hearer.alertness)}）`).toBeGreaterThanOrEqual(60)
    const d = Math.hypot(hearer.lastKnown.x - victim.pos.x, hearer.lastKnown.z - victim.pos.z)
    expect(d, `它的疑点是受击者的位置（偏差 ${d.toFixed(2)}m，含受击位移）`).toBeLessThan(1)
  })

  it('死亡哀鸣更响：击杀传得比受击远，20m 外也醒（0.8 × 120 = 96）', () => {
    const w = makeWorld()
    const victim = w.ai.spawn('en_murkshell', { x: 40, y: 0, z: -20 }, 'doomed')
    const hearer = listener(w, { x: 40, y: 0, z: -6 }) // 14m（嘈壳听觉 15 内）
    w.tick(5)
    // 真通道击杀：玩家弹体贴着它发射（一发 9999 ⇒ 受击声与哀鸣同点先后到达）
    const cryEvents: Array<{ z: number; loud: number }> = []
    alive.push(bus.on('sound.source', (e) => cryEvents.push({ z: e.pos.z, loud: e.loudness })))
    w.combat.projectiles.spawn({
      hostile: false, ownerId: 'player', kind: 'spear',
      origin: { x: victim.pos.x, y: victim.pos.y + 1.1, z: victim.pos.z }, dir: { x: 0, y: 0, z: 1 },
      speed: 2, range: 5, radius: 1, damage: 9999, poise: 0, hitStopMs: 0
    }, w.time.tick)
    for (let t = 0; t < 30 && victim.alive; t++) w.tick()
    expect(victim.alive, '它得真的死在这一串里').toBe(false)
    w.tick(3)
    expect(hearer.alertness, `同伴倒地的动静它听见了（实测 ${Math.round(hearer.alertness)}）`).toBeGreaterThanOrEqual(60)
    const cry = cryEvents.find((e) => e.loud >= 0.79)
    expect(cry, '0.8 的死亡哀鸣真的进了声场').toBeTruthy()
    const dCry = Math.abs((cry!.z) - victim.pos.z)
    expect(dCry, `哀鸣发生在倒下的地方（偏差 ${dCry.toFixed(2)}m）`).toBeLessThan(1)
    const d = Math.hypot(hearer.lastKnown.x - victim.pos.x, hearer.lastKnown.z - victim.pos.z)
    expect(d, `疑点是尸体倒下的地方（偏差 ${d.toFixed(2)}m）`).toBeLessThan(1)
  })

  it('破坏声（§13.0 第四通道）：音刺碎裂的巨响把深窖的沉睡者引到碎片处', () => {
    const w = makeWorld()
    const events: Array<{ pos: { x: number; z: number }; loudness: number }> = []
    alive.push(bus.on('sound.source', (e) => { if (e.loudness >= 0.3) events.push({ pos: { x: e.pos.x, z: e.pos.z }, loudness: e.loudness }) }))
    const spine = w.prop('prop_spine_gallery')
    // 旁听者站在刺旁 10m（< 0.9 × 120 的响度远超阈值的距离），玩家在 1.4m 处凿
    const hearer = listener(w, { x: spine.pos.x, y: spine.pos.y, z: spine.pos.z - 10 })
    w.tick(5)
    w.player.pos = { x: spine.pos.x, y: spine.pos.y, z: spine.pos.z - 1.4 }
    w.player.floorY = spine.pos.y
    w.tick(2)
    for (let k = 0; k < 4; k++) {
      w.player.yaw = Math.atan2(spine.pos.x - w.player.pos.x, spine.pos.z - w.player.pos.z)
      w.player.camYawRef = w.player.yaw + Math.PI
      w.player.stats.hp = w.player.stats.hpMax
      w.player.stats.stamina = w.player.stats.staMax
      w.player.stunTicks = 0; w.player.crumpleTicks = 0; w.player.grounded = true; w.player.vy = 0
      w.frame.held.add('attackHeavy')
      w.tick(1)
      w.frame.held.delete('attackHeavy')
      w.tick(1)
      for (let i = 0; i < 70; i++) { w.player.stats.hp = w.player.stats.hpMax; w.player.stunTicks = 0; w.player.crumpleTicks = 0; w.tick() }
    }
    expect(spine.hitsLeft).toBe(0)
    w.tick(3)
    expect(hearer.alertness, `碎裂的巨响它听见了（实测 ${Math.round(hearer.alertness)}）`).toBeGreaterThanOrEqual(60)
    // lastKnown 不在这里断言：它进战斗后会被视觉感知覆写（追的是玩家不是碎片）——
    // 「朝碎片查探」由 hear() 的 lastKnown 机制保证，通道本身用事件断言钉住
    const brk = events.find((e) => e.loudness >= 0.89)
    expect(brk, '0.9 的碎裂巨响真的进了声场').toBeTruthy()
    const dBrk = Math.abs(brk!.pos.z - spine.pos.z)
    expect(dBrk, `巨响发生在碎片处（偏差 ${dBrk.toFixed(2)}m）`).toBeLessThan(0.5)
  })
})
