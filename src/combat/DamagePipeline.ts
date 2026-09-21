import type { AttrKey } from '@/data/schema'

export interface DamageRequest {
  base: number                       // weapon atkBase (already combo-adjusted by caller)
  attrs?: Partial<Record<AttrKey, number>>
  scaling?: Partial<Record<AttrKey, number>>
  defense: number
  ranged?: boolean
  backstab?: boolean
  weakpoint?: boolean
  onBeat?: boolean
  poiseBreakTarget?: boolean         // crumpled -> true damage execution channel (caller handles)
  rawDamage?: number                 // executions/fissure burst bypass DR
  variance?: number                  // 0..1; 0 disables
}

export interface DamageResult {
  damage: number
  crit: boolean
}

const DR_CAP = 0.55

export function attrScale(req: DamageRequest): number {
  if (!req.attrs || !req.scaling) return 1
  let sum = 0
  for (const k of Object.keys(req.scaling) as AttrKey[]) {
    sum += (req.attrs[k] ?? 0) * (req.scaling[k] ?? 0)
  }
  return 1 + sum / 100
}

export function damageReduction(defense: number, ranged: boolean | undefined): number {
  let dr = defense / (defense + 120)
  if (ranged) dr *= 0.6
  return Math.min(dr, DR_CAP)
}

/**
 * docs/combat.md §12:
 * final = base * wScale * rand(0.95,1.05) * (1-DR); backstab/weakpoint multiply; onBeat doubles poise only (caller).
 * rng: pass a seeded rng float() for determinism in tests.
 */
export function resolveDamage(req: DamageRequest, rand: () => number): DamageResult {
  if (req.rawDamage !== undefined) return { damage: Math.max(1, req.rawDamage), crit: false }
  const v = req.variance ?? 0.1
  const mul = 1 - v / 2 + rand() * v
  let dmg = req.base * attrScale(req) * mul * (1 - damageReduction(req.defense, req.ranged))
  if (req.backstab) dmg *= 2.0
  if (req.weakpoint) dmg *= 1.8
  return { damage: Math.max(1, Math.round(dmg)), crit: req.backstab === true || req.weakpoint === true }
}

export function comboStageMul(stageIndex: number, isFinal: boolean): number {
  return isFinal ? 1.0 : 0.95
}
