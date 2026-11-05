import { describe, expect, it } from 'vitest'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { AISystem } from '@/ai/AISystem'
import { waitRingRadius, type Enemy } from '@/ai/Enemy'
import { Squad } from '@/ai/Squad'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-400：营地十几个人时，等待圈不许排到「放弃阵地」那条线外面。
 *
 * 病：`combat` 在 `dist > chaseBeyond`（缺省 12 米）那一格转 `chase`，而 `chase` 的脚是全速朝玩家。
 * KI-382 的圈是 `hold + (rank-1) * 4 × 体格半径`，排位 5 以上正好越过 12 米 ⇒ 这些等待者每拍被
 * 拽回脱手线内侧，最后全叠在 11 米那一条上（12 只营地 1800 拍里 5449 拍在 `chase`）。
 *
 * 裁决：圈的上限 = 脱手线再往里一条圈的间距（`chaseBeyond - 4 × 体格半径`），从数据推，不新造常数。
 * 多出来的排位共享最外那一圈，靠 KI-375–377 的相位与斥力分开。
 *
 * 腿：
 *  ① 几何：漂调者（近战 2.1、体格 0.5、脱手线 12）排位 1–12 ⇒ 2.1/4.1/6.1/8.1/10/10…，全部在 12 以内；
 *  ② 12 只 1800 拍：等待者 0 拍在 `chase`，末拍各自贴着自己的圈，两两 ≥1 米；
 *  ③ 真实营地 14 只混编：0 拍 `chase`，全员仍在战斗，出手没有冻住；
 *  ④ 反向臂：同一场把圈改回旧式（不设上限）⇒ `chase` 拍数回到数千，外圈仍然叠在 11 米。
 */

registerGameData()

const fakePlayer = (x: number, z: number): PlayerController =>
  ({ pos: { x, y: 0, z }, hitTarget: () => ({ height: 1.7 }) }) as unknown as PlayerController

function spawnRing(ids: string[], ring = 3) {
  const ai = new AISystem({ maxAttackSlots: 3 })
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const player = fakePlayer(0, 0)
  const enemies: Enemy[] = []
  for (let i = 0; i < ids.length; i++) {
    const ang = (i / ids.length) * Math.PI * 2
    const e = ai.spawn(ids[i], { x: Math.cos(ang) * ring, y: 0, z: Math.sin(ang) * ring }, 'camp' + i)
    e.alertness = 100
    e.enter('combat')
    enemies.push(e)
  }
  return { ai, rhythm, player, enemies }
}

const drift = (n: number): string[] => Array.from({ length: n }, () => 'en_driftsinger')

/** 反向臂：同一拍里把圈重写成旧式（无上限），其余判据一个字不动。 */
function withOldRings<T>(fn: () => T): T {
  const original = Squad.prototype.update
  Squad.prototype.update = function (tick: number): void {
    original.call(this, tick)
    for (const m of this.getAllMembers()) {
      if (m.waitRank <= 0) continue
      const e = m.enemy
      let hold = 0
      for (const atk of e.data.attacks ?? []) {
        const hb = atk.frames.hitbox
        const rad = hb && hb.shape !== 'ring' ? hb.radius : 0
        if (rad > hold) hold = rad
      }
      const body = 0.5 * (e.data.body?.scale ?? 1)
      e.squadWaitRing = hold + (m.waitRank - 1) * 4 * body
    }
  }
  try {
    return fn()
  } finally {
    Squad.prototype.update = original
  }
}

interface Reading {
  chaseTicks: number
  maxDist: number
  minWaiterGap: number
  attackTicks: number
  offRing: number
  states: string[]
  lastByRank: { rank: number; dist: number; ring: number }[]
}

function run(enemies: Enemy[], ai: AISystem, rhythm: RhythmClock, player: PlayerController, ticks = 1800): Reading {
  let chaseTicks = 0
  let attackTicks = 0
  let minWaiterGap = Infinity
  let offRing = 0
  let maxDist = 0
  for (let tick = 1; tick <= ticks; tick++) {
    ai.update(TICK_DT, tick, player, rhythm)
    rhythm.update(TICK_DT)
    if (enemies.some((e) => e.attack !== null)) attackTicks++
    const waiters = enemies.filter((e) => e.alive && e.squadWaitRank > 0)
    for (const e of waiters) if (e.state === 'chase') chaseTicks++
    if (tick > ticks - 300) {
      for (let i = 0; i < waiters.length; i++) {
        for (let j = i + 1; j < waiters.length; j++) {
          const a = waiters[i].pos
          const b = waiters[j].pos
          minWaiterGap = Math.min(minWaiterGap, Math.hypot(a.x - b.x, a.z - b.z))
        }
      }
      for (const e of waiters) {
        const d = Math.hypot(e.pos.x, e.pos.z)
        maxDist = Math.max(maxDist, d)
        if (e.squadWaitRing > 0 && Math.abs(d - e.squadWaitRing) > 0.25) offRing++
      }
    }
  }
  return {
    chaseTicks,
    maxDist,
    minWaiterGap,
    attackTicks,
    offRing,
    states: enemies.map((e) => e.state),
    lastByRank: enemies
      .filter((e) => e.squadWaitRank > 0)
      .map((e) => ({ rank: e.squadWaitRank, dist: +Math.hypot(e.pos.x, e.pos.z).toFixed(2), ring: e.squadWaitRing })),
  }
}

