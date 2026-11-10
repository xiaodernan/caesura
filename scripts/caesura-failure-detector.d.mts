/** `scripts/caesura-failure-detector.mjs` 的声明：φ 累积故障检测 + SWIM 成员协议 + 健康视图缓存（KI-503）。 */

/** 缺省教学参数（判定阈值仍由调用方注入）。 */
export const FD_DEFAULTS: Readonly<{
  threshold: number
  minSamples: number
  minStdDeviationMs: number
  windowSize: number
  phiCap: number
  fixedTimeoutMs: number
  probeIntervalMs: number
  suspicionMult: number
  retransmitLimit: number
  baseIntervalMs: number
  spikeGapMs: number
  spikeCount: number
  stableCount: number
  faultCapMs: number
  stepMs: number
  healthTtlMs: number
}>

/** erfc 互补误差函数近似（A&S 7.1.26，绝对误差 ≲1.5e−7）。 */
export function erfc(x: number): number

export interface PhiOptions {
  threshold?: number
  minSamples?: number
  minStdDeviationMs?: number
  windowSize?: number
  phiCap?: number
  now?: () => number
}

export interface PhiHeartbeat {
  heartbeats: number
  samples: number
  gap: number | null
  mean: number | null
  stddev: number | null
}

export interface PhiSnapshot {
  strategy: 'phiAccrual'
  threshold: number
  minSamples: number
  minStdDeviationMs: number
  windowSize: number
  phiCap: number
  samples: number
  heartbeats: number
  intervalsSeen: number
  lastHeartbeatAt: number | null
  gap: number | null
  mean: number | null
  stddev: number | null
  effectiveStddev: number | null
  lastGap: number | null
  phi: number
  suspect: boolean
  intervals: (number | null)[]
  complexity: string
}

/** ① φ-accrual 故障检测器：连续量疑难度，替代硬超时。 */
export interface PhiDetector {
  heartbeat(t?: number): PhiHeartbeat
  phi(t?: number): number
  suspect(t?: number): boolean
  snapshot(t?: number): PhiSnapshot
  state(t?: number): PhiSnapshot
  reset(): void
  intervals(): number[]
  readonly: boolean
  readonly threshold: number
  readonly samples: number
  readonly mean: number | null
  readonly stddev: number | null
  readonly lastAt: number | null
}

export function createPhiAccrualDetector(opts?: PhiOptions): PhiDetector

export type SwimState = 'alive' | 'suspected' | 'faulty'

export interface MemberState {
  id: string
  state: SwimState
  incarnation: number
  suspectAt: number | null
}

export interface SwimOptions {
  probeIntervalMs?: number
  suspicionMult?: number
  retransmitLimit?: number
  now?: () => number
  rand?: () => number
}

export interface StateChange { changed: boolean; state: SwimState | null; incarnation?: number; created?: boolean }
export interface ProbeResult {
  target: string
  alive: boolean
  via: 'direct' | 'indirect' | 'suspected'
  attempts: number
  relay?: string
  refuted?: boolean
  suspected?: boolean
}
export interface GossipResult { applied: boolean; state?: SwimState; incarnation?: number; reason?: string }
export interface SwimStats {
  alive: number
  suspected: number
  faulty: number
  total: number
  probes: number
  directFailures: number
  indirectAttempts: number
  indirectRescues: number
  refutations: number
  confirmations: number
  gossipsApplied: number
  gossipsStale: number
  suspicionTimeoutMs: number
  retransmitLimit: number
}
export interface SwimSnapshot extends SwimStats {
  strategy: 'swim'
  probeIntervalMs: number
  suspicionMult: number
  members: MemberState[]
  builtAt: number
}

/** ② SWIM 三态成员协议：间接探测反证 + incarnation 单调合并 + 怀疑超时确认。 */
export interface SwimMembership {
  add(id: string, incarnation?: number, t?: number): { added: boolean; state: SwimState }
  remove(id: string): { removed: boolean }
  has(id: string): boolean
  state(id: string): MemberState | null
  suspect(id: string, t?: number): StateChange
  alive(id: string, t?: number): StateChange
  dead(id: string): StateChange
  probeIndirect(
    id: string,
    relays?: string[],
    probeFn?: (target: string, kind: 'direct' | 'indirect', relay?: string) => boolean,
    t?: number,
  ): ProbeResult
  applyGossip(update: { id?: string; state?: SwimState; incarnation?: number }, t?: number): GossipResult
  reap(t?: number): string[]
  pickTarget(): string | null
  states(): MemberState[]
  counts(): { alive: number; suspected: number; faulty: number; total: number }
  stats(): SwimStats
  snapshot(t?: number): SwimSnapshot
  reset(): void
  readonly suspicionTimeoutMs: number
}

export function createSwimMembership(opts?: SwimOptions): SwimMembership

export interface HealthViewOptions {
  membership?: SwimMembership
  threshold?: number
  minSamples?: number
  minStdDeviationMs?: number
  windowSize?: number
  ttlMs?: number
  now?: () => number
  key?: string
  cache?: { get(k: string): any; set(k: string, v: any, ttlMs?: number): any; command(cmd: string, ...args: any[]): any; reset(): void; stats(): Record<string, any> }
}

export interface HealthyResult {
  nodes: string[]
  computedAt: number
  fromCache: boolean
  phi: Record<string, number | null>
}

