import { registry } from '@/core/Registry'
import type { AttrKey, ProgressionData, OriginData } from '@/data/schema'

/**
 * 音级（Rank）· 遗响（Resonance）· 音级点（Pitch Point）· 六音级属性（progression.md §2）。
 *
 * 全部系数来自 `data/json/progression.json`：这里只做乘加，不写任何一个数值常数
 * （需求 §55）。软上限的意义是「第 41 点基音仍然有用，但只有半点」——收益递减而不断崖，
 * 这样「把一维堆到 99」依然是一种 build，只是不再是唯一的 build。
 */

export const ATTR_KEYS: AttrKey[] = ['str', 'dex', 'ton', 'vig', 'ovr', 'fis']

export interface DerivedStats {
  hpMax: number
  staminaMax: number
  poiseMax: number
  /** Σ护甲 DEF（含强化）+ 腔体加成；不含 DR 换算（DR 在伤害管线里算） */
  defense: number
  /** 负重上限（kg）；超出 ⇒ 翻滚/疾跑禁用 + 体力回复 -40%（§5.1） */
  loadMax: number
  critRate: number
  critMul: number
  overdriveMax: number
  /** 处决/背刺伤害乘数（泛音加成，§2.1） */
  execMul: number
  /**
   * §2.1 失谐的两条收益（Phase 5-C1 起有消费方：CombatManager 的震裂/碎裂/回响，
   * 以及 main.ts 每 tick 的环境失谐暴露）。
   */
  statusPowerMul: number
  corruptionResistMul: number
}

export interface ResonanceGain {
  levels: number
  ranks: number[]
  /** 到达 maxRank 后溢出的遗响（不丢弃，UI 可提示"已抵达音级上限"） */
  overflow: number
}

export function progressionData(): ProgressionData {
  return registry.get<ProgressionData>('progression')
}

export function originOf(id: string): OriginData {
  const o = progressionData().origins.find((x) => x.id === id)
  if (!o) throw new Error(`Progression: unknown origin "${id}"`)
  return o
}

/** 出身六维合计必须一致，否则「定弦只改分布」这条设计承诺就是假的（§2.2） */
export function originTotal(o: OriginData): number {
  return ATTR_KEYS.reduce((s, k) => s + o.attrs[k], 0)
}

export class Progression {
  rank = 1
  /** 当前音级内已攒的遗响；升级时扣掉本级的额度，余量结转（不会吞掉玩家的溢出） */
  xp = 0
  /** 未分配的音级点 */
  unspent = 0
  attrs: Record<AttrKey, number>
  originId: string
  /** 洗点次数（前 3 次 8 折，§8.3） */
  respecCount = 0

  constructor(originId = 'origin_tuner') {
    this.originId = originId
    this.attrs = { ...originOf(originId).attrs }
  }

  get data(): ProgressionData { return progressionData() }

  /** 升到下一级所需遗响；已到上限返回 null */
  xpToNext(): number | null {
    if (this.rank >= this.data.maxRank) return null
    return this.data.rankCurve.find((r) => r.rank === this.rank + 1)?.xp ?? null
  }

  /**
   * 吸收遗响。一次给一大笔（Boss 首杀 400）时允许连升多级——循环里逐级扣额度，
   * 而不是「先判断能不能升一级再决定收不收」，否则大额奖励会被静默吞掉。
   */
  addResonance(amount: number): ResonanceGain {
    const out: ResonanceGain = { levels: 0, ranks: [], overflow: 0 }
    if (amount <= 0) return out
    this.xp += amount
    for (;;) {
      const need = this.xpToNext()
      if (need === null) break
      if (this.xp < need) break
      this.xp -= need
      this.rank++
      this.unspent++
      out.levels++
      out.ranks.push(this.rank)
    }
    if (this.rank >= this.data.maxRank) {
      out.overflow = this.xp
      this.xp = 0
    }
    return out
  }

  allocate(attr: AttrKey): boolean {
    if (this.unspent <= 0) return false
    this.attrs[attr]++
    this.unspent--
    return true
  }

  /** 洗点：退回全部已分配点 + 出身点之外的投入。花费由调用方（经济层）付出 */
  respecCost(): number {
    const r = this.data.respec
    const spent = ATTR_KEYS.reduce((s, k) => s + this.attrs[k], 0) - originTotal(originOf(this.originId))
    let cost = r.base + Math.max(0, spent) * r.perPoint
    if (this.respecCount < r.discountTimes) cost *= r.discountMul
    return Math.round(cost)
  }

