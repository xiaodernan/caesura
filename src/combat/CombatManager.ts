import { bus } from '@/core/EventBus'
import { Rng } from '@/core/Math'
import type { GameTime } from '@/core/Time'
import type { RhythmClock } from '@/core/RhythmClock'
import type { Input } from '@/core/Input'
import type { PlayerController, ActivePlayerHit } from '@/player/ThirdPersonController'
import type { AISystem } from '@/ai/AISystem'
import type { Enemy, ActiveEnemyHit } from '@/ai/Enemy'
import { resolveDamage } from './DamagePipeline'
import { shapeHits, isBackstab } from './HitShapes'
import type { Vec3 } from './EntityStats'

type ExecuteKind = 'A' | 'B' | 'C'

/** hit-resolution orchestrator — docs/combat.md §5/§7/§12 */
export class CombatManager {
  rng = new Rng('combat')
  private killed = new Set<string>()
  private execCount = new Map<string, number>()

  constructor(
    private player: PlayerController,
    private ai: AISystem,
    private time: GameTime,
    private rhythm: RhythmClock
  ) {
    bus.on('entity.died', () => this.checkEncounterMusic())
  }

  checkEncounterMusic(): void {
    const anyAggro = this.ai.enemies.some((e) =>
      e.alive && (e.state === 'combat' || e.state === 'chase' || e.state === 'alert' || e.state === 'callAlly'))
    bus.emit('audio.music.encounter', { start: anyAggro })
  }

  update(tick: number, input?: Input): void {
    this.tryExecute(input, tick)
    this.playerHitsEnemies(tick)
    if (!this.player.executing) this.enemiesHitPlayer(tick)
    if (tick % 30 === 0) this.checkEncounterMusic()
  }

  private playerHitsEnemies(tick: number): void {
    const hb = this.player.activeHitbox
    if (!hb?.box) return
    for (const e of this.ai.enemies) {
      if (!e.alive) continue
      const hit = shapeHits(hb.box, this.player.pos, hb.yaw, e.hitTarget())
      if (!hit) continue
      this.player.markActionHit()
      this.resolvePlayerAttack(e, hb, tick)
      break // one swing, one target
    }
  }

  private resolvePlayerAttack(e: Enemy, hb: ActivePlayerHit, tick: number): void {
    const flags = new Set(hb.flags)
    const p = this.player
    const crumpled = e.stats.crumpleTicksLeft > 0
    const onBeat = this.rhythm.onBeat(50)
    const backstab = isBackstab(p.pos, e.hitTarget())
    const hitStopSec = (hb.hitStopMs + (onBeat ? 30 : 0)) / 1000

    const dmg = resolveDamage({
      base: hb.damage,
      attrs: p.base.attrs,
      scaling: p.weapon.scaling,
      defense: e.stats.defense,
      backstab,
      onBeat
    }, () => this.rng.float())
    let final = dmg.damage
    if (crumpled) final = Math.round(final * 1.5)

    const poiseMul = (e.inStartup ? 1.5 : 1) * (onBeat ? 2 : 1)
    e.stats.addPoise(Math.round(hb.poise * poiseMul * (p.weapon.poiseMul ?? 1)), tick)

    // Fissure stacking: heavy family only in this prototype (combat.md §11)
    const key = p.action?.key ?? ''
    const layers = key === 'charged' ? 2 : key === 'h' ? 1 : 0
    const burst = e.stats.addFissure(layers + (flags.has('fissure') ? 1 : 0))
    if (flags.has('mute') && e.data.ai.buffAura) e.stunTicks = Math.max(e.stunTicks, 60)

    e.stats.damage(final)
    e.onDamaged()
    e.interruptBroadcast(tick)

    const point: Vec3 = { x: (p.pos.x + e.pos.x) / 2, y: 1.1, z: (p.pos.z + e.pos.z) / 2 }
    const dir: Vec3 = { x: e.pos.x - p.pos.x, y: 0, z: e.pos.z - p.pos.z }
    bus.emit('combat.hit', {
      attackerId: 'player', victimId: e.id, damage: final, poiseDamage: hb.poise,
      kind: key.startsWith('l') ? 'light' : 'heavy',
      point, dir, result: 'hit', hitStopMs: hb.hitStopMs + (onBeat ? 30 : 0),
      shakeKey: hb.shake, backstab, weakpoint: false
    })
    this.time.hitStop(hitStopSec)
    if (burst) this.fissureBurst(e, point)
    this.player.onHitLanded()
    this.checkCrumple(e, tick)
    if (!e.alive) this.onEnemyKilled(e)
  }

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

  private enemiesHitPlayer(tick: number): void {
    for (const e of this.ai.enemies) {
      const hb = e.activeHitbox
      if (!hb?.box) continue
      const hit = shapeHits(hb.box, e.pos, e.yaw, this.player.hitTarget())
      if (!hit) continue
      if (e.attack) e.attack.hitDone = true
      this.resolveEnemyAttack(e, hb, tick)
    }
  }

