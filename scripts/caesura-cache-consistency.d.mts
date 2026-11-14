/**
 * caesura-cache-consistency（KI-558）的类型声明。
 * 与 `caesura-cache-consistency.mjs` 的 12 枚值导出严格同名（decl-parity 门机械核对）。
 */

/** 模拟器参数（全部可注入；与实现 `makeSim` 的 cfg 同口径）。 */
export interface CCOptions {
  /** 时钟注入（修复：test.ts 需要; 与 cacheConsistencyStudy({now:()=>...}) 配合) */
  now?: () => number
  /** 三路 rigged 旗帜：每个 flag 只动所属策略 tag（与其他学件同款语义） */
  rigged?: boolean
  freeCdcInfra?: boolean
  freeOutboxWrite?: boolean

  /** 随机种子（当前实现为可复现锚点，指标本身由模拟器现算）。 */
  seed?: number
  /** 默认场景写次数。 */
  writes?: number
  /** 缓存 TTL（兜底 backstop；不是任何策略的一致性保证）。 */
  ttlMs?: number
  /** 延迟双删：第二次删除的延迟（ms）。 */
  doubleDeleteDelayMs?: number
  /** CDC 连接器轮询周期（ms）。 */
  cdcPollMs?: number
  /** Outbox 轮询周期（ms）。 */
  outboxPollMs?: number
  /** Outbox 额外持久化写的代价（ms）。 */
  outboxWriteCostMs?: number
  /** 一次外部设施调用的代价（ms）。 */
  infraCallCostMs?: number
  /** 下游滞后（ms）。 */
  lagMs?: number
  /** 篡改档位：normal / deleteLost / offsetReset / outboxNotAtomic。 */
  tamper?: string
  /** rigged：延迟双删的第二次删除被免费持久化。 */
  freeStalenessWindow?: boolean
  /** rigged：CDC 基础设施调用免费。 */
  freeCdcInfra?: boolean
  /** rigged：Outbox 额外持久化写免费。 */
  freeOutboxWrite?: boolean
}

/** 单次读的结果。 */
export interface CCReadResult {
  value: unknown
  version: number
  /** 读到的是不是陈旧值（缓存里的版本落后于库里的真值）。 */
  stale: boolean
  /** 陈旧了多久（ms）。 */
  stalenessMs: number
}

/** 模拟器统计（`stats()` 返回的是**副本**；计数只能由 `noteReadOutcome` 在内部加）。 */
export interface CCStats {
  writes: number
  reads: number
  staleReads: number
  extraDurableWrites: number
  infraCalls: number
  invalidations: number
  maxStaleMs: number
  sumStaleMs: number
  readYourWrites: number
  readYourWritesTotal: number
}

/** 失效意图的载体性质（`boundedStaleness` 那一维的物理来源）。 */
export interface CCIntent {
  /** volatile-timer（进程内易失定时器）/ durable-record（持久记录）。 */
  kind: string
  durable: boolean
}

/** 模拟器内部实际生效的 cfg（实现里 makeSim 组装的形状；不是 CCOptions 的全量）。 */
export interface CCSimConfig {
  ttlMs: number
  doubleDeleteDelayMs: number
  cdcPollMs: number
  outboxPollMs: number
  outboxWriteCostMs: number
  infraCallCostMs: number
  lagMs: number
  tamper: string
  freeStalenessWindow: boolean
  freeCdcInfra: boolean
  freeOutboxWrite: boolean
}

/** 三策略共用的**同一台**模拟器（同一份 db / 同一份 cache / 同一个读路径）。 */
export interface CCSim {
  readonly protocol: string
  readonly cfg: CCSimConfig
  /** 逻辑时钟当前值（ms）。 */
  now: () => number
  write: (key: string, value: unknown) => void
  read: (key: string) => CCReadResult
  /** 读的第一阶段：抓一份**当时的** DB 快照。 */
  readBegin: (key: string) => void
  /** 读的第二阶段：把快照写回缓存（其间有写提交 ⇒ 缓存里躺着陈旧值）。 */
  readCommit: () => boolean
  /** 把逻辑时钟推进到目标时刻（到期定时器按序执行）。 */
  advanceTo: (target: number) => void
  /** 进程崩溃：易失定时器随进程消失；持久侧记录不丢、其服务定时器继续跑。 */
  crash: () => void
  /** 统计副本。 */
  stats: () => CCStats
  /** 登记一次「写后读」结果（计数在内部加，避免写到副本上）。 */
  noteReadOutcome: (stale: boolean) => number
  /** 失效意图的载体性质。 */
  intent: () => CCIntent
  crashed: () => boolean
}

