/** `scripts/caesura-trace-sampling.mjs` 的声明：可观测性分布式追踪采样三策略诚实权衡教学件（KI-533）。 */

export const TRACE_DEFAULTS: Readonly<{
  seed: number
  items: number
  rate: number
  minRate: number
  maxRate: number
  windowSize: number
  oracleHead: boolean
  infiniteBuffer: boolean
  perfectFeedback: boolean
  rigged: boolean
}>
export const TRACE_STRATEGIES: readonly string[]
export const TRACE_SCENARIOS: readonly string[]
export const TRACE_DIMS: readonly string[]

export interface TraceSpan {
  id: string
  traceId: number
  service: string
  isError: boolean
  durationMs: number
}
export interface TraceUnit {
  id: number
  loadFactor: number
  spans: TraceSpan[]
  hasError: boolean
  errorSpans: number
}

/** 六场景正交 trace 流的构造器（导出供真件层/测试复现确定性流）。 */
export function traceStreamOf(id: string, opts?: { seed?: number; items?: number }): TraceUnit[]

export interface SamplerStats {
  rate: number
  rateChanges: number
  peakBufferedSpans: number
  errorTracesTotal: number
  errorTracesRetained: number
  normalTracesTotal: number
  normalTracesRetained: number
  spansIn: number
  spansKept: number
  spansDropped: number
  tracesTotal: number
  tracesKept: number
}
export interface SamplerRun {
  kept: TraceUnit[]
  dropped: TraceUnit[]
  stats: SamplerStats
}
export interface SamplerInstance {
  protocol: 'HeadBasedSampler' | 'TailBasedSampler' | 'AdaptiveSampler'
  run(traces: TraceUnit[]): SamplerRun
  stats(): SamplerStats
  oracleHead?(): boolean
  infiniteBuffer?(): boolean
  perfectFeedback?(): boolean
}
export function createHeadBasedSampler(opts?: { seed?: number; rate?: number; oracleHead?: boolean }): SamplerInstance
export function createTailBasedSampler(opts?: { seed?: number; rate?: number; infiniteBuffer?: boolean }): SamplerInstance
export function createAdaptiveSampler(opts?: {
  seed?: number
  rate?: number
  minRate?: number
  maxRate?: number
  windowSize?: number
  perfectFeedback?: boolean
}): SamplerInstance
export function createSampler(protocol: string, opts?: Record<string, unknown>): SamplerInstance

export interface TraceSamplingCell extends SamplerStats {
  id: string
  lowOverhead: boolean        // 逐格真观测量现算：peakBufferedSpans===0
  anomalyCapture: boolean     // 逐格：本格 error trace 是否全留（无 error 场景空真）
  loadAdaptive: boolean       // 逐格：本格 rateChanges>0
  errorRetainedRate: number
  normalRetainedRate: number
  fault: string
  inAnomalyExam: boolean
  inOverheadExam: boolean
  inAdaptiveExam: boolean
}
export interface Trilemma {
  lowOverhead: boolean
  anomalyCapture: boolean
  loadAdaptive: boolean
}
export interface TraceSamplingRow {
  protocol: 'HeadBasedSampler' | 'TailBasedSampler' | 'AdaptiveSampler'
  scenarios: TraceSamplingCell[]
  trilemma: Trilemma
  metrics: {
    peakBufferedSpans: number
    errorTracesTotal: number
    errorTracesRetained: number
    errorTracesLost: number
    spansIn: number
    spansKept: number
    rateChanges: number
  }
  debug: Record<string, never>
}

export interface CausalLocks {
  anomalyRequiresBufferingCausallyUnerasable: boolean
  headBlindnessCausallyUnerasable: boolean
  adaptiveLagCannotGuaranteeAnomalyCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  decisionInvariant: boolean       // 翻转 hasError 平行流逐 id 决策恒同 ⇒ 头部盲结构判据（零统计噪声）
  maxBlindnessGap: number          // 仅诚实展示读数（抽样偏差），不作结构锁判据
  rateSweep: Array<{ rate: number; errorRate: number; normalRate: number }>
  adaptivePerfectLost: number
  adaptiveBaseLost: number
}
export function verifyCausalLocks(cfg: {
  seed?: number
  items?: number
  rate?: number
  minRate?: number
  maxRate?: number
  windowSize?: number
}): CausalLocks

