/**
 * 弹道表现层（Phase 4-A）：把 CombatManager 的弹体名单变成可见占位模。
 * 只 import 弹体的「类型」，不认识 CombatManager/AISystem 运行时（tech-arch §3 依赖规则），
 * 名单由组合根（main.ts）注入 —— 与 ActorVisuals.sync(list, tick) 同一套约定。
 * 弹体同时存在数是个位数，直接小网格 + 按 kind 复用池，不做实例化。
 */
import * as THREE from 'three'
import type { Projectile } from '@/combat/Projectiles'

const COLOR: Record<string, { body: number; glow: number }> = {
  spear: { body: 0x8d949c, glow: 0xffd479 },
  note: { body: 0x4fd6c8, glow: 0x9ffff2 },
  shard: { body: 0xb4614f, glow: 0xff9a6a }
}

function geometryFor(kind: string): THREE.BufferGeometry {
  if (kind === 'spear') return new THREE.BoxGeometry(0.07, 0.07, 1.7) // 长轴 +Z，朝速度方向摆正
  if (kind === 'note') return new THREE.IcosahedronGeometry(0.24, 0)
  return new THREE.TetrahedronGeometry(0.22)
}

export class ProjectileVisuals {
  private readonly group = new THREE.Group()
  private readonly used = new Map<number, { mesh: THREE.Mesh; kind: string }>()
  private readonly free = new Map<string, THREE.Mesh[]>()
  private readonly geos = new Map<string, THREE.BufferGeometry>()
  private readonly mats = new Map<string, THREE.MeshStandardMaterial>()
  private readonly zAxis = new THREE.Vector3(0, 0, 1)
  private readonly dir = new THREE.Vector3()
  private peak = 0

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'projectiles'
    this.scene.add(this.group)
  }

  get live(): number { return this.used.size }
  get peakLive(): number { return this.peak }

  sync(list: readonly Projectile[], tick: number): void {
    const alive = new Set(list.map((p) => p.id))
    for (const [id, entry] of this.used) {
      if (alive.has(id)) continue
      this.used.delete(id)
      entry.mesh.visible = false
      this.poolFor(entry.kind).push(entry.mesh)
    }
    for (const p of list) {
      const mesh = this.used.get(p.id)?.mesh ?? this.acquire(p.kind)
      mesh.position.set(p.pos.x, p.pos.y, p.pos.z)
      this.dir.set(p.vel.x, p.vel.y, p.vel.z)
      if (this.dir.lengthSq() > 1e-6) {
        this.dir.normalize()
        mesh.quaternion.setFromUnitVectors(this.zAxis, this.dir)
      }
      if (p.kind !== 'spear') {
        mesh.scale.setScalar(1 + Math.sin(tick * 0.35 + p.id) * 0.14)
        mesh.rotateZ(tick * 0.12) // 自旋在自身轴上，别用 rotation 覆盖掉朝向
      }
      this.used.set(p.id, { mesh, kind: p.kind })
    }
    this.peak = Math.max(this.peak, this.used.size)
  }

  dispose(): void {
    for (const g of this.geos.values()) g.dispose()
    for (const m of this.mats.values()) m.dispose()
    this.scene.remove(this.group)
    this.used.clear()
    this.free.clear()
    this.geos.clear()
    this.mats.clear()
  }

  private acquire(kind: string): THREE.Mesh {
    const reuse = this.poolFor(kind).pop()
    if (reuse) { reuse.visible = true; return reuse }    let geo = this.geos.get(kind)
    if (!geo) { geo = geometryFor(kind); this.geos.set(kind, geo) }
    let mat = this.mats.get(kind)
    if (!mat) {
      const c = COLOR[kind] ?? COLOR['shard']
      mat = new THREE.MeshStandardMaterial({
        color: c.body, emissive: c.glow, emissiveIntensity: 1.6, roughness: 0.45, metalness: 0.35
      })
      this.mats.set(kind, mat)
    }
    const mesh = new THREE.Mesh(geo, mat)
    mesh.visible = true
    this.group.add(mesh)
    return mesh
  }

  private poolFor(kind: string): THREE.Mesh[] {
    let bucket = this.free.get(kind)
    if (!bucket) { bucket = []; this.free.set(kind, bucket) }
    return bucket
  }
}
