/**
 * caesura-cache-coherency（KI-512）的类型声明。
 * 与 `caesura-cache-coherency.mjs` 的 10 枚值导出严格同名（decl-parity 门机械核对）。
 */

/** 单场景软肋探针（fault:{} = 关闭探针，退化为基线）。 */
export interface CCCFault {
  /** readAfterWrite：写完立刻读，暴露 Cache-Aside 更库/删缓存非原子窗口的陈旧读。 */
  readAfterWrite?: boolean
  /** writeHeavy：放大写次数，暴露 Write-Through 每次写同步穿透库的 RTT 累积。 */
  writeHeavy?: boolean
  /** cacheCrash：整机宕，暴露 Write-Behind 未刷回脏页全丢（只罚 durable 维）。 */
  cacheCrash?: boolean
  /** asyncFlush：异步刷回时窗，Write-Behind 的延迟合并读。 */
  asyncFlush?: boolean
  /** manyKeys：放大 key 规模，暴露写回 fanout 落点偏斜。 */
  manyKeys?: boolean
}

export interface CCCOptions {
  seed?: number
  /** 默认场景写次数。 */
  writes?: number
  /** manyKeys 探针放大的 key 规模。 */
  manyKeys?: number
  /** 写穿透/旁路到后端库的单次 RTT（结构计数、非墙钟）。 */
  backendRttMs?: number
  /** Write-Behind 攒几条脏页刷回一批。 */
  flushThreshold?: number
  /** Write-Behind 异步刷回时窗（结构计数、非墙钟）。 */
  flushLagMs?: number
  /** cacheCrash 场景在第几次写后宕机（保留字段；探针内部按 writes+1 阈值留全批脏页）。 */
  crashAtWrite?: number
  /** 单场景模拟时窗（ms）。 */
  windowMs?: number
  /** 逻辑时钟起点（ms）；数值或注入函数（后者取一次读数），与 study.builtAt 同一口径。 */
  now?: number | (() => number)
  /** 注入时钟函数（保留契约对称；本件时窗为相对长度、不依赖绝对时钟相位）。 */
  nowFn?: () => number
  /** 注入随机（Cache-Aside 窗口宽度/陈旧读相位）；缺省用同 seed 的内部 PRNG。 */
  rand?: () => number
  /** 一致性哈希环虚拟节点数（交叉印证用）。 */
  virtualNodes?: number
  /** rigged：抹 Cache-Aside 更库/删缓存非原子窗口。 */
  atomicInvalidate?: boolean
  /** rigged：抹写穿透的库 RTT（写路径不再被后端阻塞）。 */
  noWriteBackendRtt?: boolean
  /** rigged：Write-Behind 改同步双写 + WAL 跨机 quorum 复制（教学假想）。 */
  atomicWriteBehind?: boolean
  /** 仅进程内 WAL：能救同机进程崩溃 replay，但抹不掉整机宕 durable 维。 */
  walEnabled?: boolean
  /** 一次性抹掉全部软肋（等价于三开关全开 + fault 全空）。 */
  rigged?: boolean
  /** 确定性故障数组（rigged 传六场景 fault:{} 全空关闭全部探针）。 */
  faults?: CCCFault[]
  /** 覆盖六场景名册。 */
  scenarios?: string[]
}

/** 三协议共同读数（专有病征字段缺席者由 run 层 ?? 0 / false 归一）。 */
export interface CCCCellReading {
  id: string
  writes: number
  keyN: number
  /** 更库/删缓存非原子窗口宽度（Cache-Aside 专有病征，其余恒 0）。 */
  staleWindowMs: number
  /** 窗口内陈旧读次数（Cache-Aside 专有病征）。 */
  staleReads: number
  /** 写路径打到后端库的次数（Cache-Aside/Write-Through >0；Write-Behind 异步=0）。 */
  writeBackendRounds: number
  writeBackendRttMs: number
  /** 整机宕丢失的未刷回脏页数（Write-Behind 专有病征）。 */
  dirtyPagesLost: number
  /** 待刷回的未提交脏页数。 */
  dirtyPagesPending: number
  flushLagMs: number
  /** 同 key 多次写合并成一次刷回的合并数（Write-Behind 专有病征）。 */
  coalescedWrites: number
  walEnabled: boolean
  crossNodeReplicated: boolean
  crashed: boolean
  /** 三难①：写后读立刻可见。 */
  readYourWrites: boolean
  /** 三难②：写路径不阻塞于后端。 */
  noWriteBlocking: boolean
  /** 三难③：整机宕不丢写。 */
  durableOnCrash: boolean
}

