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
    /** KI-528：LRU/2Q/ARC 三替换策略快照（LRU/2Q/ARC × 六场景 + 三难向量 010/110/101 + verifyDualSweep 双路交叉印证（三路篡改真喂回现算翻 false）+ 十一真件 21 键交叉印证），未配 cacheReplacement 为 null；rigged 两开关真进构造 ⇒ 向量现算收敛 110/110/110、adaptiveBalanceCausallyUnerasable 因果锁死自适应维；不得硬造全 111 */
    cacheReplacementSnapshot: {
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
      crosscheck: { evidence: Record<string, any>; fpCeiling: Record<string, any>; dualSweep: { holds: boolean; tamper: Record<string, any> } & Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
    } | null
    /** KI-529：流式窗口聚合与 Watermark 迟到处置三策略快照（Tumbling/Sliding/Session × 六场景 + 三难向量 011/110/101 + verifyWatermarkMonotonicity 双路交叉印证（到达序 watermark 单调 + 承诺地平线 / 处置守恒，三路篡改真喂回现算翻 false）+ 十一真件 21 键交叉印证），未配 streamWindow 为 null；rigged 三开关真进构造 ⇒ 向量现算收敛 011/011/011、resultCompletenessCausallyUnerasable 因果锁死结果维；不得硬造全 111 */
    streamWindowSnapshot: {
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
      crosscheck: { evidence: Record<string, any>; watermark: { holds: boolean; nontrivial: boolean; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
    } | null
    /** KI-530：基数估计算法族诚实权衡快照（ExactSet/HyperLogLog/LinearCounting × 六场景 + 三难向量 101/110/010 + verifySparseEstimate 双路交叉印证 + 十一真件 21 键交叉印证），未配 hyperLogLog 为 null；rigged 预言机开关后 ExactSet 收敛 111、HLL/LC 仍 110；不得硬造全 111 */
    hyperLogLogSnapshot: {
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
      crosscheck: { evidence: Record<string, any>; estimate: { holds: boolean; nontrivial: boolean; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
    } | null
    /** KI-531：CRDT 最终一致冲突消解三策略快照（LWWRegister/GCounter/OrSet(add-wins) × 六场景 + 三难向量维序 [strongEventualConvergence/expressiveness/compactMetadata] 默认 011/100/110 + verifyConvergence 双路交叉印证（三副本乱序+重复 anti-entropy 后 value 逐字相等 + 真值不变量 + 三路篡改真喂回现算翻 false）+ 十一真件 21 键交叉印证），未配 crdt 为 null；rigged 三开关 uniformClock/infiniteMetadata/coordinatedDelete 齐开后唯一翻 GCounter compact⇒101、三条因果结构锁（LWW 并发丢/decrement 不可减/OrSet tag 不可压）钉死、noUniversalWinner 仍真绝不硬造 111；诚实口径：三者严格 SEC 全收敛、LWW 破在并发意图、OrSet add-wins */
    crdtSnapshot: {
      config: Record<string, any>
      rows: Array<{
        protocol: string
        vector?: string
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
      baseVectors?: Record<string, string>
      crosscheck: { evidence: Record<string, any>; convergence: { holds: boolean; nontrivial: boolean; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
    } | null
    /** KI-532：Spring Batch chunk-oriented R-P-W 教学件快照（BulkWriter/ChunkedWriter/SkipRetryWriter × 六场景 + 三难向量维序 [faultIsolation/restartability/throughput] 默认 001/110/101 + verifyCheckpoint 双路自证（clean 全量基准 + poison chunk 隔离/已 commit 零重复/非毒零丢失/真检测毒 四观测量 + 三路篡改真喂回同一内核现算翻 false）+ 十一真件 21 键交叉印证），未配 springBatch 为 null；rigged 双开关 perfectOracle/unlimitedSkip 令 Bulk≡Skip=101 区分度诚实收敛（riggedConvergenceCollapsed=true）、noStrategyWinsAll 仍真绝不硬造 111；三条因果结构锁（chk 权衡/skip 永久丢/bulk 整批死）在同一含毒 raw 流真跑现算钉死、causalLocksAllHold=true */
    springBatchSnapshot: {
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
      crosscheck: { evidence: Record<string, any>; checkpoint: { holds: boolean; baselineHolds: boolean; nontrivial: boolean; falsifiable: boolean; invariants: Record<string, boolean>; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
      rigged: boolean
    } | null
    /** KI-535：Spring Cloud 分布式会话三策略快照（StickySession/JwtStateless/RedisSessionStore × 六场景 + 三难向量 011/101/110 + verifySessionCoherence 双路交叉印证 + 十一真件 21 键交叉印证），未配 distributedSession 为 null；Sticky 节点死丢/JWT 撤销不即时/Redis 依赖基建各自诚实标注 */
    distributedSessionSnapshot: {
      config: Record<string, any>
      rows: Array<{
        protocol: string
        scenarios: Array<{
          id: string; sessions: number; writes: number; reads: number; revokedCount: number
          sharedCoherence: boolean; instantRevocation: boolean; zeroInfra: boolean; fault: string
        }>
        trilemma: { sharedCoherence: boolean; instantRevocation: boolean; zeroInfra: boolean }
        metrics: { sessionWrites: number; readableSessions: number; revokedCells: number }
      }>
      vectors: Record<string, string>
      noUniversalWinner: boolean
      trilemmaDistinguishes: boolean
      causalLocks: { stickySingleNodeCausallyUnerasable: boolean; jwtNoInstantRevokeCausallyUnerasable: boolean; redisColdStartCausallyUnerasable: boolean; causalLocksAllHold: boolean; revocationProbe: number }
      crosscheck: { evidence: Record<string, any>; coherence: { holds: boolean; nontrivial: boolean; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
    } | null
    /** KI-534：事务性发件箱与消费幂等快照（DualWrite/PollingOutbox/CdcOutbox × 六场景 + 三难向量 011/101/110 + verifyOutboxSoundness 双路交叉印证 + 十一真件 21 键交叉印证），未配 transactionalOutbox 为 null；双写崩溃丢/轮询有 lag/CDC 无 dedup 各自诚实标注 */
    transactionalOutboxSnapshot: {
      config: Record<string, any>
      rows: Array<{
        protocol: string
        scenarios: Array<{
          id: string; committed: number; delivered: number; lost: number; ghost: number; duplicates: number
          maxDeliveryLag: number
          atomicDelivery: boolean; lowLatency: boolean; noDuplicate: boolean; fault: string
        }>
        trilemma: { atomicDelivery: boolean; lowLatency: boolean; noDuplicate: boolean }
        metrics: { committed: number; delivered: number; lost: number; duplicates: number; maxDeliveryLag: number }
      }>
      vectors: Record<string, string>
      noUniversalWinner: boolean
      trilemmaDistinguishes: boolean
      causalLocks: { atomicDeliveryRequiresOutboxCausallyUnerasable: boolean; atLeastOnceRequiresDedupCausallyUnerasable: boolean; zeroLatencyNeedsCdcReplayCausallyUnerasable: boolean; causalLocksAllHold: boolean; retrySweep: any[]; pollSweep: any[] }
      crosscheck: { evidence: Record<string, any>; soundness: { holds: boolean; nontrivial: boolean; laneA: Record<string, any>; laneAOk: boolean; laneB: Record<string, any>; laneBOk: boolean; tamper: Record<string, any> } & Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
      rigged: boolean
    } | null
    /** KI-536：Spring Cloud 负载均衡三策略快照（WeightedRoundRobin/LeastConnections/ConsistentHash × 六场景 + 三难向量 101/100/011 + verifyRoutingSoundness 双路交叉印证 + 十一真件 21 键交叉印证），未配 loadBalance 为 null；轮询无视负载/最小连接直挂真计数器/一致性环 skew 恒在各自诚实标注 */
    loadBalanceSnapshot: {
      config: Record<string, any>
      rows: Array<{
        protocol: string
        scenarios: Array<{
          id: string; requests: number; maxLoad: number; minLoad: number; skew: number; stickyHits: number
          evenDistribution: boolean; stickyAffinity: boolean; stateFree: boolean; fault: string
        }>
        trilemma: { evenDistribution: boolean; stickyAffinity: boolean; stateFree: boolean }
        metrics: { totalRequests: number; worstSkew: number; stickyHits: number }
      }>
      vectors: Record<string, string>
      noUniversalWinner: boolean
      trilemmaDistinguishes: boolean
      causalLocks: { roundRobinBlindToLoadCausallyUnerasable: boolean; leastConnRequiresSharedCountersCausallyUnerasable: boolean; consistentHashSkewCausallyUnerasable: boolean; causalLocksAllHold: boolean; probeSkew: any }
      crosscheck: { evidence: Record<string, any>; routing: { holds: boolean; nontrivial: boolean; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
      rigged: boolean
    } | null
    /** KI-537：Spring Cloud CircuitBreaker 三策略快照（CountBasedBreaker/RateBasedBreaker/SlowCallBreaker × 六场景 + 三难向量 100/101/011 + verifyCircuitSoundness 双路交叉印证 + 十一真件 21 键交叉印证），未配 circuitBreaker 为 null；纯计数对慢盲/率 normalize 不误判/慢调用忽略硬故障各自诚实标注 */
    circuitBreakerSnapshot: {
      config: Record<string, any>
      rows: Array<{
        protocol: string
        scenarios: Array<{
          id: string; calls: number; trips: number; failureRate?: number; slowRate?: number; finalState: string
          hardFaultsAware: boolean; degradedFaultsAware: boolean; sparseTrafficSafe: boolean; fault: string
        }>
        trilemma: { hardFaultsAware: boolean; degradedFaultsAware: boolean; sparseTrafficSafe: boolean }
        metrics: { totalTrips: number; finalOpenCount: number }
      }>
      vectors: Record<string, string>
      noUniversalWinner: boolean
      trilemmaDistinguishes: boolean
      causalLocks: { countThresholdIgnoresSlowCausallyUnerasable: boolean; rateThresholdRequiresSampleCausallyUnerasable: boolean; slowCallIgnoresHardFaultsCausallyUnerasable: boolean; causalLocksAllHold: boolean }
      crosscheck: { evidence: Record<string, any>; soundness: { holds: boolean; nontrivial: boolean; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
      rigged: boolean
    } | null
    /** KI-538：LLM 网关三策略快照（OfflineDouble/LiveGrounded/CachedLive × 六场景 + 三难向量 + verifyGatewaySoundness 双路自证 + 十一真件 21 键），未配 llmGateway 为 null；caller-side 可 opt-in 进 live，但默认整体离线 */
    llmGatewaySnapshot: {
      config: Record<string, any>
      rows: Array<{
        protocol: string
        scenarios: Array<{
          id: string; status?: string; mode?: string; ok?: boolean; statusCode?: number; tokens?: number; cachedHit?: boolean
          liveGrounded: boolean; reproducible: boolean; zeroCost: boolean; fault?: string
        }>
        trilemma: { liveGrounded: boolean; reproducible: boolean; zeroCost: boolean }
        metrics: Record<string, any>
      }>
      vectors: Record<string, string>
      noUniversalWinner: boolean
      trilemmaDistinguishes: boolean
      causalLocks: { offlineZeroCostCausallyUnerasable: boolean; offlineReproducibleCausallyUnerasable: boolean; badJsonNeverGroundedCausallyUnerasable: boolean; cachedHitReproducibleCausallyUnerasable: boolean; firstCallCostCausallyUnerasable: boolean; causalLocksAllHold: boolean; probes?: any }
      crosscheck: { evidence: Record<string, any>; gateway?: any; soundness?: any } & Record<string, any>
      verdict: Record<string, any>
      builtAt: number
      rigged: boolean
    } | null
    /** KI-539：Spring Cloud Gateway 路由三策略快照（PathPrefixRouting/RegexCaptureRouting/HeaderGroupRouting × 六场景 + 三难向量 001/110/101 + verifyGatewayRoutingSoundness 双路交叉印证 + 十一真件 21 键交叉印证），未配 gatewayRouting 为 null */
    gatewayRoutingSnapshot: {
      config: Record<string, any>
      rows: Array<{
        protocol: string
        scenarios: Array<{
          id: string; requests: number; hits: number; miss: number
          strictMatch: boolean; capturePower: boolean; debugFriendly: boolean; fault: string
        }>
        trilemma: { strictMatch: boolean; capturePower: boolean; debugFriendly: boolean }
        metrics: { totalHits: number; strictCells: number; powerCells: number }
      }>
      vectors: Record<string, string>
      noUniversalWinner: boolean
      trilemmaDistinguishes: boolean
      causalLocks: { pathPrefixMatchingConflictsCausallyUnerasable: boolean; regexCaptureExtraCostCausallyUnerasable: boolean; headerGroupHeaderDependencyCausallyUnerasable: boolean; causalLocksAllHold: boolean }
      crosscheck: { evidence: Record<string, any>; routing: { holds: boolean; nontrivial: boolean; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
      rigged: boolean
    } | null
    /** KI-540：消费端幂等去重三策略快照（InMemoryDedupSet/RedisSetNx/BloomGuard × 六场景 + 三难向量 110/101/011 + verifyIdempotencySoundness 双路交叉印证 + 十一真件 21 键交叉印证），未配 idempotentConsumer 为 null */
    idempotentConsumerSnapshot: {
      config: Record<string, any>
      rows: Array<{
        protocol: string
        scenarios: Array<{
          id: string; messages: number; exact: number; rejected: number; falsePositiveRejections: number; oom: number
          exactDedup: boolean; lowOverhead: boolean; durableBounded: boolean; fault: string; loadFactor?: number | null; fpr?: number
        }>
        trilemma: { exactDedup: boolean; lowOverhead: boolean; durableBounded: boolean }
        metrics: { totalExact: number; totalRejected: number; falsePositiveRejections: number; totalOom: number }
      }>
      vectors: Record<string, string>
      noUniversalWinner: boolean
      trilemmaDistinguishes: boolean
      causalLocks: { bloomFalsePositiveCausallyUnerasable: boolean; redisRttCausallyUnerasable: boolean; inMemoryVolatilityCausallyUnerasable: boolean; causalLocksAllHold: boolean; probes?: Record<string, number> }
      crosscheck: { evidence: Record<string, any>; soundness: { holds: boolean; nontrivial: boolean; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
      rigged: boolean
    } | null
    /** KI-541：Kafka 消费组再平衡三策略快照（Eager/CooperativeSticky/StaticMembership × 六场景 + 三难向量 011/101/110 + verifyRebalanceSoundness 双路交叉印证 + 十一真件 21 键交叉印证），未配 consumerRebalance 为 null */
    consumerRebalanceSnapshot: {
      config: Record<string, any>
      rows: Array<{
        protocol: string
        scenarios: Array<{
          id: string; members: number; partitionsAssigned: number; fullStops: number; revokedPartitions: number; conflictWindow: number; staleMembers: number
          zeroStopPause: boolean; simpleProtocol: boolean; staleFreeAssignment: boolean; fault: string
        }>
        trilemma: { zeroStopPause: boolean; simpleProtocol: boolean; staleFreeAssignment: boolean }
        metrics: { totalMembers: number; totalFullStops: number; totalRevoked: number; totalConflictWindows: number; totalStale: number }
      }>
      vectors: Record<string, string>
      noUniversalWinner: boolean
      trilemmaDistinguishes: boolean
      causalLocks: { eagerPauseCausallyUnerasable: boolean; cooperativeIncrementalComplexityCausallyUnerasable: boolean; staticSessionTimeoutCausallyUnerasable: boolean; causalLocksAllHold: boolean; probes?: Record<string, number> }
      crosscheck: { evidence: Record<string, any>; soundness: { holds: boolean; nontrivial: boolean; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
      rigged: boolean
    } | null
    /** KI-542：有界优先级队列三策略快照（BoundedStrict/MotionWeightedFair/DeadlineScheduler × 四场景 + 三难向量 100/010/101 + verifyPriorityScheduleSoundness 双路交叉印证 + 十一真件 21 键交叉印证），未配 priorityQueue 为 null */
    priorityQueueSnapshot: {
      config: Record<string, any>
      rows: Array<{
        protocol: string
        scenarios: Array<{
          id: string; messages: number; pushed: number; rejected: number; heapOps: number
          lowOverhead: boolean; boundedUnfairness: boolean; deadlineAwareness: boolean; fault: string
        }>
        trilemma: { lowOverhead: boolean; boundedUnfairness: boolean; deadlineAwareness: boolean }
        metrics: { totalPush: number; totalRejected: number; totalHeapOps: number }
      }>
      vectors: Record<string, string>
      noUniversalWinner: boolean
      trilemmaDistinguishes: boolean
      causalLocks: { strictStarvationCausallyUnerasable: boolean; fairVtimeAccountingCausallyUnerasable: boolean; deadlineBlindnessCausallyUnerasable: boolean; causalLocksAllHold: boolean; probes?: Record<string, number> }
      crosscheck: { evidence: Record<string, any>; soundness: { holds: boolean; nontrivial: boolean; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
      rigged: boolean
    } | null
    /** KI-543：批流 join 三策略快照（MicroBatchJoin/StreamWindowJoin/CdcOutboxJoin × 四场景 + 三难向量 101/010/110 + verifyBatchStreamJoinSoundness 双路交叉印证 + 十一真件 21 键交叉印证），未配 batchStreamJoin 为 null */
    batchStreamJoinSnapshot: {
      config: Record<string, any>
      rows: Array<{
        protocol: string
        scenarios: Array<{
          id: string; messages: number; joins: number; duplicates: number
          bulkThroughput: boolean; lowLatency: boolean; exactlyOnce: boolean; fault: string
        }>
        trilemma: { bulkThroughput: boolean; lowLatency: boolean; exactlyOnce: boolean }
        metrics: { totalJoins: number; totalDuplicates: number }
      }>
      vectors: Record<string, string>
      noUniversalWinner: boolean
      trilemmaDistinguishes: boolean
      causalLocks: { batchWindowCausallyUnerasable: boolean; streamExactlyOnceCausallyUnerasable: boolean; cdcReplayCausallyUnerasable: boolean; causalLocksAllHold: boolean; probes?: Record<string, number> }
      crosscheck: { evidence: Record<string, any>; soundness: { holds: boolean; nontrivial: boolean; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
      rigged: boolean
    } | null
    /** KI-544：CDC outbox join 三策略快照（LsmSnapshotJoin/RawBinlogJoin/OutboxAtomicJoin × 四场景 + 三难向量 101/011/100 + verifyCdcOutboxJoinSoundness 双路交叉印证 + 十一真件 21 键交叉印证），未配 cdcOutboxJoin 为 null */
    cdcOutboxJoinSnapshot: {
      config: Record<string, any>
      rows: Array<{
        protocol: string
        scenarios: Array<{
          id: string; messages: number; joins: number
          snapshotConsistent: boolean; zeroDowntime: boolean; rendezvousCapable: boolean; fault: string
        }>
        trilemma: { snapshotConsistent: boolean; zeroDowntime: boolean; rendezvousCapable: boolean }
        metrics: { totalJoins: number; totalMessages: number }
      }>
      vectors: Record<string, string>
      noUniversalWinner: boolean
      trilemmaDistinguishes: boolean
      causalLocks: { snapshotCommitWindowCausallyUnerasable: boolean; binlogBorderlineCausallyUnerasable: boolean; outboxLockCausallyUnerasable: boolean; causalLocksAllHold: boolean; probes?: Record<string, number> }
      crosscheck: { evidence: Record<string, any>; soundness: { holds: boolean; nontrivial: boolean; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
      rigged: boolean
    } | null
    /** KI-533：可观测性分布式追踪采样三策略快照（HeadBased/TailBased/Adaptive × 六场景 + 三难向量维序 [lowOverhead/anomalyCapture/loadAdaptive] 默认 100/010/101 + verifySamplingSoundness 双路自证（干净流 buffer 守恒 + 含 error 流 error 全留/span 无重复/span 完整/正常按率四观测量 + 三路篡改真喂回同一内核现算翻 false）+ 十一真件 21 键交叉印证），未配 traceSampling 为 null；rigged 三开关 oracleHead/infiniteBuffer/perfectFeedback 分策略正交反事实：全开收敛 Head≡Tail=110 区分度诚实塌缩（riggedConvergenceCollapsed=true）、noStrategyWinsAll 仍真绝不硬造 111；三条因果结构锁（异常需缓冲/头部盲结构/自适应滞后）在同一含 error raw 流真跑现算钉死、causalLocksAllHold=true、decisionInvariant 翻转标签逐 id 决策恒同 */
    traceSamplingSnapshot: {
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
        anomalyRequiresBufferingCausallyUnerasable: boolean
        headBlindnessCausallyUnerasable: boolean
        adaptiveLagCannotGuaranteeAnomalyCausallyUnerasable: boolean
        causalLocksAllHold: boolean; decisionInvariant: boolean; maxBlindnessGap: number
        rateSweep: Array<{ rate: number; errorRate: number; normalRate: number }>
        adaptivePerfectLost: number; adaptiveBaseLost: number
      }
      crosscheck: { evidence: Record<string, any>; soundness: { holds: boolean; baselineHolds: boolean; nontrivial: boolean; falsifiable: boolean; invariants: Record<string, boolean>; laneA: Record<string, any>; laneB: Record<string, any>; tamper: Record<string, any> } & Record<string, any> }
      verdict: Record<string, any>
      builtAt: number
      rigged: boolean
    } | null
  }>
}
