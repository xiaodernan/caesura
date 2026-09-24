import { TICK_HZ } from '@/core/Time'
import { clamp } from '@/core/Math'
import type { PlayerBaseData } from '@/data/schema'

export interface Vec3 { x: number; y: number; z: number }

export interface StaminaRegenModel {
  hardDelay: number; slowPerSec: number; slowTicks: number; fastPerSec: number
}

/**
 * §11 震裂的两段式节奏：`idleTicks` 内没有新增 → 之后每 `decayEveryTicks` 掉一层。
 * 这三个数**不在这里写**：它们来自 `data/json/statuses.json`，由 `combat/Statuses.ts:armStats()`
 * 在构造方（Enemy / PlayerController）挂上。留着 null 就是"这具 stats 没被武装过"。
 */
export interface FissureRules {
  maxLayers: number
  idleTicks: number
  decayEveryTicks: number
}

/** shared stat block for player and enemies (GAS-lite, docs/technical-architecture.md §1.2) */
export class EntityStats {
  hp: number
  hpMax: number
  stamina: number
  staMax: number
  poiseMax: number
  poiseAccum = 0
  private lastHitTick = -9999
  crumpleTicksLeft = 0
  /**
   * §8 R4 那一行的时长（tick）。由构造方经 `combat/Reactions.ts:armCrumple()` 从
   * `data/json/reactions.json` 上弦（普通 1.8s / Boss 2.4s）；null＝没上弦 ⇒ `addPoise` 抛。
   */
  crumpleTicks: number | null = null
  overdrive = 0
  overdriveMax = 10
  private lastCostTick = -9999
  muteTicksLeft = 0
  /** §11 震裂层数。承伤/碎裂的系数不在这里——那是 CombatManager 读 statuses.json 时算的 */
  fissureLayers = 0
  /** 由 combat/Statuses.ts 的 armStats() 挂上；null ⇒ 这只实体不参与状态系统 */
  fissureRules: FissureRules | null = null
  /** 闷音期间的体力回复乘数（§11 的 -30% 就是这里的 0.7）。同样由 armStats() 从数据写入 */
  muteRegenMul = 1
  private fissureCountdown = 0
  private fissureDecaying = false
  dead = false
  defense = 0
  regen: StaminaRegenModel
  /** multiplier stack (refrein buff etc): dmgMul, attackSpeedMul */
  mods = { dmgMul: 1, staCostMul: 1, regenMul: 1 }

  constructor(hp: number, stamina: number, poise: number, regen?: StaminaRegenModel) {
    this.hp = this.hpMax = hp
    this.stamina = this.staMax = stamina
    this.poiseMax = poise
    this.regen = regen ?? { hardDelay: 30, slowPerSec: 22, slowTicks: 72, fastPerSec: 38 }
  }

  spendStamina(amount: number, tick: number): boolean {
    const cost = amount * this.mods.staCostMul
    if (this.stamina < cost) return false
    this.stamina -= cost
    this.lastCostTick = tick
    return true
  }

  addPoise(dmg: number, tick: number): boolean {
    this.poiseAccum += dmg
    this.lastHitTick = tick
    if (this.poiseAccum >= this.poiseMax && this.crumpleTicksLeft <= 0) {
      // 破势时长来自 §8 R4 那一行：没上弦就是构造方漏了 armCrumple——那要抛，
      // 静默免疫破势会让 Boss 的架势条变成摆设（同 `addFissure` 的纪律）。
      if (this.crumpleTicks === null) throw new Error('EntityStats.addPoise: 未 arm —— §8 R4 的破势时长来自 data/json/reactions.json，构造方必须调用 combat/Reactions.ts 的 armCrumple(stats, isBoss)')
      this.crumpleTicksLeft = this.crumpleTicks
      this.poiseAccum = 0
      return true
    }
    return false
  }

  damage(amount: number): number {
    this.hp = clamp(this.hp - amount, 0, this.hpMax)
    if (this.hp <= 0) this.dead = true
    return this.hp
  }

  heal(amount: number): void { this.hp = clamp(this.hp + amount, 0, this.hpMax) }

  update(dt: number, tick: number, guarding = false): void {
    if (this.crumpleTicksLeft > 0) this.crumpleTicksLeft--
    if (this.muteTicksLeft > 0) this.muteTicksLeft--
    if (tick - this.lastHitTick > 72 && this.poiseAccum > 0) {
      this.poiseAccum = Math.max(0, this.poiseAccum - (12 / TICK_HZ) * (dt * TICK_HZ))
    }
    if (this.stamina < this.staMax) {
      const since = tick - this.lastCostTick
      let rate = since > this.regen.slowTicks ? this.regen.fastPerSec : this.regen.slowPerSec
      if (since <= this.regen.hardDelay) rate = 0
      if (guarding) rate = Math.min(rate, 5)
      if (this.muteTicksLeft > 0) rate *= this.muteRegenMul
      this.stamina = clamp(this.stamina + rate * (this.mods.regenMul * dt), 0, this.staMax)
    }
    if (this.fissureLayers > 0 && this.fissureRules) {
      if (--this.fissureCountdown <= 0) {
        this.fissureLayers--
        // 掉到空 ⇒ 回到「先安静 10s 才开始掉」的第一段，下一层要重新攒计时
        this.fissureDecaying = this.fissureLayers > 0
        this.fissureCountdown = this.fissureRules.decayEveryTicks
      }
    }
  }

  /**
   * 叠震裂。返回 true = 顶满层（碎裂由调用方结算：真伤与架势都是数据）。
   * 没武装就叠层是接线错误，不是"这只怪免疫震裂"——所以抛，不静默。
   */
  addFissure(layers: number): boolean {
    const r = this.fissureRules
    if (!r) throw new Error('EntityStats.addFissure: 未 arm —— 震裂的层数上限/衰减节奏来自 data/json/statuses.json，构造方必须调用 combat/Statuses.ts 的 armStats(stats)')
    if (layers <= 0) return false
    this.fissureLayers = Math.min(r.maxLayers, this.fissureLayers + layers)
    // 「10s 内没有新增」→ 掉第一层 → 之后每 2s 一层。新增加进来会打断正在进行的逐层衰减。
    this.fissureCountdown = this.fissureDecaying ? r.decayEveryTicks : r.idleTicks
    if (this.fissureLayers >= r.maxLayers) {
      this.fissureLayers = 0
      this.fissureDecaying = false
      return true
    }
    return false
  }
}

export function playerStatsFrom(base: PlayerBaseData): EntityStats {
  return new EntityStats(base.hp, base.stamina, base.poise, base.staminaRegen)
}
