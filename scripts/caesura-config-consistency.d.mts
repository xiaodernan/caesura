/**
 * caesura-config-consistency（KI-511）的类型声明。
 * 与 `caesura-config-consistency.mjs` 的 10 枚值导出严格同名（decl-parity 门机械核对）。
 */

/** 单场景软肋探针（fault:{} = 关闭探针，退化为基线）。 */
export interface DCCFault {
  /** quickChange：变更紧贴第一次拉取之后（T+1），暴露 Polling 0~T 延迟。 */
  quickChange?: boolean
  /** idleNoChange：长空闲零变更，暴露 Polling 空转。 */
  idle?: boolean
  /** centerDown：变更时刻中心宕机，暴露 LongPolling/Watch 中心单点不可降级。 */
  centerDown?: boolean
  /** burstChanges：密集多变更，暴露 Watch 广播风暴削峰 + 版本缺口。 */
  burst?: boolean
  /** manyClients：放大 fanout 客户端规模。 */
  manyClients?: boolean
}

export interface DCCCenterDown {
  from: number
  to: number
}

export interface DCCTimeline {
  changes: Array<{ at: number; version: number }>
  centerDown: DCCCenterDown | null
  clientN: number
  W: number
  T: number
}

export interface DCCOptions {
  seed?: number
  /** 默认客户端副本数。 */
  clients?: number
  /** manyClients 探针放大的 fanout 规模。 */
  manyClients?: number
  /** Polling 拉取周期 T（ms）。 */
  pollIntervalMs?: number
  /** LongPolling 挂起超时（ms，超时须重连）。 */
  lpTimeoutMs?: number
  /** Watch 广播风暴削峰合并窗口（ms）。 */
  burstCoalesceMs?: number
  /** burstChanges 的密集变更数。 */
  burstCount?: number
  /** centerDown 宕机窗长度（ms）。 */
  downDurationMs?: number
  /** 单场景模拟时窗（ms）。 */
  windowMs?: number
  /** 逻辑时钟起点（ms）；数值或注入函数（后者取一次读数），与 study.builtAt 同一口径。 */
  now?: number | (() => number)
  /** 注入时钟函数（保留契约对称；本件时窗为相对长度、不依赖绝对时钟相位）。 */
  nowFn?: () => number
  /** 注入随机（客户端相位抖动 / 削峰影响比例）；缺省用同 seed 的内部 PRNG。 */
  rand?: () => number
  /** 一致性哈希环虚拟节点数（交叉印证用）。 */
  virtualNodes?: number
  /** rigged：轮询周期抹 0（Polling 瞬时感知）。 */
  pollingInstant?: boolean
  /** rigged：中心恒在线（LongPolling/Watch 故障失效）。 */
  centerAlwaysUp?: boolean
  /** rigged：无广播风暴（Watch 不削峰）。 */
  noBurst?: boolean
  /** rigged：一次性抹掉全部软肋（等价于三开关全开 + fault 全空）。 */
  rigged?: boolean
  /** 确定性故障数组（rigged 传六场景 fault:{} 全空关闭全部探针）。 */
  faults?: DCCFault[]
  /** 覆盖六场景名册。 */
  scenarios?: string[]
}

/** 三协议共同读数（专有病征字段缺席者由 run 层 ?? 0 归一）。 */
export interface DCCCellReading {
  id: string
  clients: number
  detectedAt: number | null
  /** 变更到感知的延迟（结构计数、非毫秒实测）。 */
  perceivedDelay: number
  /** 无变更期间的空拉取次数（Polling 专有病征）。 */
  idleFetches: number
  /** 常驻连接数（LongPolling/Watch >0；Polling=0）。 */
  connections: number
  /** 空闲超时重连数（LongPolling 专有病征）。 */
  reconnects: number
  /** 版本号兜底的 reorder/丢失数（Watch burstChanges 专有病征）。 */
  versionGaps: number
  staleClients: number
  degraded: boolean
  centerBroken: boolean
  changes: number
  coalesced: number
  /** 三难①：中心宕机可降级。 */
  degradeOnCenterDown: boolean
  /** 三难②：无空闲轮询开销。 */
  noIdleOverhead: boolean
  /** 三难③：变更即时感知。 */
  instantPerceive: boolean
}

/** 三难：中心宕机可降级 ∧ 无空闲轮询开销 ∧ 变更即时感知。 */
export interface DCCTrilemma {
  degradeOnCenterDown: boolean
  noIdleOverhead: boolean
  instantPerceive: boolean
}

export interface DCCRowTotals {
  perceivedDelaySum: number
  idleFetches: number
  connections: number
  reconnects: number
  versionGaps: number
  staleClients: number
  degradedScenarios: number
  centerBrokenScenarios: number
}

export interface DCCRow {
  protocol: string
  scenarios: DCCCellReading[]
  totals: DCCRowTotals
  trilemma: DCCTrilemma
}

/** 真 spring-config-server 交叉印证：响应是带 version 的快照、查找优先级、版本链单调。 */
export interface DCCConfigServerCrosscheck {
  source: string
  responseVersion: string
  stateIsNull: boolean
  propertySources: number
  pickedPriorityVersion: string | null
  versionChain: string[]
  versionChainMonotonic: boolean
  /** 诚实标注：configHistory/rollback 在 createServer 闭包内、不可直接真 import。 */
  rollbackDirectlyImported: false
}

