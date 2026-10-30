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
 * KI-376：第三个等待者不再和第一个叠在同一段弧上——「我在等」的走位第一次按排位让距。
 *
 * KI-375 的相位分离只有两个方向（奇偶 ⇒ ±0.4 rad），而「逆向绕圈、同速同半径」这件事
 * 在数学上恰好只承载两个相位：排位 1 与排位 3 都是 +1，重合起步的两个人会一路同轨
 * （实测 1 秒后夹角 0.000 rad）。本批裁决：**拥挤时按排位退让**——同奇偶、排位更高的等待者
 * 与最近同伴的距离小于 4×体格半径（两具身体 + 余量）时，径向后退一步（远离玩家）而不是切向走；
 * 让开之后恢复 KI-375 的绕圈。奇偶不同的两人由 KI-375 的相位分离负责，不走这条。
 *
 * 三条腿：
 *  ① Squad 写同伴的排位（与位置同一套「最近的一个」判据）；
 *  ② 三个重合的等待者 ⇒ 一秒后两两距离 ≥ 1 米，且一号位半径几乎不飘（他不让、仍在绕）；
 *  ③ 四人局里一号位最近的同伴是三号位 ⇒ 低排位不退（只有高的让），三号位退开；
 *  ④ 不拥挤（同伴 3 米外）⇒ 三号位照旧绕圈，半径不飘（这条闸不会被日常队形误触）。
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
const dist = (a: Enemy, b: Enemy): number => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)

const R = 5

const crowdRun = () => {
  const squad = new Squad({ ...DEFAULT_SQUAD_CONFIG, maxAttackSlots: 1 })
  const p = fakePlayer()
  const h = enemyAt('h', R, 0)
  const a = enemyAt('a', R * Math.cos(0.8), R * Math.sin(0.8))
  const b = enemyAt('b', R * Math.cos(0.8), R * Math.sin(0.8))
  const c = enemyAt('c', R * Math.cos(0.8), R * Math.sin(0.8))
  for (const e of [h, a, b, c]) {
    squad.register(e)
    squad.addThreat(e.id, 'player', e === h ? 100 : 20)
  }
  squad.update(1)
  const r0 = { a: radiusOf(a), c: radiusOf(c) }
  const rhythm = rhythmOf()
  for (let i = 2; i <= 61; i++) for (const e of [a, b, c]) e.update(TICK_DT, i, p, rhythm, () => false)
  return {
    ranks: [a.squadWaitRank, b.squadWaitRank, c.squadWaitRank],
    peerRanks: [a.squadPeerRank, b.squadPeerRank, c.squadPeerRank],
    gaps: [dist(a, b), dist(a, c), dist(b, c)],
    drift: { a: Math.abs(radiusOf(a) - r0.a), c: radiusOf(c) - r0.c },
    ties: [a.squadOrbitTie, b.squadOrbitTie, c.squadOrbitTie],
  }
}

const apartRun = () => {
  const squad = new Squad({ ...DEFAULT_SQUAD_CONFIG, maxAttackSlots: 1 })
  const p = fakePlayer()
  const h = enemyAt('h', R, 0)
  const a = enemyAt('a', R * Math.cos(0.8), R * Math.sin(0.8))
  const b = enemyAt('b', R * Math.cos(1.8), R * Math.sin(1.8))
  const c = enemyAt('c', R * Math.cos(2.6), R * Math.sin(2.6))
  for (const e of [h, a, b, c]) {
    squad.register(e)
    squad.addThreat(e.id, 'player', e === h ? 100 : 20)
  }
  squad.update(1)
  const r0 = { a: radiusOf(a), c: radiusOf(c) }
  const rhythm = rhythmOf()
  for (let i = 2; i <= 61; i++) for (const e of [a, b, c]) e.update(TICK_DT, i, p, rhythm, () => false)
  return { peerRanks: [a.squadPeerRank, b.squadPeerRank, c.squadPeerRank], drifts: [Math.abs(radiusOf(a) - r0.a), Math.abs(radiusOf(c) - r0.c)] }
}


