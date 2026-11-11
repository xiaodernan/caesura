/**
 * caesura-message-delivery（KI-513）的类型声明。
 * 与 `caesura-message-delivery.mjs` 的 10 枚值导出严格同名（decl-parity 门机械核对）。
 */

/** 单场景软肋探针（fault:{} = 关闭探针，退化为基线）。 */
export interface MMDFault {
  /** crashAfterSend：发送后崩溃，暴露 At-Most-Once 静默丢消息。 */
  crashAfterSend?: boolean
  /** ackLost：ack 在网络里丢失，暴露 At-Least-Once 误判失败重投致重复。 */
  ackLost?: boolean
  /** brokerRetry：broker 重投同一条，At-Least-Once 消费者收到重复、Exactly-Once 幂等折叠。 */
  brokerRetry?: boolean
  /** consumerSlow：消费者慢，放大重投/超时窗口。 */
  consumerSlow?: boolean
  /** duplicateBurst：重复突发，放大幂等键规模与去重表命中。 */
  duplicateBurst?: boolean
}

export interface MMDOptions {
  seed?: number
  /** 默认场景消息条数。 */
  messages?: number
  /** duplicateBurst 探针放大的幂等键规模。 */
  manyKeys?: number
  /** 一次 ack 往返的结构 RTT 计数。 */
  ackRttMs?: number
  /** At-Least-Once / Exactly-Once 最大重投次数。 */
  retryLimit?: number
  /** crashAfterSend 在第几条发送后崩溃。 */
  crashAfterSendAt?: number
  /** 单场景模拟时窗（ms）。 */
  windowMs?: number
  /** 逻辑时钟起点（ms）；数值或注入函数（后者取一次读数），与 study.builtAt 同一口径。 */
  now?: number | (() => number)
  /** 注入时钟函数（保留契约对称）。 */
  nowFn?: () => number
  /** 注入随机（丢包/ack 丢失相位）；缺省用同 seed 的内部 PRNG。 */
  rand?: () => number
  /** rigged：抹发送后崩溃与丢包。 */
  noCrash?: boolean
  /** rigged：抹 ack 丢失 ⇒ 无误判重投。 */
  ackReliable?: boolean
  /** rigged：幂等去重零开销（教学假想）。 */
  freeIdempotency?: boolean
  /** 一次性抹掉全部软肋（等价于三开关全开 + fault 全空）。 */
  rigged?: boolean
  /** 确定性故障数组（rigged 传六场景 fault:{} 全空关闭全部探针）。 */
  faults?: MMDFault[]
  /** 覆盖六场景名册。 */
  scenarios?: string[]
}

/** 三协议共同读数（专有病征字段缺席者由 run 层归一）。 */
export interface MMDCellReading {
  id: string
  protocol: string
  sent: number
  delivered: number
  /** 静默丢失的消息数（At-Most-Once 专有病征）。 */
  lost: number
  /** 消费者重复收到的条数（At-Least-Once 专有病征）。 */
  duplicates: number
  /** 重投次数。 */
  retries: number
  /** 端到端开销结构单元（发送/ack/去重表/事务/游标合计）。 */
  overheadUnits: number
  /** 幂等键去重表命中折叠数（Exactly-Once 专有病征）。 */
  idempotentHits: number
  crashProbable: boolean
  ackLostProbable: boolean
  /** 三难①：不丢消息。 */
  noLoss: boolean
  /** 三难②：不重复投递。 */
  noDup: boolean
  /** 三难③：端到端低开销。 */
  lowOverhead: boolean
}

/** 三难：不丢消息 ∧ 不重复投递 ∧ 端到端低开销。 */
export interface MMDTrilemma {
  noLoss: boolean
  noDup: boolean
  lowOverhead: boolean
}

export interface MMDRowTotals {
  sent: number
  delivered: number
  lost: number
  duplicates: number
  retries: number
  overheadUnits: number
  idempotentHits: number
  crashScenarios: number
}

export interface MMDRow {
  protocol: string
  scenarios: MMDCellReading[]
  totals: MMDRowTotals
  trilemma: MMDTrilemma
}

/** ① 真 spring-bus-event.createBus：同步 fire-and-forget、无 ack 无重投。 */
export interface MMDBusCrosscheck {
  source: string
  hadListener: boolean
  listenerCount: number
  hits: number
  deliveredOnce: boolean
  afterUnsub: boolean
  noReplayOnUnsubscribe: boolean
  atMostOnceShell: true
  notRealNetwork: true
}

/** ② 真 caesura-event-bus.createGameEventBus：delivered/errors 计数。 */
export interface MMDGameEventBusCrosscheck {
  source: string
  delivered: number
  errors: number
  received: number
  deliveredMatches: boolean
  notRealBroker: true
}

/** ③ 真 caesura-game-event-bridge.createGameEventBridge：路由确定、转发可计数。 */
export interface MMDBridgeCrosscheck {
  source: string
  routes: number
  installed: boolean
  handlers: number
  forwarded: number
  dropped: number
  forwardOk: boolean
  unroutedDropped: boolean
  gameRoutes: number
  routeStable: boolean
  notRealRebalance: true
}

/** ④ 真 caesura-distributed-txn.createTwoPhaseCommit：全 yes 提交、重放已提交事务幂等、协调者宕全员 blocked。 */
export interface MMDTwoPhaseCrosscheck {
  source: string
  prepareAllYes: boolean
  commitPhase: string
  commitMessages: number
  replayIdempotent: boolean
  downPhase: string
  blockedParticipants: number
  notRealXa: true
  atomicCrossStoreNeedsCoordination: true
}