/** 真 startConfigWatcher + bus：首趟纯 mtime 播种，不读内容、不吐事件。 */
export interface DCCConfigWatcherCrosscheck {
  source: string
  available: boolean
  firstPassOnChange: number | null
  firstPassBusEvents: number | null
  /** 真件首趟在 readFileSync 前就 continue 只登记 mtime ⇒ 恒 false（不读内容、不写 configs）。 */
  contentLoadedOnFirstPass: boolean
  /** 首趟 onChange=0 且 bus=0 且未读内容 ⇒ 纯播种零业务副作用。 */
  seededNoEvents: boolean | null
  intervalStopped: boolean
}

export interface DCCBusCrosscheck {
  source: string
  delivered: number
  listenerCount: number
  firstPayloadVersion: string | null
  eventChainWorks: boolean
}

export interface DCCGrayCrosscheck {
  source: string
  keys: number
  stableBuckets: number
  allInUnitRange: boolean
}

export interface DCCGuardCrosscheck {
  source: string
  youngEarly: boolean
  oldEarly: boolean
  monotonic: boolean
}

export interface DCCRedisCacheCrosscheck {
  source: string
  seeded: number
  missedAfterTtl: number
  expiredCount: number
  lazyExpiredAll: boolean
}

export interface DCCRingCrosscheck {
  source: string
  keys: number
  nodes: number
  fanoutClients: number
  spread: number
  emptyNodes: number
  balanceRatio: number | null
}

export interface DCCCrosscheck {
  configServer: DCCConfigServerCrosscheck
  configWatcher: DCCConfigWatcherCrosscheck
  bus: DCCBusCrosscheck
  gray: DCCGrayCrosscheck
  guard: DCCGuardCrosscheck
  redisCache: DCCRedisCacheCrosscheck
  ring: DCCRingCrosscheck
}

export interface DCCVerdict {
  vectors: Record<string, string>
  trilemmaDistinguishes: boolean
  noProtocolWinsAll: boolean
  noUniversalWinner: boolean
  pollingLags: boolean
  pollingIdles: boolean
  pollingDegrades: boolean
  longPollingHoldsConnections: boolean
  longPollingReconnects: boolean
  watchNeedsAddressing: boolean
  watchVersionGaps: boolean
  centerDownBreaksPush: boolean
  watchNotPanacea: boolean
}

export interface DCCTopology {
  clients: number
  manyClients: number
  pollIntervalMs: number
  lpTimeoutMs: number
  burstCoalesceMs: number
  burstCount: number
  windowMs: number
}

export interface DCCSnapshot {
  /** 现算/注入时钟读数（快照投影原样带出，与 drlSnapshot/igSnapshot 对齐）。 */
  builtAt: number
  config: {
    seed: number
    clients: number
    manyClients: number
    pollIntervalMs: number
    windowMs: number
    rigged: boolean
    scenarios: string[]
  }
  rows: DCCRow[]
  vectors: Record<string, string>
  crosscheck: DCCCrosscheck
  verdict: DCCVerdict
  topology: DCCTopology
}

export interface ConfigConsistencyStudy extends DCCSnapshot {
  builtAt: number
}

/** 默认参数（全部可注入）。 */
export const DCC_DEFAULTS: Readonly<{
  seed: number
  clients: number
  manyClients: number
  pollIntervalMs: number
  lpTimeoutMs: number
  burstCoalesceMs: number
  burstCount: number
  downDurationMs: number
  windowMs: number
  now: number
  pollingInstant: boolean
  centerAlwaysUp: boolean
  noBurst: boolean
  rigged: boolean
}>

/** 三协议名册（顺序即矩阵行顺序）。 */
export const DCC_PROTOCOLS: readonly ['Polling', 'LongPolling', 'WatchPush']

/** 六场景名册（顺序即矩阵列顺序）。 */
export const DCC_SCENARIOS: readonly [
  'allOk', 'quickChange', 'idleNoChange', 'centerDown', 'burstChanges', 'manyClients',
]

export interface DCCClient {
  feed(fo?: DCCFault): {
    protocol: string
    clients: number
    detectedAt: number | null
    perceivedDelay: number
    idleFetches: number
    connections: number
    reconnects: number
    versionGaps: number
    staleClients: number
    degraded: boolean
    centerBroken: boolean
    changes: number
    coalesced?: number
  }
  reset(): void
  readonly protocol: string
  readonly observableCount: number
}

/** ① Polling 客户端轮询（0~T 延迟 + 无变更空转，中心宕可持旧快照续命）。 */
export function createPollingClient(opts?: DCCOptions): DCCClient

/** ② LongPolling 长轮询（即时 + 零空转，但连接常驻 + 超时重连 + 中心宕全断）。 */
export function createLongPollingClient(opts?: DCCOptions): DCCClient

/** ③ WatchPush watch 推送（即时 + 连接按需，但须可寻址注册 + 版本号兜底 + 广播风暴削峰）。 */
export function createWatchPushClient(opts?: DCCOptions): DCCClient

/** 单协议 × 单场景跑一格子（带三难三维判据）。 */
export function runConfigConsistencyScenario(protocol: string, scenario: string, opts?: DCCOptions): DCCCellReading

/** 三协议 × 六场景核心对照 + 三难向量 + 真依赖交叉印证 + 可证伪判词。 */
export function compareConfigConsistency(opts?: DCCOptions): Promise<{
  rows: DCCRow[]
  vectors: Record<string, string>
  crosscheck: DCCCrosscheck
  verdict: DCCVerdict
  config: DCCSnapshot['config']
}>

/** 完整 study（compare + topology，纯数据可 JSON 往返）。 */
export function configConsistencyStudy(opts?: DCCOptions): Promise<ConfigConsistencyStudy>

/** 快照投影（前端只读，纯数据）。 */
export function dccSnapshot(study: ConfigConsistencyStudy | null | undefined): DCCSnapshot | null
