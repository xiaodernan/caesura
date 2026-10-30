import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { Enemy } from '@/ai/Enemy'
import type { EnemyData } from '@/data/schema'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-371：等槽的人不站桩——在攻击带里绕圈。
 *
 * KI-370 给等待者脚下画了环，但那圈只能说明"我在等"；屏幕上的**走位**仍然和
 * "站着不动"一样（KI-358 还欠② 记的就是这一格）。本批让没拿到攻击槽位、
 * 且已经站在自己的攻击带里的敌人沿当前半径走切向一步：半径不变、仍走
 * `stepToward`（导航闸与拍隙定身原样生效），而占着槽的人不走这一支。
 *
 * 四条腿（KI-382 改口径：等的人只有「守自己的圈」这一支，不再按距离带贴脸）：
 *  ① 在等 ⇒ 绕圈：绕玩家转过的角 > 0.15 rad，半径几乎不变（不贴脸、不后退）；
 *  ② 不在等（仇恨表空）⇒ 不绕圈：位置一格不动（环与走位都不许凭空出现）；
 *  ③ chase 带 + 在等 ⇒ 走回 Squad 写的圈（2.1 米），不是直线追到玩家身上；
 *  ④ 对照组：chase 带 + 仇恨表空（不归小队管）⇒ 仍直线接近，方向不偏。
 */

registerGameData()

const fakePlayer = (x: number, z: number): PlayerController =>
  ({ pos: { x, y: 0, z } }) as unknown as PlayerController

const rhythmOf = (): RhythmClock => {
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  return rhythm
}

const enemyWith = (
  bands: { min: number; max: number; actions: string[] }[],
  id: string
): Enemy => {
  const base = registry.get<EnemyData>('en_driftsinger')
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

const distTo = (e: Enemy, p: PlayerController): number =>
  Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z)

const angleTo = (e: Enemy, p: PlayerController): number =>
  Math.atan2(e.pos.z - p.pos.z, e.pos.x - p.pos.x)

const turn = (a0: number, a1: number): number => Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)))

describe('KI-371 等槽者的绕圈（不是站桩）', () => {
  it('在等 ⇒ 沿当前半径绕圈：转过一个可读的角，半径几乎不变', () => {
    const e = enemyWith([{ min: 0, max: 99, actions: ['claw1'] }], 'orbit-wait')
    queued(e, false)
    const p = fakePlayer(0, 3)
    const rhythm = rhythmOf()
    const r0 = distTo(e, p)
    const a0 = angleTo(e, p)

    drive(e, p, rhythm, 60)

    const r1 = distTo(e, p)
    const a1 = angleTo(e, p)
    expect(e.attack, '没槽位 ⇒ 一次都不出手').toBeNull()
    expect(turn(a0, a1), '一秒里绕过一个可读的角（> 0.15 rad）').toBeGreaterThan(0.15)
    expect(Math.abs(r1 - r0), '切向走位，半径几乎不变（不贴脸也不后退）').toBeLessThan(0.4)
  })

  it('不在等（仇恨表空）⇒ 不绕圈：位置一格不动', () => {
    const e = enemyWith([{ min: 0, max: 99, actions: ['claw1'] }], 'orbit-free')
    const p = fakePlayer(0, 3)
    const rhythm = rhythmOf()
    const x0 = e.pos.x
    const z0 = e.pos.z

    drive(e, p, rhythm, 60)

    expect(e.pos.x, '没有仇恨 ⇒ 不走这一支').toBeCloseTo(x0, 6)
    expect(e.pos.z).toBeCloseTo(z0, 6)
  })

  it('还没进攻击带（chase 带）⇒ 等的人走回自己的圈，不站进出手位里', () => {
    const e = enemyWith(
      [
        { min: 0, max: 1.9, actions: ['claw1'] },
        { min: 1.9, max: 99, actions: ['chase'] },
      ],
      'orbit-chase'
    )
    queued(e, false)
    e.squadWaitRing = 2.1
    const p = fakePlayer(0, 6)
    const rhythm = rhythmOf()

    drive(e, p, rhythm, 240)

    const r = distTo(e, p)
    expect(r, 'chase 带里的等待者仍会靠近——圈在 2.1 米，不是 6 米').toBeLessThan(2.3)
    expect(r, '圈是底线：不站进自己的出手位里（KI-382）').toBeGreaterThan(1.75)
    expect(e.attack, '没槽位 ⇒ 一次都不出手').toBeNull()
  })

  it('对照组：chase 带 + 仇恨表空 ⇒ 仍直线接近，方向不偏', () => {
    const e = enemyWith(
      [
        { min: 0, max: 1.9, actions: ['claw1'] },
        { min: 1.9, max: 99, actions: ['chase'] },
      ],
      'orbit-chase-free'
    )
    const p = fakePlayer(0, 6)
    const rhythm = rhythmOf()
    const before = distTo(e, p)
    const a0 = angleTo(e, p)

    drive(e, p, rhythm, 60)

    expect(distTo(e, p), 'chase 带里仍是靠近（60 tick 里至少缩短 2 米）').toBeLessThan(before - 2)
    expect(turn(a0, angleTo(e, p)), '没有小队 ⇒ 只走直线接近').toBeLessThan(0.05)
  })
})