/** ⑤ 真 caesura-lsm-store.createWal：append→lines→restore→replay，带消息 id 重放去重（sink 进程内不跨机）。 */
export interface MMDWalCrosscheck {
  source: string
  lines: number
  restored: number
  replayed: number
  replayIds: Array<string | null>
  distinctIds: number
  duplicateIdsReplayed: number
  replayDedupePossible: boolean
  sinkWritten: number
  replicatedAcrossNodes: false
  wholeNodeLossDurable: false
  notRealBroker: true
}

/** ⑥ 真 caesura-redis-cache.createRedisCache：幂等键 idem:⟨id⟩ 首次 miss 二次 hit。 */
export interface MMDRedisCrosscheck {
  source: string
  key: string
  firstMiss: boolean
  secondHit: boolean
  hits: number
  misses: number
  idempotentTable: boolean
  notRealRedis: true
}

/** ⑦ 真 caesura-consistent-hash.createHashRing：分区投递 fanout 落点。 */
export interface MMDRingCrosscheck {
  source: string
  keys: number
  nodes: number
  emptyNodes: number
  spread: number
  balanceRatio: number | null
  notRealPartitionRebalance: true
}

export interface MMDCCrosscheck {
  bus: MMDBusCrosscheck
  gameEventBus: MMDGameEventBusCrosscheck
  bridge: MMDBridgeCrosscheck
  twoPhase: MMDTwoPhaseCrosscheck
  wal: MMDWalCrosscheck
  redis: MMDRedisCrosscheck
  ring: MMDRingCrosscheck
}

export interface MMDVerdict {
  vectors: Record<string, string>
  trilemmaDistinguishes: boolean
  noProtocolWinsAll: boolean
  noUniversalWinner: boolean
  atMostOnceSilentlyLoses: boolean
  atMostOnceCheapest: boolean
  atLeastOnceNeverLoses: boolean
  atLeastOnceDuplicates: boolean
  exactlyOnceNoLossNoDup: boolean
  exactlyOnceMostExpensive: boolean
  exactlyOnceIsAtLeastOncePlusIdempotency: boolean
  walReplayDedupePossible: boolean
  exactlyOnceNotFree: boolean
  busAtMostOnceShell: boolean
  redisIdempotentTable: boolean
}

export interface MMDTopology {
  messages: number
  manyKeys: number
  ackRttMs: number
  retryLimit: number
  crashAfterSendAt: number
  windowMs: number
}

export interface MMDSnapshot {
  builtAt: number
  config: {
    seed: number
    messages: number
    manyKeys: number
    ackRttMs: number
    retryLimit: number
    windowMs: number
    noCrash: boolean
    ackReliable: boolean
    freeIdempotency: boolean
    rigged: boolean
    scenarios: string[]
  }
  rows: MMDRow[]
  vectors: Record<string, string>
  crosscheck: MMDCCrosscheck
  verdict: MMDVerdict
  topology: MMDTopology
}

export interface MessageDeliveryStudy extends MMDSnapshot {
  builtAt: number
}

/** 默认参数（全部可注入）。 */
export const MMD_DEFAULTS: Readonly<{
  seed: number
  messages: number
  manyKeys: number
  ackRttMs: number
  retryLimit: number
  crashAfterSendAt: number
  windowMs: number
  now: number
  noCrash: boolean
  ackReliable: boolean
  freeIdempotency: boolean
  rigged: boolean
}>

/** 三协议名册（顺序即矩阵行顺序）。 */
export const MMD_PROTOCOLS: readonly ['AtMostOnce', 'AtLeastOnce', 'ExactlyOnce']

/** 六场景名册（顺序即矩阵列顺序）。 */
export const MMD_SCENARIOS: readonly [
  'allOk', 'crashAfterSend', 'ackLost', 'brokerRetry', 'consumerSlow', 'duplicateBurst',
]

export interface MMDChannel {
  feed(fo?: MMDFault): {
    protocol: string
    sent: number
    delivered: number
    lost: number
    duplicates: number
    retries: number
    overheadUnits: number
    idempotentHits: number
    crashProbable: boolean
    ackLostProbable?: boolean
    noLoss: boolean
    noDup: boolean
    lowOverhead: boolean
    ackRttMs?: number
  }
  reset(): void
  readonly protocol: string
  readonly observableCount: number
}

/** ① At-Most-Once 至多一次（发完即忘，开销最低但崩溃/丢包静默丢消息）。 */
export function createAtMostOnceChannel(opts?: MMDOptions): MMDChannel

/** ② At-Least-Once 至少一次（失败重投不丢消息，但 ack 丢失误判重投致重复）。 */
export function createAtLeastOnceChannel(opts?: MMDOptions): MMDChannel

/** ③ Exactly-Once 恰好一次（幂等键+去重表不丢不重，但端到端开销最高）。 */
export function createExactlyOnceChannel(opts?: MMDOptions): MMDChannel

/** 单协议 × 单场景跑一格子（带三难三维判据）。 */
export function runMessageDeliveryScenario(protocol: string, scenario: string, opts?: MMDOptions): MMDCellReading | null

/** 三协议 × 六场景核心对照 + 三难向量 + 真依赖交叉印证 + 可证伪判词。 */
export function compareMessageDelivery(opts?: MMDOptions): Promise<{
  rows: MMDRow[]
  vectors: Record<string, string>
  crosscheck: MMDCCrosscheck
  verdict: MMDVerdict
  config: MMDSnapshot['config']
}>

/** 完整 study（compare + topology，纯数据可 JSON 往返）。 */
export function messageDeliveryStudy(opts?: MMDOptions): Promise<MessageDeliveryStudy>

/** 快照投影（前端只读，纯数据）。 */
export function mmdSnapshot(study: MessageDeliveryStudy | null | undefined): MMDSnapshot | null
