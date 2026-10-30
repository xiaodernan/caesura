import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { Enemy } from '@/ai/Enemy'
import { DEFAULT_SQUAD_CONFIG, Squad } from '@/ai/Squad'
import type { EnemyData } from '@/data/schema'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-377：等待者的半径不再一路往里收；KI-382 后半径由**自己的圈**定。
 *
 * KI-371 的绕圈是「朝同半径的下一个角走」，可 stepToward 走的是弦：每 tick 都朝弦上的点迈一小步，
 * 半径就会一点点收。量出来的读数：同伴位置每 tick 更新时，三个等待者的半径 10 秒从 5.00 掉到
 * 1.85（约 0.53 m/s 的内旋）——等待者最后会站在玩家身上。
 *
 * KI-377 的修法是**弦亏补偿**：走完切向一步后，把半径沿径向补回这一步之前的值（每 tick 不到一厘米）；
 * 位移过大（击退／绕墙）时不补——下一 tick 的 r 自然就是新位置。KI-382 又把「等的人站哪」升级成
 * 一条**绝对圈**（排位 1 = 自己的近战够得着 2.1 米，每高一排再外让两具身宽），所以这里读的口径分两层：
 *  ①–③ 有圈时：各人收敛到自己的圈——不往怀里收、不被击退后瞬移、不同起手半径的人也不再守同一个常量；
 *  ④ 对照组摘掉圈（KI-377 原样）：弦亏补偿仍让半径一格不动，这是补半径那一支自己的账。
 */

registerGameData()

const fakePlayer = (): PlayerController => ({ pos: { x: 0, y: 0, z: 0 } }) as unknown as PlayerController

const rhythmOf = (): RhythmClock => {
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  return rhythm
}

const enemyAt = (id: string, x: number, z: number): Enemy => {
  const base = registry.get<EnemyData>('en_driftsinger')
  const e = new Enemy({ ...base, ai: { ...base.ai, distBands: [{ min: 0, max: 99, actions: ['claw1'] }] } }, { x, y: 0, z }, id)
  e.enter('combat')
  e.alertness = 100
  return e
}

const radiusOf = (e: Enemy): number => Math.hypot(e.pos.x, e.pos.z)

/** 反向臂：Squad 每拍同步完把圈与同伴格清掉——不改 Enemy，只摘掉 KI-382 的三格。 */
const withoutRing = <T,>(fn: () => T): T => {
  const original = Squad.prototype.update
  Squad.prototype.update = function (tick: number) {
    const out = original.call(this, tick)
    const members = (this as unknown as { members: Map<string, { enemy: Enemy }> }).members
    for (const m of members.values()) {
      m.enemy.squadWaitRing = 0
      m.enemy.squadNearPeers = []
      m.enemy.squadHolderBodies = []
    }
    return out
  }
  try {
    return fn()
  } finally {
    Squad.prototype.update = original
  }
}

