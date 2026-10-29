import * as THREE from 'three'
import { damp, clamp } from '@/core/Math'
import { bus } from '@/core/EventBus'
import { firstBlock, type Occluder } from '@/core/Occlusion'
import type { PlayerController } from './ThirdPersonController'
import type { Vec3 } from '@/combat/EntityStats'

interface Shake { amp: number; freq: number; decay: number; t: number; roll: number }
/** §10 附加格的 FOV 脉冲：sin 包络——冲下去再自己回来（"-1°/120ms"的"脉冲"就是这个形状） */
interface FovPulse { delta: number; dur: number; t: number }

/**
 * 相机模式枚举（tech-arch §2 CameraRig：exploration/combat/lockOn/boss/cinematic）。
 *
 * **五种模式不是五套相机，是同一台相机的五组参数**（阻尼/距离/FOV/碰撞半径/前视偏移）。
 * 分成五种的原因是"同一件事在不同情境下要不同的脾气"：探索时远、慢、视野宽；
 * 锁定时贴肩、跟得紧、FOV 窄；Boss 战再退开一点、抬高一点；过场则把碰撞与阻尼都关掉。
 * 参数表 {@link MODE_CONFIG} 是这一层唯一的真源——`update()` 里没有第二份常数。
 */
export enum CameraMode {
  Exploration = 'exploration',
  Combat = 'combat',
  LockOn = 'lockOn',
  Boss = 'boss',
  Cinematic = 'cinematic',
}

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
  /**
   * §10「处决」行（KI-053）：1.0° 是设计给的数，它**比 heavy(2.0°) 轻**不是笔误——
   * 处决那一刀的时间演出已经有自己的主人（`EXEC_DOLLY` 推轨 + KI-003 的消音与专属音色），
   * 震镜在这里是"那一刀落"的标点，不是"这件事很大"的宣告；给它 2°/4° 会让每一记处决都和
   * 推轨打架（同 KI-017③ 对破防的口径：一记只许一个主人）。**Boss 处决同样走这一行**：
   * 表里的「4°/3.5Hz/900ms」那行是"阶段转换"这个情境，不是"对方血条长"这个身份。
   * 附加格没有 FOV 脉冲：§10 该行的附加格写着「推轨另控（§5.4）」。
   */
  heavy: { amp: 2.0, freq: 6, dur: 0.4, fov: -1, fovMs: 120 },
  boss: { amp: 4.0, freq: 3.5, dur: 0.9 },
  execute: { amp: 1.0, freq: 8, dur: 0.3 },
  /**
   * §10「驼鼓踏地」行：这不是命中回报，是**世界事件**——敌人 active 帧落下去就发
   * `camera.shake`（挥空也震，见 `Enemy.advanceAttackFrames`），所以距离衰减在
   * 订阅方做，而不是等 `combat.hit` 把它当一次命中。
   */
  stomp: { amp: 3.0, freq: 5, dur: 0.5, fov: -2, fovMs: 150 },
}

/** 世界事件震镜的距离衰减（表现层裁决，KI-051）：`FALLOFF_M` 米处归到 `FLOOR_MUL`，再远也不许低于它 */
export const SHAKE_FALLOFF_M = 24
export const SHAKE_FLOOR_MUL = 0.25

/**
 * §5.4 处决推轨：`fovDelta` 取设计「FOV 45°→38°」的**差值**（本作基准是 50，抄绝对值
 * 就是把两条标尺各说一遍）；`distMul` 是把锁定构图的距离再压四成。导出是为了改表法实测。
 */
export const EXEC_DOLLY = { fovDelta: -7, distMul: 0.4, damp: 8 }

/**
 * 模式配置表（各模式独立的阻尼/距离/FOV/碰撞/偏移）。
 *
 * **这张表就是"五种相机"的全部内容**——`update()` 里不许出现第二份模式常数。
 * `collisionRadius: 0` ＝ 该模式关掉相机碰撞（过场镜头由演出自己管轨道）。
 *
 * **每一格都必须有人读**（§55「无消费方的数据不许入表」）：`fovBase` 此前**没人读**
 * （相机在所有模式里都是 50°，combat.md §7「锁定式越肩推轨，FOV 45°」那一行在运行时是假的）
 * ⇒ 读者是 {@link CameraRig.setMode}；`collisionDamp` 那一列**含义从未被裁**（是"进墙的缓动"
 * 还是"出墙的缓动"？设计没说）⇒ 按 §55 **删列**，不替它编一个意思（要加回来，先说清它是什么）。
 * 守卫：`tests/unit/camera-mode-params.test.ts` 的「模式表里每一列都有人读」那条。
 */