/** 单场景读数（不同场景的专有字段以可选出现）。 */
export interface CCScenario {
  id: string
  protocol: string
  writes?: number
  reads?: number
  staleReads?: number
  /** 写后立刻读能读到自己的写的比例（0~1）。 */
  readYourWritesRate?: number
  /** 业务写之外的额外持久化写次数。 */
  extraDurableWrites?: number
  /** 外部设施调用次数。 */
  infraCalls?: number
  /** 失效（删缓存）次数。 */
  invalidations?: number
  /** 竞态是否真的产生了陈旧值（nontrivial 的判据）。 */
  staleAfterRace?: boolean
  /** 陈旧窗口（ms）。 */
  staleWindowMs?: number
  /** 机制跑完之后陈旧值是否被清掉。 */
  clearedAfterMechanism?: boolean
  /** 崩溃之后陈旧值是否**存活**（延迟双删 ⇒ true；另两家 ⇒ false）。 */
  staleSurvivedCrash?: boolean
  /** 失效意图的载体（volatile-timer / durable-record）。 */
  invalidationIntent?: string
  /** 下游滞后（ms，仅 subscriberLag 场景）。 */
  lagMs?: number
  /** 最长陈旧窗口（ms）。 */
  maxStaleMs?: number
  /** 同 seed 连跑两次是否逐字一致（真比较字符串，不是写死的 true）。 */
  rerunIdentical?: boolean
  note: string
}

/** 三难：boundedStaleness / infraFree / writePathLight（全部由模拟器现算，零查表）。 */
export interface CCTrilemma {
  /** 陈旧窗口是否由策略自身界定（失效意图持久 ⇒ 崩溃后仍被清掉）。 */
  boundedStaleness: boolean
  /** 外部设施调用是否为 0。 */
  infraFree: boolean
  /** 业务写之外的额外持久化写是否为 0。 */
  writePathLight: boolean
}

export interface CCMetrics {
  totalWrites: number
  totalReads: number
  totalStaleReads: number
  totalExtraDurableWrites: number
  totalInfraCalls: number
  totalInvalidations: number
  readYourWritesRate: number
  staleSurvivedCrash: boolean
}

export interface CCRow {
  protocol: string
  scenarios: CCScenario[]
  trilemma: CCTrilemma
  metrics: CCMetrics
}

/** 单策略 × 单场景的 holds 三因子（唯一 holds 公式的三个合取项）。 */
export interface CCHoldsCell {
  /** nontrivial ∧ mechanismRan ∧ invalidatedAfterMechanism。 */
  holds: boolean
  /** 竞态真的发生了（staleAfterRace === true）。 */
  nontrivial: boolean
  /** 策略自己的失效机制真的跑过（invalidations > 0）。 */
  mechanismRan: boolean
  /** 机制跑完之后陈旧值确实被清掉了。 */
  invalidatedAfterMechanism: boolean
  staleAfterRace: boolean
  staleWindowMs: number
  invalidations: number
  clearedAfterMechanism: boolean
}

export interface CCHoldsTable {
  DelayedDoubleDelete: CCHoldsCell
  SubscribeBinlog: CCHoldsCell
  OutboxPolling: CCHoldsCell
}

export interface CCTamperVerdict {
  /** 被针对的那一家在 tamper 下是否翻了（应为 false = 被打穿）。 */
  holds: boolean
  /** 是否**只**打穿了自己那一家（精确定位，不是乱棍）。 */
  targeted: boolean
  reason: string
}

export interface CCSoundness {
  /** 基线（三路全绿）。 */
  laneA: CCHoldsTable
  /** 三路 tamper 各自一份。 */
  laneB: {
    deleteLost: CCHoldsTable
    offsetReset: CCHoldsTable
    outboxNotAtomic: CCHoldsTable
  }
  baselineHolds: boolean
  holds: boolean
  nontrivial: boolean
  falsifiable: boolean
  tamper: {
    deleteLost: CCTamperVerdict
    offsetReset: CCTamperVerdict
    outboxNotAtomic: CCTamperVerdict
  }
}

export interface CCCausalLocks {
  /** 延迟双删的失效意图是易失的 ⇒ 崩溃即丢（结构上不可消弭）。 */
  volatileInvalidationIntentCausallyUnerasable: boolean
  /** CDC 的正确性依赖位点持久化 ⇒ 位点被重置 ⇒ 事件永久跳过。 */
  cdcOffsetDependencyCausallyUnerasable: boolean
  /** Outbox 的正确性来自「与业务写同一事务」⇒ 必须多写一张持久表。 */
  outboxSameTransactionCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  probes: {
    ddbIntent: string
    ddbStaleSurvivedCrash: boolean
    cdcStaleSurvivedCrash: boolean
    outboxStaleSurvivedCrash: boolean
    offsetResetInvalidations: number
    outboxExtraDurableWrites: number
    outboxNotAtomicInvalidations: number
  }
}

