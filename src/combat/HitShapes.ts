import type { DamageBand, Hitbox } from '@/data/schema'
import type { Vec3 } from './EntityStats'

export interface HitTarget {
  pos: Vec3
  facingYaw: number
  radius: number
  height: number
}

/** analytic shape tests only, no physics engine (docs/technical-architecture.md §2 combat) */
export function shapeHits(
  box: Hitbox, origin: Vec3, yaw: number, target: HitTarget
): boolean {
  const dx = target.pos.x - origin.x
  const dz = target.pos.z - origin.z
  const dist = Math.hypot(dx, dz)
  if (box.shape === 'cone') {
    if (dist > box.radius + target.radius) return false
    if (dist < target.radius + 0.25) {
      // point-blank grapple: angle test is meaningless inside the target volume
      const dy0 = Math.abs((target.pos.y + target.height / 2) - (origin.y + box.offsetY))
      return dy0 < (box.height + target.height) / 2
    }
    const angTo = Math.atan2(dx, dz)
    let diff = angTo - yaw
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    if (Math.abs(diff) > (box.angleDeg * Math.PI) / 180 / 2 + Math.atan2(target.radius, Math.max(0.4, dist))) return false
    const dy = Math.abs((target.pos.y + target.height / 2) - (origin.y + box.offsetY))
    return dy < (box.height + target.height) / 2
  }
  if (box.shape === 'sphere') {
    const cx = origin.x + Math.sin(yaw) * box.offsetFwd
    const cz = origin.z + Math.cos(yaw) * box.offsetFwd
    const cy = origin.y + box.offsetY
    return Math.hypot(target.pos.x + 0 - cx, target.pos.z - cz, (target.pos.y + target.height / 2) - cy) <= box.radius + target.radius
  }
  const inner = box.inner, outer = box.outer + box.forward
  return dist >= inner - target.radius && dist <= outer + target.radius
}

/**
 * 落点分环伤害（§15.1 P3「外环 20 / 内环 36」）。**档位的主人是 `FrameData.bands` 这张表**，
 * `damage` 在带 bands 的招式上只是"最深那一档"的读数（validator 逼它俩相等）。
 *
 * `dist` 是**目标球心到爆心的水平距离**，与 `shapeHits` 那一支用同一把尺子：判定说"你在 4.8m"，
 * 伤害档位也说"你在 4.8m"，不允许判定读 A、结算读 B。由此有一条口径必须写清：
 * **球心落在最后一档之外 ⇒ 仍取最后一档**。这不是兜底兜错了方向——能打上却落在环外，
 * 只可能是因为目标自己的体积（0.55m）从外沿探进来的，那种贴边本来就该按外环算，
 * 而不是按内环罚一次"你居然被体积蹭到"。
 */
export function bandDamage(bands: DamageBand[], dist: number): number {
  for (const b of bands) if (dist <= b.outer) return b.damage
  return bands[bands.length - 1].damage
}

/** is attacker behind defender? (§5.4 backstab 40deg cone / damage backstab flag) */
export function isBackstab(attackerPos: Vec3, target: HitTarget): boolean {
  const dx = attackerPos.x - target.pos.x
  const dz = attackerPos.z - target.pos.z
  const ang = Math.atan2(dx, dz)
  let diff = ang - target.facingYaw
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return Math.abs(diff) > Math.PI * 0.72
}
