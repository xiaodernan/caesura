import * as THREE from 'three'

/**
 * 雨粒子系统（Phase B3 结案落点）。
 * 简易但高性能：三角形条带 + 重用缓冲区，不产生 GC。
 * 雨的三格（`weather.json` 里 `docWeather: "rain"` 的那几行）由 `ColorGrade.setWeather` 触发，
 * 组合根把 `activeWeather` 传进来，这里只管"怎么下"。
 *
 * KI-126：原先这里订过一条 `bus.on('weather.changed', …)`，但全仓**没有任何一处** emit 它
 * （声明与发射两边都不存在）⇒ 那条订阅删掉（本类也不再 import EventBus）。
 * 天气从**已有的注入口**进来：组合根调 `setWeather(name)`（与 `ColorGrade.setWeather` 同一形状），
 * 本类据此决定"下不下"与"下多大"——`intensity` 由此有读者，它驱动画多少粒子与多透明。
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
  /** 雨强 0..1：注入进来的天气名给出基准（雨档=1），外部可用 setIntensity 再调一档。 */
  private intensity = 0

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.build()
  }

  /**
   * 建雨粒子的缓冲与网格（构造器只调它一次）。
   *
   * 这一段原先挂在**第一个** `setActiveWeather` 名下——它跟第二个同名方法撞成 TS2393，
   * 而 class 体的规则是"后写的覆盖先写的"⇒ 运行时活着的其实是第二个（切开关那份），
   * 建雨的那份是死代码，于是雨永远建不出来。合并办法：建的那份搬进 `build()`，
   * 切的那份留作唯一的 `setActiveWeather`。
   */
  private build(): void {
    const count = this.maxParticles
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    const velocities = new Float32Array(count * 3)
    this.geometry = geometry
    this.positions = positions
    this.velocities = velocities

    // 初始随机分布
    for (let i = 0; i < count; i++) {
      this.resetParticle(i)
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3))

    const material = new THREE.PointsMaterial({
      color: 0xaaaaee,
      size: 0.08,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      sizeAttenuation: true,
    })
    this.material = material

    const particles = new THREE.Points(geometry, material)
    particles.frustumCulled = false // 雨随相机移动，不做视锥剔除
    particles.visible = false // 没下雨的时候不画
    this.particles = particles
    this.scene.add(particles)
  }

  /** 把第 i 个粒子重置到箱体顶部随机位置 */
  private resetParticle(i: number): void {
    // 缓冲还没建好时（理论上不会发生：build() 里先建缓冲再调这里）就不写
    const positions = this.positions
    const velocities = this.velocities
    if (!positions || !velocities) return
    const base = i * 3
    const half = this.boxSize / 2
    positions[base] = (Math.random() - 0.5) * this.boxSize
    positions[base + 1] = half + Math.random() * this.boxSize * 0.5
    positions[base + 2] = (Math.random() - 0.5) * this.boxSize
    // 下落速度：基础 12m/s + 随机抖动
    velocities[base] = (Math.random() - 0.5) * 0.5
    velocities[base + 1] = -(12 + Math.random() * 4)
    velocities[base + 2] = (Math.random() - 0.5) * 0.5
  }

  /** 由组合根调用：当前生效的天气名（或 null）——保留同名公共 API 供外部调用 */
  setWeather(name: string | null): void {
    this.setActiveWeather(name)
  }

  /** 内部实现：切换雨的开关（不写 ColorGrade） */
  private setActiveWeather(name: string | null): void {
    // 雨档＝weather.json 里 docWeather 为 "rain" 的那两行（drip / emberfall）
    const isRain = name === 'drip' || name === 'emberfall'
    if (isRain === this.active) return
    this.active = isRain
    const particles = this.particles
    if (isRain) {
      this.intensity = 1 // 雨档的基准雨强；外部可用 setIntensity 再调一档
      if (particles) particles.visible = true
    } else {
      if (particles) particles.visible = false
    }
    this.applyIntensity()
  }

  /** 设置强度（0..1），由天气行的 fogDensity/brightnessMul 推导 */
  setIntensity(t: number): void {
    this.intensity = Math.max(0, Math.min(1, t))
    this.applyIntensity()
  }

  /** 当前雨强下画多少个粒子（雨强 0 ⇒ 一个都不画） */
  private activeCount(): number {
    return Math.max(0, Math.round(this.maxParticles * this.intensity))
  }

  /** 把雨强落到画面上：画多少粒子 + 有多透明 */
  private applyIntensity(): void {
    const material = this.material
    if (material) material.opacity = 0.6 * this.intensity
    const geometry = this.geometry
    if (geometry) geometry.setDrawRange(0, this.activeCount())
  }

  /** 每帧更新：粒子下落 + 随相机平移 */
  update(dt: number, cameraPos: THREE.Vector3): void {
    if (!this.active) return
    const pos = this.positions
    const vel = this.velocities
    const geometry = this.geometry
    if (!pos || !vel || !geometry) return

    // 只算雨强允许的那一部分粒子（其余的留在原地，且不在 drawRange 里）
    const count = this.activeCount()
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
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute
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
