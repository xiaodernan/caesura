/** `scripts/caesura-console-gen.mjs` 的声明：前端集大成控制台真 E2E 数据生成器（P8 / KI-495）。 */

export const SCENARIO_IDS: string[]
export const SCENARIO_TITLES: Record<string, string>

export interface ConsoleHighlights {
  services: number | null
  spanCount: number | null
  canaryHits: number | null
  cacheHitRate: number | null
  timedOut: number | null
  cwnd: number | null
  rto: number | null
}

export interface ConsoleScenario {
  id: string
  title: string
  ok: boolean
  [k: string]: any
}

export interface LsmReading {
  keys: number
  flushes: number
  compactions: number
  mergedAway: number
  tombstonesDropped: number
  bloomRejects: number
  comparisons: number
  scanBaselineComparisons: number
  speedup: number | null
  levels: Array<{ level: number; segments: number; entries: number }>
}

export interface HwReading {
  allocation: { accesses: number; naiveCreated: number; poolCreated: number; saved: number; reuseRate: number | null }
  cacheLine: { paddedFalseSharing: number; packedFalseSharing: number; paddingOverhead: number | null }
  layout: {
    sequential: { aosMisses: number; soaMisses: number; speedup: number | null }
    strided: { stride: number; aosMisses: number; soaMisses: number; speedup: number | null }
  }
}

/** KI-501：与 LSM/HW 并列的第三维「缓存防护」读数（击穿/穿透/雪崩三件套结构计数）。 */
export interface GuardsReading {
  stampede: {
    concurrency: number
    naiveLoads: number
    singleflightLoads: number
    savedLoads: number
    amplification: number | null
    xfetchAvoidedMisses: number
  }
  penetration: {
    absent: number
    rounds: number
    naiveDbHits: number
    negativeDbHits: number
    bloomDbHits: number
    bloomRejected: number
    bloomFalsePositives: number | null
    bloomSavedRate: number | null
  }
  avalanche: {
    keys: number
    buckets: number
    uniformPeak: number
    jitterPeak: number
    peakReduction: number | null
    uniformBuckets: number
    jitterBuckets: number
    histogram: { uniform: number[]; jitter: number[] }
  }
}

/** KI-502：网关限流算法族读数（五算法突发对照 + Redis 原子 vs 非原子超发 + 跨实例共享）。 */
export interface RateLimitReading {
  limit: number
  windowMs: number
  arrivals: number
  strategies: Record<'fixedWindow' | 'slidingLog' | 'slidingCounter' | 'tokenBucket' | 'leakyBucket', {
    allowed: number
    rejected: number
    maxInWindow: number
    burstRatio: number | null
    memory: string | null
  }>
  verdict: {
    fixedWindowBurst: boolean
    slidingBounded: boolean
    tokenControlled: boolean
    leakySteady: boolean
    counterIsO1: boolean
  }
  redis: {
    concurrency: number
    capacity: number
    atomicAllowed: number
    nonAtomicAllowed: number
    overshoot: number
    atomicBounded: boolean
    nonAtomicOverran: boolean
    shared: { key: string; aRemaining: number | null; bSeenRemaining: number | null; consistent: boolean }
  }
}

/** KI-503：服务故障检测读数（固定超时 vs φ 对照 + SWIM 三态成员协议 + 健康视图 TTL 缓存）。 */
export interface FailureDetectorReading {
  threshold: number
  fixedTimeoutMs: number
  fixed: { falsePositives: number; truePositives: number; detectionLatencyMs: number | null }
  phi: { falsePositives: number; truePositives: number; detectionLatencyMs: number | null; maxPhi: number; cap: number }
  adaptation: { delayMs: number | null; steadyPhi: number; jitteryPhi: number; jitteryMoreTolerant: boolean; steadyMean: number | null; steadyStddev: number | null; jitteryMean: number | null; jitteryStddev: number | null }
  verdict: { fixedOverReactsToJitter: boolean; phiReducesFalsePositives: boolean; bothDetectRealFailure: boolean; fixedFasterButNoisier: boolean; phiAdaptiveToHistory: boolean; phiNeverExceedsCap: boolean }
  curve: Array<{ i: number; gap: number | null; label: string; phi: number; fixedSuspect: boolean; phiSuspect: boolean }>
  swim: {
    counts: { alive: number; suspected: number; faulty: number; total: number }
    indirectRescues: number
    confirmations: number
    suspicionTimeoutMs: number
    script: { directAlive: boolean; indirectRescued: boolean; suspectAfterTotalFailure: boolean; gossipRefuted: boolean; reaped: string[] }
    members: Array<{ id: string; state: string; incarnation: number; suspectAt: number | null }>
  }
  health: { nodes: string[]; excluded: string[]; firstFromCache: boolean; secondFromCache: boolean; thirdFromCache: boolean; computed: number; invalidations: number; hitRate: number | null; ttlMs: number }
}

