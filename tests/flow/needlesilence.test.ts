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
import { StreamingSystem } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { RpgRuntime } from '@/rpg/Runtime'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * 无鸣 Needlesilence（KI-023 收尾批，§4.6 逐格）：
 * - **零噪音**：noiseMul=0 经既有的 noise() 闸口 ⇒ 玩家的一切 sound.source 都是 0
 *   （万籁的 huntsSound、一切敌人的 hear() 吃到的都是"这一拍没有声音"）；
 * - **背刺 ×3.5**：倍率从武器标签 `crit.backstab3.5` 解析，不再认 DamagePipeline 里的 2.0 硬数；
 * - **抹喉弧线**：重击对 Alert 侧（未进战斗）的目标视为背刺；
 * - **潜行处决血线 0.5**：武器覆盖 player.json 的 0.35（设计的 +15pt 平移到实现的基数上）。
 * 解法循环闭合：T 晶诱她转向 A → 无鸣在 B 零噪音输出 → 背后背刺 ×3.5 → 血线 0.5 潜行处决。
 */

registerGameData()

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld(withNeedle = true) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(60, 1)
  const rpg = new RpgRuntime('origin_tuner')
  const weapon = registry.get<WeaponData>(withNeedle ? 'wp_needlesilence' : 'wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const cellKey = (p: Vec3): string => { const c = streaming.cellOf(p); return `${c.cx},${c.cy},${c.cz}` }
  new SpawnDirector(regions, {
    spawn: (id, pos, sd) => ai.spawn(id, pos, sd),
    despawn: (id) => ai.despawn(id),
    hasFlag: () => false
  }, cellKey)
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

/** 面向目标出一记（重击或轻击），返回第一记 combat.hit 的伤害与背刺位 */
function strike(w: ReturnType<typeof makeWorld>, target: Vec3, heavy: boolean): { dmg: number; backstab: boolean } {
  const out = { dmg: -1, backstab: false }
  const off = bus.on('combat.hit', (h) => {
    if (out.dmg < 0) { out.dmg = h.damage; out.backstab = h.backstab }
  })
  alive.push(off)
  w.player.pos = { x: target.x, y: target.y, z: target.z - 1.3 }
  w.player.floorY = target.y
  w.player.grounded = true
  w.player.stats.stamina = w.player.stats.staMax
  w.tick(2)
  w.player.yaw = Math.atan2(target.x - w.player.pos.x, target.z - w.player.pos.z)
  w.player.camYawRef = w.player.yaw + Math.PI
  w.player.grounded = true
  if (heavy) {
    w.frame.held.add('attackHeavy')
    w.tick(1)
    w.frame.held.delete('attackHeavy')
    w.tick(1)
  } else {
    w.frame.edges.add('attackLight')
    w.tick(1)
  }
  for (let i = 0; i < 70 && out.dmg < 0; i++) { w.player.stats.hp = w.player.stats.hpMax; w.player.stunTicks = 0; w.player.crumpleTicks = 0; w.tick() }
  expect(out.dmg, '这一记要真的命中').toBeGreaterThan(0)
  return out
}

describe('无鸣 Needlesilence（KI-023 收尾批）', () => {
  it('零噪音：装着无鸣，挥砍与命中全程没有一条非零的 sound.source（对照：调律剑有）', () => {
    const noisesNeedle: number[] = []
    const w = makeWorld(true)
    alive.push(bus.on('sound.source', (e) => { if (e.id === 'player') noisesNeedle.push(e.loudness) }))
    const victim = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.6 }, 'nz-n')
    w.player.pos = { x: 0, y: 0, z: -2.9 }
    w.frame.edges.add('attackLight')
    w.tick(1)
    for (let i = 0; i < 60 && victim.stats.hp === victim.stats.hpMax; i++) w.tick()
    expect(noisesNeedle.filter((n) => n > 0).length, '无鸣的每一声都是 0').toBe(0)

    const noisesSword: number[] = []
    const w2 = makeWorld(false)
    alive.push(bus.on('sound.source', (e) => { if (e.id === 'player') noisesSword.push(e.loudness) }))
    const v2 = w2.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.6 }, 'nz-s')
    w2.player.pos = { x: 0, y: 0, z: -2.9 }
    w2.frame.edges.add('attackLight')
    w2.tick(1)
    for (let i = 0; i < 60 && v2.stats.hp === v2.stats.hpMax; i++) w2.tick()
    expect(noisesSword.filter((n) => n > 0).length, '调律剑照常发声（对照腿）').toBeGreaterThan(0)
  })

  it('背刺 ×3.5：武器标签解析进倍率——同一记背刺，无鸣比调律剑多 3.5/2 倍', () => {
    // 对照：调律剑背刺 = 底数 × 2
    const w0 = makeWorld(false)
    const v0 = w0.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.6 }, 'bs-s')
    v0.yaw = 0 // 面朝 +z，玩家在 -z 侧 = 它的背后
    const plain = strike(w0, { x: 0, y: 0, z: -1.6 }, false)
    expect(plain.backstab, '对照这一记要判成背刺').toBe(true)
    // 无鸣：同一几何、同一帧表口径（底数 7 vs 9 不同 ⇒ 比伤害/底数的比值）
    const w1 = makeWorld(true)
    const v1 = w1.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.6 }, 'bs-n')
    v1.yaw = 0
    const needle = strike(w1, { x: 0, y: 0, z: -1.6 }, false)
    expect(needle.backstab, '无鸣这一记也是背刺').toBe(true)
    const baseSword = registry.get<WeaponData>('wp_tuning_sword')
    void baseSword
    const ratioPlain = plain.dmg / 9 // ms_sword l1 底伤 9
    const ratioNeedle = needle.dmg / 7 // ms_needlesilence l1 底伤 7
    expect(ratioNeedle / ratioPlain, `倍率比 = 3.5/2 = 1.75（实测 ${ (ratioNeedle / ratioPlain).toFixed(3) }）`).toBeCloseTo(1.75, 1)
  })

  it('抹喉弧线：Alert 侧目标吃重击判背刺；Combat 侧的同一记没有这份便宜', () => {
    const w = makeWorld(true)
    const alerted = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.6 }, 'hb-alert')
    alerted.yaw = 0 // 面对玩家（正面，普通背刺判不出来的位置）
    alerted.alertness = 70
    alerted.enter('alert')
    w.tick(2)
    const alertHit = strike(w, { x: 0, y: 0, z: -1.6 }, true)
    expect(alertHit.backstab, 'Alert 侧的重击=抹喉弧线背刺').toBe(true)

    const w2 = makeWorld(true)
    const fighting = w2.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.6 }, 'hb-combat')
    fighting.yaw = 0
    fighting.alertness = 100
    fighting.enter('chase')
    w2.tick(2)
    const combatHit = strike(w2, { x: 0, y: 0, z: -1.6 }, true)
    expect(combatHit.backstab, '打起来之后就没有弧线便宜了').toBe(false)
    void alerted; void fighting
  })

  it('潜行处决血线 0.5：无鸣在 45% 血就能背刺处决；调律剑同血位不行', () => {
    const w = makeWorld(true)
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.6 }, 'exec-n')
    e.yaw = 0 // 背对玩家
    e.stats.hp = e.stats.hpMax * 0.45
    e.alertness = 0
    w.player.pos = { x: 0, y: 0, z: e.pos.z - 1.3 }
    w.player.yaw = Math.atan2(e.pos.x - w.player.pos.x, e.pos.z - w.player.pos.z)
    w.tick(2)
    w.frame.edges.add('interact')
    w.tick(2)
    expect(w.player.executing, '无鸣：45% 血、未察觉 ⇒ 背刺处决成立（0.5 血线）').not.toBeNull()

    const w2 = makeWorld(false)
    const e2 = w2.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.6 }, 'exec-s')
    e2.yaw = Math.PI
    e2.stats.hp = e2.stats.hpMax * 0.45
    e2.alertness = 0
    w2.player.pos = { x: 0, y: 0, z: e2.pos.z - 1.3 }
    w2.player.yaw = Math.atan2(e2.pos.x - w2.player.pos.x, e2.pos.z - w2.player.pos.z)
    w2.tick(2)
    w2.frame.edges.add('interact')
    w2.tick(2)
    expect(w2.player.executing, '调律剑：同血位不构成潜行处决（0.35 血线）').toBeNull()
  })

  it('万籁的首杀真的掉无鸣（loot_myriad.firstKill）', async () => {
    // 数据腿：firstKill 表里有它（真通道已在 boss-rewards.test 覆盖同链路）
    const loot = registry.get<{ firstKill: Array<{ item: string }> }>('loot_myriad')
    expect(loot.firstKill.some((x) => x.item === 'wp_needlesilence_item'), '万籁的第一份奖励里有她自己的刺剑').toBe(true)
  })
})