export const MODE_CONFIG = {
  [CameraMode.Exploration]: {
    yawDamp: 3,
    pitchDamp: 3,
    posDamp: 6,
    distBase: 5.6,
    distMin: 3,
    distMax: 8,
    fovBase: 50,
    heightOffset: 1.15,
    collisionRadius: 0.35,
    lookAhead: 0,
  },
  [CameraMode.Combat]: {
    yawDamp: 4,
    pitchDamp: 4,
    posDamp: 8,
    distBase: 4.5,
    distMin: 3.5,
    distMax: 6,
    fovBase: 48,
    heightOffset: 1.0,
    collisionRadius: 0.3,
    lookAhead: 0.2,
  },
  [CameraMode.LockOn]: {
    yawDamp: 5,
    pitchDamp: 5,
    posDamp: 10,
    distBase: 4.2,
    distMin: 3.5,
    distMax: 5.5,
    fovBase: 45,
    heightOffset: 1.15,
    collisionRadius: 0.25,
    lookAhead: 0.35,
  },
  [CameraMode.Boss]: {
    yawDamp: 6,
    pitchDamp: 6,
    posDamp: 12,
    distBase: 6,
    distMin: 4,
    distMax: 10,
    fovBase: 42,
    heightOffset: 1.3,
    collisionRadius: 0.3,
    lookAhead: 0.5,
  },
  [CameraMode.Cinematic]: {
    yawDamp: 1,
    pitchDamp: 1,
    posDamp: 2,
    distBase: 8,
    distMin: 2,
    distMax: 20,
    fovBase: 50,
    heightOffset: 1.5,
    collisionRadius: 0,
    lookAhead: 0,
  },
} as const

/** `setMode` 携带的过场参数。**今天只有 `fov` 是相机的事**：cutscene 明确给了就用它，
 *  压过模式那一格。`pos`/`target`/`duration` 曾经只被原样转发到 `camera.modeChanged`
 *  的载荷里、没有别的读者；KI-355 删掉那条频道后它们也一起走了（§55：无消费方的数据不入表）。 */
export interface CameraModeData {
  fov?: number
}