/** 三难：写后读立刻可见 ∧ 写路径不阻塞 ∧ 缓存整机宕不丢写。 */
export interface CCCTrilemma {
  readYourWrites: boolean
  noWriteBlocking: boolean
  durableOnCrash: boolean
}

export interface CCCRowTotals {
  staleWindowMsSum: number
  staleReads: number
  writeBackendRounds: number
  writeBackendRttMs: number
  dirtyPagesLost: number
  coalescedWrites: number
  crashedScenarios: number
}

export interface CCCRow {
  protocol: string
  scenarios: CCCCellReading[]
  totals: CCCRowTotals
  trilemma: CCCTrilemma
}

/** ① 真 caesura-redis-cache：写后读命中缓存新值（read-your-writes 缓存侧结构）。 */
export interface CCCRedisCrosscheck {
  source: string
  firstVersion: string | null
  secondVersion: string | null
  hits: number
  writeThenReadSeesNew: boolean
  notRealRedis: true
}

/** ② 真 caesura-lsm-store.createWal：崩溃恢复真实存在，但 sink 进程内、不跨机。 */
export interface CCCWalCrosscheck {
  source: string
  sinkIsArray: boolean
  sinkLines: number
  lines: number
  restored: number
  replayed: number
  replayOps: string[]
  processCrashRecoverable: boolean
  /** 诚实标注：sink 是进程内数组/对象、无跨机复制 ⇒ 整机 + 盘一起丢仍丢。 */
  replicatedAcrossNodes: false
  wholeNodeLossDurable: false
}

/** ③ 真 caesura-cache-guard：XFetch 随 age→TTL 单调升（降低陈旧概率但非消除）。 */
export interface CCCGuardCrosscheck {
  source: string
  youngEarly: boolean
  oldEarly: boolean
  monotonic: boolean
  reducesProbabilityNotWindow: true
}

/** ④ 真 caesura-sharded-cache：manyKeys 写落多片、perShard 命中分布。 */
export interface CCCShardedCrosscheck {
  source: string
  written: number
  readHits: number
  shards: number
  perShardHits: number[]
  spread: number
  allReadable: boolean
}

/** ⑤ 真 caesura-mvcc-txn：库侧写后读已提交新值需要版本链。 */
export interface CCCMvccCrosscheck {
  source: string
  isolation: string
  beforeCommitVersion: string | null
  afterCommitVersion: string | null
  committed: boolean
  versions: number
  writeThenReadNeedsCommit: boolean
}

/** ⑥ 真 caesura-distributed-txn：2PC 全 yes 才提交、协调者 prepare 后宕 ⇒ 全员 blocked。 */
export interface CCCTwoPhaseCrosscheck {
  source: string
  prepareAllYes: boolean
  commitPhase: string
  commitMessages: number
  downPhase: string
  blockedParticipants: number
  atomicCrossStoreNeedsCoordination: boolean
  /** 诚实标注：教学 2PC 状态机、非真把缓存纳入 XA。 */
  notRealXa: true
}

/** ⑦ 真 caesura-consistent-hash：环分布/空片/balanceRatio 对应 fanout 落点。 */
export interface CCCRingCrosscheck {
  source: string
  keys: number
  nodes: number
  fanoutKeys: number
  spread: number
  emptyNodes: number
  balanceRatio: number | null
}

export interface CCCCrosscheck {
  redis: CCCRedisCrosscheck
  wal: CCCWalCrosscheck
  guard: CCCGuardCrosscheck
  sharded: CCCShardedCrosscheck
  mvcc: CCCMvccCrosscheck
  twoPhase: CCCTwoPhaseCrosscheck
  ring: CCCRingCrosscheck
}

