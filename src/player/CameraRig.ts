import * as THREE from 'three'
import { damp, clamp } from '@/core/Math'
import { bus } from '@/core/EventBus'
import type { PlayerController } from './ThirdPersonController'
import type { Vec3 } from '@/combat/EntityStats'

interface Shake { amp: number; freq: number; decay: number; t: number; roll: number }
/** §10 附加格的 FOV 脉冲：sin 包络——冲下去再自己回来（"-1°/120ms" 的"脉冲"就是这个形状） */
interface FovPulse { delta: number; dur: number; t: number }

/**
 * §10 震镜表：幅度/频率/持续 + 可选的 FOV 脉冲列（`fov` 度数差、`fovMs` 单程时长）。
 * 这张表只有一个消费者（本文件），所以它是代码表而不是 JSON——和 KI-017 第五步对
 * 「破防慢放」的裁决同一口径。`fov` 两列自 KI-051 起有真消费方：`shake()` 挂脉冲、
 * `update()` 按 sin 包络兑现。导出是为了「改表法」实测与 §10 的行对账测试。
 */
export const SHAKE_TABLE: Record<string, { amp: number; freq: number; dur: number; fov?: number; fovMs?: number }> = {
  graze: { amp: 0.3, freq: 18, dur: 0.1 },
  normal: { amp: 0.8, freq: 12, dur: 0.2 },
  hurt: { amp: 1.2, freq: 10, dur: 0.25 },
  parry: { amp: 0.5, freq: 24, dur: 0.06 },
  heavy: { amp: 2.0, freq: 6, dur: 0.4, fov: -1, fovMs: 120 },
  boss: { amp: 4.0, freq: 3.5, dur: 0.9 },
  /**
   * §10「驼鼓踏地」行：这不是命中回报，是**世界事件**——敌人 active 帧落下去就发
   * `camera.shake`（挥空也震，见 `Enemy.advanceAttackFrames`），所以距离衰减在
   * 订阅方做，而不是等 `combat.hit` 把它当一次命中。
   */
  stomp: { amp: 3.0, freq: 5, dur: 0.5, fov: -2, fovMs: 150 }
}

/** 世界事件震镜的距离衰减（表现层裁决，KI-051）：`FALLOFF_M` 米处归到 `FLOOR_MUL`，再远也不许低于它 */
const SHAKE_FALLOFF_M = 24
const SHAKE_FLOOR_MUL = 0.25

/**
 * §5.4 处决推轨：`fovDelta` 取设计「FOV 45°→38°」的**差值**（本作基准是 50，抄绝对值
 * 就是把两条标尺各说一遍）；`distMul` 是把锁定构图的距离再压四成。导出是为了改表法实测。
 */
export const EXEC_DOLLY = { fovDelta: -7, distMul: 0.4, damp: 8 }

export class CameraRig {
  yaw = 0.6
  pitch = 0.26
  dist = 5.6
  shakeIntensity = 1
  private shakes: Shake[] = []
  private fovPulses: FovPulse[] = []
  private baseFov: number
  /** 0..1，`damp` 到「正在处决」——推轨的距离/FOV 都乘它，演出结束自己退回去 */
  private execPull = 0
  private posSmooth = new THREE.Vector3(0, 2, 6)
  cam: THREE.PerspectiveCamera

