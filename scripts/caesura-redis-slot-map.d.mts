/**
 * scripts/caesura-redis-slot-map.d.mts · KI-557 Redis Cluster 哈希槽拓扑教学件声明
 */

export const SLOT_MAP_DEFAULTS: Readonly<{
  seed: number
  messages: number
  slots: number
  nodes: number
  freeEven: boolean
  freeColocation: boolean
  freeMigrationMin: boolean
  rigged: boolean
}>
export const SLOT_MAP_STRATEGIES: ReadonlyArray<'SlotModulo' | 'HashTagSlot' | 'ConsistentSlot'>
export const SLOT_MAP_SCENARIOS: ReadonlyArray<'burstJoins' | 'hotTagColocate' | 'addShard' | 'cleanRerun'>

export function crc16ccitt(data: string): number
export function crc16(data: string): number
export function extractHashTag(key: string): string | null

export interface SlotMapScenarioCell {
  id: 'burstJoins' | 'hotTagColocate' | 'addShard' | 'cleanRerun'
  messages: number
  processed: number
  slotsUsed: number
  slotMin: number
  slotMax: number
  stddev: number
  fault: 'cluster-join' | 'tag-collision' | 'reshard-migration' | 'rerun-idempotent'
}
export interface SlotMapTrilemma {
  distributesEvenly: boolean
  colocationByHashTag: boolean
  minMigration: boolean
}
export interface RedisSlotMapRow {
  protocol: 'SlotModulo' | 'HashTagSlot' | 'ConsistentSlot'
  scenarios: SlotMapScenarioCell[]
  trilemma: SlotMapTrilemma
  metrics: {
    totalSlotsUsed: number
    avgStdDev: number
  }
}
export interface RedisSlotMapVerdict {
  vectors: Record<string, string>
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  noStrategyWinsAll: boolean
  vectorFromTrilemma: boolean
  rigged: boolean
  rigged_pkg_flags: { freeEven: boolean; freeColocation: boolean; freeMigrationMin: boolean }
  riggedConvergenceCollapsed: boolean
}
export interface RedisSlotMapCausalLocks {
  crc16DistributionCausallyUnerasable: boolean
  hashTagBindingCausallyUnerasable: boolean
  slotMigrationFloorCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  probes: { slotsCovered: number; crcSampleCount: number; tagSlots: number; forcedMigrationSlots: number }
}
export interface RedisSlotMapSoundness {
  laneA: { tagColocationMismatches: number; tags: number }
  laneB: { slotsCovered: number; evenlyDistributed: boolean }
  baselineHolds: boolean
  holds: boolean
  nontrivial: boolean
  falsifiable: boolean
  tamper: {
    wrongCrcSeed: { holds: boolean; reason: string }
    missingBrace: { holds: boolean; reason: string }
    forcedModulo: { holds: boolean; reason: string }
  }
  events: number
}
export interface SlotMapEvidence {
  routerMoved: number; routerTracked: number; ringNodes: number; ringShardsUsed: number
  walLines: number; walReplayed: number; notices: number; busListeners: number
  redisBitmapHits: number; redisSlots: number; poolCreated: number; poolReused: number
  bucketAllowed: number; bucketRejected: number; heapFired: number; heapPending: number
  counterSum: number; counterFalseSharing: number; jitterSpread: number
  remapConsistentRate: number; remapModuloRate: number
}
export interface RedisSlotMapStudy {
  builtAt: number
  config: { seed: number; messages: number; slots: number; nodes: number; freeEven: boolean; freeColocation: boolean; freeMigrationMin: boolean; rigged: boolean }
  rows: RedisSlotMapRow[]
  vectors: Record<string, string>
  verdict: RedisSlotMapVerdict
  causalLocks: RedisSlotMapCausalLocks
  crosscheck: { evidence: SlotMapEvidence; soundness: RedisSlotMapSoundness }
  rigged: boolean
}
export interface RedisSlotMapSnapshot {
  builtAt: number
  config: RedisSlotMapStudy['config']
  rows: Array<{
    protocol: RedisSlotMapRow['protocol']
    scenarios: Array<Pick<SlotMapScenarioCell, 'id' | 'messages' | 'processed' | 'slotsUsed' | 'slotMin' | 'slotMax' | 'stddev' | 'fault'>>
    trilemma: SlotMapTrilemma
    metrics: RedisSlotMapRow['metrics']
  }>
  vectors: Record<string, string>
  verdict: RedisSlotMapVerdict
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks: RedisSlotMapCausalLocks
  crosscheck: RedisSlotMapStudy['crosscheck']
  rigged: boolean
}
export function createSlotModulo(opts?: { freeEven?: boolean }): {
  protocol: 'SlotModulo'; invoke(keys: Array<{ id: string; key: string }>): {
    processed: number; slotsUsed: number; min: number; max: number; stddev: number; evenReduction: number
    log: Array<{ slot: number; keys: number }>
  }
}
export function createHashTagSlot(opts?: { freeColocation?: boolean }): {
  protocol: 'HashTagSlot'; invoke(keys: Array<{ id: string; key: string }>): {
    processed: number; slotsUsed: number; min: number; max: number; stddev: number; coloclationRate: number
    log: Array<{ slot: number; keys: number }>
  }
}
export function createConsistentSlot(opts?: { freeMigrationMin?: boolean }): {
  protocol: 'ConsistentSlot'; invoke(keys: Array<{ id: string; key: string }>): {
    processed: number; slotsUsed: number; min: number; max: number; stddev: number
    nodeHits: Record<string, number>; migrationFloor: number
    log: Array<{ slot: number; keys: number }>
  }
}
export function slotMapStudy(opts?: { seed?: number; messages?: number; now?: () => number; slots?: number; nodes?: number; freeEven?: boolean; freeColocation?: boolean; freeMigrationMin?: boolean; rigged?: boolean }): RedisSlotMapStudy
export const compareSlotMap: typeof slotMapStudy
export const compareRedisSlotMap: typeof slotMapStudy
export function slotMapSnapshot(study?: RedisSlotMapStudy): RedisSlotMapSnapshot
export function verifySlotMapSoundness(input?: { seed?: number; messages?: number }, opts?: { seed?: number; messages?: number }): RedisSlotMapSoundness
export function verifyCausalLocks(flags?: { freeEven?: boolean; freeColocation?: boolean; freeMigrationMin?: boolean }): RedisSlotMapCausalLocks
export function createSlotMapEvidence(opts?: { seed?: number; now?: number | (() => number) }): SlotMapEvidence
