import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { AISystem } from '@/ai/AISystem'
import { Enemy, corridorPush } from '@/ai/Enemy'
import { Squad } from '@/ai/Squad'
import type { EnemyData } from '@/data/schema'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-394：主攻手的攻击线上不许站人（KI-375 还欠①）。
 *
 * 量出来的现状：六人三槽 2400 拍里，等待者有 **818/7200 拍（11.4%）** 站在「占槽者→玩家」
 * 的线段一米内，最小横向距离 **0.004 米**（正压在线上）。这不是「相位撞车」——同一场景等待者
 * 之间的最小夹角 0.39 rad、没有一对低于 0.25，相位反而没问题；挡的是主攻手的攻击线。
 *
 * 裁决是一条**缓冲带**，不是贴到线上才推：线段半宽取一具身宽（2 × 体格半径 = 1 米），
 * 接管点提前到 1.4 米、目标推到 1.8 米；方向取**自己所在那一侧**的垂线（压线时按奇偶）。
 * 关键的一步是**合成**：刚被轮转下来的人半径常在 1.0 米、目标圈 6.1 米，每拍都被同伴斥力
 * 接管——通道若等斥力让完再算就永远轮不到。斥力 2 份 + 通道 1.5 份 + 回圈偏置一次走完，
 * 离圈远时用全速回位。修后**换人 40 拍以后的稳态遮挡 0**；换人过渡最长约 32 拍（0.5 秒）——
 * 新人从 2.6 米的外圈走进自己的圈，路上穿过一次主攻线，这是换位本身的代价，不是稳态站位。
 *
 * 腿：
 *  ① `corridorPush` 的几何：线左侧给 +z、右侧给 -z、远处/背后给 null；
 *  ② 离主攻线远的等待者，有没有这一格走得一模一样（不抢无关的人）；
 *  ③ 六人三槽：换人 40 拍以后稳态遮挡 0、总遮挡 <120 拍、最长连续 ≤32 拍，身体间距与出手不掉；
 *  ④ 反向臂：摘掉 `squadHolderBodies` ⇒ 稳态遮挡 1120 拍回来。
 */

registerGameData()

const base = registry.get<EnemyData>('en_driftsinger')

const fakePlayer = (x: number, z: number): PlayerController =>
  ({ pos: { x, y: 0, z }, hitTarget: () => ({ height: 1.7 }) }) as unknown as PlayerController

const rhythmOf = (): RhythmClock => {
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  return rhythm
}

const waiterAt = (x: number, z: number, holderBodies: { x: number; z: number }[]): Enemy => {
  const e = new Enemy({ ...base, ai: { ...base.ai, distBands: [{ min: 0, max: 99, actions: ['claw1'] }] } }, { x, y: 0, z }, 'w')
  e.enter('combat')
  e.alertness = 100
  e.squadThreats = [{ targetId: 'player', threat: 20, hasSlot: false, enteredAt: 1 }]
  e.squadHasSlot = false
  e.squadWaitRing = 2.1
  e.squadHolderBodies = holderBodies.map((p) => ({ x: p.x, y: 0, z: p.z }))
  return e
}

const corridorFake = (x: number, z: number, holders: boolean) =>
  ({
    pos: { x, y: 0, z },
    data: base,
    squadHolderBodies: holders ? [{ x: 3, y: 0, z: 0 }] : [],
    squadOrbitTie: 1,
  }) as unknown as Enemy

