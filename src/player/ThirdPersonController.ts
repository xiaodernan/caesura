import { bus } from '@/core/EventBus'
import type { GameTime } from '@/core/Time'
import type { Input } from '@/core/Input'
import type { RhythmClock } from '@/core/RhythmClock'
import { clamp } from '@/core/Math'
import type { FrameData, MovesetData, PlayerBaseData, WeaponData } from '@/data/schema'
import { EntityStats, playerStatsFrom } from '@/combat/EntityStats'
import type { Vec3 } from '@/combat/EntityStats'
import type { HitTarget } from '@/combat/HitShapes'
import { defaultMods, type PlayerMods } from '@/rpg/Runtime'

const CHARGE_TICKS = 48
/** 台阶容差：与 world/Surface 的 floorAt tolerance 一致，超过就不算「踩上台阶」 */
const STEP_UP = 0.5

export type MoveIntent = { x: number; z: number; sprint: boolean }

export type ActivePlayerHit = {
  box: FrameData['hitbox']; yaw: number; damage: number; poise: number;
  hitStopMs: number; shake: string; flags: string[]; loudness: number
}

export class PlayerController {
  pos: Vec3 = { x: 0, y: 0, z: 0 }
  yaw = 0
  stats: EntityStats
  grounded = true
  vy = 0
  /** 当前站立面的高度，由 world/Surface 每 tick 注入（垂直分层世界） */
  floorY = 0
  action: { key: string; f: FrameData; tick: number; hitDone: boolean; shots: number } | null = null
  roll: { tick: number; dir: Vec3; total: number; iframeStart: number; iframeEnd: number } | null = null
  guardTicks = 0
  guardStartTick = -999
  parryTicksLeft = 0
  /**
   * §15.2 被 Boss「夺拍」之后，玩家的节奏工具改挂到他的拍上：
   * - 体力只在**他的**拍点窗（windowTicks）内回复，窗外为 0 ⇒ 你的呼吸由他的网格决定；
   * - 闪避恢复锁在 ±dodgeJitterTicks 之间交替漂移（§15.2 的 ±60ms）。
   * 由 CombatManager 每 tick 写（那里同时看得见 Boss 阶段与输入），本类只消费。
   */
  beatParasite: { regenMul: number; windowTicks: number } | null = null
  dodgeJitterTicks = 0
  private dodgeCount = 0
  parryWhiffTicks = 0
  stunTicks = 0
  crumpleTicks = 0
  chargeTicks = 0
  charging = false
  executing: { tick: number; total: number } | null = null
  lockedTarget: { getPos(): Vec3; get radius(): number } | null = null
  exhausted = false
  private footAccum = 0
  private dead = false
  private deadTicks = 0
  /**
   * Phase 5-B：成长系统灌进来的一组扁平乘数（音级派生 + 装备词缀）。
   * 这里只做消费——它不认识 Progression，也不知道词缀从哪来（见 src/rpg/Runtime.ts）。
   */
  rpg: PlayerMods = defaultMods()

  constructor(public base: PlayerBaseData, public weapon: WeaponData, public moveset: MovesetData) {
    this.stats = playerStatsFrom(base)
    this.stats.defense = base.defense
    // 未接成长系统时（单元测试/工具）也要有一组**恒等**乘数：属性取 player.json 的面板值，
    // 于是伤害与 Phase 5-B 之前逐位相同——成长系统是叠加，不是替换。
    this.rpg = { ...defaultMods(), attrs: { ...base.attrs } }
  }

  get dead_(): boolean { return this.dead }
  get iFrame(): boolean {
    if (this.executing) return true // §5.4 execution montage: player invulnerable
    if (this.roll) {
      const t = this.roll.tick
      return t >= this.roll.iframeStart && t <= this.roll.iframeEnd
    }
    return false
  }
  get guarding(): boolean { return this.guardTicks >= this.base.guard.startupTicks }
  get parryActive(): boolean { return this.parryTicksLeft > 0 }
  get busy(): boolean { return this.action !== null || this.roll !== null || this.stunTicks > 0 || this.crumpleTicks > 0 || this.executing !== null || this.dead }

