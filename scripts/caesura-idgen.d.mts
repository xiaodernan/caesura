/**
 * scripts/caesura-idgen.d.mts —— KI-509 分布式 ID 生成教学件的类型声明。
 *
 * 与 `caesura-idgen.mjs` 的值导出**严格同名**（`decl-parity` 门逐枚对账，10 枚）：
 *   IDGEN_DEFAULTS / IDGEN_PROTOCOLS / IDGEN_SCENARIOS /
 *   createUuidV4 / createSnowflake / createLeafSegment /
 *   runIdGenScenario / compareIdGen / idGenStudy / igSnapshot
 * 另导出纯类型（不参与值名册）：*Options / *Stats / *Snapshot / IdGenVerdict 等。
 *
 * 判定权与阈值全在 Node 侧，这里只描述形状；前端只读 `igSnapshot` 的纯数据渲染、不复核不实测。
 * 唯一同仓 import 是 KI-504 `caesura-bplus-tree`（真树结构计数交叉印证），非字节/墙钟跑分。
 */

/** 缺省教学参数（位布局、段长、B+ 树阶数、内部随机种子）。 */
export const IDGEN_DEFAULTS: Readonly<{
  epoch: number
  workerIdBits: number
  sequenceBits: number
  workerId: number
  segmentSize: number
  treeOrder: number
  leafCapacity: number
  keyCount: number
  nodes: readonly string[]
  seed: number
  zero: number
}>

/** 三协议枚举（短名作矩阵 key）。 */
export const IDGEN_PROTOCOLS: readonly Readonly<{ id: string; short: string; label: string }>[]

/** 六类确定性故障场景（矩阵列）。 */
export const IDGEN_SCENARIOS: readonly Readonly<{ id: string; label: string }>[]

/** 通用选项（三协议共用 + 场景编排注入）。 */
export interface IdGenOptions {
  now?: () => number
  rand?: () => number
  seed?: number
  epoch?: number
  workerIdBits?: number
  sequenceBits?: number
  workerId?: number
  nodes?: string[]
  segmentSize?: number
  keyCount?: number
  order?: number
  leafCapacity?: number
  /** rigged 可证伪：UUID 退化为顺序主键（抹掉随机索引软肋）。 */
  sequentialIds?: boolean
  /** rigged 可证伪：号段中心永远在线/无成本（抹掉中心依赖软肋）。 */
  centerAvailable?: boolean
}

/** 故障注入：at 决定场景；clockBackward/sequenceOverflow/centerDown/segmentGap/forceDuplicate 决定打法。 */
export interface IdGenFault {
  at?: 'allOk' | 'randomKeyInsert' | 'clockBackward' | 'centerDown' | 'sequenceOverflow' | 'segmentGap' | string
  clockBackward?: boolean
  forceDuplicate?: boolean
  sequenceOverflow?: boolean
  centerDown?: boolean
  segmentGap?: boolean
  reason?: string
  [k: string]: any
}

/** 一个故障场景。 */
export interface IdGenScenario {
  id: string
  label?: string
  fault?: IdGenFault
}

/* ---------------- ① UUIDv4 ---------------- */

export interface UuidNextResult {
  id: string
  key: number
  version: number
  variant: number
}
export interface UuidStats {
  generator: 'caesura-idgen/uuid-v4'
  issued: number
  unique: number
  distinctKeys: number
  bitLength: number
  version: number
  sequentialIds: boolean
}
export interface UuidV4 {
  next(): UuidNextResult
  stats(): UuidStats
  snapshot(t?: number): Record<string, any>
  reset(): void
  readonly issued: number
  readonly sequentialIds: boolean
}
export function createUuidV4(opts?: IdGenOptions): UuidV4

/* ---------------- ② Snowflake ---------------- */

