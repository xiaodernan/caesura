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
 * KI-377：等待者不再「慢慢走进玩家怀里」——切向一步走弦收掉的半径，每 tick 补回来。
 *
 * KI-371 的绕圈是「朝同半径的下一个角走」，可 stepToward 走的是弦：每 tick 都朝弦上的点迈一小步，
 * 半径就会一点点收。量出来的读数：同伴位置每 tick 更新时，三个等待者的半径 10 秒从 5.00 掉到
 * 1.85（约 0.53 m/s 的内旋）——等待者最后会站在玩家身上。
 *
 * 裁决：这不是「锚一个起手半径」的问题（那个字段第一版加过、量下来行为与逐 tick 现推一模一样，
 * 只被一条书账腿读到 ⇒ 删掉），承重的是**弦亏补偿**：走完切向一步后，把半径沿径向补回这一步之前
 * 的值（每 tick 不到一厘米）；位移过大（击退／绕墙）时不补——下一 tick 的 r 自然就是新位置，
 * 不会把人拽回旧圈。
 *
 * 三条腿：
 *  ① 等 10 秒 ⇒ 半径几乎不动（旧代码掉 3.15 米）；
 *  ② 两个起手半径不同的人（3 米与 7 米）⇒ 各自守在起手半径，不是守一个常量；
 *  ③ 等待中被击退 3.5 米 ⇒ 不瞬移回旧圈，下一段就在新半径上绕。
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

describe('KI-377 等待者的绕圈半径不再一直往里收', () => {
  it('一人等 10 秒 ⇒ 半径几乎不动', () => {
    const squad = new Squad({ ...DEFAULT_SQUAD_CONFIG, maxAttackSlots: 1 })
    const p = fakePlayer()
    const h = enemyAt('h', 6, 0)
    const a = enemyAt('a', 5, 0)
    for (const e of [h, a]) {
      squad.register(e)
      squad.addThreat(e.id, 'player', e === h ? 100 : 20)
    }
    const rhythm = rhythmOf()
    const r0 = radiusOf(a)
    for (let i = 1; i <= 600; i++) {
      squad.update(i)
      for (const e of [h, a]) e.update(TICK_DT, i, p, rhythm, () => false)
    }
    expect(radiusOf(a) - r0, '十秒内不往玩家怀里收').toBeGreaterThan(-0.15)
    expect(radiusOf(a) - r0).toBeLessThan(0.15)
  })

  it('两人起手半径不同（3 米与 7 米）⇒ 各守各的，不守一个常量', () => {
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
    expect(Math.abs(radiusOf(a) - 3), '近的仍在 3 米').toBeLessThan(0.15)
    expect(Math.abs(radiusOf(b) - 7), '远的仍在 7 米').toBeLessThan(0.15)
  })

  it('等待中被击退 3.5 米 ⇒ 不瞬移回旧圈，下一段就在新半径上绕', () => {
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

    for (let i = 4; i <= 63; i++) a.update(TICK_DT, i, p, rhythm, () => false)
    expect(Math.abs(radiusOf(a) - 1.5), '下一段就在新半径上绕').toBeLessThan(0.15)
  })
})
