import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import { Pool } from '@/core/Pool'
import { Rng, clamp } from '@/core/Math'
import {
  VFX_PALETTE,
  createRingMaterial,
  createShardMaterial,
  createSparkMaterial,
  makeRingGeometry,
} from '@/vfx/materials'

type Vec3Like = { x: number; y: number; z: number }
type VfxRequest = { key: string; pos: Vec3Like; dir?: Vec3Like; scale?: number }

const RING_LAYOUT = [
  ['aOrigin', 3], ['aQuat', 4], ['aColor', 3], ['aBirth', 1],
  ['aDur', 1], ['aR0', 1], ['aR1', 1], ['aWidth', 1], ['aParam', 4],
] as const

const SPARK_LAYOUT = [
  ['aOrigin', 3], ['aVel', 3], ['aColor', 3], ['aDir', 3], ['aBirth', 1],
  ['aDur', 1], ['aKind', 1], ['aSize', 2], ['aParam', 4],
] as const

const SHARD_LAYOUT = [
  ['aOrigin', 3], ['aVel', 3], ['aColor', 3], ['aQuat', 4], ['aAxis', 3],
  ['aBirth', 1], ['aDur', 1], ['aSpin', 1], ['aSize', 1], ['aParam', 2],
] as const

/** 性能预算（art-direction §7.2 + 本阶段约束：同时活跃粒子实例 ≤2000、每特效 drawcall ≤3） */
export const VFX_BUDGET = { rings: 128, decals: 48, sparks: 1600, shards: 256, emitters: 24 } as const

/** 环的「声纹形态」参数：调用前置入 this.shape，再由 ring() 消费（零分配） */
interface RingStyle {
  delay: number; width: number; split: number; fringe: number; wave: number; intensity: number
}

interface TrailPreset {
  count: number; len: number; wid: number; life: number; jitter: number; offset: number; intensity: number
}

interface BurstPreset {
  count: number
  speed: number; speedVar: number
  /** 速度锥形半角（rad） */
  spread: number
  life: number; lifeVar: number
  size: number; sizeVar: number
  lenMul: number
  gravity: number; drag: number
  intensity: number
  /** 0=广告牌火星 1=沿方向拉长的光带 */
  kind: 0 | 1
  /** 光带对齐：跟随自身速度 or 固定发射方向 */
  align: 'vel' | 'dir'
  /** 出生延迟上限（s） */
  stagger: number
  /** 速度 y 抬升（碎核抛出、地尘上飘） */
  lift: number
  colorMix: number
  whiteMix: number
}

const BURST = {
  impact: { count: 12, speed: 4.2, speedVar: 2.2, spread: 0.95, life: 0.34, lifeVar: 0.16, size: 0.075, sizeVar: 0.05, lenMul: 1, gravity: 11, drag: 2.4, intensity: 1.2, kind: 0, align: 'vel', stagger: 0.02, lift: 0.5, colorMix: 0.5, whiteMix: 0.35 },
  parry: { count: 16, speed: 7.5, speedVar: 3.0, spread: 1.35, life: 0.3, lifeVar: 0.14, size: 0.09, sizeVar: 0.05, lenMul: 1, gravity: 6, drag: 2.0, intensity: 1.5, kind: 0, align: 'vel', stagger: 0.03, lift: 0.8, colorMix: 0, whiteMix: 0.6 },
  block: { count: 9, speed: 6.0, speedVar: 3.0, spread: 0.3, life: 0.24, lifeVar: 0.1, size: 0.5, sizeVar: 0.25, lenMul: 4, gravity: 8, drag: 3.0, intensity: 1.15, kind: 1, align: 'dir', stagger: 0.02, lift: 0.35, colorMix: 0.4, whiteMix: 0.2 },
  dust: { count: 10, speed: 1.9, speedVar: 1.0, spread: 1.5, life: 0.85, lifeVar: 0.35, size: 0.11, sizeVar: 0.08, lenMul: 1, gravity: 0.9, drag: 2.8, intensity: 0.42, kind: 0, align: 'vel', stagger: 0.06, lift: 0.3, colorMix: 0.85, whiteMix: 0 },
  shock: { count: 6, speed: 3.2, speedVar: 1.4, spread: 1.1, life: 0.26, lifeVar: 0.12, size: 0.06, sizeVar: 0.03, lenMul: 1, gravity: 12, drag: 2.6, intensity: 1.0, kind: 0, align: 'vel', stagger: 0.01, lift: 0.4, colorMix: 0.55, whiteMix: 0.15 },
  spike: { count: 7, speed: 3.0, speedVar: 1.6, spread: 0.42, life: 0.38, lifeVar: 0.16, size: 0.72, sizeVar: 0.35, lenMul: 3, gravity: 2.5, drag: 1.8, intensity: 1.05, kind: 1, align: 'dir', stagger: 0.07, lift: 1.0, colorMix: 0.3, whiteMix: 0.1 },
} satisfies Record<string, BurstPreset>

