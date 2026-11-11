/** `scripts/caesura-stream-window.mjs` 的声明：流式窗口聚合与 Watermark 迟到处置三策略诚实权衡教学件（KI-529）。 */

export const SW_DEFAULTS: Readonly<{
  seed: number
  windowSize: number
  slideStep: number
  sessionGap: number
  allowedLateness: number
  events: number
  frozenWatermark: boolean
  infiniteLateness: boolean
  freeState: boolean
  rigged: boolean
}>
export const SW_STRATEGIES: readonly string[]
export const SW_SCENARIOS: readonly string[]

export interface StreamWindowCell {
  id: string
  protocol: string
  windowCount: number
  emittedWindows: number
  stateReplicas: number
  rawAmplification: number
  amplification: number
  pairs: number
  coveredPairs: number
  pairCoverage: number
  lateTotal: number
  lateAccepted: number
  lateSideOutput: number
  lateAcceptRate: number
  closeEvents: number
  monotonicViolations: number
  watermarkFinal: number
  fault: string
  resultCompleteness: boolean
  lateTolerance: boolean
  stateEfficiency: boolean
  inResultExam: boolean
  inLateExam: boolean
  inStateExam: boolean
  watermarkTrace?: number[]
}
export interface StreamWindowRow {
  protocol: 'Tumbling' | 'Sliding' | 'Session'
  scenarios: StreamWindowCell[]
  trilemma: { resultCompleteness: boolean; lateTolerance: boolean; stateEfficiency: boolean }
  metrics: {
    windowCount: number
    emittedWindows: number
    stateReplicas: number
    amplificationAvg: number
    pairCoverageAvg: number
    lateAccepted: number
    lateSideOutput: number
    watermarkFinal: number
    trilemmaDebug: { rcAvg: number; lateAcceptRate: number; ampMax: number }
  }
}
export interface StreamWindowStudy {
  builtAt: number
  config: {
    seed: number
    windowSize: number
    slideStep: number
    sessionGap: number
    allowedLateness: number
    events: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    frozenWatermark: boolean
    infiniteLateness: boolean
    freeState: boolean
  }
  rows: StreamWindowRow[]
  vectors: Record<string, string>
  verdict: {
    vectors: Record<string, string>
    noUniversalWinner: boolean
    trilemmaDistinguishes: boolean
    noStrategyWinsAll: boolean
    vectorFromTrilemma: boolean
    tumbling_crossBoundaryLoss: boolean
    tumbling_stateCheap: boolean
    sliding_overlapComplete: boolean
    sliding_stateAmplified: boolean
    session_gapFragile: boolean
    session_stateCheap: boolean
    rigged_pkg: boolean
    resultCompletenessCausallyUnerasable: boolean
    frozenCollapsesCompleteness: boolean
    infiniteRestoresSessionLate: boolean
    freeRestoresSlidingState: boolean
    watermarkHolds: boolean
    watermarkNontrivial: boolean
  }
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  crosscheck: {
    evidence: Record<string, number>
    watermark: {
      laneA: { violations: number; behindHorizon: number; closed: number; finalWatermark: number; steps: number }
      laneB: { lateTotal: number; accepted: number; sideOutput: number; conserved: boolean }
      tolerance: number
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        watermarkInverted: { holds: boolean; reason: string } & Record<string, any>
        dispositionTampered: { holds: boolean; reason: string } & Record<string, any>
        emptySet: { holds: boolean; reason: string } & Record<string, any>
      }
    }
  }
  rigged: boolean
}
export function streamWindowStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  windowSize?: number
  slideStep?: number
  sessionGap?: number
  allowedLateness?: number
  events?: number
  scenarios?: readonly string[]
  frozenWatermark?: boolean
  infiniteLateness?: boolean
  freeState?: boolean
  rigged?: boolean
}): StreamWindowStudy
export const compareStreamWindow: typeof streamWindowStudy

export interface StreamWindowSnapshot {
  builtAt: number
  config: StreamWindowStudy['config']
  rows: {
    protocol: string
    scenarios: StreamWindowCell[]
    trilemma: { resultCompleteness: boolean; lateTolerance: boolean; stateEfficiency: boolean }
    metrics: StreamWindowRow['metrics']
  }[]
  vectors: Record<string, string>
  verdict: StreamWindowStudy['verdict']
  crosscheck?: { evidence?: Record<string, any>; watermark?: Record<string, any> }
}
export function streamWindowSnapshot(study: StreamWindowStudy | null | Record<string, never>): StreamWindowSnapshot | null

export function runStreamWindowScenario(protocol: string, scenarioId: string, opts?: Record<string, unknown>): StreamWindowCell

export function verifyWatermarkMonotonicity(events: Array<{ e: number; a: number; g: string }>, opts?: {
  windowSize?: number
  sessionGap?: number
  allowedLateness?: number
  tolerance?: number
}): {
  laneA: { violations: number; behindHorizon: number; closed: number; finalWatermark: number; steps: number }
  laneB: { lateTotal: number; accepted: number; sideOutput: number; conserved: boolean }
  tolerance: number
  holds: boolean
  nontrivial: boolean
  falsifiable: true
  tamper: {
    watermarkInverted: { holds: boolean; reason: string } & Record<string, any>
    dispositionTampered: { holds: boolean; reason: string } & Record<string, any>
    emptySet: { holds: boolean; reason: string } & Record<string, any>
  }
}

export interface StreamWindowEvidence {
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
export function createStreamWindowEvidence(opts?: { seed?: number; now?: number | (() => number) }): StreamWindowEvidence