describe('KI-400 营地大排队：圈不许排到脱手线外', () => {
  it('几何：漂调者排位 1–12 的圈，全部落在脱手线以内', () => {
    const { enemies } = spawnRing(drift(12))
    const e = enemies[0]
    const rings = Array.from({ length: 12 }, (_, i) => waitRingRadius(e, i + 1))
    expect(rings.slice(0, 4).map((r) => +r.toFixed(2)), '前四圈仍是 KI-382 的两米间距').toEqual([2.1, 4.1, 6.1, 8.1])
    expect(rings.slice(4).every((r) => r === 10), '多出来的排位共享最外那一圈').toBe(true)
    const leash = e.data.ai.chaseBeyond ?? 12
    for (const r of rings) expect(r, '圈必须在脱手线以内').toBeLessThan(leash)
  })

  it('12 只 1800 拍：等待者一次 `chase` 都不进，末拍各自贴着圈', () => {
    const w = spawnRing(drift(12))
    const r = run(w.enemies, w.ai, w.rhythm, w.player)
    expect(r.chaseTicks, '等待不是追击').toBe(0)
    expect(r.attackTicks, '出手没有冻住').toBeGreaterThan(1200)
    expect(r.maxDist, '外圈不超过上限').toBeLessThanOrEqual(10.25)
    expect(r.minWaiterGap, '最外圈挤了六个人，仍不穿模').toBeGreaterThanOrEqual(1)
    expect(r.offRing / (300 * r.lastByRank.length), '稳态时绝大多数贴着自己的圈').toBeLessThan(0.25)
    for (const row of r.lastByRank) expect(Math.abs(row.dist - row.ring), `排位 ${row.rank}`).toBeLessThan(0.6)
    expect(r.states.every((s) => s === 'combat'), '三十秒后全员还在战斗态').toBe(true)
  })

  it('真实营地 14 只混编：0 拍 `chase`，射手仍守自己的距离', () => {
    const camp = [
      'en_murkshell', 'en_murkshell', 'en_murkshell', 'en_murkshell',
      'en_driftsinger', 'en_driftsinger', 'en_driftsinger', 'en_driftsinger',
      'en_skewer', 'en_skewer',
      'en_tympanus', 'en_phantome', 'en_refrein', 'en_hanged_knight',
    ]
    const w = spawnRing(camp)
    const r = run(w.enemies, w.ai, w.rhythm, w.player)
    expect(r.chaseTicks, '近战等待者不再被脱手线拽来拽去').toBe(0)
    expect(r.attackTicks).toBeGreaterThan(1200)
    expect(r.minWaiterGap, '混编也守身体间距').toBeGreaterThanOrEqual(1)
    expect(r.states.filter((s) => s === 'chase'), '没有谁掉进追击').toEqual([])
    for (const e of w.enemies) {
      if (e.squadWaitRing <= 0) continue
      const leash = e.data.ai.chaseBeyond ?? 12
      expect(e.squadWaitRing, `${e.data.id} 的圈也在自己的脱手线以内`).toBeLessThan(leash)
    }
    // 近战脱手线是缺省 12 的那一批（漂调者／嘈壳／驼鼓／悬钟骑士）：末拍都不许越过最外那一圈。
    const melee = w.enemies.filter((e) => e.squadWaitRing > 0 && (e.data.ai.chaseBeyond ?? 12) <= 12)
    expect(melee.length, '这一场确实有近战等待者').toBeGreaterThan(4)
    for (const e of melee) {
      expect(Math.hypot(e.pos.x, e.pos.z), `${e.data.id} 不越过近战最外圈`).toBeLessThanOrEqual(10.25)
    }
    const skewers = w.enemies.filter((e) => e.data.id === 'en_skewer')
    for (const s of skewers) {
      expect(Math.hypot(s.pos.x, s.pos.z), '射手站在自己的射程里，不在近战圈上').toBeGreaterThan(12)
    }
  })

  it('反向臂：不设上限 ⇒ `chase` 数千拍，外圈仍叠在 11 米', () => {
    const old = withOldRings(() => {
      const w = spawnRing(drift(12))
      return run(w.enemies, w.ai, w.rhythm, w.player)
    })
    expect(old.chaseTicks, '旧式圈把等待者推出脱手线').toBeGreaterThan(2000)
    const outer = old.lastByRank.filter((r) => r.ring > 12)
    expect(outer.length, '旧式圈确实有排位越过了 12 米').toBeGreaterThan(0)
    for (const row of outer) expect(row.dist, '越线的圈实际站不出去').toBeLessThan(11.5)
  })
})
