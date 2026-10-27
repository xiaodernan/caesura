import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import { registry } from '@/core/Registry'
import type { VfxDecalRow } from '@/data/schema'
import { toDecalConfig } from './VfxConfig'

/**
 * 贴花系统（Phase B4 结案落点，tech-arch §1 Decals 映射）。
 * 投影四边形 + 深度防穿插（Polygon Offset）。
 * 用于：弹痕、震纹、脚印、血迹、烧焦痕。
 * 
 * 核心策略：
 *   - 单次 DrawCall 批量渲染（InstancedMesh 或合并几何体）
 *   - 生存周期管理：创建 -> 淡入 -> 维持 -> 淡出 -> 回收
 *   - 深度偏移防止 Z-fighting
 *   - 支持法线贴图/粗糙度贴图的 PBR 贴花（可选）
 */
export interface DecalConfig {
  id: string
  /** 贴花类型 */
  type: 'bullet' | 'impact' | 'footstep' | 'blood' | 'scorch' | 'crack' | 'custom'
  /** 生命周期（秒），-1 = 永久 */
  lifetime: number
  /** 淡入/淡出时长 */
  fadeIn: number
  fadeOut: number
  /** 尺寸范围 */
  size: { min: number; max: number }
  /** 颜色/不透明度 */
  color: { base: THREE.Color; opacity: number }
  /** 法线强度（用于 PBR 贴花） */
  normalStrength: number
  /** 粗糙度偏移 */
  roughnessOffset: number
  /** 金属度偏移 */
  metalnessOffset: number
  /** 纹理 */
  textures?: {
    albedo?: string
    normal?: string
    roughness?: string
    metalness?: string
  }
  /** 是否随机旋转 */
  randomRotation: boolean
  /** 是否随机缩放 */
  randomScale: boolean
  /** 最大实例数 */
  maxInstances: number
}

interface DecalInstance {
  config: DecalConfig
  position: THREE.Vector3
  normal: THREE.Vector3
  rotation: number
  scale: number
  age: number
  active: boolean
  mesh: THREE.Mesh
}

/**
 * three 的 `Object3D.material` 是 `Material | Material[]` 的联合，而本系统建网格时
 * 只递了一个 `MeshStandardMaterial` 进去。数组分支这里不会出现，但类型上得先收窄，
 * 才能在下面安心地读 `.color` / `.opacity`（Material 基类上没有这两个属性）。
 * 用 `instanceof` 而不是 `as` 断言：认不出就返回 null，让调用方走"不处理"那条路。
 */
function standardMaterialOf(mesh: THREE.Mesh): THREE.MeshStandardMaterial | null {
  const mat = mesh.material
  if (Array.isArray(mat)) return null
  return mat instanceof THREE.MeshStandardMaterial ? mat : null
}

