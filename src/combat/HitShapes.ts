import type { Hitbox } from '@/data/schema'
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
