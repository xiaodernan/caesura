import { bus } from '@/core/EventBus'
import { Rng } from '@/core/Math'
import type { GameTime } from '@/core/Time'
import { TICK_DT } from '@/core/Time'
import type { RhythmClock } from '@/core/RhythmClock'
import type { Input } from '@/core/Input'
import type { PlayerController, ActivePlayerHit } from '@/player/ThirdPersonController'
import type { AISystem } from '@/ai/AISystem'
import type { Enemy } from '@/ai/Enemy'
import type { FrameData, ProjectileSpec } from '@/data/schema'
import { resolveDamage } from './DamagePipeline'
import { shapeHits, isBackstab } from './HitShapes'
import { ProjectileSystem, sphereHits, type Projectile } from './Projectiles'
import type { Vec3 } from './EntityStats'

type ExecuteKind = 'A' | 'B' | 'C'

/** 一次「打在某人身上」的全部决策输入；近战与弹体共用同一条结算通道（combat.md §12） */
interface EnemyStrike {
  base: number
  poise: number
  hitStopMs: number
  kind: 'light' | 'heavy' | 'skill'
  /** 震裂层数（§11） */
  layers: number
  mute: boolean
  backstab: boolean
  onBeat: boolean
  ranged: boolean
  /** 钉住定身 tick（投掷枪） */
  pinTicks: number
  point: Vec3
  dir: Vec3
  shakeKey: string
}

/** 玩家要防御的一击：敌方近战与敌方弹体走同一个阶梯（§5：弹反 > 无敌帧 > 完美格挡 > 格挡 > 硬吃） */
interface Threat {
  attackerId: string
  damage: number
  poise: number
  hitStopMs: number
  kind: 'light' | 'heavy' | 'skill' | 'enemy'
  point: Vec3
  dir: Vec3
  /** 威胁来自哪里（弹反朝向判定用；弹体用弹体自身位置） */
  from: Vec3
  parryable: boolean
  ranged: boolean
  statusOnHit?: { tag: string; layers: number }
  /** 攻击方一侧的后果：近战敌人被弹反会硬直+破势，弹体被弹反就凭空消失 */
  react(tick: number, outcome: 'parry' | 'perfectBlock'): void
}

/** hit-resolution orchestrator — docs/combat.md §5/§7/§12 */
export class CombatManager {
  rng = new Rng('combat')
  /** 弹道运行时（投掷枪 / 远程敌人）；表现层每帧读 list()，逻辑层不认识 three */
  readonly projectiles = new ProjectileSystem()
  private killed = new Set<string>()
  private execCount = new Map<string, number>()
  /** 注入：脚下地面高度查询（world/Surface），用于「射进地面就落地」；缺省则只做射程/寿命到期 */
  floorAt: ((pos: Vec3) => number | null) | null = null

  constructor(
    private player: PlayerController,
    private ai: AISystem,
    private time: GameTime,
    private rhythm: RhythmClock
  ) {
    bus.on('entity.died', () => this.checkEncounterMusic())
    // 主人被流送回收后，它的弹体不该继续追人（§5.5 出怪回收闭环）
    bus.on('entity.despawned', ({ id }) => {
      for (const p of this.projectiles.withOwner(id)) this.projectiles.kill(p, 'expire')
    })
  }

  checkEncounterMusic(): void {
    const anyAggro = this.ai.enemies.some((e) =>
      e.alive && (e.state === 'combat' || e.state === 'chase' || e.state === 'alert' || e.state === 'callAlly'))
    bus.emit('audio.music.encounter', { start: anyAggro })
  }

  update(tick: number, input?: Input, dt = TICK_DT): void {
    this.tryExecute(input, tick)
    this.launchPlayerProjectile(tick)
    this.launchEnemyProjectiles(tick)
    this.playerHitsEnemies(tick)
    if (!this.player.executing) this.enemiesHitPlayer(tick)
    this.projectilePass(tick, dt)
    if (tick % 30 === 0) this.checkEncounterMusic()
  }

  /* ======================= 近战：玩家 → 敌人 ======================= */

