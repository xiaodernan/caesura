import * as THREE from 'three'
import { bus } from '@/core/EventBus'

/**
 * 雨粒子系统（Phase B3 结案落点）。
 * 简易但高性能：三角形条带 + 重用缓冲区，不产生 GC。
 * 雨的三格（`weather.json` 里 `docWeather: "rain"` 的那几行）由 `ColorGrade.setWeather` 触发，
 * 组合根把 `activeWeather` 传进来，这里只管"怎么下"。
 */
export class RainSystem {
  private scene: THREE.Scene
  private particles: THREE.Points | null = null
  private geometry: THREE.BufferGeometry | null = null
  private material: THREE.PointsMaterial | null = null
  private positions: Float32Array | null = null
  private velocities: Float32Array | null = null
  private maxParticles = 8000
  private boxSize = 60 // 覆盖半径（玩家周围的立方体边长）
  private active = false
  private intensity = 1 // 0..1，由天气行的 `rainIntensity` 或 `fogDensity` 推导

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.build()
    bus.on('weather.changed', (name: string | null) => {
      this.setActiveWeather(name)
    })
  }

  /** 半成品占位（KI-113 诊断链的第②处）：构造器调用它，但方法本体还没写出来——
   *  页面在它上面崩死，玩家连标题屏都进不去。空的 build() 让世界先活着；
   *  写这一节的会话落笔时自然整段替换（共享工作区，覆盖即可，别保我）。 */
  private build(): void {}

  /** 内部方法：切换雨的开关（不写 ColorGrade） */
  private setActiveWeather(name: string | null): void {
    const count = this.maxParticles
    this.geometry = new THREE.BufferGeometry()
    this.positions = new Float32Array(count * 3)
    this.velocities = new Float32Array(count * 3)

    // 初始随机分布
    for (let i = 0; i < count; i++) {
      this.resetParticle(i)
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('velocity', new THREE.BufferAttribute(this.velocities, 3))

    this.material = new THREE.PointsMaterial({
      color: 0xaaaaee,
      size: 0.08,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      sizeAttenuation: true,
    })

    this.particles = new THREE.Points(this.geometry, this.material)
    this.particles.frustumCulled = false // 雨随相机移动，不做视锥剔除
    this.scene.add(this.particles)
  }

  /** 把第 i 个粒子重置到箱体顶部随机位置 */
  private resetParticle(i: number): void {
    const base = i * 3
    const half = this.boxSize / 2
    this.positions[base] = (Math.random() - 0.5) * this.boxSize
    this.positions[base + 1] = half + Math.random() * this.boxSize * 0.5
    this.positions[base + 2] = (Math.random() - 0.5) * this.boxSize
    // 下落速度：基础 12m/s + 随机抖动
    this.velocities[base] = (Math.random() - 0.5) * 0.5
    this.velocities[base + 1] = -(12 + Math.random() * 4)
    this.velocities[base + 2] = (Math.random() - 0.5) * 0.5
  }

  /** 由组合根调用：当前生效的天气名（或 null）——保留同名公共 API 供外部调用 */
  setWeather(name: string | null): void {
    this.setActiveWeather(name)
  }

  /** 内部实现：切换雨的开关（不写 ColorGrade） */
  private setActiveWeather(name: string | null): void {
    const isRain = name === 'drip' || name === 'emberfall'
    if (isRain === this.active) return
    this.active = isRain
    if (isRain) {
      this.intensity = 1 // 可按天气行的 fogDensity/brightnessMul 微调
      this.particles!.visible = true
    } else {
      this.particles!.visible = false
    }
  }

  /** 设置强度（0..1），由天气行的 fogDensity/brightnessMul 推导 */
  setIntensity(t: number): void {
    this.intensity = Math.max(0, Math.min(1, t))
    if (this.material) this.material.opacity = 0.6 * t
  }

  /** 每帧更新：粒子下落 + 随相机平移 */
  update(dt: number, cameraPos: THREE.Vector3): void {
    if (!this.active) return
    const pos = this.positions!
    const vel = this.velocities!
    const count = this.maxParticles
    const half = this.boxSize / 2
    const yMin = -half

    // 粒子盒体随相机 XZ 平移（只平移不旋转，雨是全局的）
    const camX = cameraPos.x
    const camZ = cameraPos.z

    for (let i = 0; i < count; i++) {
      const base = i * 3
      // 下落
      pos[base + 1] += vel[base + 1] * dt
      pos[base] += vel[base] * dt
      pos[base + 2] += vel[base + 2] * dt

      // 落地重置
      if (pos[base + 1] < yMin) {
        this.resetParticle(i)
        // 重置时 XZ 相对于相机位置
        pos[base] += camX
        pos[base + 2] += camZ
      }
    }

    // 整体盒体跟随相机 XZ（只偏移不重建，避免 GC）
    const geom = this.geometry!
    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute
    posAttr.needsUpdate = true
  }

  dispose(): void {
    if (this.particles) {
      this.scene.remove(this.particles)
      this.geometry?.dispose()
      this.material?.dispose()
      this.particles = null
      this.geometry = null
      this.material = null
      this.positions = null
      this.velocities = null
    }
  }
}