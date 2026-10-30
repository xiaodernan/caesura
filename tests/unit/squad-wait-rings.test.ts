import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { AISystem } from '@/ai/AISystem'
import { Squad, type SquadConfig } from '@/ai/Squad'
import type { EnemyData } from '@/data/schema'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-382：三个等待者不再走进彼此怀里——「等的人站在哪」第一次有了一条圈。
 *
 * KI-371–377 的等待者是**同一条圈**上的连续绕圈；KI-375/376 只给两个切向相位与拥挤退让，
 * 三个人时同圈反向走一圈必然迎面遇上两次。KI-382 的裁决：
 *   ① **各站自己的圈**：圈的基准是**自己的近战够得着**（攻击帧表里最大的 hitbox 半径——
 *      漂调者爪 2.1 米），每高一排再往外让**两具身宽**（4 × 体格半径 = 2 米，KI-376 同一把尺）。
 *      排位 1 站在够得着的边上，谁也不是站在出手位里等。
 *   ② **同伴有身体**：两米内不许再靠近任何一位等待者（把朝对方的步分量投影掉），
 *      主攻手的身体则只让一具身宽——轮转交接时他从圈里退出来，等的人给他让一步。
 * 圈是**绝对**目标（远了跟上来、近了退出去），所以玩家换位置时整条队跟着换。
 *
 * 腿：
 *  ① Squad 按排位写圈：2.1 / 4.1 / 6.1（数据推出来的，不是手写常数）；
 *  ②–④ 四人一槽 / 六人三槽 / 五人两槽，每人每拍量一遍：等待者两两从不低于 1 米；
 *  ⑤ 反向臂：摘掉主攻手的身体格 ⇒ 轮转交接那一刻又贴回 1 米以内；
 *  ⑥ 反向臂：摘掉圈 ⇒ 两个人还是会滑到彼此身上。
 */

registerGameData()

const fakePlayer = (x: number, z: number): PlayerController =>
  ({ pos: { x, y: 0, z }, hitTarget: () => ({ height: 1.7 }) }) as unknown as PlayerController

function arena(n: number, config: Partial<SquadConfig> = {}) {
  const ai = new AISystem(config)
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const player = fakePlayer(0, 0)
  const enemies = []
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2
    const e = ai.spawn('en_driftsinger', { x: Math.cos(ang) * 1.6, y: 0, z: Math.sin(ang) * 1.6 }, 'ring' + i)
    e.alertness = 100
    e.enter('combat')
    enemies.push(e)
  }
  return { ai, rhythm, player, enemies }
}

type Arm = 'holderBodies' | 'ring' | null

/** 反向臂：把 Squad 每拍写好的那一格清掉（同一条全流程，不改任何判据）。 */
function withArm<T>(arm: Arm, fn: () => T): T {
  if (!arm) return fn()
  const original = Squad.prototype.update
  Squad.prototype.update = function (tick: number): void {
    original.call(this, tick)
    for (const m of this.getAllMembers()) {
      if (arm === 'holderBodies') m.enemy.squadHolderBodies = []
      if (arm === 'ring') m.enemy.squadWaitRing = 0
    }
  }
  try {
    return fn()
  } finally {
    Squad.prototype.update = original
  }
}

function run(n: number, config: Partial<SquadConfig> = {}, arm: Arm = null) {
  const w = arena(n, config)
  const gaps: number[] = []
  const steady: number[] = []
  let under1 = 0
  let attackTicks = 0
  let key = ''
  let changedAt = -1
  for (let tick = 1; tick <= 2400; tick++) {
    w.ai.update(TICK_DT, tick, w.player, w.rhythm)
    w.rhythm.update(TICK_DT)
    if (w.enemies.some((e) => e.attack !== null)) attackTicks++
    const waiters = w.enemies.filter((e) => e.squadWaitRank > 0)
    const next = waiters.map((e) => e.id + ':' + e.squadWaitRank).sort().join(',')
    if (next !== key) { key = next; changedAt = tick }
    let min = Infinity
    for (let i = 0; i < waiters.length; i++) {
      for (let j = i + 1; j < waiters.length; j++) {
        const a = waiters[i].pos
        const b = waiters[j].pos
        min = Math.min(min, Math.hypot(a.x - b.x, a.z - b.z))
      }
    }
    if (min < Infinity) {
      gaps.push(min)
      if (min < 1) under1++
      if (tick - changedAt > 60) steady.push(min)
    }
  }
  const sorted = [...gaps].sort((a, b) => a - b)
  const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
  return {
    min: Math.min(...gaps),
    steadyMin: Math.min(...steady),
    p10: q(0.1),
    under1,
    attackPct: (100 * attackTicks) / 2400,
    finalRadii: w.enemies.filter((e) => e.squadWaitRank > 0).map((e) => Math.hypot(e.pos.x, e.pos.z)),
  }
}