  /** 把已分配的点全部收回成未分配点（出身底子不动） */
  respec(): number {
    const base = originOf(this.originId).attrs
    let refunded = 0
    for (const k of ATTR_KEYS) {
      refunded += Math.max(0, this.attrs[k] - base[k])
      this.attrs[k] = base[k]
    }
    this.unspent += refunded
    this.respecCount++
    return refunded
  }

  /**
   * 软上限折算后的有效属性值（§2.1：软上限后每点收益减半，硬上限后 ×0.25）。
   * 伤害标尺（weapons.json 的 scaling）消费的是这个折算值，不是面板值——
   * 否则「面板 60 点基音」会说谎：它看起来是 60，实际只当 40+…用。
   */
  effectiveAttr(attr: AttrKey, value = this.attrs[attr]): number {
    const meta = this.data.attrs.find((a) => a.key === attr)
    if (!meta) return value
    const soft = meta.softcap
    const hard = meta.hardcap
    if (value <= soft) return value
    const mid = Math.min(value, hard) - soft
    const over = Math.max(0, value - hard)
    return soft + mid * this.data.softcap.mul + over * this.data.softcap.hardMul
  }

  effectiveAttrs(): Record<AttrKey, number> {
    const out = {} as Record<AttrKey, number>
    for (const k of ATTR_KEYS) out[k] = this.effectiveAttr(k)
    return out
  }

  /** 派生值（§2.4）。护甲的 DEF 由 Equipment 汇总后传进来——这里不认识"装备"这个概念。 */
  derive(armorDef = 0): DerivedStats {
    const d = this.data.derived
    const a = this.attrs
    const sum = (per: Partial<Record<AttrKey, number>>): number =>
      ATTR_KEYS.reduce((s, k) => s + (per[k] ?? 0) * a[k], 0)
    const c = d.crit
    /**
     * 失谐的两条收益（§2.1）。这里**刻意用软上限折算后的点数**而不是面板值：一个 60 点失谐的
     * build 面板上写着 60，实际只当 50 用——异常强度也必须按"实际当多少"结算，否则面板就在说谎。
     */
    const fis = this.effectiveAttr('fis')
    return {
      hpMax: Math.round(d.hp.base + sum(d.hp.per) + d.hp.perRank * this.rank),
      staminaMax: Math.round(d.stamina.base + sum(d.stamina.per)),
      poiseMax: Math.round(d.poise.base + sum(d.poise.per)),
      defense: Math.round(armorDef + a.vig * d.defensePerVig),
      loadMax: Math.round(d.load.base + d.load.perStr * a.str),
      critRate: Math.min(c.cap, c.base + a.ovr * c.perOvr),
      critMul: c.mulBase + a.ovr * c.mulPerOvr,
      overdriveMax: Math.min(d.overdrive.cap, d.overdrive.base + Math.floor(a.ton / d.overdrive.perTonDiv)),
      execMul: 1 + a.ovr * d.execMulPerOvr,
      statusPowerMul: 1 + fis * d.status.perFisPower,
      corruptionResistMul: Math.max(d.status.toleranceFloor, 1 - fis * d.status.perFisTolerance)
    }
  }

  /** 里程碑（§8.2）：升级时告诉玩家"你新能做什么"，而不是只跳一个数字 */
  milestoneAt(rank: number): { rank: number; id: string; label: string } | null {
    return this.data.milestones.find((m) => m.rank === rank) ?? null
  }

  snapshot(): { rank: number; xp: number; unspent: number; attrs: Record<AttrKey, number>; originId: string; respecCount: number } {
    return { rank: this.rank, xp: this.xp, unspent: this.unspent, attrs: { ...this.attrs }, originId: this.originId, respecCount: this.respecCount }
  }

  restore(s: { rank: number; xp: number; unspent: number; attrs: Record<AttrKey, number>; originId?: string; respecCount?: number }): void {
    if (s.originId) this.originId = s.originId
    this.rank = s.rank
    this.xp = s.xp
    this.unspent = s.unspent
    this.attrs = { ...s.attrs }
    this.respecCount = s.respecCount ?? 0
  }
}
