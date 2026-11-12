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

/** KI-510：分布式限流三协议（本地桶 / Redis 中心桶 / 一致性哈希分片桶）六场景矩阵 + 三难判词 + 真 Redis 原子桶/真环交叉印证。 */
export interface DistributedRateLimitReading {
  config: Record<string, any>
  rows: Array<{
    protocol: string
    trilemma: { globalExact: boolean; partialFaultTolerance: boolean; noCenterRTT: boolean }
    totals: { allowed: number; rejected: number; overAllowed: number; centerRounds: number; fragmented: number }
    scenarios: Array<{
      id: string
      allowed: number
      rejected: number
      overAllowed: number
      centerRounds: number
      fragmented: number
      isolatedFailures: number
      degradedShard: number
      hotKeyHits: number
      centerStalled: number
      globalExact: boolean
      partialFaultTolerance: boolean
      noCenterRTT: boolean
    }>
  }>
  vectors: Record<string, string>
  crosscheck: {
    central: { source: string; concurrency: number; atomicAllowed: number; nonAtomicAllowed: number; atomicExact: boolean; nonAtomicOvershoot: number }
    sharded: Record<string, any>
  }
  verdict: Record<string, any>
  topology: Record<string, any>
  builtAt: number
}

/** KI-511：分布式配置一致性三协议（轮询 / 长轮询 / watch 推送）六场景矩阵 + 三难判词 + 真 Config响应/watcher/bus/hashSelector/XFetch/RedisTTL/环交叉印证。 */
export interface ConfigConsistencyReading {
  config: Record<string, any>
  rows: Array<{
    protocol: string
    trilemma: { degradeOnCenterDown: boolean; noIdleOverhead: boolean; instantPerceive: boolean }
    totals: {
      perceivedDelaySum: number; idleFetches: number; connections: number; reconnects: number
      versionGaps: number; staleClients: number; degradedScenarios: number; centerBrokenScenarios: number
    }
    scenarios: Array<{
      id: string; clients: number; detectedAt: number | null; perceivedDelay: number
      idleFetches: number; connections: number; reconnects: number; versionGaps: number
      staleClients: number; degraded: boolean; centerBroken: boolean; changes: number; coalesced: number
      degradeOnCenterDown: boolean; noIdleOverhead: boolean; instantPerceive: boolean
    }>
  }>
  vectors: Record<string, string>
  crosscheck: {
    configServer: Record<string, any>
    configWatcher: Record<string, any>
    bus: Record<string, any>
    gray: Record<string, any>
    guard: Record<string, any>
    redisCache: Record<string, any>
    ring: Record<string, any>
  }
  verdict: Record<string, any>
  topology: Record<string, any>
  builtAt: number
}

/** KI-512：缓存读写一致性三协议（Cache-Aside / Write-Through / Write-Behind）六场景矩阵 + 三难判词 + 七枚真件交叉印证。 */
export interface CacheCoherencyReading {
  config: Record<string, any>
  rows: Array<{
    protocol: string
    trilemma: { readYourWrites: boolean; noWriteBlocking: boolean; durableOnCrash: boolean }
    totals: {
      staleWindowMsSum: number; staleReads: number; writeBackendRounds: number; writeBackendRttMs: number
      dirtyPagesLost: number; coalescedWrites: number; crashedScenarios: number
    }
    scenarios: Array<{
      id: string; writes: number; keyN: number; staleWindowMs: number; staleReads: number
      writeBackendRounds: number; writeBackendRttMs: number; dirtyPagesLost: number; dirtyPagesPending: number
      flushLagMs: number; coalescedWrites: number; walEnabled: boolean; crossNodeReplicated: boolean; crashed: boolean
      readYourWrites: boolean; noWriteBlocking: boolean; durableOnCrash: boolean
    }>
  }>
  vectors: Record<string, string>
  crosscheck: {
    redis: Record<string, any>
    wal: Record<string, any>
    guard: Record<string, any>
    sharded: Record<string, any>
    mvcc: Record<string, any>
    twoPhase: Record<string, any>
    ring: Record<string, any>
  }
  verdict: Record<string, any>
  topology: Record<string, any>
  builtAt: number
}

/** KI-513：消息投递语义三协议（At-Most-Once / At-Least-Once / Exactly-Once）六场景矩阵 + 三难判词 + 七枚真件交叉印证。 */
export interface MessageDeliveryReading {
  config: Record<string, any>
  rows: Array<{
    protocol: string
    trilemma: { noLoss: boolean; noDup: boolean; lowOverhead: boolean }
    totals: {
      sent: number; delivered: number; lost: number; duplicates: number; retries: number
      overheadUnits: number; idempotentHits: number; crashScenarios: number
    }
    scenarios: Array<{
      id: string; sent: number; delivered: number; lost: number; duplicates: number; retries: number
      overheadUnits: number; idempotentHits: number; crashProbable: boolean; ackLostProbable: boolean
      noLoss: boolean; noDup: boolean; lowOverhead: boolean
    }>
  }>
  vectors: Record<string, string>
  crosscheck: {
    bus: Record<string, any>
    gameEventBus: Record<string, any>
    bridge: Record<string, any>
    twoPhase: Record<string, any>
    wal: Record<string, any>
    redis: Record<string, any>
    ring: Record<string, any>
  }
  verdict: Record<string, any>
  topology: Record<string, any>
  builtAt: number
}

/** KI-518：延迟消息队列调度三协议（TimingWheel / MinHeap / RedisZset）六场景矩阵 + 三难向量 + 七枚真件交叉印证。形状与 messageDelivery 不同构：crosscheck 只有 evidence 一块。 */
export interface DelayQueueReading {
  config: Record<string, any>
  rows: Array<{
    protocol: string
    scenarios: Array<{
      id: string; protocol: string; fired: number; lateMs: number; duplicatePickups: number
      lostOnRestart: number; opUnits: number; lowCost: boolean; punctual: boolean; sharedDurable: boolean
    }>
    totals: { fired: number; lateMs: number; duplicatePickups: number; lostOnRestart: number; opUnits: number }
    trilemma: { lowCost: boolean; punctual: boolean; sharedDurable: boolean }
  }>
  vectors: Record<string, string>
  crosscheck: {
    evidence: {
      hashRingNodes: number; hashRingEmptyNodes: number; redisEntries: number; walLines: number
      busDelivered: number; tokenBucketOk: boolean; bplusRangeCount: number; poolAcquired: number
    }
  }
  verdict: Record<string, any>
  topology: Record<string, string>
  builtAt: number
}

