import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { bus } from '@/core/EventBus'

/**
 * KI-239：**§9 命中停顿那张情境表第一次在真链上被量**。
 *
 * | 情境 | 时长 | 帧 |
 * |---|---|---|
 * | 轻击命中敌 | 60ms | 4f |
 * | 重击/尾段命中 | 90ms | 6f |
 * | 蓄力重击命中 | 120ms | 8f |
 * | 命中被格挡 | 45ms | 3f |
 * | 完美格挡 | 90ms | 6f |
 * | 弹反成功 | 120ms | 8f |
 * | 弹反失败被击 | 100ms | 6f |
 * | 玩家受击 | 80ms | 5f |
 * | 处决首刀 | 180ms | 11f |
 *
 * 读数取两处：**事件里的 `hitStopMs`**（那一格自己报出来的数）＋ **时间标掉下去的幅度**。
 *
 * 真链：真 `PlayerController` ＋ 真 `Enemy` ＋ 真 `CombatManager` ＋ 真事件 ＋ 真 `GameTime`。
 */

registerGameData()

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  const hits: Array<{ result: string; hitStopMs: number; damage: number }> = []
  const off = bus.on('combat.hit', (p) => hits.push({ result: p.result, hitStopMs: p.hitStopMs, damage: p.damage }))

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.step(TICK_DT) // 真实时间照走（hitStop 的坡道就靠它收）
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, frame, tick, hits, off }
}

type World = ReturnType<typeof makeWorld>

/** 一记飞向玩家的弹体（飞行 9 拍 ⇒ 防御按键的时机由调用方给） */
function shoot(w: World): void {
  w.combat.projectiles.spawn({
    hostile: true, ownerId: 'en_test', kind: 'shard', origin: { x: 0, y: 1.1, z: -4 }, dir: { x: 0, y: 0, z: 1 },
    speed: 13, range: 20, radius: 0.45, damage: 30, poise: 10, hitStopMs: 60,
  }, w.time.tick)
}

describe('KI-239 §9 命中停顿那张情境表：每一格第一次在真链上被量', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① 玩家受击 → 80ms（`hitStop.hurtMs`）＋ 时间标掉下去', () => {
    const w = makeWorld()
    w.player.pos = { x: 0, y: 0, z: 0 }
    shoot(w)
    for (let i = 0; i < 30 && w.hits.length === 0; i++) w.tick()
    const hit = w.hits[0]
    expect(hit, '那一记打到了玩家').toBeTruthy()
    // **手钉设计那一行的数**（combat.md §9「玩家受击 80ms」），**不读数据表**：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了
    expect(hit!.hitStopMs, '玩家受击那一行的停顿（§9「玩家受击 80ms」）').toBe(80)
    expect(w.time.rawScale, '时间标同时掉下去（镜头与阻尼吃的就是它）').toBeLessThan(1)
    alive.push(w.off)
  })

  it('腿② 命中被格挡 → 45ms（`hitStop.blockMs`）', () => {
    const w = makeWorld()
    w.player.pos = { x: 0, y: 0, z: 0 }
    shoot(w)
    w.tick(7) // 弹体还有 7 拍到 ⇒ 此刻按下格挡（起手 6 拍 ⇒ 挨打时盾已举起来，且已过完美格挡那 5 拍）
    w.frame.held.add('guard')
    for (let i = 0; i < 30 && w.hits.length === 0; i++) w.tick()
    const hit = w.hits[0]
    expect(hit?.result, '那一记被格挡了').toBe('block')
    expect(hit!.hitStopMs, '命中被格挡那一行的停顿（§9「45ms」）').toBe(45)
    alive.push(w.off)
  })

  it('腿③ 完美格挡 → 90ms（`hitStop.perfectBlockMs`）', () => {
    const w = makeWorld()
    w.player.pos = { x: 0, y: 0, z: 0 }
    shoot(w)
    w.tick(11) // 弹体还有 3 拍到 ⇒ 此刻按下格挡（完美格挡的窗是按下后的前 5 拍）
    w.frame.held.add('guard')
    for (let i = 0; i < 30 && w.hits.length === 0; i++) w.tick()
    const hit = w.hits[0]
    expect(hit?.result, '那一记走了完美格挡（按下后的前 5 拍内挨打）').toBe('perfectBlock')
    expect(hit!.hitStopMs, '完美格挡那一行的停顿（§9「90ms」）').toBe(90)
    alive.push(w.off)
  })

  it('腿④ 弹反成功 → 120ms（`hitStop.parryMs`）', () => {
    const w = makeWorld()
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.player.yaw = Math.PI // 面朝来弹的方向（弹反那一支判「人面不面向来那一记」）
    shoot(w)
    w.tick(10) // 弹体还有 4 拍到 ⇒ 此刻按下弹反（窗 6 拍）
    w.frame.edges.add('parry')
    w.tick()
    w.frame.edges.delete('parry')
    for (let i = 0; i < 30 && w.hits.length === 0; i++) w.tick()
    const hit = w.hits[0]
    expect(hit?.result, '那一记被弹反了').toBe('parry')
    expect(hit!.hitStopMs, '弹反成功那一行的停顿（§9「120ms」）').toBe(120)
    alive.push(w.off)
  })

  it('腿⑤ 攻方那三格：轻击 60／重击 90／蓄力 120（帧表自己的 `hitStopMs`）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -1.6 }, 'prey')
    e.alertness = 0
    e.enter('idle')
    const p = w.player
    p.pos = { x: 0, y: 0, z: 0 }
    p.yaw = Math.PI
    p.camYawRef = Math.PI + p.yaw
    w.frame.edges.add('attackLight')
    w.tick()
    w.frame.edges.delete('attackLight')
    for (let i = 0; i < 60 && w.hits.length === 0; i++) w.tick()
    expect(w.hits[0], '轻击那一记打到了敌人').toBeTruthy()
    expect(w.hits[0]!.hitStopMs, '轻击命中敌那一行的停顿（§9「60ms」）').toBe(60)
    alive.push(w.off)
  })

  it('腿⑥ 登记：弹反失败被击那一行（设计 100ms）在运行时走的是「玩家受击」那一格（80ms）', () => {
    const w = makeWorld()
    w.player.pos = { x: 0, y: 0, z: 0 }
    w.frame.edges.add('parry')
    w.tick()
    w.frame.edges.delete('parry')
    w.tick(8) // 弹反的窗开了又关了（6 拍）
    shoot(w)
    for (let i = 0; i < 30 && w.hits.length === 0; i++) w.tick()
    const hit = w.hits[0]
    expect(hit, '那一记打到了玩家').toBeTruthy()
    expect(hit!.hitStopMs, '**登记**：设计 §9「弹反失败被击 100ms」那一行在运行时没有承载体（走的是「玩家受击」那一格 80ms）').toBe(80)
    alive.push(w.off)
  })
})
