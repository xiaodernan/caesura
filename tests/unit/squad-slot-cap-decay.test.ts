import { describe, expect, it } from 'vitest'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { AISystem } from '@/ai/AISystem'
import type { Enemy } from '@/ai/Enemy'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-379：仇恨衰减到 0 以后，「同屏最多 3 人同时出手」被绕过。
 *
 * KI-352 的闸门判的是「仇恨表非空」（`Enemy.tryAttack` 开头那一行），KI-352 当时的理由
 * 是「表还是空的那只不排队，否则开局第一眼就永远不动手」。可 `Squad.update` 每拍先把归零的
 * 仇恨清掉：`threatDecayPerTick` 默认 0.02，一笔 11 的仇恨约 550 拍（9.2 秒）掉光。之后
 * `squadThreats` 变空数组 ⇒ 闸门整道放行，四个人（三槽）全部同时出手，上限 3 只在开头九秒成立。
 *
 * 量法：四个漂调者围在玩家身边 1.2 米、全部进 combat、默认小队配置（3 槽），跑 1600 拍；
 * 每一拍数「正在出手」（`attack !== null`）的人数。第 1200 拍以后仇恨早该归零了。
 *
 * 三条腿：
 *  ① 闸门：1600 拍里每一次出手的人都占着槽位——没槽位的第 4 个人一次都不许出手；
 *  ② 队列还在：第 1600 拍仍有 4 个人留在名册里（3 个占槽、1 个在等）——不是靠「全体熄火」换来的上限；
 *  ③ 还在打：最后 400 拍照样有人出手，上限不是「谁都不动手」的副作用。
 *
 * 对照腿在 `squad-threat-gate.test.ts` ③：没进小队名册的敌人仇恨表恒空，照旧出手。
 */

registerGameData()

const fakePlayer = (x: number, z: number): PlayerController =>
  ({ pos: { x, y: 0, z }, hitTarget: () => ({ height: 1.7 }) }) as unknown as PlayerController

const driftBands = [{ min: 0, max: 99, actions: ['claw1'] }]

function arena(n: number) {
  const ai = new AISystem()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const player = fakePlayer(0, 0)
  const enemies: Enemy[] = []
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2
    const e = ai.spawn(
      'en_driftsinger',
      { x: Math.cos(ang) * 1.2, y: 0, z: Math.sin(ang) * 1.2 },
      'cap' + i,
    )
    e.data = { ...e.data, ai: { ...e.data.ai, distBands: driftBands } }
    e.alertness = 100
    e.enter('combat')
    enemies.push(e)
  }
  return { ai, rhythm, player, enemies }
}

const attackingCount = (enemies: Enemy[]): number =>
  enemies.filter((e) => e.alive && e.attack !== null).length

describe('KI-379 仇恨衰减到 0 以后槽位闸还在', () => {
  it('四人三槽跑 1600 拍：每一次出手都占着槽位，没有人凭「仇恨归零」混进去', () => {
    const w = arena(4)
    const freeAttackers: string[] = []
    let worst = 0
    let worstTick = 0
    for (let tick = 1; tick <= 1600; tick++) {
      w.ai.update(TICK_DT, tick, w.player, w.rhythm)
      w.rhythm.update(TICK_DT)
      const n = attackingCount(w.enemies)
      if (n > worst) {
        worst = n
        worstTick = tick
      }
      for (const e of w.enemies) {
        if (e.alive && e.attack !== null && !e.squadHasSlot) freeAttackers.push(e.id + '@' + tick)
      }
    }
    expect(freeAttackers.slice(0, 4), '没槽位的人不出手（前几个违例）').toEqual([])
    expect(worst, '同时出手最多三人（最坏在 ' + worstTick + ' 拍）').toBeLessThanOrEqual(3)
  })

  it('第 1600 拍队列还在：整段没有一拍掉到三人以下，三个占槽、一个在等', () => {
    const w = arena(4)
    let minRoster = 4
    let minTick = 0
    for (let tick = 1; tick <= 1600; tick++) {
      w.ai.update(TICK_DT, tick, w.player, w.rhythm)
      w.rhythm.update(TICK_DT)
      const n = w.enemies.filter((e) => e.squadThreats.length > 0).length
      if (n < minRoster) {
        minRoster = n
        minTick = tick
      }
    }
    expect(minRoster, '仇恨归零的那一拍名册也不许清空（最少在第 ' + minTick + ' 拍）').toBe(4)
    const onRoster = w.enemies.filter((e) => e.squadThreats.length > 0)
    const holding = w.enemies.filter((e) => e.squadHasSlot)
    expect(onRoster.length, '仇恨数值归零，人还在交战 ⇒ 名册上还是四个人').toBe(4)
    expect(holding.length, '三格槽位都有人占着').toBe(3)
    expect(
      onRoster.filter((e) => !e.squadHasSlot).length,
      '第四个人在等，不是整道放行',
    ).toBe(1)
    expect(
      w.enemies.filter((e) => e.squadWaitRank === 1).length,
      '第四个人还挂着「在等」的排位（KI-370 脚下环读的就是这一格）',
    ).toBe(1)
  })

  it('第 1200 拍以后仍有人在出手：上限不是靠全体熄火换来的', () => {
    const w = arena(4)
    let lateAttacks = 0
    for (let tick = 1; tick <= 1600; tick++) {
      w.ai.update(TICK_DT, tick, w.player, w.rhythm)
      w.rhythm.update(TICK_DT)
      if (tick > 1200 && attackingCount(w.enemies) > 0) lateAttacks++
    }
    expect(lateAttacks, '最后 400 拍里有人在出手').toBeGreaterThan(100)
  })
})
