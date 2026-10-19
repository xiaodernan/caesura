import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import { registry } from '@/core/Registry'
import type { VfxTrailRow } from '@/data/schema'
import { toTrailConfig } from './VfxConfig'

/**
 * 武器拖尾系统（Phase B4 结案落点，tech-arch §1 Trails 映射）。
 * Tube Ribbon Shader：沿弧长的 fade、顶点动画、无 GC。
 * 数据驱动：每把武器在 movesets/weapons JSON 里声明 `trail` 配置。
 */
export interface TrailConfig {
  id: string
  /** 拖尾顶点数（历史帧数），越大越长、越平滑 */
  segments: number
  /** 宽度曲线：[根部宽度, 尖端宽度] */
  width: [number, number]
  /** 颜色渐变：[根部颜色, 尖端颜色] */
  color: [THREE.Color, THREE.Color]
  /** 生命周期（秒） */
  lifetime: number
  /** 纹理（可选，用于噪声/渐变） */
  texture?: string
  /** 混合模式 */
  blending: THREE.Blending
  /** 是否随武器旋转（true=跟随武器朝向，false=始终面向相机） */
  followRotation: boolean
  /** 最小发射间距（米），避免过密 */
  minEmitDist: number
}

interface TrailPoint {
  position: THREE.Vector3
  forward: THREE.Vector3
  up: THREE.Vector3
  time: number
  width: number
}

/** 单条拖尾运行时 */
class TrailInstance {
  config: TrailConfig
  points: TrailPoint[] = []
  // 这三个在 initGeometry() 里建出来（不在构造器里直接 new），用确定赋值断言说明这一点
  geometry!: THREE.BufferGeometry
  material!: THREE.MeshBasicMaterial
  mesh!: THREE.Mesh
  lastEmitPos: THREE.Vector3 | null = null
  age = 0

  constructor(config: TrailConfig, scene: THREE.Scene) {
    this.config = config
    this.initGeometry(scene)
  }

