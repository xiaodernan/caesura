import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { Rng } from '@/core/Math'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { bus } from '@/core/EventBus'

/**
 * KI-233：**§11 震裂那套规则剩下的几格**第一次在真链上被量
 * （`data/json/statuses.json > fissure`：`dmgMulPerLayer 0.04`／`idleTicks 600`／`decayEveryTicks 120`）。
 *
 * | 每层 +4% 伤害 | 敌人身上的裂纹让它**多挨**那一记（`dmgMulPerLayer` 0.04） |
 * | 衰减 | 「10s 内没有新增」→ 掉第一层 → 之后每 2s 一层 |
 *
 * 真链：真 `PlayerController` ＋ 真 `Enemy` ＋ 真 `CombatManager` ＋ 真事件；
 * 敌人被钉住（不许它挨完打之后走开 ⇒ 下一记才打得着）。
 *
 * **腿里手钉的是设计／数据那一行的数**（4%／600 拍／120 拍），不随数据表改。
 */

registerGameData()

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(60, 1)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  const off = bus.on('combat.hit', () => { /* 那一记真的落在敌人身上就够读了 */ })

  /** 每拍都会调用一次的钉子（把敌人钉在原地 ⇒ 它挨完打不会走开，下一记才打得着） */
  const hook = { pin: (): void => { /* 默认不钉 */ } }

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset()
      hook.pin()
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, frame, tick, off, hook }
}

type World = ReturnType<typeof makeWorld>

describe('KI-233 §11 震裂那套规则剩下的几格：每层 +4% 伤害 ＋ 两段式衰减', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  /** 一只被钉住的杂兵，站在玩家正前方 1.6m */
  function prey(w: World) {
    const e = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -1.6 }, 'prey')
    e.alertness = 0
    e.enter('idle')
    const p = w.player
    p.pos = { x: 0, y: 0, z: 0 }
    p.yaw = Math.PI
    p.camYawRef = Math.PI + p.yaw
    w.hook.pin = () => { e.pos.x = 0; e.pos.z = -1.6; e.yaw = 0 }
    return e
  }

  /**
   * 打一记重击，等它落地 ＋ 等这一式收完（收势 63 拍 ⇒ 不等的话下一记根本出不来）。
   * **随机种子每次重置** ⇒ 两次量到的结算方差是同一格 ⇒ 差出来的就是那一格倍率。
   */
  function heavyHit(w: World, e: ReturnType<World['ai']['spawn']>): { dmg: number; addTick: number } {
    const p = w.player
    p.stats.stamina = p.stats.staMax
    w.combat.rng = new Rng('ki233')
    const hp0 = e.stats.hp
    w.frame.held.add('attackHeavy')
    for (let k = 0; k < 5; k++) w.tick()
    w.frame.held.delete('attackHeavy')
    w.tick()
    for (let i = 0; i < 90 && e.stats.hp === hp0; i++) w.tick()
    const dmg = hp0 - e.stats.hp
    const addTick = w.time.tick
    for (let i = 0; i < 120 && p.action; i++) w.tick()
    return { dmg, addTick }
  }

  it('腿① 每层 +4% 伤害：同样那一记，敌人身上有 1 层裂纹时更疼', () => {
    // 对照：0 层裂纹
    const plain = makeWorld()
    const e0 = prey(plain)
    const first = heavyHit(plain, e0)
    const dmg0 = first.dmg
    alive.push(plain.off)

    // 对照组：先挂 1 层（挂法：打一记重击 —— KI-231 那批量过），再打**同样那一记**
    const cracked = makeWorld()
    const e1 = prey(cracked)
    heavyHit(cracked, e1)
    expect(e1.stats.fissureLayers, '前提：敌人身上挂了 1 层裂纹').toBe(1)
    const dmg1 = heavyHit(cracked, e1).dmg
    alive.push(cracked.off)

    expect(dmg0, '前提：0 层裂纹的那一记打疼了敌人').toBeGreaterThan(0)
    expect(dmg1, '1 层裂纹 ⇒ 那一记更疼（`dmgMulPerLayer` 0.04）').toBeGreaterThan(dmg0)
    expect(dmg1 - dmg0, '……多挨的那一点（4% 落在这一记的取整上 ⇒ 至少 1 点）').toBeGreaterThanOrEqual(1)
  })

  it('腿② 衰减第一段：挂上 1 层 ⇒ 约 10s（600 拍）没有新增 ⇒ 掉第一层', () => {
    const w = makeWorld()
    const e = prey(w)
    const { addTick } = heavyHit(w, e)
    expect(e.stats.fissureLayers, '前提：那一记给敌人挂了 1 层').toBe(1)
    // 找到层数归零的那一拍
    let dropTick = -1
    for (let i = 0; i < 900 && dropTick < 0; i++) {
      w.tick()
      if (e.stats.fissureLayers === 0) dropTick = w.time.tick
    }
    expect(dropTick, '那层到底掉了（900 拍内）').toBeGreaterThan(0)
    const gap = dropTick - addTick
    expect(gap, '掉层的那一拍 ＝ 挂上那一拍 ＋ 600（设计 §11：第一段是 10s ＝ 600 拍；容差给结算那一拍的先后）')
      .toBeGreaterThan(590)
    expect(gap, '……也不许更晚').toBeLessThan(615)
    alive.push(w.off)
  })

  it('腿③ 衰减第二段：第一层掉完之后 ⇒ 每 2s（120 拍）再掉一层', () => {
    const w = makeWorld()
    const e = prey(w)
    const { addTick } = heavyHit(w, e)
    e.stats.fissureLayers = 2 // 两层（怎么挂上去的，KI-231 那批量过）
    let first = -1
    let second = -1
    for (let i = 0; i < 1200 && second < 0; i++) {
      w.tick()
      if (first < 0 && e.stats.fissureLayers === 1) first = w.time.tick
      if (first >= 0 && e.stats.fissureLayers === 0) second = w.time.tick
    }
    expect(first, '第一层掉了（第一段走完）').toBeGreaterThan(0)
    expect(second, '第二层也掉了').toBeGreaterThan(0)
    expect(first - addTick, '第一层掉的那一拍 ＝ 挂上那一拍 ＋ 600').toBeGreaterThan(590)
    expect(first - addTick, '……也不许更晚').toBeLessThan(615)
    expect(second - first, '第二层掉的那一拍 ＝ 第一层掉的那一拍 ＋ 120（设计 §11：之后每 2s 一层）')
      .toBeGreaterThan(115)
    expect(second - first, '……也不许更晚').toBeLessThan(128)
    alive.push(w.off)
  })
})
