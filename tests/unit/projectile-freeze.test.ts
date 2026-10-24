/**
 * ProjectileSystem 冻结腿守卫（src/combat/Projectiles.ts，§7.2 休止斩镜像到弹体）。
 *
 * 覆盖实测（v8 text reporter，src/combat）报 Projectiles.ts 100% 行但 83% branch，
 * 未取分支正是 `update` 里这一格（源码 195）：
 *
 *     if (p.frozenTicks > 0) { p.frozenTicks--; continue }
 *
 * `bossfreeze.test.ts` 量的 frozenTicks 是 **Boss 实体**那一格（`Enemy.frozenTicks`）；
 * **弹体**自己的 frozenTicks 从没有任何测试驱动过——`projectiles.test.ts` 只覆盖直线/重力/射程/
 * 寿命/穿透/reap/命中球。而这是真契约（源码注释）：冻结"只停运动学，不停命中判定"——
 * 一记停在半空的弹体是个看得见的障碍物，撞上去照样挨打（判定在 CombatManager，不在这）。
 *
 * 锁的要点：
 *   1. 冻结期间弹体**位置一动不动**、**不扣射程**、frozenTicks 递减、也不因射程/寿命被回收；
 *   2. 冻结是**逐弹体记账**而不是世界时钟——同屏另一发没冻的照常飞，冻结结束后这一发恢复推进；
 *   3. `prev` 记账：冻结那一 tick 走出的是**零长段**（prev==pos，不假装动过——遮挡判据量的是这一段）。
 */
import { describe, expect, it } from 'vitest'
import { TICK_DT } from '@/core/Time'
import { ProjectileSystem, type LaunchParams } from '@/combat/Projectiles'

const ORIGIN = { x: 0, y: 1.1, z: 0 }
function launch(over: Partial<LaunchParams> = {}): LaunchParams {
  return {
    hostile: false, ownerId: 'player', kind: 'spear', origin: { ...ORIGIN },
    dir: { x: 0, y: 0, z: 1 }, speed: 20, range: 20, radius: 0.4,
    damage: 30, poise: 20, hitStopMs: 100, ...over
  }
}
function run(s: ProjectileSystem, ticks: number, from = 0): void {
  for (let i = 0; i < ticks; i++) s.update(TICK_DT, from + i + 1)
}

describe('§7.2 休止斩镜像到弹体：冻结只停运动学', () => {
  it('冻结期间：位置不动、不扣射程、frozenTicks 递减、不被回收', () => {
    const s = new ProjectileSystem()
    const p = s.spawn(launch({ range: 5 }), 1)
    const z0 = p.pos.z
    const rl0 = p.rangeLeft
    p.frozenTicks = 3
    run(s, 3)
    expect(p.pos.z, '冻结期间位置一动不动').toBeCloseTo(z0, 6)
    expect(p.rangeLeft, '冻结期间不扣射程').toBeCloseTo(rl0, 6)
    expect(p.frozenTicks, '冻结计数递减到 0').toBe(0)
    expect(p.dead, '冻结期间不因射程到期被回收').toBe(false)
  })

  it('逐弹体记账，不是世界时钟：同屏另一发照常飞，冻结那发解冻后才追', () => {
    const s = new ProjectileSystem()
    const a = s.spawn(launch({ range: 1000 }), 1)
    const b = s.spawn(launch({ range: 1000 }), 1) // 冻结之后才出生的对照
    a.frozenTicks = 5
    b.frozenTicks = 0
    const aStart = a.pos.z
    run(s, 5)
    expect(a.pos.z, 'a 全程冻结，一步没走').toBeCloseTo(aStart, 6)
    expect(a.frozenTicks).toBe(0)
    expect(b.pos.z, 'b 没冻，正常飞了 5 tick').toBeCloseTo(5 * (20 / 60), 3)
    run(s, 1) // a 解冻，开始追
    expect(a.pos.z - aStart, '解冻后 a 恢复推进').toBeCloseTo(20 / 60, 3)
  })

  it('prev 记账：冻结那一 tick 走出的是零长段（不假装动过）', () => {
    const s = new ProjectileSystem()
    const p = s.spawn(launch({ range: 1000 }), 1)
    run(s, 2) // 先正常飞两 tick
    const before = { ...p.pos }
    p.frozenTicks = 1
    s.update(TICK_DT, 4)
    expect(p.pos.z, '冻结 tick 位置没动').toBeCloseTo(before.z, 6)
    expect(p.prev.z, 'prev==pos：这一 tick 是零长段').toBeCloseTo(before.z, 6)
  })

  it('kill 幂等：先前的消失原因说了算，重复 kill 不覆盖（源码 207）', () => {
    const s = new ProjectileSystem()
    const p = s.spawn(launch({ range: 1000 }), 1)
    s.kill(p, 'range')
    expect(p.gone).toBe('range')
    s.kill(p, 'hit') // 再杀一次：不改写
    expect(p.gone, '第一印象（range）不被后一发覆盖').toBe('range')
  })

  it('update 跳过已死弹体：死了就不再被积分（源码 189）', () => {
    const s = new ProjectileSystem()
    const p = s.spawn(launch({ range: 1000 }), 1)
    run(s, 2)
    const frozen = { ...p.pos }
    s.kill(p, 'hit')
    run(s, 5) // 死后继续 update
    expect(p.pos.z, '已死弹体不再被积分').toBeCloseTo(frozen.z, 6)
    expect(p.gone, 'gone 保持 hit，没被 update 改').toBe('hit')
  })
})
