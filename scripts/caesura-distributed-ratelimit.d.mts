/**
 * caesura-distributed-ratelimit（KI-510）的类型声明。
 * 与 `caesura-distributed-ratelimit.mjs` 的 10 枚值导出严格同名（decl-parity 门机械核对）。
 */

export interface DRLFault {
  /** 全打同一 key（中心单 key 热点 / 分片热片）。 */
  sameKey?: boolean
  /** 按 skewRatio 把多数请求打向热 key（分片配额碎片）。 */
  skew?: boolean
  /** 中心 / 分片中心宕机。 */
  centerDown?: boolean
  /** 宕机实例 / 分片数。 */
  downNodes?: number
  /** 中途扩容（分片最小重映射）。 */
  scaleOut?: boolean
  /** 多实例并发铺开（Local N×C 超发）。 */
  concurrent?: boolean
  /** rigged：单实例（抹 Local 超发成因）。 */
  singleInstance?: boolean
}

export interface DRLOptions {
  seed?: number
  /** Local 网关副本数。 */
  instances?: number
  /** Sharded 分片数。 */
  shards?: number
  /** 全局名义配额 C。 */
  capacity?: number
  refillPerSec?: number
  /** 每场景投递请求数。 */
  requests?: number
  /** 逻辑时钟起点（ms）；数值或注入函数（后者取一次读数），与 study.builtAt 同一口径。 */
  now?: number | (() => number)
  /** 注入时钟函数（优先于 now）。 */
  nowFn?: () => number
  rand?: () => number
  /** skewKeys 场景落到热 key 的比例。 */
  skewRatio?: number
  /** centerDown / 实例故障的宕机数。 */
  nodesDown?: number
  /** 一致性哈希环虚拟节点数。 */
  virtualNodes?: number
  /** rigged：单实例（抹 Local 超发成因，Local 退化为 1 副本）。 */
  singleInstance?: boolean
  /** rigged：中心永远在线 / 零 RTT / centerDown 失效。 */
  centerAvailable?: boolean
  /** rigged：完美均匀的环（虚拟节点拉满）。 */
  perfectBalance?: boolean
  /** rigged：key 均衡分布（抹配额碎片第二成因）。 */
  balancedKeys?: boolean
  /** rigged：一次性抹掉所有软肋（等价于四开关全开）。 */
  rigged?: boolean
  /** 确定性故障数组（rigged 传全空 fault:{} 表示明确无故障）。 */
  faults?: DRLFault[]
  /** 原子桶对照的并发度。 */
  concurrency?: number
  /** 非原子路径让出函数。 */
  yield?: () => Promise<void>
  /** 覆盖六场景名册。 */
  scenarios?: string[]
}

/** 单协议 × 单场景的读数 + 三难三维判据。 */
export interface DRLCellReading {
  id: string
  allowed: number
  rejected: number
  overAllowed: number
  centerRounds: number
  fragmented: number
  isolatedFailures: number
  degradedShard: number
  /** Central 专有：每请求命中同一全局 key 的次数。 */
  hotKeyHits: number
  /** Central 专有：中心宕机期间被卡死的请求数。 */
  centerStalled: number
  globalExact: boolean
  partialFaultTolerance: boolean
  noCenterRTT: boolean
}

/** 三难：全局配额精确 ∧ 单点故障不瘫痪 ∧ 无中心 RTT。 */
export interface DRLTrilemma {
  globalExact: boolean
  partialFaultTolerance: boolean
  noCenterRTT: boolean
}

export interface DRLRowTotals {
  allowed: number
  rejected: number
  overAllowed: number
  centerRounds: number
  fragmented: number
}

export interface DRLRow {
  protocol: string
  scenarios: DRLCellReading[]
  totals: DRLRowTotals
  trilemma: DRLTrilemma
}

/** 真 Redis 令牌桶原子 vs 非原子对照读数。 */
export interface DRLCentralCrosscheck {
  source: string
  concurrency: number
  atomicAllowed: number
  nonAtomicAllowed: number
  atomicExact: boolean
  nonAtomicOvershoot: number
}

/** 真一致性哈希环分布偏斜 + 扩容重映射读数。 */
export interface DRLShardedCrosscheck {
  source: string
  keys: number
  shards: number
  newShardCount: number
  balanceRatio: number | null
  skewBalanceRatio: number | null
  emptyNodes: string[]
  /** 均匀环命中极差（max-min）。 */
  spread: number
  /** 偏斜环命中极差——显著大于 spread 即配额碎片成因铁证。 */
  skewSpread: number
  /** 偏斜环零命中片数——>0 即真件除零保护使 skewBalanceRatio=null。 */
  skewEmptyNodes: number
  remapRate: number
  moduloRate: number
}