function arena(n: number) {
  const ai = new AISystem({})
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

type Arm = 'holderBodies' | null

const withArm = <T,>(arm: Arm, fn: () => T): T => {
  if (!arm) return fn()
  const original = Squad.prototype.update
  Squad.prototype.update = function (tick: number) {
    const out = original.call(this, tick)
    const members = (this as unknown as { members: Map<string, { enemy: Enemy }> }).members
    for (const m of members.values()) m.enemy.squadHolderBodies = []
    return out
  }
  try {
    return fn()
  } finally {
    Squad.prototype.update = original
  }
}

function run(arm: Arm = null) {
  const w = arena(6)
  let key = ''
  let changedAt = -1
  let occ = 0
  let steadyOcc = 0
  let minAll = Infinity
  let under1 = 0
  let attackTicks = 0
  let runTicks = 0
  let maxRunTicks = 0
  withArm(arm, () => {
    for (let tick = 1; tick <= 2400; tick++) {
      w.ai.update(TICK_DT, tick, w.player, w.rhythm)
      w.rhythm.update(TICK_DT)
      if (w.enemies.some((e) => e.attack !== null)) attackTicks++
      const k = w.enemies.map((e) => `${e.squadWaitRank}${e.squadHasSlot ? 's' : ''}`).join(',')
      if (k !== key) { key = k; changedAt = tick }
      const holders = w.enemies.filter((e) => e.squadHasSlot && e.alive)
      const waiters = w.enemies.filter((e) => e.squadWaitRank > 0 && e.alive)
      let blocked = false
      for (const waiter of waiters) {
        for (const holder of holders) {
          const vx = w.player.pos.x - holder.pos.x
          const vz = w.player.pos.z - holder.pos.z
          const t = ((waiter.pos.x - holder.pos.x) * vx + (waiter.pos.z - holder.pos.z) * vz) / (vx * vx + vz * vz)
          if (t <= 0.05 || t >= 0.95) continue
          const lat = Math.hypot(
            waiter.pos.x - (holder.pos.x + vx * t),
            waiter.pos.z - (holder.pos.z + vz * t),
          )
          if (lat < 1) {
            occ++
            blocked = true
            if (tick - changedAt > 40) steadyOcc++
          }
        }
      }
      if (blocked) {
        runTicks++
        if (runTicks > maxRunTicks) maxRunTicks = runTicks
      } else runTicks = 0
      for (let i = 0; i < w.enemies.length; i++) {
        for (let j = i + 1; j < w.enemies.length; j++) {
          const a = w.enemies[i].pos
          const b = w.enemies[j].pos
          const d = Math.hypot(a.x - b.x, a.z - b.z)
          if (d < minAll) minAll = d
          if (d < 1) under1++
        }
      }
    }
  })
  return { occ, steadyOcc, maxRunTicks, min: minAll, under1, attackPct: (100 * attackTicks) / 2400 }
}

describe('KI-394 主攻手的攻击线上不许站人', () => {
  it('corridorPush 几何：线两侧各推各的，远处与背后不推', () => {
    const target = { x: 0, y: 0, z: 0 }
    const left = corridorPush(corridorFake(1.5, 0.05, true), target)
    expect(left, '站在线的 +z 侧 ⇒ 往 +z 让').not.toBeNull()
    expect(left!.x).toBeCloseTo(0, 5)
    expect(left!.z).toBeCloseTo(1, 5)

    const right = corridorPush(corridorFake(1.5, -0.05, true), target)
    expect(right, '站在线的 -z 侧 ⇒ 往 -z 让').not.toBeNull()
    expect(right!.z).toBeCloseTo(-1, 5)

    expect(corridorPush(corridorFake(0, 2.5, true), target), '离线段 2.5 米 ⇒ 不管').toBeNull()
    expect(corridorPush(corridorFake(-1, 0.05, true), target), '站在玩家背后 ⇒ 不在线段上').toBeNull()
  })

  it('离主攻线远的等待者，有没有这一格走得一模一样', () => {
    const p = fakePlayer(0, 0)
    const rhythm = rhythmOf()
    const on = waiterAt(0, 2.5, [{ x: 3, z: 0 }])
    const off = waiterAt(0, 2.5, [])
    for (let i = 1; i <= 180; i++) {
      on.update(TICK_DT, i, p, rhythm, () => false)
      off.update(TICK_DT, i, p, rhythm, () => false)
    }
    expect(on.pos.x).toBeCloseTo(off.pos.x, 9)
    expect(on.pos.z).toBeCloseTo(off.pos.z, 9)
  })

  it('六人三槽：稳态遮挡 0，只剩交接的过渡拍', () => {
    const r = run()
    expect(r.steadyOcc, '轮转后 40 拍以外的遮挡').toBe(0)
    expect(r.occ, '全部遮挡样本（含交接过渡）').toBeLessThan(120)
    expect(r.maxRunTicks, '最长连续遮挡不超过 32 拍（0.5 秒）').toBeLessThanOrEqual(32)
    expect(r.min, '身体间距没有被通道规则推坏').toBeGreaterThan(0.99)
    expect(r.under1).toBe(0)
    expect(r.attackPct, '出手拍不掉').toBeGreaterThan(96)
  })

  it('反向臂：摘掉占槽者身体 ⇒ 稳态遮挡回来', () => {
    const r = run('holderBodies')
    expect(r.steadyOcc, '没有这一格，等待者又站回攻击线上').toBeGreaterThan(0)
    expect(r.occ).toBeGreaterThan(300)
  })
})