  private initGeometry(scene: THREE.Scene): void {
    const segs = this.config.segments
    const verts = segs * 2 // 每段两个顶点（左右）
    this.geometry = new THREE.BufferGeometry()
    const indices = []

    for (let i = 0; i < segs - 1; i++) {
      const a = i * 2
      const b = a + 1
      const c = (i + 1) * 2
      const d = c + 1
      indices.push(a, b, c, c, b, d)
    }

    this.geometry.setIndex(indices)
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(verts * 2), 2))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    if (this.config.texture) {
      // 纹理是可选的：registry 里没这一张就当没有纹理（registry.get 缺 id 会抛）
      const tex = registry.maybeGet<THREE.Texture>(this.config.texture)
      if (tex) mat.map = tex
    }

    this.material = mat
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
  }

  /** 发射新顶点（每帧最多一个） */
  emit(rootPos: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3): void {
    const now = performance.now() / 1000
    const width = this.config.width[0]

    this.points.unshift({
      position: rootPos.clone(),
      forward: forward.clone(),
      up: up.clone(),
      time: now,
      width,
    })

    // 限制长度
    if (this.points.length > this.config.segments) {
      this.points.pop()
    }

    this.lastEmitPos = rootPos.clone()
  }

  /** 尝试发射（按最小间距） */
  tryEmit(rootPos: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3): void {
    if (!this.lastEmitPos || rootPos.distanceTo(this.lastEmitPos) >= this.config.minEmitDist) {
      this.emit(rootPos, forward, up)
    }
  }

  update(dt: number): void {
    const now = performance.now() / 1000
    const lifetime = this.config.lifetime

    // 老化 & 清理
    //
    // **从头上丢**（KI-149）：原实现从**尾巴**上丢（`points[points.length - 1]`），
    // 而尾点永远是最新的一点 ⇒ `now - 尾点.time` 几乎恒为 0 ⇒ 那条 while **永真**，
    // 于是拖尾**从不老化**：路径上的点越积越多（还会超出几何体的段数）。
    while (this.points.length > 0 && now - this.points[0].time > lifetime) {
      this.points.shift()
    }
    // 段数上限：配置里的 `segments` 决定几何体画几段，索引缓冲只覆盖那几段——
    // 多出来的点**画不出来**（顶点画了、连线没画），所以这里按配置截断。
    while (this.points.length > this.config.segments) {
      this.points.shift()
    }

    if (this.points.length < 2) return

    // 重建几何体
    // **缓冲区不必再扩**（KI-149）：几何体在构造时按 `segments * 2` 个顶点开好，而点数被
    // `segments` 截住（见上面的老化段）⇒ 顶点数永远不超过缓冲区的容量。
    // 原来这里有一段"不够就扩缓冲"的代码——点数上限加上之后它**永远不成立**（死代码），删掉。
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute
    const uvAttr = this.geometry.getAttribute('uv') as THREE.BufferAttribute
    const colorAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute

    const [colorStart, colorEnd] = this.config.color
    const [widthStart, widthEnd] = this.config.width

    for (let i = 0; i < this.points.length; i++) {
      const pt = this.points[i]
      const t = (now - pt.time) / lifetime
      const w = THREE.MathUtils.lerp(widthStart, widthEnd, t)
      const col = colorStart.clone().lerp(colorEnd, t)

      // 左右顶点
      const right = new THREE.Vector3().crossVectors(pt.forward, pt.up).normalize().multiplyScalar(w * 0.5)
      const left = right.clone().negate()

      const base = i * 6
      posAttr.array[base] = pt.position.x + right.x
      posAttr.array[base + 1] = pt.position.y + right.y
      posAttr.array[base + 2] = pt.position.z + right.z
      posAttr.array[base + 3] = pt.position.x + left.x
      posAttr.array[base + 4] = pt.position.y + left.y
      posAttr.array[base + 5] = pt.position.z + left.z

      uvAttr.array[i * 4] = 0
      uvAttr.array[i * 4 + 1] = t
      uvAttr.array[i * 4 + 2] = 1
      uvAttr.array[i * 4 + 3] = t

      colorAttr.array[i * 6] = colorAttr.array[i * 6 + 3] = col.r
      colorAttr.array[i * 6 + 1] = colorAttr.array[i * 6 + 4] = col.g
      colorAttr.array[i * 6 + 2] = colorAttr.array[i * 6 + 5] = col.b
    }

    posAttr.needsUpdate = true
    uvAttr.needsUpdate = true
    colorAttr.needsUpdate = true
    this.geometry.setDrawRange(0, this.points.length * 2)
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh)
  }
}

/** 拖尾管理器：每把武器/弹道一条 */
export class TrailSystem {
  private scene: THREE.Scene
  private trails = new Map<string, TrailInstance>()
  private configs = new Map<string, TrailConfig>()

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.loadConfigs()
  }

  private loadConfigs(): void {
    // 配置来自 `vfx.json > trails`（数据层，KI-135）：表里是纯 JSON，转 three 的那一步在
    // `VfxConfig.ts`（表现层自己转）。取不到＝没有配置，系统照常构造，只是什么都不画。
    const rows = registry.maybeGet<VfxTrailRow[]>('vfx:trails') ?? []
    for (const row of rows) {
      const cfg = toTrailConfig(row)
      this.configs.set(cfg.id, cfg)
    }
  }

  getTrail(id: string): TrailInstance | null {
    if (this.trails.has(id)) return this.trails.get(id)!
    const cfg = this.configs.get(id)
    if (!cfg) return null
    const instance = new TrailInstance(cfg, this.scene)
    this.trails.set(id, instance)
    return instance
  }

  /** 每帧：武器根节点位置 + 朝向 */
  updateWeapon(weaponId: string, rootPos: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3, dt: number): void {
    const trail = this.getTrail(weaponId)
    if (!trail) return
    trail.tryEmit(rootPos, forward, up)
    trail.update(dt)
  }

  /** 弹道/投射物拖尾 */
  updateProjectile(projectileId: string, pos: THREE.Vector3, vel: THREE.Vector3, dt: number): void {
    const trail = this.getTrail(projectileId)
    if (!trail) return
    const forward = vel.clone().normalize()
    const up = new THREE.Vector3(0, 1, 0)
    trail.tryEmit(pos, forward, up)
    trail.update(dt)
  }

  /** 显示/隐藏 */
  setVisible(id: string, visible: boolean): void {
    const trail = this.trails.get(id)
    if (trail) trail.setVisible(visible)
  }

  /**
   * 每帧推进所有已存在的拖尾（组合根 `main.ts` 调的就是它：`trails.update(dt)`）。
   * dt 传到底下每条拖尾的 update(dt)——拖尾的老化/顶点重建由它完成。
   */
  update(dt: number): void {
    for (const trail of this.trails.values()) {
      trail.update(dt)
    }
  }

  remove(id: string): void {
    const trail = this.trails.get(id)
    if (trail) {
      trail.dispose()
      this.trails.delete(id)
    }
  }

  dispose(): void {
    for (const trail of this.trails.values()) trail.dispose()
    this.trails.clear()
  }
}