/** 贴花管理器 */
export class DecalSystem {
  private scene: THREE.Scene
  private decals = new Map<string, DecalInstance[]>() // pool per config
  private configs = new Map<string, DecalConfig>()
  // 这两个在 initGeometry()/initMaterial() 里建出来（不在构造器里直接 new），用确定赋值断言说明这一点
  private geometry!: THREE.BufferGeometry
  private baseMaterial!: THREE.MeshStandardMaterial
  private nextId = 0

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.initGeometry()
    this.initMaterial()
    this.loadConfigs()
  }

  private initGeometry(): void {
    // 单位四边形（XY 平面，中心在原点，法线朝 +Z）
    const size = 0.5
    this.geometry = new THREE.BufferGeometry()
    const positions = new Float32Array([
      -size, -size, 0,
       size, -size, 0,
       size,  size, 0,
      -size,  size, 0,
    ])
    const uvs = new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 1,
    ])
    const indices = [0, 1, 2, 2, 3, 0]
    this.geometry.setIndex(indices)
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    this.geometry.computeVertexNormals()
  }

  private initMaterial(): void {
    this.baseMaterial = new THREE.MeshStandardMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1, // 防止 Z-fighting
      polygonOffsetUnits: -1,
      side: THREE.DoubleSide,
      vertexColors: false,
    })
  }

  private loadConfigs(): void {
    // 配置来自 `vfx.json > decals`（数据层，KI-135）：表里是纯 JSON，转 three 的那一步在
    // `VfxConfig.ts`（表现层自己转）。取不到＝没有配置，系统照常构造，只是什么都不画。
    const rows = registry.maybeGet<VfxDecalRow[]>('vfx:decals') ?? []
    for (const row of rows) {
      const cfg = toDecalConfig(row)
      this.configs.set(cfg.id, cfg)
    }
  }

  private getPool(configId: string): DecalInstance[] {
    if (!this.decals.has(configId)) this.decals.set(configId, [])
    return this.decals.get(configId)!
  }

  private getOrCreateMaterial(config: DecalConfig): THREE.MeshStandardMaterial {
    const key = `${config.id}_mat`
    // maybeGet：缺 id 不抛（registry.get 缺 id 会抛，而这里只是"这张贴花还没建过材质"）
    const cached = registry.maybeGet<THREE.MeshStandardMaterial>(key)
    if (cached) return cached

    const mat = this.baseMaterial.clone()
    mat.color.copy(config.color.base)
    mat.opacity = config.color.opacity
    mat.transparent = config.color.opacity < 1
    mat.roughness = 0.8 + config.roughnessOffset
    mat.metalness = config.metalnessOffset
    mat.normalScale.set(config.normalStrength, config.normalStrength)

    if (config.textures) {
      // 贴图都是可选的：registry 里没有这一张就当没有（不抛）
      const albedo = config.textures.albedo ? registry.maybeGet<THREE.Texture>(config.textures.albedo) : undefined
      if (albedo) mat.map = albedo
      const normal = config.textures.normal ? registry.maybeGet<THREE.Texture>(config.textures.normal) : undefined
      if (normal) mat.normalMap = normal
      const rough = config.textures.roughness ? registry.maybeGet<THREE.Texture>(config.textures.roughness) : undefined
      if (rough) mat.roughnessMap = rough
      const metal = config.textures.metalness ? registry.maybeGet<THREE.Texture>(config.textures.metalness) : undefined
      if (metal) mat.metalnessMap = metal
    }

    // 上面已经 maybeGet 判过"这张 key 不在 registry 里" ⇒ 这一行 register 不会撞重复 id
    registry.register(key, mat)
    return mat
  }

  /** 生成贴花（弹痕、冲击波、脚印等） */
  spawn(configId: string, position: THREE.Vector3, normal: THREE.Vector3, options?: {
    rotation?: number
    scale?: number
    color?: THREE.Color
    opacity?: number
    lifetime?: number
  }): string | null {
    const config = this.configs.get(configId)
    if (!config) return null

    const pool = this.getPool(configId)
    const mat = this.getOrCreateMaterial(config)

    // 寻找可回收的实例
    let instance = pool.find(d => !d.active)
    if (!instance) {
      const mesh = new THREE.Mesh(this.geometry, mat)
      mesh.frustumCulled = false
      this.scene.add(mesh)
      instance = {
        config,
        position: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        rotation: 0,
        scale: 1,
        age: 0,
        active: false,
        mesh,
      }
      pool.push(instance)
    }

    // 初始化
    instance.active = true
    instance.position.copy(position)
    instance.normal.copy(normal)
    instance.rotation = options?.rotation ?? (config.randomRotation ? Math.random() * Math.PI * 2 : 0)
    instance.scale = options?.scale ?? (config.randomScale ? THREE.MathUtils.lerp(config.size.min, config.size.max, Math.random()) : config.size.max)
    instance.age = 0

    // 网格建的时候拿的就是这个材质（同一份 config ⇒ 同一个 registry key ⇒ 同一个材质对象）
    if (options?.color) mat.color.copy(options.color)
    if (options?.opacity !== undefined) mat.opacity = options.opacity
    if (options?.lifetime !== undefined) instance.config = { ...instance.config, lifetime: options.lifetime }

    // 计算朝向矩阵（贴花朝向 = 表面法线）
    const up = normal.clone()
    const forward = new THREE.Vector3(0, 0, 1)
    const right = new THREE.Vector3().crossVectors(up, forward).normalize()
    const actualForward = new THREE.Vector3().crossVectors(right, up).normalize()

    const matrix = new THREE.Matrix4().makeBasis(right, up, actualForward)
    matrix.setPosition(position)
    matrix.scale(new THREE.Vector3(instance.scale, instance.scale, instance.scale))
    if (instance.rotation !== 0) {
      matrix.multiply(new THREE.Matrix4().makeRotationZ(instance.rotation))
    }
    instance.mesh.applyMatrix4(matrix)
    instance.mesh.visible = true

    const id = `decal_${configId}_${this.nextId++}`
    return id
  }

  /** 批量生成（如爆炸碎片、脚印序列） */
  spawnBatch(configId: string, positions: THREE.Vector3[], normal: THREE.Vector3, options?: {
    rotation?: number
    scale?: number
  }): string[] {
    const ids: string[] = []
    for (const pos of positions) {
      const id = this.spawn(configId, pos, normal, options)
      if (id) ids.push(id)
    }
    return ids
  }

  update(dt: number): void {
    for (const [configId, pool] of this.decals) {
      // 这一池的配置还在不在（configs 只进不出，但读法上不写死）
      const config = this.configs.get(configId)
      if (!config) continue
      for (const instance of pool) {
        if (!instance.active) continue

        const mat = standardMaterialOf(instance.mesh)
        if (!mat) continue

        instance.age += dt
        const t = instance.config.lifetime > 0 ? instance.age / instance.config.lifetime : 0

        // 淡入/淡出
        let opacity = mat.opacity
        if (t < instance.config.fadeIn / (instance.config.lifetime || 1)) {
          opacity = mat.opacity * (t / (instance.config.fadeIn / (instance.config.lifetime || 1)))
        } else if (instance.config.lifetime > 0 && t > 1 - instance.config.fadeOut / instance.config.lifetime) {
          opacity = mat.opacity * (1 - t) / (instance.config.fadeOut / instance.config.lifetime)
        }
        mat.opacity = opacity

        // 过期回收
        if (instance.config.lifetime > 0 && instance.age >= instance.config.lifetime) {
          instance.active = false
          instance.mesh.visible = false
        }
      }
    }
  }

  /** 清理指定类型 */
  clear(configId?: string): void {
    if (configId) {
      const pool = this.decals.get(configId)
      if (pool) {
        for (const d of pool) {
          d.active = false
          d.mesh.visible = false
        }
      }
    } else {
      for (const pool of this.decals.values()) {
        for (const d of pool) {
          d.active = false
          d.mesh.visible = false
        }
      }
    }
  }

  dispose(): void {
    for (const pool of this.decals.values()) {
      for (const d of pool) {
        d.mesh.geometry.dispose()
        standardMaterialOf(d.mesh)?.dispose()
        this.scene.remove(d.mesh)
      }
    }
    this.decals.clear()
    this.geometry.dispose()
    this.baseMaterial.dispose()
  }
}

