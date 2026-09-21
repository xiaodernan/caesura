import { TICK_HZ } from '@/core/Time'
import { clamp } from '@/core/Math'
import type { PlayerBaseData } from '@/data/schema'

export interface Vec3 { x: number; y: number; z: number }

export interface StaminaRegenModel {
  hardDelay: number; slowPerSec: number; slowTicks: number; fastPerSec: number
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
  overdrive = 0
  overdriveMax = 10
  private lastCostTick = -9999
  muteTicksLeft = 0
  fissureLayers = 0
  private fissureDecayLeft = 0
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
      this.crumpleTicksLeft = 108
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
      if (this.muteTicksLeft > 0) rate *= 0.7
      this.stamina = clamp(this.stamina + rate * (this.mods.regenMul * dt), 0, this.staMax)
    }
    if (this.fissureLayers > 0) {
      this.fissureDecayLeft--
      if (this.fissureDecayLeft <= 0) {
        this.fissureLayers--
        this.fissureDecayLeft = 10 * TICK_HZ
      }
    }
  }

  addFissure(layers: number): boolean {
    this.fissureLayers = Math.min(5, this.fissureLayers + layers)
    this.fissureDecayLeft = 10 * TICK_HZ
    if (this.fissureLayers >= 5) { this.fissureLayers = 0; return true }
    return false
  }
}

export function playerStatsFrom(base: PlayerBaseData): EntityStats {
  return new EntityStats(base.hp, base.stamina, base.poise, base.staminaRegen)
}
