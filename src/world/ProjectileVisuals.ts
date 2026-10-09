/**
 * 弹道表现层（Phase 4-A）：把 CombatManager 的弹体名单变成可见占位模。
 * 只 import 弹体的「类型」，不认识 CombatManager/AISystem 运行时（tech-arch §3 依赖规则），
 * 名单由组合根（main.ts）注入 —— 与 ActorVisuals.sync(list, tick) 同一套约定。
 * 弹体同时存在数是个位数，直接小网格 + 按 kind 复用池，不做实例化。
 */
import * as THREE from 'three'
import type { Projectile } from '@/combat/Projectiles'
import type { GroundedSpear } from '@/combat/GroundedSpears'
import type { TelegraphLine } from '@/combat/CombatManager'

const COLOR: Record<string, { body: number; glow: number }> = {
  spear: { body: 0x8d949c, glow: 0xffd479 },
  note: { body: 0x4fd6c8, glow: 0x9ffff2 },
  shard: { body: 0xb4614f, glow: 0xff9a6a },
  arrow: { body: 0xd8b46a, glow: 0xffe9b0 } // 泛音弓的箭：暖木色，和音色晶的冷色分开
}

function geometryFor(kind: string): THREE.BufferGeometry {
  if (kind === 'spear') return new THREE.BoxGeometry(0.07, 0.07, 1.7) // 长轴 +Z，朝速度方向摆正
  if (kind === 'arrow') return new THREE.BoxGeometry(0.045, 0.045, 1.05) // 箭：比枪短一截的细杆（§4.4）
  if (kind === 'note') return new THREE.IcosahedronGeometry(0.24, 0)
  if (kind === 'crystal') return new THREE.OctahedronGeometry(0.3, 0) // 音色晶（KI-023①）：会唱歌的八面体
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
  /** telegraph 赤线：按 ownerId 复用（同一射手同时只有一根线） */
  private readonly lines = new Map<string, THREE.Mesh>()
  private readonly freeLines: THREE.Mesh[] = []
  private readonly lineMats: THREE.MeshBasicMaterial[] = []
  private readonly lineGeo = new THREE.BoxGeometry(1, 1, 1)
  private peakLines = 0
  /**
   * §4.3 躺在地上等拾回的枪（KI-006 剩余缺口①）：按**地上那一杆**的 id 复用，与飞行中的弹体
   * 各占一张名册、共用同一个 spear 网格池——一杆枪此刻只能属于其中一张名单，所以不会撞车。
   */
  private readonly grounded = new Map<number, THREE.Mesh>()

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'projectiles'
    this.scene.add(this.group)
  }

  get live(): number { return this.used.size }
  get peakLive(): number { return this.peak }
  get liveTelegraphs(): number { return this.lines.size }
  get peakTelegraphs(): number { return this.peakLines }
  get liveGrounded(): number { return this.grounded.size }

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
      if (p.kind !== 'spear' && p.frozenTicks <= 0) {
        // §7.2 时停的可见 tell：冻结的那几十 tick 里不更新呼吸与自旋，网格就停在被停住的那一帧上。
        // 这些动画本来吃着**全局 tick**，不改这一句的话，一颗"停了"的音弹仍在原地自转——
        // 玩家只能靠猜来判断自己那记时停成没成（与 ActorVisuals 那条同源：看不见的机制等于没有机制）。
        mesh.scale.setScalar(1 + Math.sin(tick * 0.35 + p.id) * 0.14)
        mesh.rotateZ(tick * 0.12) // 自旋在自身轴上，别用 rotation 覆盖掉朝向
      }
      this.used.set(p.id, { mesh, kind: p.kind })
    }
    this.peak = Math.max(this.peak, this.used.size)
  }

  /**
   * §4.3 落地的枪：躺平、不呼吸（它是场地里的一件东西，不是还在打的攻击），名单由组合根注入。
   * 玩家靠这一眼知道"枪还在那儿、值得走过去按处决键"——看不见等于没有（ActorVisuals 那条同源）。
   */
  syncGrounded(list: readonly GroundedSpear[]): void {
    const alive = new Set(list.map((s) => s.id))
    for (const [id, mesh] of this.grounded) {
      if (alive.has(id)) continue
      this.grounded.delete(id)
      mesh.visible = false
      this.poolFor('spear').push(mesh)
    }
    for (const s of list) {
      const mesh = this.grounded.get(s.id) ?? this.acquire('spear')
      mesh.position.set(s.pos.x, s.pos.y, s.pos.z)
      this.dir.set(s.dir.x, 0, s.dir.z)
      if (this.dir.lengthSq() > 1e-8) {
        this.dir.normalize()
        mesh.quaternion.setFromUnitVectors(this.zAxis, this.dir)
      } else {
        // 零向量兜底：默认 +Z，保证四元数归一
        mesh.quaternion.identity()
      }
      mesh.scale.setScalar(1)
      this.grounded.set(s.id, mesh)
    }
  }

  dispose(): void {
    for (const g of this.geos.values()) g.dispose()
    for (const m of this.mats.values()) m.dispose()
    for (const m of this.lineMats) m.dispose()
    this.lineGeo.dispose()
    this.scene.remove(this.group)
    this.used.clear()
    this.free.clear()
    this.geos.clear()
    this.mats.clear()
    this.lines.clear()
    this.freeLines.length = 0
    this.grounded.clear()
  }

  /**
   * §14.4「可见赤线 telegraph，线终点=落点」——针喉拉弦的 0.8s 里把弹道预先画出来。
   * 线越接近出手越亮（k²），这是聋者玩家读节奏的视觉替代：拉弦声是听觉信号，红线是它的镜像。
   */
  syncTelegraphs(lines: readonly TelegraphLine[]): void {
    const live = new Set<string>()
    for (const l of lines) {
      const mesh = this.lines.get(l.ownerId) ?? this.acquireLine()
      live.add(l.ownerId)
      const ax = l.to.x - l.from.x, ay = l.to.y - l.from.y, az = l.to.z - l.from.z
      const len = Math.max(0.4, Math.hypot(ax, ay, az))
      mesh.position.set((l.from.x + l.to.x) / 2, (l.from.y + l.to.y) / 2, (l.from.z + l.to.z) / 2)
      this.dir.set(ax, ay, az)
      if (this.dir.lengthSq() > 1e-8) mesh.quaternion.setFromUnitVectors(this.zAxis, this.dir.normalize())
      mesh.scale.set(0.05, 0.05, len)
      const k = 1 - l.ticksLeft / Math.max(1, l.totalTicks)
      ;(mesh.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.72 * k * k
      this.lines.set(l.ownerId, mesh)
    }
    for (const [id, mesh] of this.lines) {
      if (live.has(id)) continue
      this.lines.delete(id)
      mesh.visible = false
      this.freeLines.push(mesh)
    }
    this.peakLines = Math.max(this.peakLines, this.lines.size)
  }

  private acquireLine(): THREE.Mesh {
    const reuse = this.freeLines.pop()
    if (reuse) { reuse.visible = true; return reuse }
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff3a22, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending
    })
    this.lineMats.push(mat)
    const mesh = new THREE.Mesh(this.lineGeo, mat)
    mesh.renderOrder = 3
    this.group.add(mesh)
    return mesh
  }

  private acquire(kind: string): THREE.Mesh {
    const reuse = this.poolFor(kind).pop()
    if (reuse) { reuse.visible = true; return reuse }
    let geo = this.geos.get(kind)
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
