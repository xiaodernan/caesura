import { bus } from '@/core/EventBus'
import { Rng, clamp } from '@/core/Math'
import type { EnemyData, AttackSpec, FrameData, ProjectileSpec } from '@/data/schema'
import { EntityStats } from '@/combat/EntityStats'
import type { Vec3 } from '@/combat/EntityStats'
import type { HitTarget } from '@/combat/HitShapes'
import type { RhythmClock } from '@/core/RhythmClock'
import type { PlayerController } from '@/player/ThirdPersonController'

export type AIState =
  | 'idle' | 'patrol' | 'investigate' | 'alert' | 'chase' | 'combat'
  | 'retreat' | 'search' | 'callAlly' | 'recover' | 'dead'

export interface PerceptionEvent { pos: Vec3; loudness: number; moveNoise: number }

export type ActiveEnemyHit = {
  box: AttackSpec['frames']['hitbox']; yaw: number; damage: number; poise: number;
  hitStopMs: number; reaction: string; loudness: number; flags: string[]
}

let enemySeq = 0

/** 敌人脱离 combat 回到追击的距离（数据可用 `ai.chaseBeyond` 覆盖；射手要在更远距离开火） */
const DEFAULT_CHASE_BEYOND = 12

export class Enemy {
  id = `en_${++enemySeq}`
  stats: EntityStats
  pos: Vec3
  yaw = 0
  state: AIState = 'idle'
  alertness = 0
  stateTick = 0
  home: Vec3
  lastKnown: Vec3
  investigateTick = 0
  attack: { spec: AttackSpec; tick: number; hitDone: boolean; shots: number; lungeApplied: number } | null = null
  cooldowns = new Map<string, number>()
  stunTicks = 0
  buffedByRefrein = false
  facingLocked = false
  deathTick = -1
  coreFlash = 0
  private rng: Rng
  patrolPoints: Vec3[]
  patrolIdx = 0
  searchAngle = 0
  callAllySuppressedUntil = 0

