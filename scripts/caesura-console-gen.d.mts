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

/** KI-504：B+ 树索引读数（真 B+ 树 vs LSM 三笔账：点查比较数 / 范围叶链顺序扫 / 写放大 + 正确性对账）。 */
export interface BplusReading {
  config: { keys: number; probes: number; rangeQueries: number; order: number; fanout: number; leafCapacity: number; overwriteEvery: number; lsmMemtableMax: number }
  structure: { height: number; heightEstimate: number; leafCount: number; nodeCount: number; order: number; fanout: number; invariants: number; heightLadder: Array<{ order: number; fanout: number; heightEstimate: number }> }
  point: { bplusComparisons: number; lsmComparisons: number; favors: 'bplus' | 'lsm' | 'tie' }
  range: { bplusCost: number; lsmCost: number; bplusLeafHops: number; bplusResults: number; lsmSegments: number; lsmSortComparisons: number; lsmResults: number; favors: 'bplus' | 'lsm' | 'tie' }
  write: { bplusPageRewrites: number; bplusSplits: number; bplusMerges: number; bplusBorrows: number; lsmSeqWriteUnits: number; lsmFlushes: number; lsmCompactions: number; lsmMergedAway: number; favors: 'bplus' | 'lsm' | 'tie' }
  levels: Array<{ level: number; segments: number; entries: number }>
  agreement: { pointMismatches: number; rangeMismatches: number; bothAgree: boolean }
  verdict: Record<string, boolean | string>
}

/** KI-505：事务与并发控制读数（五档隔离 × 五类异常矩阵 + 死锁环检测 + 2PL + gc 水位 + 不封全局赢家判词）。 */
export interface MvccTxnReading {
  config: { levels: string[]; anomalies: string[] }
  levels: Array<{
    short: string
    label: string
    anomalies: Record<string, { observed: boolean; label: string }>
    observedCount: number
    preventedCount: number
    aborted: number
  }>
  deadlock: { graph: Record<string, string[]>; detected: boolean; cycle: string[]; resolved: boolean; victim: string | null; acyclicProbeNoCycle: boolean; stats: Record<string, any> }
  twoPhaseLock: { lateAcquireBlocked: boolean; reason: string; stats: Record<string, any> }
  gc: { versions: number; longWaterMark: Record<string, any>; cleanWaterMark: Record<string, any>; longTxnRetainsMoreVersions: boolean }
  store: Record<string, any>
  verdict: Record<string, boolean>
}

/** KI-506：分布式事务读数（2PC 阻塞 / Saga 补偿留脏 / TCC 三阶段幂等 × 六场景矩阵 + 三难判词 + 不封赢家）。 */
export interface DistributedTxnReading {
  config: { protocols: string[]; scenarios: Array<{ id: string; label: string }> }
  rows: Array<{
    protocol: string
    label: string
    intrusion: number
    isolation: boolean
    trilemma: { noBlock: boolean; noDirty: boolean; lowIntrusion: boolean }
    totals: { committed: number; aborted: number; blocked: number; dirty: number; retries: number; messages: number }
    scenarios: Array<{
      id: string
      label: string
      protocol: string
      scenario: string
      committed: boolean
      aborted: boolean
      blocked: number
      dirty: number
      retries: number
      messages: number
      isolation: boolean
      intrusion: number
      atomic: boolean
      detail: Record<string, any>
    }>
  }>
  idempotency: Record<string, any>
  sagaOrder: Record<string, any>
  tccRetry: Record<string, any>
  verdict: Record<string, boolean>
}

/** KI-507：Raft 共识读数（Raft 单 leader 强一致 / 多主复制 / Gossip 反熵 × 六场景矩阵 + 三难判词 + 不封赢家）。 */
export interface RaftConsensusReading {
  config: { protocols: string[]; scenarios: Array<{ id: string; label: string }> }
  rows: Array<{
    protocol: string
    label: string
    trilemma: { linearizable: boolean; partitionAvailable: boolean; boundedConvergence: boolean }
    totals: { committed: number; blockedWrites: number; staleReads: number; conflicts: number; messages: number; diverged: number }
    scenarios: Array<{
      id: string
      label: string
      protocol: string
      scenario: string
      committed: boolean
      blockedWrites: number
      staleReads: number
      conflicts: number
      converged: boolean
      linearizable: boolean
      messages: number
      terms: number
      rounds: number
      detail: Record<string, any>
    }>
  }>
  election: Record<string, any>
  replication: Record<string, any>
  safety: Record<string, any>
  gossip: Record<string, any>
  verdict: Record<string, boolean>
}

