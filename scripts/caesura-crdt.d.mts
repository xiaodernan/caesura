/** `scripts/caesura-crdt.mjs` 的声明：LWWRegister / GCounter / OrSet(add-wins) 三 CRDT 冲突消解诚实权衡教学件（KI-531）。
 *  维序固定 [strongEventualConvergence / expressiveness / compactMetadata]；三位全部真跑现算，不查表。
 *  OrSet 采用 add-wins（observed-remove），非 remove-wins——见 verdict.orSetIsAddWins。
 */

export const CRDT_DEFAULTS: Readonly<{
  seed: number
  opsPerNode: number
  replicaCount: number
  skewTicks: number
}>
export const CRDT_STRATEGIES: readonly string[]
export const CRDT_SCENARIOS: readonly string[]

export interface LwwRegisterInstance {
  protocol: 'LWWRegister'
  assign(clock: number, value: string | number | null): void
  merge(other: LwwRegisterInstance | null): boolean
  observe(): { stamp: { clock: number; nodeId: string }; value: string | number | null } | null
  value(): string | number | null
  inserts(): number
  stats(): { inserts: number; stamp: { clock: number; nodeId: string }; value: string | number | null }
  footprintBytes(): number
}
export interface GCounterInstance {
  protocol: 'GCounter'
  increment(delta?: number): number
  decrement(): false
  merge(other: GCounterInstance | null): boolean
  value(): number
  inserts(): number
  footprintBytes(): number
  _increments: Map<string, number>
  stats(): { inserts: number; nodes: number; value: number }
}
export interface OrSetInstance {
  protocol: 'OrSet'
  add(value: string | number | null): string
  remove(value: string | number | null): number
  merge(other: OrSetInstance | null): boolean
  liveTags(): Array<{ tag: string; value: string | number | null }>
  value(): (string | number | null)[]
  inserts(): number
  footprintBytes(): number
  _adds: Map<string, string | number | null>
  _removes: Set<string>
  stats(): { inserts: number; liveTags: number; removes: number; value: (string | number | null)[] }
}
export function createLwwRegister(opts?: { nodeId?: string }): LwwRegisterInstance
export function createGCounter(opts?: { nodeId?: string }): GCounterInstance
export function createOrSet(opts?: { nodeId?: string }): OrSetInstance

export interface CrdtTrilemma {
  strongEventualConvergence: boolean
  expressiveness: boolean
  compactMetadata: boolean
}
export interface SecProbe {
  secStrict: boolean
  concurrentIntentLost: boolean
  submitted: number
  retained: number
  strongEventualConvergence: boolean
  digests: string[]
}
export interface ExpProbe {
  decrementRefused: boolean
  removeWorked: boolean
  expressiveness: boolean
}
export interface CompactProbe {
  small: number
  large: number
  grows: boolean
  compressedLossless: boolean | null
  compressionBreaksSec: boolean | null
  compactMetadata: boolean
}
export interface CrdtCell {
  id: string
  fault: string
  inserts: number
  replicaDigest: string
  secConverged: boolean
  value: string | number | null | (string | number | null)[]
  /** 三维逐格同源（协议级现算结果复制，供 ladder 显示；与 row.trilemma / vectors 一致）。 */
  strongEventualConvergence: boolean
  expressiveness: boolean
  compactMetadata: boolean
  inSecExam: boolean
  inExpressiveExam: boolean
  inCompactExam: boolean
}
export interface CrdtRow {
  protocol: 'LWWRegister' | 'GCounter' | 'OrSet'
  vector: string
  scenarios: CrdtCell[]
  trilemma: CrdtTrilemma
  probes: { sec: SecProbe; exp: ExpProbe; cmp: CompactProbe }
  metrics: {
    lwwConflictInvocations: number
    compactBytes: number
    convergenceGuarantee: boolean
    convergenceLeak?: string
  }
}
export interface CrdtVerdict {
  vectors: Record<string, string>
  baseVectors: Record<string, string>
  noUniversalWinner: boolean
  noUniversalWinnerStrict: boolean
  trilemmaDistinguishes: boolean
  noStrategyWinsAll: boolean
  vectorFromTrilemma: boolean
  secStrictAllConverge: boolean
  lwwSecBreaksOnConcurrentIntent: boolean
  orSetIsAddWins: boolean
  lwwLosesConcurrentWrites: boolean
  gcounterSecConverges: boolean
  gcounterIntention: boolean
  orSetConcurrentAddsSurvive: boolean
  orSetCompactUnbounded: boolean
  gcounterCompactErasableByFreeMemory: boolean
  uniformClockErasesSkewMispick: boolean
  lwwConcurrentLossCausallyUnerasable: boolean
  decrementCausallyUnerasable: boolean
  orSetTagHistoryCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  riggedApplied: boolean
  rigged_pkg: boolean
}
export interface Convergence {
  laneA: { beforeAll: number[]; after: number[]; digests: string[]; secConverged: boolean; expected: number }
  laneB: { truth: { increments: number }; laneBOk: boolean; orSetOk: boolean; lwwOk: boolean; orMerged: (string | number | null)[] }
  holds: boolean
  nontrivial: boolean
  falsifiable: true
  tamper: {
    dropReplica: { holds: boolean; baselineHolds: boolean; reason: string }
    reverseLwwDecision: { holds: boolean; baselineHolds: boolean; reason: string }
    emptySet: { holds: boolean; baselineHolds: boolean; reason: string }
  }
  events: number
}
export interface CrdtStudy {
  builtAt: number
  config: {
    seed: number
    replicaCount: number
    opsPerNode: number
    skewTicks: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    uniformClock: boolean
    infiniteMetadata: boolean
    coordinatedDelete: boolean
  }
  rows: CrdtRow[]
  vectors: Record<string, string>
  baseVectors: Record<string, string>
  verdict: CrdtVerdict
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  crosscheck: {
    evidence: Record<string, number>
    convergence: Convergence
  }
  rigged: boolean
}
export function crdtStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  replicaCount?: number
  opsPerNode?: number
  skewTicks?: number
  scenarios?: readonly string[]
  uniformClock?: boolean
  infiniteMetadata?: boolean
  coordinatedDelete?: boolean
  rigged?: boolean
}): CrdtStudy
export const compareCrdt: typeof crdtStudy

export interface CrdtSnapshot {
  builtAt: number
  config: CrdtStudy['config']
  rows: Array<{
    protocol: CrdtRow['protocol']
    vector: string
    scenarios: CrdtCell[]
    trilemma: CrdtTrilemma
    metrics: CrdtRow['metrics']
  }>
  vectors: Record<string, string>
  baseVectors: Record<string, string>
  verdict: CrdtVerdict
  rigged: boolean
  crosscheck?: { evidence?: Record<string, number>; convergence?: Convergence }
}
export function crdtSnapshot(study: CrdtStudy | null | Record<string, never>): CrdtSnapshot | null

export function verifyConvergence(input: {
  events?: Array<{ node: string; clock: number; op: string; payload?: any }>
  seed?: number
  replicaCount?: number
  now?: number | (() => number)
}, opts?: { seed?: number; replicaCount?: number }): Convergence

export interface CrdtEvidence {
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
export function createCrdtEvidence(opts?: { seed?: number; now?: number | (() => number) }): CrdtEvidence