const TRAIL = {
  sword: { count: 5, len: 1.15, wid: 0.15, life: 0.19, jitter: 0.09, offset: 0.22, intensity: 1.0 },
  thrust: { count: 3, len: 1.7, wid: 0.065, life: 0.15, jitter: 0.035, offset: 0.12, intensity: 1.25 },
} satisfies Record<string, TrailPreset>

const UP = new THREE.Vector3(0, 1, 0)

interface Field { size: number; data: Float32Array; attr: THREE.InstancedBufferAttribute }

/**
 * 实例环形缓冲：活跃行始终压缩在 [0, live)，`mesh.count = live` ⇒ 每池常驻 1 个 drawcall。
 * 出生 = 追加一行；到期 = 与末行交换后收缩。整条路径零分配、零 GC（思路取自 core/Pool 的
 * free-list，但 GPU 要求实例行连续，所以用 swap-remove 代替自由链表）。
 */
class InstanceBuffer {
  readonly mesh: THREE.InstancedMesh
  readonly capacity: number
  private readonly fields = new Map<string, Field>()
  private liveCount = 0
  private dirty = false
  private peakCount = 0

  constructor(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
    layout: ReadonlyArray<readonly [string, number]>,
  ) {
    this.capacity = capacity
    for (const [key, size] of layout) {
      const data = new Float32Array(capacity * size)
      const attr = new THREE.InstancedBufferAttribute(data, size)
      attr.setUsage(THREE.DynamicDrawUsage)
      geometry.setAttribute(key, attr)
      this.fields.set(key, { size, data, attr })
    }
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity)
    const identity = new THREE.Matrix4()
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, identity)
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.name = name
    this.mesh.frustumCulled = false
    this.mesh.matrixAutoUpdate = false
    this.mesh.renderOrder = 5
    this.mesh.count = 0
  }

  get live(): number { return this.liveCount }
  get peak(): number { return this.peakCount }

  /** 领取一行；预算已满返回 -1（宁可少发一个特效，也不越预算） */
  spawn(): number {
    if (this.liveCount >= this.capacity) return -1
    const i = this.liveCount++
    if (i > this.peakCount) this.peakCount = i
    this.dirty = true
    return i
  }

  vec(row: number, key: string, x: number, y?: number, z?: number, w?: number): void {
    const f = this.req(key)
    const d = f.data
    const b = row * f.size
    d[b] = x
    if (f.size > 1) d[b + 1] = y ?? 0
    if (f.size > 2) d[b + 2] = z ?? 0
    if (f.size > 3) d[b + 3] = w ?? 0
  }

  num(row: number, key: string, v: number): void {
    this.req(key).data[row] = v
  }

  /** 到期回收（aBirth/aDur 存在行内，故延迟出生的回声同样适用） */
  cull(now: number): void {
    const birth = this.req('aBirth').data
    const dur = this.req('aDur').data
    for (let i = 0; i < this.liveCount; i++) {
      if (now - birth[i] > dur[i]) {
        this.removeAt(i)
        i--
      }
    }
  }

  sync(): void {
    if (this.dirty) {
      for (const f of this.fields.values()) f.attr.needsUpdate = true
      this.dirty = false
    }
    this.mesh.count = this.liveCount
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mesh.dispose()
  }

  private removeAt(i: number): void {
    const last = this.liveCount - 1
    if (i !== last) {
      for (const f of this.fields.values()) {
        f.data.copyWithin(i * f.size, last * f.size, (last + 1) * f.size)
      }
    }
    this.liveCount = last
    this.dirty = true
  }

  private req(key: string): Field {
    const f = this.fields.get(key)
    if (!f) throw new Error(`vfx: unknown instance attribute "${key}"`)
    return f
  }
}

/** 延迟发射器（声纹回声、碎核二段抛出）：跨帧继续抛实例，池化复用 */
interface Emitter {
  kind: 'echo' | 'shatter'
  px: number; py: number; pz: number
  dx: number; dy: number; dz: number
  scale: number
  interval: number
  timer: number
  remaining: number
}