export interface HealthViewStats {
  computed: number
  invalidations: number
  lastNodes: number
  cache: Record<string, any>
  ttlMs: number
  key: string
}

export interface HealthViewSnapshot extends HealthViewStats {
  strategy: 'healthView'
  nodes: string[]
  fromCache: boolean
  phi: Record<string, number | null>
  builtAt: number
}

/** ③ 健康视图缓存：φ + SWIM alive 收敛成列表，KI-493 缓存 TTL 命中，成员变更主动失效。 */
export interface HealthView {
  getHealthy(t?: number): HealthyResult
  heartbeat(id: string, t?: number): PhiHeartbeat
  phiOf(id: string, t?: number): number | null
  invalidate(): true
  stats(): HealthViewStats
  snapshot(t?: number): HealthViewSnapshot
  reset(): void
  detectors: Map<string, PhiDetector>
  readonly size: number
}

export function createHealthView(opts?: HealthViewOptions): HealthView

export interface TraceOptions {
  stableCount?: number
  baseIntervalMs?: number
  spikeGapMs?: number
  spikeCount?: number
  faultCapMs?: number
}
export interface Trace { intervals: number[]; labels: string[]; spikes: number }
export function defaultTrace(opts?: TraceOptions): Trace

export interface DecisionPoint {
  i: number
  gap: number | null
  label: string
  phi: number
  fixedSuspect: boolean
  phiSuspect: boolean
}
export interface ComparisonVerdict {
  fixedOverReactsToJitter: boolean
  phiReducesFalsePositives: boolean
  bothDetectRealFailure: boolean
  fixedFasterButNoisier: boolean
  phiAdaptiveToHistory: boolean
  phiNeverExceedsCap: boolean
}
/**
 * 对照选项。extend PhiOptions 拿阈值/窗口参数；未显式给 intervals 时，下列轨迹生成字段会透传给
 * defaultTrace（与实现 `defaultTrace(opts)` 读取的字段逐字对应，不遗漏 stableCount/spikeCount 等）。
 */
export interface CompareOptions extends PhiOptions, TraceOptions {
  intervals?: number[]
  labels?: string[]
  fixedTimeoutMs?: number
  faultCapMs?: number
  stepMs?: number
  now?: () => number
}
export interface FixedVsPhiComparison {
  trace: { count: number; spikes: number; faultCapMs: number; labels: string[] }
  fixed: { timeoutMs: number; falsePositives: number; truePositives: number; detectionLatencyMs: number | null }
  phi: { threshold: number; falsePositives: number; truePositives: number; maxPhi: number; detectionLatencyMs: number | null; cap: number }
  adaptation: {
    delayMs: number | null
    steadyPhi: number
    jitteryPhi: number
    jitteryMoreTolerant: boolean
    steadyMean: number | null
    steadyStddev: number | null
    jitteryMean: number | null
    jitteryStddev: number | null
  }
  verdict: ComparisonVerdict
  decisions: DecisionPoint[]
}

/** ④ 固定超时 vs φ 核心对照：误报/真报/检测延迟 + 自适应对照 + 六句判词。 */
export function compareFixedVsPhi(opts?: CompareOptions): FixedVsPhiComparison

export interface StudyOptions {
  now?: () => number
  compare?: CompareOptions
  swim?: { probeIntervalMs?: number; suspicionMult?: number; retransmitLimit?: number }
  health?: { ttlMs?: number }
}
export interface FailureDetectorStudy {
  comparison: FixedVsPhiComparison
  swim: SwimSnapshot & {
    script: {
      directAlive: boolean
      indirectRescued: boolean
      suspectAfterTotalFailure: boolean
      gossipRefuted: boolean
      reaped: string[]
    }
  }
  health: {
    firstNodes: string[]
    firstFromCache: boolean
    secondFromCache: boolean
    thirdFromCache: boolean
    excluded: string[]
    stats: HealthViewStats
  }
  builtAt: number
}

/** ⑤ 真跑对照 + SWIM 脚本 + 健康视图读数汇成纯数据 study（确定性、无真 socket）。 */
export function failureDetectorStudy(opts?: StudyOptions): Promise<FailureDetectorStudy>

export interface FdSnapshot {
  threshold: number
  fixedTimeoutMs: number
  fixed: { falsePositives: number; truePositives: number; detectionLatencyMs: number | null }
  phi: { falsePositives: number; truePositives: number; detectionLatencyMs: number | null; maxPhi: number; cap: number }
  adaptation: FixedVsPhiComparison['adaptation']
  verdict: ComparisonVerdict
  curve: DecisionPoint[]
  swim: {
    counts: { alive: number; suspected: number; faulty: number; total: number }
    probes: number
    indirectRescues: number
    refutations: number
    confirmations: number
    gossipsApplied: number
    gossipsStale: number
    suspicionTimeoutMs: number
    script: { directAlive: boolean; indirectRescued: boolean; suspectAfterTotalFailure: boolean; gossipRefuted: boolean; reaped: string[] }
    members: MemberState[]
  }
  health: {
    nodes: string[]
    excluded: string[]
    firstFromCache: boolean
    secondFromCache: boolean
    thirdFromCache: boolean
    computed: number
    invalidations: number
    hitRate: number | null
    ttlMs: number
  }
  builtAt: number
}

/** 把 study 收敛成前端 / status 友好的纯数据快照。 */
export function fdSnapshot(study: FailureDetectorStudy): FdSnapshot