export interface SnowflakeNextResult {
  id: number | null
  key: number | null
  timestamp?: number
  workerId?: number
  sequence?: number
  duplicate?: boolean
  stalled: boolean
  issued?: boolean
  reason: string
  lastTimestamp?: number
}
export interface SnowflakeParsed {
  timestamp: number
  workerId: number
  sequence: number
}
export interface SnowflakeStats {
  generator: 'caesura-idgen/snowflake'
  issued: number
  unique: number
  duplicates: number
  stalled: number
  clockRollbacks: number
  waits: number
  bitLength: number
  workerIdBits: number
  sequenceBits: number
  workerId: number
  lastTimestamp: number
  messages: number
  latency: number
  centerRounds: number
}
export interface Snowflake {
  next(fo?: IdGenFault): SnowflakeNextResult
  parse(id: number): SnowflakeParsed | null
  stats(): SnowflakeStats
  snapshot(t?: number): Record<string, any>
  reset(): void
  readonly issued: number
  readonly duplicates: number
  readonly stalled: number
  readonly clockRollbacks: number
  readonly lastTimestamp: number
}
export function createSnowflake(opts?: IdGenOptions): Snowflake

/* ---------------- ③ Redis 号段 Leaf-segment ---------------- */

export interface SegmentNextResult {
  id: number | null
  key: number | null
  issued: boolean
  stalled: boolean
  reason: string
  segmentLo?: number
  segmentHi?: number
  centerRounds?: number
}
export interface SegmentStats {
  generator: 'caesura-idgen/leaf-segment'
  nodes: string[]
  segmentSize: number
  issued: number
  unique: number
  segmentsFetched: number
  wastedIds: number
  centerRounds: number
  bufferRefills: number
  stalled: number
  centerCounter: number
  messages: number
  latency: number
  contiguous: boolean
}
export interface LeafSegment {
  next(fo?: IdGenFault): SegmentNextResult
  fetchSegment(fo?: IdGenFault, warmup?: boolean): { lo: number; hi: number; next: number } | null
  stats(): SegmentStats
  snapshot(t?: number): Record<string, any>
  reset(): void
  readonly issued: number
  readonly stalled: number
  readonly centerRounds: number
  readonly wastedIds: number
  readonly segmentsFetched: number
  readonly nodes: string[]
  readonly segmentSize: number
}
export function createLeafSegment(opts?: IdGenOptions): LeafSegment

/* ---------------- ④ B+ 树交叉印证 ---------------- */

export interface BtreeFeedStats {
  comparisons: number
  splits: number
  pageRewrites: number
  puts: number
  size: number
  leafCount: number
  height: number
}
export interface BtreePageSplitEvidence {
  generator: 'caesura-idgen/bplus-crosscheck'
  n: number
  order: number
  leafCapacity: number
  sequentialIds: boolean
  sequential: BtreeFeedStats
  random: BtreeFeedStats
  /** 索引友好铁证：随机主键定位比较 > 顺序基线。 */
  sequentialCmpBaseline: number
  randomCmp: number
  randomCmpGtSequential: boolean
  /** 诚实反直觉读数：mid 分裂下随机主键 splits 反而更少。 */
  randomFewerSplits: boolean
  randomGtSequential: boolean
  randomWriteAmplification: boolean
}
/** 用 KI-504 真 `createBPlusTree` 量随机 vs 顺序主键的索引代价（结构计数，非墙钟/QPS）。 */
export function btreePageSplitEvidence(opts?: IdGenOptions): BtreePageSplitEvidence

/* ---------------- ⑤ 对照 ---------------- */

/** 统一读数：三协议每格都收敛成这一形状，供 compare / 前端共用。 */
export interface IdGenCellReading {
  protocol: string
  scenario: string
  label: string
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
  fault?: IdGenFault
}

/** 三难向量：索引友好 ∧ 去中心 ∧ 抗时钟异常。 */
export interface IdGenTrilemma {
  indexFriendly: boolean
  decentralized: boolean
  clockRobust: boolean
}

export interface IdGenMatrixCell {
  protocol: string
  label: string
  scenarios: Record<string, IdGenCellReading>
  totals: {
    issued: number
    unique: number
    duplicates: number
    stalled: number
    pageSplits: number
    comparisons: number
    wastedIds: number
    centerRounds: number
    waits: number
    messages: number
  }
  trilemma: IdGenTrilemma
}