  constructor(fov = 50, near = 0.1, far = 400) {
    this.baseFov = fov
    this.cam = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, near, far)
    bus.on('combat.hit', (h) => {
      if (h.result === 'hit' || h.result === 'graze') this.shake(h.shakeKey || 'graze')
      else if (h.result === 'block' || h.result === 'perfectBlock') this.shake('graze')
      else if (h.result === 'parry') this.shake('parry')
    })
    bus.on('player.damaged', () => this.shake('hurt'))
    // §15.1「转阶段敲钟怒吼 · 震镜 4°/900ms」：跳阶是一次世界事件，不是一次命中
    bus.on('boss.phase', () => this.shake('boss', 1.2))
    // §16 入场演出：照面那一下相机要"沉"一下（比跳阶轻——那是宣告，这只是登场）
    bus.on('boss.intro', () => this.shake('boss', 0.8))
    // KI-051：世界事件震镜（§10「驼鼓踏地」行的通路）。谁打中了它与震镜无关，
    // 但震源离镜头多远有关系——50 米外一场满幅 3° 是幻痛，不是反馈。
    bus.on('camera.shake', (p) => this.shakeWorldEvent(p.key, p.pos))
  }

  private shakeWorldEvent(key: string, pos?: { x: number; y: number; z: number }): void {
    let mul = 1
    if (pos) {
      const d = Math.hypot(this.cam.position.x - pos.x, this.cam.position.z - pos.z)
      mul = Math.max(SHAKE_FLOOR_MUL, 1 - d / SHAKE_FALLOFF_M)
    }
    this.shake(key, mul)
  }

  shake(key: string, mul = 1): void {
    const s = SHAKE_TABLE[key] ?? SHAKE_TABLE.graze
    this.shakes.push({ amp: s.amp * mul * this.shakeIntensity, freq: s.freq, decay: s.dur / 3, t: 0, roll: key === 'parry' ? 2 : 0 })
    if (this.shakes.length > 4) this.shakes.shift()
    // §10 附加格：这一行情境若声明了 FOV 脉冲，同一时刻挂上（衰减同一个 `mul`：
    // 远处的踏地不该只把震镜调小、FOV 却Full 幅冲下去）
    if (s.fov !== undefined && s.fovMs !== undefined) {
      this.fovPulses.push({ delta: s.fov * mul, dur: s.fovMs / 1000, t: 0 })
      if (this.fovPulses.length > 3) this.fovPulses.shift()
    }
  }

  resize(): void {
    this.cam.aspect = innerWidth / innerHeight
    this.cam.updateProjectionMatrix()
  }

  update(dt: number, player: PlayerController, look: { dx: number; dy: number }, lockTarget: Vec3 | null, shakeDt = dt): void {
    this.yaw -= look.dx
    this.pitch = clamp(this.pitch + look.dy * 0.55, -0.18, 1.2)
    const target = { x: player.pos.x, y: player.pos.y + 1.15, z: player.pos.z }
    let dist = this.dist
    // §5.4「锁定式越肩推轨」：处决演出期间镜头钉在受刑者身上——借用锁定同一套越肩构图
    // （中点/方位/距离夹取全是现成的），在它之上再叠一层 `execPull` 的推近与 FOV 收缩。
    // 真锁定优先：演出中玩家理论上锁不了别人（busy），但构图不许出现两个主人。
    this.execPull = damp(this.execPull, player.executing ? 1 : 0, EXEC_DOLLY.damp, dt)
    const montage = !lockTarget && player.executing ? player.executing.pos : null
    const aim = lockTarget ?? montage
    if (aim) {
      const mid = { x: (target.x + aim.x) / 2, z: (target.z + aim.z) / 2 }
      target.x = mid.x; target.z = mid.z
      target.y = player.pos.y + 1.2
      const d = Math.hypot(player.pos.x - aim.x, player.pos.z - aim.z)
      dist = clamp(4.2 + d * 0.35, 4.2, 8) * (montage ? 1 - EXEC_DOLLY.distMul * this.execPull : 1)
      const away = Math.atan2(player.pos.x - aim.x, player.pos.z - aim.z)
      this.yaw = damp(this.yaw, wrapNear(this.yaw, away + 0.35), 3, dt)
    }
    const sp = Math.sin(this.pitch), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw)
    const cp = Math.cos(this.pitch)
    const desired = new THREE.Vector3(
      target.x + sy * cp * dist,
      target.y + 0.4 + sp * dist,
      target.z + cy * cp * dist
    )
    const k = aim ? 8 : 12
    this.posSmooth.x = damp(this.posSmooth.x, desired.x, k, dt)
    this.posSmooth.y = damp(this.posSmooth.y, desired.y, k, dt)
    this.posSmooth.z = damp(this.posSmooth.z, desired.z, k, dt)
    if (this.posSmooth.y < 0.35) this.posSmooth.y = 0.35

    let offX = 0, offY = 0, roll = 0
    for (const s of this.shakes) {
      // 震镜走 `shakeDt`（= 逻辑 tick），不走跟随平滑那个 `dt`：combat.md §9 末行把「震镜」
      // 列进命中停顿期间**照常**的一类。§10 的包络 e^(-t/τ) 是以真实秒定义的，喂压缩时标会让
      // 波形在停顿那 90ms 里几乎冻结、恢复时又跳回去——那是故障，不是屏息。
      s.t += shakeDt
      const env = Math.exp(-s.t / s.decay)
      const osc = Math.sin(s.t * s.freq * Math.PI * 2) * s.amp * env
      offY += osc * 0.02; offX += osc * 0.012; roll += (s.roll ? s.roll * env * Math.sin(s.t * 40) : 0)
    }
    this.shakes = this.shakes.filter((s) => Math.exp(-s.t / s.decay) > 0.02)

    // §10 附加格「FOV -x°/y ms」：与震镜同窗（`shakeDt`，即逻辑 tick 时标）——FOV 脉冲和震镜
    // 是同一记"世界挨了一下"的两半，停顿期间自然要一起照常走完。
    let fovOff = 0
    for (const q of this.fovPulses) {
      q.t += shakeDt
      fovOff += q.delta * Math.sin(Math.PI * Math.min(1, q.t / q.dur))
    }
    this.fovPulses = this.fovPulses.filter((q) => q.t < q.dur)
    // §5.4 处决推轨的 FOV 分量：随 `execPull` 缓入缓出，与距离推进同一只手。
    const fov = this.baseFov + fovOff + EXEC_DOLLY.fovDelta * this.execPull
    if (Math.abs(fov - this.cam.fov) > 1e-4) {
      this.cam.fov = fov
      this.cam.updateProjectionMatrix()
    }

    this.cam.position.set(this.posSmooth.x + offX, this.posSmooth.y + offY, this.posSmooth.z)
    this.cam.lookAt(target.x, target.y + offY * 0.5, target.z)
    this.cam.rotation.z += roll * (Math.PI / 180)
    player.camYawRef = Math.atan2(this.posSmooth.x - target.x, this.posSmooth.z - target.z)
  }
}

function wrapNear(from: number, to: number): number {
  let d = to - from
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return from + d
}