const newEmitter = (): Emitter => ({
  kind: 'echo', px: 0, py: 0, pz: 0, dx: 0, dy: 0, dz: 1,
  scale: 1, interval: 0.1, timer: 0.1, remaining: 0,
})

const resetEmitter = (e: Emitter): void => {
  e.kind = 'echo'
  e.px = 0; e.py = 0; e.pz = 0
  e.dx = 0; e.dy = 0; e.dz = 1
  e.scale = 1; e.interval = 0.1; e.timer = 0.1; e.remaining = 0
}

/**
 * VfxLayer —— 战斗原型 VFX 全集（Phase 1）
 *
 * 只消费总线上的 `vfx.request`（payload `{key, pos, dir?, scale?}`）；gameplay 永不读取 VFX 返回值
 * （technical-architecture §2 依赖规则）。支持 key：hit_ring / impact_sparks / parry_ring /
 * block_spark / trail_sword(=swing_trail) / trail_thrust / ring_echo / shock_small / spike_chord /
 * ring_dust / death_shatter / decal_rings。
 *
 * 常驻 4 个 InstancedMesh 池 = 全场 4 个 drawcall；单个特效最多触及 rings+sparks+shards = 3 call。
 * 粒子+碎片实例合计上限 1856（预算 2000）；环与地面涟漪贴花另计（≤128 / ≤48）。
 * 生命周期全部由 shader 按 aBirth/aDur 解析推进，CPU 只在出生与到期回收时碰属性缓冲。
 */
export class VfxLayer {
  readonly group = new THREE.Group()

  private readonly ringMat = createRingMaterial()
  private readonly sparkMat = createSparkMaterial()
  private readonly shardMat = createShardMaterial()
  private readonly rings: InstanceBuffer
  private readonly decals: InstanceBuffer
  private readonly sparks: InstanceBuffer
  private readonly shards: InstanceBuffer

  private readonly emitters: Emitter[] = []
  private readonly emitterPool: Pool<Emitter>

  private readonly rng = new Rng('caesura.vfx')
  private readonly colors: Record<keyof typeof VFX_PALETTE, THREE.Color>
  private readonly tmpColor: THREE.Color
  /** 解析后的请求方向，一个事件内有效 */
  private readonly dirVec = new THREE.Vector3()
  /** coneDir() 的输出，独立于 dirVec 以免串写 */
  private readonly coneVec = new THREE.Vector3()
  private readonly normalVec = new THREE.Vector3()
  private readonly axisZ = new THREE.Vector3(0, 0, 1)
  private readonly quat = new THREE.Quaternion()
  /** 供延迟发射器复用的 Vec3Like 视图 */
  private readonly emitPos = { x: 0, y: 0, z: 0 }

  /** 逻辑时钟：按真实时间推进；hitStop 期间降到 0.14x，保留打击凝滞而不是完全冻结 */
  private time = 0
  private timeScale = 1
  private readonly player = new THREE.Vector3()
  private hasPlayer = false
  private readonly warned = new Set<string>()

  private readonly shape: RingStyle = { delay: 0, width: 0.18, split: 1, fringe: 0.9, wave: 0.3, intensity: 1.25 }

  private readonly onRequest = (req: VfxRequest): void => {
    const scale = clamp(req.scale ?? 1, 0.2, 4)
    const dir = this.resolveDir(req)
    const p = req.pos
    switch (req.key) {
      case 'hit_ring': this.hitRing(p, dir, scale); break
      case 'impact_sparks': this.burstAt(p, dir, this.colors.warmGold, BURST.impact, scale); break
      case 'parry_ring': this.parryRing(p, dir, scale); break
      case 'block_spark': this.blockSpark(p, dir, scale); break
      case 'swing_trail':
      case 'trail_sword': this.trail(p, dir, scale, TRAIL.sword, this.colors.warmGold); break
      case 'trail_thrust': this.trail(p, dir, scale, TRAIL.thrust, this.colors.silver); break
      case 'ring_echo': this.ringEcho(p, dir, scale); break
      case 'shock_small': this.shockSmall(p, dir, scale); break
      case 'spike_chord': this.spikeChord(p, scale); break
      case 'ring_dust': this.ringDust(p, scale); break
      case 'death_shatter': this.deathShatter(p, scale); break
      case 'decal_rings': this.decalRings(p, scale); break
      default: this.warnUnknown(req.key)
    }
  }

  private readonly onHitStop = (e: { active: boolean }): void => {
    this.timeScale = e.active ? 0.14 : 1
  }

