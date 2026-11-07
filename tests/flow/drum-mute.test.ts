import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { EnemyData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * KI-405：§6.5「投掷音色晶调包节拍器」——潜行解 A 的第三种静音法。
 *
 * 病：KI-402 落「鼓手死」、KI-404 落「打鼓面」，但 §6.5 的核心环节写着
 * 「②砸掉或静音驼鼓（重击／投掷音色晶调包节拍器）」——**投一颗晶**这条路没有入口。
 * 音色晶本体（KI-023）早就能扔、能落地、能发伪声源，唯独对鼓没有任何意义。
 *
 * 裁决（一个数据格 ＋ 一处落地钩子）：
 *  ① `ai.drumMuteRadius = 6`，只有驼鼓带；判据是**落点到鼓的距离**，不是命中——
 *     音色晶本来就穿过所有人（KI-023 的 pierce 99），鼓面没有碰撞体；
 *  ② 晶碎在半径内 ⇒ `drumMuted`，走 `campLoseBeat`（与 KI-402／403／404 同一段：
 *     冻一小节、落 Search、圈心鼓位、每 4 小节回头），鼓手与鼓都还在；
 *  ③ 静音是一次性的：同一面鼓只调包一次；鼓被调包之后再打鼓面、再杀鼓手都不重复丢拍。
 *
 * 腿：
 *  ① 数据：驼鼓带 `drumMuteRadius: 6`，别的怪没有；
 *  ② 晶落在鼓边 2 米 ⇒ 鼓静音、同营冻结 171 拍 + 落 Search、驼鼓活着、屏上说「鼓被调包了」；
 *  ③ 反向臂：同一颗晶落在 26 米外 ⇒ 不静音、不丢拍；
 *  ④ 已调包 ⇒ 再扔一颗不回响；鼓手死亡也不触发第二次丢拍。
 */

registerGameData()

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  combat.floorAt = () => 0
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  const notifies: string[] = []
  alive.push(bus.on('ui.notify', (p) => { notifies.push(p.text) }))
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
  return { time, rhythm, player, ai, combat, frame, tick, notifies }
}

/** 在 `at` 上方 3 米竖直落一颗音色晶（与 T 键同一条弹道：速度 11、重力 14、穿过所有人） */
function dropCrystal(w: ReturnType<typeof makeWorld>, at: Vec3): void {
  w.combat.projectiles.spawn({
    hostile: false, ownerId: 'player', kind: 'crystal',
    origin: { x: at.x, y: 3, z: at.z }, dir: { x: 0, y: -1, z: 0 },
    speed: 11, range: 15, radius: 0.3, gravity: 14,
    damage: 0, poise: 0, hitStopMs: 0, parryable: false, pierce: 99,
    crystalLoudness: 0.8
  }, w.time.tick)
  for (let i = 0; i < 60; i++) w.tick()
}

describe('KI-405 音色晶调包节拍器：不杀不砸，也能把鼓静音（§6.5）', () => {
  it('数据：驼鼓带 drumMuteRadius: 6，其他怪没有', () => {
    expect(registry.get<EnemyData>('en_tympanus').ai.drumMuteRadius).toBe(6)
    expect(registry.get<EnemyData>('en_murkshell').ai.drumMuteRadius).toBeUndefined()
  })

  it('晶落在鼓边 2 米：鼓静音、全营丢拍一小节、鼓手与鼓都还在', () => {
    const w = makeWorld()
    const tym = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -6 }, 'drum')
    const ally = w.ai.spawn('en_driftsinger', { x: 5, y: 0, z: -6 }, 'ally')
    w.tick(2)

    dropCrystal(w, { x: 0, y: 0, z: -4 })
    expect(tym.drumMuted, '鼓被调包').toBe(true)
    expect(tym.alive, '鼓手没死').toBe(true)
    expect(tym.drumBroken, '鼓也没碎').toBe(false)
    // 晶飞了一段才落地，剩下的冻结按落点那一拍量（一小节 171 里已经走掉几十拍）
    expect(ally.frozenTicks, '同营丢拍一小节').toBeGreaterThan(100)
    expect(ally.state).toBe('search')
    expect(w.notifies.some((t) => t.includes('鼓被调包了')), '屏上要说出来').toBe(true)
    w.tick(ally.frozenTicks)
    expect(ally.frozenTicks).toBe(0)
  })

  it('反向臂：晶落在 26 米外 ⇒ 不静音、不丢拍', () => {
    const w = makeWorld()
    const tym = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -6 }, 'drum')
    const ally = w.ai.spawn('en_driftsinger', { x: 5, y: 0, z: -6 }, 'ally')
    w.tick(2)
    dropCrystal(w, { x: 0, y: 0, z: 20 })
    expect(tym.drumMuted).toBe(false)
    expect(ally.frozenTicks).toBe(0)
    expect(ally.state).not.toBe('search')
  })

  it('调包只算一次：再扔一颗不回响，鼓手死了也不重复丢拍', () => {
    const w = makeWorld()
    const tym = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -6 }, 'drum')
    const ally = w.ai.spawn('en_driftsinger', { x: 5, y: 0, z: -6 }, 'ally')
    w.tick(2)
    dropCrystal(w, { x: 0, y: 0, z: -4 })
    expect(tym.drumMuted).toBe(true)
    w.tick(200) // 冻结走完
    expect(ally.frozenTicks).toBe(0)

    dropCrystal(w, { x: 0, y: 0, z: -4 })
    expect(ally.frozenTicks, '同一个鼓不会第二次丢拍').toBe(0)

    w.combat.projectiles.spawn({
      hostile: false, ownerId: 'player', kind: 'spear',
      origin: { x: tym.pos.x, y: tym.pos.y + 1.1, z: tym.pos.z }, dir: { x: 0, y: 0, z: 1 },
      speed: 2, range: 5, radius: 1, damage: 9999, poise: 0, hitStopMs: 0
    }, w.time.tick)
    for (let i = 0; i < 10 && tym.alive; i++) w.tick()
    expect(tym.alive).toBe(false)
    expect(ally.frozenTicks, '鼓已静音，死亡不再触发丢拍').toBe(0)
  })
})