export interface DRLVerdict {
  vectors: Record<string, string>
  trilemmaDistinguishes: boolean
  noProtocolWinsAll: boolean
  noUniversalWinner: boolean
  localOvershoots: boolean
  centralExact: boolean
  shardedFragmented: boolean
  shardedNotPanacea: boolean
}

export interface DRLTopology {
  instances: number
  shards: number
  capacity: number
  perShardCap: number
}

export interface DRLSnapshot {
  /** 现算/注入时钟读数（快照投影原样带出，与 igSnapshot 对齐）。 */
  builtAt: number
  config: {
    seed: number
    instances: number
    shards: number
    capacity: number
    requests: number
    rigged: boolean
    scenarios: string[]
  }
  rows: Array<{
    protocol: string
    scenarios: DRLCellReading[]
    totals: DRLRowTotals
    trilemma: DRLTrilemma
  }>
  vectors: Record<string, string>
  crosscheck: {
    central: DRLCentralCrosscheck
    sharded: DRLShardedCrosscheck
  }
  verdict: DRLVerdict
  topology: DRLTopology
}

export interface DistributedRateLimitStudy extends DRLSnapshot {
  builtAt: number
}

/** 默认参数（全部可注入）。 */
export const DRL_DEFAULTS: Readonly<{
  seed: number
  instances: number
  shards: number
  capacity: number
  refillPerSec: number
  requests: number
  now: number
  skewRatio: number
  nodesDown: number
  rigged: boolean
}>

/** 三协议名册。 */
export const DRL_PROTOCOLS: readonly ['Local', 'Central', 'Sharded']

/** 六场景名册。 */
export const DRL_SCENARIOS: readonly ['allOk', 'burstSameKey', 'skewKeys', 'centerDown', 'scaleOut', 'multiInstance']

/** ① 每实例本地令牌桶集群（N×C 超发、零 RTT、故障隔离）。 */
export function createLocalBucketCluster(opts?: DRLOptions): {
  feed(keys: string[], fo?: DRLFault): {
    protocol: string
    allowed: number
    rejected: number
    overAllowed: number
    perInstance: number[]
    centerRounds: number
    isolatedFailures: number
    keys: number
  }
  reset(): void
  readonly instances: number
  readonly capacity: number
}

/** ② Redis 中心化原子令牌桶（全局精确、单 key 热点、单点、中心 RTT）。 */
export function createCentralRedisBucket(opts?: DRLOptions): {
  feed(keys: string[], fo?: DRLFault): {
    protocol: string
    allowed: number
    rejected: number
    overAllowed: number
    centerRounds: number
    hotKeyHits: number
    centerStalled: number
    keys: number
  }
  reset(): void
  crosscheck(concurrency?: number): Promise<DRLCentralCrosscheck>
  readonly capacity: number
}

/** ③ 一致性哈希分片令牌桶（单片降级、最小重映射、配额碎片化）。 */
export function createShardedBucket(opts?: DRLOptions): {
  feed(keys: string[], fo?: DRLFault): {
    protocol: string
    allowed: number
    rejected: number
    overAllowed: number
    centerRounds: number
    fragmented: number
    degradedShard: number
    shardAllowed: Record<string, number>
    shards: number
    keys: number
  }
  reset(): void
  crosscheck(sampleKeys?: string[], newShardCount?: number): DRLShardedCrosscheck
  readonly shards: number
  readonly perShardCap: number
}

/** 单协议 × 单场景跑一格子（带三难三维判据）。 */
export function runDistributedRateLimitScenario(protocol: string, scenario: string, opts?: DRLOptions): DRLCellReading

/** 三协议 × 六场景核心对照 + 三难向量 + 真依赖交叉印证 + 可证伪判词。 */
export function compareDistributedRateLimit(opts?: DRLOptions): Promise<{
  rows: DRLRow[]
  vectors: Record<string, string>
  crosscheck: { central: DRLCentralCrosscheck; sharded: DRLShardedCrosscheck }
  verdict: DRLVerdict
  config: DRLSnapshot['config']
}>

/** 完整 study（compare + topology，纯数据可 JSON 往返）。 */
export function distributedRateLimitStudy(opts?: DRLOptions): Promise<DistributedRateLimitStudy>

/** 快照投影（前端只读，纯数据）。 */
export function drlSnapshot(study: DistributedRateLimitStudy | null | undefined): DRLSnapshot | null