  constructor(scene: THREE.Scene) {
    this.group.name = 'vfx'
    this.colors = {
      warmGold: new THREE.Color(VFX_PALETTE.warmGold),
      parryWhite: new THREE.Color(VFX_PALETTE.parryWhite),
      discordViolet: new THREE.Color(VFX_PALETTE.discordViolet),
      ember: new THREE.Color(VFX_PALETTE.ember),
      silver: new THREE.Color(VFX_PALETTE.silver),
    }
    this.tmpColor = this.colors.warmGold.clone()

    this.rings = new InstanceBuffer('vfx.rings', makeRingGeometry(), this.ringMat, VFX_BUDGET.rings, RING_LAYOUT)
    // 地面残留涟漪与空中声纹共用同一材质（同一 program），只是多一个批次
    this.decals = new InstanceBuffer('vfx.decal_rings', makeRingGeometry(), this.ringMat, VFX_BUDGET.decals, RING_LAYOUT)
    this.sparks = new InstanceBuffer('vfx.sparks', new THREE.PlaneGeometry(1, 1), this.sparkMat, VFX_BUDGET.sparks, SPARK_LAYOUT)
    this.shards = new InstanceBuffer('vfx.shards', new THREE.TetrahedronGeometry(0.5, 0), this.shardMat, VFX_BUDGET.shards, SHARD_LAYOUT)

    this.group.add(this.rings.mesh, this.decals.mesh, this.sparks.mesh, this.shards.mesh)
    scene.add(this.group)

    this.emitterPool = new Pool<Emitter>(newEmitter, resetEmitter, VFX_BUDGET.emitters)
    // 构造期把 factory 的分配全部预热掉，运行期 obtain() 永不 new
    const warm: Emitter[] = []
    for (let i = 0; i < VFX_BUDGET.emitters; i++) warm.push(this.emitterPool.obtain())
    for (const e of warm) this.emitterPool.release(e)

    bus.on('vfx.request', this.onRequest)
    bus.on('time.hitStop', this.onHitStop)
    bus.emit('log', {
      level: 'info',
      msg: `vfx layer ready (rings ${VFX_BUDGET.rings}, particles ${VFX_BUDGET.sparks + VFX_BUDGET.shards}, 4 drawcalls)`,
    })
  }

  /** 可选：登记「声源锚点」。缺 dir 的请求以此定向，地面涟漪贴花以此取参考高度 */
  attachPlayer(pos: Vec3Like): void {
    this.player.set(pos.x, pos.y, pos.z)
    this.hasPlayer = true
  }

  /**
   * 由外部渲染循环驱动。标准调用是 render 钩子的 `update(alpha, realDelta)`；
   * 也接受只传一个真实时长的简写（此时该值既是帧时长，也当帧内偏移用，退化为一帧内的采样点）。
   */
  update(alpha: number, realDelta: number = alpha): void {
    const dt = realDelta * this.timeScale
    const prev = this.time
    this.time += dt
    // 子帧插值：绘制时钟在 [prev, now] 内按 alpha 采样，扩散与干涉条纹不出现台阶
    const draw = prev + dt * clamp(alpha, 0, 1)
    this.ringMat.uniforms.uTime.value = draw
    this.sparkMat.uniforms.uTime.value = draw
    this.shardMat.uniforms.uTime.value = draw

    this.tickEmitters(dt)

    this.rings.cull(this.time)
    this.decals.cull(this.time)
    this.sparks.cull(this.time)
    this.shards.cull(this.time)
    this.rings.sync()
    this.decals.sync()
    this.sparks.sync()
    this.shards.sync()
  }

  get stats(): {
    rings: number; decals: number; sparks: number; shards: number
    particles: number; emitters: number; drawCalls: number; peakParticles: number
  } {
    return {
      rings: this.rings.live,
      decals: this.decals.live,
      sparks: this.sparks.live,
      shards: this.shards.live,
      particles: this.sparks.live + this.shards.live,
      emitters: this.emitters.length,
      drawCalls: 4,
      peakParticles: this.sparks.peak + this.shards.peak,
    }
  }

  dispose(): void {
    bus.off('vfx.request', this.onRequest)
    bus.off('time.hitStop', this.onHitStop)
    for (const e of this.emitters) this.emitterPool.release(e)
    this.emitters.length = 0
    this.rings.dispose()
    this.decals.dispose()
    this.sparks.dispose()
    this.shards.dispose()
    this.ringMat.dispose()
    this.sparkMat.dispose()
    this.shardMat.dispose()
    this.group.removeFromParent()
  }