/** KI-520：消息重试退避 × 死信队列三协议（Immediate / Exponential / FullJitter × 六场景 + 三难向量 + 七枚真件交叉印证）收敛成前端两面板紧凑读数；失败落 null。 */
export interface RetryDlqReading {
  config: Record<string, any>
  rows: Array<{
    protocol: string
    scenarios: Array<{
      id: string; protocol: string; delivered: number; retries: number; deadLettered: number
      stormPerMsg: number; herdPeaks: number; herdRatio: number; peakConcurrency: number; recoveryLag: number
      fastRecovery: boolean; noStorm: boolean; noHerd: boolean; fault: string
    }>
    totals: { delivered: number; retries: number; deadLettered: number; stormPerMsg: number; herdPeaks: number; recoveryLag: number }
    trilemma: { fastRecovery: boolean; noStorm: boolean; noHerd: boolean }
  }>
  vectors: Record<string, string>
  crosscheck: {
    evidence: {
      heapFired: number; bucketAllowed: number; bucketRejected: number; walLines: number; walReplayed: number
      hashRingNodes: number; hashRingEmptyNodes: number; idemEntries: number
      deadNotices: number; busListeners: number; poolAcquired: number
    }
  }
  verdict: Record<string, any>
  topology: Record<string, string>
  builtAt: number
}

/** KI-523：消费者组 rebalance / 分区所有权三协议真跑读数（Range / RoundRobin / Sticky × 六场景 + 三难向量 + 九枚真件交叉印证）。 */
export interface ConsumerGroupReading {
  config: Record<string, any>
  rows: Array<{
    protocol: string
    scenarios: Array<{
      id: string; protocol: string; consumers: number; partitions: number; imbalance: number
      starved: boolean; moveRate: number; opUnits: number; opPerPart: number; loads: number[]; fault: string
      balanced: boolean; minimalMovement: boolean; cheap: boolean
    }>
    trilemma: { balanced: boolean; minimalMovement: boolean; cheap: boolean }
    metrics: { avgImbalance: number; starved: boolean; moveSum: number; opPerPart: number }
  }>
  vectors: Record<string, string>
  crosscheck: {
    evidence: {
      remapConsistentRate: number; remapModuloRate: number; remapSavedRate: number
      routerMoved: number; routerRate: number; hashRingNodes: number; hashRingEmptyNodes: number
      walLines: number; walReplayed: number; rebalanceNotices: number; busListeners: number
      groupMetaEntries: number; poolAcquired: number; bucketAllowed: number; bucketRejected: number; heapFired: number
    }
  }
  verdict: Record<string, any>
  topology: Record<string, string>
  builtAt: number
}

/** KI-525：消费者组积压背压 / 流量削峰四策略真跑读数（Backpressure / Buffering / Shedding / Scaling × 六正交负载场景 + 三难向量 + Little's Law 双路自证 + 十一枚真件交叉印证）。 */
export interface BackpressureReading {
  config: Record<string, any>
  rows: Array<{
    strategy: string
    scenarios: Array<{
      id: string; strategy: string; arrivals: number; accepted: number; admitted: number
      rejected: number; dropped: number; served: number; endQueue: number; waitSum: number
      queueLenSum: number; avgWait: number; peakQueue: number; acceptedRate: number; muEffective: number
      backpressureTicks: number; littleLaw: Record<string, any>
      noLoss: boolean; lowLatency: boolean; highThroughput: boolean; fault: string; rebalances?: number
    }>
    trilemma: { noLoss: boolean; lowLatency: boolean; highThroughput: boolean }
    metrics: { dropped: number; rejected: number; avgWait: number; peakQueue: number; rebalances: number }
  }>
  vectors: Record<string, string>
  topology: Record<string, string>
  littleLaw: {
    steadyHolds: boolean; steadyNontrivial: boolean; overloadBreaks: boolean
    steady: Array<Record<string, any>>; overload: Array<Record<string, any>>; note: string
  }
  crosscheck: { evidence: Record<string, number | boolean> }
  verdict: Record<string, any>
  builtAt: number
}

/** KI-526：append-only 日志压缩 / 回放边界三策略（SizeTimeRetention / KeyCompaction / SnapshotPlusWal × 六正交场景 + 三难向量 + verifyReplayBoundary 双路守恒自证 + 十一枚真件交叉印证）收敛成前端两面板紧凑读数；失败落 null。lc* = log compaction，避开 lsm/bp/bpc/cgp/rdq/dld 已占用前缀。 */
export interface LogCompactionReading {
  config: Record<string, any>
  rows: Array<{
    strategy: string
    scenarios: Array<{
      id: string; strategy: string; totalOps: number; currentLsn: number; replayFromLsn: number
      compactedOps: number; retainedOps: number; replayOps: number; missingOps: number
      writeAmplification: number; cutoffLsn: number; tombstoneResurrect: number
      snapshotLsn?: number; snapshotEmpty?: boolean; dedupSkipped?: number; exactlyOnce?: boolean
      replayBoundary: Record<string, any>
      compactFootprint: boolean; replayCompleteness: boolean; fastRecovery: boolean
      inFootprintExam: boolean; inCompletenessExam: boolean; inRecoveryExam: boolean
    }>
    trilemma: { compactFootprint: boolean; replayCompleteness: boolean; fastRecovery: boolean }
    metrics: { compactedOps: number; replayOps: number; peakWriteAmplification: number; missingOps: number; tombstoneResurrect: number }
  }>
  vectors: Record<string, string>
  topology: Record<string, string>
  replayBoundary: {
    holds: boolean; nontrivial: boolean; falsifiable: boolean
    steady: Array<Record<string, any>>
    tamper: { replayOps: Record<string, any>; walGap: Record<string, any>; tombstone: Record<string, any> }
    note: string
  }
  crosscheck: { evidence: Record<string, number | boolean | string | null> }
  verdict: Record<string, any>
  builtAt: number
}

