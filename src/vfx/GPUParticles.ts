import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import { registry } from '@/core/Registry'

/**
 * GPU 粒子系统（Phase B4 结案落点，tech-arch §1 Niagara 映射）。
 * 核心思想：实例属性环形缓冲 + 顶点动画 shader，CPU 仅管理发射器配置与生存周期。
 * 发射器配置全数据驱动（JSON），支持以下类型：
 *   - burst: 一次性爆发（击中、处决、技能特效）
 *   - stream: 持续流（火焰、魔法光环、环境粒子）
 *   - trail: 拖尾（武器、弹道）
 *   - ribbon: 缎带（武器挥舞轨迹、音波可视化）
 */
export interface EmitterConfig {
  id: string
  type: 'burst' | 'stream' | 'trail' | 'ribbon'
  maxParticles: number
  // 生成参数
  spawnRate: number // particles/sec (stream) / count (burst)
  spawnShape: 'point' | 'sphere' | 'box' | 'cone' | 'disc'
  spawnSize: THREE.Vector3
  // 粒子属性
  lifetime: { min: number; max: number }
  size: { start: number; end: number }
  color: { start: THREE.Color; end: THREE.Color }
  velocity: { min: THREE.Vector3; max: THREE.Vector3 }
  acceleration: THREE.Vector3
  // 行为
  gravity: number
  drag: number
  // 渲染
  texture?: string
  blending: THREE.Blending
  depthWrite: boolean
  sizeAttenuation: boolean
  // 轨迹/缎带专用
  trailLength?: number // 帧数
  ribbonWidth?: number
}

interface Particle {
  position: THREE.Vector3
  velocity: THREE.Vector3
  age: number
  lifetime: number
  size: number
  color: THREE.Color
  active: boolean
  // trail/ribbon
  prevPositions?: THREE.Vector3[]
}

/** 单发射器运行时状态 */
class EmitterInstance {
  config: EmitterConfig
  /** 全部粒子（环形缓冲的本体）：update 每帧扫一遍它 */
  particles: Particle[]
  spawnAccumulator = 0
  trailBuffer: THREE.Vector3[] = []
  // 这三个在 initGeometry() 里建出来（不在构造器里直接 new），用确定赋值断言说明这一点
  geometry!: THREE.BufferGeometry
  material!: THREE.PointsMaterial | THREE.MeshBasicMaterial
  mesh!: THREE.Points | THREE.Mesh
  /**
   * 空闲粒子池（回收站）：**不活跃**的粒子都躺在这里，发射时从这里取，
   * 粒子寿命走完时再丢回来。不变量：一个粒子在池里 ⇔ 它不活跃。
   * 有了它，发射不必每次都从头扫一遍 particles 找空位。
   */
  private pool: Particle[] = []

  constructor(config: EmitterConfig, scene: THREE.Scene) {
    this.config = config
    this.particles = new Array(config.maxParticles).fill(null).map(() => this.createParticle())
    for (const p of this.particles) this.pool.push(p) // 刚建好的都是不活跃的 ⇒ 全在池里
    this.initGeometry(scene)
  }

  private createParticle(): Particle {
    return {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      age: 0,
      lifetime: 0,
      size: 0,
      color: new THREE.Color(),
      active: false,
    }
  }

