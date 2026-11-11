/** `scripts/spring-family-mesh-e2e.mjs` 的声明：集大成家族端到端证据（headless 可证）。 */

export function runMeshE2E(opts?: any): {
  gc: any
  k8s: any
  tracer: any
  run(): Promise<{
    started: any
    callRes: any
    status: any
    stopped: any
    spans: any[]
    services: string[]
    /** KI-488①：事件总线收到的游戏生命周期事件 */
    events: Array<{ type: string; payload: any }>
    /** KI-488②：调用前鉴权守卫的判定（opts.bearer===null 时为 null） */
    auth: { ok: boolean; allowed: boolean; sub?: string; scope?: string; requiredScope: string; reason?: string } | null
    /** KI-488③：filter 链计数（retries/rateLimited/passed 等） */
    filterStats: any
    /** KI-489：注入 gameBus 时的桥接证据（installed/stats/crossed 过桥载荷） */
    gameBridge: any
    /** KI-489：shutdown 时退桥读数 */
    bridgeOff: any
    /** KI-491：每次灰度探针的判词（key/lane/fallback/canaryPercent/ok/reason/instanceId） */
    grayProbes: Array<{ key?: string; lane?: string; fallback: boolean; canaryPercent?: number; ok: boolean; reason?: string; instanceId?: string }>
    /** KI-491：灰度决策器累计计数（decisions/canary/primary/fallback/noInstance/droppedUnhealthy），未配 gray 为 null */
    grayStats: { decisions: number; canary: number; primary: number; fallback: number; noInstance: number; droppedUnhealthy: number } | null
    /** KI-493：缓存探针（两次同令牌在线校验的 source/cacheHit/ok 与命中读数），未配 cacheProbe 为 null */
    cacheProbe: { firstSource: string; secondSource: string; secondCacheHit: boolean; firstOk: boolean; secondOk: boolean; stats: any } | null
    /** KI-493：鉴权缓存 stats()，未配 authCache 为 null */
    authCacheStats: any | null
    /** KI-494：计网算法快照（aimd/cubic/rto/window/tickets/http），未配 net 为 null */
    netSnapshot: { observes: number; aimd: any; cubic: any; rto: any; window: any; tickets: any; http: any } | null
    /** KI-499：一致性哈希环快照（ring/grow/distribution），未配 hashRing 为 null */
    hashRingSnapshot: { ring: any; grow: { consistentRate: number; moduloRate: number; theoreticalRate: number; savedRate: number; delta: number }; distribution: any; builtAt: number } | null
    /** KI-500：分片缓存快照（cache/retention），未配 shardedCache 为 null */
    shardedCacheSnapshot: { cache: any; retention: { delta: number; consistentRetention: number; moduloRetention: number; theoretical: number; savedRate: number }; builtAt: number } | null
    /** KI-501：缓存防护三件套快照（stampede/penetration/avalanche），未配 cacheGuard 为 null */
    cacheGuardSnapshot: { stampede: any; penetration: any; avalanche: any; builtAt: number } | null
    /** KI-502：限流算法族 + Redis 原子性快照（strategies/verdict/redis），未配 rateLimit 为 null */
    rateLimitSnapshot: {
      limit: number
      windowMs: number
      arrivals: number
      strategies: Record<string, { allowed: number; rejected: number; maxInWindow: number; burstRatio: number | null; memory: string | null }>
      verdict: Record<string, boolean>
      redis: { concurrency: number; capacity: number; atomicAllowed: number; nonAtomicAllowed: number; overshoot: number; atomicBounded: boolean; nonAtomicOverran: boolean; shared: { key: string; aRemaining: number | null; bSeenRemaining: number | null; consistent: boolean } }
      builtAt: number
    } | null
    /** KI-503：服务故障检测器快照（fixed/phi 对照 + SWIM 三态 + 健康视图），未配 failureDetector 为 null */
    failureDetectorSnapshot: {
      threshold: number
      fixedTimeoutMs: number
      fixed: { falsePositives: number; truePositives: number; detectionLatencyMs: number | null }
      phi: { falsePositives: number; truePositives: number; detectionLatencyMs: number | null; maxPhi: number; cap: number }
      verdict: Record<string, boolean>
      swim: { counts: { alive: number; suspected: number; faulty: number; total: number }; script: any; members: any[] }
      health: { nodes: string[]; excluded: string[]; firstFromCache: boolean; secondFromCache: boolean; thirdFromCache: boolean; computed: number; invalidations: number; hitRate: number | null; ttlMs: number }
      builtAt: number
    } | null
    /** KI-504：B+ 树索引 + LSM 三笔账快照（点查比较数 / 范围叶链顺序扫 / 写放大对照），未配 bplusIndex 为 null */
    bplusIndexSnapshot: {
      config: { keys: number; probes: number; rangeQueries: number; order: number; fanout: number; leafCapacity: number; overwriteEvery: number; lsmMemtableMax: number }
      structure: { height: number; heightEstimate: number; leafCount: number; nodeCount: number; order: number; fanout: number; invariants: number; heightLadder: Array<{ order: number; fanout: number; heightEstimate: number }> }
      point: { bplusComparisons: number; lsmComparisons: number; favors: 'bplus' | 'lsm' | 'tie' }
      range: { bplusCost: number; lsmCost: number; bplusLeafHops: number; bplusResults: number; lsmSegments: number; lsmSortComparisons: number; lsmResults: number; favors: 'bplus' | 'lsm' | 'tie' }
      write: { bplusPageRewrites: number; bplusSplits: number; bplusMerges: number; bplusBorrows: number; lsmSeqWriteUnits: number; lsmFlushes: number; lsmCompactions: number; lsmMergedAway: number; favors: 'bplus' | 'lsm' | 'tie' }
      levels: Array<{ level: number; segments: number; entries: number }>
      agreement: { pointMismatches: number; rangeMismatches: number; bothAgree: boolean }
      verdict: Record<string, boolean | string>
      builtAt: number
    } | null
    /** KI-505：事务与并发控制快照（五档隔离 × 五类异常矩阵 / 死锁环检测 / 2PL / gc 水位），未配 mvccTxn 为 null */
    mvccTxnSnapshot: {
      config: { levels: string[]; anomalies: string[] }
      levels: Array<{
        short: string
        label: string
        anomalies: Record<string, { observed: boolean; label: string }>
        observedCount: number
        preventedCount: number
        aborted: number
      }>
      deadlock: { graph: Record<string, string[]>; detected: boolean; cycle: string[]; resolved: boolean; victim: string | null; acyclicProbeNoCycle: boolean; stats: any }
      twoPhaseLock: { lateAcquireBlocked: boolean; reason: string; stats: any }
      gc: { versions: number; longWaterMark: any; cleanWaterMark: any; longTxnRetainsMoreVersions: boolean }
      store: any
      verdict: Record<string, boolean>
      builtAt: number
    } | null
    /** KI-506：分布式事务三协议快照（2PC 阻塞 / Saga 补偿留脏 / TCC 幂等重试 × 六场景 + 三难判词），未配 distributedTxn 为 null */
    distributedTxnSnapshot: {
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
      builtAt: number
    } | null
    /** KI-507：Raft 共识三协议快照（Raft 单 leader / 多主复制 / Gossip 反熵 × 六场景 + 三难判词），未配 raftConsensus 为 null */
    raftConsensusSnapshot: {
      config: { protocols: string[]; scenarios: Array<{ id: string; label: string }> }
      rows: Array<{
        protocol: string
        label: string
        trilemma: { linearizable: boolean; partitionAvailable: boolean; boundedConvergence: boolean }
        totals: { committed: number; blockedWrites: number; staleReads: number; conflicts: number; messages: number; diverged: number }
        scenarios: Array<{
          id: string; label: string; protocol: string; scenario: string
          committed: boolean; blockedWrites: number; staleReads: number; conflicts: number
          converged: boolean; linearizable: boolean; messages: number; terms: number; rounds: number
          detail: Record<string, any>
        }>
      }>
      election: Record<string, any>
      replication: Record<string, any>
      safety: Record<string, any>
      gossip: Record<string, any>
      verdict: Record<string, boolean>
      builtAt: number
    } | null
    /** KI-508：分布式锁三协议快照（SETNX/Redlock/etcd × 六场景 + 三难判词），未配 distributedLock 为 null */
    distributedLockSnapshot: {
      config: { protocols: string[]; scenarios: Array<{ id: string; label: string }> }
      rows: Array<{
        protocol: string
        label: string
        trilemma: { mutualExclusion: boolean; partialFaultTolerance: boolean; lowLatency: boolean }
        totals: { acquired: number; doubleOwners: number; dirtyWrites: number; blockedAcquires: number; staleWritesRejected: number; messages: number; fencedCount: number }
        scenarios: Array<{
          id: string; label: string; protocol: string; scenario: string
          acquired: boolean; doubleOwners: number; dirtyWrites: number; blockedAcquires: number
          staleWritesRejected: number; fencedProtected: boolean; mutualExcluded: boolean; converged: boolean
          messages: number; latency: number; quorum: number; rounds: number
          detail: Record<string, any>
        }>
      }>
      setnx: Record<string, any>
      redlock: Record<string, any>
      fencing: Record<string, any>
      verdict: Record<string, boolean>
      builtAt: number
    } | null
    /** KI-509：分布式 ID 三协议快照（UUID/Snowflake/号段 × 六场景 + 三难判词 + KI-504 真树交叉印证），未配 idGen 为 null */
    idGenSnapshot: {
      config: { protocols: string[]; scenarios: Array<{ id: string; label: string }> }
      rows: Array<{
        protocol: string
        label: string
        trilemma: { indexFriendly: boolean; decentralized: boolean; clockRobust: boolean }
        totals: { issued: number; unique: number; duplicates: number; stalled: number; pageSplits: number; comparisons: number; wastedIds: number; centerRounds: number; waits: number; messages: number }
        scenarios: Array<{
          id: string; label: string; protocol: string; scenario: string
          issued: number; unique: number; duplicates: number; stalled: number; clockRollbacks: number; waits: number
          pageSplits: number; comparisons: number; cmpBaseline: number; wastedIds: number; centerRounds: number
          messages: number; latency: number
          indexFriendly: boolean; decentralized: boolean; clockRobust: boolean; uniqueIds: boolean; contiguous: boolean
          detail: Record<string, any>
        }>
      }>
      uuid: Record<string, any>
      snowflake: Record<string, any>
      segment: Record<string, any>
      btree: Record<string, any>
      verdict: Record<string, boolean>
      builtAt: number
    } | null
    /** KI-510：分布式限流三协议快照（本地桶/中心桶/分片桶 × 六场景 + 三难判词 + 真 Redis 原子桶/真环交叉印证），未配 distributedRateLimit 为 null */
    distributedRateLimitSnapshot: {
      config: Record<string, any>
      rows: Array<{
        protocol: string
        trilemma: { globalExact: boolean; partialFaultTolerance: boolean; noCenterRTT: boolean }
        totals: { allowed: number; rejected: number; overAllowed: number; centerRounds: number; fragmented: number }
        scenarios: Array<{
          id: string; allowed: number; rejected: number; overAllowed: number; centerRounds: number
          fragmented: number; isolatedFailures: number; degradedShard: number
          hotKeyHits: number; centerStalled: number
          globalExact: boolean; partialFaultTolerance: boolean; noCenterRTT: boolean
        }>
      }>
      vectors: Record<string, string>
      crosscheck: { central: Record<string, any>; sharded: Record<string, any> }
      verdict: Record<string, any>
      topology: Record<string, any>
      builtAt: number
    } | null
    /** KI-511：分布式配置一致性三协议快照（轮询/长轮询/watch 推送 × 六场景 + 三难判词 + 真 Config响应/watcher/bus/hashSelector/XFetch/RedisTTL/环交叉印证），未配 configConsistency 为 null */
    configConsistencySnapshot: {
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
      crosscheck: Record<string, Record<string, any>>
      verdict: Record<string, any>
      topology: Record<string, any>
      builtAt: number
    } | null
    /** KI-512：分布式缓存读写一致性三协议快照（Cache-Aside/Write-Through/Write-Behind × 六场景 + 三难判词 + 真 Redis写后读/WAL崩溃恢复/XFetch/分片/MVCC/2PC/环交叉印证），未配 cacheCoherency 为 null */
    cacheCoherencySnapshot: {
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
          flushLagMs: number; coalescedWrites: number; walEnabled: boolean; crossNodeReplicated: boolean
          crashed: boolean; readYourWrites: boolean; noWriteBlocking: boolean; durableOnCrash: boolean
        }>
      }>
      vectors: Record<string, string>
      crosscheck: Record<string, Record<string, any>>
      verdict: Record<string, any>
      topology: Record<string, any>
      builtAt: number
    } | null
    /** KI-513：分布式消息投递语义三协议快照（At-Most-Once/At-Least-Once/Exactly-Once × 六场景 + 三难判词 + 真 Bus/GameEventBus/Bridge/2PC/WAL/Redis/环交叉印证），未配 messageDelivery 为 null */
    messageDeliverySnapshot: {
      config: Record<string, any>
      rows: Array<{
        protocol: string
        trilemma: { noLoss: boolean; noDup: boolean; lowOverhead: boolean }
        totals: {
          sent: number; delivered: number; lost: number; duplicates: number; retries: number
          overheadUnits: number; idempotentHits: number; crashScenarios: number
        }
        scenarios: Array<{
          id: string; sent: number; delivered: number; lost: number; duplicates: number
          retries: number; overheadUnits: number; idempotentHits: number
          crashProbable: boolean; ackLostProbable: boolean
          noLoss: boolean; noDup: boolean; lowOverhead: boolean
        }>
      }>
      vectors: Record<string, string>
      crosscheck: Record<string, Record<string, any>>
      verdict: Record<string, any>
      topology: Record<string, any>
      builtAt: number
    } | null
    /** KI-518：延迟消息队列调度三协议快照（TimingWheel/MinHeap/RedisZset × 六场景 + 三难向量 + 七枚真件交叉印证），未配 delayQueue 为 null；rigged 向量由 trilemma 现算不硬覆盖 */
    delayQueueSnapshot: {
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
      crosscheck: { evidence: Record<string, any>; fpCeiling: Record<string, any> }
      verdict: Record<string, any>
      topology: Record<string, string>
      builtAt: number
    } | null
    /** KI-520：消息重试退避与死信队列三协议快照（Immediate/Exponential/FullJitter × 六场景 + 三难向量 + 七枚真件交叉印证），未配 retryDlq 为 null；rigged 101/101/101 因果锁死 noStorm、不硬造全 111 */
    retryDlqSnapshot: {
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
      crosscheck: { evidence: Record<string, any>; fpCeiling: Record<string, any> }
      verdict: Record<string, any>
      topology: Record<string, string>
      builtAt: number
    } | null
    /** KI-523：消费者组 rebalance / 分区所有权三协议快照（Range/RoundRobin/Sticky × 六场景 + 三难向量 + 九枚真件交叉印证），未配 consumerGroup 为 null；rigged 101/101/101 因果锁死 minimalMovement、不硬造全 111 */
    consumerGroupSnapshot: {
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
      crosscheck: { evidence: Record<string, any>; fpCeiling: Record<string, any> }
      verdict: Record<string, any>
      topology: Record<string, string>
      builtAt: number
    } | null
    /** KI-525：积压背压 / 流量削峰四策略快照（Backpressure/Buffering/Shedding/Scaling × 六场景 + 三难向量 + Little's Law 双路自证 + 十一枚真件交叉印证），未配 backpressure 为 null；rigged 110/110/110/110 因果锁死 highThroughput、不硬造全 111 */
    backpressureSnapshot: {
      config: Record<string, any>
      rows: Array<{
        strategy: string
        scenarios: Array<{
          id: string; strategy: string; arrivals: number; accepted: number; admitted: number
          rejected: number; dropped: number; served: number; endQueue: number; waitSum: number
          queueLenSum: number; avgWait: number; peakQueue: number; acceptedRate: number; muEffective: number
          backpressureTicks: number; fault: string; rebalances?: number
          noLoss: boolean; lowLatency: boolean; highThroughput: boolean
          littleLaw: { L: number; W: number; lambda: number; Lpred: number; gap: number; steadyStateReached: boolean; holds: boolean; nontrivial?: boolean }
        }>
        trilemma: { noLoss: boolean; lowLatency: boolean; highThroughput: boolean }
        metrics: { dropped: number; rejected: number; avgWait: number; peakQueue: number; rebalances: number }
      }>
      vectors: Record<string, string>
      littleLaw: { steadyHolds: boolean; steadyNontrivial: boolean; overloadBreaks: boolean; steady: Array<Record<string, any>>; overload: Array<Record<string, any>>; note: string }
      crosscheck: { evidence: Record<string, any>; fpCeiling: Record<string, any> }
      verdict: Record<string, any>
      topology: Record<string, string>
      builtAt: number
    } | null
    /** KI-526：日志压缩 / 回放边界三策略快照（SizeTimeRetention/KeyCompaction/SnapshotPlusWal × 六场景 + 三难向量 + verifyReplayBoundary 双路守恒自证 + 十一枚真件交叉印证），未配 logCompaction 为 null；rigged 110/110/110 因果锁死 fastRecovery、不硬造全 111 */
    logCompactionSnapshot: {
      config: Record<string, any>
      rows: Array<{
        strategy: string
        scenarios: Array<{
          id: string; strategy: string; totalOps: number; currentLsn: number; replayFromLsn: number
          compactedOps: number; retainedOps: number; replayOps: number; missingOps: number
          writeAmplification: number; cutoffLsn: number; tombstoneResurrect: number
          snapshotLsn?: number; snapshotEmpty?: boolean; dedupSkipped?: number; exactlyOnce?: boolean
          compactFootprint: boolean; replayCompleteness: boolean; fastRecovery: boolean
          inFootprintExam: boolean; inCompletenessExam: boolean; inRecoveryExam: boolean
          replayBoundary: { mode: string; totalOps: number; compactedOps: number; replayOps: number
            foldedOps: number; minReplay: number; costGap: number; snapshotLsn: number; currentLsn: number
            walFromLsn: number; walToLsn: number; replayFromLsn: number; distinctKeys: number
            tombstoneCleared: boolean; resurrected: boolean; walCovers: boolean
            replayCostConserved: boolean; replayComplete: boolean; nontrivial: boolean; holds: boolean }
        }>
        trilemma: { compactFootprint: boolean; replayCompleteness: boolean; fastRecovery: boolean }
        metrics: { compactedOps: number; replayOps: number; peakWriteAmplification: number; missingOps: number; tombstoneResurrect: number }
      }>
      vectors: Record<string, string>
      replayBoundary: { holds: boolean; nontrivial: boolean; falsifiable: boolean
        steady: Array<Record<string, any>>
        tamper: { replayOps: Record<string, any>; walGap: Record<string, any>; tombstone: Record<string, any> }
        note: string }
      crosscheck: { evidence: Record<string, any>; fpCeiling: Record<string, any> }
      verdict: Record<string, any>
      topology: Record<string, string>
      builtAt: number
    } | null
    /** KI-527：布隆/布谷鸟/计数布隆三过滤器快照（Bloom/CountingBloom/Cuckoo × 六场景 + 三难向量 110/011/101 + verifyFalsePositiveCeiling 双路自证 + 十一枚真件 21 键交叉印证），未配 bloomFilter 为 null；rigged 011/011/011 由 unlimitedRoom 真算因果锁死 compactFootprint、绝不硬造全 111 */
    bloomFilterSnapshot: {
      config: Record<string, any>
      rows: Array<{
        protocol: string
        scenarios: Array<{
          id: string; strategy: string; inserted: number; insertFailures: number; probes: number
          fpRate: number; fillRatio: number; bytes: number; bitsPerKey: number
          compactFootprint: boolean; insertsNeverFail: boolean; deleteSupport: boolean
          fault: string
        }>
        trilemma: { compactFootprint: boolean; insertsNeverFail: boolean; deleteSupport: boolean }
        metrics: { avgInserts: number; avgBytes: number; bitsPerKey: number; totalFpRate: number; totalInsertFailures: number; totalStashFailures: number; deleteSuccess: number; deleteAttempts: number }
      }>
      vectors: Record<string, string>
      crosscheck: { evidence: Record<string, any>; fpCeiling: Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
    } | null
    /** KI-528：LRU/2Q/ARC 三替换策略快照（LRU/2Q/ARC × 六场景 + 三难向量 + verifyDualSweep 双路交叉印证 + 十一枚真件交叉印证），未配 cacheReplacement 为 null；rigged 110/110/110 因果锁死 adaptiveBalance；不得硬造全 111 */
    cacheReplacementSnapshot: {
      config: Record<string, any>
      rows: Array<{
        protocol: string
        scenarios: Array<{
          id: string; protocol: string; hits: number; misses: number; hitRate: number
          scanHits: number; scanMisses: number; localHits: number; localMisses: number
          amPromotions?: number; ghostHitsT1?: number; ghostHitsT2?: number; ghostAdaptMoves?: number
          fault: string
        }>
        trilemma: { scanResistance: boolean; stableHitRate: boolean; adaptiveBalance: boolean }
        metrics: { hitRateAvg: number; ghostAdaptMoves: number; amPromotions: number; adaptationP: number }
      }>
      vectors: Record<string, string>
      crosscheck: { evidence: Record<string, any>; fpCeiling: Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
    } | null
  }>
}
