/** All timing in logic ticks (1 tick = 1/60 s). See docs/technical-architecture.md §3. */

export interface HitboxCone { shape: 'cone'; angleDeg: number; radius: number; height: number; offsetY: number }
export interface HitboxSphere { shape: 'sphere'; radius: number; offsetY: number; offsetFwd: number }
export interface HitboxRing { shape: 'ring'; inner: number; outer: number; forward: number }
export type Hitbox = HitboxCone | HitboxSphere | HitboxRing

export interface CancelRule { to: string; fromTick: number }

export interface FrameData {
  startup: number
  activeStart: number
  activeEnd: number
  recovery: number
  damage: number
  stamina: number
  poise: number
  hitStopMs: number
  hitbox?: Hitbox
  lunge?: number
  shake?: 'graze' | 'normal' | 'heavy' | 'boss'
  sfx?: string[]
  vfx?: string[]
  loudness?: number
  beatQuant?: number[]
  flags?: string[]
  next?: string
  skillTag?: string
}

export interface MovesetData {
  id: string
  actions: Record<string, FrameData>
}

export interface WeaponData {
  id: string
  nameKey: string
  archetype: 'straight_sword' | 'greatsword' | 'spear' | 'bow' | 'staff' | 'unique'
  movesetId: string
  atkBase: number
  scaling: Partial<Record<AttrKey, number>>
  swingTag: string[]
  skill: string
  poiseMul?: number
  noiseMul?: number
}

export type AttrKey = 'str' | 'dex' | 'ton' | 'vig' | 'ovr' | 'fis'

export interface AttackSpec {
  id: string
  frames: FrameData
  beat: number[]
  parryable: boolean
  reaction?: 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5'
  statusOnHit?: { tag: string; layers: number }
}

export interface EnemyData {
  id: string
  nameKey: string
  archetype: 'basic' | 'heavy' | 'ranged' | 'assassin' | 'support' | 'elite' | 'miniboss' | 'boss'
  hp: number
  poise: number
  speed: number
  defense?: number
  ai: {
    vision: { range: number; fovDeg: number }
    vibration: { range: number }
    hearing: { range: number }
    distBands: { min: number; max: number; actions: string[] }[]
    retreatHpFrac?: number
    callAlly?: { range: number; broadcastTicks: number }
    buffAura?: { range: number; attackSpeedMul: number; dmgMul: number }
    deaf?: boolean
    eyes?: boolean
  }
  attacks: AttackSpec[]
  weakpoint?: { dmgMul: number }
  drops?: { tableId: string; chance: number }[]
  body?: { scale: number; color: number; emissive: number; coreColor: number }
  tint?: string
}

/** combat.md §5.4 Execute/Backstab tunables (all timing in ticks) */
export interface ExecutionConfig {
  /** A/B: maxHP*hpFrac + flat (true damage) */
  hpFrac: number
  flat: number
  /** vs Boss: fraction decays per repeat, flat suppressed */
  bossFracs: number[]
  /** B: basic enemy at/below this hpFrac dies silently instead of backstab animation */
  stealthKillFrac: number
  backstabConeDeg: number
  backstabRange: number
  /** A/C: front execute reach on a broken/stalled target */
  crumpleRange: number
  /** C: 休止处决 costs this much overdrive */
  overdriveCost: number
  overdriveFrac: number
  overdriveFlat: number
  /** input-lock + invulnerability montage window */
  durationTicks: number
  firstBladeHitStopMs: number
}

export interface PlayerBaseData {
  hp: number
  stamina: number
  poise: number
  defense: number
  moveSpeed: number
  sprintSpeed: number
  sprintCostPerSec: number
  jumpSpeed: number
  gravity: number
  staminaRegen: { hardDelay: number; slowPerSec: number; slowTicks: number; fastPerSec: number }
  guard: { startupTicks: number; reduction: number; staPerDmg: number; bleedPoiseFrac: number }
  perfectBlockWindow: number
  parry: { activeTicks: number; whiffRecovery: number; poiseDamage: number; stunTicks: number; overdriveGain: number }
  roll: { total: number; iframeStart: number; iframeEnd: number; dist: number; backDist: number; stamina: number; lockOnDist: number; lockOnIframes: [number, number] }
  execution: ExecutionConfig
  attrs: Record<AttrKey, number>
  attrUpCost: number
  rankXpCurve: { base: number; a: number; b: number }
}

export interface BossData {
  id: string
  nameKey: string
  baseEnemy: string
  hp: number
  regionId: string
  beatSignature: { bpm: number; num: number; den: number }
  phases: {
    enterHpGte?: number
    enterHpLt?: number
    btOverride?: string
    music?: string
  }[]
  rewards: { skill?: string; items?: string[] }
}