  /* ------------------------------ 特效配方 ------------------------------ */

  /** 受击声纹环：面朝命中轴的双环 + 一圈延迟回声 */
  private hitRing(p: Vec3Like, dir: THREE.Vector3, s: number): void {
    const sh = this.shape
    sh.delay = 0; sh.width = 0.2 * s; sh.split = 1; sh.fringe = 1; sh.wave = 0.34; sh.intensity = 1.25
    this.ring(p.x, p.y, p.z, dir.x, dir.y, dir.z, this.colors.warmGold, 0.06 * s, 0.82 * s, 0.34)
    sh.delay = 0.07; sh.width = 0.1 * s; sh.split = 0; sh.fringe = 1.2; sh.wave = 0.16; sh.intensity = 0.75
    this.ring(p.x, p.y, p.z, dir.x, dir.y, dir.z, this.colors.ember, 0.1 * s, 0.52 * s, 0.28)
  }

  /** 弹反白色大环：全游戏唯一「金白爆点」，双环 + 强干涉 + 回声 + 白火星 */
  private parryRing(p: Vec3Like, dir: THREE.Vector3, s: number): void {
    const sh = this.shape
    sh.delay = 0; sh.width = 0.36 * s; sh.split = 1; sh.fringe = 1.35; sh.wave = 0.5; sh.intensity = 1.35
    this.ring(p.x, p.y, p.z, dir.x, dir.y, dir.z, this.colors.parryWhite, 0.12 * s, 2.65 * s, 0.5)
    sh.delay = 0.08; sh.width = 0.16 * s; sh.split = 1; sh.fringe = 1.1; sh.wave = 0.22; sh.intensity = 0.85
    this.ring(p.x, p.y, p.z, dir.x, dir.y, dir.z, this.colors.parryWhite, 0.1 * s, 1.75 * s, 0.42)
    this.burstAt(p, dir, this.colors.parryWhite, BURST.parry, s)
  }

  /** 格挡单向火花：一束沿切线飞出的窄光带 + 一圈压扁的小环 */
  private blockSpark(p: Vec3Like, dir: THREE.Vector3, s: number): void {
    this.burstAt(p, dir, this.colors.ember, BURST.block, s)
    const sh = this.shape
    sh.delay = 0; sh.width = 0.12 * s; sh.split = 0; sh.fringe = 1.1; sh.wave = 0.14; sh.intensity = 0.9
    this.ring(p.x, p.y, p.z, dir.x * 0.6, dir.y * 0.6 + 0.8, dir.z * 0.6, this.colors.parryWhite, 0.05 * s, 0.42 * s, 0.24)
  }

  /** 武器拖尾：沿 dir 排布的一串短促光带（剑=宽暖金，突刺=窄冷银白） */
  private trail(p: Vec3Like, dir: THREE.Vector3, s: number, preset: TrailPreset, col: THREE.Color): void {
    const buf = this.sparks
    const span = preset.len * 0.5
    for (let i = 0; i < preset.count; i++) {
      const row = buf.spawn()
      if (row < 0) break
      const t = i / (preset.count - 1)
      const along = preset.offset + t * span
      const fade = 1 - t * 0.45
      buf.vec(row, 'aOrigin',
        p.x + dir.x * along + this.rng.float(-preset.jitter, preset.jitter),
        p.y + dir.y * along + this.rng.float(-preset.jitter, preset.jitter),
        p.z + dir.z * along + this.rng.float(-preset.jitter, preset.jitter))
      buf.vec(row, 'aVel', 0, 0, 0)
      buf.vec(row, 'aColor', col.r, col.g, col.b)
      buf.vec(row, 'aDir', dir.x, dir.y, dir.z)
      buf.num(row, 'aBirth', this.time + t * 0.028)
      buf.num(row, 'aDur', preset.life * (0.8 + fade * 0.3))
      buf.num(row, 'aKind', 1)
      buf.vec(row, 'aSize', preset.len * (0.72 + fade * 0.4) * s, preset.wid * s)
      buf.vec(row, 'aParam', 0, 0, preset.intensity * fade * (0.75 + s * 0.25), 1)
    }
  }

  /** 声纹回声：主环即时 + 两道错时扩散的干涉环 */
  private ringEcho(p: Vec3Like, dir: THREE.Vector3, s: number): void {
    const sh = this.shape
    sh.delay = 0; sh.width = 0.22 * s; sh.split = 1; sh.fringe = 1.4; sh.wave = 0.28; sh.intensity = 1.0
    this.ring(p.x, p.y, p.z, dir.x, dir.y, dir.z, this.colors.warmGold, 0.15 * s, 1.5 * s, 0.6)
    this.schedule('echo', p, dir, s, 0.14, 2)
  }

