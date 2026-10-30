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
 * KI-375：两个等待者不再叠在同一段弧上——「我在等」的走位第一次分得开。
 *
 * KI-371/373/374 让等待者绕圈、并且不朝主攻手转；可两个**位置重合**的等待者拿到同一份判据后
 * 仍是同向同速，绕着绕着粘成一具身体。本批让 Squad 每 tick 给每个等待者写「最近的另一个
 * 等待者在哪」与一个按排位奇偶的 tie-break；stepAround 在「离占槽者更远」之外再要求
 * 「离同伴更远」，两个候选一样远时按 tie-break 分开。没有同伴（或不在小队）⇒ 与 KI-374 一模一样。
 *
 * 四条腿：
 *  ① Squad 写最近同伴的位置，并按排位奇偶写 tie（1 ⇒ +1，2 ⇒ -1）；
 *  ② 两个重合的等待者 ⇒ 一秒后夹开 ≥ 0.2 rad，半径仍几乎不变；
 *  ③ 追尾：一个在前一个在后、两人的 tie 又把它们往对方身上推 ⇒ 二十 tick 里最小夹角
 *    不减反增（这一条读的是「同伴方位」本身，而不是奇偶）；
 *  ④ 对照组：摘掉同伴那一格（tie 都写 +1）⇒ 两人同向同速，夹角几乎不动。
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

const bearing = (e: Enemy, p: PlayerController): number => Math.atan2(e.pos.z - p.pos.z, e.pos.x - p.pos.x)
const gap = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
const distTo = (e: Enemy, p: PlayerController): number => Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z)

const R = 5
const OFF = 0.8

const sharedSpotRun = (withPeer: boolean) => {
  const squad = new Squad({ ...DEFAULT_SQUAD_CONFIG, maxAttackSlots: 1 })
  const p = fakePlayer()
  const h = enemyAt('h', R, 0)
  const a = enemyAt('a', R * Math.cos(OFF), R * Math.sin(OFF))
  const b = enemyAt('b', R * Math.cos(OFF), R * Math.sin(OFF))
  for (const e of [h, a, b]) {
    squad.register(e)
    squad.addThreat(e.id, 'player', e === h ? 100 : 20)
  }
  squad.update(1)
  if (!withPeer) for (const e of [a, b]) { e.squadPeerPos = null; e.squadOrbitTie = 1 }
  const r0 = [distTo(a, p), distTo(b, p)]
  const rhythm = rhythmOf()
  for (let i = 2; i <= 61; i++) for (const e of [a, b]) e.update(TICK_DT, i, p, rhythm, () => false)
  return {
    gap: gap(bearing(a, p), bearing(b, p)),
    radii: [distTo(a, p), distTo(b, p)],
    r0,
    ranks: [a.squadWaitRank, b.squadWaitRank],
  }
}


/** 都在远侧（2.4 / 2.6 rad）：占槽者判据会把两人一起推向 π，只有同伴方位能把后面那个按回去 */
const tailgateRun = (withPeer: boolean) => {
  const squad = new Squad({ ...DEFAULT_SQUAD_CONFIG, maxAttackSlots: 1 })
  const p = fakePlayer()
  const h = enemyAt('h', R, 0)
  const a = enemyAt('a', R * Math.cos(2.4), R * Math.sin(2.4))
  const b = enemyAt('b', R * Math.cos(2.6), R * Math.sin(2.6))
  for (const e of [h, a, b]) {
    squad.register(e)
    squad.addThreat(e.id, 'player', e === h ? 100 : 20)
  }
  squad.update(1)
  if (!withPeer) for (const e of [a, b]) { e.squadPeerPos = null; e.squadOrbitTie = 1 }
  const rhythm = rhythmOf()
  let minGap = gap(bearing(a, p), bearing(b, p))
  for (let i = 2; i <= 21; i++) {
    for (const e of [a, b]) e.update(TICK_DT, i, p, rhythm, () => false)
    minGap = Math.min(minGap, gap(bearing(a, p), bearing(b, p)))
  }
  return minGap
}

describe('KI-375 等待者之间的相位分离', () => {
  it('Squad 写最近同伴的位置与按排位奇偶的 tie', () => {
    const squad = new Squad({ ...DEFAULT_SQUAD_CONFIG, maxAttackSlots: 1 })
    const h = enemyAt('h', 5, 0)
    const a = enemyAt('a', 4.7, 1.9)
    const b = enemyAt('b', 4.4, 2.6)
    for (const e of [h, a, b]) {
      squad.register(e)
      squad.addThreat(e.id, 'player', e === h ? 100 : 20)
    }

    squad.update(1)

    expect([a.squadWaitRank, b.squadWaitRank], '一个在打、两个在等，排位 1／2').toEqual([1, 2])
    expect(a.squadPeerPos, '第一个等的人看见第二个').not.toBeNull()
    expect(a.squadPeerPos!.x).toBeCloseTo(b.pos.x, 6)
    expect(a.squadPeerPos!.z).toBeCloseTo(b.pos.z, 6)
    expect(b.squadPeerPos!.x).toBeCloseTo(a.pos.x, 6)
    expect([a.squadOrbitTie, b.squadOrbitTie], '排位 1 ⇒ +1，排位 2 ⇒ -1').toEqual([1, -1])
  })

  it('两个重合的等待者 ⇒ 一秒后夹开 ≥ 0.2 rad，半径几乎不变', () => {
    const run = sharedSpotRun(true)
    expect(run.ranks, '排位按登记顺序：1 与 2').toEqual([1, 2])
    expect(run.gap, '不再粘成一具身体').toBeGreaterThan(0.2)
    for (let i = 0; i < 2; i++) {
      expect(Math.abs(run.radii[i] - run.r0[i]), '分开仍走切向').toBeLessThan(0.4)
    }
  })

  it('远侧同行：占槽者判据推着两人相向，同伴方位把后面那个按回去', () => {
    expect(tailgateRun(true), '二十 tick 里从不贴到 0.15 rad 以内').toBeGreaterThan(0.15)
  })

  it('对照组：摘掉同伴那一格 ⇒ 同向同速，夹角几乎不动', () => {
    const run = sharedSpotRun(false)
    expect(run.gap, '没有同伴数据时两人仍是同一段弧').toBeLessThan(0.05)
  })
})