  get activeHitbox(): ActivePlayerHit | null {
    if (!this.action) return null
    const f = this.action.f
    if (this.action.tick < f.activeStart || this.action.tick > f.activeEnd || this.action.hitDone) return null
    return {
      box: f.hitbox, yaw: this.yaw,
      damage: f.damage, poise: f.poise, hitStopMs: f.hitStopMs,
      shake: f.shake ?? 'normal', flags: f.flags ?? [], loudness: (f.loudness ?? 3) * (this.weapon.noiseMul ?? 1)
    }
  }

  markActionHit(): void { if (this.action) this.action.hitDone = true }

  /** data-driven weapon swap: reset transient action state, adopt new frames */
  equip(weapon: WeaponData, moveset: MovesetData): void {
    if (weapon.id === this.weapon.id) return
    this.weapon = weapon
    this.moveset = moveset
    this.action = null
    this.comboQueued = null
    this.charging = false
    this.chargeTicks = 0
    this.executing = null
    bus.emit('audio.sfx', { key: 'ui_select', pos: { ...this.pos }, gain: 0.5 })
    this.publishStats()
  }

  /**
   * 成长/装备变化后重新灌一次（升级、换装、强化、洗点都走这里）。
   * 升级带来的上限增长**立刻兑现**（§8.1「数值层反馈：HP 微条实际增长」），
   * 但只补差额——掉的血不会被顺手治好，调音桩才有治疗权。
   */
  applyRpg(m: PlayerMods): void {
    const dHp = m.hpMax - this.stats.hpMax
    this.stats.hpMax = m.hpMax
    this.stats.hp = clamp(this.stats.hp + Math.max(0, dHp), 0, m.hpMax)
    this.stats.staMax = m.staminaMax
    this.stats.stamina = Math.min(this.stats.stamina, m.staminaMax)
    this.stats.poiseMax = m.poiseMax
    this.stats.defense = m.defense
    this.stats.overdriveMax = m.overdriveMax
    this.stats.overdrive = Math.min(this.stats.overdrive, m.overdriveMax)
    this.rpg = m
    this.publishStats()
  }

  /** 发声时的噪音乘数（静默词缀 / 无鸣类武器）：所有 sound.source 出口共用它 */
  private noise(loudness: number): number { return loudness * this.rpg.noiseMul }

  faceTowards(p: Vec3): void {
    const d = Math.atan2(p.x - this.pos.x, p.z - this.pos.z)
    this.yaw += clampAngleDiff(this.yaw, d) * 0.35
  }

  /** §5.4: snap to face the victim, enter the invulnerable input-lock montage */
  beginExecute(targetPos: Vec3, totalTicks: number): void {
    this.yaw = Math.atan2(targetPos.x - this.pos.x, targetPos.z - this.pos.z)
    this.action = null
    this.roll = null
    this.charging = false
    this.chargeTicks = 0
    this.guardTicks = 0
    this.executing = { tick: 0, total: totalTicks }
  }