  private playerHitsEnemies(tick: number): void {
    const hb = this.player.activeHitbox
    if (!hb?.box) return
    for (const e of this.ai.enemies) {
      if (!e.alive) continue
      const hit = shapeHits(hb.box, this.player.pos, hb.yaw, e.hitTarget())
      if (!hit) continue
      this.player.markActionHit()
      const p = this.player
      this.strikeEnemy(e, {
        base: hb.damage, poise: hb.poise, hitStopMs: hb.hitStopMs,
        kind: (p.action?.key ?? '').startsWith('l') ? 'light' : 'heavy',
        layers: this.fissureLayersOf(p.action?.key ?? '', p.action?.f, hb),
        mute: hb.flags.includes('mute'),
        backstab: isBackstab(p.pos, e.hitTarget()),
        onBeat: this.rhythm.onBeat(50),
        ranged: false, pinTicks: 0,
        point: midpoint(p.pos, e.pos), dir: flatDir(p.pos, e.pos),
        shakeKey: hb.shake
      }, tick)
      break // one swing, one target
    }
  }

  /** 显式 fissureLayers 优先，否则沿用重击家族的按键默认（§11） */
  private fissureLayersOf(key: string, f: FrameData | undefined, hb: ActivePlayerHit): number {
    const declared = f?.fissureLayers
    const byKey = key === 'charged' ? 2 : key === 'h' ? 1 : 0
    return (declared ?? byKey) + (hb.flags.includes('fissure') ? 1 : 0)
  }

  /** 唯一的「玩家打到敌人」通道：近战、投掷弹体、以及未来的战技都从这里走 */
  private strikeEnemy(e: Enemy, s: EnemyStrike, tick: number): void {
    const p = this.player
    const crumpled = e.stats.crumpleTicksLeft > 0
    const dmg = resolveDamage({
      base: s.base,
      attrs: p.base.attrs,
      scaling: p.weapon.scaling,
      defense: e.stats.defense,
      backstab: s.backstab,
      onBeat: s.onBeat,
      ranged: s.ranged
    }, () => this.rng.float())
    let final = dmg.damage
    if (crumpled) final = Math.round(final * 1.5)

    const poiseMul = (e.inStartup ? 1.5 : 1) * (s.onBeat ? 2 : 1)
    e.stats.addPoise(Math.round(s.poise * poiseMul * (p.weapon.poiseMul ?? 1)), tick)
    const burst = e.stats.addFissure(s.layers)
    if (s.mute && e.data.ai.buffAura) e.stunTicks = Math.max(e.stunTicks, 60)
    if (s.pinTicks > 0) e.stunTicks = Math.max(e.stunTicks, s.pinTicks) // 钉住定身

    e.stats.damage(final)
    e.onDamaged()
    e.interruptBroadcast(tick)

    bus.emit('combat.hit', {
      attackerId: 'player', victimId: e.id, damage: final, poiseDamage: s.poise,
      kind: s.kind, point: s.point, dir: s.dir, result: 'hit',
      hitStopMs: s.hitStopMs + (s.onBeat ? 30 : 0), shakeKey: s.shakeKey,
      backstab: s.backstab, weakpoint: false
    })
    this.time.hitStop((s.hitStopMs + (s.onBeat ? 30 : 0)) / 1000)
    if (burst) this.fissureBurst(e, s.point)
    this.player.onHitLanded()
    if (s.pinTicks > 0) bus.emit('ui.notify', { text: `钉住 −${final}`, kind: 'info' })
    this.checkCrumple(e, tick)
    if (!e.alive) this.onEnemyKilled(e)
  }

  /* ======================= 弹道 ======================= */

