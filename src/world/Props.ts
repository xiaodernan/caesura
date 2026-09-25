/**
 * 可破坏场景物运行时（KI-023，§15.3 音刺）。
 * 本文件禁止 import three：命中靶位、耐久与破碎钩子全是纯逻辑；
 * 表现层（world/PropVisuals.ts）逐帧读状态，接线在胶水层（main.ts）。
 *
 * 与另外两类实体的分工——`Projectiles` 只管弹道、`EntityStats` 只管生物：
 * props 站在世界里、占一个命中靶位、有耐久计数，碎了有数据声明的后果。
 *
 * 两条裁决（§15.3 没写的格子，都记在 KI-023 行）：
 * 1. **只有重击家族（h/charged/战技）计次**，轻击敲上去只响一声不裂——设计写的是
 *    「重击 4 次击碎」，把它读成"任何一记都行"等于删掉这一格的重量语义；
 * 2. **props 与敌人共用同一次数预算**（`markActionHit`）："一击一名目标"对场地件同样成立，
 *    否则环形战技一记能把三根刺全部白嫖掉。
 */
import { bus } from '@/core/EventBus'
import type { PropRef, RegionData, Vec3 } from '@/data/schema'
import type { HitTarget } from '@/combat/HitShapes'

export interface Prop extends PropRef {
  regionId: string
  /** 还差几记重击碎（hitsToBreak 递减到 0 = 碎） */
  hitsLeft: number
}

/** 命中靶位的形状（灰盒期每类一个；正式资产来了换的是这张表，选择逻辑不动） */
const SHAPE: Record<PropRef['kind'], { radius: number; height: number }> = {
  soundspine: { radius: 0.9, height: 4.2 },
}

/** 击碎音效（必须都在 audio/synth.ts 的 SFX_KEYS 里，由 arch 测试闸门校验） */
const BREAK_SFX: Record<PropRef['kind'], string> = {
  soundspine: 'burst_shell',
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
      for (const p of r.props ?? []) this.items.push({ ...p, regionId: r.id, hitsLeft: p.hitsToBreak })
    }
  }

  get all(): readonly Prop[] { return this.items }

  /** 完好、且所属区域已解锁（与 Interactables 同一条门）才有被击中的资格 */
  hittable(p: Prop): boolean {
    return !this.broken.has(p.id) && this.open(p)
  }

  hitTarget(p: Prop): HitTarget {
    const s = SHAPE[p.kind]
    return { pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, facingYaw: 0, radius: s.radius, height: s.height }
  }

  /**
   * 挨了一记。heavyFamily=false 是轻击那一半：只敲响，不计数（裁决 1）。
   * 返回值给结算层记账用；声音与破碎钩子都从这里发，别处不重复。
   */
  chip(p: Prop, heavyFamily: boolean): 'chip' | 'clank' | 'none' {
    if (!this.hittable(p)) return 'none'
    if (!heavyFamily) {
      bus.emit('audio.sfx', { key: 'hit_metal', pos: { ...p.pos }, gain: 0.4 })
      return 'clank'
    }
    p.hitsLeft--
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

  /** 某类还剩几根完好的（KI-024 的场地阶段入口要读的就是这个数） */
  remainingByKind(kind: PropRef['kind']): number {
    return this.items.filter((p) => p.kind === kind && !this.broken.has(p.id)).length
  }

  /** 碎过的会跟着存档走（v8）：碎刺不可再生，读档不能白还一次破势窗 */
  snapshot(): string[] { return [...this.broken].sort() }
  restore(ids: string[] | null | undefined): void {
    this.broken = new Set(ids ?? [])
    // hitsLeft 与 broken 是同一事实的两面（表现层读的是前者）：restore 只同步一半，
    // 读档回来的碎刺就会带着满耐久立回去
    for (const p of this.items) if (this.broken.has(p.id)) p.hitsLeft = 0
  }

  private open(p: Prop): boolean {
    const r = this.regions.find((x) => x.id === p.regionId)
    return r ? this.isRegionOpen(r) : false
  }

  private breakProp(p: Prop): void {
    this.broken.add(p.id)
    bus.emit('audio.sfx', { key: BREAK_SFX[p.kind], pos: { ...p.pos }, gain: 1 })
    bus.emit('vfx.request', { key: 'death_shatter', pos: { x: p.pos.x, y: p.pos.y + 1.5, z: p.pos.z }, scale: 1.4 })
    bus.emit('vfx.request', { key: 'ring_dust', pos: { ...p.pos }, scale: 1.2 })
    if (p.breakLabel) bus.emit('ui.notify', { text: p.breakLabel, kind: 'boss' })
    bus.emit('world.propBroken', {
      id: p.id, kind: p.kind, regionId: p.regionId, pos: { ...p.pos },
      deafTarget: p.onBreakDeaf?.target, deafTicks: p.onBreakDeaf?.deafTicks,
    })
    bus.emit('log', { level: 'info', msg: `prop.broken ${p.id} (${p.kind}) left=${this.remainingByKind(p.kind)}` })
  }
}