/** KI-508：分布式锁读数（单 Redis SETNX+TTL / Redlock 多数派 / etcd Lease+Fencing × 六场景矩阵 + 三难判词 + 不封赢家）。 */
export interface DistributedLockReading {
  config: { protocols: string[]; scenarios: Array<{ id: string; label: string }> }
  rows: Array<{
    protocol: string
    label: string
    trilemma: { mutualExclusion: boolean; partialFaultTolerance: boolean; lowLatency: boolean }
    totals: { acquired: number; doubleOwners: number; dirtyWrites: number; blockedAcquires: number; staleWritesRejected: number; messages: number; fencedCount: number }
    scenarios: Array<{
      id: string
      label: string
      protocol: string
      scenario: string
      acquired: boolean
      doubleOwners: number
      dirtyWrites: number
      blockedAcquires: number
      staleWritesRejected: number
      fencedProtected: boolean
      mutualExcluded: boolean
      converged: boolean
      messages: number
      latency: number
      quorum: number
      rounds: number
      detail: Record<string, any>
    }>
  }>
  setnx: Record<string, any>
  redlock: Record<string, any>
  fencing: Record<string, any>
  verdict: Record<string, boolean>
}

/** KI-509：分布式 ID 三协议（UUIDv4 / Snowflake / Redis 号段）六场景矩阵 + 三难判词 + KI-504 真树交叉印证。 */
export interface IdGenReading {
  config: { protocols: string[]; scenarios: Array<{ id: string; label: string }> }
  rows: Array<{
    protocol: string
    label: string
    trilemma: { indexFriendly: boolean; decentralized: boolean; clockRobust: boolean }
    totals: { issued: number; unique: number; duplicates: number; stalled: number; pageSplits: number; comparisons: number; wastedIds: number; centerRounds: number; waits: number; messages: number }
    scenarios: Array<{
      id: string
      label: string
      protocol: string
      scenario: string
      issued: number
      unique: number
      duplicates: number
      stalled: number
      clockRollbacks: number
      waits: number
      pageSplits: number
      comparisons: number
      cmpBaseline: number
      wastedIds: number
      centerRounds: number
      messages: number
      latency: number
      indexFriendly: boolean
      decentralized: boolean
      clockRobust: boolean
      uniqueIds: boolean
      contiguous: boolean
      detail: Record<string, any>
    }>
  }>
  uuid: Record<string, any>
  snowflake: Record<string, any>
  segment: Record<string, any>
  /** KI-504 真 B+ 树交叉印证：随机 vs 顺序主键的定位比较/splits 结构计数。 */
  btree: Record<string, any>
  verdict: Record<string, boolean>
}

/** KI-498 + KI-501 + KI-502 + KI-503 + KI-504 + KI-505 + KI-506 + KI-507 + KI-508 + KI-509：与五场景并列的独立「系统读数」数据块（LSM + OS/硬件 + 缓存防护 + 网关限流 + 故障检测 + B+ 树索引 + 事务并发控制 + 分布式事务 + Raft 共识 + 分布式锁 + 分布式 ID）。 */
export interface SystemsBlock {
  lsm: LsmReading | null
  hw: HwReading | null
  guards: GuardsReading | null
  rateLimit: RateLimitReading | null
  failureDetector: FailureDetectorReading | null
  bplusIndex: BplusReading | null
  mvccTxn: MvccTxnReading | null
  distributedTxn: DistributedTxnReading | null
  raftConsensus: RaftConsensusReading | null
  distributedLock: DistributedLockReading | null
  idGen: IdGenReading | null
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
  /** KI-504：false 关掉 B+ 树索引维（兼容旧快照）；bpKeyCount/bpOrder/bpLeafCapacity 注入规模。 */
  bplusIndex?: boolean
  bpKeyCount?: number
  bpOrder?: number
  bpLeafCapacity?: number
  /** KI-505：false 关掉事务并发控制维（兼容旧快照）；mvGcVersions 注入版本链规模。 */
  mvccTxn?: boolean
  mvGcVersions?: number
  /** KI-506：false 关掉分布式事务维（兼容旧快照）；dtxnRetries 注入 Confirm 失败次数。 */
  distributedTxn?: boolean
  dtxnRetries?: number
  /** KI-507：false 关掉 Raft 共识维（兼容旧快照）；rcRounds 注入反熵轮数。 */
  raftConsensus?: boolean
  rcRounds?: number
  /** KI-508：false 关掉分布式锁维（兼容旧快照）；dlockInstances 注入 Redlock 实例数。 */
  distributedLock?: boolean
  dlockInstances?: number
  /** KI-509：false 关掉分布式 ID 维（兼容旧快照）；idGenKeyCount/idGenTreeOrder 注入 KI-504 真树交叉印证规模。 */
  idGen?: boolean
  idGenKeyCount?: number
  idGenTreeOrder?: number
}): Promise<ConsoleSnapshot>