describe('KI-377 等待者的绕圈半径不再一直往里收', () => {
  it('一人等 10 秒 ⇒ 收在自己的圈上，五秒后半径不再变', () => {
    const squad = new Squad({ ...DEFAULT_SQUAD_CONFIG, maxAttackSlots: 1 })
    const p = fakePlayer()
    const h = enemyAt('h', 6, 0)
    const a = enemyAt('a', 5, 0)
    for (const e of [h, a]) {
      squad.register(e)
      squad.addThreat(e.id, 'player', e === h ? 100 : 20)
    }
    const rhythm = rhythmOf()
    for (let i = 1; i <= 300; i++) {
      squad.update(i)
      for (const e of [h, a]) e.update(TICK_DT, i, p, rhythm, () => false)
    }
    const ring = a.squadWaitRing
    const r5 = radiusOf(a)
    for (let i = 301; i <= 600; i++) {
      squad.update(i)
      for (const e of [h, a]) e.update(TICK_DT, i, p, rhythm, () => false)
    }
    expect(ring, '排位 1 的圈 = 爪的最大判定半径').toBeCloseTo(2.1, 5)
    expect(r5, '不收进出手位（圈是底线）').toBeGreaterThan(1.75)
    expect(r5, '不越过自己的圈').toBeLessThan(ring + 0.05)
    expect(Math.abs(radiusOf(a) - r5), '五秒后半径不再变（没有内旋）').toBeLessThan(0.05)
  })

  it('两人起手半径不同（3 米与 7 米）⇒ 各守各的圈（2.1 / 4.1）', () => {
    const squad = new Squad({ ...DEFAULT_SQUAD_CONFIG, maxAttackSlots: 1 })
    const p = fakePlayer()
    const h = enemyAt('h', 6, 0)
    const a = enemyAt('a', 3 * Math.cos(0.6), 3 * Math.sin(0.6))
    const b = enemyAt('b', 7 * Math.cos(-2.2), 7 * Math.sin(-2.2))
    for (const e of [h, a, b]) {
      squad.register(e)
      squad.addThreat(e.id, 'player', e === h ? 100 : 20)
    }
    const rhythm = rhythmOf()
    for (let i = 1; i <= 600; i++) {
      squad.update(i)
      for (const e of [h, a, b]) e.update(TICK_DT, i, p, rhythm, () => false)
    }
    const ra = a.squadWaitRing
    const rb = b.squadWaitRing
    expect(ra, '近的圈').toBeCloseTo(2.1, 5)
    expect(rb, '远的圈（每高一排 +2 米）').toBeCloseTo(4.1, 5)
    expect(radiusOf(a), '近的守自己的圈，不收进出手位').toBeGreaterThan(1.75)
    expect(radiusOf(a)).toBeLessThan(ra + 0.05)
    expect(radiusOf(b), '远的也收在自己的圈上').toBeGreaterThan(rb - 0.4)
    expect(radiusOf(b)).toBeLessThan(rb + 0.05)
    expect(radiusOf(b) - radiusOf(a), '两个圈至少隔两具身宽').toBeGreaterThan(1.5)
  })

  it('等待中被击退 3.5 米 ⇒ 不瞬移，下一段从新位置走回自己的圈', () => {
    const squad = new Squad({ ...DEFAULT_SQUAD_CONFIG, maxAttackSlots: 1 })
    const p = fakePlayer()
    const h = enemyAt('h', 6, 0)
    const a = enemyAt('a', 5, 0)
    for (const e of [h, a]) {
      squad.register(e)
      squad.addThreat(e.id, 'player', e === h ? 100 : 20)
    }
    const rhythm = rhythmOf()
    squad.update(1)
    a.update(TICK_DT, 2, p, rhythm, () => false)

    a.pos.x = 1.5
    a.pos.z = 0
    a.update(TICK_DT, 3, p, rhythm, () => false)
    expect(radiusOf(a), '留在被打飞的地方，不瞬移回 5 米').toBeLessThan(2)

    for (let i = 4; i <= 303; i++) {
      squad.update(i)
      a.update(TICK_DT, i, p, rhythm, () => false)
    }
    const ring = a.squadWaitRing
    expect(radiusOf(a), '从新位置走回自己的圈（2.1），不是旧半径 5 米').toBeGreaterThan(1.75)
    expect(radiusOf(a)).toBeLessThan(ring + 0.05)
  })

  it('对照组：摘掉圈 ⇒ 弦亏补偿让半径十秒不动（KI-377 原样）', () => {
    const run = withoutRing(() => {
      const squad = new Squad({ ...DEFAULT_SQUAD_CONFIG, maxAttackSlots: 1 })
      const p = fakePlayer()
      const h = enemyAt('h', 6, 0)
      const a = enemyAt('a', 5, 0)
      for (const e of [h, a]) {
        squad.register(e)
        squad.addThreat(e.id, 'player', e === h ? 100 : 20)
      }
      const rhythm = rhythmOf()
      for (let i = 1; i <= 300; i++) {
        squad.update(i)
        for (const e of [h, a]) e.update(TICK_DT, i, p, rhythm, () => false)
      }
      const r5 = radiusOf(a)
      for (let i = 301; i <= 600; i++) {
        squad.update(i)
        for (const e of [h, a]) e.update(TICK_DT, i, p, rhythm, () => false)
      }
      return { r5, r10: radiusOf(a) }
    })
    expect(Math.abs(run.r10 - 5), '没有圈时起手 5 米就是圈').toBeLessThan(0.05)
    expect(Math.abs(run.r10 - run.r5), '五秒到十秒一格不动').toBeLessThan(0.05)
  })
})