  constructor(public data: EnemyData, pos: Vec3, seed: string) {
    this.rng = new Rng(seed + this.id)
    this.stats = new EntityStats(data.hp, 100, data.poise)
    this.stats.defense = data.defense ?? 0
    this.pos = { ...pos }
    this.home = { ...pos }
    this.lastKnown = { ...pos }
    this.yaw = this.rng.float(0, Math.PI * 2)
    this.patrolPoints = [
      { x: pos.x + 3, y: 0, z: pos.z },
      { x: pos.x, y: 0, z: pos.z + 3 },
      { x: pos.x - 3, y: 0, z: pos.z }
    ]
    bus.on('ai.callAlly', (e) => {
      if (e.fromId === this.id || this.state === 'dead') return
      if (Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) <= (data.ai.callAlly?.range ?? 14)) {
        this.alertness = Math.max(this.alertness, 100)
        this.lastKnown = { ...e.pos }
        this.enter('alert')
      }
    })
  }

  get alive(): boolean { return !this.stats.dead }
  get nameKey(): string { return this.data.nameKey }
  getPos(): Vec3 { return this.pos }
  get isBoss(): boolean { return this.data.archetype === 'boss' || this.data.archetype === 'miniboss' }
  get inStartup(): boolean { return !!this.attack && this.attack.tick < this.attack.spec.frames.startup }
  get activeHitbox(): ActiveEnemyHit | null {
    if (!this.attack) return null
    const f = this.attack.spec.frames
    if (this.attack.tick < f.activeStart || this.attack.tick > f.activeEnd || this.attack.hitDone) return null
    return {
      box: f.hitbox, yaw: this.yaw, damage: f.damage * (this.buffedByRefrein ? 1.1 : 1),
      poise: f.poise, hitStopMs: f.hitStopMs, reaction: this.attack.spec.reaction ?? 'R1',
      loudness: f.loudness ?? 3, flags: f.flags ?? []
    }
  }

  hitTarget(): HitTarget {
    const s = this.data.body?.scale ?? 1
    return { pos: this.pos, facingYaw: this.yaw, radius: 0.55 * s, height: 1.6 * s }
  }

  /**
   * 弹道招式的发射窗口（需求 §59：远程敌人走同一套弹道运行时）。
   * 连发（§14.4 三叠箭）按 burst.everyTicks 逐发排开，同一招式最多发 count 发；
   * 被弹反/被打断 ⇒ attack 清空，余下发数一起作废（这就是「骗动作」的反制）。
   */
  get pendingProjectile(): { spec: ProjectileSpec; frames: FrameData } | null {
    const a = this.attack
    if (!a) return null
    const spec = a.spec.frames.projectile
    if (!spec) return null
    const count = spec.burst?.count ?? 1
    if (a.shots >= count) return null
    const b = spec.burst
    const at = b ? (b.at?.[a.shots] ?? a.shots * b.everyTicks) : 0
    if (a.tick < a.spec.frames.activeStart + at) return null
    return { spec, frames: a.spec.frames }
  }

  /** §14.4「可见赤线 telegraph，线终点=落点」：前摇期间把落点提前告诉玩家 */
  get telegraphProjectile(): { spec: ProjectileSpec; ticksLeft: number; totalTicks: number } | null {
    const a = this.attack
    if (!a) return null
    const spec = a.spec.frames.projectile
    if (!spec?.telegraph) return null
    if (a.tick < 0 || a.tick >= a.spec.frames.startup) return null
    return { spec, ticksLeft: a.spec.frames.startup - a.tick, totalTicks: a.spec.frames.startup }
  }

  markShotFired(): void { if (this.attack) this.attack.shots++ }

  enter(s: AIState): void {
    if (this.state === s) return
    this.state = s
    this.stateTick = 0
    if (s === 'dead') this.deathTick = this.rng.int(0, 1)
  }

  /** perception runs at 10Hz (rotated by AISystem) */
  sense(player: PlayerController, now: number): void {
    if (!this.alive) return
    const ai = this.data.ai
    const p = player.pos
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z
    const dist = Math.hypot(dx, dz)
    const ang = Math.abs(norm(Math.atan2(dx, dz) - this.yaw))
    if (!ai.deaf && dist <= ai.vision.range && ang < (ai.vision.fovDeg * Math.PI / 180) / 2) {
      this.alertness = Math.min(100, this.alertness + 34 * 0.1)
      this.lastKnown = { ...p }
    } else if (dist <= ai.vibration.range && (playerIsMoving(player))) {
      this.alertness = Math.min(100, this.alertness + 40)
      this.lastKnown = { ...p }
    }
    void now
  }

  hear(src: { pos: Vec3; loudness: number }): void {
    if (!this.alive || this.data.ai.deaf) return
    const d = Math.hypot(src.pos.x - this.pos.x, src.pos.z - this.pos.z)
    if (d <= this.data.ai.hearing.range) {
      this.alertness = Math.min(100, this.alertness + src.loudness * 120)
      this.lastKnown = { ...src.pos }
    }
  }

  update(dt: number, tick: number, player: PlayerController, rhythm: RhythmClock, slotTaken: (bar_beat: string) => boolean): void {
    if (!this.alive) {
      if (this.state !== 'dead') this.enter('dead')
      this.stateTick++
      return
    }
    if (tick < this.callAllySuppressedUntil) { /* noop */ }
    this.stats.update(dt, tick)
    this.stateTick++
    if (this.stunTicks > 0) { this.stunTicks--; this.attack = null; if (this.stunTicks === 0 && this.state === 'recover') this.enter('combat'); return }
    if (this.stats.crumpleTicksLeft > 0 && this.state !== 'recover' && this.state !== 'dead') this.enter('recover')

    const p = player.pos
    const dist = Math.hypot(p.x - this.pos.x, p.z - this.pos.z)

    switch (this.state) {
      case 'idle':
        faceSlow(this, this.home)
        if (this.alertness > 20) this.enter('investigate')
        else if (this.stateTick > 180) { this.enter('patrol'); this.patrolIdx = this.rng.int(0, this.patrolPoints.length - 1) }
        break
      case 'patrol': {
        const pt = this.patrolPoints[this.patrolIdx % this.patrolPoints.length]
        stepToward(this, pt, dt, this.data.speed * 0.4, rhythm)
        if (dist3(this.pos, pt) < 0.6) this.patrolIdx = (this.patrolIdx + 1) % this.patrolPoints.length
        if (this.alertness >= 60) this.enter('investigate')
        break
      }
      case 'investigate': {
        stepToward(this, this.lastKnown, dt, this.data.speed * 0.65, rhythm)
        if (this.alertness >= 100) this.enter('chase')
        else if (this.stateTick > 12 * 24) { this.enter(this.data.archetype === 'basic' ? 'idle' : 'patrol'); this.alertness *= 0.4 }
        break
      }
      case 'alert':
        faceSlow(this, p)
        if (this.data.ai.callAlly && this.stateTick % 36 === 0 && dist < 25 && this.alertness >= 60 && this.alertness < 100 && tick > this.callAllySuppressedUntil && this.rng.chance(0.3)) {
          this.beginCallAlly(tick)
        }
        if (this.alertness >= 100) this.enter('chase')
        else if (this.stateTick > 1800) this.enter('patrol')
        break
      case 'chase': {
        faceSlow(this, p, 0.5)
        const band = this.data.ai.distBands.find((b) => dist >= b.min && dist <= b.max)
        const kites = band?.actions.includes('backstep') ?? false
        const wants = band?.actions.includes('chase') ?? dist > 2
        if (kites) stepKite(this, p, dt, this.data.speed)
        else if (wants) stepToward(this, p, dt, this.data.speed, rhythm)
        else stepAway(this, p, dt, this.data.speed * 0.7)
        if (this.alertness < 40) this.enter('search')
        if (band && hasAttackAction(this, band.actions) && !this.attack && this.stateTick > 24) {
          this.tryAttack(band.actions, rhythm, tick, slotTaken)
        }
        break
      }
      case 'combat': {
        faceSlow(this, p, 0.6)
        const band = this.data.ai.distBands.find((b) => dist >= b.min && dist <= b.max)
        if (this.attack) {
          this.progressAttack(dt, tick, player, rhythm)
          // 射手边拉弓边挪（§14.4「永远背退拉近」）：出手窗口不站桩，但只走半速
          if (band?.actions.includes('backstep')) stepKite(this, p, dt, this.data.speed * 0.45)
        } else {
          if (dist > (this.data.ai.chaseBeyond ?? DEFAULT_CHASE_BEYOND)) { this.enter('chase'); break }
          if (this.data.ai.retreatHpFrac && this.stats.hp / this.stats.hpMax <= this.data.ai.retreatHpFrac) { this.enter('retreat'); break }
          if (band) {
            // 伪动作决定脚下一步：'chase' 贴近、'backstep' 拉开（射手风筝），真招式名才出手
            if (band.actions.includes('chase')) stepToward(this, p, dt, this.data.speed * 0.9, rhythm)
            else if (band.actions.includes('backstep')) stepKite(this, p, dt, this.data.speed)
            if (hasAttackAction(this, band.actions)) {
              this.tryAttack(band.actions, rhythm, tick, slotTaken)
            }
          }
          if (this.alertness < 40) this.enter('search')
        }
        break
      }
      case 'retreat': {
        stepAway(this, p, dt, this.data.speed * 1.1)
        const ally = nearestAlly(this)
        if (ally) stepToward(this, ally.pos, dt, this.data.speed, rhythm)
        if (this.stats.hp / this.stats.hpMax > this.data.ai.retreatHpFrac! * 1.8) this.enter('combat')
        else if (dist > 10) this.enter('combat')
        break
      }
      case 'search': {
        this.searchAngle += dt * 0.8
        const r = 4 + Math.sin(this.stateTick / 40) * 2
        stepToward(this, {
          x: this.lastKnown.x + Math.cos(this.searchAngle) * r, y: 0,
          z: this.lastKnown.z + Math.sin(this.searchAngle) * r
        }, dt, this.data.speed * 0.6, rhythm)
        if (this.alertness >= 100) this.enter('chase')
        else if (this.stateTick > 1200) { this.enter('patrol'); this.alertness = 0 }
        break
      }
      case 'callAlly': {
        if (!this.attack) this.enter(this.alertness >= 100 ? 'chase' : 'alert')
        else this.progressAttack(dt, tick, player, rhythm)
        break
      }
      case 'recover':
        this.attack = null
        if (this.stats.crumpleTicksLeft <= 0 && this.stateTick > 72) {
          this.stats.poiseAccum = 0
          this.enter('combat')
        }
        break
      case 'dead':
        if (this.stateTick > 360 && this.data.archetype !== 'boss') {
          // corpse fade handled by visuals; logic entity retired by AISystem
        }
        break
    }
    if (this.alertness > 0 && this.state !== 'combat') this.alertness = Math.max(0, this.alertness - (this.state === 'alert' || this.state === 'investigate' ? 8 : 20) * dt)
    for (const [k, v] of this.cooldowns) if (v > tick) { void v } else this.cooldowns.delete(k)
    if (this.coreFlash > 0) this.coreFlash -= dt
  }

  private beginCallAlly(tick: number): void {
    const c = this.data.ai.callAlly!
    this.attack = {
      spec: {
        id: 'callAlly', parryable: false, beat: [1, 2, 3, 4],
        frames: { startup: c.broadcastTicks, activeStart: c.broadcastTicks, activeEnd: c.broadcastTicks + 6, recovery: c.broadcastTicks + 24, damage: 0, stamina: 0, poise: 0, hitStopMs: 0, loudness: 9 }
      },
      tick: 0, hitDone: false, shots: 0, lungeApplied: 0
    }
    this.cooldowns.set('callAlly', tick + 600)
    this.enterCallAlly()
    const bc = () => {
      bus.emit('ai.callAlly', { fromId: this.id, pos: { ...this.pos }, range: c.range })
      bus.emit('audio.sfx', { key: 'wail', pos: { ...this.pos }, gain: 0.7 })
    }
    this.pendingBroadcast = bc
  }
  private pendingBroadcast: (() => void) | null = null
  private enterCallAlly(): void { this.enter('callAlly') }

  private tryAttack(actions: string[], rhythm: RhythmClock, tick: number, slotTaken: (k: string) => boolean): void {
    const usable = actions.filter((a) => !PSEUDO_ACTIONS.has(a) && !((this.cooldowns.get(a) ?? 0) > tick))
    const pick = this.rng.pick(usable)
    const spec = this.data.attacks.find((a) => a.id === pick)
    if (!spec) return
    const beatWait = rhythm.ticksUntilBeatOn(spec.beat)
    const key = `${rhythm.info().bar}:${rhythm.info().beatInBar}:${spec.beat[0]}`
    if (slotTaken(key)) return
    this.attack = { spec, tick: -beatWait, hitDone: false, shots: 0, lungeApplied: 0 }
    this.cooldowns.set(spec.id, tick + 240 + this.rng.int(0, 120))
    this.enter('combat')
    if (spec.id === 'callAlly' || pick === 'scream') {
      const c = this.data.ai.callAlly
      if (c) this.pendingBroadcast = () => bus.emit('ai.callAlly', { fromId: this.id, pos: { ...this.pos }, range: c.range })
    }
  }

  private progressAttack(dt: number, tick: number, player: PlayerController, rhythm: RhythmClock): void {
    if (!this.attack) return
    this.attack.tick++
    const f = this.attack.spec.frames
    // 赤线 telegraph 期间持续跟踪目标：线是「它会打哪」的诚实承诺，玩家要能看到被牵着
    if (f.projectile?.telegraph && this.attack.tick >= 0 && this.attack.tick < f.startup) {
      faceSlow(this, player.pos, 0.3)
    }
    if (this.attack.tick === f.startup && this.pendingBroadcast) {
      this.pendingBroadcast()
      this.pendingBroadcast = null
    }
    if (this.attack.tick > 0 && this.attack.tick <= f.activeEnd && f.lunge) {
      faceSlow(this, player.pos, 1)
      // don't lunge through the player: stop at melee contact distance
      const dToP = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z)
      if (dToP > 0.85) {
        const step = Math.min(f.lunge / Math.max(1, f.activeEnd - f.startup), dToP - 0.8)
        this.pos.x += Math.sin(this.yaw) * step
        this.pos.z += Math.cos(this.yaw) * step
      }
    }
    if (this.attack.tick >= f.recovery) {
      this.attack = null
      void rhythm
    }
  }

  interruptBroadcast(tick: number): void {
    if (this.attack && this.attack.tick < this.attack.spec.frames.startup && this.pendingBroadcast) {
      this.pendingBroadcast = null
      this.attack = null
      this.callAllySuppressedUntil = tick + 120
      this.stunTicks = 12
    }
  }

  onDamaged(knockDir?: Vec3): void {
    this.coreFlash = 0.15
    if (this.state === 'idle' || this.state === 'patrol' || this.state === 'investigate' || this.state === 'search') {
      this.alertness = 100
      this.enter('chase')
    }
    if (!this.data.ai.deaf) void knockDir
  }

  onParried(tick: number): void {
    this.stunTicks = 18
    this.attack = null
    this.pendingBroadcast = null
    this.cooldowns.set('parryLock', tick + 60)
  }
}