let trailSystem: TrailSystem | null = null

export function initTrailSystem(scene: THREE.Scene): TrailSystem {
  trailSystem = new TrailSystem(scene)
  return trailSystem
}

export function getTrailSystem(): TrailSystem | null {
  return trailSystem
}

/**
 * 总线上的载荷是纯 `{x,y,z}`（发射方住在战斗层／AI 层，那些层不许 import three），
 * 表现层在这一处把它转成 three 的向量。**转换点只有一个**：谁在表现层，谁转。
 */
const vec3 = (p: { x: number; y: number; z: number }): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z)

export function registerTrailSystemBus(): void {
  bus.on('vfx.trail.weapon', (data: { id: string; pos: { x: number; y: number; z: number }; forward: { x: number; y: number; z: number }; up: { x: number; y: number; z: number } }) => {
    trailSystem?.updateWeapon(data.id, vec3(data.pos), vec3(data.forward), vec3(data.up), 1/60)
  })
  bus.on('vfx.trail.projectile', (data: { id: string; pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } }) => {
    trailSystem?.updateProjectile(data.id, vec3(data.pos), vec3(data.vel), 1/60)
  })
  bus.on('vfx.trail.hide', (id: string) => {
    trailSystem?.setVisible(id, false)
  })
}

/**
 * 本文件用到的三条事件，声明跟着写方走（写方与读方都在这个文件里，名字不写第二份）。
 * **载荷是普通 `{x,y,z}`，不是 `THREE.Vector3`**（KI-135）：发射方住在战斗层／AI 层，
 * 而那些层**不许 import three**（`tests/unit/arch-boundaries.test.ts`：three 只在表现层出现）。
 * 载荷要是 `THREE.Vector3`，发射方就得为了发一个事件把 three 拖进战斗层——那是拿依赖方向
 * 换一条特效通道。约定与 `vfx.request` 同一族：总线上跑的是**纯数据**，表现层自己转 three。
 */
declare module '@/core/EventBus' {
  interface GameEvents {
    /** 武器拖尾：发射方＝持武器的一方（战斗层每帧递一次武器根节点的位置与朝向），接收方＝本文件的 TrailSystem。 */
    'vfx.trail.weapon': { id: string; pos: { x: number; y: number; z: number }; forward: { x: number; y: number; z: number }; up: { x: number; y: number; z: number } }
    /** 弹道/投射物拖尾：发射方＝投射物的一方，接收方＝本文件的 TrailSystem。 */
    'vfx.trail.projectile': { id: string; pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } }
    /** 收起某条拖尾：发射方＝要隐藏武器的一方，接收方＝本文件的 TrailSystem（载荷就是 id 本身）。 */
    'vfx.trail.hide': string
  }
}