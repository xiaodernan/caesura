import { describe, expect, it } from 'vitest'
import { GroundedSpearField } from '@/combat/GroundedSpears'

/**
 * `src/combat/GroundedSpears.ts`：落地的引针枪名册（docs/combat.md §4.3「按处决键拾回」的前提，
 * KI-006 剩余缺口①）——纯逻辑层，不 import three。
 *
 * 为什么需要名册而不是"弹体活着就不用捡"：弹体回收说的是「这发攻击结束」，
 * 枪躺在地上说的是「这件东西仍然在场、还能捡」。两件事不塞同一个容器。
 */

describe('GroundedSpearField：plant / list / live', () => {
  it('plant 返回枪（含递增 id、归一化 dir、plantedTick），list 记录它', () => {
    const f = new GroundedSpearField()
    const s1 = f.plant({ x: 1, y: 0.5, z: 2 }, { x: 3, y: 0, z: 4 }, 100)
    expect(s1.id).toBe(1)
    expect(s1.dir).toEqual({ x: 0.6, y: 0, z: 0.8 }) // 3-4-5 归一化
    expect(s1.pos).toEqual({ x: 1, y: 0.5, z: 2 })
    expect(s1.plantedTick).toBe(100)
    expect(f.live).toBe(1)
    expect(f.list()).toHaveLength(1)
  })

  it('seq 递增：每杆枪的 id 都不一样', () => {
    const f = new GroundedSpearField()
    const a = f.plant({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0)
    const b = f.plant({ x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 0)
    expect(b.id).toBe(a.id + 1)
  })

  it('dir 的 y 被丢弃（躺着的姿态只有 x/z 平面）', () => {
    const f = new GroundedSpearField()
    const s = f.plant({ x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 1 }, 0)
    expect(s.dir.y).toBe(0)
    expect(f.list()[0].dir.y).toBe(0)
  })

  it('dir 的长度为 0 ⇒ 归一化不会除以 0（|1| 保底）', () => {
    const f = new GroundedSpearField()
    const s = f.plant({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0)
    expect(Number.isFinite(s.dir.x)).toBe(true)
    expect(Number.isFinite(s.dir.z)).toBe(true)
  })
})

describe('GroundedSpearField：nearestWithin / remove / clear', () => {
  it('nearestWithin：只返回半径内、水平距离最近的那一杆；y 差不算', () => {
    const f = new GroundedSpearField()
    f.plant({ x: 10, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0) // 水平 10m
    f.plant({ x: 4, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0)  // 水平 4m
    f.plant({ x: 2, y: 100, z: 0 }, { x: 1, y: 0, z: 0 }, 0) // 水平 2m（y=100 的高度差不算）
    const best = f.nearestWithin({ x: 0, y: 0, z: 0 }, 5)
    expect(best).not.toBeNull()
    // 命中的是水平距离最小的那一杆
    expect(Math.hypot(best!.pos.x, best!.pos.z)).toBe(2)
  })

  it('nearestWithin：半径外无命中 ⇒ null', () => {
    const f = new GroundedSpearField()
    f.plant({ x: 5, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0)
    expect(f.nearestWithin({ x: 0, y: 0, z: 0 }, 2)).toBeNull()
  })

  it('remove：存在 ⇒ true；不存在 ⇒ false；移除后 live 减一', () => {
    const f = new GroundedSpearField()
    const s = f.plant({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0)
    expect(f.remove(s.id)).toBe(true)
    expect(f.live).toBe(0)
    expect(f.remove(s.id)).toBe(false)
  })

  it('clear：清空所有枪', () => {
    const f = new GroundedSpearField()
    f.plant({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0)
    f.plant({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0)
    f.clear()
    expect(f.live).toBe(0)
    expect(f.list()).toHaveLength(0)
  })
})
