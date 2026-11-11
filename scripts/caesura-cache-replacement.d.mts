/** `scripts/caesura-cache-replacement.mjs` 的声明：LRU / 2Q / ARC 三替换策略诚实权衡教学件（KI-528）。 */

export const CR_DEFAULTS: Readonly<{
  seed: number
  capacity: number
  accesses: number
  kCoefficient: number
  scanFraction: number
  perfectFuture: boolean
  unlimitedRoom: boolean
  rigged: boolean
}>
export const CR_STRATEGIES: readonly string[]
export const CR_SCENARIOS: readonly string[]

export interface LruInstance {
  protocol: 'LRU'
  access(key: string, inScan?: boolean): boolean
  size(): number
  capacity: number
  stats(): {
    hits: number; misses: number; scanHits: number; scanMisses: number;
    localHits: number; localMisses: number; hitRate: number;
  }
}
export interface TwoQueueInstance {
  protocol: '2Q'
  access(key: string, inScan?: boolean): boolean
  size(): number
  capacity: number
  stats(): {
    hits: number; misses: number; scanHits: number; scanMisses: number;
    localHits: number; localMisses: number; amPromotions: number;
    a1inSize: number; amSize: number; hitRate: number;
  }
}
export interface ArcInstance {
  protocol: 'ARC'
  access(key: string, inScan?: boolean): boolean
  size(): number
  capacity: number
  stats(): {
    hits: number; misses: number; scanHits: number; scanMisses: number;
    localHits: number; localMisses: number; ghostHitsT1: number; ghostHitsT2: number;
    ghostAdaptMoves: number; p: number; T1: number; T2: number; B1: number; B2: number; hitRate: number;
  }
}
export function createLruCache(opts?: { capacity?: number; seed?: number }): LruInstance
export function createTwoQueueCache(opts?: { capacity?: number; kCoefficient?: number; seed?: number }): TwoQueueInstance
export function createArcCache(opts?: { capacity?: number; seed?: number }): ArcInstance

export interface ReplacementCell {
  id: string
  protocol: string
  hits: number
  misses: number
  hitRate: number
  scanHits: number
  scanMisses: number
  localHits: number
  localMisses: number
  amPromotions?: number
  ghostHitsT1?: number
  ghostHitsT2?: number
  ghostAdaptMoves?: number
  adaptationP?: number
  fault: string
  /** rigged-aware 真干预读数（仅开关打开时由 runFlaggedScenario 现算填入） */
  effectiveCapacity?: number
  fedAccesses?: number
  prefetchSkipped?: number
}
export interface ReplacementTrilemma {
  scanResistance: boolean
  stableHitRate: boolean
  adaptiveBalance: boolean
}
export interface ReplacementRow {
  protocol: 'LRU' | '2Q' | 'ARC'
  scenarios: ReplacementCell[]
  trilemma: ReplacementTrilemma
  metrics: {
    hitRateAvg: number; ghostAdaptMoves: number; amPromotions: number; adaptationP: number
    effectiveCapacity: number; prefetchSkipped: number
    trilemmaDebug: { scanAvg: number; avgHitRate: number; ghostMoves: number; driftGhost: number }
    [k: string]: number | { scanAvg: number; avgHitRate: number; ghostMoves: number; driftGhost: number }
  }
}

/** 双路自证 + 三路篡改的判定内核读数（篡改分支带 reason、与稳态同结构）。 */
export interface DualSweepReading {
  laneA: { hits: number; misses: number; hitRate: number }
  laneB: { hits: number; misses: number; hitRate: number }
  absoluteDelta: number
  hotsetSize: number
  totalKeys: number
  tolerance: number
  holds: boolean
  nontrivial: boolean
  falsifiable: boolean
  tamper: {
    laneATraceCorrupted: DualSweepReading['laneA'] & { reason: string } & Record<string, any>
    laneBTraceCorrupted: DualSweepReading['laneA'] & { reason: string } & Record<string, any>
    laneBSizedNull: DualSweepReading['laneA'] & { reason: string } & Record<string, any>
  }
}