  /** 玩家投掷枪：进入 activeStart 的那一帧发射（同一动作只发射一次） */
  private launchPlayerProjectile(tick: number): void {
    const a = this.player.action
    if (!a || a.launched) return
    const spec = a.f.projectile
    if (!spec || a.tick < a.f.activeStart) return
    a.launched = true
    const p = this.player
    const origin: Vec3 = { x: p.pos.x, y: p.pos.y + (spec.offsetY ?? 1.1), z: p.pos.z }
    const target = p.lockedTarget ? { x: p.lockedTarget.getPos().x, y: p.lockedTarget.getPos().y + 0.9, z: p.lockedTarget.getPos().z } : null
    const dir = target ? aimAt(origin, target, spec) : aimFlat(origin, p.yaw, spec)
    const onBeat = this.rhythm.onBeat(50)
    this.projectiles.spawn({
      hostile: false, ownerId: 'player', kind: spec.kind, origin, dir,
      speed: spec.speed, range: spec.range, radius: spec.radius, gravity: spec.gravity,
      damage: a.f.damage, poise: a.f.poise, hitStopMs: a.f.hitStopMs,
      layers: a.f.fissureLayers ?? (a.key === 'charged' ? 2 : a.key === 'h' ? 1 : 0),
      pinTicks: spec.pinTicks ?? 0, muteTicks: (spec.muteOnHit ?? 0) * 240,
      pierce: spec.pierce, onBeat, parryable: true,
      sfxHit: spec.sfxHit, vfxHit: spec.vfxHit, shake: spec.shake ?? a.f.shake ?? 'normal',
      loudness: a.f.loudness ?? 5
    }, tick)
    this.afterLaunch(p.pos, spec, a.f, dir)
  }

  /** 敌人射击：同一个 ProjectileSystem，只是 hostile=true */
  private launchEnemyProjectiles(tick: number): void {
    for (const e of this.ai.enemies) {
      const pending = e.pendingProjectile
      if (!pending) continue
      e.markLaunched()
      const { spec, frames } = pending
      const origin: Vec3 = { x: e.pos.x, y: e.pos.y + (spec.offsetY ?? 1.1), z: e.pos.z }
      const target: Vec3 = { x: this.player.pos.x, y: this.player.pos.y + 0.9, z: this.player.pos.z }
      // 不追求必中：给一点散布，玩家有走位/翻滚的余地（§5 远程威胁可读性）
      const spread = (this.rng.float() - 0.5) * 0.12
      const dir = rotate(aimAt(origin, target, spec), spread)
      this.projectiles.spawn({
        hostile: true, ownerId: e.id, kind: spec.kind, origin, dir,
        speed: spec.speed, range: spec.range, radius: spec.radius, gravity: spec.gravity,
        damage: frames.damage * (e.buffedByRefrein ? 1.1 : 1), poise: frames.poise,
        hitStopMs: frames.hitStopMs, muteTicks: (spec.muteOnHit ?? 0) * 240,
        pinTicks: spec.pinTicks ?? 0, parryable: true,
        sfxHit: spec.sfxHit, vfxHit: spec.vfxHit, shake: spec.shake ?? frames.shake ?? 'normal',
        loudness: frames.loudness ?? 4
      }, tick)
      this.afterLaunch(e.pos, spec, frames, dir)
      bus.emit('sound.source', { id: e.id, pos: { ...e.pos }, loudness: ((frames.loudness ?? 4) / 10) })
    }
  }

  private afterLaunch(from: Vec3, spec: ProjectileSpec, frames: FrameData, dir: Vec3): void {
    const pos: Vec3 = { x: from.x, y: from.y + 0.2, z: from.z }
    bus.emit('audio.sfx', { key: spec.sfxLaunch ?? frames.sfx?.[0] ?? 'thrust_1', pos, gain: 0.7 })
    if (frames.vfx?.[0]) {
      bus.emit('vfx.request', { key: frames.vfx[0], pos, dir: { x: dir.x, y: 0, z: dir.z }, scale: 0.8 })
    }
  }

  /** 弹体推进 + 命中判定 + 回收（每 tick 一次，紧跟在近战判定之后） */
  private projectilePass(tick: number, dt: number): void {
    this.projectiles.update(dt, tick)
    for (const pr of this.projectiles.list()) {
      if (pr.dead) continue
      if (pr.hostile) {
        if (!this.player.executing && sphereHits(pr, this.player.hitTarget())) this.projectileThreatensPlayer(pr, tick)
      } else {
        for (const e of this.ai.enemies) {
          if (!e.alive || pr.hitIds.has(e.id)) continue
          if (!sphereHits(pr, e.hitTarget())) continue
          this.projectileStrikesEnemy(pr, e, tick)
          if (pr.dead) break
        }
      }
      if (pr.dead) continue
      const fy = this.floorAt?.(pr.pos)
      if (fy !== null && fy !== undefined && pr.pos.y <= fy + 0.06) this.projectiles.kill(pr, 'ground')
    }
    this.projectiles.reap((p, reason) => this.onProjectileGone(p, reason))
  }