  update(dt: number, time: GameTime, input: Input, tick: number, rhythm: RhythmClock): void {
    if (this.dead) {
      this.deadTicks++
      if (this.deadTicks > 240) { this.deadTicks = 0; this.respawn() }
      return
    }
    const canAct = this.stunTicks <= 0 && this.crumpleTicks <= 0
    if (this.executing) {
      this.executing.tick++
      if (this.executing.tick >= this.executing.total) this.executing = null
      this.stats.update(dt, tick, false)
      this.publishStats()
      return
    }
    // 夺拍期间：他的拍点窗外不给回气（mods.regenMul 是 EntityStats 已有的乘子通道）。
    // 装备的节律词缀与超载惩罚叠在这个乘子上——三者都只写一次，不各自另开一条回复路径。
    const regenBase = this.rpg.staminaRegenMul * (this.rpg.overloaded ? 0.6 : 1)
    if (this.beatParasite && rhythm) {
      const onHisBeat = rhythm.ticksFromBeatPoint() <= this.beatParasite.windowTicks
      this.stats.mods.regenMul = (onHisBeat ? this.beatParasite.regenMul : 0) * regenBase
    } else this.stats.mods.regenMul = regenBase
    this.stats.update(dt, tick, this.guarding)

    // ---- defense inputs (always live unless rolling/attacking) ----
    if (this.action === null && this.roll === null && canAct) {
      if (input.frame.held.has('guard')) {
        if (this.guardTicks === 0) this.guardStartTick = tick
        this.guardTicks = Math.min(this.guardTicks + 1, 9999)
      } else this.guardTicks = 0
      if (input.frame.edges.has('parry') && this.parryTicksLeft <= 0 && this.parryWhiffTicks <= 0 && this.stats.stamina >= 5) {
        this.parryTicksLeft = this.base.parry.activeTicks
        if (this.guardTicks > 0) this.guardTicks = 0
      }
    } else if (this.action || this.roll) this.guardTicks = canAct ? this.guardTicks : 0
    if (this.parryTicksLeft > 0) this.parryTicksLeft--
    if (this.parryWhiffTicks > 0) this.parryWhiffTicks--

    // ---- heavy hold -> charge ----
    if (input.frame.held.has('attackHeavy') && this.action === null && !this.busy) {
      this.charging = true
      this.chargeTicks++
    } else if (this.charging && !input.frame.held.has('attackHeavy')) {
      this.charging = false
      if (this.chargeTicks >= CHARGE_TICKS && canAct) this.tryStartAction('charged', tick)
      else if (this.chargeTicks < 8 && canAct && this.action === null) this.tryStartAction('h', tick)
      this.chargeTicks = 0
    }

    // ---- attacks ----
    if (canAct && !this.charging) {
      if (input.frame.edges.has('attackLight') && this.action === null && this.roll === null) {
        const key = !this.grounded && this.moveset.actions['jump'] ? 'jump'
          : (input.frame.held.has('sprint') && Math.hypot(input.frame.move.x, input.frame.move.y) > 0.5 && this.moveset.actions['run']) ? 'run'
          : 'l1'
        this.tryStartAction(key, tick, rhythm)
      } else if (input.frame.edges.has('attackLight') && this.action) {
        const nxt = this.action.f.next
        if (nxt && this.action.tick >= this.action.f.activeStart) this.comboQueued = nxt
      }
    }
    if (input.frame.edges.has('jump') && this.grounded && !this.busy && this.stats.spendStamina(6, tick)) {
      this.vy = this.base.jumpSpeed
      this.grounded = false
      bus.emit('sound.source', { id: 'player', pos: { ...this.pos }, loudness: this.noise(0.2) })
    }
    if (input.frame.edges.has('dodge') && !this.rpg.overloaded && (canAct || this.roll === null) && this.stats.stamina >= this.base.roll.stamina && !this.dead) {
      this.startRoll(input, tick)
    }

    // ---- action progression ----
    if (this.action) {
      this.action.tick++
      const f = this.action.f
      if (this.action.tick >= f.startup && this.action.tick <= f.startup + f.activeEnd && f.lunge) {
        const step = f.lunge / f.activeEnd
        this.pos.x += Math.sin(this.yaw) * step
        this.pos.z += Math.cos(this.yaw) * step
      }
      if (this.action.tick >= f.recovery) {
        if (this.comboQueued && f.next && this.action.tick >= f.activeEnd) {
          const q = this.comboQueued
          this.comboQueued = null
          this.action = null
          this.tryStartAction(q, tick, rhythm)
        } else this.action = null
      }
    }
    // ---- movement ----
    if (canAct && !this.busyMovementLocked()) {
      const mv = input.frame.move
      const sprinting = input.frame.held.has('sprint') && !this.rpg.overloaded && mv.x * mv.x + mv.y * mv.y > 0.1 && !this.guarding
      const speed = sprinting ? this.base.sprintSpeed : this.base.moveSpeed
      const camYaw = this.camYawRef ?? this.yaw
      const cs = Math.sin(camYaw), cc = Math.cos(camYaw)
      // camera at +yaw offset: screen-forward (mv.y=+1) = -(sin c, cos c)
      const wx = mv.x * cc - mv.y * cs
      const wz = -(mv.x * cs + mv.y * cc)
      const wl = Math.hypot(wx, wz)
      if (wl > 0.05) {
        const nx = wx / wl, nz = wz / wl
        const sp = Math.min(wl, 1) * speed * (this.guarding ? 0.35 : 1) * (this.action ? 0.15 : 1)
        this.pos.x += nx * sp * dt
        this.pos.z += nz * sp * dt
        if (!this.action && !this.lockedTarget && !this.guarding) this.yaw += clampAngleDiff(this.yaw, Math.atan2(nx, nz)) * 0.25
        if (sprinting) {
          this.stats.stamina = Math.max(0, this.stats.stamina - this.base.sprintCostPerSec * dt)
          if (this.stats.stamina <= 0) this.exhausted = true
        }
        this.footAccum += sp * dt
        const stride = sprinting ? 2.2 : 3.0
        if (this.footAccum > stride) {
          this.footAccum = 0
          bus.emit('sound.source', { id: 'player', pos: { ...this.pos }, loudness: this.noise(sprinting ? 0.45 : 0.18) })
          bus.emit('audio.sfx', { key: 'footstep', pos: { ...this.pos }, gain: 0.25 })
        }
      }
    }
    // gravity — floorY 由 world/Surface 按区域层给出（休垒 0 / 地下 -40 …），不再硬编码 0
    if (!this.grounded || this.vy > 0 || this.pos.y > this.floorY) {
      this.vy -= this.base.gravity * dt
      this.pos.y += this.vy * dt
      if (this.pos.y > this.floorY) this.grounded = false // 走下边缘：脚下已无本层地面
      if (this.pos.y <= this.floorY) {
        const fallSpeed = -this.vy
        this.pos.y = this.floorY; this.vy = 0; this.grounded = true
        if (fallSpeed > 8) {
          bus.emit('vfx.request', { key: 'ring_dust', pos: { ...this.pos }, scale: clamp(fallSpeed / 16, 0.5, 1.4) })
          bus.emit('audio.sfx', { key: 'land_slam', pos: { ...this.pos }, gain: 0.4 })
        }
        if (this.action?.key === 'jump') this.action.tick = Math.max(this.action.tick, this.action.f.activeStart)
      }
    } else if (this.floorY - this.pos.y > 0 && this.floorY - this.pos.y <= STEP_UP) {
      this.pos.y = this.floorY // 踏上更高一层：只在台阶容差内抬升，避免跨层瞬移时被人拎起来
    }
    if (this.roll) {
      this.roll.tick++
      const step = (this.roll.dir.x * this.base.roll.dist + 0) / this.roll.total
      const stepZ = (this.roll.dir.z * this.base.roll.dist) / this.roll.total
      this.pos.x += step; this.pos.z += stepZ
      if (this.roll.tick >= this.roll.total) this.roll = null
    }
    if (this.stunTicks > 0) this.stunTicks--
    if (this.crumpleTicks > 0) { this.crumpleTicks--; this.stats.crumpleTicksLeft = this.crumpleTicks }
    if (this.stats.stamina > 15) this.exhausted = false
    this.publishStats()
  }

