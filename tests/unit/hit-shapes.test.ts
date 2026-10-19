import { describe, expect, it } from 'vitest'
import { isBackstab, shapeHits, type HitTarget } from '@/combat/HitShapes'
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

/**
 * `isBackstab` 的**第一个直接读者**：此前全仓没有任何测试按名字碰过它（`grep -rn isBackstab tests/` = 空），
 * 它只被 `CombatManager` 的背刺/潜行处决链间接走。这个函数身上有两件会被偷改坏又没人喊的事：
 * ① 阈值是 `|diff| > π×0.72`（≈129.6°）这个**魔数**——§5.4 背刺的角度闸，与
 *    `player.json > execution.crumpleRange` 同族；② 差角要绕回 (-π,π]，目标面朝 ±π 时不能把
 *    "正后方"读成"正前方"。两件都钉在这里。
 *
 * 口径与 `shapeHits` 同一把尺（`atan2(dx,dz)`，yaw=0 即 +Z）：`facingYaw=0` 时目标望向 +Z。
 */
describe('isBackstab：只有站在目标背后才算（§5.4 的 129.6° 后锥）', () => {
  const BACK_DEG = 129.6 // π×0.72，写在这里当读数而不是藏在实现里
  /** 以目标为圆心、从它朝向起算 angleDeg 度、半径 r 处放一个攻击者 */
  const at = (angleDeg: number, r = 10): { x: number; y: number; z: number } => {
    const a = (angleDeg * Math.PI) / 180
    return { x: Math.sin(a) * r, y: 0, z: Math.cos(a) * r }
  }

  it('正前方与正侧方都不算背刺；正后方才算', () => {
    const t = target({ x: 0, y: 0, z: 0 })
    expect(isBackstab(at(0), t), '正前方（就是目标朝向）').toBe(false)
    expect(isBackstab(at(90), t), '正侧方').toBe(false)
    expect(isBackstab(at(180), t), '正后方').toBe(true)
  })

  it('阈值钉在 129.6°，且是严格大于：129° 界内、131° 翻面，左右对称', () => {
    expect((BACK_DEG * Math.PI) / 180).toBeCloseTo(Math.PI * 0.72, 12) // 读数自证：那枚魔数就是 129.6°
    const t = target({ x: 0, y: 0, z: 0 })
    expect(isBackstab(at(BACK_DEG - 0.6), t), '差 0.6° 到界 ⇒ 界内，不算').toBe(false)
    expect(isBackstab(at(BACK_DEG + 1.4), t), '过界 1.4° ⇒ 翻面').toBe(true)
    expect(isBackstab(at(-(BACK_DEG + 1.4)), t), '反方向同样翻面（左右对称）').toBe(true)
    expect(isBackstab(at(-(BACK_DEG - 0.6)), t), '反方向界内').toBe(false)
  })

  it('目标背对时判据跟着翻：facingYaw=π ⇒ 它的背后换到 +Z 一侧', () => {
    const t = target({ x: 0, y: 0, z: 0 }, { facingYaw: Math.PI })
    expect(isBackstab({ x: 0, y: 0, z: 10 }, t), '目标面向 −Z ⇒ +Z 是背后').toBe(true)
    expect(isBackstab({ x: 0, y: 0, z: -10 }, t), '−Z 是它正前方').toBe(false)
  })

  it('只认水平差角：抬高 y 不改变背后判定', () => {
    const t = target({ x: 0, y: 0, z: 0 })
    expect(isBackstab({ x: 0, y: 50, z: -10 }, t), '正后方但高 50m：差角没变，仍算背刺').toBe(true)
    expect(isBackstab({ x: 0, y: 50, z: 10 }, t), '正前方抬高也不该翻面').toBe(false)
  })
})