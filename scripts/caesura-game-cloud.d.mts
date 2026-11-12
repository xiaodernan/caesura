/** `scripts/caesura-game-cloud.mjs` 的声明：游戏侧「开箱即用」云入口（集大成最终收口）。 */

export interface GameCloudOptions {
  gameId?: string
  gameName?: string
  gameAddress?: string
  gamePort?: number
  gameHealth?: () => any
  sources?: Record<string, () => Promise<any[]> | any[]>
  gateway?: any
  tracer?: any
  breakerOpts?: { failureThreshold?: number; cooldownMs?: number; halfOpenMax?: number; windowSize?: number }
  transport?: (t: any, path: string, init?: any) => Promise<any>
  cloud?: any
  bus?: { publish(event: string, ...args: unknown[]): boolean }
  eventsChannel?: string
  eventsTransport?: string
  eventBinder?: any
  requiredScopes?: string[]
  gameBridgeRoutes?: Array<{ from: 'game' | 'cloud'; key: string; type: string }>
  onBridgeEvent?: (e: object) => void
  /** KI-491：LB 策略（round-robin/random/weight）与灰度/金丝雀决策器（true 或注入对象）。 */
  lbStrategy?: 'round-robin' | 'random' | 'weight'
  gray?: boolean | Record<string, any>
  /** KI-493：鉴权 introspection 缓存。true 用默认预算建一只；也可直接塞一只现成 cache。 */
  authCache?: boolean | { get(k: string): any; set(k: string, v: any, ttlMs?: number): any; stats?(): any }
  authCacheTtlMs?: number
  authCacheMaxEntries?: number
  authCacheMaxBytes?: number
  authNegativeTtlMs?: number
  /** KI-494：计网算法可观测包。true 用缺省阈值建一只；对象逐项注入六只状态机阈值。 */
  net?: boolean | Record<string, any>
  netNow?: () => number
  /** KI-496：LSM 风格存储引擎。true 用缺省阈值建一只；对象逐项注入阈值，或直接塞一只现成 store。 */
  store?: boolean | Record<string, any> | { put(k: any, v: any): any; get(k: any): any; stats?(): any; snapshot?(): any }
  storeNow?: () => number
  /** KI-497：OS/硬件适配对照包。true 用缺省规模建；对象逐项注入规模/阈值（poolAccesses/counterCount/jumpStride/...）。 */
  hw?: boolean | Record<string, any>
  hwNow?: () => number
  /** KI-499：一致性哈希环 + 缓存分片。true 用缺省节点集建；对象逐项注入（nodes/virtualNodes/hashFn/weightOf/salt/remappingKeys/probeAddNodes），或直接塞一只现成 ring。 */
  hashRing?: boolean | Record<string, any> | { lookup(k: any): any; [k: string]: any }
  hashNow?: () => number
  /** KI-500：分片缓存客户端。true 用缺省三片建；对象逐项注入（shards/ring/cacheFactory/cacheOpts/virtualNodes/hashFn/salt/retentionKeys/retentionNextShards），或直接塞一只现成实例。 */
  shardedCache?: boolean | Record<string, any> | { shardOf(k: any): any; [k: string]: any }
  cacheNow?: () => number
  /** KI-501：缓存防护三件套（击穿/穿透/雪崩）。true 用缺省规模；对象逐项注入（concurrency/keys/ttlMs/beta/jitterRatio/buckets/rounds/queryKeys/...），或直接塞一只现成 study（带 stampede/penetration/avalanche）。 */
  cacheGuard?: boolean | Record<string, any> | { stampede: any; penetration: any; avalanche: any; [k: string]: any }
  guardNow?: () => number
  /** KI-502：网关限流算法族 + Redis 原子令牌桶。true 用缺省规模；对象逐项注入（limit/windowMs/capacity/
   * refillPerSec/leakPerSec/arrivals/concurrency/redisCapacity/redisRefillPerSec/backend/yield/...），或直接塞
   * 一只现成 study（带 algorithms/redis 两块）。 */
  rateLimit?: boolean | Record<string, any> | { algorithms: any; redis: any; [k: string]: any }
  rlNow?: () => number
  /** KI-503：服务故障检测器（φ 累积风险 + SWIM 成员协议 + 健康视图缓存）。true 用缺省规模；
   * 对象逐项注入（threshold/fixedTimeoutMs/windowSize/minStdDeviationMs/spikeCount/spikeGapMs/
   * stableCount/faultCapMs/stepMs/probeIntervalMs/suspicionMult/retransmitLimit/healthTtlMs/...），
   * 或直接塞一只现成 study（带 comparison/swim/health 三块）。 */
  failureDetector?: boolean | Record<string, any> | { comparison: any; swim: any; health: any; [k: string]: any }
  fdNow?: () => number
  /** KI-504：B+ 树索引引擎 + 与 LSM 三笔账诚实对照。true 用缺省规模；
   * 对象逐项注入（keyCount/order/leafCapacity/overwriteEvery/probeEvery/rangeFractions/rangeWidth/
   * extraMissKeys/lsmMemtableMax/lsmLevelMultiplier/lsmIndexEvery/lsmBitsPerKey/lcgSeed/heightLadder/...），
   * 或直接塞一只现成 study（带 comparison/heightLadder/verdict 三块）。 */
  bplusIndex?: boolean | Record<string, any> | { comparison: any; heightLadder: any[]; verdict: any; [k: string]: any }
  bpNow?: () => number
  /** KI-505：事务与并发控制（MVCC 多版本可见性 + 五档隔离异常矩阵 + 行锁 2PL 死锁检测）。true 用缺省规模；
   * 对象逐项注入（now/schedules/initialA/initialB/dirtyWrite/updateA1/updateA2/victim/gcVersions/
   * gcLongWaterMark/gcCleanWaterMark/...），或直接塞一只现成 study（带 comparison/deadlock/gc/verdict 四块）。 */
  mvccTxn?: boolean | Record<string, any> | { comparison: any; deadlock: any; gc: any; verdict: any; [k: string]: any }
  txnNow?: () => number
  /** KI-506：分布式事务三协议诚实权衡（2PC 阻塞 / Saga 补偿留脏 / TCC 三阶段幂等）。true 用缺省规模；
   * 对象逐项注入（now/participants/sagaSteps/tccSteps/failIndex/compensateFailIndex/confirmFlakyIndex/
   * confirmFailTimes/maxRetries/scenarios/...），或直接塞一只现成 study（带 comparison/idempotency/tccRetry/verdict 五块）。 */
  distributedTxn?: boolean | Record<string, any> | { comparison: any; idempotency: any; tccRetry: any; verdict: any; [k: string]: any }
  dtxnNow?: () => number
  /** KI-507：Raft 共识与复制状态机三协议诚实权衡（Raft 单 leader / 多主复制 / Gossip 反熵）。true 用缺省规模；
   * 对象逐项注入（now/nodes/seed/rand/antiEntropyRounds/replicationRounds/skipRounds/...），或直接塞一只现成 study
   * （带 comparison/election/replication/safety/gossip/verdict 六块）。 */
  raftConsensus?: boolean | Record<string, any> | { comparison: any; election: any; replication: any; safety: any; gossip: any; verdict: any; [k: string]: any }
  raftNow?: () => number
  /** KI-508：分布式锁与租约三协议诚实权衡（单 Redis SETNX+TTL / Redlock 多数派 / etcd Lease+Fencing）。true 用缺省规模；
   * 对象逐项注入（now/instances/nodes/seed/rand/ttlMs/scenarios/...），或直接塞一只现成 study
   * （带 comparison/setnx/redlock/fencing/verdict 五块）。 */
  distributedLock?: boolean | Record<string, any> | { comparison: any; setnx: any; redlock: any; fencing: any; verdict: any; [k: string]: any }
  dlockNow?: () => number
  /**
   * KI-509：true 装配分布式 ID 三协议权衡（UUIDv4 / Snowflake / Redis 号段 + KI-504 真 B+ 树交叉印证）。
   * 对象逐项注入（now/rand/seed/keyCount/segmentSize/treeOrder/leafCapacity/scenarios/...），或直接塞一只
   * 现成 study（带 comparison/uuid/snowflake/segment/btree/verdict 六块）。默认 false 不装配。 */
  idGen?: boolean | Record<string, any> | { comparison: any; uuid: any; snowflake: any; segment: any; btree: any; verdict: any; [k: string]: any }
  idGenNow?: () => number
  /**
   * KI-510：true 装配分布式限流三协议权衡（本地桶 / Redis 中心桶 / 一致性哈希分片桶 + 真 Redis 原子桶/真环交叉印证）。
   * 对象逐项注入（now/seed/instances/shards/capacity/requests/skewRatio/...），或直接塞一只现成 study
   * （带 rows/vectors/verdict/crosscheck/topology 五块）。默认 false 不装配。 */
  distributedRateLimit?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck: any; topology: any; [k: string]: any }
  drNow?: () => number
  /**
   * KI-511：true 装配分布式配置一致性三协议权衡（轮询 / 长轮询 / watch 推送 + 真 Config响应/watcher/bus/环交叉印证）。
   * 对象逐项注入（now/seed/clients/pollIntervalMs/burstCount/downDurationMs/...），或直接塞一只现成 study
   * （带 rows/vectors/verdict/crosscheck/topology 五块）。默认 false 不装配。 */
  configConsistency?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck: any; topology: any; [k: string]: any }
  dccNow?: () => number
  /**
   * KI-512：true 装配分布式缓存读写一致性三协议权衡（Cache-Aside / Write-Through / Write-Behind + 真 Redis写后读/WAL/MVCC/2PC/环 交叉印证）。
   * 对象逐项注入（now/seed/writes/manyKeys/backendRttMs/flushThreshold/walEnabled/...），或直接塞一只现成 study
   * （带 rows/vectors/verdict/crosscheck/topology 五块）。默认 false 不装配。 */
  cacheCoherency?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck: any; topology: any; [k: string]: any }
  cccNow?: () => number
  /**
   * KI-513：true 装配分布式消息投递语义三协议权衡（At-Most-Once / At-Least-Once / Exactly-Once + 真 Bus/GameEventBus/Bridge/2PC/WAL/Redis/环 交叉印证）。
   * 对象逐项注入（now/seed/messages/manyKeys/retryLimit/noCrash/ackReliable/freeIdempotency/...），或直接塞一只现成 study
   * （带 rows/vectors/verdict/crosscheck/topology 五块）。默认 false 不装配。 */
  messageDelivery?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck: any; topology: any; [k: string]: any }
  mmdNow?: () => number
  /**
   * KI-518：true 装配延迟消息队列调度三协议权衡（TimingWheel / MinHeap / RedisZset + 真环/Redis/WAL/Bus/TokenBucket/B+树/对象池 交叉印证）。
   * 对象逐项注入（now/seed/tickMs/wheelSlots/pollIntervalMs/tasks/zeroTick/freeHeapOps/sharedBackend/rigged/...），或直接塞一只现成 study
   * （带 rows/vectors/verdict/crosscheck/topology 五块）。默认 false 不装配。 */
  delayQueue?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck: any; topology: any; [k: string]: any }
  dqNow?: () => number
  /**
   * KI-520：true 装配消息重试退避与死信队列三协议权衡（Immediate / Exponential / FullJitter + 真最小堆/令牌桶/WAL/哈希环/幂等缓存/死信总线/对象池 交叉印证）。
   * 对象逐项注入（now/seed/messages/maxAttempts/baseTicks/capTicks/outageTicks/recoverAtTick/stormBudget/herdBudget/lagBudget/zeroBackoff/perfectJitter/noRetryBudget/rigged/...），
   * 或直接塞一只现成 study（带 rows/vectors/verdict/crosscheck/topology 五块）。默认 false 不装配。 */
  retryDlq?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck: any; topology: any; [k: string]: any }
  rdlNow?: () => number
  /**
   * KI-523：true 装配消费者组 rebalance / 分区所有权三协议权衡（Range / RoundRobin / Sticky + 九枚真件交叉印证）。
   * 对象逐项注入（now/seed/consumers/partitionsPerTopic/moveConsumers/movePartitions/bigConsumers/bigPartitions/balanceBudget/movementBudget/computeBudget/perfectBalance/zeroMovement/freeCompute/rigged/...），
   * 或直接塞一只现成 study（带 rows/vectors/verdict/crosscheck/topology 五块）。默认 false 不装配。 */
  consumerGroup?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck: any; topology: any; [k: string]: any }
  cgpNow?: () => number
  /**
   * KI-525：true 装配积压背压 / 流量削峰四策略权衡（Backpressure / Buffering / Shedding / Scaling + Little's Law 双路自证 + 十一枚真件交叉印证）。
   * 对象逐项注入（now/seed/steps/mu/acceptBudget/latencyBudget/bufferCap/memoryCap/shedThreshold/detectTicks/stallTicks/scaleFactor
   * /zeroLoss/boundedLatency/unlimitedBuffer/rigged/jitter/...），或直接塞一只现成 study（带 rows/vectors/verdict/crosscheck/littleLaw 五块）。默认 false 不装配。 */
  backpressure?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck: any; littleLaw: any; [k: string]: any }
  /** KI-525 积压背压的注入时钟（bpc=backpressure；bp* 已被 KI-504 B+ 树的 bpNow 占用，故不复用）。 */
  bpcNow?: () => number
  /**
   * KI-526：true 装配 append-only 日志压缩 / 回放边界三策略权衡（SizeTimeRetention / KeyCompaction / SnapshotPlusWal + verifyReplayBoundary 双路守恒自证 + 十一枚真件交叉印证）。
   * 对象逐项注入（now/seed/ops/keySpace/retentionOps/retentionMs/deleteRetention/snapshotAt/footprintBudget/replayBudget
   * /unlimitedRetention/instantSnapshot/zeroReplayCost/rigged/...），或直接塞一只现成 study（带 rows/vectors/verdict/crosscheck/topology 五块）。默认 false 不装配。 */
  logCompaction?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck: any; topology: any; [k: string]: any }
  /** KI-526 日志压缩的注入时钟（lc=log compaction，避开 lsm/bp/bpc/cgp/rdq/dld 已占用前缀）。 */
  lcNow?: () => number
  /**
   * KI-527：true 装配布隆/布谷鸟/计数布隆三过滤器诚实权衡（Bloom / CountingBloom / Cuckoo + verifyFalsePositiveCeiling 双路自证 + 十一枚真件交叉印证）。
   * 对象逐项注入（now/seed/capacity/bitsPerKey/bits/counterWidth/tableCount/bucketSize/maxKicks/benchKeys/maxLoadFactor
   * /unlimitedRoom/eternalStasis/noDeletesNeeded/rigged/...），或直接塞一只现成 study（带 rows/vectors/verdict 三块 + 元件）。默认 false 不装配。 */
  bloomFilter?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck?: any; topology?: any; [k: string]: any }
  /** KI-527 布隆过滤器的注入时钟（bf=Bloom filter，避开 lsm/bp/bpc/cgp/lc/rdq/dld 已占用前缀）。 */
  bfNow?: () => number
  /**
   * KI-528：true 装配 LRU/2Q/ARC 三替换策略诚实权衡（LRU / 2Q / ARC + verifyDualSweep 双路交叉印证 + 十一枚真件交叉印证）。
   * 对象逐项注入（now/seed/capacity/accesses/kCoefficient/perfectFuture/unlimitedRoom/scenarios/rigged/...），
   * 或直接塞一只现成 study（带 rows/vectors/verdict/crosscheck/topology 五块）。默认 false 不装配。 */
  cacheReplacement?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck?: any; topology?: any; [k: string]: any }
  /** KI-528 缓存替换的注入时钟（cr=cache replacement，避开 lsm/bp/bpc/cgp/lc/bf/rdq/dld 已占用前缀）。 */
  crNow?: () => number
  /**
   * KI-529：true 装配流式窗口聚合与 Watermark 迟到处置三策略诚实权衡（Tumbling / Sliding / Session + verifyWatermarkMonotonicity 双路交叉印证 + 十一枚真件交叉印证）。
   * 对象逐项注入（now/seed/windowSize/slideStep/sessionGap/allowedLateness/events/frozenWatermark/infiniteLateness/freeState/scenarios/rigged/...），
   * 或直接塞一只现成 study（带 rows/vectors/verdict/crosscheck 四块）。默认 false 不装配。 */
  streamWindow?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck?: any; topology?: any; [k: string]: any }
  /** KI-529 流式窗口的注入时钟（sw=stream window，避开 lsm/bp/bpc/cgp/lc/bf/cr/rdq/dld 已占用前缀）。 */
  swNow?: () => number
  /**
   * KI-530：true 装配基数估计算法族诚实权衡（ExactSet / HyperLogLog / LinearCounting + verifySparseEstimate 双路交叉印证 + 十一枚真件交叉印证）。
   * 对象逐项注入（now/seed/cardinality/mRegisters/scenarios/perfectHash/unlimitedMemory/rigged 等），
   * 或直接塞一只现成 study（带 rows/vectors/verdict/crosscheck 四块）。默认 false 不装配。 */
  hyperLogLog?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck?: any; topology?: any; [k: string]: any }
  /** KI-530 基数估计的注入时钟（hll=hyperloglog，避开 lsm/bp/bpc/cgp/lc/bf/cr/sw/rdq/dld 已占用前缀）。 */
  hllNow?: () => number
  /**
   * KI-531：true 装配 CRDT 最终一致冲突消解三策略诚实权衡（LWWRegister / GCounter / OrSet(add-wins) + verifyConvergence 双路自证 + 十一枚真件交叉印证）。
   * 对象逐项注入（now/seed/replicaCount/opsPerNode/skewTicks/uniformClock/infiniteMetadata/coordinatedDelete/rigged 等），
   * 或直接塞一只现成 study（带 rows/vectors/verdict/crosscheck 四块）。默认 false 不装配。 */
  crdt?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck?: any; topology?: any; [k: string]: any }
  /** KI-531 CRDT 的注入时钟（crdt=Conflict-free Replicated Data Type，避开 lsm/bp/bpc/cgp/lc/bf/cr/sw/rdq/dld 已占用前缀）。 */
  crdtNow?: () => number
  /** KI-532：Spring Batch chunk-oriented R-P-W 教学件。true 用缺省规模；
   * 对象逐项注入（now/seed/items/chunkSize/skipLimit/perfectOracle/unlimitedSkip/rigged 等），
   * 或直接塞一只现成 study（带 rows/vectors/verdict/crosscheck 四块）。默认 false 不装配。 */
  springBatch?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck?: any; [k: string]: any }
  /** KI-532 Spring Batch 的注入时钟（springBatch=Spring Batch chunk R-P-W，避开 lsm/bp/bpc/cgp/lc/bf/cr/sw/hll/rdq/dld/crdt 已占用前缀）。 */
  sbNow?: () => number
  /** KI-533：可观测性分布式追踪采样三策略教学件。true 用缺省规模；
   * 对象逐项注入（now/seed/items/rate/minRate/maxRate/windowSize/oracleHead/infiniteBuffer/perfectFeedback/rigged 等），
   * 或直接塞一只现成 study（带 rows/vectors/verdict/crosscheck 四块）。默认 false 不装配。 */
  traceSampling?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck?: any; [k: string]: any }
  /** KI-533 追踪采样的注入时钟（traceSampling=HeadBased/TailBased/Adaptive，避开 springBatch/sb 等已占用前缀）。 */
  tsNow?: () => number
  /**
   * KI-535：true 装配 distributed session 教学件（StickySession/JwtStateless/RedisSessionStore + verifySessionCoherence 双路交叉印证 + 十一枚真件交叉印证）。
   * 对象逐项注入（now/seed/sessions/ttlMs/perfectMirror/unlimitedTtl/skipRevocationCheck/scenarios/rigged 等），
   * 或直接塞一只现成 study（带 rows/vectors/verdict/crosscheck/causalLocks 五块）。默认 false 不装配。 */
  distributedSession?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck?: any; causalLocks?: any; [k: string]: any }
  /** KI-535 distributedSession 的注入时钟（ds=Distributed Session，避开 lsm/bp/bpc/cgp/lc/bf/cr/sw/hll/sb/ts/ds/rdq/dld 已占用前缀）。 */
  dsNow?: () => number
  /**
   * KI-534：true 装配 transactional outbox 教学件（DualWrite/PollingOutbox/CdcOutbox + verifyOutboxSoundness 双路交叉印证 + 十一枚真件交叉印证）。
   * 对象逐项注入（now/seed/items/pollInterval/cdcLag/retryLimit/latencyBudget/atomicMagic/zeroPollInterval/perfectDedup/rigged 等），
   * 或直接塞一只现成 study。默认 false 不装配。 */
  transactionalOutbox?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck?: any; causalLocks?: any; [k: string]: any }
  /** KI-534 transactionalOutbox 的注入时钟（to=transactional Outbox，避开 lsm/bp/bpc/cgp/lc/bf/cr/sw/hll/sb/ds/ts/to/rdq/dld 已占用前缀）。 */
  toNow?: () => number
  /**
   * KI-536：true 装配 Spring Cloud 负载均衡教学件（WeightedRoundRobin/LeastConnections/ConsistentHash + verifyRoutingSoundness 双路自证 + 十一枚真件交叉印证）。
   * 对象逐项注入（now/seed/requests/virtualNodes/capacity/uniformLoad/perfectRing/unlimitedBudget/scenarios/rigged 等），
   * 或直接塞一只现成 study。默认 false 不装配。 */
  loadBalance?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck?: any; causalLocks?: any; [k: string]: any }
  /** KI-536 loadBalance 的注入时钟（lb=load balance，避开 lsm/bp/bpc/cgp/lc/bf/cr/sw/hll/sb/lb/ds/ts/to/lb2/rdq/dld 已占用前缀）。 */
  lbNow?: () => number
  /**
   * KI-537：true 装配 Spring Cloud CircuitBreaker 教学件（CountBasedBreaker/RateBasedBreaker/SlowCallBreaker + verifyCircuitSoundness 双路自证 + 十一枚真件交叉印证）。
   * 对象逐项注入（now/seed/calls/windowSize/failureThreshold/failureRateThreshold/slowCallRateThreshold/slowThresholdMs/perfectMonitoring/unlimitedWindow/instantRecovery/scenarios/rigged 等），
   * 或直接塞一只现成 study。默认 false 不装配。 */
  circuitBreaker?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck?: any; causalLocks?: any; [k: string]: any }
  /** KI-537 circuitBreaker 的注入时钟（cb=circuit breaker，避开 lsm/bp/bpc/cgp/lc/bf/cr/sw/hll/sb/lb/ds/ts/to/cb/rdq/dld 已占用前缀）。 */
  cbNow?: () => number
  /**
   * KI-538：true 装配 LLM 网关教学件（OfflineDouble/LiveGrounded/CachedLive + verifyGatewaySoundness 双路交叉印证）。
   * 对象逐项注入（now/seed/model/baseUrl/timeoutMs/persistentCache/zeroTemp/localDouble/scenarios/rigged 等），
   * 或直接塞一只现成 study。**默认 false 不装配**；任何 live 模式必须由调用方显式 opts 指明，key 仅环境变量临时引用、绝不进仓。 */
  llmGateway?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; [k: string]: any }
  /** KI-538 llmGateway 的注入时钟（lg=LLM gateway，避开 lsm/bp/bpc/cgp/lc/bf/cr/sw/hll/sb/lb/ds/ts/to/cb/lg/rdq/dld 已占用前缀）。 */
  lgNow?: () => number
  /**
   * KI-539：true 装配 Spring Cloud Gateway 路由教学件（PathPrefixRouting/RegexCaptureRouting/HeaderGroupRouting + verifyGatewayRoutingSoundness 双路自证 + 十一枚真件交叉印证）。
   * 对象逐项注入（now/seed/requests/perfectGlobMatcher/regexProfiling/headerFallbackOnMiss/scenarios/rigged 等），
   * 或直接塞一只现成 study。默认 false 不装配。 */
  gatewayRouting?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck?: any; causalLocks?: any; [k: string]: any }
  /** KI-539 gatewayRouting 的注入时钟（gr=gateway routing，避开 lsm/bp/bpc/cgp/lc/bf/cr/sw/hll/sb/lb/ds/ts/to/cb/lg/gr/rr/dld/rdq 已占用前缀）。 */
  grNow?: () => number
  /**
   * KI-540：true 装配 Spring Cloud 幂等去重教学件（InMemoryDedupSet/RedisSetNx/BloomGuard + verifyIdempotencySoundness 双路交叉印证 + 十一枚真件交叉印证）。
   * 对象逐项注入（now/seed/messages/bloomBits/bloomK/redisTtlMs/unboundedRam/zeroRttNetwork/collisionFreeBloom/scenarios/rigged 等），
   * 或直接塞一只现成 study。默认 false 不装配。 */
  idempotentConsumer?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck?: any; causalLocks?: any; [k: string]: any }
  /** KI-540 idempotentConsumer 的注入时钟（idc=Idempotent Consumer，避开 lsm/bp/bpc/cgp/lc/bf/cr/sw/hll/sb/lb/ds/ts/to/cb/lg/gr/idc/rdq/dld 已占用前缀）。 */
  idcNow?: () => number
  /**
   * KI-541：true 装配 Kafka 消费组再平衡教学件（Eager/CooperativeSticky/StaticMembership + verifyRebalanceSoundness 双路自证 + 十一枚真件交叉印证）。
   * 对象逐项注入（now/seed/partitions/members/sessionTimeoutMs/perfectMemberSingleInstance/zeroIncrementalConflict/zeroSessionTimeout/scenarios/rigged 等），
   * 或直接塞一只现成 study。默认 false 不装配。 */
  consumerRebalance?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck?: any; causalLocks?: any; [k: string]: any }
  /** KI-541 consumerRebalance 的注入时钟（reb=Consumer Rebalance，避开 lsm/bp/bpc/cgp/lc/bf/cr/sw/hll/sb/lb/ds/ts/to/cb/lg/gr/idc/reb/rdq/dld 已占用前缀）。 */
  rebNow?: () => number
  /**
   * KI-542：true 装配有界优先级队列教学件（BoundedStrict/MotionWeightedFair/DeadlineScheduler + verifyPriorityScheduleSoundness 双路自证 + 十一枚真件交叉印证）。
   * 对象逐项注入（now/seed/messages/capacity/infiniteCapacity/zeroVtimeAccounting/infinitePriorityStarvation/scenarios/rigged 等），
   * 或直接塞一只现成 study。默认 false 不装配。 */
  priorityQueue?: boolean | Record<string, any> | { rows: any; vectors: any; verdict: any; crosscheck?: any; causalLocks?: any; [k: string]: any }
  /** KI-542 priorityQueue 的注入时钟（pq=Priority Queue，避开 lsm/bp/bpc/cgp/lc/bf/cr/sw/hll/sb/lb/ds/ts/to/cb/lg/gr/idc/reb/pq/rdq/dld 已占用前缀）。 */
  pqNow?: () => number
}

