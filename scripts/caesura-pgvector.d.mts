/**
 * 类型声明 · caesura-pgvector（KI-562）
 * 保持与 .mjs 的命名、参数顺序、返回形状一致。
 */

export const PG_DEFAULTS: {
  readonly seed: number
  readonly messages: number
  readonly docs: number
  readonly dims: number
  readonly k: number
  readonly recallFloor: number
  readonly rigged: false
}
export const PG_STRATEGIES: readonly ['BPlusOrdered', 'TrgmGin', 'VectorHnsw']
export const PG_SCENARIOS: readonly ['rangeScan', 'fuzzyLike', 'vectorSearch', 'cleanRerun']

export interface BellDoc {
  id: string
  title: string
  price: number
  vec: number[]
}

export interface GenCorpusOptions {
  seed?: number
  docs?: number
  dims?: number
}
export function genBellCorpus(opts?: GenCorpusOptions): BellDoc[]

export function trigramSet(s: unknown): Set<string>
export function trgmCandidates(corpus: BellDoc[], term: unknown): BellDoc[]

export interface GenProbeTermsOptions {
  minCount?: number
  maxProbes?: number
}
export function genProbeTerms(corpus: BellDoc[], opts?: GenProbeTermsOptions): string[]

export function exactKnn(corpus: BellDoc[], qi: number, k: number): number[]

/** 有向 NSW 邻接表（Build 后可当作 pgvector HNSW 的诚实简化模型） */
export function buildDirectedNsw(corpus: BellDoc[], m?: number): number[][]

/** 贪心图搜索；opts.invertCosine 仅供 tamper 复演使用 */
export function greedyNswSearch(
  corpus: BellDoc[],
  adj: number[][],
  entry: number,
  qi: number,
  k: number,
  ef?: number,
  opts?: { invertCosine?: boolean },
): number[]

export interface PgVectorStrategy {
  protocol: 'BPlusOrdered' | 'TrgmGin' | 'VectorHnsw'
  trilemma(): VectorTrilemma
  capability: VectorTrilemma
  opts: Record<string, unknown>
}
export function createBPlusOrdered(opts?: Record<string, unknown>): PgVectorStrategy
export function createTrgmGin(opts?: Record<string, unknown>): PgVectorStrategy
export function createVectorHnsw(opts?: Record<string, unknown>): PgVectorStrategy

export interface VectorTrilemma {
  orderedRangeScan: boolean
  fuzzyPatternMatch: boolean
  vectorSimilarity: boolean
}

export interface ScenarioCell {
  id: 'rangeScan' | 'fuzzyLike' | 'vectorSearch' | 'cleanRerun'
  docs: number
  processed: number
  matched: number
  ordered: number
  state: 'hit' | 'miss'
  fault: string
  recall: number | null
}

export interface StrategyTrilemma extends VectorTrilemma {}

export interface ScenarioRow {
  protocol: 'BPlusOrdered' | 'TrgmGin' | 'VectorHnsw'
  scenarios: ScenarioCell[]
  trilemma: VectorTrilemma
  metrics: {
    stateHits: number
    vectorRecall: number | null
  }
}

export interface PgVectorStudyOptions {
  seed?: number
  messages?: number
  docs?: number
  dims?: number
  freeOrderedRangeScan?: boolean
  freeFuzzyPatternMatch?: boolean
  freeVectorSimilarity?: boolean
  rigged?: boolean
  now?: () => number
}

export interface PgVectorVerdict {
  vectors: Record<string, string>
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  scenarioDistinguishes: boolean
  noStrategyWinsAll: boolean
  vectorFromTrilemma: boolean
  rigged: boolean
  rigged_pkg_flags: Record<string, boolean>
  riggedConvergenceCollapsed: boolean
}

export interface PgVectorCausalLocks {
  bplusFanoutCausallyUnerasable: boolean
  trgmCandidateSupersetCausallyUnerasable: boolean
  vectorRecallFloorCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  probes: {
    treeHeight: number
    treeSplits: number
    treePuts: number
    trgmProbes: number
    recall8: number
    recallFloor: number
  }
}

export interface PgVectorSoundnessLaneA {
  ordered: boolean
  complete: boolean
  count: number
  bruteCount: number
  splits?: number
  height?: number
  order?: number
}
export interface PgVectorSoundnessLaneB {
  probes: number
  supersetHolds: boolean
  candidateCount: number
  trueMatchCount: number
}
export interface PgVectorSoundnessLaneC {
  recall8: number
  floor: number
  holds: boolean
}
export interface PgVectorTamperResult {
  holds: boolean
  reason: string
}
export interface PgVectorSoundness {
  laneA: PgVectorSoundnessLaneA
  laneB: PgVectorSoundnessLaneB
  laneC: PgVectorSoundnessLaneC
  baselineHolds: boolean
  holds: boolean
  nontrivial: boolean
  falsifiable: boolean
  tamper: {
    forcedSeqScan: PgVectorTamperResult
    strictEquality: PgVectorTamperResult
    invertedCosine: PgVectorTamperResult
  }
  events: string[]
}

export interface PgVectorEvidence {
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
  remapConsistentRate: number
  remapModuloRate: number
}

export interface PgVectorCrosscheck {
  evidence: PgVectorEvidence
  soundness: PgVectorSoundness
}

export interface PgVectorStudy {
  builtAt: number
  config: {
    seed: number
    messages: number
    docs: number
    dims: number
    freeOrderedRangeScan: boolean
    freeFuzzyPatternMatch: boolean
    freeVectorSimilarity: boolean
    rigged: boolean
  }
  rows: ScenarioRow[]
  vectors: Record<string, string>
  verdict: PgVectorVerdict
  causalLocks: PgVectorCausalLocks
  crosscheck: PgVectorCrosscheck
  rigged: boolean
}

export function pgVectorStudy(opts?: PgVectorStudyOptions): PgVectorStudy
export const comparePgVector: typeof pgVectorStudy
export const comparePostgreSqlQueryEngine: typeof pgVectorStudy

export interface PgVectorSnapshot {
  builtAt: number
  config: PgVectorStudy['config']
  rows: ScenarioRow[]
  vectors: Record<string, string>
  verdict: PgVectorVerdict
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  scenarioDistinguishes: boolean
  noStrategyWinsAll: boolean
  causalLocks: PgVectorCausalLocks
  crosscheck: PgVectorCrosscheck
  rigged: boolean
}
export function pgVectorSnapshot(study?: PgVectorStudy): PgVectorSnapshot

export function verifyPgVectorSoundness(
  input?: { seed?: number; messages?: number },
  opts?: { seed?: number; messages?: number },
): PgVectorSoundness

export function verifyCausalLocks(): PgVectorCausalLocks

export function createPgVectorEvidence(opts?: {
  seed?: number
  freeOrderedRangeScan?: boolean
  freeFuzzyPatternMatch?: boolean
  freeVectorSimilarity?: boolean
  rigged?: boolean
  now?: () => number
}): PgVectorEvidence
