import * as THREE from 'three'
import type { Enemy } from '@/ai/Enemy'

/**
 * Boss 场地机关的表现层（§15.1 撞钟机关）。纯只读：逻辑层的真源是
 * `Enemy.boss.bells.positions` + `Enemy.bellsRung`，这里只把它们画出来。
 * 机关不可见就等于不存在——玩家得先看得见钟，才谈得上「引她撞过去」。
 */
export class BossArenaVisuals {
  private readonly group = new THREE.Group()
  private readonly geo = new THREE.CylinderGeometry(0.55, 1.15, 2.6, 10, 1, true)
  private readonly aliveMat: THREE.MeshStandardMaterial
  private readonly rungMat: THREE.MeshStandardMaterial
  private readonly meshes = new Map<string, THREE.Mesh>()
  /** 观测用：历史峰值，验证没有按 tick 增长的分配 */
  peakLive = 0

  constructor(scene: THREE.Scene) {
    this.aliveMat = new THREE.MeshStandardMaterial({
      color: 0xb4653a, emissive: 0x4a2a12, emissiveIntensity: 0.7,
      metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide
    })
    // 响过的钟：塌成暗桩（残响区还在，钟已经空了）
    this.rungMat = new THREE.MeshStandardMaterial({
      color: 0x2a2f2c, emissive: 0x120c08, emissiveIntensity: 0.3,
      metalness: 0.6, roughness: 0.8, side: THREE.DoubleSide
    })
    this.group.name = 'boss-arena'
    scene.add(this.group)
  }

  /** 每 tick 只读快照同步；`owner` 用来给不同 Boss 的机关留独立身份 */
  sync(bosses: Enemy[]): void {
    const want = new Set<string>()
    for (const e of bosses) {
      const g = e.data.boss?.bells
      if (!g) continue
      g.positions.forEach((p, i) => {
        const key = `${e.id}:${i}`
        want.add(key)
        let m = this.meshes.get(key)
        if (!m) {
          m = new THREE.Mesh(this.geo, this.aliveMat)
          this.group.add(m)
          this.meshes.set(key, m)
          this.peakLive = Math.max(this.peakLive, this.meshes.size)
        }
        m.position.set(p.x, p.y + 1.3, p.z)
        const rung = !!e.bellsRung[i]
        m.material = rung ? this.rungMat : this.aliveMat
        m.scale.set(1, rung ? 0.32 : 1, 1)
      })
    }
    for (const [key, m] of this.meshes) {
      if (want.has(key)) continue
      this.group.remove(m)
      this.meshes.delete(key)
    }
  }

  dispose(): void {
    for (const m of this.meshes.values()) this.group.remove(m)
    this.meshes.clear()
    this.geo.dispose()
    this.aliveMat.dispose()
    this.rungMat.dispose()
    this.group.parent?.remove(this.group)
  }
}