/** 四人局：a(1) 与 c(3) 相距约 1 米，b(2)、d(4) 都在 8 米外——a 最近同伴是 c，c 最近同伴是 a */
const rankGateRun = () => {
  const squad = new Squad({ ...DEFAULT_SQUAD_CONFIG, maxAttackSlots: 1 })
  const p = fakePlayer()
  const h = enemyAt('h', R, 0)
  const a = enemyAt('a', R * Math.cos(0.8), R * Math.sin(0.8))
  const b = enemyAt('b', R * Math.cos(3.0), R * Math.sin(3.0))
  const c = enemyAt('c', R * Math.cos(1.0), R * Math.sin(1.0))
  const d = enemyAt('d', R * Math.cos(-2.6), R * Math.sin(-2.6))
  for (const e of [h, a, b, c, d]) {
    squad.register(e)
    squad.addThreat(e.id, 'player', e === h ? 100 : 20)
  }
  squad.update(1)
  const r0 = { a: radiusOf(a), c: radiusOf(c) }
  const rhythm = rhythmOf()
  for (let i = 2; i <= 61; i++) for (const e of [a, b, c, d]) e.update(TICK_DT, i, p, rhythm, () => false)
  return {
    ranks: [a.squadWaitRank, b.squadWaitRank, c.squadWaitRank, d.squadWaitRank],
    peerRanks: [a.squadPeerRank, c.squadPeerRank],
    drift: { a: radiusOf(a) - r0.a, c: radiusOf(c) - r0.c },
    gap: dist(a, c),
  }
}

describe('KI-376 三个等待者：拥挤时按排位退让', () => {
  it('Squad 写同伴的排位', () => {
    const squad = new Squad({ ...DEFAULT_SQUAD_CONFIG, maxAttackSlots: 1 })
    const h = enemyAt('h', 5, 0)
    const a = enemyAt('a', 4.7, 1.9)
    const b = enemyAt('b', 4.4, 2.6)
    for (const e of [h, a, b]) {
      squad.register(e)
      squad.addThreat(e.id, 'player', e === h ? 100 : 20)
    }

    squad.update(1)

    expect([a.squadPeerRank, b.squadPeerRank], '两个等的人互指').toEqual([2, 1])
    expect([a.squadOrbitTie, b.squadOrbitTie]).toEqual([1, -1])
  })

  it('三个重合的等待者 ⇒ 一秒后两两 ≥ 1 米，一号位仍在绕圈', () => {
    const run = crowdRun()
    expect(run.ranks, '一个在打、三个在等').toEqual([1, 2, 3])
    expect(run.ties, '排位 3 与排位 1 同号——正是这一批要修的那一格').toEqual([1, -1, 1])
    for (let i = 0; i < 3; i++) expect(run.gaps[i], '身体不再重叠（接触距离 1 米）').toBeGreaterThan(1)
    expect(run.drift.a, '排位 1 不后退').toBeLessThan(0.4)
    expect(run.drift.c, '排位 3 真的退开了').toBeGreaterThan(1)
  })

  it('四人局：低排位不退、高排位退开', () => {
    const run = rankGateRun()
    expect(run.ranks, '一个在打、四个在等').toEqual([1, 2, 3, 4])
    expect(run.peerRanks, '两人互指').toEqual([3, 1])
    expect(run.drift.a, '一号位不因为身边站着三号位就退').toBeLessThan(0.4)
    expect(run.drift.c, '三号位退开').toBeGreaterThan(1)
    expect(run.gap, '一米贴到两米外').toBeGreaterThan(2)
  })

  it('不拥挤：同伴 3 米外 ⇒ 三号位照旧绕圈，半径不飘', () => {
    const run = apartRun()
    for (const d of run.drifts) expect(d, '日常队形不触发退让').toBeLessThan(0.4)
    expect(run.peerRanks, '三号位最近的同伴是排位 2').toEqual([2, 3, 2])
  })
})
