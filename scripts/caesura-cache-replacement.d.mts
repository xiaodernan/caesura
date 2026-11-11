/** `scripts/caesura-cache-replacement.mjs` 的声明：LRU / 2Q / ARC 三替换策略诚实权衡教学件（KI-528）。 */

export const CR_DEFAULTS: Readonly<{
  seed: number
  capacity: number
  accesses: number
  kCoefficient: number
  scanFraction: number
  perfectFuture: boolean
  unlimitedRoom: boolean
  rigged: boolean
}>
export const CR_STRATEGIES: readonly string[]
export const CR_SCENARIOS: readonly string[]

export interface LruInstance {
  protocol: 'LRU'
  access(key: string, inScan?: boolean): boolean
  size(): number
  capacity: number
  stats(): {
    hits: number; misses: number; scanHits: number; scanMisses: number;
    localHits: number; localMisses: number; hitRate: number;
  }
}
export interface TwoQueueInstance {
  protocol: '2Q'
  access(key: string, inScan?: boolean): boolean
  size(): number
  capacity: number
  stats(): {
    hits: number; misses: number; scanHits: number; scanMisses: number;
    localHits: number; localMisses: number; amPromotions: number;
    a1inSize: number; amSize: number; hitRate: number;
  }
}
export interface ArcInstance {
  protocol: 'ARC'
  access(key: string, inScan?: boolean): boolean
  size(): number
  capacity: number
  stats(): {
    hits: number; misses: number; scanHits: number; scanMisses: number;
    localHits: number; localMisses: number; ghostHitsT1: number; ghostHitsT2: number;
    ghostAdaptMoves: number; p: number; T1: number; T2: number; B1: number; B2: number; hitRate: number;
  }
}
export function createLruCache(opts?: { capacity?: number }): LruInstance
export function createTwoQueueCache(opts?: { capacity?: number; kCoefficient?: number }): TwoQueueInstance
export function createArcCache(opts?: { capacity?: number }): ArcInstance

export interface ReplacementCell {
  id: string
  protocol: string
  hits: number
  misses: number
  hitRate: number
  scanHits: number
  scanMisses: number
  localHits: number
  localMisses: number
  amPromotions?: number
  ghostHitsT1?: number
  ghostHitsT2?: number
  ghostAdaptMoves?: number
  adaptationP?: number
  fault: string
}
export interface ReplacementRow {
  protocol: 'LRU' | '2Q' | 'ARC'
  scenarios: ReplacementCell[]
  trilemma: { scanResistance: boolean; stableHitRate: boolean; adaptiveBalance: boolean }
  metrics: { hitRateAvg: number; ghostAdaptMoves: number; amPromotions: number; adaptationP: number }
}
export interface ReplacementStudy {
  builtAt: number
  config: { seed: number; capacity: number; accesses: number; scenarios: string[] | readonly string[]; perfectFuture: boolean; unlimitedRoom: boolean; rigged: boolean }
  rows: ReplacementRow[]
  vectors: Record<string, string>
  verdict: {
    vectors: Record<string, string>
    trilemmaDistinguishes: boolean
    noUniversalWinner: boolean
    noStrategyWinsAll: boolean
    lru_unhinted: boolean
    lru_localityAware: boolean
    twoQ_scanResistant: boolean
    twoQ_notAdaptive: boolean
    arc_adaptive: boolean
    arc_shuffle_pingpong: boolean
    perfectFutureBreaksArc: boolean
    unlimitedRoomAllTrue: boolean
    rigged_pkg: boolean
  }
  crosscheck: { evidence: Record<string, number> } | null
  rigged: boolean
}
export function cacheReplacementStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  capacity?: number
  accesses?: number
  scenarios?: readonly string[]
  perfectFuture?: boolean
  unlimitedRoom?: boolean
  rigged?: boolean
}): ReplacementStudy
export const compareReplacement: typeof cacheReplacementStudy

export interface ReplacementSnapshot {
  builtAt: number
  config: ReplacementStudy['config']
  rows: ReplacementStudy['rows']
  vectors: Record<string, string>
  verdict: ReplacementStudy['verdict']
  crosscheck: ReplacementStudy['crosscheck']
}
export function cacheReplacementSnapshot(study: ReplacementStudy | null | Record<string, never>): ReplacementSnapshot | null

export function runReplacementScenario(protocol: string, scenarioId: string, opts?: Record<string, unknown>): ReplacementCell

export function verifyDualSweep(trace: Array<[string | number, boolean]>): {
  laneA: { hits: number; misses: number; hitRate: number }
  laneB: { hits: number; misses: number; hitRate: number }
  absoluteDelta: number
  hotsetSize: number
  totalKeys: number
  holds: boolean
  falsifiable: true
  tamper: {
    laneATraceCorrupted: { holds: false }
    laneBTraceCorrupted: { holds: false }
    laneBSizedNull: { holds: false }
  }
}

export interface ReplacementEvidence {
  remapConsistentRate: number
  remapModuloRate: number
  routerMoved: number
  hashRingNodes: number
  walLines: number
  walReplayed: number
  notices: number
  busListeners: number
  redisEntries: number
  poolCreated: number
  bucketAllowed: number
  bucketRejected: number
  heapFired: number
  counterSum: number
  jitterSpread: number
  [key: string]: number
}
export function createReplacementEvidence(opts?: { seed?: number }): ReplacementEvidence