  /** 小冲击波：紧环 + 一撮短火星 */
  private shockSmall(p: Vec3Like, dir: THREE.Vector3, s: number): void {
    const sh = this.shape
    sh.delay = 0; sh.width = 0.12 * s; sh.split = 0; sh.fringe = 0.8; sh.wave = 0.2; sh.intensity = 1.0
    this.ring(p.x, p.y, p.z, dir.x, dir.y, dir.z, this.colors.ember, 0.05 * s, 0.55 * s, 0.24)
    this.burstAt(p, dir, this.colors.warmGold, BURST.shock, s)
  }

  /** 尖刺和弦：一撮竖立的细长紫音刺 + 地面失谐环（仅敌方/失谐语义，色相 270–290°） */
  private spikeChord(p: Vec3Like, s: number): void {
    this.burstAt(p, UP, this.colors.discordViolet, BURST.spike, s)
    const sh = this.shape
    sh.delay = 0; sh.width = 0.1 * s; sh.split = 0; sh.fringe = 1.3; sh.wave = 0.42; sh.intensity = 0.9
    this.ring(p.x, p.y + 0.03, p.z, UP.x, UP.y, UP.z, this.colors.discordViolet, 0.08 * s, 0.7 * s, 0.3)
  }

  /** 落地尘环：贴地平摊的低频宽环（FRESH 档）+ 上飘尘粒 */
  private ringDust(p: Vec3Like, s: number): void {
    const sh = this.shape
    sh.delay = 0; sh.width = 0.34 * s; sh.split = 0; sh.fringe = 0.45; sh.wave = 0.26; sh.intensity = 0.62
    this.ring(p.x, p.y + 0.04, p.z, UP.x, UP.y, UP.z, this.colors.warmGold, 0.18 * s, 1.7 * s, 0.66)
    this.burstAt(p, UP, this.colors.warmGold, BURST.dust, s)
  }

  /** 敌人死亡：碎裂振核抛出（发光四面体群）+ 失谐紫环 + 二段碎屑 */
  private deathShatter(p: Vec3Like, s: number): void {
    this.emitShards(p, s, 16, 0)
    const sh = this.shape
    sh.delay = 0; sh.width = 0.3 * s; sh.split = 1; sh.fringe = 1.3; sh.wave = 0.55; sh.intensity = 1.15
    this.ring(p.x, p.y + 0.6, p.z, 0, 1, 0, this.colors.discordViolet, 0.1 * s, 1.45 * s, 0.55)
    sh.delay = 0.1; sh.width = 0.14 * s; sh.split = 0; sh.fringe = 1.5; sh.wave = 0.3; sh.intensity = 0.8
    this.ring(p.x, p.y + 0.6, p.z, 0, 0.25, 1, this.colors.discordViolet, 0.15 * s, 2.1 * s, 0.7)
    this.schedule('shatter', p, UP, s, 0.12, 2)
  }

  /** 地面残留涟漪（贴花）：三道同心环，淡出 6s，走独立 decal 池以免挤占空中环预算 */
  private decalRings(p: Vec3Like, s: number): void {
    const sh = this.shape
    const y = (this.hasPlayer ? Math.min(p.y, this.player.y) : p.y) + 0.03
    sh.delay = 0; sh.width = 0.2 * s; sh.split = 0; sh.fringe = 0.9; sh.wave = 0.14; sh.intensity = 0.36
    this.ring(p.x, y, p.z, UP.x, UP.y, UP.z, this.colors.warmGold, 0.25 * s, 1.05 * s, 6, this.decals)
    sh.delay = 0.5; sh.width = 0.14 * s; sh.split = 1; sh.fringe = 1.05; sh.wave = 0.1; sh.intensity = 0.26
    this.ring(p.x, y, p.z, UP.x, UP.y, UP.z, this.colors.ember, 0.4 * s, 1.6 * s, 5.4, this.decals)
    sh.delay = 1.1; sh.width = 0.1 * s; sh.split = 0; sh.fringe = 0.7; sh.wave = 0.08; sh.intensity = 0.2
    this.ring(p.x, y, p.z, UP.x, UP.y, UP.z, this.colors.warmGold, 0.55 * s, 2.15 * s, 4.8, this.decals)
  }

  /* -------------------------------- 原语 -------------------------------- */