/** 十一真件 21 键交叉印证。 */
export interface CCEvidence {
  routerMoved: number
  routerTracked: number
  ringNodes: number
  ringShardsUsed: number
  walLines: number
  walReplayed: number
  notices: number
  busListeners: number
  redisBitmapHits: number
  redisSlots: number
  poolCreated: number
  poolReused: number
  bucketAllowed: number
  bucketRejected: number
  heapFired: number
  heapPending: number
  counterSum: number
  counterFalseSharing: number
  jitterSpread: number
  remapConsistentRate: number
  remapModuloRate: number
}

export interface CCVerdict {
  vectors: Record<string, string>
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  noStrategyWinsAll: boolean
  vectorFromTrilemma: boolean
  ddbStillVolatile: boolean
  cdcStillNeedsInfra: boolean
  outboxStillWrites: boolean
  rigged_pkg: boolean
  rigged_pkg_flags: Record<string, boolean>
  riggedConvergenceCollapsed: boolean
  freeStalenessWindowHitsOnlyDdb: boolean
  freeCdcInfraHitsOnlyCdc: boolean
  freeOutboxWriteHitsOnlyOutbox: boolean
}

export interface CCConfig {
  seed: number
  writes: number
  ttlMs: number
  doubleDeleteDelayMs: number
  cdcPollMs: number
  outboxPollMs: number
  lagMs: number
  scenarios: string[]
  rigged: boolean
  freeStalenessWindow: boolean
  freeCdcInfra: boolean
  freeOutboxWrite: boolean
}

export interface CCSnapshot {
  builtAt: number
  config: CCConfig
  rows: CCRow[]
  vectors: Record<string, string>
  verdict: CCVerdict
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  noStrategyWinsAll: boolean
  causalLocks: CCCausalLocks
  crosscheck: {
    evidence: CCEvidence
    soundness: CCSoundness
  }
  rigged: boolean
}

export type CCStudy = CCSnapshot

/** 默认参数（全部可注入）。 */
export const CACHE_CONSISTENCY_DEFAULTS: Readonly<{
  seed: number
  writes: number
  ttlMs: number
  doubleDeleteDelayMs: number
  cdcPollMs: number
  outboxPollMs: number
  outboxWriteCostMs: number
  infraCallCostMs: number
  lagMs: number
  freeStalenessWindow: boolean
  freeCdcInfra: boolean
  freeOutboxWrite: boolean
  rigged: boolean
}>

/** 三策略名册（顺序即矩阵行顺序）。 */
export const CACHE_CONSISTENCY_STRATEGIES: readonly ['DelayedDoubleDelete', 'SubscribeBinlog', 'OutboxPolling']

/** 五正交场景名册。 */
export const CACHE_CONSISTENCY_SCENARIOS: readonly [
  'steadyWrite', 'racingRead', 'crashAfterWrite', 'subscriberLag', 'cleanRerun',
]

/** 延迟双删：写 DB → 同步删缓存 → 延迟 D 再删一次；零外部设施、写路径不阻塞，第二次删除是**易失**的。 */
export function createDelayedDoubleDelete(opts?: CCOptions): CCSim

/** 订阅 binlog（Canal/Debezium 式）：写 DB → binlog → 外部连接器轮询 → 删缓存；窗口最小，需 CDC 基础设施。 */
export function createSubscribeBinlog(opts?: CCOptions): CCSim

/** Outbox 轮询：业务写与 outbox 行同事务 → 轮询器扫表 → 删缓存；零外部设施、失效意图持久，写路径多写一张表。 */
export function createOutboxPolling(opts?: CCOptions): CCSim

/** 三策略 × 五场景核心对照 + 三难向量 + 三因果锁 + 十一真件交叉印证。 */
export function cacheConsistencyStudy(opts?: CCOptions): CCStudy

/** 同上（别名）。 */
export const compareCacheConsistency: typeof cacheConsistencyStudy

/** 快照投影（前端只读，纯数据）。 */
export function cacheConsistencySnapshot(study: CCStudy | null | undefined): CCSnapshot | null

/** 双路自证 + 三路可证伪（每路 tamper 各自只打穿自己那一家）。 */
export function verifyCacheConsistencySoundness(input?: { writes?: number }, opts?: CCOptions): CCSoundness

/** 三条结构锁在同一套模拟器上真跑，任何 rigged 开关都救不了。 */
export function verifyCausalLocks(cfg?: CCOptions): CCCausalLocks

/** 十一真件 21 键交叉印证（命名空间 `cc:`）。 */
export function createCacheConsistencyEvidence(opts?: { seed?: number; now?: number | (() => number) }): CCEvidence
