/**
 * 弹道子系统（docs/combat.md §4.3 投掷枪 / §5 远程威胁）——纯逻辑层，不 import three。
 * 职责边界：这里只做运动学与生命周期（积分、射程/寿命到期、穿透计数），
 * 命中判定与伤害结算留在 CombatManager（全场只有一条受击通道，见 combat.md §12）。
 */
import type { Vec3 } from './EntityStats'
import type { HitTarget } from './HitShapes'

export type GoneReason = 'hit' | 'ground' | 'range' | 'expire'

export interface Projectile {
  id: number
  /** true = 敌人（或其他世界实体）射向玩家 */
  hostile: boolean
  ownerId: string
  kind: string
  pos: Vec3
  /** m/s，含重力时逐 tick 改变 y 分量 */
  vel: Vec3
  radius: number
  rangeLeft: number
  gravity: number
  damage: number
  poise: number
  hitStopMs: number
  layers: number
  pinTicks: number
  muteTicks: number
  onBeat: boolean
  parryable: boolean
  /** 还能再吃几个目标（pierce） */
  hitsLeft: number
  /** 同一弹体对同一目标只结算一次 */
  hitIds: Set<string>
  sfxHit: string
  vfxHit: string
  shake: string
  loudness: number
  dead: boolean
  gone: GoneReason | null
  bornTick: number
}

export interface LaunchParams {
  hostile: boolean
  ownerId: string
  kind: string
  origin: Vec3
  /** 单位方向（含 y 分量前已归一；系统会按 speed 缩放到等长） */
  dir: Vec3
  speed: number
  range: number
  radius: number
  gravity?: number
  damage: number
  poise: number
  hitStopMs: number
  layers?: number
  pinTicks?: number
  muteTicks?: number
  onBeat?: boolean
  parryable?: boolean
  pierce?: number
  sfxHit?: string
  vfxHit?: string
  shake?: string
  loudness?: number
}

/** 兜底寿命：600 tick = 10 秒，射程与地面都漏不掉也不会常驻 */
const MAX_LIFE_TICKS = 600

export class ProjectileSystem {
  private items: Projectile[] = []
  private seq = 0

  get live(): number { return this.items.length }

  list(): readonly Projectile[] { return this.items }

  spawn(l: LaunchParams, tick: number): Projectile {
    const dl = Math.hypot(l.dir.x, l.dir.y, l.dir.z) || 1
    const k = l.speed / dl
    const p: Projectile = {
      id: ++this.seq,
      hostile: l.hostile,
      ownerId: l.ownerId,
      kind: l.kind,
      pos: { ...l.origin },
      vel: { x: l.dir.x * k, y: l.dir.y * k, z: l.dir.z * k },
      radius: l.radius,
      rangeLeft: l.range,
      gravity: l.gravity ?? 0,
      damage: l.damage,
      poise: l.poise,
      hitStopMs: l.hitStopMs,
      layers: l.layers ?? 0,
      pinTicks: l.pinTicks ?? 0,
      muteTicks: l.muteTicks ?? 0,
      onBeat: l.onBeat ?? false,
      parryable: l.parryable ?? true,
      hitsLeft: 1 + (l.pierce ?? 0),
      hitIds: new Set(),
      sfxHit: l.sfxHit ?? 'hit_flesh',
      vfxHit: l.vfxHit ?? 'hit_ring',
      shake: l.shake ?? 'normal',
      loudness: l.loudness ?? 4,
      dead: false,
      gone: null,
      bornTick: tick
    }
    this.items.push(p)
    return p
  }

  /** 直线/抛物线积分 + 射程与寿命到期；不做命中判定 */
  update(dt: number, tick: number): void {
    for (const p of this.items) {
      if (p.dead) continue
      if (p.gravity) p.vel.y -= p.gravity * dt
      const dx = p.vel.x * dt, dy = p.vel.y * dt, dz = p.vel.z * dt
      p.pos.x += dx; p.pos.y += dy; p.pos.z += dz
      p.rangeLeft -= Math.hypot(dx, dy, dz)
      if (p.rangeLeft <= 0) this.kill(p, 'range')
      else if (tick - p.bornTick > MAX_LIFE_TICKS) this.kill(p, 'expire')
    }
  }

  kill(p: Projectile, reason: GoneReason): void {
    if (p.dead) return
    p.dead = true
    p.gone = reason
  }

  /** 目标被弹体吃掉一个名额；名额用完才真正消失 */
  consume(p: Projectile, targetId: string): void {
    if (p.hitIds.has(targetId)) return
    p.hitIds.add(targetId)
    p.hitsLeft -= 1
    if (p.hitsLeft <= 0) this.kill(p, 'hit')
  }

  /** 移除已死弹体，并把「为什么消失」告诉调用方（表现/音效由上层决定） */
  reap(onGone: (p: Projectile, reason: GoneReason) => void): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i]
      if (!p.dead) continue
      this.items.splice(i, 1)
      onGone(p, p.gone ?? 'expire')
    }
  }

  /** 主人被流送回收/退役时，它发出的弹体不该继续追人 */
  withOwner(ownerId: string): Projectile[] {
    return this.items.filter((p) => p.ownerId === ownerId)
  }

  clear(): void { this.items.length = 0 }
}

/** 弹体 vs 靶球：球心对胶囊靶的粗测（hitTarget 已是逻辑层的统一靶形） */
export function sphereHits(p: Projectile, t: HitTarget): boolean {
  const cx = t.pos.x, cz = t.pos.z
  const cy = t.pos.y + t.height / 2
  return Math.hypot(p.pos.x - cx, p.pos.y - cy, p.pos.z - cz) <= p.radius + t.radius
}
