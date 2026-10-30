import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { Enemy } from '@/ai/Enemy'
import type { EnemyData } from '@/data/schema'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-373：射手带的等待者也绕圈（KI-371 还欠②）。
 *
 * KI-371 让没槽的人在**自己的攻击带**里沿当前半径走切向，但把 `backstep` 带整条排除在外——
 * 射手带的等待者仍只背退。本批先量一件事：**背退与绕圈叠在一起会互相抵消还是叠成外螺旋**。
 * 量出来的口径：叠成外螺旋（半径每 tick 都在涨），一分钟就退出射程；所以等待者**让出背退**、
 * 只绕圈（半径不飘），拿到槽位那一刻立刻恢复风筝。
 *
 * 五条腿：
 *  ① 射手带 + 在等 ⇒ 绕圈且半径几乎不变（不退出射程）；
 *  ② 射手带 + 占着槽 ⇒ 照旧背退：距离拉开、方向不偏；
 *  ③ 射手带 + 仇恨表空（没排队）⇒ 照旧背退：这是「不归小队管」而不是「在等」；
 *  ④ 普通攻击带 + 在等 ⇒ 仍绕圈（KI-371 原样）；
 *  ⑤ chase 带 + 在等 ⇒ 仍直线接近（KI-371 原样）。
 */

registerGameData()

const fakePlayer = (x: number, z: number): PlayerController =>
  ({ pos: { x, y: 0, z } }) as unknown as PlayerController

const rhythmOf = (): RhythmClock => {
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  return rhythm
}

const enemyWith = (bands: { min: number; max: number; actions: string[] }[], id: string): Enemy => {
  const base = registry.get<EnemyData>('en_skewer')
  const e = new Enemy({ ...base, ai: { ...base.ai, distBands: bands } }, { x: 0, y: 0, z: 0 }, id)
  e.enter('combat')
  e.alertness = 100
  return e
}

const queued = (e: Enemy, hasSlot: boolean): void => {
  e.squadThreats = [{ targetId: 'player', threat: 20, hasSlot, enteredAt: 1 }]
  e.squadHasSlot = hasSlot
}

const drive = (e: Enemy, player: PlayerController, rhythm: RhythmClock, ticks: number): void => {
  for (let i = 1; i <= ticks; i++) e.update(TICK_DT, i, player, rhythm, () => false)
}

const distTo = (e: Enemy, p: PlayerController): number => Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z)
const angleTo = (e: Enemy, p: PlayerController): number => Math.atan2(e.pos.z - p.pos.z, e.pos.x - p.pos.x)
const turn = (a0: number, a1: number): number => Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)))

const ARCHER = [{ min: 0, max: 99, actions: ['backstep'] }]

describe('KI-373 射手带的等待者：绕圈，而不是退出射程', () => {
  it('射手带 + 在等 ⇒ 沿当前半径绕圈，半径几乎不变', () => {
    const e = enemyWith(ARCHER, 'archer-wait')
    queued(e, false)
    const p = fakePlayer(0, 5)
    const rhythm = rhythmOf()
    const r0 = distTo(e, p)
    const a0 = angleTo(e, p)

    drive(e, p, rhythm, 60)

    expect(turn(a0, angleTo(e, p)), '一秒里绕过一个可读的角（> 0.15 rad）').toBeGreaterThan(0.15)
    expect(Math.abs(distTo(e, p) - r0), '半径不飘：等待者不退出射程').toBeLessThan(0.4)
  })

  it('射手带 + 占着槽 ⇒ 照旧背退：距离拉开、方向不偏', () => {
    const e = enemyWith(ARCHER, 'archer-slot')
    queued(e, true)
    const p = fakePlayer(0, 5)
    const rhythm = rhythmOf()
    const r0 = distTo(e, p)
    const a0 = angleTo(e, p)

    drive(e, p, rhythm, 60)

    expect(distTo(e, p), '拿到槽位的射手仍背退拉弓').toBeGreaterThan(r0 + 1.5)
    expect(turn(a0, angleTo(e, p)), '背退是径向的，方向不许偏').toBeLessThan(0.05)
  })

  it('射手带 + 仇恨表空（没排队）⇒ 照旧背退', () => {
    const e = enemyWith(ARCHER, 'archer-free')
    const p = fakePlayer(0, 5)
    const rhythm = rhythmOf()
    const r0 = distTo(e, p)

    drive(e, p, rhythm, 60)

    expect(distTo(e, p), '不在小队里 ⇒ 这不是「在等」，背退照旧').toBeGreaterThan(r0 + 1.5)
  })

  it('普通攻击带 + 在等 ⇒ 仍绕圈（KI-371 原样）', () => {
    const e = enemyWith([{ min: 0, max: 99, actions: ['claw1'] }], 'archer-melee-wait')
    queued(e, false)
    const p = fakePlayer(0, 5)
    const rhythm = rhythmOf()
    const r0 = distTo(e, p)
    const a0 = angleTo(e, p)

    drive(e, p, rhythm, 60)

    expect(turn(a0, angleTo(e, p))).toBeGreaterThan(0.15)
    expect(Math.abs(distTo(e, p) - r0)).toBeLessThan(0.4)
  })

  it('chase 带 + 在等 ⇒ 仍直线接近（KI-371 原样）', () => {
    const e = enemyWith([{ min: 0, max: 99, actions: ['chase'] }], 'archer-chase-wait')
    queued(e, false)
    const p = fakePlayer(0, 8)
    const rhythm = rhythmOf()
    const r0 = distTo(e, p)
    const a0 = angleTo(e, p)

    drive(e, p, rhythm, 60)

    expect(distTo(e, p), 'chase 带里仍是靠近').toBeLessThan(r0 - 2)
    expect(turn(a0, angleTo(e, p)), '方向不许被绕圈带偏').toBeLessThan(0.05)
  })
})
