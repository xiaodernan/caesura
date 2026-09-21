import * as THREE from 'three'
import { damp, clamp } from '@/core/Math'
import { bus } from '@/core/EventBus'
import type { PlayerController } from './ThirdPersonController'
import type { Vec3 } from '@/combat/EntityStats'

interface Shake { amp: number; freq: number; decay: number; t: number; roll: number }

const SHAKE_TABLE: Record<string, { amp: number; freq: number; dur: number }> = {
  graze: { amp: 0.3, freq: 18, dur: 0.1 },
  normal: { amp: 0.8, freq: 12, dur: 0.2 },
  hurt: { amp: 1.2, freq: 10, dur: 0.25 },
  parry: { amp: 0.5, freq: 24, dur: 0.06 },
  heavy: { amp: 2.0, freq: 6, dur: 0.4 },
  boss: { amp: 4.0, freq: 3.5, dur: 0.9 }
}

export class CameraRig {
  yaw = 0.6
  pitch = 0.26
  dist = 5.6
  shakeIntensity = 1
  private shakes: Shake[] = []
  private posSmooth = new THREE.Vector3(0, 2, 6)
  cam: THREE.PerspectiveCamera

  constructor(fov = 50, near = 0.1, far = 400) {
    this.cam = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, near, far)
    bus.on('combat.hit', (h) => {
      if (h.result === 'hit' || h.result === 'graze') this.shake(h.shakeKey || 'graze')
      else if (h.result === 'block' || h.result === 'perfectBlock') this.shake('graze')
      else if (h.result === 'parry') this.shake('parry')
    })
    bus.on('player.damaged', () => this.shake('hurt'))
  }

  shake(key: string, mul = 1): void {
    const s = SHAKE_TABLE[key] ?? SHAKE_TABLE.graze
    this.shakes.push({ amp: s.amp * mul * this.shakeIntensity, freq: s.freq, decay: s.dur / 3, t: 0, roll: key === 'parry' ? 2 : 0 })
    if (this.shakes.length > 4) this.shakes.shift()
  }

  resize(): void {
    this.cam.aspect = innerWidth / innerHeight
    this.cam.updateProjectionMatrix()
  }

  update(dt: number, player: PlayerController, look: { dx: number; dy: number }, lockTarget: Vec3 | null): void {
    this.yaw -= look.dx
    this.pitch = clamp(this.pitch + look.dy * 0.55, -0.18, 1.2)
    const target = { x: player.pos.x, y: player.pos.y + 1.15, z: player.pos.z }
    let dist = this.dist
    if (lockTarget) {
      const mid = { x: (target.x + lockTarget.x) / 2, z: (target.z + lockTarget.z) / 2 }
      target.x = mid.x; target.z = mid.z
      target.y = player.pos.y + 1.2
      const d = Math.hypot(player.pos.x - lockTarget.x, player.pos.z - lockTarget.z)
      dist = clamp(4.2 + d * 0.35, 4.2, 8)
      const away = Math.atan2(player.pos.x - lockTarget.x, player.pos.z - lockTarget.z)
      this.yaw = damp(this.yaw, wrapNear(this.yaw, away + 0.35), 3, dt)
    }
    const sp = Math.sin(this.pitch), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw)
    const cp = Math.cos(this.pitch)
    const desired = new THREE.Vector3(
      target.x + sy * cp * dist,
      target.y + 0.4 + sp * dist,
      target.z + cy * cp * dist
    )
    const k = lockTarget ? 8 : 12
    this.posSmooth.x = damp(this.posSmooth.x, desired.x, k, dt)
    this.posSmooth.y = damp(this.posSmooth.y, desired.y, k, dt)
    this.posSmooth.z = damp(this.posSmooth.z, desired.z, k, dt)
    if (this.posSmooth.y < 0.35) this.posSmooth.y = 0.35

    let offX = 0, offY = 0, roll = 0
    for (const s of this.shakes) {
      s.t += dt
      const env = Math.exp(-s.t / s.decay)
      const osc = Math.sin(s.t * s.freq * Math.PI * 2) * s.amp * env
      offY += osc * 0.02; offX += osc * 0.012; roll += (s.roll ? s.roll * env * Math.sin(s.t * 40) : 0)
    }
    this.shakes = this.shakes.filter((s) => Math.exp(-s.t / s.decay) > 0.02)

    this.cam.position.set(this.posSmooth.x + offX, this.posSmooth.y + offY, this.posSmooth.z)
    this.cam.lookAt(target.x, target.y + offY * 0.5, target.z)
    this.cam.rotation.z += roll * (Math.PI / 180)
    player.camYawRef = Math.atan2(this.posSmooth.x - target.x, this.posSmooth.z - target.z)
  }
}

function wrapNear(from: number, to: number): number {
  let d = to - from
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return from + d
}
