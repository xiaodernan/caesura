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
  /**
   * 「定调」光环加成（§14.6 叠唱）：由 AISystem 每 tick 从最近的 buffAura 来源写入，
   * null = 未被定调。倍率全部来自那份数据表，不在这里写死（§55）。
   */
  buff: { attackSpeedMul: number; dmgMul: number; fromId: string } | null = null
  /**
   * §14.5「拍隙」当前状态：true = 此刻正踩在拍点上，半透明+定身，打不着也走不动。
   * 和 buff 一样是**每 tick 从数据重算的派生态**，不是需要维护的事件态。
   */
  intangible = false
  /** 被「拍点闪避」或「伪拍点声源」拽出拍隙的剩余 tick；>0 期间相位不再免伤 */
  revealTicks = 0
  /**
   * §14.7 钟甲是否已被震裂满层打碎。碎了就永久失效（不修甲、不长回来），
   * 所以「攒震裂」是一次性奖励而不是一轮流循环。消费方只有 strikeEnemy 一处。
   */
  armorBroken = false
  /** §14.7 敲钟自鸣的下一次准点小节（-1 = 还没参战，进战后才排程） */
  private tollDueBar = -1
  /** §15.2 'cycle' 选招的轮转指针（只在 pickOrder==='cycle' 时有意义） */
  private cycleIdx = 0
  /**
   * Boss 阶段下标（§15/§16）。**单调推进**：血线只降不升，所以绝不会来回跳阶，
   * 一记大伤害直接跨过两条线时也是一次性跳到最靠后的那一阶。
   */
  bossPhase = 0
  /** 每口立钟是否已经响过（下标 = `boss.bells.positions` 的下标） */
  bellsRung: boolean[] = []
  /** 钟壳被机关暂时剥掉的剩余 tick；这期间她的架势累积翻倍 */
  shellLiftTicks = 0
  /** 撞满 `breaksAt` 口钟 ⇒ 壳永久碎（不随 shellLiftTicks 归零而长回来） */
  shellBroken = false
  /** §15.3 瞬移咬合的冷却线 */
  private blinkReadyTick = 0
  /** §15.3「听心跳」：玩家已连续静止的 tick 数 */
  private stillTicks = 0
  /** 刚跳阶：让 CombatManager 演一次「敲钟怒吼」（hitstop + 低音 + 震镜） */
  phaseRoarPending = false
  /**
   * §15.2 玩家已经「夺回节拍」的剩余 tick：>0 期间这一阶的 stealBeat 全场减益与 BPM 游走都关掉。
   * 由 CombatManager 写（那里有玩家输入与节奏），本类只读。
   */
  stealNeutralTicks = 0
  /** 攻速加成用「攒够一整帧才多走一帧」实现，保持 tick 是整数（帧表里有 === 判定） */
  private speedAcc = 0
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
  /** 当前生效的 Boss 阶段（非 Boss 为 undefined） */
  get bossPhaseData(): NonNullable<EnemyData['boss']>['phases'][number] | undefined {
    return this.data.boss?.phases[this.bossPhase]
  }
  /**
   * 钟壳还在 = 这一阶写着 shell、没被撞碎、也没被钟声暂时剥掉。
   * 三态缺一不可：§15.1 的 P1 是「打不动，但场地能解」而不是「数值怪」。
   */
  get shellUp(): boolean {
    const sh = this.bossPhaseData?.shell
    return !!sh && !this.shellBroken && this.shellLiftTicks <= 0
  }
  get shellDmgMul(): number { return this.shellUp ? this.bossPhaseData!.shell!.dmgMul : 1 }
  get poiseImmune(): boolean { return this.shellUp && !!this.bossPhaseData?.shell?.immuneToPoise }
  /** 壳被剥掉的那 6s 里架势累积翻倍（§15.1：无敌解除 + 架势累积翻倍是同一个奖励） */
  get poiseAccumMul(): number {
    const sh = this.bossPhaseData?.shell
    return sh && !this.shellBroken && this.shellLiftTicks > 0 ? 2 : 1
  }
  get inStartup(): boolean { return !!this.attack && this.attack.tick < this.attack.spec.frames.startup }
  get activeHitbox(): ActiveEnemyHit | null {
    if (!this.attack) return null
    const f = this.attack.spec.frames
    if (this.attack.tick < f.activeStart || this.attack.tick > f.activeEnd || this.attack.hitDone) return null
    return {
      box: f.hitbox, yaw: this.yaw, damage: f.damage * (this.buff?.dmgMul ?? 1),
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

  /**
   * §14.6「定调」攻速加成：帧表全是整数 tick 且 telegraph/出手点用 `===` 判定，
   * 所以不能把 tick 变成浮点——累计小数部分，攒满 1 就这一 tick 多走一帧（1.15× ≈ 每 7 帧多 1 帧）。
   */
  private advanceAttackFrames(mul: number): void {
    if (!this.attack) return
    this.attack.tick++
    const extra = mul - 1
    if (extra <= 0) return
    this.speedAcc += extra
    while (this.speedAcc >= 1) { this.speedAcc -= 1; this.attack.tick++ }
  }

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

  hear(src: { pos: Vec3; loudness: number }, tick: number): void {
    if (!this.alive || this.data.ai.deaf) return
    const d = Math.hypot(src.pos.x - this.pos.x, src.pos.z - this.pos.z)
    if (d <= this.data.ai.hearing.range) {
      this.alertness = Math.min(100, this.alertness + src.loudness * 120)
      this.lastKnown = { ...src.pos }
    }
    this.huntSound(src, tick)
  }

  /**
   * §15.3 声音狩猎：够响的一声 ⇒ 她**瞬移到发声点并咬一口**。冷却由表给（`huntsSound`），
   * 否则一串脚步会让她连环跳；瞬移落点刻意留在发声点上，不往玩家怀里跳——玩家因此
   * 有 300ms 的前摇可读（她唯一的破绽就是这口前摇），而不是被凭空贴脸。
   */
  private huntSound(src: { pos: Vec3; loudness: number }, tick: number): void {
    const h = this.data.ai.huntsSound
    if (!h || !this.alive) return
    if (src.loudness < h.minLoudness) return
    if (tick < this.blinkReadyTick) return
    const d = Math.hypot(src.pos.x - this.pos.x, src.pos.z - this.pos.z)
    if (d > h.maxRange) return
    const spec = this.data.attacks.find((a) => a.id === h.attackId)
    if (!spec) return
    this.blinkReadyTick = tick + h.cooldownTicks
    this.pos.x = src.pos.x
    this.pos.z = src.pos.z
    this.lastKnown = { ...src.pos }
    this.alertness = 100
    // 她不在拍上 ⇒ 不等量化，落点即起手
    this.attack = { spec, tick: 0, hitDone: false, shots: 0, lungeApplied: 0 }
    this.enter('combat')
    bus.emit('vfx.request', { key: 'spike_chord', pos: { ...src.pos }, scale: 1.5 })
    bus.emit('audio.sfx', { key: 'boss_roar', pos: { ...src.pos }, gain: 0.5 })
    bus.emit('ui.notify', { text: '万籁听见了你', kind: 'boss' })
  }

  /**
   * §14.5 相位重算（每 tick 一次，纯函数）：离拍点足够近 = 隐形定身，除非刚被抓出来（reveal）。
   * 放在敌人自己身上而不是 CombatManager：命中层只问 `e.intangible`，不重复算拍子。
   */
  private syncPhase(rhythm: RhythmClock): void {
    const g = this.data.ai.beatGhost
    if (!g) return
    this.intangible = this.revealTicks <= 0 && rhythm.ticksFromBeatPoint() <= g.intangibleWindowTicks
    if (this.revealTicks > 0) this.revealTicks--
  }

  /**
   * §14.5 解法 c「投掷音色晶=伪拍点声源」：一次足够响的声源就是它听来的一个假拍点，
   * 相位被打乱 ⇒ 显形。响度阈值与时长全部来自 `ai.beatGhost`；自己的动静不算数。
   */
  fakeBeat(src: { id: string; pos: Vec3; loudness: number }): void {
    const g = this.data.ai.beatGhost
    if (!g || src.id === this.id || !this.alive) return
    if (src.loudness < g.fakeBeatLoudness) return
    if (dist3(this.pos, src.pos) > this.data.ai.hearing.range) return
    this.revealTicks = Math.max(this.revealTicks, g.fakeBeatRevealTicks)
  }

  update(dt: number, tick: number, player: PlayerController, rhythm: RhythmClock, slotTaken: (bar_beat: string) => boolean): void {
    if (!this.alive) {
      if (this.state !== 'dead') this.enter('dead')
      this.stateTick++
      return
    }
    if (tick < this.callAllySuppressedUntil) { /* noop */ }
    this.syncPhase(rhythm)
    // 读条被外力抹掉（stun、破势进 recover、走调时刻、处决都会直接 `attack = null`）时，
    // 挂在上面的后事必须一起作废——否则它会在**下一招**的起手帧上偷偷生效（白回 15 血、
    // 或把一次并不存在的警戒广播发出去）。实测过：没有这一行时漏回血。
    if (!this.attack && this.pendingBroadcast) this.pendingBroadcast = null
    this.syncBoss()
    // 读条被外力抹掉（破势进 recover、stun、走调时刻、处决…都会直接 `attack = null`）时，
    // 那口挂着的气息必须一起作废——否则它会在**下一招**的起手帧上偷偷生效（回血/警戒广播）。
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
        if (band?.actions.includes('hold')) { /* 伪动作 'hold'：不追不逃，站定唱下去（§14.6 叠唱） */ }
        else if (kites) stepKite(this, p, dt, this.data.speed)
        else if (wants) stepToward(this, p, dt, this.data.speed, rhythm)
        else stepAway(this, p, dt, this.data.speed * 0.7)
        if (this.alertness < 40) this.enter('search')
        const can = this.phaseActions(band?.actions ?? [])
        if (band && hasAttackAction(this, can) && !this.attack && this.stateTick > 24) {
          this.tryAttack(can, rhythm, tick, slotTaken)
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
          // §14.7 软计时器优先于随机招式：到点就必须敲钟，玩家要打断的是这一拍
          if (this.maybeBarCast(rhythm)) break
          if (band) {
            // 伪动作决定脚下一步：'chase' 贴近、'backstep' 拉开（射手风筝），真招式名才出手
            if (band.actions.includes('chase')) stepToward(this, p, dt, this.data.speed * 0.9, rhythm)
            else if (band.actions.includes('backstep')) stepKite(this, p, dt, this.data.speed)
            const can = this.phaseActions(band.actions)
            if (hasAttackAction(this, can)) {
              this.tryAttack(can, rhythm, tick, slotTaken)
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
    // §15.3「它也会听心跳」：玩家站住不动 ⇒ 她的警觉慢慢回落（屏息是可行解，不是 bug 绕过）
    const hb = this.data.ai.hearsHeartbeat
    if (hb) {
      if (playerIsMoving(player)) this.stillTicks = 0
      else this.stillTicks++
      if (this.stillTicks >= hb.stillTicks) this.alertness = Math.max(0, this.alertness - hb.decayPerSec * dt)
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

  /**
   * §14.7「敲钟自鸣」软计时器：进战后每 `everyBars` 小节强制插入一次那招长前摇读条，
   * 走完才回血。**故意不占用 tryAttack 的 RNG 候选**——它是节拍器，不是随机招式。
   * 打断走的是既有的读条机制（`pendingBroadcast` + 受击时 `interruptBroadcast`），
   * 所以「破势/硬直/任何一刀砍在前摇里」都能把这一笔血掐掉，无需新状态。
   */
  private maybeBarCast(rhythm: RhythmClock): boolean {
    const t = this.barCast
    if (!t) return false
    const bar = rhythm.info().bar
    if (this.tollDueBar < 0) this.tollDueBar = bar + t.everyBars // 进战第一拍不立刻演
    if (bar < this.tollDueBar) return false
    const spec = this.data.attacks.find((a) => a.id === t.attackId)
    if (!spec) return false
    this.tollDueBar = bar + t.everyBars
    // heal 省略（或满血）⇒ 不为了回血而演这一次，但计时器照常推进
    const heal = t.heal ?? 0
    if (heal > 0 && this.stats.hp >= this.stats.hpMax) return false
    const lead = spec.frames.activeStart
    this.attack = { spec, tick: lead - rhythm.ticksUntilBeatOn(spec.beat, lead), hitDone: false, shots: 0, lungeApplied: 0 }
    const label = t.label
    this.pendingBroadcast = () => {
      const before = this.stats.hp
      this.stats.heal(heal)
      const got = Math.round(this.stats.hp - before)
      bus.emit('audio.sfx', { key: (spec.frames.sfx ?? [])[0] ?? 'bell_toll', pos: { ...this.pos }, gain: 1 })
      bus.emit('vfx.request', { key: 'ring_echo', pos: { ...this.pos }, scale: 1.8 })
      bus.emit('sound.source', { id: this.id, pos: { ...this.pos }, loudness: 0.9 })
      if (label && got > 0) bus.emit('ui.notify', { text: `${label} · 回复 ${got}`, kind: 'info' })
    }
    return true
  }

  /**
   * §15/§16 Boss 阶段机：按血线单调跳阶，跳阶那一刻手上的读条作废（她要去敲钟怒吼）。
   * 阶段换了的是**招式白名单与护壳规则**，不是倍率——§16 明确不许「纯数值阶段」。
   */
  private syncBoss(): void {
    const b = this.data.boss
    if (!b) return
    if (this.shellLiftTicks > 0) this.shellLiftTicks--
    const frac = this.stats.hp / this.stats.hpMax
    let next = this.bossPhase
    for (let i = next + 1; i < b.phases.length; i++) {
      const gate = b.phases[i].belowHpFrac
      if (gate !== undefined && frac < gate) next = i // 允许一次跨过两阶
    }
    if (next === this.bossPhase) return
    this.bossPhase = next
    this.attack = null
    this.phaseRoarPending = true
    // 「转阶段 ⇒ 时钟重置」（§15.2）：换气排程与玩家抢拍的余量都不跨阶段带过去
    this.tollDueBar = -1
    this.stealNeutralTicks = 0
  }

  /** §15.2 夺拍配置（只有带着它的阶段才会触发全场减益） */
  get stealBeat(): NonNullable<NonNullable<EnemyData['boss']>['phases'][number]['stealBeat']> | null {
    return this.bossPhaseData?.stealBeat ?? null
  }
  /**
   * 「到点必须做的一件事」的两种来源：Boss 挂在阶段上（阶段会换），普通敌人挂在 ai 上。
   * §14.7 的敲钟自鸣与 §15.2 的换气拍因此共用一条排程器，而不是两套 if。
   */
  get barCast(): { everyBars: number; attackId: string; heal?: number; label?: string } | null {
    return this.bossPhaseData?.barCast ?? this.data.ai.selfToll ?? null
  }
  /** 正在读「换气拍」那口气（前摇期）——玩家唯一能把拍抢回来的时刻 */
  get inBreath(): boolean {
    return !!this.attack?.spec.reclaimWindow && this.attack.tick < this.attack.spec.frames.startup
  }
  /** 阶段白名单（非 Boss 原样返回）：改表即改「这一阶她会什么」 */
  private phaseActions(actions: string[]): string[] {
    const allow = this.bossPhaseData?.attacks
    return allow ? actions.filter((a) => allow.includes(a)) : actions
  }

  /**
   * §15.1 撞钟机关：她那记 `flags:['charge']` 的落地帧附近若有一口还没响的钟，钟就响了。
   * 判据是**她自己的位置**（冲刺已经把她带到钟边），所以「引她撞钟」是站位问题、
   * 不是反应力问题——玩家要做的是站在钟前面让她冲过来，而不是拼一把弹反。
   */
  private ringBells(): void {
    const g = this.data.boss?.bells
    if (!g) return
    for (let i = 0; i < g.positions.length; i++) {
      if (this.bellsRung[i]) continue
      if (dist3(this.pos, g.positions[i]) > g.hitRadius) continue
      this.bellsRung[i] = true
      this.shellLiftTicks = Math.max(this.shellLiftTicks, g.releaseTicks)
      const rung = this.bellsRung.filter(Boolean).length
      bus.emit('audio.sfx', { key: 'bell_toll', pos: { ...g.positions[i] }, gain: 1 })
      bus.emit('vfx.request', { key: 'shock_small', pos: { ...g.positions[i] }, scale: 2.4 })
      bus.emit('ui.notify', {
        text: `立钟鸣响 · 钟壳共振解除 ${(g.releaseTicks / 60).toFixed(1)}s（${rung}/${g.positions.length}）`,
        kind: 'reward'
      })
      if (rung >= g.breaksAt && !this.shellBroken) {
        this.shellBroken = true
        bus.emit('vfx.request', { key: 'death_shatter', pos: { ...this.pos }, scale: 2 })
        bus.emit('ui.notify', { text: '钟壳碎裂！这一阶的减伤彻底没了', kind: 'reward' })
        // §15.1「撞 2 钟 = 壳碎（提前进 P2 条件）」：机关本身就是转阶段的捷径，不必把血磨到线
        if (this.bossPhase === 0 && (this.data.boss?.phases.length ?? 0) > 1) {
          this.bossPhase = 1
          this.attack = null
          this.phaseRoarPending = true
        }
      }
      break // 一记冲刺只撞得响一口钟
    }
  }

  private tryAttack(actions: string[], rhythm: RhythmClock, tick: number, slotTaken: (k: string) => boolean): void {    const usable = actions.filter((a) => !PSEUDO_ACTIONS.has(a) && !((this.cooldowns.get(a) ?? 0) > tick))
    if (!usable.length) return
    // 'cycle' = 按表的顺序轮转（§15.2「每 4 小节一个乐句，玩家可背谱」：随机背不了谱）
    let pick: string | undefined
    if (this.data.ai.pickOrder === 'cycle') {
      const start = this.cycleIdx % actions.length
      for (let i = 0; i < actions.length; i++) {
        const cand = actions[(start + i) % actions.length]
        if (usable.includes(cand)) { pick = cand; this.cycleIdx = start + i + 1; break }
      }
    } else pick = this.rng.pick(usable)
    if (!pick) return
    const spec = this.data.attacks.find((a) => a.id === pick)
    if (!spec) return
    // §2.1：约束的是**命中帧**落在拍点，不是起手帧 ⇒ 起手要提前一整个前摇。
    // （旧写法把 tick 0 当成拍点，结果所有招式的命中都比拍点晚 0.2~0.6s：
    //  蓄力重的敌人「看着像在重拍上，其实在重拍之后」，§2.1 的可预测性直接失效。）
    const offGrid = spec.onGrid === false
    const lead = spec.frames.activeStart
    const beatWait = offGrid ? 0 : rhythm.ticksUntilBeatOn(spec.beat, lead)
    if (!offGrid) {
      const key = `${rhythm.info().bar}:${rhythm.info().beatInBar}:${spec.beat[0]}`
      if (slotTaken(key)) return
    }
    this.attack = { spec, tick: lead - beatWait, hitDone: false, shots: 0, lungeApplied: 0 }
    this.cooldowns.set(spec.id, tick + 240 + this.rng.int(0, 120))
    this.enter('combat')
    if (spec.id === 'callAlly' || pick === 'scream') {
      const c = this.data.ai.callAlly
      if (c) this.pendingBroadcast = () => bus.emit('ai.callAlly', { fromId: this.id, pos: { ...this.pos }, range: c.range })
    }
  }

  private progressAttack(dt: number, tick: number, player: PlayerController, rhythm: RhythmClock): void {
    if (!this.attack) return
    this.advanceAttackFrames(this.buff?.attackSpeedMul ?? 1)
    const f = this.attack.spec.frames
    // 赤线 telegraph 期间持续跟踪目标：线是「它会打哪」的诚实承诺，玩家要能看到被牵着
    if (f.projectile?.telegraph && this.attack.tick >= 0 && this.attack.tick < f.startup) {
      faceSlow(this, player.pos, 0.3)
    }
    if (this.attack.tick === f.startup && this.pendingBroadcast) {
      this.pendingBroadcast()
      this.pendingBroadcast = null
    }
    // §15.1 撞钟机关：冲刺的落地帧（=读条走完那一帧）附近有别人才响得动的钟
    // 敌人的前摇音：audio.md §7.2 要求「听见起手」而不是「看见落点」——本作核心反馈通道，
    // 但此前 enemies.json 里那 8 套 sfx 字段根本没有发射方（只有玩家招式与弹道发射在响）。
    if (this.attack.tick === 0 && f.sfx?.[0]) {
      bus.emit('audio.sfx', { key: f.sfx[0], pos: { ...this.pos }, gain: 0.55 + Math.min(0.3, (f.loudness ?? 4) / 20) })
    }
    if (this.attack.tick === f.startup && f.flags?.includes('charge')) this.ringBells()
    // 撞钟可能就地跳阶（§15.1「撞 2 钟 = 提前进 P2」），而跳阶会把这一招收掉 ⇒ 别再用陈旧的帧表
    if (!this.attack) return
    if (this.attack.tick > 0 && this.attack.tick <= f.activeEnd && f.lunge && !this.intangible) {
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
      // 连段派生（§14.5 切分连踏「2 段半拍」）：下一段不在这一拍上硬顶，而是量化到它自己的
      // 拍位再打——两段之间因此留下真实的呼吸拍，这正是 §13.1 要求的惩罚窗口。
      const next = f.next ? this.data.attacks.find((a) => a.id === f.next) : undefined
      if (next) {
        const nextLead = next.frames.activeStart
        this.attack = { spec: next, tick: nextLead - rhythm.ticksUntilBeatOn(next.beat, nextLead), hitDone: false, shots: 0, lungeApplied: 0 }
      } else this.attack = null
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
    // §14.7「弹反钟锤二连第二段 → 钟体共振眩晕 2s」：只有写了 parryStunTicks 的招式给这个回报
    const resonant = this.attack?.spec.parryStunTicks
    this.stunTicks = resonant ?? 18
    this.attack = null
    this.pendingBroadcast = null
    this.cooldowns.set('parryLock', tick + 60)
    if (resonant && resonant > 18) {
      bus.emit('vfx.request', { key: 'shock_small', pos: { ...this.pos }, scale: 1.5 })
      bus.emit('ui.notify', { text: `钟体共振！失衡 ${(resonant / 60).toFixed(1)}s`, kind: 'info' })
    }
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
  if (e.intangible) return // §14.5「仅半拍窗内位移」：拍点上定身，包括追击/逃跑/搜索
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

/** 距离带里的伪动作：只决定脚步，不能当成招式出手 */
const PSEUDO_ACTIONS = new Set(['chase', 'backstep', 'hold'])

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
