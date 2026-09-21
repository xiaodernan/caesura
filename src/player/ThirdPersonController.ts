import { bus } from '@/core/EventBus'
import type { GameTime } from '@/core/Time'
import type { Input } from '@/core/Input'
import type { RhythmClock } from '@/core/RhythmClock'
import { clamp } from '@/core/Math'
import type { FrameData, MovesetData, PlayerBaseData, WeaponData } from '@/data/schema'
import { EntityStats, playerStatsFrom } from '@/combat/EntityStats'
import type { Vec3 } from '@/combat/EntityStats'
import type { HitTarget } from '@/combat/HitShapes'

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
  action: { key: string; f: FrameData; tick: number; hitDone: boolean } | null = null
  roll: { tick: number; dir: Vec3; total: number; iframeStart: number; iframeEnd: number } | null = null
  guardTicks = 0
  guardStartTick = -999
  parryTicksLeft = 0
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

  constructor(public base: PlayerBaseData, public weapon: WeaponData, public moveset: MovesetData) {
    this.stats = playerStatsFrom(base)
    this.stats.defense = base.defense
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
      bus.emit('sound.source', { id: 'player', pos: { ...this.pos }, loudness: 0.2 })
    }
    if (input.frame.edges.has('dodge') && (canAct || this.roll === null) && this.stats.stamina >= this.base.roll.stamina && !this.dead) {
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
      const speed = input.frame.held.has('sprint') && mv.x * mv.x + mv.y * mv.y > 0.1 && !this.guarding
        ? this.base.sprintSpeed : this.base.moveSpeed
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
        if (input.frame.held.has('sprint') && !this.guarding) {
          this.stats.stamina = Math.max(0, this.stats.stamina - this.base.sprintCostPerSec * dt)
          if (this.stats.stamina <= 0) this.exhausted = true
        }
        this.footAccum += sp * dt
        const stride = input.frame.held.has('sprint') ? 2.2 : 3.0
        if (this.footAccum > stride) {
          this.footAccum = 0
          bus.emit('sound.source', { id: 'player', pos: { ...this.pos }, loudness: input.frame.held.has('sprint') ? 0.45 : 0.18 })
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
    this.roll = {
      tick: 0, dir,
      total: locked ? 18 : this.base.roll.total,
      iframeStart: locked ? this.base.roll.lockOnIframes[0] : this.base.roll.iframeStart,
      iframeEnd: locked ? this.base.roll.lockOnIframes[1] : this.base.roll.iframeEnd
    }
    this.grounded = true
    bus.emit('sound.source', { id: 'player', pos: { ...this.pos }, loudness: 0.3 })
  }

  tryStartAction(key: string, tick: number, rhythm?: RhythmClock): boolean {
    const f = this.moveset.actions[key]
    if (!f || this.action || this.roll || this.stunTicks > 0 || this.crumpleTicks > 0) return false
    if (this.exhausted || !this.stats.spendStamina(f.stamina, tick)) {
      bus.emit('ui.notify', { text: '精力不足', kind: 'info' })
      return false
    }
    this.action = { key, f, tick: 0, hitDone: false }
    this.comboQueued = null
    bus.emit('audio.sfx', { key: f.sfx?.[0] ?? 'swing_1', pos: { ...this.pos }, gain: 0.7 })
    if (f.vfx?.[0]) bus.emit('vfx.request', { key: f.vfx[0], pos: { ...this.pos }, dir: { x: Math.sin(this.yaw), y: 0, z: Math.cos(this.yaw) } })
    bus.emit('sound.source', { id: 'player', pos: { ...this.pos }, loudness: ((f.loudness ?? 3) / 10) * (this.weapon.noiseMul ?? 1) })
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
      rank: 1
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
