import { describe, expect, it } from 'vitest'
import { shapeHits, type HitTarget } from '@/combat/HitShapes'
import type { HitboxSphere } from '@/data/schema'

/**
 * shapeHits 的球形分支第一次有直接读者（此前全模块只有 bandDamage 有）。
 * 球心的两把尺子钉在这里：水平由 yaw 给（x 取 sin、z 取 cos——yaw=0 即 +Z），
 * 垂直由 offsetY 与目标中点比；判距是三维 hypot，阈值为 box.radius + target.radius 的 ≤。
 * 锥形与环形两支各有消费方（CombatManager / damagezones），此处不重复。
 */

const origin = { x: 0, y: 0, z: 0 }
const target = (pos: { x: number; y: number; z: number }, over: Partial<HitTarget> = {}): HitTarget =>
  ({ pos, facingYaw: 0, radius: 0.5, height: 2, ...over })
const box = (over: Partial<HitboxSphere> = {}): HitboxSphere =>
  ({ shape: 'sphere', radius: 2, offsetY: 0, offsetFwd: 4, ...over })

describe('shapeHits：sphere 分支', () => {
  it('yaw=0 球心在 +Z 前方 offsetFwd 处：正前方在界内，正后方够不着', () => {
    expect(shapeHits(box(), origin, 0, target({ x: 0, y: 0, z: 5 }))).toBe(true)
    expect(shapeHits(box(), origin, 0, target({ x: 0, y: 0, z: -5 }))).toBe(false)
  })

  it('yaw=π/2 球心跟到 +X：前方照中、侧面出界——offsetFwd 沿朝向不沿世界轴', () => {
    expect(shapeHits(box(), origin, Math.PI / 2, target({ x: 5, y: 0, z: 0 }))).toBe(true)
    expect(shapeHits(box(), origin, Math.PI / 2, target({ x: 0, y: 0, z: 5 }))).toBe(false)
  })

  it('垂直也进判距：目标悬在头顶（水平在界内）照样 miss；offsetY 抬球心可对齐', () => {
    // 目标中点 y = 10 + 1 = 11，球心 y = offsetY = 0 ⇒ dy = 11 > 2.5
    expect(shapeHits(box(), origin, 0, target({ x: 0, y: 10, z: 4 }))).toBe(false)
    // offsetY=1 把球心抬到与目标中点同高 ⇒ dy = 0，回到纯水平判
    expect(shapeHits(box({ offsetY: 1 }), origin, 0, target({ x: 0, y: 0, z: 4 }))).toBe(true)
  })

  it('阈值是 radius + target.radius 的 ≤：恰好贴边算中，出半米就脱靶', () => {
    const b = box({ offsetY: 1 })
    // dy=0、dz = 2.5 = 2 + 0.5 恰好贴边
    expect(shapeHits(b, origin, 0, target({ x: 0, y: 0, z: 6.5 }))).toBe(true)
    expect(shapeHits(b, origin, 0, target({ x: 0, y: 0, z: 7.1 }))).toBe(false)
    // target.radius 在阈值里：胖一圈的目标隔空也算中
    expect(shapeHits(box({ offsetY: 0.5 }), origin, 0, target({ x: 0, y: 0, z: 6.5 }, { radius: 0.9 }))).toBe(true)
  })
})