export interface ReplacementVerdict {
  vectors: Record<string, string>
  trilemmaDistinguishes: boolean
  noUniversalWinner: boolean
  noStrategyWinsAll: boolean
  vectorFromTrilemma: boolean
  lru_unhinted: boolean
  lru_localityAware: boolean
  twoQ_scanResistant: boolean
  twoQ_notAdaptive: boolean
  arc_adaptive: boolean
  arc_shuffle_pingpong: boolean
  perfectFutureBreaksArc: boolean
  unlimitedRoomAllTrue: boolean
  rigged_pkg: boolean
  /** rigged 因果锁：齐开后 adaptiveBalance 全 false、无一策略能翻回真 */
  adaptiveBalanceCausallyUnerasable: boolean
  /** 单开无限空间抹真 LRU 抗扫维 */
  unlimitedRoomRestoresLruScan: boolean
  /** 单开无限空间抹真 ARC 稳定维（ghost 归零） */
  unlimitedRoomRestoresArcStability: boolean
  /** 单开无限空间反噬 ARC 自适应维（幽灵链无可适配动作） */
  unlimitedRoomBackfiresAdaptiveBalance: boolean
  /** 单开完美未来抹真 LRU 抗扫维（一次性冷键被跳过） */
  perfectFutureRestoresLruScan: boolean
  /** 单开完美未来反噬：容量不变 ⇒ ARC 幽灵链仍抖、稳定维救不回 */
  perfectFutureBackfiresArcStability: boolean
  dualSweepHolds: boolean
  dualSweepNontrivial: boolean
  [k: string]: any
}

export interface ReplacementStudy {
  builtAt: number
  config: {
    seed: number; capacity: number; accesses: number; scenarios: string[] | readonly string[]
    perfectFuture: boolean; unlimitedRoom: boolean; rigged: boolean
  }
  rows: ReplacementRow[]
  vectors: Record<string, string>
  verdict: ReplacementVerdict
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  crosscheck: {
    evidence: ReplacementEvidence
    dualSweep: DualSweepReading
  }
  rigged: boolean
}
export function cacheReplacementStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  capacity?: number
  accesses?: number
  scenarios?: readonly string[]
  perfectFuture?: boolean
  unlimitedRoom?: boolean
  rigged?: boolean
}): ReplacementStudy
export const compareReplacement: typeof cacheReplacementStudy

export interface ReplacementSnapshot {
  builtAt: number
  config: ReplacementStudy['config']
  rows: ReplacementStudy['rows']
  vectors: Record<string, string>
  verdict: ReplacementStudy['verdict']
  crosscheck: {
    evidence: ReplacementEvidence | undefined
    dualSweep: DualSweepReading | undefined
  } | undefined
}
export function cacheReplacementSnapshot(study: ReplacementStudy | null | Record<string, never>): ReplacementSnapshot | null

export function runReplacementScenario(protocol: string, scenarioId: string, opts?: Record<string, unknown>): ReplacementCell

/** 双路独立交叉印证：唯一内核 evaluateDualSweep 真跑路 A（LRU 幽灵轨迹）与路 B（hot-set 聚类），
 *  三路篡改（截断反转 trace / 容量致 LRU 抖动 / 空集零聚类）真喂回同一内核逐路现算 holds。 */
export function verifyDualSweep(
  trace: Array<[string | number, boolean]>,
  opts?: { capacity?: number; tolerance?: number },
): DualSweepReading

/** 十一真件交叉印证，21 键全真 API 真回读、计数不硬编码。 */
export interface ReplacementEvidence {
  remapConsistentRate: number
  remapModuloRate: number
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
  [key: string]: number
}
export function createReplacementEvidence(opts?: { seed?: number; now?: number | (() => number) }): ReplacementEvidence