  /** 环原语：法向→四元数（RingGeometry 法线为 +Z），波形参数取 this.shape */
  private ring(
    px: number, py: number, pz: number,
    nx: number, ny: number, nz: number,
    col: THREE.Color, r0: number, r1: number, dur: number,
    buf: InstanceBuffer = this.rings,
  ): void {
    const row = buf.spawn()
    if (row < 0) return
    const sh = this.shape
    this.setNormal(nx, ny, nz)
    buf.vec(row, 'aOrigin', px, py, pz)
    buf.vec(row, 'aQuat', this.quat.x, this.quat.y, this.quat.z, this.quat.w)
    buf.vec(row, 'aColor', col.r, col.g, col.b)
    buf.num(row, 'aBirth', this.time + sh.delay)
    buf.num(row, 'aDur', dur)
    buf.num(row, 'aR0', r0)
    buf.num(row, 'aR1', Math.max(r1, r0 + 0.02))
    buf.num(row, 'aWidth', sh.width)
    buf.vec(row, 'aParam', sh.split, sh.fringe, sh.wave, sh.intensity)
  }

  private burstAt(p: Vec3Like, dir: THREE.Vector3, col: THREE.Color, preset: BurstPreset, s: number): void {
    const buf = this.sparks
    for (let i = 0; i < preset.count; i++) {
      const row = buf.spawn()
      if (row < 0) break
      const v = this.coneDir(dir, preset.spread)
      const speed = (preset.speed + this.rng.float(-preset.speedVar, preset.speedVar)) * s
      const vx = v.x * speed
      const vy = v.y * speed + preset.lift * s
      const vz = v.z * speed
      const size = (preset.size + this.rng.float(-preset.sizeVar, preset.sizeVar)) * s
      this.mixColor(col, preset)
      buf.vec(row, 'aOrigin', p.x, p.y, p.z)
      buf.vec(row, 'aVel', vx, vy, vz)
      buf.vec(row, 'aColor', this.tmpColor.r, this.tmpColor.g, this.tmpColor.b)
      if (preset.align === 'dir') buf.vec(row, 'aDir', dir.x, dir.y, dir.z)
      else buf.vec(row, 'aDir', vx, vy, vz)
      buf.num(row, 'aBirth', this.time + this.rng.float(0, preset.stagger))
      buf.num(row, 'aDur', clamp(preset.life + this.rng.float(-preset.lifeVar, preset.lifeVar), 0.05, 8))
      buf.num(row, 'aKind', preset.kind)
      buf.vec(row, 'aSize', size * preset.lenMul, size)
      buf.vec(row, 'aParam', preset.gravity, preset.drag, preset.intensity * (0.75 + s * 0.25), 1)
    }
  }

  /** 发光四面体碎片（振核碎屑抛出） */
  private emitShards(p: Vec3Like, s: number, count: number, delay: number): void {
    const buf = this.shards
    for (let i = 0; i < count; i++) {
      const row = buf.spawn()
      if (row < 0) break
      const v = this.coneDir(UP, 1.15)
      const speed = this.rng.float(2.4, 6.4) * s
      const vx = v.x * speed
      const vy = v.y * speed + 3.2 * s
      const vz = v.z * speed
      this.setNormal(this.rng.float(-1, 1), this.rng.float(-1, 1), this.rng.float(-1, 1))
      const spinAxis = this.coneDir(UP, Math.PI * 0.5)
      this.tmpColor.copy(this.colors.discordViolet)
      if (this.rng.chance(0.3)) this.tmpColor.lerp(this.colors.warmGold, 0.4)
      buf.vec(row, 'aOrigin',
        p.x + this.rng.float(-0.25, 0.25) * s,
        p.y + this.rng.float(0.2, 1.15) * s,
        p.z + this.rng.float(-0.25, 0.25) * s)
      buf.vec(row, 'aVel', vx, vy, vz)
      buf.vec(row, 'aColor', this.tmpColor.r, this.tmpColor.g, this.tmpColor.b)
      buf.vec(row, 'aQuat', this.quat.x, this.quat.y, this.quat.z, this.quat.w)
      buf.vec(row, 'aAxis', spinAxis.x, spinAxis.y, spinAxis.z)
      buf.num(row, 'aBirth', this.time + delay + this.rng.float(0, 0.05))
      buf.num(row, 'aDur', this.rng.float(0.85, 1.5))
      buf.num(row, 'aSpin', this.rng.float(-9, 9))
      buf.num(row, 'aSize', this.rng.float(0.07, 0.2) * s)
      buf.vec(row, 'aParam', 9.5, 1.15)
    }
  }