  private comboQueued: string | null = null
  camYawRef: number | null = null

  hitTarget(): HitTarget {
    return { pos: this.pos, facingYaw: this.yaw, radius: 0.4, height: 1.7 }
  }

  private busyMovementLocked(): boolean {
    return this.roll !== null || (this.action !== null && this.action.tick < this.action.f.recovery * 0.6) || this.charging
  }

  private startRoll(input: Input, tick: number): void {
    const mv = input.frame.move
    let dir: Vec3
    if (mv.x !== 0 || mv.y !== 0) {
      const camYaw = this.camYawRef ?? this.yaw
      const s = Math.sin(camYaw), c = Math.cos(camYaw)
      const wx = mv.x * c - mv.y * s, wz = -(mv.x * s + mv.y * c)
      const l = Math.hypot(wx, wz) || 1
      dir = { x: wx / l, y: 0, z: wz / l }
    } else dir = { x: -Math.sin(this.yaw), y: 0, z: -Math.cos(this.yaw) }
    this.stats.spendStamina(this.base.roll.stamina, tick)
    this.action = null
    this.charging = false
    this.chargeTicks = 0
    const locked = this.lockedTarget !== null
    // 恢复锁漂移：±jitter 交替（不是抽签——均值守恒，但每一滚的落点都要重新读）
    const jit = this.dodgeJitterTicks
    const drift = jit > 0 ? (this.dodgeCount++ % 2 === 0 ? jit : -jit) : 0
    this.roll = {
      tick: 0, dir,
      total: Math.max(6, (locked ? 18 : this.base.roll.total) + drift),
      iframeStart: locked ? this.base.roll.lockOnIframes[0] : this.base.roll.iframeStart,
      iframeEnd: locked ? this.base.roll.lockOnIframes[1] : this.base.roll.iframeEnd
    }
    this.grounded = true
    bus.emit('sound.source', { id: 'player', pos: { ...this.pos }, loudness: this.noise(0.3) })
  }