  private initGeometry(scene: THREE.Scene): void {
    const count = this.config.maxParticles
    this.geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const ages = new Float32Array(count)
    const lifetimes = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      positions[i * 3] = 0
      positions[i * 3 + 1] = -1000 // 初始在视野外
      positions[i * 3 + 2] = 0
      colors[i * 3] = 1
      colors[i * 3 + 1] = 1
      colors[i * 3 + 2] = 1
      sizes[i] = 0
      ages[i] = 0
      lifetimes[i] = 1
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    this.geometry.setAttribute('age', new THREE.BufferAttribute(ages, 1))
    this.geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1))
    this.geometry.setDrawRange(0, 0)

    if (this.config.type === 'ribbon') {
      // 缎带用 Mesh + LineGeometry
      this.material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: this.config.depthWrite,
        blending: this.config.blending,
      })
      this.mesh = new THREE.Mesh(this.geometry, this.material)
    } else {
      this.material = new THREE.PointsMaterial({
        vertexColors: true,
        size: 1,
        sizeAttenuation: this.config.sizeAttenuation,
        transparent: true,
        depthWrite: this.config.depthWrite,
        blending: this.config.blending,
        // 纹理可选：registry 里没有这一张就当没有（registry.get 缺 id 会抛）
        map: this.config.texture ? registry.maybeGet<THREE.Texture>(this.config.texture) ?? null : null,
      })
      this.mesh = new THREE.Points(this.geometry, this.material)
    }
    this.mesh.frustumCulled = false
    scene.add(this.mesh)
  }

  /** 发射新粒子（从空闲池里取；池空＝没有可复用的位置，这一轮就少发几个） */
  emit(count: number, origin: THREE.Vector3, inheritVelocity?: THREE.Vector3): number {
    let emitted = 0
    while (emitted < count) {
      const p = this.pool.pop()
      if (!p) break
      p.active = true
      p.position.copy(origin)
      p.velocity.set(
        THREE.MathUtils.lerp(this.config.velocity.min.x, this.config.velocity.max.x, Math.random()),
        THREE.MathUtils.lerp(this.config.velocity.min.y, this.config.velocity.max.y, Math.random()),
        THREE.MathUtils.lerp(this.config.velocity.min.z, this.config.velocity.max.z, Math.random())
      )
      if (inheritVelocity) p.velocity.add(inheritVelocity)
      p.age = 0
      p.lifetime = THREE.MathUtils.lerp(this.config.lifetime.min, this.config.lifetime.max, Math.random())
      p.size = this.config.size.start
      p.color.copy(this.config.color.start)
      emitted++
      if (this.config.type === 'ribbon') {
        p.prevPositions = [origin.clone()]
      }
    }
    return emitted
  }

  update(dt: number): void {
    const geom = this.geometry
    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute
    const colorAttr = geom.getAttribute('color') as THREE.BufferAttribute
    const sizeAttr = geom.getAttribute('size') as THREE.BufferAttribute
    const ageAttr = geom.getAttribute('age') as THREE.BufferAttribute
    const lifeAttr = geom.getAttribute('lifetime') as THREE.BufferAttribute

    let aliveCount = 0

    for (let i = 0; i < this.config.maxParticles; i++) {
      const p = this.particles[i]
      if (!p.active) continue

      p.age += 1 / 60 // 逻辑 tick
      const t = p.age / p.lifetime
      if (t >= 1) {
        p.active = false
        this.pool.push(p) // 寿命走完 ⇒ 回收进空闲池
        continue
      }

      // 物理更新
      p.velocity.y -= this.config.gravity * (1 / 60)
      p.velocity.multiplyScalar(1 - this.config.drag * (1 / 60))
      p.position.addScaledVector(p.velocity, 1 / 60)

      // 插值属性
      p.size = THREE.MathUtils.lerp(this.config.size.start, this.config.size.end, t)
      p.color.lerpColors(this.config.color.start, this.config.color.end, t)

      // 写入 buffer
      const base = i * 3
      posAttr.array[base] = p.position.x
      posAttr.array[base + 1] = p.position.y
      posAttr.array[base + 2] = p.position.z
      colorAttr.array[base] = p.color.r
      colorAttr.array[base + 1] = p.color.g
      colorAttr.array[base + 2] = p.color.b
      sizeAttr.array[i] = p.size
      ageAttr.array[i] = p.age
      lifeAttr.array[i] = p.lifetime

      // ribbon trail
      if (this.config.type === 'ribbon' && p.prevPositions) {
        p.prevPositions.unshift(p.position.clone())
        if (p.prevPositions.length > (this.config.trailLength ?? 20)) {
          p.prevPositions.pop()
        }
      }

      aliveCount++
    }

    geom.setDrawRange(0, aliveCount)
    posAttr.needsUpdate = true
    colorAttr.needsUpdate = true
    sizeAttr.needsUpdate = true
    ageAttr.needsUpdate = true
    lifeAttr.needsUpdate = true
  }

  /** 设置发射器位置（用于 trail/stream 类型） */
  setPosition(pos: THREE.Vector3): void {
    if (this.config.type === 'trail' || this.config.type === 'stream') {
      this.emit(this.config.spawnRate / 60, pos)
    }
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh)
  }
}