/** KI-498 + KI-501 + KI-502 + KI-503 + KI-504 + KI-505 + KI-506 + KI-507 + KI-508 + KI-509：真跑 LSM + OS/硬件 + 缓存防护 + 网关限流 + 故障检测 + B+ 树索引 + 事务并发控制 + 分布式事务 + Raft 共识 + 分布式锁 + 分布式 ID 十一维系统读数；击穿并发 ⇒ async。 */
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
  bplusIndex?: boolean
  bpKeyCount?: number
  bpOrder?: number
  bpLeafCapacity?: number
  /** KI-505：false 关掉事务并发控制维（兼容旧快照）；mvGcVersions 注入版本链规模。 */
  mvccTxn?: boolean
  mvGcVersions?: number
  /** KI-506：false 关掉分布式事务维（兼容旧快照）；dtxnRetries 注入 Confirm 失败次数。 */
  distributedTxn?: boolean
  dtxnRetries?: number
  /** KI-507：false 关掉 Raft 共识维（兼容旧快照）；rcRounds 注入反熵轮数。 */
  raftConsensus?: boolean
  rcRounds?: number
  /** KI-508：false 关掉分布式锁维（兼容旧快照）；dlockInstances 注入 Redlock 实例数。 */
  distributedLock?: boolean
  dlockInstances?: number
  /** KI-509：false 关掉分布式 ID 维（兼容旧快照）；idGenKeyCount/idGenTreeOrder 注入 KI-504 真树交叉印证规模。 */
  idGen?: boolean
  idGenKeyCount?: number
  idGenTreeOrder?: number
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

/** KI-504：真跑 B+ 树索引（真 B+ 树 vs LSM 三笔账 + 正确性对账）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildBplusReading(opts: {
  now?: () => number
  bplusIndex?: boolean
  bpKeyCount?: number
  bpOrder?: number
  bpLeafCapacity?: number
}, now: () => number): Promise<BplusReading | null>

/** KI-505：真跑事务并发控制（五档隔离异常矩阵 + 死锁环检测 + 2PL + gc 水位）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildMvccTxnReading(opts: {
  now?: () => number
  mvccTxn?: boolean
  mvGcVersions?: number
}, now: () => number): Promise<MvccTxnReading | null>

/** KI-506：真跑分布式事务（2PC 阻塞 / Saga 补偿留脏 / TCC 三阶段幂等 × 六场景矩阵 + 三难判词）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildDistributedTxnReading(opts: {
  now?: () => number
  distributedTxn?: boolean
  dtxnRetries?: number
}, now: () => number): Promise<DistributedTxnReading | null>

/** KI-507：真跑 Raft 共识（Raft 单 leader / 多主复制 / Gossip 反熵 × 六场景矩阵 + 三难判词）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildRaftConsensusReading(opts: {
  now?: () => number
  raftConsensus?: boolean
  rcRounds?: number
}, now: () => number): Promise<RaftConsensusReading | null>

/** KI-508：真跑分布式锁（单 Redis SETNX+TTL / Redlock 多数派 / etcd Lease+Fencing × 六场景矩阵 + 三难判词）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildDistributedLockReading(opts: {
  now?: () => number
  distributedLock?: boolean
  dlockInstances?: number
}, now: () => number): Promise<DistributedLockReading | null>

/** KI-509：真跑分布式 ID（UUIDv4 / Snowflake / Redis 号段 × 六场景矩阵 + 三难判词 + KI-504 真 B+ 树交叉印证）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildIdGenReading(opts: {
  now?: () => number
  idGen?: boolean
  idGenKeyCount?: number
  idGenTreeOrder?: number
}, now: () => number): Promise<IdGenReading | null>

export function realScenarioOpts(id: string): Record<string, any>

export function normalizeScenario(id: string, gc: any, r: any): ConsoleScenario

export function driveNetSeries(net: any): any | null

export function cwndSeries(history: any): Array<{ step: number; cwnd: number | null; event: string | null; mode: string | null }>

export function deriveHighlights(scenarios: ConsoleScenario[]): ConsoleHighlights
