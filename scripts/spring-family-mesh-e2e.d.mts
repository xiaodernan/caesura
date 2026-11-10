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
  }>
}
