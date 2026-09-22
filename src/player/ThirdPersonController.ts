import { bus } from '@/core/EventBus'
import type { GameTime } from '@/core/Time'
import type { Input } from '@/core/Input'
import type { RhythmClock } from '@/core/RhythmClock'
import { clamp } from '@/core/Math'
import type { FrameData, MovesetData, PlayerBaseData, WeaponData } from '@/data/schema'
import { EntityStats, playerStatsFrom } from '@/combat/EntityStats'
import { armStats, CorruptionMeter } from '@/combat/Statuses'
import type { Vec3 } from '@/combat/EntityStats'
import type { HitTarget } from '@/combat/HitShapes'
import { defaultMods, type PlayerMods } from '@/rpg/Runtime'
import type { SkillAction, SkillCast } from '@/rpg/Movements'

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
  action: {
    key: string; f: FrameData; tick: number; hitDone: boolean; shots: number
    /** 这一记已经打到过哪些目标（`f.multi` 是名额上限）。判定窗有好几 tick，同一目标不能被同一记打两遍 */
    hitIds: Set<string>
    /** 非 null ⇒ 这一记是乐章战技（§7）：伤害标尺、真伤、闷音、位移都从它身上取 */
    skill: SkillCast | null
    /** 战技位移（错拍步）的行进方向；null＝不出位移 */
    dir: Vec3 | null
  } | null = null
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
  /**
   * §11 失谐（褪色值）。它是**玩家身上的一块计量表**而不是一个 buff：区域数据决定它涨多快，
   * 消耗品与调音桩决定它怎么掉，HUD/画面决定它怎么被看见——三层都不互相认识，只认这个对象。
   */
  readonly corruption: CorruptionMeter
  /**
   * §7 乐章战技：当前装着的两式（键＝输入动作名）。由 main.ts 在每次成长/换装后灌进来，
   * 本类不认识 movements.json——它只认这份已经折算好等级的小表。
   */
  skills: Record<string, SkillAction> = {}
  /** 冷却按**输入槽**记账（不是按式子）：同一式装在两个槽里，两条冷却各自走 */
  private skillCd = new Map<string, number>()
  /**
   * 全音符斩那类「压在下一记重击上」的起手式：层数与真伤由 §11 的震裂通道在命中时结算。
   * 它是**瞬时状态**，不入档——读档后回到没起手，比凭空带着一层蓄力诚实。
   */
  followup: { layers: number; trueDamage: number } | null = null
  /** 本 tick 的相对移动输入（战技位移的方向源）。刻意缓存而不是把 Input 传进 tryStartAction：出招入口保持一个签名 */
  private moveIntent = { x: 0, y: 0 }

  constructor(public base: PlayerBaseData, public weapon: WeaponData, public moveset: MovesetData) {
    this.stats = playerStatsFrom(base)
    armStats(this.stats) // §11 闷音的 -30% 回复与震裂的层数规则都来自 statuses.json
    this.corruption = new CorruptionMeter()
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
      // 战技的伤害写在等级表上（cast.damage），武器帧的 damage 对战技恒为 0——见 rpg/Movements.ts
      damage: this.action.skill ? this.action.skill.damage : f.damage,
      poise: f.poise, hitStopMs: f.hitStopMs,
      shake: f.shake ?? 'normal', flags: f.flags ?? [], loudness: (f.loudness ?? 3) * (this.weapon.noiseMul ?? 1)
    }
  }

  /**
   * 「这一记打到人了」。近战老规矩是一记一名目标（打空了不许横扫全群）；
   * 写了 `f.multi` 的招式（环形战技）打到上限才作罢。
   */
  markActionHit(victimId: string): boolean {
    const a = this.action
    if (!a || a.hitDone || a.hitIds.has(victimId)) return false
    a.hitIds.add(victimId)
    if (a.hitIds.size >= (a.f.multi ?? 1)) a.hitDone = true
    return true
  }

  setSkills(skills: Record<string, SkillAction>): void {
    this.skills = skills // 冷却不跟着清：在调音桩换装不该顺手把刚交的学费退回来
  }

  /** 战技冷却还剩几 tick（0＝可出手）。UI/调试器读它，不自己算 */
  skillCooldown(actionKey: string): number { return this.skillCd.get(actionKey) ?? 0 }

  /**
   * 取走「压在下一记上的起手式」。只有重击能兑现它（§7.2 全音符斩明写"下一记重击"），
   * 所以轻击/战技调用时传 false：不消费、不清空。
   */
  takeFollowup(onHeavy: boolean): { layers: number; trueDamage: number } | null {
    if (!onHeavy || !this.followup) return null
    const f = this.followup
    this.followup = null
    return f
  }

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
    this.corruption.resistMul = m.corruptionResistMul
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
    this.moveIntent = { x: input.frame.move.x, y: input.frame.move.y }
    if (this.executing) {
      this.executing.tick++
      if (this.executing.tick >= this.executing.total) this.executing = null
      this.stats.update(dt, tick, false)
      this.publishStats()
      return
    }
    for (const [k, v] of this.skillCd) {
      if (v <= 1) this.skillCd.delete(k)
      else this.skillCd.set(k, v - 1)
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
      this.startRoll(tick)
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
      // 战技位移（错拍步）：走**判定窗**这几 tick，一步的距离由等级表给。
      // 它和 lunge 分开写，是因为两者的时间轴口径本来就不同：lunge 是招式自带的前冲（按
      // startup 起算的老约定），位移是"从出声到落地的这几格"。合并就会改动既有武器的落点。
      const d = this.action.dir
      if (d && this.action.skill && this.action.tick >= f.activeStart && this.action.tick <= f.activeEnd) {
        const span = Math.max(1, f.activeEnd - f.activeStart + 1)
        const step = this.action.skill.distance / span
        this.pos.x += d.x * step
        this.pos.z += d.z * step
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

  /**
   * 摄像机相对的输入方向 → 世界单位向量；没有输入就朝正前方。
   * 翻滚与战技位移共用它：两处各算一遍，就会出现「翻滚往左、瞬步往屏幕左」这种不一致。
   */
  private moveDir(): Vec3 {
    const mv = this.moveIntent
    if (mv.x !== 0 || mv.y !== 0) {
      const camYaw = this.camYawRef ?? this.yaw
      const s = Math.sin(camYaw), c = Math.cos(camYaw)
      const wx = mv.x * c - mv.y * s, wz = -(mv.x * s + mv.y * c)
      const l = Math.hypot(wx, wz) || 1
      return { x: wx / l, y: 0, z: wz / l }
    }
    return { x: -Math.sin(this.yaw), y: 0, z: -Math.cos(this.yaw) }
  }

  private startRoll(tick: number): void {
    const dir = this.moveDir()
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
    // 武器招式与乐章战技**共用这一个入口**：查帧的顺序就是「先手上的武器，再谱册里的式子」。
    // 分两个函数就会长-out 两套出手状态机——那正是实机复验里翻过车的地方（见 combat 注释 §11）。
    const skill = this.skills[key] ?? null
    const f = skill ? skill.f : this.moveset.actions[key]
    if (!f || this.action || this.roll || this.stunTicks > 0 || this.crumpleTicks > 0) return false
    if (skill && !this.skillGate(key, skill)) return false
    if (this.exhausted || !this.stats.spendStamina(f.stamina, tick)) {
      bus.emit('ui.notify', { text: '精力不足', kind: 'info' })
      return false
    }
    if (skill) {
      // 过载在门里已经验过，这里只负责扣：先验后扣，不会出现"钱付了式子没出手"
      this.stats.overdrive = clamp(this.stats.overdrive - skill.cast.overdriveCost, 0, this.stats.overdriveMax)
      this.skillCd.set(key, skill.cast.cooldownTicks)
      if (skill.cast.fissureLayers > 0 || skill.cast.trueDamage > 0) {
        this.followup = { layers: skill.cast.fissureLayers, trueDamage: skill.cast.trueDamage }
      }
    }
    const cut = key.startsWith('l') ? Math.min(this.rpg.lightStartupTicks, Math.max(0, f.activeStart - 1)) : 0
    this.action = {
      key, f, tick: cut, hitDone: false, shots: 0, hitIds: new Set<string>(),
      skill: skill?.cast ?? null,
      dir: skill && skill.cast.distance > 0 ? this.moveDir() : null
    }
    this.comboQueued = null
    bus.emit('audio.sfx', { key: f.sfx?.[0] ?? 'swing_1', pos: { ...this.pos }, gain: 0.7 })
    if (f.vfx?.[0]) bus.emit('vfx.request', { key: f.vfx[0], pos: { ...this.pos }, dir: { x: Math.sin(this.yaw), y: 0, z: Math.cos(this.yaw) } })
    bus.emit('sound.source', { id: 'player', pos: { ...this.pos }, loudness: this.noise(((f.loudness ?? 3) / 10) * (this.weapon.noiseMul ?? 1)) })
    void rhythm
    return true
  }

  /**
   * 战技能不能出手。三条闸门按"玩家下一步该做什么"排序：闷音 > 冷却 > 过载。
   *
   * 闷音这条是 §11「战技/律具技封锁」的落地。它**没有**自己的秒数：封锁时长就是这次闷音
   * 被施加方写下的时长（`statusOnHit.ticks` / 弹道 `muteOnHit`）——在 statuses.json 里再写一个
   * `skillLockTicks` 就是让同一件事有两个答案（KI-033 撤账）。
   */
  private skillGate(key: string, s: SkillAction): boolean {
    if (this.stats.muteTicksLeft > 0) {
      bus.emit('ui.notify', { text: '闷音｜战技被封', kind: 'info' })
      return false
    }
    if (this.skillCd.get(key)) return false // 冷却中不出声：按键连打是常态，刷屏才是噪声
    if (this.stats.overdrive < s.cast.overdriveCost) {
      bus.emit('ui.notify', { text: '过载不足', kind: 'info' })
      return false
    }
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
    this.followup = null // 死了就是断了：压在下一记上的起手式不跟着人一起回来
    this.stats.hp = this.stats.hpMax
    this.stats.stamina = this.stats.staMax
    this.pos = { x: 0, y: 0, z: 0 }
    bus.emit('ui.notify', { text: '休止被世界重新听见', kind: 'info' })
    this.publishStats()
  }

  /** 调音桩休息：回 HP/体力 + 归零失谐（§11「调音桩归零」）。不动架势与过载，调音桩不是免费复活 */
  rest(): void {
    this.stats.hp = this.stats.hpMax
    this.stats.stamina = this.stats.staMax
    this.exhausted = false
    this.corruption.reset()
    this.publishStats()
  }

  addOverdrive(n: number): void {
    this.stats.overdrive = clamp(this.stats.overdrive + n, 0, this.stats.overdriveMax)
  }

  /**
   * §11 失谐满值后的"褪色"掉血。它刻意**不是** takeDamage 的一条分支：
   * 这是世界在拿走你的声音，不是谁打你一下——所以翻滚的无敌帧救不了它，也不该有硬直和击退。
   * 单开一个入口，是为了让"环境伤害不吃防御阶梯"这件事在代码里看得见，而不是藏在布尔参数里。
   */
  fadeDamage(amount: number): void {
    if (this.dead || amount <= 0) return
    this.stats.damage(amount)
    bus.emit('player.damaged', { amount })
    if (this.stats.hp <= 0) {
      this.dead = true
      this.deadTicks = 0
      bus.emit('player.died', undefined)
    }
    this.publishStats()
  }

  publishStats(): void {
    bus.emit('player.stats', {
      hp: this.stats.hp, hpMax: this.stats.hpMax,
      stamina: this.stats.stamina, staminaMax: this.stats.staMax,
      poise: this.stats.poiseAccum, poiseMax: this.stats.poiseMax,
      overdrive: this.stats.overdrive, overdriveMax: this.stats.overdriveMax,
      rank: this.rpg.rank,
      // §11 失谐：HUD 要的是"多少/上限/褪色几成"三样，自己不去读玩家的 meter
      corruption: this.corruption.value, corruptionMax: this.corruption.cfg.max, corruptionVeil: this.corruption.veil(),
      muteTicksLeft: this.stats.muteTicksLeft
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