export class CameraRig {
  private mode = CameraMode.Exploration
  /**
   * 锁定（越肩）之前的那一格：**解锁后要回到它**——锁定不该把人丢回探索格，
   * 而是丢回他原来待的那一格（进锁定前若在战斗格，解锁后还在战斗格）。
   */
  private preLockMode = CameraMode.Exploration
  yaw = 0.6
  pitch = 0.26
  dist = 5.6
  shakeIntensity = 1
  private shakes: Shake[] = []
  private fovPulses: FovPulse[] = []
  private baseFov = 50
  /** 0..1，`damp` 到「正在处决」——推轨的距离/FOV 都乘它，演出结束自己退回去 */
  private execPull = 0
  private posSmooth = new THREE.Vector3(0, 2, 6)
  cam: THREE.PerspectiveCamera
  private collisionEnabled = true
  /**
   * 相机碰撞用的遮挡名册。**与挡箭、挡视线是同一份盒子**（`core/Occlusion`）——
   * 相机撞墙与箭被墙挡住不许各写一份几何，否则"看着穿过去了"与"箭飞过去了"会各说各话。
   * 组合根注入（`setOccluders`）；空名册 = 不做碰撞（野外无 authored 墙的那种区域）。
   */
  private occluders: readonly Occluder[] = []

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
    // §6 过场进出：过场期间相机交给演出（碰撞与阻尼都松掉），演完回到探索模式。
    bus.on('cinematic.start', (d) => this.setMode(CameraMode.Cinematic, { fov: d.fov }))
    bus.on('cinematic.end', () => this.setMode(CameraMode.Exploration))
  }

  /**
   * 切换相机模式（可选进入/退出回调数据）。
   *
   * **同模式再进一次只重摆 FOV**：`cinematic.start` 与锁定状态可能在同一次演出里先后到达，
   * 模式不会来回跳，`preLockMode` 也不会被自己覆盖。
   */
  setMode(mode: CameraMode, data?: CameraModeData): void {
    const cfg = MODE_CONFIG[mode]
    /**
     * **模式自己的 FOV 那一格此前没人读**（相机在所有模式里都是 50°，于是 combat.md §7
     * 「锁定式越肩推轨，**FOV 45°**」那一行在运行时是假的）⇒ 这里给它读者：
     * 进哪一格就摆那一格的 FOV（探索 50／战斗 48／越肩 45／Boss 42／过场 50）。
     *
     * **cutscene 明确给了 fov 就用它**——那一格是**演出自己**的镜头，不归模式管
     * （过场期间由 `cinematic.start` 传进来；过场结束回到模式那一行）。
     */
    this.baseFov = data?.fov ?? cfg.fovBase
    if (this.mode === mode) return
    this.mode = mode

    // 立即应用新模式的距离边界
    this.dist = clamp(this.dist, cfg.distMin, cfg.distMax)
  }

  /** 获取当前模式 */
  getMode(): CameraMode { return this.mode }

  /** 启用/禁用碰撞（cinematic 模式可禁用） */
  setCollision(enabled: boolean): void { this.collisionEnabled = enabled }

  /**
   * 注入相机碰撞用的遮挡名册（与挡箭/挡视线同一份盒子）。
   * 传进来的数组可以是**活引用**——组合根那一份名册是就地改写的（换区域重写墙、
   * 每 tick 重名点 Boss 的柱子），相机跟着它走就行，不必每帧重建。
   */
  setOccluders(occluders: readonly Occluder[]): void { this.occluders = occluders }

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

  /**
   * 主更新循环
   * @param dt 渲染帧时间（秒）
   * @param player 玩家控制器
   * @param look 摇杆/鼠标输入
   * @param lockTarget 锁定目标位置
   * @param shakeDt 震镜/FOV 用的时间步（逻辑 tick dt，KI-017）
   */
  update(dt: number, player: PlayerController, look: { dx: number; dy: number }, lockTarget: Vec3 | null, shakeDt = dt): void {
    /**
     * **锁定 ⇒ 相机走越肩那一格**（combat.md §7「锁定式越肩推轨，**FOV 45°**」）。
     *
     * 今天这条线是空的：镜头锁定分支跑的是**探索**那一格的参数 ⇒ FOV 一直是 50、
     * 距离与前视偏移也一直是探索那几格 ⇒ 设计写的那一格（FOV 45°／距离 4.2／target bias 0.35）
     * 从来没有兑现过（那几格的读者就是这一行）。
     *
     * **过场期间镜头归过场管**（cutscene 指定 FOV、碰撞半径 0）⇒ 锁定不夺走它；
     * **处决推轨也不算锁定**（`aim` 那一支还管着处决的越肩构图，判据看的是 `lockTarget` 不是 `aim`）。
     */
    if (this.mode !== CameraMode.Cinematic) {
      const wantLock = lockTarget !== null
      if (wantLock && this.mode !== CameraMode.LockOn) {
        this.preLockMode = this.mode
        this.setMode(CameraMode.LockOn)
      } else if (!wantLock && this.mode === CameraMode.LockOn) {
        this.setMode(this.preLockMode)
      }
    }
    const cfg = MODE_CONFIG[this.mode]

    // 输入响应（按模式阻尼）
    this.yaw -= look.dx * cfg.yawDamp * dt
    this.pitch = clamp(this.pitch + look.dy * 0.55 * cfg.pitchDamp * dt, -0.18, 1.2)

    // 基础目标点（玩家头部上方）
    const target = { x: player.pos.x, y: player.pos.y + cfg.heightOffset, z: player.pos.z }
    let dist = this.dist

    // §5.4「锁定式越肩推轨」：处决演出期间镜头钉在受刑者身上——借用锁定同一套越肩构图
    // （中点/方位/距离夹取全是现成的），在它之上再叠一层 `execPull` 的推近与 FOV 收缩。
    // 真锁定优先：演出中玩家理论上锁不了别人（busy），但构图不许出现两个主人。
    this.execPull = damp(this.execPull, player.executing ? 1 : 0, EXEC_DOLLY.damp, dt)
    const montage = !lockTarget && player.executing ? player.executing.pos : null

    // 锁定/越肩构图
    const aim = lockTarget ?? montage
    if (aim) {
      const mid = { x: (target.x + aim.x) / 2, z: (target.z + aim.z) / 2 }
      target.x = mid.x; target.z = mid.z
      target.y = player.pos.y + 1.2
      const d = Math.hypot(player.pos.x - aim.x, player.pos.z - aim.z)
      dist = clamp(cfg.distBase + d * cfg.lookAhead, cfg.distMin, cfg.distMax)
      if (montage) dist *= 1 - EXEC_DOLLY.distMul * this.execPull
      const away = Math.atan2(player.pos.x - aim.x, player.pos.z - aim.z)
      this.yaw = damp(this.yaw, wrapNear(this.yaw, away + 0.35), cfg.yawDamp, dt)
    } else {
      // 非锁定时距离随速度微调（跑起来把镜头往后拉一点）
      //
      // `moveSpeed` 读的是**指令速度**（`ThirdPersonController` 那一格），它可能缺席：
      // 替身与旧存档路径都可能没有这一格，而 `undefined * 0.15` 是 NaN ⇒ 整条相机会飘到 NaN
      // （`posSmooth.y` 变 NaN ⇒ 地面钳制失效、震镜幅度算成 NaN）。**相机不许被一个缺字段带走**：
      // 缺就当 0（"没在跑"），这是缺省而不是猜测。
      const moveSpeed = player.moveSpeed ?? 0
      dist = clamp(cfg.distBase + moveSpeed * 0.15, cfg.distMin, cfg.distMax)
    }

    // 期望相机位置（球坐标）
    const sp = Math.sin(this.pitch), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw)
    const cp = Math.cos(this.pitch)
    const desired = new THREE.Vector3(
      target.x + sy * cp * dist,
      target.y + 0.4 + sp * dist,
      target.z + cy * cp * dist
    )

    // 碰撞回弹（tech-arch §1.2）：相机撞墙时停在墙前，而不是穿过去
    let finalPos = desired
    if (this.collisionEnabled && cfg.collisionRadius > 0 && player.floorY !== undefined) {
      finalPos = collideAndRebound(desired, target, cfg.collisionRadius, this.occluders)
    }

    // 平滑跟随（按模式阻尼）
    this.posSmooth.x = damp(this.posSmooth.x, finalPos.x, cfg.posDamp, dt)
    this.posSmooth.y = damp(this.posSmooth.y, finalPos.y, cfg.posDamp, dt)
    this.posSmooth.z = damp(this.posSmooth.z, finalPos.z, cfg.posDamp, dt)

    // 地面最小高度保护
    const minY = (player.floorY ?? 0) + 0.35
    if (this.posSmooth.y < minY) this.posSmooth.y = minY

    // 震镜计算（走 shakeDt = 逻辑 tick）
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

    // FOV 脉冲
    let fovOff = 0
    for (const q of this.fovPulses) {
      q.t += shakeDt
      fovOff += q.delta * Math.sin(Math.PI * Math.min(1, q.t / q.dur))
    }
    this.fovPulses = this.fovPulses.filter((q) => q.t < q.dur)
    // §10 附加格「FOV -x°/y ms」：与震镜同窗（`shakeDt`，即逻辑 tick 时标）——FOV 脉冲和震镜
    // 是同一记"世界挨了一下"的两半，停顿期间自然要一起照常走完。
    // §5.4 处决推轨的 FOV 分量：随 `execPull` 缓入缓出，与距离推进同一只手。
    const fov = this.baseFov + fovOff + EXEC_DOLLY.fovDelta * this.execPull
    if (Math.abs(fov - this.cam.fov) > 1e-4) {
      this.cam.fov = fov
      this.cam.updateProjectionMatrix()
    }

    // 应用位置与朝向
    this.cam.position.set(this.posSmooth.x + offX, this.posSmooth.y + offY, this.posSmooth.z)
    this.cam.lookAt(target.x, target.y + offY * 0.5, target.z)
    this.cam.rotation.z += roll * (Math.PI / 180)
    player.camYawRef = Math.atan2(this.posSmooth.x - target.x, this.posSmooth.z - target.z)
  }
}

