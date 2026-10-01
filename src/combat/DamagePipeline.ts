import type { AttrKey } from '@/data/schema'

export interface DamageRequest {
  base: number                       // the move's frames.damage from movesets.json (KI-047: the ONLY damage base; combo/upgrade-adjusted by caller)
  attrs?: Partial<Record<AttrKey, number>>
  scaling?: Partial<Record<AttrKey, number>>
  defense: number
  ranged?: boolean
  backstab?: boolean
  /**
   * 背刺倍率（KI-023 收尾批）：默认 2.0（§5.4）。无鸣的 `crit.backstab3.5` 由武器标签解析后
   * 从这里进来——「背刺倍率再 +泛音×0.1%」那条隐藏天花板暂时仍是 3.5 定值（V2 数值批再动）。
   */
  backstabMul?: number
  weakpoint?: boolean
  onBeat?: boolean
  poiseBreakTarget?: boolean         // crumpled -> true damage execution channel (caller handles)
  rawDamage?: number                 // executions/fissure burst bypass DR
  variance?: number                  // 0..1; 0 disables
  /**
   * 暴击（Phase 5-B，progression.md §2.1 泛音）：概率来自「泛音」属性 + 装备词缀。
   * 只对**玩家出手**有意义——敌人没有暴击属性，也不该有（Boss 的难度来自机制而非随机倍率）。
   */
  critRate?: number
  critMul?: number
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
  if (req.backstab) dmg *= req.backstabMul ?? 2.0
  if (req.weakpoint) dmg *= 1.8
  let crit = req.backstab === true || req.weakpoint === true
  if (req.critRate && req.critRate > 0 && rand() < req.critRate) {
    dmg *= req.critMul ?? 1.35
    crit = true
  }
  return { damage: Math.max(1, Math.round(dmg)), crit }
}

export function comboStageMul(stageIndex: number, isFinal: boolean): number {
  return isFinal ? 1.0 : 0.95
}