  private resolveEnemyAttack(e: Enemy, hb: ActiveEnemyHit, tick: number): void {
    const p = this.player
    const point: Vec3 = { x: (p.pos.x + e.pos.x) / 2, y: 1.0, z: (p.pos.z + e.pos.z) / 2 }
    const dir: Vec3 = { x: p.pos.x - e.pos.x, y: 0, z: p.pos.z - e.pos.z }
    const base = {
      attackerId: e.id, victimId: 'player', poiseDamage: 0, kind: 'enemy' as const,
      point, dir, hitStopMs: hb.hitStopMs, backstab: false, weakpoint: false
    }
    // priority: parry > i-frame > perfect block > block > raw hit (docs/combat.md §5)
    const facingAttacker = Math.abs(norm(Math.atan2(e.pos.x - p.pos.x, e.pos.z - p.pos.z) - p.yaw)) < Math.PI * 0.55
    if (p.parryActive && facingAttacker && (e.attack?.spec.parryable ?? true)) {
      e.onParried(tick)
      e.stats.addPoise(p.base.parry.poiseDamage, tick)
      p.stats.stamina = Math.max(0, p.stats.stamina - 0) // parry success is free (combat.md §6.1)
      p.addOverdrive(p.base.parry.overdriveGain)
      this.time.hitStop(0.12)
      bus.emit('combat.hit', { ...base, damage: 0, result: 'parry', shakeKey: 'parry' })
      bus.emit('combat.parried', { attackerId: e.id, defenderId: 'player' })
      bus.emit('vfx.request', { key: 'parry_ring', pos: point })
      bus.emit('audio.sfx', { key: 'parry_bell', pos: point, gain: 1 })
      this.checkCrumple(e, tick)
      if (!e.alive) this.onEnemyKilled(e)
      return
    }
    p.parryTicksLeft = 0
    if (p.iFrame) {
      bus.emit('combat.hit', { ...base, damage: 0, result: 'immune', shakeKey: 'graze' })
      return
    }
    const inPerfectWindow = p.guardTicks >= 1 && p.guardTicks <= p.base.perfectBlockWindow
    if (inPerfectWindow) {
      e.stats.addPoise(8, tick)
      p.addOverdrive(1)
      this.time.hitStop(0.09)
      bus.emit('combat.hit', { ...base, damage: 0, result: 'perfectBlock', shakeKey: 'graze' })
      bus.emit('vfx.request', { key: 'parry_ring', pos: point, scale: 0.7 })
      bus.emit('audio.sfx', { key: 'perfect_block', pos: point, gain: 0.9 })
      this.checkCrumple(e, tick)
      return
    }
    if (p.guarding) {
      const through = Math.round(hb.damage * (1 - p.base.guard.reduction))
      const staCost = through * p.base.guard.staPerDmg
      if (p.stats.stamina > staCost) {
        p.stats.spendStamina(staCost, tick)
        p.stats.addPoise(hb.damage * p.base.guard.bleedPoiseFrac, tick)
        this.time.hitStop(0.045)
        bus.emit('combat.hit', { ...base, damage: through, result: 'block', shakeKey: 'graze' })
        bus.emit('vfx.request', { key: 'block_spark', pos: point })
        bus.emit('audio.sfx', { key: 'block_guard', pos: point, gain: 0.7 })
      } else {
        p.stats.stamina = 0
        p.exhausted = true
        p.stunTicks = 36 // guard break 600ms (combat.md §5.1)
        p.takeDamage(Math.round(through * 1.3), dir)
        bus.emit('combat.hit', { ...base, damage: through, result: 'hit', shakeKey: 'heavy' })
        bus.emit('ui.notify', { text: '破防！', kind: 'info' })
      }
      this.checkPlayerCrumple(tick)
      return
    }
    const dmg = resolveDamage({ base: hb.damage, defense: p.stats.defense }, () => this.rng.float())
    const applied = p.takeDamage(dmg.damage, dir)
    if (!applied) return
    p.stats.addPoise(hb.poise, tick)
    this.time.hitStop(0.08)
    bus.emit('combat.hit', { ...base, damage: dmg.damage, result: 'hit', shakeKey: 'hurt' })
    bus.emit('vfx.request', { key: 'hit_ring', pos: point })
    bus.emit('audio.sfx', { key: 'hit_flesh', pos: point, gain: 0.8 })
    const st = e.attack?.spec.statusOnHit
    if (st?.tag === 'mute') p.stats.muteTicksLeft = Math.max(p.stats.muteTicksLeft, st.layers * 240)
    this.checkPlayerCrumple(tick)
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