declare module '@/core/EventBus' {
  interface GameEvents {
    'ai.callAlly': { fromId: string; pos: Vec3; range: number }
  }
}

function norm(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function dist3(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.z - b.z) }

function faceSlow(e: Enemy, t: Vec3, rate = 0.15): void {
  const want = Math.atan2(t.x - e.pos.x, t.z - e.pos.z)
  e.yaw += norm(want - e.yaw) * rate
}

function stepToward(e: Enemy, t: Vec3, dt: number, speed: number, _rhythm: RhythmClock): void {
  const dx = t.x - e.pos.x, dz = t.z - e.pos.z
  const l = Math.hypot(dx, dz)
  if (l < 0.05) return
  e.pos.x += (dx / l) * speed * dt
  e.pos.z += (dz / l) * speed * dt
}

function stepAway(e: Enemy, t: Vec3, dt: number, speed: number): void {
  stepToward(e, { x: 2 * e.pos.x - t.x, y: 0, z: 2 * e.pos.z - t.z }, dt, speed, null as never)
}

/**
 * 射手的「背退拉近」（combat.md §14.4）：永远朝远离目标的方向走，但只在
 * `ai.kiteRange` 的家里半径内拉——否则它会一路退到地图边缘，玩家追不上也打不到。
 */
function stepKite(e: Enemy, t: Vec3, dt: number, speed: number): void {
  const limit = e.data.ai.kiteRange ?? 0
  if (limit > 0 && dist3(e.pos, e.home) >= limit) return
  stepAway(e, t, dt, speed)
}

/** 距离带里的伪动作（'chase'/'backstep'）不是招式名，别拿去查攻击表 */
const PSEUDO_ACTIONS = new Set(['chase', 'backstep'])

function hasAttackAction(e: Enemy, actions: string[]): boolean {
  return actions.some((a) => !PSEUDO_ACTIONS.has(a) && e.data.attacks.some((atk) => atk.id === a))
}

function playerIsMoving(p: PlayerController): boolean {
  return p.stats.stamina < p.stats.staMax && p.grounded === true && (p.camYawRef !== null) && moving(p)
}
function moving(p: PlayerController): boolean { return p.action === null ? true : false }

let registryRef: Enemy[] | null = null
export function bindEnemyRegistry(list: Enemy[]): void { registryRef = list }
function nearestAlly(e: Enemy): Enemy | null {
  if (!registryRef) return null
  let best: Enemy | null = null
  let bd = 1e9
  for (const o of registryRef) {
    if (o === e || !o.alive) continue
    const d = dist3(e.pos, o.pos)
    if (d < bd) { bd = d; best = o }
  }
  return best
}

export { clamp }