describe('KI-382 等待者各站自己的圈', () => {
  it('Squad 按排位写圈：排位 1 = 自己的近战够得着，每高一排两具身宽', () => {
    const w = arena(4, { maxAttackSlots: 1 })
    w.ai.update(TICK_DT, 1, w.player, w.rhythm)
    const base = registry.get<EnemyData>('en_driftsinger')
    const hold = Math.max(...base.attacks.map((a) => a.frames.hitbox?.radius ?? 0))
    const body = 0.5 * (base.body?.scale ?? 1)
    expect(hold, '爪的最大判定半径（数据表）').toBeCloseTo(2.1, 5)
    const waiters = w.enemies.filter((e) => e.squadWaitRank > 0).sort((a, b) => a.squadWaitRank - b.squadWaitRank)
    expect(waiters.map((e) => e.squadWaitRing)).toEqual([hold, hold + 4 * body, hold + 8 * body])
    const holder = w.enemies.find((e) => e.squadHasSlot)!
    expect(holder.squadWaitRing, '占槽的人没有圈（他用自己的距离带）').toBe(0)
  })

  it('四人一槽：2400 拍逐拍采样，等待者两两从不低于 1 米', () => {
    const r = run(4, { maxAttackSlots: 1 })
    expect(r.steadyMin, '换人过渡之外的最小距').toBeGreaterThanOrEqual(1)
    expect(r.min, '最小距').toBeGreaterThanOrEqual(1)
    expect(r.under1, '低于 1 米的拍数').toBe(0)
    expect(r.p10, 'p10').toBeGreaterThanOrEqual(2)
    expect(r.attackPct, '圈没有把出手冻住').toBeGreaterThan(90)
    for (const radius of r.finalRadii) expect(radius, '结束时都站在自己的圈上（不是出手位）').toBeGreaterThan(1.75)
  })

  it('六人三槽：同一条圈上的人数更多，稳态读数不变', () => {
    const r = run(6)
    // 三槽 ⇒ 换人时可能有两人同时从出手位退下来（他们并肩出手时就已经在一米内），
    // 队列没法把既成事实一秒抹掉：稳态 ≥1 米，交接的那一拍登记在 KI-383（身体排斥要覆盖主攻手）。
    expect(r.steadyMin, '换人过渡之外的最小距').toBeGreaterThanOrEqual(1)
    expect(r.min, '交接瞬间还会有一次贴近').toBeGreaterThan(0.85)
    expect(r.p10).toBeGreaterThanOrEqual(2)
    expect(r.attackPct).toBeGreaterThan(80)
  })

  it('五人两槽：配置说了算，圈的间距不随人数变', () => {
    const r = run(5, { maxAttackSlots: 2 })
    expect(r.steadyMin, '换人过渡之外的最小距').toBeGreaterThanOrEqual(1)
    expect(r.min).toBeGreaterThanOrEqual(1)
    expect(r.under1).toBe(0)
    expect(r.p10).toBeGreaterThanOrEqual(2)
    expect(r.attackPct).toBeGreaterThan(80)
  })

  it('反向臂：摘掉主攻手的身体格 ⇒ 轮转交接时又贴回 1 米以内', () => {
    const r = withArm('holderBodies', () => run(4, { maxAttackSlots: 1 }))
    expect(r.under1, '交接那一刻的重叠回得来').toBeGreaterThan(0)
    expect(r.min).toBeLessThan(1)
  })

  it('反向臂：摘掉圈 ⇒ 等的人又站回自己的出手位里', () => {
    const r = withArm('ring', () => run(4, { maxAttackSlots: 1 }))
    // 圈管的是「站在哪」，不是「彼此隔多远」：摘掉它，身体排斥还在（所以不会再叠），
    // 但半径停在出手位置（0.8–1.0 米），正是 KI-382 量到的现状。
    expect(Math.min(...r.finalRadii), '没有圈就没人往外走').toBeLessThan(1.5)
  })
})