export interface CCCVerdict {
  vectors: Record<string, string>
  trilemmaDistinguishes: boolean
  noProtocolWinsAll: boolean
  noUniversalWinner: boolean
  asideHasStaleWindow: boolean
  asideBlocksOnBackend: boolean
  asideDurable: boolean
  throughConsistent: boolean
  throughBlocksOnBackend: boolean
  behindNoWriteBlocking: boolean
  behindLosesDirtyOnCrash: boolean
  behindCoalescesWrites: boolean
  walNotDurableAcrossNode: boolean
  writeBehindNotPanacea: boolean
}

export interface CCCTopology {
  writes: number
  manyKeys: number
  backendRttMs: number
  flushThreshold: number
  flushLagMs: number
  crashAtWrite: number
  windowMs: number
}

export interface CCCSnapshot {
  /** 现算/注入时钟读数（快照投影原样带出，与 dccSnapshot 对齐）。 */
  builtAt: number
  config: {
    seed: number
    writes: number
    manyKeys: number
    backendRttMs: number
    windowMs: number
    walEnabled: boolean
    rigged: boolean
    scenarios: string[]
  }
  rows: CCCRow[]
  vectors: Record<string, string>
  crosscheck: CCCCrosscheck
  verdict: CCCVerdict
  topology: CCCTopology
}

export interface CacheCoherencyStudy extends CCCSnapshot {
  builtAt: number
}

/** 默认参数（全部可注入）。 */
export const CCC_DEFAULTS: Readonly<{
  seed: number
  writes: number
  manyKeys: number
  backendRttMs: number
  flushThreshold: number
  flushLagMs: number
  crashAtWrite: number
  windowMs: number
  now: number
  atomicInvalidate: boolean
  noWriteBackendRtt: boolean
  atomicWriteBehind: boolean
  walEnabled: boolean
  rigged: boolean
}>

/** 三协议名册（顺序即矩阵行顺序）。 */
export const CCC_PROTOCOLS: readonly ['CacheAside', 'WriteThrough', 'WriteBehind']

/** 六场景名册（顺序即矩阵列顺序）。 */
export const CCC_SCENARIOS: readonly [
  'allOk', 'readAfterWrite', 'writeHeavy', 'cacheCrash', 'asyncFlush', 'manyKeys',
]

export interface CCCStore {
  feed(fo?: CCCFault): {
    protocol: string
    writes: number
    keyN: number
    staleWindowMs: number
    staleReads: number
    writeBackendRounds: number
    writeBackendRttMs: number
    dirtyPagesLost: number
    dirtyPagesPending?: number
    flushLagMs: number
    coalescedWrites: number
    walEnabled?: boolean
    crossNodeReplicated?: boolean
    crashed: boolean
  }
  reset(): void
  readonly protocol: string
  readonly observableCount: number
}

/** ① Cache-Aside 旁路缓存（先更库再删缓存，读 miss 回填；写落库不丢但非原子窗口陈旧 + 写阻塞）。 */
export function createCacheAsideStore(opts?: CCCOptions): CCCStore

/** ② Write-Through 写穿透（同步双写、始终一致不丢写，但每写吃库 RTT 写阻塞）。 */
export function createWriteThroughStore(opts?: CCCOptions): CCCStore

/** ③ Write-Behind 写回（只写缓存异步刷回、写延迟最低+合并，但整机宕丢脏页；进程内 WAL 救不了）。 */
export function createWriteBehindStore(opts?: CCCOptions): CCCStore

/** 单协议 × 单场景跑一格子（带三难三维判据）。 */
export function runCacheCoherencyScenario(protocol: string, scenario: string, opts?: CCCOptions): CCCCellReading

/** 三协议 × 六场景核心对照 + 三难向量 + 真依赖交叉印证 + 可证伪判词。 */
export function compareCacheCoherency(opts?: CCCOptions): Promise<{
  rows: CCCRow[]
  vectors: Record<string, string>
  crosscheck: CCCCrosscheck
  verdict: CCCVerdict
  config: CCCSnapshot['config']
}>

/** 完整 study（compare + topology，纯数据可 JSON 往返）。 */
export function cacheCoherencyStudy(opts?: CCCOptions): Promise<CacheCoherencyStudy>

/** 快照投影（前端只读，纯数据）。 */
export function cccSnapshot(study: CacheCoherencyStudy | null | undefined): CCCSnapshot | null