  private projectileStrikesEnemy(pr: Projectile, e: Enemy, tick: number): void {
    this.projectiles.consume(pr, e.id)
    this.strikeEnemy(e, {
      base: pr.damage, poise: pr.poise, hitStopMs: pr.hitStopMs, kind: 'heavy',
      layers: pr.layers, mute: pr.muteTicks > 0, backstab: false,
      onBeat: pr.onBeat, ranged: true, pinTicks: pr.pinTicks,
      point: { x: e.pos.x, y: e.pos.y + 1.1, z: e.pos.z }, dir: { ...pr.vel },
      shakeKey: pr.shake
    }, tick)
    if (pr.muteTicks > 0) e.stats.muteTicksLeft = Math.max(e.stats.muteTicksLeft, pr.muteTicks)
    bus.emit('vfx.request', { key: pr.vfxHit, pos: { ...pr.pos }, dir: { x: pr.vel.x, y: 0, z: pr.vel.z } })
    bus.emit('audio.sfx', { key: pr.sfxHit, pos: { ...pr.pos }, gain: 0.8 })
  }

  private projectileThreatensPlayer(pr: Projectile, tick: number): void {
    const e = this.ai.enemies.find((x) => x.id === pr.ownerId)
    const point: Vec3 = { x: this.player.pos.x, y: this.player.pos.y + 1.0, z: this.player.pos.z }
    this.projectiles.kill(pr, 'hit')
    this.resolveAgainstPlayer({
      attackerId: pr.ownerId, damage: pr.damage, poise: pr.poise, hitStopMs: pr.hitStopMs,
      kind: 'enemy', point, dir: { x: -pr.vel.x, y: 0, z: -pr.vel.z }, from: { ...pr.pos },
      parryable: pr.parryable, ranged: true,
      statusOnHit: pr.muteTicks > 0 ? { tag: 'mute', layers: 1 } : undefined,
      // 弹体被弹开/被完美格挡：它就是消失了，没有「攻击者硬直」这回事
      react: () => this.projectiles.kill(pr, 'expire')
    }, tick)
    if (e) this.checkCrumple(e, tick)
  }

  private onProjectileGone(pr: Projectile, reason: 'hit' | 'ground' | 'range' | 'expire'): void {
    if (reason !== 'ground') return
    bus.emit('vfx.request', { key: 'ring_dust', pos: { ...pr.pos }, scale: 0.4 })
    bus.emit('audio.sfx', { key: pr.hostile ? 'block_guard' : 'hit_metal', pos: { ...pr.pos }, gain: 0.35 })
  }

  /* ======================= 防御阶梯（玩家受击） ======================= */

  private enemiesHitPlayer(tick: number): void {
    for (const e of this.ai.enemies) {
      const hb = e.activeHitbox
      if (!hb?.box) continue
      const hit = shapeHits(hb.box, e.pos, e.yaw, this.player.hitTarget())
      if (!hit) continue
      if (e.attack) e.attack.hitDone = true
      const st = e.attack?.spec.statusOnHit
      this.resolveAgainstPlayer({
        attackerId: e.id, damage: hb.damage, poise: hb.poise, hitStopMs: hb.hitStopMs,
        kind: 'enemy', point: midpoint(e.pos, this.player.pos), dir: flatDir(e.pos, this.player.pos),
        from: { ...e.pos }, parryable: e.attack?.spec.parryable ?? true, ranged: false,
        statusOnHit: st,
        react: (t, outcome) => {
          if (outcome === 'parry') {
            e.onParried(t)
            e.stats.addPoise(this.player.base.parry.poiseDamage, t)
            this.checkCrumple(e, t)
            if (!e.alive) this.onEnemyKilled(e)
          } else {
            e.stats.addPoise(8, t)
            this.checkCrumple(e, t)
          }
        }
      }, tick)
    }
  }

