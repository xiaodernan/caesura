/** `scripts/caesura-hyperloglog.mjs` 的声明：精确 Set / HyperLogLog / LinearCounting 三基数估计算法族诚实权衡教学件（KI-530）。 */

export const HLL_DEFAULTS: Readonly<{
  seed: number
  cardinality: number
  mRegisters: number
  registerBytes: number
  exactCard: number
}>
export const HLL_STRATEGIES: readonly string[]
export const HLL_SCENARIOS: readonly string[]

export interface ExactSetInstance {
  protocol: 'ExactSet'
  add(key: string | number): void
  cardinality(): number
  inserts(): number
  footprintBytes(): number
  merge(other: { members(): string[] } | null): number
  members(): string[]
  reset(): void
  stats(): { inserts: number; size: number; footprintBytes: number }
}
export interface HyperLogLogInstance {
  protocol: 'HyperLogLog'
  add(key: string | number): void
  cardinality(): number
  inserts(): number
  footprintBytes(): number
  merge(other: HyperLogLogInstance | null): boolean | null
  registerMax(): number
  rawEstimate(): number
  _regs: Uint8Array
  reset(): void
  stats(): { inserts: number; zeros: number; registerMax: number; footprintBytes: number }
}
export interface LinearCountingInstance {
  protocol: 'LinearCounting'
  add(key: string | number): void
  cardinality(): number
  inserts(): number
  footprintBytes(): number
  merge(other: LinearCountingInstance | null): boolean | null
  setCount(): number
  _bitmap: Uint8Array
  reset(): void
  stats(): { inserts: number; setBits: number; footprintBytes: number }
}
export function createExactSet(opts?: { unlimitedMemory?: boolean }): ExactSetInstance
export function createHyperLogLog(opts?: { seed?: number; mRegisters?: number }): HyperLogLogInstance
export function createLinearCounting(opts?: { seed?: number; bits?: number }): LinearCountingInstance

export interface CardinalityCell {
  id: string
  protocol: string
  truth: number
  estimate: number | null
  relativeError: number | null
  footprintBytes: number
  inserts: number
  mergeOk?: boolean
  fault?: string
  estimatorAccuracy: boolean
  fixedMemory: boolean
  mergeable: boolean
  inAccuracyExam: boolean
  inMemoryExam: boolean
  inMergeExam: boolean
}
export interface CardinalityRow {
  protocol: 'ExactSet' | 'HyperLogLog' | 'LinearCounting'
  scenarios: CardinalityCell[]
  trilemma: { estimatorAccuracy: boolean; fixedMemory: boolean; mergeable: boolean }
  metrics: {
    exactCard: number
    maxRelativeError: number
    footprintBytes: number
    mergeOk: boolean
    trilemmaDebug?: { maxErr: number }
  }
}
export interface CardinalityStudy {
  builtAt: number
  config: {
    seed: number
    cardinality: number
    mRegisters: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    perfectHash: boolean
    unlimitedMemory: boolean
  }
  rows: CardinalityRow[]
  vectors: Record<string, string>
  verdict: {
    vectors: Record<string, string>
    noUniversalWinner: boolean
    trilemmaDistinguishes: boolean
    noStrategyWinsAll: boolean
    vectorFromTrilemma: boolean
    exactSetAccurate: boolean
    hllFixed12k: boolean
    hllRestrictedPmerge: boolean
    linearCountingSaturates: boolean
    exactSetGrowsUnbounded: boolean
    rigged_pkg: boolean
    linearCountingSaturationCausallyUnerasable: boolean
    perfectHashErasesError: boolean
    unlimitedRoomErasesGrowth: boolean
  }
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  crosscheck: {
    evidence: Record<string, number>
    estimate: {
      laneA: { exact: number; distinct: number }
      laneB: { estimate: number; relError: number; sigma: number; m: number }
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        registerCorrupted: { holds: boolean; reason: string }
        emptySet: { holds: boolean; reason: string }
        bitsTooBig: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function streamCardinalityStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  mRegisters?: number
  cardinality?: number
  scenarios?: readonly string[]
  perfectHash?: boolean
  unlimitedMemory?: boolean
  rigged?: boolean
}): CardinalityStudy
export const compareCardinality: typeof streamCardinalityStudy

export interface CardinalitySnapshot {
  builtAt: number
  config: CardinalityStudy['config']
  rows: CardinalityStudy['rows']
  vectors: Record<string, string>
  verdict: CardinalityStudy['verdict']
  crosscheck?: { evidence?: Record<string, any>; estimate?: Record<string, any> }
}
export function cardinalitySnapshot(study: CardinalityStudy | null | Record<string, never>): CardinalitySnapshot | null

export function verifySparseEstimate(input: {
  events?: Array<string | number>
  seed?: number
  now?: number | (() => number)
}, opts?: { seed?: number }): {
  laneA: { exact: number; distinct: number }
  laneB: { estimate: number; relError: number; sigma: number; m: number }
  holds: boolean
  nontrivial: boolean
  falsifiable: true
  tamper: {
    registerCorrupted: { holds: boolean; reason: string }
    emptySet: { holds: boolean; reason: string }
    bitsTooBig: { holds: boolean; reason: string }
  }
  events: number
}

export interface CardinalityEvidence {
  remapConsistentRate: number
  remapModuloRate: number
  routerMoved: number
  routerTracked: number
  ringNodes: number
  ringShardsUsed: number
  walLines: number
  walReplayed: number
  notices: number
  busListeners: number
  redisBitmapHits: number
  redisSlots: number
  poolCreated: number
  poolReused: number
  bucketAllowed: number
  bucketRejected: number
  heapFired: number
  heapPending: number
  counterSum: number
  counterFalseSharing: number
  jitterSpread: number
  [key: string]: number
}
export function createCardinalityEvidence(opts?: { seed?: number; now?: number | (() => number) }): CardinalityEvidence