  tryStartAction(key: string, tick: number, rhythm?: RhythmClock): boolean {
    const f = this.moveset.actions[key]
    if (!f || this.action || this.roll || this.stunTicks > 0 || this.crumpleTicks > 0) return false
    if (this.exhausted || !this.stats.spendStamina(f.stamina, tick)) {
      bus.emit('ui.notify', { text: '精力不足', kind: 'info' })
      return false
    }
    const cut = key.startsWith('l') ? Math.min(this.rpg.lightStartupTicks, Math.max(0, f.activeStart - 1)) : 0
    this.action = { key, f, tick: cut, hitDone: false, shots: 0 }
    this.comboQueued = null
    bus.emit('audio.sfx', { key: f.sfx?.[0] ?? 'swing_1', pos: { ...this.pos }, gain: 0.7 })
    if (f.vfx?.[0]) bus.emit('vfx.request', { key: f.vfx[0], pos: { ...this.pos }, dir: { x: Math.sin(this.yaw), y: 0, z: Math.cos(this.yaw) } })
    bus.emit('sound.source', { id: 'player', pos: { ...this.pos }, loudness: this.noise(((f.loudness ?? 3) / 10) * (this.weapon.noiseMul ?? 1)) })
    void rhythm
    return true
  }

  onHitLanded(): void {
    // weapon unique: on-beat bonus handled by CombatManager reading rhythm
  }

  takeDamage(amount: number, knockDir?: Vec3): boolean {
    if (this.iFrame || this.dead) return false
    if (this.parryTicksLeft > 0) return false // handled as parry upstream
    this.stats.damage(amount)
    this.stunTicks = 12
    this.action = null; this.roll = null; this.charging = false
    if (knockDir) {
      this.pos.x += clamp(knockDir.x, -1, 1) * 0.2
      this.pos.z += clamp(knockDir.z, -1, 1) * 0.2
    }
    bus.emit('player.damaged', { amount })
    bus.emit('audio.sfx', { key: 'player_hurt', gain: 0.6 })
    if (this.stats.hp <= 0) {
      this.dead = true
      this.deadTicks = 0
      bus.emit('player.died', undefined)
    }
    this.publishStats()
    return true
  }

  respawn(): void {
    this.dead = false
    this.stats.hp = this.stats.hpMax
    this.stats.stamina = this.stats.staMax
    this.pos = { x: 0, y: 0, z: 0 }
    bus.emit('ui.notify', { text: '休止被世界重新听见', kind: 'info' })
    this.publishStats()
  }

  /** 调音桩休息：只回 HP/体力——不动架势与过载，调音桩不是免费复活 */
  rest(): void {
    this.stats.hp = this.stats.hpMax
    this.stats.stamina = this.stats.staMax
    this.exhausted = false
    this.publishStats()
  }

  addOverdrive(n: number): void {
    this.stats.overdrive = clamp(this.stats.overdrive + n, 0, this.stats.overdriveMax)
  }

  publishStats(): void {
    bus.emit('player.stats', {
      hp: this.stats.hp, hpMax: this.stats.hpMax,
      stamina: this.stats.stamina, staminaMax: this.stats.staMax,
      poise: this.stats.poiseAccum, poiseMax: this.stats.poiseMax,
      overdrive: this.stats.overdrive, overdriveMax: this.stats.overdriveMax,
      rank: this.rpg.rank
    })
  }
}

function clampAngleDiff(from: number, to: number): number {
  let d = to - from
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

export { clampAngleDiff }