  /** §5 优先级：弹反 > 无敌帧 > 完美格挡 > 格挡（含破防）> 硬吃。近战与弹体共用 */
  private resolveAgainstPlayer(h: Threat, tick: number): void {
    const p = this.player
    const base = {
      attackerId: h.attackerId, victimId: 'player', poiseDamage: h.poise, kind: h.kind,
      point: h.point, dir: h.dir, hitStopMs: h.hitStopMs, backstab: false, weakpoint: false
    }
    const facing = Math.abs(norm(Math.atan2(h.from.x - p.pos.x, h.from.z - p.pos.z) - p.yaw)) < Math.PI * 0.55
    if (p.parryActive && facing && h.parryable) {
      h.react(tick, 'parry')
      p.addOverdrive(p.base.parry.overdriveGain)
      this.time.hitStop(0.12)
      bus.emit('combat.hit', { ...base, damage: 0, result: 'parry', shakeKey: 'parry' })
      bus.emit('combat.parried', { attackerId: h.attackerId, defenderId: 'player' })
      bus.emit('vfx.request', { key: 'parry_ring', pos: h.point })
      bus.emit('audio.sfx', { key: 'parry_bell', pos: h.point, gain: 1 })
      return
    }
    p.parryTicksLeft = 0
    if (p.iFrame) {
      bus.emit('combat.hit', { ...base, damage: 0, result: 'immune', shakeKey: 'graze' })
      return
    }
    if (p.guardTicks >= 1 && p.guardTicks <= p.base.perfectBlockWindow) {
      h.react(tick, 'perfectBlock')
      p.addOverdrive(1)
      this.time.hitStop(0.09)
      bus.emit('combat.hit', { ...base, damage: 0, result: 'perfectBlock', shakeKey: 'graze' })
      bus.emit('vfx.request', { key: 'parry_ring', pos: h.point, scale: 0.7 })
      bus.emit('audio.sfx', { key: 'perfect_block', pos: h.point, gain: 0.9 })
      return
    }
    if (p.guarding) {
      const through = Math.round(h.damage * (1 - p.base.guard.reduction))
      const staCost = through * p.base.guard.staPerDmg
      if (p.stats.stamina > staCost) {
        p.stats.spendStamina(staCost, tick)
        p.stats.addPoise(h.damage * p.base.guard.bleedPoiseFrac, tick)
        this.time.hitStop(0.045)
        bus.emit('combat.hit', { ...base, damage: through, result: 'block', shakeKey: 'graze' })
        bus.emit('vfx.request', { key: 'block_spark', pos: h.point })
        bus.emit('audio.sfx', { key: 'block_guard', pos: h.point, gain: 0.7 })
      } else {
        p.stats.stamina = 0
        p.exhausted = true
        p.stunTicks = 36 // guard break 600ms (combat.md §5.1)
        p.takeDamage(Math.round(through * 1.3), h.dir)
        bus.emit('combat.hit', { ...base, damage: through, result: 'hit', shakeKey: 'heavy' })
        bus.emit('ui.notify', { text: '破防！', kind: 'info' })
      }
      this.checkPlayerCrumple(tick)
      return
    }
    const dmg = resolveDamage({ base: h.damage, defense: p.stats.defense, ranged: h.ranged }, () => this.rng.float())
    if (!p.takeDamage(dmg.damage, h.dir)) return
    p.stats.addPoise(h.poise, tick)
    this.time.hitStop(0.08)
    bus.emit('combat.hit', { ...base, damage: dmg.damage, result: 'hit', shakeKey: 'hurt' })
    bus.emit('vfx.request', { key: 'hit_ring', pos: h.point })
    bus.emit('audio.sfx', { key: 'hit_flesh', pos: h.point, gain: 0.8 })
    const st = h.statusOnHit
    if (st?.tag === 'mute') p.stats.muteTicksLeft = Math.max(p.stats.muteTicksLeft, st.layers * 240)
    this.checkPlayerCrumple(tick)
  }

  /* ======================= 破势 / 死亡 / 处决 ======================= */

  private fissureBurst(e: Enemy, point: Vec3): void {
    const raw = resolveDamage({ base: 0, defense: 0, rawDamage: 20 }, () => this.rng.float())
    e.stats.damage(raw.damage)
    e.stats.addPoise(40, this.time.tick)
    bus.emit('vfx.request', { key: 'hit_ring', pos: point, scale: 1.6 })
    bus.emit('audio.sfx', { key: 'hit_metal', pos: point, gain: 0.8 })
    bus.emit('ui.notify', { text: '震裂碎裂！', kind: 'info' })
    if (!e.alive) this.onEnemyKilled(e)
  }

