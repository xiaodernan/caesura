/**
 * 可破坏场景物运行时（KI-023，§15.3 音刺；KI-022②，§15.2 Finale 振源核）。
 * 本文件禁止 import three：命中靶位、耐久与破碎钩子全是纯逻辑；
 * 表现层（world/PropVisuals.ts）逐帧读状态，接线在胶水层（main.ts）。
 *
 * 与另外两类实体的分工——`Projectiles` 只管弹道、`EntityStats` 只管生物：
 * props 站在世界里、占一个命中靶位、有耐久计数，碎了有数据声明的后果。
 * 两类耐久模型：
 * - **计数型**（音刺 `hitsToBreak`）：重击家族计次，轻击只敲响（§15.3「重击 4 次」的重量语义）；
 * - **血量型**（振源核 `hpFracOfBoss`）：任何一记都按原始伤害扣池子，外露的器官没有甲——
 *   打在核上的每一分**原样变成对 `damageTarget` 的真伤**（`world.propDamaged` 事件，
 *   AISystem 落账），池子打空 = 核碎。§15.2「外露可处决件，每个 18% HP」的机制读法：
 *   核就是她露在场地上的血条，DPS 竞速的赛道。
 *
 * 第三条裁决：**props 与敌人共用同一次数预算**（`markActionHit`）——"一击一名目标"
 * 对场地件同样成立，否则环形战技一记能把所有场地件全部白嫖掉。
 */
import { bus } from '@/core/EventBus'
import type { PropRef, RegionData, Vec3 } from '@/data/schema'
import type { HitTarget } from '@/combat/HitShapes'

export interface Prop extends PropRef {
  regionId: string
  /** 计数型：还差几记重击碎 */
  hitsLeft?: number
  /** 血量型：池子剩余（首次被击中时按 bossQuery 的 hpMax 物化） */
  hpLeft?: number
  /** 血量型：池子总量（物化后可读；表现层画血条用） */
  hpPool?: number
}

/** 命中靶位的形状（灰盒期每类一个；正式资产来了换的是这张表，选择逻辑不动） */
const SHAPE: Record<PropRef['kind'], { radius: number; height: number }> = {
  soundspine: { radius: 0.9, height: 4.2 },
  resonance_core: { radius: 1.1, height: 1.6 },
}

/** 击碎音效（必须都在 audio/synth.ts 的 SFX_KEYS 里，由 arch 测试闸门校验） */
const BREAK_SFX: Record<PropRef['kind'], string> = {
  soundspine: 'burst_shell',
  resonance_core: 'chord_slam',
}

/** Boss 现状查询（组合根注入）：`exposedWhen` 与血量池的物化都靠它；null = 场上没有 props */
export interface BossQueryResult {
  hpMax: number
  phase: number
  alive: boolean
}

export class PropSystem {
  private readonly items: Prop[] = []
  /** 碎过的 id 集合。restore 会整组替换（读档），所以不能 readonly */
  private broken = new Set<string>()

  constructor(
    private readonly regions: readonly RegionData[],
    private readonly isRegionOpen: (r: RegionData) => boolean = () => true,
  ) {
    for (const r of regions) {
      for (const p of r.props ?? []) {
        const prop: Prop = { ...p, regionId: r.id }
        if (p.hitsToBreak !== undefined) prop.hitsLeft = p.hitsToBreak
        this.items.push(prop)
      }
    }
  }

  /**
   * Boss 现状（数据 id → 阶段/血量上限/活没活）。血量型 prop 与 `exposedWhen` 的裁判。
   * 注入而非 import：world 层不认识 AISystem，组合根才知道它们怎么连。
   */
  bossQuery: ((dataId: string) => BossQueryResult | null) | null = null

  get all(): readonly Prop[] { return this.items }

  /** 外露判定（只看 `exposedWhen` 那一格，不含区域/破碎）——表现层按它决定画不画 */
  isExposed(p: Prop): boolean {
    if (!p.exposedWhen) return true
    const b = this.bossQuery?.(p.exposedWhen.bossId)
    return !!b && b.alive && b.phase >= p.exposedWhen.minPhase
  }

  /** 完好、所属区域已解锁（与 Interactables 同一条门）、且（若声明了）此刻外露 */
  hittable(p: Prop): boolean {
    if (this.broken.has(p.id)) return false
    if (!this.open(p)) return false
    return this.isExposed(p)
  }

  hitTarget(p: Prop): HitTarget {
    const s = SHAPE[p.kind]
    return { pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, facingYaw: 0, radius: s.radius, height: s.height }
  }

