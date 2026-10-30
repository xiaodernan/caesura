import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { AISystem } from '@/ai/AISystem'
import { Enemy, lungeRoomToAllies } from '@/ai/Enemy'
import { DEFAULT_SQUAD_CONFIG, Squad, type SquadConfig } from '@/ai/Squad'
import type { EnemyData } from '@/data/schema'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-383：主攻手之间也有身体——两个人不再并着肩穿成一具。
 *
 * KI-382 的身体排斥只覆盖「等待者 vs 等待者」与「等待者 vs 占槽者」。可两名**占着槽**的主攻手
 * 在没出手时走的是同一条 `stepToward(玩家)`，前冲又一起扑向玩家中心：实测六人三槽 2400 拍里
 * 有 **951 个两两样本 <1.2 米、最低 0.841 米**（两具身体半径 0.5 + 0.5 ⇒ 1.0 米就已经穿模）。
 * 交接的那 3 拍 <1 米只是这条大账的尾巴。
 *
 * 裁决两层：
 *  ① **没出手时先让开**：`Squad` 给每个占槽者写 `squadSlotPeers`（其他占槽者，不含自己），
 *     `Enemy` 在一具半身宽（3 × 体格半径 = 1.5 米）内只走斥力的切向分量——距离带不动；
 *  ② **前冲不许穿过同伴**：`lungeRoomToAllies` 解出沿朝向到同伴接触线（2 × 体格半径 + 2 厘米）
 *     的第一个正根，对向两人同拍各走一半，拍的离散量不越过接触线。
 *
 * 腿：
 *  ① Squad 只给占槽者写同伴、等待者拿到空表；
 *  ② 两名占槽者起手 1.1 米 ⇒ 一秒内让到 1.4 米以上（切向，不推离距离带）；
 *  ③ 前冲截断的几何：同伴在前方 1.4 米 ⇒ 这一步最多 0.19 米；在身后不挡；已在接触线内 ⇒ 0；
 *  ④ 六人三槽 / 五人两槽 2400 拍：两两最小距 ≥1 米、出手拍不掉；
 *  ⑤ 反向臂：摘掉 `squadSlotPeers` ⇒ 0.844 米的穿模回来。
 */

registerGameData()

const fakePlayer = (x: number, z: number): PlayerController =>
  ({ pos: { x, y: 0, z }, hitTarget: () => ({ height: 1.7 }) }) as unknown as PlayerController

const rhythmOf = (): RhythmClock => {
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  return rhythm
}

const enemyAt = (id: string, x: number, z: number, actions: string[] = ['claw1']): Enemy => {
  const base = registry.get<EnemyData>('en_driftsinger')
  const e = new Enemy({ ...base, ai: { ...base.ai, distBands: [{ min: 0, max: 99, actions }] } }, { x, y: 0, z }, id)
  e.enter('combat')
  e.alertness = 100
  return e
}

function arena(n: number, config: Partial<SquadConfig> = {}) {
  const ai = new AISystem(config)
  const rhythm = rhythmOf()
  const player = fakePlayer(0, 0)
  const enemies: Enemy[] = []
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2
    const e = ai.spawn('en_driftsinger', { x: Math.cos(ang) * 1.6, y: 0, z: Math.sin(ang) * 1.6 }, 'p' + i)
    e.alertness = 100
    e.enter('combat')
    enemies.push(e)
  }
  return { ai, rhythm, player, enemies }
}

type Arm = 'slotPeers' | null

const withArm = <T,>(arm: Arm, fn: () => T): T => {
  if (!arm) return fn()
  const original = Squad.prototype.update
  Squad.prototype.update = function (tick: number) {
    const out = original.call(this, tick)
    const members = (this as unknown as { members: Map<string, { enemy: Enemy }> }).members
    for (const m of members.values()) if (arm === 'slotPeers') m.enemy.squadSlotPeers = []
    return out
  }
  try {
    return fn()
  } finally {
    Squad.prototype.update = original
  }
}

function run(n: number, config: Partial<SquadConfig> = {}, arm: Arm = null) {
  const w = arena(n, config)
  let min = Infinity
  let under1 = 0
  let attackTicks = 0
  withArm(arm, () => {
    for (let tick = 1; tick <= 2400; tick++) {
      w.ai.update(TICK_DT, tick, w.player, w.rhythm)
      w.rhythm.update(TICK_DT)
      if (w.enemies.some((e) => e.attack !== null)) attackTicks++
      for (let i = 0; i < w.enemies.length; i++) {
        for (let j = i + 1; j < w.enemies.length; j++) {
          const a = w.enemies[i].pos
          const b = w.enemies[j].pos
          const d = Math.hypot(a.x - b.x, a.z - b.z)
          if (d < min) min = d
          if (d < 1) under1++
        }
      }
    }
  })
  return { min, under1, attackPct: (100 * attackTicks) / 2400 }
}