export interface SoundnessInvariants {
  laneAOk: boolean
  errorAllRetained: boolean
  noDuplicateSpans: boolean
  spansIntact: boolean
  normalByRate: boolean
}
export interface SoundnessResult {
  laneA: {
    baselineSpansIn: number
    baselineSpansKept: number
    baselineSpansDropped: number
    baselineUnique: boolean
  }
  laneB: {
    completedTraces: number
    uniqueTraces: number
    errorTracesTotal: number
    errorTracesRetained: number
    normalByRate: boolean
  }
  invariants: SoundnessInvariants
  baselineHolds: boolean
  holds: boolean
  nontrivial: boolean
  falsifiable: boolean
  tamper: {
    forgedErrorSpan: { holds: boolean; invariants: SoundnessInvariants; reason: string }
    duplicateRelease: { holds: boolean; invariants: SoundnessInvariants; reason: string }
    emptyTraceSet: { holds: boolean; nontrivial: boolean; invariants: SoundnessInvariants; reason: string }
  }
  truthErrors: number
  events: number
}
export function verifySamplingSoundness(
  input?: { traces?: TraceUnit[]; seed?: number; rate?: number; items?: number },
  opts?: { seed?: number; rate?: number; items?: number },
): SoundnessResult

export interface TraceSamplingVerdict {
  vectors: Record<string, string>
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  noStrategyWinsAll: boolean
  vectorFromTrilemma: boolean
  headBlindLossOnErrorBurst: boolean       // 恒以纯净基线标定主教义（rigged 不翻）
  tailGuaranteesAnomaly: boolean
  adaptiveTracksLoad: boolean
  rigged_pkg: boolean
  riggedConvergenceCollapsed: boolean     // rigged 下 Head≡Tail=110，诚实标注区分度塌缩
  oracleHeadErasesHeadBlindness: boolean
  infiniteBufferErasesOverhead: boolean
  perfectFeedbackImprovesBurstOnly: boolean
  anomalyRequiresBufferingCausallyUnerasable: boolean
  headBlindnessCausallyUnerasable: boolean
  adaptiveLagCannotGuaranteeAnomalyCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  decisionInvariant: boolean
  maxBlindnessGap: number
  rateSweep: Array<{ rate: number; errorRate: number; normalRate: number }>
  adaptivePerfectLost: number
  adaptiveBaseLost: number
}
export interface TraceSamplingStudy {
  builtAt: number
  config: {
    seed: number
    items: number
    rate: number
    minRate: number
    maxRate: number
    windowSize: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    oracleHead: boolean
    infiniteBuffer: boolean
    perfectFeedback: boolean
  }
  rows: TraceSamplingRow[]
  vectors: Record<string, string>
  verdict: TraceSamplingVerdict
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks: CausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: SoundnessResult
  }
  rigged: boolean
}
export function traceSamplingStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  items?: number
  rate?: number
  minRate?: number
  maxRate?: number
  windowSize?: number
  scenarios?: readonly string[]
  oracleHead?: boolean
  infiniteBuffer?: boolean
  perfectFeedback?: boolean
  rigged?: boolean
}): TraceSamplingStudy
export const compareTraceSampling: typeof traceSamplingStudy

export interface TraceSamplingSnapshot {
  builtAt: number
  config: TraceSamplingStudy['config']
  rows: TraceSamplingStudy['rows']
  vectors: Record<string, string>
  verdict: TraceSamplingVerdict
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks: CausalLocks
  crosscheck?: { evidence?: Record<string, number>; soundness?: SoundnessResult }
  rigged: boolean
}
export function traceSamplingSnapshot(study: TraceSamplingStudy | null | Record<string, never>): TraceSamplingSnapshot | null

export interface TraceSamplingEvidence {
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
export function createTraceSamplingEvidence(opts?: { seed?: number; now?: number | (() => number) }): TraceSamplingEvidence
