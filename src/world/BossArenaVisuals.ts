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
  /**
   * §15.2 断音柱：玩家能站进去的掩体，所以必须比钟更像「一根能挡东西的柱子」。
   * 几何按**单位尺寸**建（底半径 1、高 1，顶部 0.86 的收分只是让它读起来像一根柱子），
   * 实际大小由 `sync` 按 `boss.covers` 的 `radius`/`heightM` 缩放 ⇒
   * **画出来的那一根就是射线会撞上的那一根**（KI-014①：遮挡判据换成线段之后，
   * 表现层再留一份自己的尺寸就是让玩家按一个看不见的圆柱躲柱子）。
   */
  private readonly pillarGeo = new THREE.CylinderGeometry(0.86, 1, 1, 12, 1, true)
  private readonly aliveMat: THREE.MeshStandardMaterial
  private readonly rungMat: THREE.MeshStandardMaterial
  private readonly coverMat: THREE.MeshStandardMaterial
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
    this.coverMat = new THREE.MeshStandardMaterial({
      color: 0x1c2226, emissive: 0x0a1416, emissiveIntensity: 0.45,
      metalness: 0.35, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.92
    })
    this.group.name = 'boss-arena'
    scene.add(this.group)
  }

  /** 每 tick 只读快照同步；`owner` 用来给不同 Boss 的机关留独立身份 */
  sync(bosses: Enemy[]): void {
    const want = new Set<string>()
    for (const e of bosses) {
      const cov = e.data.boss?.covers
      if (cov) {
        cov.positions.forEach((q, i) => {
          const key = `cover:${e.id}:${i}`
          want.add(key)
          let m = this.meshes.get(key)
          if (!m) {
            m = new THREE.Mesh(this.pillarGeo, this.coverMat)
            this.group.add(m)
            this.meshes.set(key, m)
            this.peakLive = Math.max(this.peakLive, this.meshes.size)
          }
          // 底面圆心在数据那个 y，几何又是以原点居中的 ⇒ 抬高半个高度正好"站在地上"
          m.scale.set(cov.radius, cov.heightM, cov.radius)
          m.position.set(q.x, q.y + cov.heightM / 2, q.z)
        })
      }
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
    this.pillarGeo.dispose()
    this.aliveMat.dispose()
    this.rungMat.dispose()
    this.coverMat.dispose()
    this.group.parent?.remove(this.group)
  }
}