describe('KI-383 主攻手之间也有身体', () => {
  it('Squad 只给占槽者写同伴；等待者拿到空表', () => {
    const squad = new Squad({ ...DEFAULT_SQUAD_CONFIG, maxAttackSlots: 2 })
    const members = [enemyAt('h1', 5, 0), enemyAt('h2', 4, 1), enemyAt('w1', 3, 2), enemyAt('w2', 2, 3)]
    for (const e of members) {
      squad.register(e)
      squad.addThreat(e.id, 'player', e.id.startsWith('h') ? 100 : 20)
    }
    squad.update(1)

    const holders = members.filter((e) => e.squadHasSlot)
    expect(holders, '两槽 ⇒ 两人占槽').toHaveLength(2)
    for (const e of holders) {
      expect(e.squadSlotPeers, '占槽者看得到另一位占槽者').toHaveLength(1)
      const other = holders.find((o) => o !== e)!
      expect(e.squadSlotPeers[0].x).toBeCloseTo(other.pos.x, 5)
      expect(e.squadSlotPeers[0].z).toBeCloseTo(other.pos.z, 5)
    }
    for (const e of members.filter((x) => !x.squadHasSlot)) {
      expect(e.squadSlotPeers, '等待者不读这一格').toEqual([])
    }
  })

  it('两名占槽者起手 1.1 米 ⇒ 一秒内让到 1.4 米以上（切向）', () => {
    const a = enemyAt('a', 0.55, 0, ['chase'])
    const b = enemyAt('b', -0.55, 0, ['chase'])
    a.squadHasSlot = true
    b.squadHasSlot = true
    const p = fakePlayer(0, 0)
    const rhythm = rhythmOf()
    const d0 = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)

    for (let i = 1; i <= 60; i++) {
      a.squadSlotPeers = [{ ...b.pos }]
      b.squadSlotPeers = [{ ...a.pos }]
      a.update(TICK_DT, i, p, rhythm, () => false)
      b.update(TICK_DT, i, p, rhythm, () => false)
    }

    const d1 = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)
    expect(d0).toBeCloseTo(1.1, 5)
    expect(d1, '一秒内让开一具半身宽，不再穿模').toBeGreaterThan(1.35)
    expect(d1, '让距有上限：不把两个人推成两支小队').toBeLessThan(1.8)
  })

  it('前冲截断几何：同伴在前方 1.4 米 ⇒ 这一步最多 0.19 米', () => {
    const base = registry.get<EnemyData>('en_driftsinger')
    const fake = {
      pos: { x: 0, y: 0, z: 0 },
      data: base,
      squadSlotPeers: [{ x: 1.4, y: 0, z: 0 }],
    } as unknown as Enemy

    expect(lungeRoomToAllies(fake, 1, 0, 0.5), '接触线 1.02 ⇒ 只走一半的余量').toBeCloseTo(0.19, 3)
    expect(lungeRoomToAllies(fake, -1, 0, 0.5), '同伴在身后不挡路').toBeCloseTo(0.5, 5)

    const inside = { ...fake, squadSlotPeers: [{ x: 0.9, y: 0, z: 0 }] } as unknown as Enemy
    expect(lungeRoomToAllies(inside, 1, 0, 0.5), '已经在接触线内 ⇒ 这一拍不再靠近').toBe(0)
  })

  it('六人三槽：2400 拍两两最小距 ≥1 米，出手拍不掉', () => {
    const r = run(6)
    expect(r.min, '两两最小距（全部配对，不只等待者）').toBeGreaterThan(0.99)
    expect(r.under1, '低于 1 米的样本').toBe(0)
    expect(r.attackPct, '身体排斥没有把出手冻住').toBeGreaterThan(96)
  })

  it('五人两槽：两名主攻手的间距同样守得住', () => {
    const r = run(5, { maxAttackSlots: 2 })
    expect(r.min).toBeGreaterThan(0.99)
    expect(r.under1).toBe(0)
    expect(r.attackPct).toBeGreaterThan(90)
  })

  it('反向臂：摘掉占槽同伴 ⇒ 0.844 米的穿模回来', () => {
    const r = run(6, {}, 'slotPeers')
    expect(r.under1, '没有这一格，前冲又从同伴身上穿过去').toBeGreaterThan(0)
    expect(r.min, '预测的 0.84 米量级').toBeLessThan(1)
  })
})