/** KI-527：布隆/布谷鸟/计数布隆三过滤器真跑读数（Bloom / CountingBloom / Cuckoo × 六场景 + 三难向量 + verifyFalsePositiveCeiling 双路自证 + 十一枚真件交叉印证）。 */
export interface BloomFilterReading {
  config: Record<string, any>
  rows: Array<{
    protocol: string
    scenarios: Array<{
      id: string; strategy: string; inserted: number; insertFailures: number; probes: number
      falsePositives: number; correctNegatives: number; correctPositives: number
      deleteTries: number; deleteSuccess: number; deleteReinserted: number
      fpRate: number; fillRatio: number; m: number; capacity: number; bitsPerKey: number
      stashFailures: number; bytes: number; fault: string
    }>
    trilemma: { compactFootprint: boolean; insertsNeverFail: boolean; deleteSupport: boolean }
    metrics: { avgInserts: number; avgBytes: number; bitsPerKey: number; totalFpRate: number; totalInsertFailures: number; totalStashFailures: number; deleteSuccess: number; deleteAttempts: number }
  }>
  vectors: Record<string, string>
  verdict: Record<string, any>
  crosscheck: { evidence: Record<string, any>; fpCeiling: Record<string, any> }
  builtAt: number
}

/** KI-528：LRU/2Q/ARC 三替换策略真跑读数（LRU/2Q/ARC × 六场景 + 三难向量 + verifyDualSweep 双路交叉印证 + 十一枚真件交叉印证）。 */
export interface CacheReplacementReading {
  config: Record<string, any>
  rows: Array<{
    protocol: string
    scenarios: Array<{
      id: string; protocol: string; hits: number; misses: number; hitRate: number
      scanHits: number; scanMisses: number; localHits: number; localMisses: number
      amPromotions?: number; ghostHitsT1?: number; ghostHitsT2?: number; ghostAdaptMoves?: number
      adaptationP?: number
      fault: string
      scanResistance: boolean; stableHitRate: boolean; adaptiveBalance: boolean
      inScanExam: boolean; inStableExam: boolean; inAdaptiveExam: boolean
    }>
    trilemma: { scanResistance: boolean; stableHitRate: boolean; adaptiveBalance: boolean }
    metrics: { hitRateAvg: number; ghostAdaptMoves: number; amPromotions: number; adaptationP: number; prefetchSkipped?: number; effectiveCapacity?: number; trilemmaDebug?: Record<string, any> }
  }>
  vectors: Record<string, string>
  verdict: Record<string, any>
  crosscheck: { evidence: Record<string, any>; fpCeiling: Record<string, any>; dualSweep: { holds: boolean; tamper: Record<string, any> } & Record<string, any> }
  builtAt: number
}

