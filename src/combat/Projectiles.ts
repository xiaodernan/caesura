/**
 * 弹道子系统（docs/combat.md §4.3 投掷枪 / §5 远程威胁）——纯逻辑层，不 import three。
 * 职责边界：这里只做运动学与生命周期（积分、射程/寿命到期、穿透计数），
 * 命中判定与伤害结算留在 CombatManager（全场只有一条受击通道，见 combat.md §12）。
 */
import type { IncomingGrade } from '@/data/schema'
import type { Vec3 } from './EntityStats'
import type { HitTarget } from './HitShapes'

export type GoneReason = 'hit' | 'ground' | 'wall' | 'range' | 'expire'

export interface Projectile {
  id: number
  /** true = 敌人（或其他世界实体）射向玩家 */
  hostile: boolean
  ownerId: string
  kind: string
  pos: Vec3
  /**
   * 上一 tick 的位置（KI-014①）：遮挡判据量的是**这一 tick 走过的那一段**，不是"此刻在不在墙里"。
   * 采点的版本会漏掉一件事：一 tick 之内"穿过柱面并落在玩家身上"是可能的（弹速 28m/s ⇒ 每帧 0.47m，
   * 柱子半径 3.2m，所以漏的是"贴着柱边那一线"而不是整根柱子——小半径弹体与薄遮挡体会漏得更多）。
   * 扫掠段把"先碰到什么"变成判据本身，也顺带给出命中点（灰尘甩在哪）。
   * 就地改写、不每个 tick 造新对象（`update` 里是全场每枚弹体每帧一次的调用）。
   */
  prev: Vec3
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
  /**
   * §7.2 休止斩镜像到弹体：还有多少 tick 不推进。逐弹体记账而不是挂一个"世界冻结窗口"——
   * 冻结之后才射出来的弹体不该跟着冻结（它飞行的那段时间本来就全在停顿之后）。
   * 与 `Enemy.frozenTicks` 同一条口径：同一件事只有一格账，不发明第二个时钟源。
   */
  frozenTicks: number
  sfxHit: string
  vfxHit: string
  shake: string
  /**
   * §8 反应分级：这一发打在谁身上算哪一档（KI-052① 给玩家投掷那一条腿，②给敌方弹体那一条）。
   * 玩家弹体带的是出手那一格的帧声明；敌方弹体带的是 `AttackSpec.reaction`——
   * 两边都走这一格，"离手之后才落"的那一记才算得上仍然带着自己那一档。
   */
  reaction?: IncomingGrade
  /**
   * §14.4 那句「骗翻滚后硬直 0.6s」跟着弹体走的那一格（KI-085）：非 null ⇒ 这一发是诱饵，
   * 玩家用无敌帧把它吃掉就要在翻滚结束时欠下这么多毫秒硬直。只有敌方连发的指定那发带它；
   * 反射体不带（玩家弹回去的那一发已经不是她的诱饵了）。
   */
  feintPunishMs?: number
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
  /** §8 反应分级：出手方那一格/那一行的声明，原样带到命中点（KI-052①②） */
  reaction?: IncomingGrade
  /** §14.4 诱饵惩罚（KI-085）：这一发是假动作时带来时的硬直毫秒数；见 `Projectile.feintPunishMs` */
  feintPunishMs?: number
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
      prev: { ...l.origin },
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
      frozenTicks: 0,
      sfxHit: l.sfxHit ?? 'hit_flesh',
      vfxHit: l.vfxHit ?? 'hit_ring',
      shake: l.shake ?? 'normal',
      reaction: l.reaction,
      feintPunishMs: l.feintPunishMs,
      loudness: l.loudness ?? 4,
      dead: false,
      gone: null,
      bornTick: tick
    }
    this.items.push(p)
    return p
  }

  /** 直线/抛物线积分 + 射程与寿命到期；不做命中判定，也不做遮挡判定（遮挡要这一段的两端点，见 CombatManager） */
  update(dt: number, tick: number): void {
    for (const p of this.items) {
      if (p.dead) continue
      // 先记账再动：`prev → pos` 这一段就是"这一 tick 走过来的路"，冻结时它是零长段（不假装动过）
      p.prev.x = p.pos.x; p.prev.y = p.pos.y; p.prev.z = p.pos.z
      // §7.2 休止斩：时间没过的话，路程和寿命也一样没过——所以这一行在积分**之前**，
      // 而不是只把 dx/dy/dz 置零。它只停运动学，不停命中判定（判定在 CombatManager，
      // 一记停在半空的弹体是个看得见的障碍物，撞上去照样挨打）。
      if (p.frozenTicks > 0) { p.frozenTicks--; continue }
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