  private checkCrumple(e: Enemy, tick: number): void {
    if (e.stats.crumpleTicksLeft > 0 && e.state !== 'recover') {
      e.attack = null
      e.enter('recover')
      bus.emit('vfx.request', { key: 'shock_small', pos: { ...e.pos }, scale: 1.3 })
      bus.emit('ui.notify', { text: '破势！', kind: 'info' })
      void tick
    }
  }

  private onEnemyKilled(e: Enemy): void {
    if (this.killed.has(e.id)) return
    this.killed.add(e.id)
    e.enter('dead')
    bus.emit('entity.died', { id: e.id, kind: 'enemy', position: { ...e.pos } })
    bus.emit('vfx.request', { key: 'death_shatter', pos: { ...e.pos }, scale: e.data.body?.scale ?? 1 })
    bus.emit('audio.sfx', { key: 'death_shatter', pos: { ...e.pos }, gain: 0.8 })
    bus.emit('ui.notify', { text: `${nameOf(e.data.nameKey)} 崩解 · 遗响 +${Math.round(e.stats.hpMax * 0.3)}`, kind: 'reward' })
  }

  /** §5.4 Execute/Backstab — trigger detection (interact edge + valid candidate) */
  private tryExecute(input: Input | undefined, tick: number): void {
    if (!input?.frame.edges.has('interact')) return
    const p = this.player
    if (p.busy || p.executing) return
    const cand = this.findExecuteTarget()
    if (cand) this.landExecute(cand.e, cand.kind, tick)
  }

  private findExecuteTarget(): { e: Enemy; kind: ExecuteKind } | null {
    const ex = this.player.base.execution
    const p = this.player
    const oc = p.stats.overdrive
    let best: { e: Enemy; kind: ExecuteKind } | null = null
    let bestD = Infinity
    for (const e of this.ai.enemies) {
      if (!e.alive) continue
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z)
      const crumpled = e.stats.crumpleTicksLeft > 0 || e.state === 'recover'
      const stalled = crumpled || e.stunTicks > 0 || e.inStartup
      const unaware = e.state === 'idle' || e.state === 'patrol' || e.state === 'investigate' || e.state === 'alert' || e.state === 'search'
      let kind: ExecuteKind | null = null
      if (crumpled && d <= ex.crumpleRange) kind = 'A'
      else if (unaware && d <= ex.backstabRange && behindCone(p.pos, e, ex.backstabConeDeg)) kind = 'B'
      else if (oc >= ex.overdriveCost && stalled && d <= ex.crumpleRange) kind = 'C'
      if (kind && d < bestD) { bestD = d; best = { e, kind } }
    }
    return best
  }

  /** apply the true-damage strike + start the invulnerable montage */
  private landExecute(e: Enemy, kind: ExecuteKind, tick: number): void {
    const ex = this.player.base.execution
    const p = this.player
    const isBoss = e.isBoss
    let dmg: number
    let silent = false
    if (kind === 'B' && !isBoss && e.stats.hp / e.stats.hpMax <= ex.stealthKillFrac) {
      silent = true
      dmg = e.stats.hp
    } else {
      let frac = ex.hpFrac
      let flat = isBoss ? 0 : ex.flat
      if (kind === 'C') {
        frac = ex.overdriveFrac
        flat = isBoss ? 0 : ex.overdriveFlat
        p.stats.overdrive = Math.max(0, p.stats.overdrive - ex.overdriveCost)
      }
      if (isBoss) {
        const c = this.execCount.get(e.id) ?? 0
        frac = ex.bossFracs[Math.min(c, ex.bossFracs.length - 1)]
        this.execCount.set(e.id, c + 1)
      }
      dmg = Math.round(e.stats.hpMax * frac) + flat
    }
    const point: Vec3 = { x: (p.pos.x + e.pos.x) / 2, y: 1.1, z: (p.pos.z + e.pos.z) / 2 }
    const dir: Vec3 = { x: e.pos.x - p.pos.x, y: 0, z: e.pos.z - p.pos.z }
    p.beginExecute({ ...e.pos }, ex.durationTicks)
    e.attack = null
    e.stunTicks = Math.max(e.stunTicks, ex.durationTicks)
    this.time.hitStop(ex.firstBladeHitStopMs / 1000)
    e.stats.damage(dmg)
    e.onDamaged(dir)
    bus.emit('combat.hit', {
      attackerId: 'player', victimId: e.id, damage: dmg, poiseDamage: 0, kind: 'heavy',
      point, dir, result: 'hit', hitStopMs: ex.firstBladeHitStopMs,
      shakeKey: isBoss ? 'boss' : 'heavy', backstab: kind === 'B', weakpoint: false
    })
    bus.emit('vfx.request', { key: 'hit_ring', pos: point, scale: 2 })
    bus.emit('vfx.request', { key: 'shock_small', pos: { ...e.pos }, scale: 1.6 })
    bus.emit('audio.sfx', { key: 'chord_slam', pos: point, gain: 1 })
    const label = silent ? '静杀' : kind === 'A' ? '处决' : kind === 'B' ? '背刺处决' : '休止处决'
    bus.emit('ui.notify', { text: `${label} −${dmg}`, kind: isBoss ? 'boss' : 'info' })
    if (!e.alive) this.onEnemyKilled(e)
    else this.checkCrumple(e, tick)
  }

  private checkPlayerCrumple(tick: number): void {
    const p = this.player
    if (p.stats.crumpleTicksLeft > 0 && p.crumpleTicks === 0) {
      p.crumpleTicks = p.stats.crumpleTicksLeft
      bus.emit('ui.notify', { text: '架势崩溃', kind: 'info' })
      void tick
    }
  }
}