/** GPU 粒子系统管理器：统一管理所有发射器 */
export class GPUParticles {
  private scene: THREE.Scene
  private emitters = new Map<string, EmitterInstance>()
  private configs = new Map<string, EmitterConfig>()

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.loadConfigs()
  }

  private loadConfigs(): void {
    // 从 registry 读取 JSON 配置（构建期打包）。
    // 'vfx:emitters' 这张表全仓还没有写方（数据侧是另一批的活）：
    // 用 maybeGet 取，取不到＝没有配置，系统照常构造，只是什么都不画。
    const configs = registry.maybeGet<EmitterConfig[]>('vfx:emitters') ?? []
    for (const cfg of configs) {
      this.configs.set(cfg.id, cfg)
    }
  }

  /** 创建/获取发射器实例 */
  getEmitter(id: string): EmitterInstance | null {
    if (this.emitters.has(id)) return this.emitters.get(id)!
    const cfg = this.configs.get(id)
    if (!cfg) return null
    const instance = new EmitterInstance(cfg, this.scene)
    this.emitters.set(id, instance)
    return instance
  }

  /** 一次性爆发 */
  burst(id: string, pos: THREE.Vector3, count?: number): void {
    const emitter = this.getEmitter(id)
    if (emitter) emitter.emit(count ?? emitter.config.spawnRate, pos)
  }

  /** 持续流/拖尾更新位置 */
  stream(id: string, pos: THREE.Vector3): void {
    const emitter = this.getEmitter(id)
    if (emitter) emitter.setPosition(pos)
  }

  /** 每帧更新所有激活发射器 */
  update(dt: number): void {
    for (const emitter of this.emitters.values()) {
      emitter.update(dt)
    }
  }

  /** 移除发射器 */
  remove(id: string): void {
    const emitter = this.emitters.get(id)
    if (emitter) {
      emitter.dispose()
      this.emitters.delete(id)
    }
  }

  /** 清理所有 */
  dispose(): void {
    for (const emitter of this.emitters.values()) {
      emitter.dispose()
    }
    this.emitters.clear()
  }
}

// 全局单例（组合根持有）
let gpuParticles: GPUParticles | null = null

export function initGPUParticles(scene: THREE.Scene): GPUParticles {
  gpuParticles = new GPUParticles(scene)
  return gpuParticles
}

export function getGPUParticles(): GPUParticles | null {
  return gpuParticles
}

/** 便捷函数：注册到 bus 供系统调用 */
export function registerGPUParticlesBus(): void {
  bus.on('vfx.burst', (data: { id: string; pos: THREE.Vector3; count?: number }) => {
    gpuParticles?.burst(data.id, data.pos, data.count)
  })
  bus.on('vfx.stream', (data: { id: string; pos: THREE.Vector3 }) => {
    gpuParticles?.stream(data.id, data.pos)
  })
  bus.on('vfx.remove', (id: string) => {
    gpuParticles?.remove(id)
  })
}

/**
 * 本文件用到的三条事件，声明跟着写方走（写方与读方都在这个文件里，名字不写第二份）。
 */
declare module '@/core/EventBus' {
  interface GameEvents {
    /** 一次性爆发：发射方＝命中/处决/技能特效的一方，接收方＝本文件的 GPUParticles。 */
    'vfx.burst': { id: string; pos: THREE.Vector3; count?: number }
    /** 持续流（火焰、魔法光环）：发射方＝持有发射器的一方，接收方＝本文件的 GPUParticles。 */
    'vfx.stream': { id: string; pos: THREE.Vector3 }
    /** 移除某个发射器：发射方＝要收掉它的一方，接收方＝本文件的 GPUParticles（载荷就是 id 本身）。 */
    'vfx.remove': string
  }
}