export interface IdGenVerdict {
  uuidRandomKeyIndexCost: boolean
  uuidPaysIndexCost: boolean
  uuidDecentralizedClockRobust: boolean
  snowflakeIndexFriendly: boolean
  snowflakeDecentralized: boolean
  snowflakeClockBackwardFatal: boolean
  segmentIndexFriendly: boolean
  segmentClockRobust: boolean
  segmentCenterDownStalls: boolean
  segmentPaysCenterRounds: boolean
  segmentRestartGaps: boolean
  randomCmpGtSequential: boolean
  randomFewerSplits: boolean
  trilemmaDistinguishes: boolean
  noProtocolWinsAll: boolean
  noUniversalWinner: boolean
}

export interface IdGenComparison {
  generator: 'caesura-idgen/compare'
  protocols: string[]
  scenarios: Array<{ id: string; label: string; fault: IdGenFault }>
  trilemmaVectors: Record<string, string>
  matrix: Record<string, IdGenMatrixCell>
  verdict: IdGenVerdict
}

export function runIdGenScenario(opts?: IdGenOptions & { protocol?: string; scenario?: IdGenScenario }): IdGenCellReading

export function compareIdGen(opts?: IdGenOptions & { scenarios?: IdGenScenario[] }): IdGenComparison

/* ---------------- ⑥ study / snapshot ---------------- */

export interface UuidProbe {
  issued: number
  globallyUnique: boolean
  version4: boolean
  variantBits: boolean
  bitLength: number
  localNoCenter: boolean
  noWallClock: boolean
  randomCmp: number
  sequentialCmpBaseline: number
  randomCmpGtSequential: boolean
  randomPageSplits: number
  sequentialPageSplits: number
  randomFewerSplits: boolean
}

export interface SnowflakeProbe {
  parseRoundTrip: boolean
  sameMsSequenceIncrement: boolean
  trendMonotonic: boolean
  firstId: number
  nextId: number
  parsed: SnowflakeParsed
  clockBackwardStalls: boolean
  forceDuplicateReveals: boolean
  localNoCenter: boolean
}

export interface SegmentProbe {
  segmentMonotonic: boolean
  segmentsFetched: number
  bufferRefills: number
  centerDownStalls: boolean
  centerRounds: number
  restartGaps: boolean
  wastedIds: number
  contiguousWhenClean: boolean
  noWallClock: boolean
}

export interface IdGenStudy {
  generator: 'caesura-idgen'
  comparison: IdGenComparison
  uuid: UuidProbe
  snowflake: SnowflakeProbe
  segment: SegmentProbe
  btree: BtreePageSplitEvidence
  verdict: IdGenVerdict & {
    uuidGloballyUnique: boolean
    uuidVersion4: boolean
    uuidLocalNoCenter: boolean
    snowflakeParseRoundTrip: boolean
    snowflakeTrendMonotonic: boolean
    snowflakeClockBackwardStalls: boolean
    snowflakeForceDuplicateReveals: boolean
    segmentMonotonic: boolean
    segmentCenterDownStalls: boolean
    segmentRestartGaps: boolean
    segmentNoWallClock: boolean
    btreeRandomCmpGtSequential: boolean
    btreeRandomFewerSplits: boolean
  }
  builtAt: number
}

export interface IdGenSnapshotRow {
  protocol: string
  label: string
  trilemma: IdGenTrilemma
  totals: IdGenMatrixCell['totals']
  scenarios: Array<IdGenCellReading & { label: string }>
}

export interface IdGenSnapshot {
  config: { protocols: string[]; scenarios: Array<{ id: string; label: string }> }
  rows: IdGenSnapshotRow[]
  uuid: UuidProbe
  snowflake: SnowflakeProbe
  segment: SegmentProbe
  btree: BtreePageSplitEvidence
  verdict: IdGenStudy['verdict']
  builtAt: number
}

export function idGenStudy(opts?: IdGenOptions & { scenarios?: IdGenScenario[] }): IdGenStudy

/** 把 study 收敛成前端 / status 友好的只读结构；null 入参诚实降级为 null。 */
export function igSnapshot(study: IdGenStudy | null | undefined): IdGenSnapshot | null