let decalSystem: DecalSystem | null = null

export function initDecalSystem(scene: THREE.Scene): DecalSystem {
  decalSystem = new DecalSystem(scene)
  return decalSystem
}

export function getDecalSystem(): DecalSystem | null {
  return decalSystem
}

/**
 * 总线上的载荷是纯 `{x,y,z}`（发射方住在战斗层／AI 层，那些层不许 import three），
 * 表现层在这一处把它转成 three 的向量。**转换点只有一个**：谁在表现层，谁转。
 */
const vec3 = (p: { x: number; y: number; z: number }): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z)

export function registerDecalSystemBus(): void {
  bus.on('vfx.decal.spawn', (data: {
    configId: string
    pos: { x: number; y: number; z: number }
    normal: { x: number; y: number; z: number }
    rotation?: number
    scale?: number
  }) => {
    decalSystem?.spawn(data.configId, vec3(data.pos), vec3(data.normal), data)
  })
  bus.on('vfx.decal.batch', (data: {
    configId: string
    positions: { x: number; y: number; z: number }[]
    normal: { x: number; y: number; z: number }
    rotation?: number
    scale?: number
  }) => {
    decalSystem?.spawnBatch(data.configId, data.positions.map(vec3), vec3(data.normal), data)
  })
  bus.on('vfx.decal.clear', (configId?: string) => {
    decalSystem?.clear(configId)
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
    /** 生成一张贴花：发射方＝命中/踩踏的一方，接收方＝本文件的 DecalSystem。 */
    'vfx.decal.spawn': {
      configId: string
      pos: { x: number; y: number; z: number }
      normal: { x: number; y: number; z: number }
      rotation?: number
      scale?: number
    }
    /** 批量生成贴花（爆炸碎片、脚印序列）：发射方＝一次性给一串位置的一方，接收方＝本文件的 DecalSystem。 */
    'vfx.decal.batch': {
      configId: string
      positions: { x: number; y: number; z: number }[]
      normal: { x: number; y: number; z: number }
      rotation?: number
      scale?: number
    }
    /** 清理贴花（不给 configId＝全清）：发射方＝要收摊的一方，接收方＝本文件的 DecalSystem。 */
    'vfx.decal.clear': string | undefined
  }
}