function norm(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: 1.1, z: (a.z + b.z) / 2 }
}

/** 从 a 指向 b 的水平单位向量（伤害方向/击退都用水平分量） */
function flatDir(from: Vec3, to: Vec3): Vec3 {
  const x = to.x - from.x, z = to.z - from.z
  const l = Math.hypot(x, z) || 1
  return { x: x / l, y: 0, z: z / l }
}

/**
 * 未锁定时的默认瞄准：把弹道在「半射程」处正好抬到站立躯干中心（1.0m）。
 * 带重力弹道若纯水平出手，近距离会从头顶飞过——这条补偿让投掷枪在 3~22m 都能命中。
 */
function aimFlat(origin: Vec3, yaw: number, spec: ProjectileSpec): Vec3 {
  const g = spec.gravity ?? 0
  const tMid = spec.range / 2 / Math.max(1, spec.speed)
  const vy = (1.0 - origin.y + 0.5 * g * tMid * tMid) / tMid
  return { x: Math.sin(yaw), y: vy / Math.max(1, spec.speed), z: Math.cos(yaw) }
}

/** 指向目标的方向；带重力弹道用抛物线解出提前量（引针枪锁定投掷） */
function aimAt(from: Vec3, target: Vec3, spec: Pick<ProjectileSpec, 'speed' | 'gravity'>): Vec3 {
  const dx = target.x - from.x, dz = target.z - from.z
  const flat = Math.hypot(dx, dz) || 0.001
  const g = spec.gravity ?? 0
  const t = flat / Math.max(1, spec.speed)
  const dy = target.y - from.y + 0.5 * g * t * t
  return { x: dx / flat, y: dy / flat, z: dz / flat }
}

/** 绕竖直轴偏航（敌方命中的散布） */
function rotate(dir: Vec3, by: number): Vec3 {
  const s = Math.sin(by), c = Math.cos(by)
  return { x: dir.x * c + dir.z * s, y: dir.y, z: -dir.x * s + dir.z * c }
}

/** is the player inside a tight cone directly behind the enemy? (§5.4 backstab) */
function behindCone(playerPos: Vec3, e: Enemy, coneDeg: number): boolean {
  const ang = Math.atan2(playerPos.x - e.pos.x, playerPos.z - e.pos.z)
  return Math.abs(norm(ang - (e.yaw + Math.PI))) <= (coneDeg * Math.PI / 180) / 2
}

const NAME_MAP: Record<string, string> = {
  'enemy.murkshell': '嘈壳', 'enemy.driftsinger': '漂调者', 'enemy.tympanus': '驼鼓',
  'enemy.skewer': '针喉', 'enemy.phantome': '幽灵八', 'enemy.refrein': '叠唱'
}

export function nameOf(key: string): string {
  return NAME_MAP[key] ?? key
}