/** 创建一只游戏侧开箱即用云。 */
export function createGameCloud(opts?: GameCloudOptions): {
  runtime: any
  proxy: any
  events: any
  auth: any
  /** KI-493：鉴权 introspection 缓存实例（未配 opts.authCache 时为 null）。 */
  authCache: any
  /** KI-494：计网算法可观测包（未配 opts.net 时为 null）；observeOutcome/snapshot。 */
  net: { observeOutcome(sig?: { ok?: boolean; rttMs?: number; retransmitted?: boolean }): any; snapshot(): any; [k: string]: any } | null
  /** KI-496：LSM 存储引擎实例（未配 opts.store 时为 null）；put/get/flush/compact/stats/snapshot。 */
  store: { put(k: any, v: any): any; get(k: any): any; del?(k: any): any; flush?(): any; compact?(level?: number): any; stats(): any; snapshot?(): any; [k: string]: any } | null
  /** KI-497：OS/硬件适配对照包（未配 opts.hw 时为 null）；snapshot() 现跑三件确定性对照。 */
  hw: { snapshot(): any } | null
  /** KI-499：一致性哈希环实例（未配 opts.hashRing 时为 null）；addNode/removeNode/lookup/distribution/snapshot。 */
  hashRing: { addNode(id: any): any; removeNode(id: any): any; hasNode(id: any): boolean; nodeIds(): string[]; lookup(k: any): any; distribution(keys: any[]): any; snapshot(opts?: { ring?: boolean }): any; [k: string]: any } | null
  /** KI-499：造一只缓存分片路由（同 key 恒落同分片/同槽）；无环时为 null，不改调用路径。 */
  shardRouter: (() => any) | null
  /** KI-500：分片缓存客户端实例（未配 opts.shardedCache 时为 null）；shardOf/get/set/load/remapOn/stats/snapshot。 */
  shardedCache: { shardOf(k: any): string | null; get(k: any): any; set(k: any, v: any, ttlMs?: number): boolean; load(k: any, loader: (...a: any[]) => any, ttlMs?: number): Promise<any>; remapOn(shards: any[], keys?: any[]): any; stats(): any; snapshot(opts?: any): any; [k: string]: any } | null
  /** KI-501：缓存防护三件套汇总的现算入口（未配 opts.cacheGuard 时为 null）；调一次真跑击穿/穿透/雪崩对照。 */
  runCacheGuardStudy: (() => Promise<any>) | null
  /** KI-502：限流算法族 + Redis 原子性汇总的现算入口（未配 opts.rateLimit 时为 null）。 */
  runRateLimiterStudy: (() => Promise<any>) | null
  /** KI-503：服务故障检测器汇总的现算入口（未配 opts.failureDetector 时为 null）；真跑固定 vs φ 对照 + SWIM + 健康视图。 */
  runFailureDetectorStudy: (() => Promise<any>) | null
  /** KI-504：B+ 树索引引擎 + LSM 三笔账汇总的现算入口（未配 opts.bplusIndex 时为 null）；真跑点查比较数 / 范围叶链顺序扫 / 写放大对照。 */
  runBplusStudy: (() => Promise<any>) | null
  /** KI-505：事务并发控制汇总的现算入口（未配 opts.mvccTxn 时为 null）；真跑五档隔离异常矩阵 + 死锁环检测 + gc 水位对照。 */
  runMvccTxnStudy: (() => Promise<any>) | null
  /** KI-506：分布式事务三协议汇总的现算入口（未配 opts.distributedTxn 时为 null）；真跑 2PC/Saga/TCC × 六场景矩阵 + 三难判词。 */
  runDistributedTxnStudy: (() => Promise<any>) | null
  /** KI-507：Raft 共识三协议汇总的现算入口（未配 opts.raftConsensus 时为 null）；真跑 Raft/MultiMaster/Gossip × 六场景矩阵 + 三难判词。 */
  runRaftConsensusStudy: (() => Promise<any>) | null
  /** KI-508：分布式锁三协议汇总的现算入口（未配 opts.distributedLock 时为 null）；真跑 SETNX/Redlock/etcd × 六场景矩阵 + 三难判词。 */
  runDistributedLockStudy: (() => Promise<any>) | null
  /** KI-509：分布式 ID 三协议汇总的现算入口（未配 opts.idGen 时为 null）；真跑 UUID/Snowflake/号段 × 六场景矩阵 + 三难判词 + KI-504 真树交叉印证。 */
  runIdGenStudy: (() => Promise<any>) | null
  /** KI-510：分布式限流三协议汇总的现算入口（未配 opts.distributedRateLimit 时为 null）；真跑 本地桶/中心桶/分片桶 × 六场景矩阵 + 三难判词 + 真 Redis 原子桶/真环交叉印证。 */
  runDistributedRateLimitStudy: (() => Promise<any>) | null
  /** KI-511：分布式配置一致性三协议汇总的现算入口（未配 opts.configConsistency 时为 null）；真跑 轮询/长轮询/watch 推送 × 六场景矩阵 + 三难判词 + 真 Config响应/watcher/bus/hashSelector/XFetch/RedisTTL/环 交叉印证。 */
  runConfigConsistencyStudy: (() => Promise<any>) | null
  /** KI-512：分布式缓存读写一致性三协议汇总的现算入口（未配 opts.cacheCoherency 时为 null）；真跑 Cache-Aside/Write-Through/Write-Behind × 六场景矩阵 + 三难判词 + 真 Redis写后读/WAL崩溃恢复/XFetch/分片/MVCC/2PC/环 交叉印证。 */
  runCacheCoherencyStudy: (() => Promise<any>) | null
  /** KI-513：分布式消息投递语义三协议汇总的现算入口（未配 opts.messageDelivery 时为 null）；真跑 At-Most-Once/At-Least-Once/Exactly-Once × 六场景矩阵 + 三难判词 + 真 Bus/GameEventBus/Bridge/2PC/WAL/Redis/环 交叉印证。 */
  runMessageDeliveryStudy: (() => Promise<any>) | null
  /** KI-518：延迟消息队列调度三协议汇总的现算入口（未配 opts.delayQueue 时为 null）；真跑 TimingWheel/MinHeap/RedisZset × 六场景矩阵 + 三难向量 + 七枚真件交叉印证；rigged 向量由 trilemma 现算不硬覆盖。 */
  runDelayQueueStudy: (() => Promise<any>) | null
  /** KI-520：消息重试退避与死信队列三协议汇总的现算入口（未配 opts.retryDlq 时为 null）；真跑 Immediate/Exponential/FullJitter × 六场景矩阵 + 三难向量 + 七枚真件交叉印证；rigged 101/101/101 因果锁死 noStorm、不硬造全 111。 */
  runRetryDlqStudy: (() => Promise<any>) | null
  /** KI-523：消费者组 rebalance / 分区所有权三协议汇总的现算入口（未配 opts.consumerGroup 时为 null）；真跑 Range/RoundRobin/Sticky × 六场景矩阵 + 三难向量 + 九枚真件交叉印证；rigged 101/101/101 因果锁死 minimalMovement、不硬造全 111。 */
  runConsumerGroupStudy: (() => Promise<any>) | null
  /** KI-525：积压背压 / 流量削峰四策略汇总的现算入口（未配 opts.backpressure 时为 null）；真跑 Backpressure/Buffering/Shedding/Scaling × 六场景矩阵 + 三难向量 + Little's Law 双路自证 + 十一枚真件交叉印证；rigged 110/110/110/110 因果锁死 highThroughput、不硬造全 111。 */
  runBackpressureStudy: (() => Promise<any>) | null
  /** KI-526：日志压缩 / 回放边界三策略汇总的现算入口（未配 opts.logCompaction 时为 null）；真跑 SizeTimeRetention/KeyCompaction/SnapshotPlusWal × 六场景矩阵 + 三难向量 + verifyReplayBoundary 双路守恒自证（三路篡改可证伪）+ 十一枚真件交叉印证；rigged 110/110/110 因果锁死 fastRecovery、不硬造全 111。 */
  runLogCompactionStudy: (() => Promise<any>) | null
  /** KI-527：布隆/布谷鸟/计数布隆三过滤器诚实权衡研究件；缺 opts.bloomFilter 时为 null；Bloom/CountingBloom/Cuckoo × 六场景矩阵 + 三难向量（默认 110/011/101 互异不封赢家；rigged 011/011/011 由 unlimitedRoom 真算因果锁死 compactFootprint、绝不硬造全 111）+ verifyFalsePositiveCeiling 双路自证（理论 ε vs 实测 FP 率真读数 + 三路篡改真喂回现算翻 false）+ 十一枚真件 21 键交叉印证。 */
  runBloomFilterStudy: (() => Promise<any>) | null
  /** KI-528：LRU/2Q/ARC 三替换策略诚实权衡研究件；缺 opts.cacheReplacement 时为 null；LRU/2Q/ARC × 六场景矩阵 + 三难向量（默认 010/110/101 互异不封赢家；rigged 两开关 unlimitedRoom+perfectFuture 真进构造 ⇒ 向量现算收敛 110/110/110、adaptiveBalanceCausallyUnerasable 因果锁死自适应维、绝不硬造全 111）+ verifyDualSweep 双路交叉印证（真 trace 两路独立重放 + 三路篡改真喂回现算翻 false）+ 十一真件 21 键交叉印证。 */
  runCacheReplacementStudy: (() => Promise<any>) | null
  /** KI-529：流式窗口聚合与 Watermark 迟到处置三策略诚实权衡研究件；缺 opts.streamWindow 时为 null；Tumbling/Sliding/Session × 六场景矩阵 + 三难向量（rigged 011/011/011 因果锁死 resultCompleteness、不得硬造全 111）+ verifyWatermarkMonotonicity 双路自证（到达序 watermark 单调 + 承诺地平线 / 处置守恒，三路篡改现算翻 false）+ 十一枚真件 21 键交叉印证。 */
  runStreamWindowStudy: (() => Promise<any>) | null
  /** KI-530：基数估计算法族诚实权衡研究件；缺 opts.hyperLogLog 时为 null；ExactSet/HyperLogLog/LinearCounting × 六场景矩阵 + 三难向量（ExactSet=101 / HyperLogLog=110 / LinearCounting=010，互异无一 111，rigged 预言机开关后 ExactSet 真收敛 111、HLL/LC 仍 110；绝不硬造全 111）+ verifySparseEstimate 双路自证（真 Set vs HLL 3σ + 三路篡改现算翻 false）+ 十一枚真件交叉印证。 */
  runStreamCardinalityStudy: (() => Promise<any>) | null
  /** KI-531：CRDT 最终一致冲突消解三策略诚实权衡研究件；缺 opts.crdt 时为 null；LWWRegister/GCounter/OrSet(add-wins) × 六场景矩阵 + 三难向量维序 [strongEventualConvergence/expressiveness/compactMetadata]（默认 011/100/110 互异不封赢家；rigged 三开关 uniformClock/infiniteMetadata/coordinatedDelete 齐开后唯一翻 GCounter compact⇒101，LWW 并发丢/OrSet tag 不可压/decrement 不可减三条因果结构锁钉死、noUniversalWinner 仍真、绝不硬造 111；三者严格 SEC 全收敛、LWW 破在并发意图、OrSet add-wins）+ verifyConvergence 双路自证（三副本乱序+重复 anti-entropy 后 value 逐字相等 + 真值不变量 + 三路篡改真喂回现算翻 false）+ 十一枚真件 21 键交叉印证。 */
  runCrdtStudy: (() => Promise<any>) | null
  /** KI-532：Spring Batch chunk-oriented R-P-W 教学件；缺 opts.springBatch 时为 null；BulkWriter/ChunkedWriter/SkipRetryWriter × 六场景矩阵 + 三难向量维序 [faultIsolation/restartability/throughput]（默认 001/110/101 互异不封赢家；restartability 与 throughput 共用 stats().checkpoints 观测量天然互斥，零查表现算；rigged 双开关 perfectOracle/unlimitedSkip 喂已预防剔除毒项的干净流 ⇒ Bulk≡Skip=101 区分度诚实收敛 riggedConvergenceCollapsed=true、noStrategyWinsAll 仍真绝不硬造 111，三条因果结构锁——chk 权衡/skip 永久丢/bulk 整批死——在同一含毒 raw 流真跑现算钉死 causalLocksAllHold=true，主教义 bulkExplodesOnPoison 恒以纯净基线标定不翻）+ verifyCheckpoint 双路自证（clean 全量基准 + poison chunk 隔离/已 commit 零重复/非毒零丢失/真检测毒 四观测量 + 三路篡改真喂回同一内核现算翻 false 带 baselineHolds）+ 十一枚真件 21 键交叉印证。 */
  runSpringBatchStudy: (() => Promise<any>) | null
  /** KI-535：Spring Cloud 分布式会话三策略诚实权衡教学件；缺 opts.distributedSession 时为 null；StickySession/JwtStateless/RedisSessionStore × 六场景矩阵 + 三难向量（默认 011/101/110 互异不封赢家）+ verifySessionCoherence 双路自证 + 十一枚真件交叉印证。 */
  runDistributedSessionStudy: (() => Promise<any>) | null
  /** KI-534：事务性发件箱与消费幂等教学件；缺 opts.transactionalOutbox 时为 null；DualWrite/PollingOutbox/CdcOutbox × 六场景矩阵 + 三难向量（默认 011/101/110 互异不封赢家）+ verifyOutboxSoundness 双路自证 + 十一枚真件交叉印证。 */
  runTransactionalOutboxStudy: (() => Promise<any>) | null
  /** KI-536：Spring Cloud 负载均衡三策略教学件；缺 opts.loadBalance 时为 null；WeightedRoundRobin/LeastConnections/ConsistentHash × 六场景矩阵 + 三难向量（默认 101/100/011 互异不封赢家）+ verifyRoutingSoundness 双路自证 + 十一枚真件交叉印证。 */
  runLoadBalanceStudy: (() => Promise<any>) | null
  /** KI-537：Spring Cloud CircuitBreaker 三策略教学件；缺 opts.circuitBreaker 时为 null；CountBasedBreaker/RateBasedBreaker/SlowCallBreaker × 六场景矩阵 + 三难向量（默认 100/101/011 互异不封赢家）+ verifyCircuitSoundness 双路自证 + 十一枚真件交叉印证。 */
  runCircuitBreakerStudy: (() => Promise<any>) | null
  /** KI-538：离线模式装配的 LLM 网关三策略教学件；缺 opts.llmGateway 时为 null。 */
  runLlmGatewayStudy: (() => Promise<any>) | null
  /** KI-539：Spring Cloud Gateway 路由教学件；缺 opts.gatewayRouting 时为 null。 */
  runGatewayRoutingStudy: (() => Promise<any>) | null
  /** KI-540：消费端幂等去重教学件；缺 opts.idempotentConsumer 时为 null。 */
  runIdempotentConsumerStudy: (() => Promise<any>) | null
  /** KI-541：Kafka 消费组再平衡教学件；缺 opts.consumerRebalance 时为 null。 */
  runConsumerRebalanceStudy: (() => Promise<any>) | null
  /** KI-542：有界优先级队列教学件；缺 opts.priorityQueue 时为 null。 */
  runPriorityQueueStudy: (() => Promise<any>) | null
  /** KI-533：可观测性分布式追踪采样三策略教学件；缺 opts.traceSampling 时为 null；HeadBased/TailBased/Adaptive × 六场景矩阵 + 三难向量维序 [lowOverhead/anomalyCapture/loadAdaptive]（默认 100/010/101 互异不封赢家；anomalyCapture⇔缓冲整条⇔非 lowOverhead 与 chk 锁同构、零查表现算；rigged 三开关 oracleHead/infiniteBuffer/perfectFeedback 分策略正交反事实：全开收敛 Head≡Tail=110 区分度诚实塌缩、noStrategyWinsAll 仍真绝不硬造 111，三条因果结构锁——异常需缓冲/头部盲结构/自适应滞后——在同一含 error raw 流真跑现算钉死 causalLocksAllHold=true，主教义 headBlindLossOnErrorBurst 恒以纯净基线标定不翻）+ verifySamplingSoundness 双路自证（干净流 buffer 守恒 + 含 error 流四观测量 + 三路篡改真喂回现算翻 false 带 baselineHolds）+ 十一枚真件 21 键交叉印证。 */
  runTraceSamplingStudy: (() => Promise<any>) | null
  /** KI-491：灰度/金丝雀决策器（未配 opts.gray 时为 null）。 */
  gray: any
  /** KI-489：把游戏真 EventBus（duck-typed {on,emit}）按白名单接进云事件总线。 */
  connectGameBus(gameBus: { on(k: string, fn: Function): Function; emit(k: string, p: any): void }, routes: Array<{ from: 'game' | 'cloud'; key: string; type: string }>): { installed: boolean; handlers: number; reason?: string }
  bridge(): any
  start(): Promise<any>
  call(serviceName: string, path: string, init?: any): Promise<any>
  proxyCall(serviceName: string, path: string, init?: any): Promise<any>
  shutdown(): Promise<any>
  status(): Promise<any>
}