/** KI-529：Tumbling/Sliding/Session 流式窗口聚合与 Watermark 迟到处置真跑读数（三策略 × 六场景 + 三难向量 + verifyWatermarkMonotonicity 双路交叉印证 + 十一枚真件交叉印证）。 */
export interface StreamWindowReading {
  config: Record<string, any>
  rows: Array<{
    protocol: string
    scenarios: Array<{
      id: string; protocol: string; windowCount: number; emittedWindows: number; stateReplicas: number
      rawAmplification: number; amplification: number; pairs: number; coveredPairs: number; pairCoverage: number
      lateTotal: number; lateAccepted: number; lateSideOutput: number; lateAcceptRate: number
      closeEvents: number; monotonicViolations: number; watermarkFinal: number
      fault: string
      resultCompleteness: boolean; lateTolerance: boolean; stateEfficiency: boolean
      inResultExam: boolean; inLateExam: boolean; inStateExam: boolean
    }>
    trilemma: { resultCompleteness: boolean; lateTolerance: boolean; stateEfficiency: boolean }
    metrics: { windowCount: number; emittedWindows: number; stateReplicas: number; amplificationAvg: number; pairCoverageAvg: number; lateAccepted: number; lateSideOutput: number; watermarkFinal: number; trilemmaDebug?: Record<string, any> }
  }>
  vectors: Record<string, string>
  verdict: Record<string, any>
  crosscheck: { evidence: Record<string, any>; watermark: { holds: boolean; nontrivial: boolean; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
  builtAt: number
}

/** KI-530：ExactSet/HyperLogLog/LinearCounting 基数估计算法族真跑读数（三估计器 × 六场景 + 三难向量 + verifySparseEstimate 双路交叉印证 + 十一枚真件交叉印证）。 */
export interface CardinalityReading {
  config: Record<string, any>
  rows: Array<{
    protocol: string
    scenarios: Array<{
      id: string; protocol: string; truth: number; estimate: number | null; relativeError: number | null
      footprintBytes: number; inserts: number; fault?: string
      estimatorAccuracy: boolean; fixedMemory: boolean; mergeable: boolean
      inAccuracyExam: boolean; inMemoryExam: boolean; inMergeExam: boolean
    }>
    trilemma: { estimatorAccuracy: boolean; fixedMemory: boolean; mergeable: boolean }
    metrics: { exactCard: number; maxRelativeError: number; footprintBytes: number; mergeOk: boolean; trilemmaDebug?: Record<string, any> }
  }>
  vectors: Record<string, string>
  verdict: Record<string, any>
  crosscheck: { evidence: Record<string, any>; estimate: { holds: boolean; nontrivial: boolean; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
  builtAt: number
}

/** KI-531：LWWRegister/GCounter/OrSet(add-wins) CRDT 冲突消解真跑读数（三 CRDT × 六场景 + 三难维序 [SEC/expressiveness/compactMetadata] 011/100/110 + rigged 唯一翻 GCounter compact⇒101 + 三因果锁 + verifyConvergence 双路自证三路可证伪 + 十一枚真件 21 键交叉印证）。 */
export interface CrdtReading {
  config: Record<string, any>
  rows: Array<{
    protocol: string
    vector: string
    scenarios: Array<{
      id: string; fault: string
      inserts: number; replicaDigest: string; secConverged: boolean
      value: string | number | null | (string | number | null)[]
      strongEventualConvergence: boolean; expressiveness: boolean; compactMetadata: boolean
      inSecExam: boolean; inExpressiveExam: boolean; inCompactExam: boolean
    }>
    trilemma: { strongEventualConvergence: boolean; expressiveness: boolean; compactMetadata: boolean }
    metrics: { lwwConflictInvocations: number; compactBytes: number; convergenceGuarantee: boolean; convergenceLeak?: string }
  }>
  vectors: Record<string, string>
  baseVectors: Record<string, string>
  verdict: Record<string, any>
  crosscheck: { evidence: Record<string, any>; convergence: { holds: boolean; nontrivial: boolean; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
  builtAt: number
}

/** KI-532：BulkWriter/ChunkedWriter/SkipRetryWriter Spring Batch 教学件真跑读数（三策略 × 六场景 + 三难向量 + verifyCheckpoint 双路交叉印证 + 十一枚真件交叉印证）。 */
export interface SpringBatchReading {
  config: Record<string, any>
  rows: Array<{
    protocol: string
    scenarios: Array<{
      id: string; processed: number; faults: number; poisonCount: number; size: number
      checkpoints: number; dropped: number; wholeBatchDied: boolean
      faultIsolation: boolean; restartability: boolean; throughput: boolean; fault: string
      inFaultExam: boolean; inRestartExam: boolean; inThroughputExam: boolean
    }>
    trilemma: { faultIsolation: boolean; restartability: boolean; throughput: boolean }
    metrics: { chunkedCheckpoints: number; poisonDeaths: number; itemsProcessed: number; itemsDropped: number }
  }>
  vectors: Record<string, string>
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks: { checkpointTradeoffCausallyUnerasable: boolean; skipSilentLossCausallyUnerasable: boolean; bulkAllOrNothingCausallyUnerasable: boolean; causalLocksAllHold: boolean }
  verdict: Record<string, any>
  crosscheck: { evidence: Record<string, any>; checkpoint: { holds: boolean; baselineHolds: boolean; nontrivial: boolean; falsifiable: boolean; invariants: Record<string, boolean>; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
  builtAt: number
  rigged: boolean
}






/** KI-533：可观测性分布式追踪采样三策略（HeadBased/TailBased/Adaptive × 六场景 + 三难向量维序 [lowOverhead/anomalyCapture/loadAdaptive] 默认 100/010/101 + verifySamplingSoundness 双路自证 + 三路篡改真喂回 + 三因果锁 + 十一真件 21 键）。 */
export interface TraceSamplingReading {
  config: Record<string, any>
  rows: Array<{
    protocol: string
    scenarios: Array<{
      id: string
      rate: number; rateChanges: number; peakBufferedSpans: number
      errorTracesTotal: number; errorTracesRetained: number
      normalTracesTotal: number; normalTracesRetained: number
      spansIn: number; spansKept: number; spansDropped: number; tracesTotal: number; tracesKept: number
      lowOverhead: boolean; anomalyCapture: boolean; loadAdaptive: boolean
      errorRetainedRate: number; normalRetainedRate: number; fault: string
      inAnomalyExam: boolean; inOverheadExam: boolean; inAdaptiveExam: boolean
    }>
    trilemma: { lowOverhead: boolean; anomalyCapture: boolean; loadAdaptive: boolean }
    metrics: { peakBufferedSpans: number; errorTracesTotal: number; errorTracesRetained: number; errorTracesLost: number; spansIn: number; spansKept: number; rateChanges: number }
  }>
  vectors: Record<string, string>
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks: {
    anomalyRequiresBufferingCausallyUnerasable: boolean; headBlindnessCausallyUnerasable: boolean
    adaptiveLagCannotGuaranteeAnomalyCausallyUnerasable: boolean; causalLocksAllHold: boolean
    decisionInvariant: boolean; maxBlindnessGap: number
    rateSweep: Array<{ rate: number; errorRate: number; normalRate: number }>
    adaptivePerfectLost: number; adaptiveBaseLost: number
  }
  verdict: Record<string, any>
  crosscheck: { evidence: Record<string, any>; soundness: { holds: boolean; baselineHolds: boolean; nontrivial: boolean; falsifiable: boolean; invariants: Record<string, boolean>; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
  builtAt: number
  rigged: boolean
}

/** KI-498 + KI-501 + KI-502 + KI-503 + KI-504 + KI-505 + KI-506 + KI-507 + KI-508 + KI-509 + KI-510 + KI-511 + KI-512 + KI-513 + KI-518 + KI-520 + KI-523 + KI-525 + KI-526 + KI-527..533：与五场景并列的独立「系统读数」数据块（LSM + OS/硬件 + 缓存防护 + 网关限流 + 故障检测 + B+ 树索引 + 事务并发控制 + 分布式事务 + Raft 共识 + 分布式锁 + 分布式 ID + 分布式限流 + 配置一致性 + 缓存读写一致性 + 消息投递语义 + 延迟消息队列调度 + 消息重试退避与死信 + 消费者组 rebalance + 消费者组积压背压 + append-only 日志压缩与回放边界 + 三过滤器 + 三替换策略 + 流式窗口 + 基数估计 + CRDT + Spring Batch 批处理 + 追踪采样）。 */
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
  distributedRateLimit: DistributedRateLimitReading | null
  configConsistency: ConfigConsistencyReading | null
  cacheCoherency: CacheCoherencyReading | null
  messageDelivery: MessageDeliveryReading | null
  delayQueue: DelayQueueReading | null
  retryDlq: RetryDlqReading | null
  consumerGroup: ConsumerGroupReading | null
  backpressure: BackpressureReading | null
  logCompaction: LogCompactionReading | null
  bloomFilter: BloomFilterReading | null
  cacheReplacement: CacheReplacementReading | null
  streamWindow: StreamWindowReading | null
  hyperLogLog: CardinalityReading | null
  crdt: CrdtReading | null
  springBatch: SpringBatchReading | null
  traceSampling: TraceSamplingReading | null
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
  /** KI-510：false 关掉分布式限流维（兼容旧快照）；drlInstances/drlShards/drlCapacity 注入拓扑规模。 */
  distributedRateLimit?: boolean
  drlInstances?: number
  drlShards?: number
  drlCapacity?: number
  /** KI-511：false 关掉配置一致性维（兼容旧快照）；dccClients/dccPollIntervalMs 注入规模与轮询周期。 */
  configConsistency?: boolean
  dccClients?: number
  dccPollIntervalMs?: number
  /** KI-512：false 关掉缓存读写一致性维（兼容旧快照）；ccc* 注入写规模/后端 RTT/WAL。 */
  cacheCoherency?: boolean
  cccWrites?: number
  cccManyKeys?: number
  cccBackendRttMs?: number
  cccWalEnabled?: boolean
  /** KI-513：false 关掉消息投递语义维（兼容旧快照）；mmd* 注入消息规模/幂等键规模/重投上限/ack 可靠。 */
  messageDelivery?: boolean
  mmdMessages?: number
  mmdManyKeys?: number
  mmdRetryLimit?: number
  mmdAckReliable?: boolean
  /** KI-518：false 关掉延迟消息队列调度维（兼容旧快照）；dq* 注入规模/tick/轮询周期/rigged 开关。 */
  delayQueue?: boolean
  dqTasks?: number
  dqTickMs?: number
  dqWheelSlots?: number
  dqPollIntervalMs?: number
  dqZeroTick?: boolean
  dqFreeHeapOps?: boolean
  dqSharedBackend?: boolean
  /** KI-520：false 关掉消息重试退避与死信维（兼容旧快照）；rdlq* 注入规模/退避档/rigged 开关。 */
  retryDlq?: boolean
  rdlqMessages?: number
  rdlqMaxAttempts?: number
  rdlqBaseTicks?: number
  rdlqCapTicks?: number
  rdlqOutageTicks?: number
  rdlqRecoverAtTick?: number
  rdlqZeroBackoff?: boolean
  rdlqPerfectJitter?: boolean
  rdlqNoRetryBudget?: boolean
  /** KI-523：false 关掉消费者组 rebalance 维（兼容旧快照）；cgp* 注入规模/预算/单开关。 */
  consumerGroup?: boolean
  cgpSeed?: number
  cgpConsumers?: number
  cgpPartitionsPerTopic?: number
  cgpMovePartitions?: number
  cgpBigConsumers?: number
  cgpBigPartitions?: number
  cgpBalanceBudget?: number
  cgpMovementBudget?: number
  cgpComputeBudget?: number
  cgpZeroMovement?: boolean
  cgpPerfectBalance?: boolean
  cgpFreeCompute?: boolean
  /** KI-525：false 关掉消费者组积压背压维（兼容旧快照）；bpc* 注入规模/预算/单开关（bp* 已被 KI-504 B+ 树占用）。 */
  backpressure?: boolean
  bpcSteps?: number
  bpcMu?: number
  bpcAcceptBudget?: number
  bpcLatencyBudget?: number
  bpcBufferCap?: number
  bpcMemoryCap?: number
  bpcSeed?: number
  bpcZeroLoss?: boolean
  bpcBoundedLatency?: boolean
  bpcUnlimitedBuffer?: boolean
  bpcRigged?: boolean
  /** KI-526：false 关掉日志压缩 / 回放边界维（兼容旧快照）；lc* 注入日志规模/预算/单开关/因果锁。 */
  logCompaction?: boolean
  lcSeed?: number
  lcOps?: number
  lcKeySpace?: number
  lcRetentionOps?: number
  lcDeleteRetention?: number
  lcSnapshotAt?: number
  lcFootprintBudget?: number
  lcReplayBudget?: number
  lcUnlimitedRetention?: boolean
  lcInstantSnapshot?: boolean
  lcZeroReplayCost?: boolean
  lcRigged?: boolean
  /** KI-527：false 关掉布隆维（兼容旧快照）；bf* 注入规模/阈值/开关（bf* 已被 bloomFilter 占用，且未被 B+ 树占用 bp* 之前） */
  bloomFilter?: boolean
  bfSeed?: number
  bfCapacity?: number
  bfBitsPerKey?: number
  bfCountersPerKey?: number
  bfCounterWidth?: number
  bfTableCount?: number
  bfBucketSize?: number
  bfMaxKicks?: number
  bfMaxLoadFactor?: number
  bfZeroErrors?: boolean
  bfDeleteImpossible?: boolean
  bfUnlimitedRoom?: boolean
  bfEternalStasis?: boolean
  bfNoDeletesNeeded?: boolean
  bfRigged?: boolean
  /** KI-528：false 关掉替换维（兼容旧快照）；cr* 注入规模/阈值/rigged */
  cacheReplacement?: boolean
  crSeed?: number
  crCapacity?: number
  crAccesses?: number
  crPerfectFuture?: boolean
  crUnlimitedRoom?: boolean
  crRigged?: boolean
  /** KI-529：false 关掉流式窗口维（兼容旧快照）；sw* 注入规模/阈值/rigged */
  streamWindow?: boolean
  swSeed?: number
  swWindowSize?: number
  swSlideStep?: number
  swSessionGap?: number
  swAllowedLateness?: number
  swEvents?: number
  swFrozenWatermark?: boolean
  swInfiniteLateness?: boolean
  swFreeState?: boolean
  swRigged?: boolean
  /** KI-530：false 关掉基数估计维（兼容旧快照）；hll* 注入规模/阈值/rigged */
  hyperLogLog?: boolean
  hllSeed?: number
  hllCardinality?: number
  hllMRegisters?: number
  hllPerfectHash?: boolean
  hllUnlimitedMemory?: boolean
  hllRigged?: boolean
  /** KI-531：false 关掉 CRDT 维（兼容旧快照）；crdt* 注入规模/阈值/rigged */
  crdt?: boolean
  crdtSeed?: number
  crdtReplicas?: number
  crdtOpsPerNode?: number
  crdtSkewTicks?: number
  crdtUniformClock?: boolean
  crdtInfiniteMetadata?: boolean
  crdtCoordinatedDelete?: boolean
  crdtRigged?: boolean
  /** KI-532：false 关掉 SpringBatch 维（兼容旧快照）；sb* 注入规模/阈值/rigged */
  springBatch?: boolean
  sbSeed?: number
  sbItems?: number
  sbChunkSize?: number
  sbSkipLimit?: number
  sbPerfectOracle?: boolean
  sbUnlimitedSkip?: boolean
  sbRigged?: boolean
  traceSampling?: boolean
  tsSeed?: number
  tsItems?: number
  tsRate?: number
  tsMinRate?: number
  tsMaxRate?: number
  tsWindowSize?: number
  tsOracleHead?: boolean
  tsInfiniteBuffer?: boolean
  tsPerfectFeedback?: boolean
  tsRigged?: boolean
}): Promise<ConsoleSnapshot>

/** KI-498 + KI-501 + KI-502 + KI-503 + KI-504 + KI-505 + KI-506 + KI-507 + KI-508 + KI-509 + KI-510 + KI-511 + KI-512 + KI-513：真跑 LSM + OS/硬件 + 缓存防护 + 网关限流 + 故障检测 + B+ 树索引 + 事务并发控制 + 分布式事务 + Raft 共识 + 分布式锁 + 分布式 ID + 分布式限流 + 配置一致性 + 缓存读写一致性 + 消息投递语义 十五维系统读数；击穿并发 ⇒ async。 */
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
  /** KI-510：false 关掉分布式限流维（兼容旧快照）；drlInstances/drlShards/drlCapacity 注入拓扑规模。 */
  distributedRateLimit?: boolean
  drlInstances?: number
  drlShards?: number
  drlCapacity?: number
  /** KI-511：false 关掉配置一致性维（兼容旧快照）；dccClients/dccPollIntervalMs 注入规模与轮询周期。 */
  configConsistency?: boolean
  dccClients?: number
  dccPollIntervalMs?: number
  /** KI-512：false 关掉缓存读写一致性维（兼容旧快照）；ccc* 注入写规模/后端 RTT/WAL。 */
  cacheCoherency?: boolean
  cccWrites?: number
  cccManyKeys?: number
  cccBackendRttMs?: number
  cccWalEnabled?: boolean
  /** KI-513：false 关掉消息投递语义维（兼容旧快照）；mmd* 注入消息规模/幂等键规模/重投上限/ack 可靠。 */
  messageDelivery?: boolean
  mmdMessages?: number
  mmdManyKeys?: number
  mmdRetryLimit?: number
  mmdAckReliable?: boolean
  /** KI-518：false 关掉延迟消息队列调度维（兼容旧快照）；dq* 注入规模/tick/轮询周期/rigged 开关。 */
  delayQueue?: boolean
  dqTasks?: number
  dqTickMs?: number
  dqWheelSlots?: number
  dqPollIntervalMs?: number
  dqZeroTick?: boolean
  dqFreeHeapOps?: boolean
  dqSharedBackend?: boolean
  /** KI-520：false 关掉消息重试退避与死信维（兼容旧快照）；rdlq* 注入规模/退避档/rigged 开关。 */
  retryDlq?: boolean
  rdlqMessages?: number
  rdlqMaxAttempts?: number
  rdlqBaseTicks?: number
  rdlqCapTicks?: number
  rdlqOutageTicks?: number
  rdlqRecoverAtTick?: number
  rdlqZeroBackoff?: boolean
  rdlqPerfectJitter?: boolean
  rdlqNoRetryBudget?: boolean
  /** KI-523：false 关掉消费者组 rebalance 维（兼容旧快照）；cgp* 注入规模/预算/单开关。 */
  consumerGroup?: boolean
  cgpSeed?: number
  cgpConsumers?: number
  cgpPartitionsPerTopic?: number
  cgpMovePartitions?: number
  cgpBigConsumers?: number
  cgpBigPartitions?: number
  cgpBalanceBudget?: number
  cgpMovementBudget?: number
  cgpComputeBudget?: number
  cgpZeroMovement?: boolean
  cgpPerfectBalance?: boolean
  cgpFreeCompute?: boolean
  /** KI-525：false 关掉消费者组积压背压维（兼容旧快照）；bpc* 注入规模/预算/单开关（bp* 已被 KI-504 B+ 树占用）。 */
  backpressure?: boolean
  bpcSteps?: number
  bpcMu?: number
  bpcAcceptBudget?: number
  bpcLatencyBudget?: number
  bpcBufferCap?: number
  bpcMemoryCap?: number
  bpcSeed?: number
  bpcZeroLoss?: boolean
  bpcBoundedLatency?: boolean
  bpcUnlimitedBuffer?: boolean
  bpcRigged?: boolean
  /** KI-526：false 关掉日志压缩 / 回放边界维（兼容旧快照）；lc* 注入日志规模/预算/单开关/因果锁。 */
  logCompaction?: boolean
  lcSeed?: number
  lcOps?: number
  lcKeySpace?: number
  lcRetentionOps?: number
  lcDeleteRetention?: number
  lcSnapshotAt?: number
  lcFootprintBudget?: number
  lcReplayBudget?: number
  lcUnlimitedRetention?: boolean
  lcInstantSnapshot?: boolean
  lcZeroReplayCost?: boolean
  lcRigged?: boolean
  /** KI-527：false 关掉布隆维（兼容旧快照）；bf* 注入规模/阈值/开关（bf* 已被 bloomFilter 占用，且未被 B+ 树占用 bp* 之前） */
  bloomFilter?: boolean
  bfSeed?: number
  bfCapacity?: number
  bfBitsPerKey?: number
  bfCountersPerKey?: number
  bfCounterWidth?: number
  bfTableCount?: number
  bfBucketSize?: number
  bfMaxKicks?: number
  bfMaxLoadFactor?: number
  bfZeroErrors?: boolean
  bfDeleteImpossible?: boolean
  bfUnlimitedRoom?: boolean
  bfEternalStasis?: boolean
  bfNoDeletesNeeded?: boolean
  bfRigged?: boolean
  /** KI-528：false 关掉替换维（兼容旧快照）；cr* 注入规模/阈值/rigged */
  cacheReplacement?: boolean
  crSeed?: number
  crCapacity?: number
  crAccesses?: number
  crPerfectFuture?: boolean
  crUnlimitedRoom?: boolean
  crRigged?: boolean
  /** KI-529：false 关掉流式窗口维（兼容旧快照）；sw* 注入规模/阈值/rigged */
  streamWindow?: boolean
  swSeed?: number
  swWindowSize?: number
  swSlideStep?: number
  swSessionGap?: number
  swAllowedLateness?: number
  swEvents?: number
  swFrozenWatermark?: boolean
  swInfiniteLateness?: boolean
  swFreeState?: boolean
  swRigged?: boolean
  /** KI-530：false 关掉基数估计维（兼容旧快照）；hll* 注入规模/阈值/rigged */
  hyperLogLog?: boolean
  hllSeed?: number
  hllCardinality?: number
  hllMRegisters?: number
  hllPerfectHash?: boolean
  hllUnlimitedMemory?: boolean
  hllRigged?: boolean
  /** KI-531：false 关掉 CRDT 维（兼容旧快照）；crdt* 注入规模/阈值/rigged */
  crdt?: boolean
  crdtSeed?: number
  crdtReplicas?: number
  crdtOpsPerNode?: number
  crdtSkewTicks?: number
  crdtUniformClock?: boolean
  crdtInfiniteMetadata?: boolean
  crdtCoordinatedDelete?: boolean
  crdtRigged?: boolean
  /** KI-532：false 关掉 SpringBatch 维（兼容旧快照）；sb* 注入规模/阈值/rigged */
  springBatch?: boolean
  sbSeed?: number
  sbItems?: number
  sbChunkSize?: number
  sbSkipLimit?: number
  sbPerfectOracle?: boolean
  sbUnlimitedSkip?: boolean
  sbRigged?: boolean
  traceSampling?: boolean
  tsSeed?: number
  tsItems?: number
  tsRate?: number
  tsMinRate?: number
  tsMaxRate?: number
  tsWindowSize?: number
  tsOracleHead?: boolean
  tsInfiniteBuffer?: boolean
  tsPerfectFeedback?: boolean
  tsRigged?: boolean
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

/** KI-510：真跑分布式限流（本地桶 / Redis 中心桶 / 一致性哈希分片桶 × 六场景矩阵 + 三难判词 + 真 Redis 原子桶/真环交叉印证）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildDistributedRateLimitReading(opts: {
  now?: () => number
  distributedRateLimit?: boolean
  drlInstances?: number
  drlShards?: number
  drlCapacity?: number
}, now: () => number): Promise<DistributedRateLimitReading | null>

/** KI-511：真跑配置一致性（轮询 / 长轮询 / watch 推送 × 六场景矩阵 + 三难判词 + 真 Config响应/watcher/bus/hashSelector/XFetch/RedisTTL/环交叉印证）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildConfigConsistencyReading(opts: {
  now?: () => number
  configConsistency?: boolean
  dccClients?: number
  dccPollIntervalMs?: number
}, now: () => number): Promise<ConfigConsistencyReading | null>

/** KI-512：真跑缓存读写一致性（Cache-Aside / Write-Through / Write-Behind × 六场景矩阵 + 三难判词 + 七枚真件 Redis/WAL/XFetch/Sharded/MVCC/2PC/环交叉印证）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildCacheCoherencyReading(opts: {
  now?: () => number
  cacheCoherency?: boolean
  cccWrites?: number
  cccManyKeys?: number
  cccBackendRttMs?: number
  cccWalEnabled?: boolean
}, now: () => number): Promise<CacheCoherencyReading | null>

/** KI-513：真跑消息投递语义（At-Most-Once / At-Least-Once / Exactly-Once × 六场景矩阵 + 三难判词 + 七枚真件 Bus/GameEventBus/Bridge/2PC/WAL/Redis/环交叉印证）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildMessageDeliveryReading(opts: {
  now?: () => number
  messageDelivery?: boolean
  mmdMessages?: number
  mmdManyKeys?: number
  mmdRetryLimit?: number
  mmdAckReliable?: boolean
}, now: () => number): Promise<MessageDeliveryReading | null>

/** KI-518：真跑延迟消息队列调度三协议（TimingWheel / MinHeap / RedisZset × 六场景矩阵 + 三难向量 + 七枚真件交叉印证）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildDelayQueueReading(opts: {
  now?: () => number
  delayQueue?: boolean
  dqTasks?: number
  dqTickMs?: number
  dqWheelSlots?: number
  dqPollIntervalMs?: number
  dqZeroTick?: boolean
  dqFreeHeapOps?: boolean
  dqSharedBackend?: boolean
}, now: () => number): Promise<DelayQueueReading | null>

/** KI-520：真跑消息重试退避 × 死信队列三协议（Immediate / Exponential / FullJitter × 六场景矩阵 + 三难向量 + 七枚真件交叉印证）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildRetryDlqReading(opts: {
  now?: () => number
  retryDlq?: boolean
  rdlqMessages?: number
  rdlqMaxAttempts?: number
  rdlqBaseTicks?: number
  rdlqCapTicks?: number
  rdlqOutageTicks?: number
  rdlqRecoverAtTick?: number
  rdlqZeroBackoff?: boolean
  rdlqPerfectJitter?: boolean
  rdlqNoRetryBudget?: boolean
}, now: () => number): Promise<RetryDlqReading | null>

/** KI-523：真跑消费者组 rebalance / 分区所有权三协议（Range / RoundRobin / Sticky × 六场景矩阵 + 三难向量 + 九枚真件交叉印证）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildConsumerGroupReading(opts: {
  now?: () => number
  consumerGroup?: boolean
  cgpSeed?: number
  cgpConsumers?: number
  cgpPartitionsPerTopic?: number
  cgpMovePartitions?: number
  cgpBigConsumers?: number
  cgpBigPartitions?: number
  cgpBalanceBudget?: number
  cgpMovementBudget?: number
  cgpComputeBudget?: number
  cgpZeroMovement?: boolean
  cgpPerfectBalance?: boolean
  cgpFreeCompute?: boolean
}, now: () => number): Promise<ConsumerGroupReading | null>

/** KI-525：真跑消费者组积压背压 / 流量削峰四策略（Backpressure / Buffering / Shedding / Scaling × 六正交负载场景 + 三难向量 + Little's Law 双路自证 + 十一枚真件交叉印证）收敛成前端两面板紧凑读数；失败落 null。bpc* = backpressure（bp* 已被 KI-504 B+ 树占用）。 */
export function buildBackpressureReading(opts: {
  now?: () => number
  backpressure?: boolean
  bpcSteps?: number
  bpcMu?: number
  bpcAcceptBudget?: number
  bpcLatencyBudget?: number
  bpcBufferCap?: number
  bpcMemoryCap?: number
  bpcSeed?: number
  bpcZeroLoss?: boolean
  bpcBoundedLatency?: boolean
  bpcUnlimitedBuffer?: boolean
  bpcRigged?: boolean
}, now: () => number): Promise<BackpressureReading | null>

/** KI-526：真跑 append-only 日志压缩 / 回放边界三策略（SizeTimeRetention / KeyCompaction / SnapshotPlusWal × 六正交负载场景 + 三难向量 + verifyReplayBoundary 双路守恒自证 + 十一枚真件交叉印证）收敛成前端两面板紧凑读数；失败落 null。lc* = log compaction，避开 lsm/bp/bpc/cgp/rdq/dld 已占用前缀。 */
export function buildLogCompactionReading(opts: {
  now?: () => number
  logCompaction?: boolean
  lcSeed?: number
  lcOps?: number
  lcKeySpace?: number
  lcRetentionOps?: number
  lcDeleteRetention?: number
  lcSnapshotAt?: number
  lcFootprintBudget?: number
  lcReplayBudget?: number
  lcUnlimitedRetention?: boolean
  lcInstantSnapshot?: boolean
  lcZeroReplayCost?: boolean
  lcRigged?: boolean
}, now: () => number): Promise<LogCompactionReading | null>

/** KI-527：真跑布隆/布谷鸟/计数布隆三过滤器（Bloom / CountingBloom / Cuckoo × 六场景 + 三难向量 + verifyFalsePositiveCeiling 双路自证 + 十一枚真件交叉印证）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildBloomFilterReading(opts: {
  now?: () => number
  bloomFilter?: boolean
  bfSeed?: number
  bfCapacity?: number
  bfBitsPerKey?: number
  bfCountersPerKey?: number
  bfCounterWidth?: number
  bfTableCount?: number
  bfBucketSize?: number
  bfMaxKicks?: number
  bfMaxLoadFactor?: number
  bfZeroErrors?: boolean
  bfDeleteImpossible?: boolean
  bfUnlimitedRoom?: boolean
  bfEternalStasis?: boolean
  bfNoDeletesNeeded?: boolean
  bfRigged?: boolean
}, now: () => number): Promise<BloomFilterReading | null>

/** KI-528：真跑 LRU/2Q/ARC 三替换策略（LRU/2Q/ARC × 六场景 + 三难向量 + verifyDualSweep 双路交叉印证 + 十一枚真件交叉印证）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildCacheReplacementReading(opts: {
  now?: () => number
  cacheReplacement?: boolean
  crSeed?: number
  crCapacity?: number
  crAccesses?: number
  crPerfectFuture?: boolean
  crUnlimitedRoom?: boolean
  crRigged?: boolean
}, now: () => number): Promise<CacheReplacementReading | null>

/** KI-529：真跑 Tumbling/Sliding/Session 流式窗口聚合与 Watermark 迟到处置（三策略 × 六场景 + 三难向量 + verifyWatermarkMonotonicity 双路交叉印证 + 十一枚真件交叉印证）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildStreamWindowReading(opts: {
  now?: () => number
  streamWindow?: boolean
  swSeed?: number
  swWindowSize?: number
  swSlideStep?: number
  swSessionGap?: number
  swAllowedLateness?: number
  swEvents?: number
  swFrozenWatermark?: boolean
  swInfiniteLateness?: boolean
  swFreeState?: boolean
  swRigged?: boolean
}, now: () => number): Promise<StreamWindowReading | null>

/** KI-530：真跑 ExactSet/HyperLogLog/LinearCounting 基数估计算法族（三估计器 × 六场景 + 三难向量 + verifySparseEstimate 双路交叉印证 + 十一枚真件交叉印证）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildCardinalityReading(opts: {
  now?: () => number
  hyperLogLog?: boolean
  hllSeed?: number
  hllCardinality?: number
  hllMRegisters?: number
  hllPerfectHash?: boolean
  hllUnlimitedMemory?: boolean
  hllRigged?: boolean
}, now: () => number): Promise<CardinalityReading | null>

/** KI-531：真跑 CRDT 最终一致冲突消解三策略（LWW-Register/G-Counter/OR-Set × 六场景 + 三难向量 + verifyConvergence 双路交叉印证 + 十一枚真件交叉印证）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildCrdtReading(opts: {
  now?: () => number
  crdt?: boolean
  crdtSeed?: number
  crdtReplicas?: number
  crdtOpsPerNode?: number
  crdtSkewTicks?: number
  crdtUniformClock?: boolean
  crdtInfiniteMetadata?: boolean
  crdtCoordinatedDelete?: boolean
  crdtRigged?: boolean
  /** KI-532：false 关掉 SpringBatch 维（兼容旧快照）；sb* 注入规模/阈值/rigged */
  springBatch?: boolean
  sbSeed?: number
  sbItems?: number
  sbChunkSize?: number
  sbSkipLimit?: number
  sbPerfectOracle?: boolean
  sbUnlimitedSkip?: boolean
  sbRigged?: boolean
}, now: () => number): Promise<CrdtReading | null>

/** KI-532：真跑 Spring Batch chunk-oriented R-P-W（BulkWriter/ChunkedWriter/SkipRetryWriter × 六场景 + 三难向量 + verifyCheckpoint 双路自证 + 十一枚真件交叉印证）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildSpringBatchReading(opts: {
  now?: () => number
  springBatch?: boolean
  sbSeed?: number
  sbItems?: number
  sbChunkSize?: number
  sbSkipLimit?: number
  sbPerfectOracle?: boolean
  sbUnlimitedSkip?: boolean
  sbRigged?: boolean
}, now: () => number): Promise<SpringBatchReading | null>

/** KI-533：真跑可观测性分布式追踪采样三策略（HeadBased/TailBased/Adaptive × 六场景 + 三难向量 + verifySamplingSoundness 双路自证 + 十一枚真件交叉印证）收敛成前端两面板紧凑读数；失败落 null。 */
export function buildTraceSamplingReading(opts: {
  now?: () => number
  traceSampling?: boolean
  tsSeed?: number
  tsItems?: number
  tsRate?: number
  tsMinRate?: number
  tsMaxRate?: number
  tsWindowSize?: number
  tsOracleHead?: boolean
  tsInfiniteBuffer?: boolean
  tsPerfectFeedback?: boolean
  tsRigged?: boolean
}, now: () => number): Promise<TraceSamplingReading | null>

export function realScenarioOpts(id: string): Record<string, any>

export function normalizeScenario(id: string, gc: any, r: any): ConsoleScenario

export function driveNetSeries(net: any): any | null

export function cwndSeries(history: any): Array<{ step: number; cwnd: number | null; event: string | null; mode: string | null }>

export function deriveHighlights(scenarios: ConsoleScenario[]): ConsoleHighlights
