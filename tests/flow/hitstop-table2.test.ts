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
 * KI-241：**§9 命中停顿那张表剩下的几行**第一次在真链上被量（KI-239 量了守方四行 ＋ 轻击那一行）。
 *
 * | 重击/尾段命中 | 90ms | 6f |
 * | 蓄力重击命中 | 120ms | 8f |
 * | 处决首刀 | 180ms | 11f |
 *
 * 读数：事件里的 `hitStopMs` ＋ **时间标掉下去的幅度**。
 *
 * **腿里手钉的是设计那一行的数**（90／120／180），**不读数据表**——读表的话表一改腿也跟着改
 * ⇒ 那一格就没人守了（KI-239 那一批的头一稿就栽在这儿）。
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
      time.step(TICK_DT) // 真实时间照走（hitStop 的坡道靠它收）
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

describe('KI-241 §9 命中停顿那张表剩下的几行：重击 90／蓄力 120／处决首刀 180', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  /** 敌人站在正前方 1.6m，玩家打它一记 */
  function strike(w: World, mode: 'heavy' | 'charged'): void {
    const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -1.6 }, 'prey')
    e.alertness = 0
    e.enter('idle')
    const p = w.player
    p.pos = { x: 0, y: 0, z: 0 }
    p.yaw = Math.PI
    p.camYawRef = Math.PI + p.yaw
    if (mode === 'heavy') {
      w.frame.held.add('attackHeavy') // 按住不足 8 拍 ⇒ 松手出的是「重击 H」
      for (let i = 0; i < 5; i++) w.tick()
      w.frame.held.delete('attackHeavy')
      w.tick()
    } else {
      w.frame.held.add('attackHeavy') // 按满蓄力 ⇒ 松手出的是「蓄力重击」
      for (let i = 0; i < 60; i++) w.tick()
      w.frame.held.delete('attackHeavy')
      w.tick()
    }
    for (let i = 0; i < 60 && w.hits.length === 0; i++) w.tick()
  }

  it('腿① 重击命中 → 90ms（§9「重击/尾段命中 90ms」）', () => {
    const w = makeWorld()
    strike(w, 'heavy')
    expect(w.hits[0], '重击那一记打到了敌人').toBeTruthy()
    expect(w.hits[0]!.hitStopMs, '重击命中那一行的停顿（设计 §9「重击/尾段命中 90ms」）').toBe(90)
    expect(w.time.rawScale, '时间标同时掉下去').toBeLessThan(1)
    alive.push(w.off)
  })

  it('腿② 蓄力重击命中 → 120ms（§9「蓄力重击命中 120ms」）', () => {
    const w = makeWorld()
    strike(w, 'charged')
    expect(w.hits[0], '蓄力重击那一记打到了敌人').toBeTruthy()
    expect(w.hits[0]!.hitStopMs, '蓄力重击命中那一行的停顿（设计 §9「蓄力重击命中 120ms」）').toBe(120)
    alive.push(w.off)
  })

  it('腿③ 处决首刀 → 180ms（§9「处决首刀 180ms」）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -1.6 }, 'prey')
    e.alertness = 0
    e.enter('idle')
    e.stats.crumpleTicksLeft = 60 // 破势中 ⇒ 触发条件 A
    const p = w.player
    p.pos = { x: 0, y: 0, z: 0 }
    p.yaw = Math.PI
    p.camYawRef = Math.PI + p.yaw
    w.frame.edges.add('interact')
    w.tick()
    w.frame.edges.delete('interact')
    for (let i = 0; i < 30 && w.hits.length === 0; i++) w.tick()
    expect(w.hits[0], '处决那一刀落下').toBeTruthy()
    expect(w.hits[0]!.hitStopMs, '处决首刀那一行的停顿（设计 §9「处决首刀 180ms」）').toBe(180)
    alive.push(w.off)
  })
})