  /**
   * 挨了一记。计数型：heavyFamily=false 是轻击那一半，只敲响不计数（裁决 2）。
   * 血量型：任何一记都按 `rawDamage` 扣池子（外露器官无甲），同时广播真伤转移。
   * 返回值给结算层记账用；声音与破碎钩子都从这里发，别处不重复。
   */
  hitProp(p: Prop, opts: { heavyFamily: boolean; rawDamage?: number }): 'chip' | 'clank' | 'none' {
    if (!this.hittable(p)) return 'none'
    if (p.hpFracOfBoss !== undefined) {
      const boss = this.bossQuery?.(p.damageTarget ?? '')
      if (!boss) return 'none'
      // 池子懒物化：数据只写比例，绝对值从**当前那只 Boss**的 hpMax 来（§55：不写第二份血量）
      if (p.hpPool === undefined) {
        p.hpPool = Math.max(1, Math.round(boss.hpMax * p.hpFracOfBoss))
        p.hpLeft = p.hpPool
      }
      const dmg = Math.max(1, Math.round(opts.rawDamage ?? 1))
      p.hpLeft = Math.max(0, (p.hpLeft ?? 0) - dmg)
      bus.emit('world.propDamaged', { id: p.id, kind: p.kind, damageTarget: p.damageTarget, amount: dmg, pos: { ...p.pos } })
      bus.emit('audio.sfx', { key: 'hit_metal', pos: { ...p.pos }, gain: 0.7 })
      if (p.hpLeft > 0) {
        bus.emit('vfx.request', { key: 'impact_sparks', pos: { x: p.pos.x, y: p.pos.y + 1, z: p.pos.z }, scale: 0.8 })
        return 'chip'
      }
      this.breakProp(p)
      return 'chip'
    }
    // 计数型（音刺）
    if (!opts.heavyFamily) {
      bus.emit('audio.sfx', { key: 'hit_metal', pos: { ...p.pos }, gain: 0.4 })
      return 'clank'
    }
    p.hitsLeft = (p.hitsLeft ?? 1) - 1
    if (p.hitsLeft > 0) {
      bus.emit('audio.sfx', { key: 'hit_metal', pos: { ...p.pos }, gain: 0.7 })
      bus.emit('vfx.request', { key: 'impact_sparks', pos: { x: p.pos.x, y: p.pos.y + 2, z: p.pos.z }, scale: 0.8 })
      return 'chip'
    }
    this.breakProp(p)
    return 'chip'
  }

  /**
   * §15.3 汇聚噪音：范围内的玩家声源「听上去发生在刺上」——她会去刺的位置找你，
   * 而不是你的真实站位。这是「音刺在场=环境干扰器」的机制读法，也是深窖潜行的
   * 地形规则：贴着刺走路，全场的耳朵都朝着刺（AISystem 把玩家声源重定向前的最后一站）。
   */
  sinkNoise(src: { pos: Vec3; loudness: number }): { pos: Vec3; loudness: number } | null {
    let best: Prop | null = null
    let bestD = Infinity
    for (const p of this.items) {
      if (p.kind !== 'soundspine' || this.broken.has(p.id) || !p.gatherRadius || !this.open(p)) continue
      const d = Math.hypot(src.pos.x - p.pos.x, src.pos.z - p.pos.z)
      if (d <= p.gatherRadius && d < bestD) { bestD = d; best = p }
    }
    if (!best) return null
    return { pos: { x: best.pos.x, y: best.pos.y, z: best.pos.z }, loudness: src.loudness }
  }

  /** 某类还剩几件**已外露**的（KI-024 的场地阶段入口读它；没外露的核不存在，不计） */
  remainingByKind(kind: PropRef['kind']): number {
    return this.items.filter((p) => p.kind === kind && !this.broken.has(p.id) && this.hittable(p)).length
  }

  /** 碎过的会跟着存档走（v8）：碎刺不可再生，读档不能白还一次破势窗 */
  snapshot(): string[] { return [...this.broken].sort() }
  restore(ids: string[] | null | undefined): void {
    this.broken = new Set(ids ?? [])
    // hitsLeft/hpLeft 与 broken 是同一事实的两面（表现层读的是它们）：restore 只同步一半，
    // 读档回来的碎件就会带着满耐久立回去
    for (const p of this.items) {
      if (!this.broken.has(p.id)) continue
      if (p.hitsLeft !== undefined) p.hitsLeft = 0
      if (p.hpPool !== undefined) p.hpLeft = 0
    }
  }

  private open(p: Prop): boolean {
    const r = this.regions.find((x) => x.id === p.regionId)
    return r ? this.isRegionOpen(r) : false
  }

  private breakProp(p: Prop): void {
    this.broken.add(p.id)
    bus.emit('audio.sfx', { key: BREAK_SFX[p.kind], pos: { ...p.pos }, gain: 1 })
    // §13.0「听觉 Sound」的「破坏」通道（KI-016 收尾）：碎裂的响进声场——
    // 归因玩家（只有玩家能碎东西）、位置在碎片处；听见的人会来查看。
    bus.emit('sound.source', { id: 'player', pos: { ...p.pos }, loudness: p.breakLoudness ?? 0.9 })
    bus.emit('vfx.request', { key: 'death_shatter', pos: { x: p.pos.x, y: p.pos.y + 1, z: p.pos.z }, scale: 1.4 })
    bus.emit('vfx.request', { key: 'ring_dust', pos: { ...p.pos }, scale: 1.2 })
    if (p.breakLabel) bus.emit('ui.notify', { text: p.breakLabel, kind: 'boss' })
    bus.emit('world.propBroken', {
      id: p.id, kind: p.kind, regionId: p.regionId, pos: { ...p.pos },
      deafTarget: p.onBreakDeaf?.target, deafTicks: p.onBreakDeaf?.deafTicks,
    })
    bus.emit('log', { level: 'info', msg: `prop.broken ${p.id} (${p.kind}) left=${this.remainingByKind(p.kind)}` })
  }
}