  private schedule(kind: Emitter['kind'], p: Vec3Like, dir: THREE.Vector3, scale: number, interval: number, remaining: number): void {
    if (this.emitterPool.live >= VFX_BUDGET.emitters) return
    const e = this.emitterPool.obtain()
    e.kind = kind
    e.px = p.x; e.py = p.y; e.pz = p.z
    e.dx = dir.x; e.dy = dir.y; e.dz = dir.z
    e.scale = scale
    e.interval = interval
    e.timer = interval
    e.remaining = remaining
    this.emitters.push(e)
  }

  private tickEmitters(dt: number): void {
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i]
      e.timer -= dt
      if (e.timer > 0) continue
      e.timer += e.interval
      e.remaining--
      const dir = this.dirVec.set(e.dx, e.dy, e.dz)
      if (e.kind === 'echo') {
        const sh = this.shape
        const k = Math.max(e.remaining, 0)
        sh.delay = 0; sh.width = 0.14 * e.scale; sh.split = 1; sh.fringe = 1.5
        sh.wave = 0.2 + k * 0.06; sh.intensity = 0.55 + k * 0.12
        this.ring(e.px, e.py, e.pz, dir.x, dir.y, dir.z, this.colors.warmGold, 0.2 * e.scale, (2.3 + (2 - k) * 0.6) * e.scale, 0.75)
      } else {
        const pos = this.emitPos
        pos.x = e.px; pos.y = e.py; pos.z = e.pz
        this.emitShards(pos, e.scale, 5, 0)
      }
      if (e.remaining <= 0) {
        const moved = this.emitters.pop()
        if (moved && i < this.emitters.length) this.emitters[i] = moved
        this.emitterPool.release(e)
      }
    }
  }

  /* -------------------------------- 工具 -------------------------------- */

  private setNormal(nx: number, ny: number, nz: number): void {
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len < 1e-6) this.quat.identity()
    else this.quat.setFromUnitVectors(this.axisZ, this.normalVec.set(nx / len, ny / len, nz / len))
  }

  /** 请求方向；缺 dir 时退回「声源锚点 → 特效点」，再兜底 +Z */
  private resolveDir(req: VfxRequest): THREE.Vector3 {
    const d = this.dirVec
    if (req.dir) d.set(req.dir.x, req.dir.y, req.dir.z)
    else if (this.hasPlayer) d.set(req.pos.x - this.player.x, req.pos.y - this.player.y, req.pos.z - this.player.z)
    else d.set(0, 0, 1)
    if (d.lengthSq() < 1e-8) d.set(0, 0, 1)
    return d.normalize()
  }

  /** 以 dir 为轴、spread 为半角的锥内均匀单位向量（输出独立向量，嵌套调用不会串写 dir） */
  private coneDir(dir: THREE.Vector3, spread: number): THREE.Vector3 {
    const z = 1 - this.rng.float(0, 1 - Math.cos(spread))
    const r = Math.sqrt(Math.max(0, 1 - z * z))
    const phi = this.rng.float(0, Math.PI * 2)
    const rx = r * Math.cos(phi)
    const ry = r * Math.sin(phi)
    let ax: number
    let ay: number
    let az: number
    if (Math.abs(dir.z) > 0.9999) {
      ax = 1; ay = 0; az = 0
    } else {
      const k = Math.sqrt(Math.max(1e-6, 1 - dir.z * dir.z))
      ax = dir.z / k; ay = 0; az = -dir.x / k
    }
    // 第二基向量 B = D × A，保证 (A, B, D) 正交
    const bx = dir.y * az - dir.z * ay
    const by = dir.z * ax - dir.x * az
    const bz = dir.x * ay - dir.y * ax
    return this.coneVec.set(
      rx * ax + ry * bx + z * dir.x,
      rx * ay + ry * by + z * dir.y,
      rx * az + ry * bz + z * dir.z,
    ).normalize()
  }

  private mixColor(col: THREE.Color, preset: BurstPreset): void {
    this.tmpColor.copy(col)
    if (preset.colorMix > 0) this.tmpColor.lerp(this.colors.ember, this.rng.float(0, preset.colorMix))
    if (preset.whiteMix > 0) this.tmpColor.lerp(this.colors.parryWhite, this.rng.float(0, preset.whiteMix))
  }

  private warnUnknown(key: string): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    bus.emit('log', { level: 'warn', msg: `vfx: unknown key "${key}" (已忽略)` })
  }
}