/** KI-498 + KI-501 + KI-502 + KI-503：与五场景并列的独立「系统读数」数据块（LSM + OS/硬件 + 缓存防护 + 网关限流 + 故障检测）。 */
export interface SystemsBlock {
  lsm: LsmReading | null
  hw: HwReading | null
  guards: GuardsReading | null
  rateLimit: RateLimitReading | null
  failureDetector: FailureDetectorReading | null
  builtAt: number
}

export interface ConsoleSnapshot {
  schema: number
  generatedAt: number
  generator: string
  scenarios: ConsoleScenario[]
  highlights: ConsoleHighlights
  /** KI-498：可空；`systems:false` 生成时为 null，缺块时 lsm/hw 各自为 null。 */
  systems: SystemsBlock | null
}

export interface E2ERunner {
  run(): Promise<any>
  gc?: any
}

export function buildSnapshot(opts?: {
  runner?: (scenarioId: string) => E2ERunner
  now?: () => number
  driveNet?: boolean
  /** KI-498：false 关掉 systems 块（兼容旧快照/确定性单测）；缺省真跑三维系统读数。 */
  systems?: boolean
  lsmKeys?: number
  poolAccesses?: number
  layoutCount?: number
  /** KI-501：false 关掉缓存防护维（兼容旧快照）；guardConcurrency/guardKeys 注入规模。 */
  guards?: boolean
  guardConcurrency?: number
  guardKeys?: number
  /** KI-502：false 关掉网关限流维（兼容旧快照）；rlConcurrency/rlCapacity/rlWindowMs 注入规模。 */
  rateLimit?: boolean
  rlConcurrency?: number
  rlCapacity?: number
  rlWindowMs?: number
  /** KI-503：false 关掉故障检测维（兼容旧快照）；fdStableCount/fdSpikeCount 注入轨迹规模。 */
  failureDetector?: boolean
  fdStableCount?: number
  fdSpikeCount?: number
}): Promise<ConsoleSnapshot>

/** KI-498 + KI-501 + KI-502 + KI-503：真跑 LSM + OS/硬件 + 缓存防护 + 网关限流 + 故障检测五维系统读数；击穿并发 ⇒ async。 */
export function buildSystems(opts?: {
  now?: () => number
  lsmKeys?: number
  poolAccesses?: number
  layoutCount?: number
  guards?: boolean
  guardConcurrency?: number
  guardKeys?: number
  rateLimit?: boolean
  rlConcurrency?: number
  rlCapacity?: number
  rlWindowMs?: number
  failureDetector?: boolean
  fdStableCount?: number
  fdSpikeCount?: number
}): Promise<SystemsBlock>

/** KI-501：真跑缓存防护三件套（击穿/穿透/雪崩）收敛成前端三面板紧凑读数；单维失败落 null。 */
export function buildGuardsReading(opts: {
  now?: () => number
  guards?: boolean
  guardConcurrency?: number
  guardKeys?: number
}, now: () => number): Promise<GuardsReading | null>

/** KI-502：真跑网关限流族（五算法突发对照 + Redis 原子/非原子超发）收敛成前端紧凑读数；失败落 null。 */
export function buildRateLimitReading(opts: {
  now?: () => number
  rateLimit?: boolean
  rlConcurrency?: number
  rlCapacity?: number
  rlWindowMs?: number
}, now: () => number): Promise<RateLimitReading | null>

/** KI-503：真跑故障检测器（固定 vs φ 对照 + SWIM 三态 + 健康视图）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildFailureDetectorReading(opts: {
  now?: () => number
  failureDetector?: boolean
  fdStableCount?: number
  fdSpikeCount?: number
}, now: () => number): Promise<FailureDetectorReading | null>

export function realScenarioOpts(id: string): Record<string, any>

export function normalizeScenario(id: string, gc: any, r: any): ConsoleScenario

export function driveNetSeries(net: any): any | null

export function cwndSeries(history: any): Array<{ step: number; cwnd: number | null; event: string | null; mode: string | null }>

export function deriveHighlights(scenarios: ConsoleScenario[]): ConsoleHighlights