/**
 * 相机碰撞回弹（tech-arch §1.2 CameraRig 映射）。
 *
 * 做法：从**注视点**（玩家头）向期望机位拉一条线，第一块挡住它的盒子就把相机停在那块盒子的
 * 迎面（`firstBlock` 返回的 `at`），并把盒子按相机半径外扩（`expand`）——于是"擦着走"不算撞上。
 *
 * **几何真源是 `core/Occlusion` 那一份名册**（与挡箭、挡视线同一批盒子）：相机撞墙与箭被墙挡住
 * 不许各写一份几何。名册为空 ⇒ 原样返回（野外无 authored 墙的区域不做碰撞）。
 *
 * 注意口径用**非 strict**（`firstBlock` 默认）：起点在体内不算挡——那是给"打出去的线"写的赦免，
 * 而"这一条线走不走得过去"才是导航那条 strict 口径的事，相机要的是"第一次碰到哪儿"。
 */
function collideAndRebound(
  desired: THREE.Vector3,
  target: { x: number; y: number; z: number },
  radius: number,
  occluders: readonly Occluder[],
): THREE.Vector3 {
  if (occluders.length === 0) return desired
  const hit = firstBlock(occluders, target, desired, radius)
  if (!hit) return desired
  return new THREE.Vector3(hit.at.x, hit.at.y, hit.at.z)
}

/** 角度归一化 */
function wrapNear(from: number, to: number): number {
  let d = to - from
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return from + d
}

declare module '@/core/EventBus' {
  interface GameEvents {
    /**
     * §6 过场开始：相机据此切到 `cinematic` 模式（碰撞与阻尼都松掉，交给演出）。
     * 发射方是组合根（`main.ts` 起演出那一刻）——`Cinematics` 播放器本身是纯逻辑零总线。
     */
    'cinematic.start': { id: string; fov?: number; durationMs?: number }
    /** §6 过场收束（走完 / 被跳过）：相机回到 `exploration` 模式。 */
    'cinematic.end': { id: string }
  }
}
