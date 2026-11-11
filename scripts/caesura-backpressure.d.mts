/** `scripts/caesura-backpressure.mjs` 的声明：消费者组积压背压 / 流量削峰四策略诚实权衡教学状态机（KI-525）。 */

export const BP_DEFAULTS: Readonly<{
  seed: number
  steps: number
  mu: number
  acceptBudget: number
  latencyBudget: number
  bufferCap: number
  memoryCap: number
  shedThreshold: number
  detectTicks: number
  stallTicks: number
  scaleFactor: number
  zeroLoss: boolean
  boundedLatency: boolean
  unlimitedBuffer: boolean
  rigged: boolean
}>
export const BP_STRATEGIES: readonly string[]
export const BP_SCENARIOS: readonly string[]

/** 单步决策：admitted 入队 / rejected 反压退回上游 / dropped 主动丢弃 / muOverride 服务倍率覆盖（null=用场景 μ）。 */
export interface BackpressureDecision {
  admitted: number
  rejected: number
  dropped: number
  muOverride: number | null
  scale?: number
}

/** 策略真跑上下文（四构造器 decide 的输入）。 */
export interface BackpressureContext {
  t: number
  arrivals: number
  mu: number
  queue: Array<{ enqueue: number }>
  cap: number
  acc: Record<string, any>
  flags: BackpressureFlags
  strategy: string
}

export interface BackpressureFlags {
  zeroLoss: boolean
  boundedLatency: boolean
  unlimitedBuffer: boolean
  rigged: boolean
}

export interface BackpressureStrategy {
  id: string
  decide(ctx: BackpressureContext): BackpressureDecision
}

export function createBackpressureAdmission(opts?: { refill?: number }): BackpressureStrategy
export function createBufferingQueue(opts?: Record<string, unknown>): BackpressureStrategy
export function createSheddingValve(opts?: { threshold?: number }): BackpressureStrategy
export function createScalingPool(opts?: { detectTicks?: number; stallTicks?: number; scaleFactor?: number }): BackpressureStrategy

/** Little's Law 双路自证结果：路径 A 逐拍积分队长 L vs 路径 B 逐消息 λ·W。 */
export interface LittleLawReading {
  L: number
  W: number
  lambda: number
  Lpred: number
  gap: number
  steadyStateReached: boolean
  holds: boolean
  nontrivial?: boolean
}

/** 可独立证伪的 Little's Law 纯函数；篡改任一累计量会让 L 与 λW 分叉、holds 翻 false。 */
export function verifyLittleLaw(a: {
  queueLenSum: number
  waitSum: number
  served: number
  endQueue: number
  steps: number
}): LittleLawReading

export interface BackpressureCell {
  id: string
  strategy: string
  arrivals: number
  accepted: number
  admitted: number
  rejected: number
  dropped: number
  served: number
  endQueue: number
  waitSum: number
  queueLenSum: number
  avgWait: number
  peakQueue: number
  acceptedRate: number
  muEffective: number
  backpressureTicks: number
  littleLaw: LittleLawReading
  /** 只在 noLoss 考场做真判定，其余场景空真 */
  noLoss: boolean
  /** 只在 lowLatency 考场做真判定，其余场景空真 */
  lowLatency: boolean
  /** 只在 highThroughput 考场做真判定，其余场景空真 */
  highThroughput: boolean
  fault: string
  rebalances?: number
}

export interface BackpressureRow {
  strategy: 'Backpressure' | 'Buffering' | 'Shedding' | 'Scaling'
  scenarios: BackpressureCell[]
  trilemma: { noLoss: boolean; lowLatency: boolean; highThroughput: boolean }
  metrics: { dropped: number; rejected: number; avgWait: number; peakQueue: number; rebalances: number }
}

export interface BackpressureEvidence {
  bucketAllowed: number
  bucketRejected: number
  leakyAllowed: number
  leakyRejected: number
  zqFired: number
  zqPendingAfterRestore: number
  zqLostOnRestart: number
  heapFired: number
  walLines: number
  walReplayed: number
  shardHits: number
  bloomHit: boolean
  bloomMiss: boolean
  jitterSpread: number
  counterSum: number
  counterFalseSharing: number
  poolCreated: number
  poolReused: number
  watermarkNotices: number
  busListeners: number
}

export interface BackpressureStudy {
  builtAt: number
  config: {
    steps: number
    mu: number
    acceptBudget: number
    latencyBudget: number
    bufferCap: number
    memoryCap: number
    seed: number
    zeroLoss: boolean
    boundedLatency: boolean
    unlimitedBuffer: boolean
    rigged: boolean
    scenarios: readonly string[]
  }
  rows: BackpressureRow[]
  vectors: Record<string, string>
  topology: Record<string, string>
  littleLaw: {
    steadyHolds: boolean
    steadyNontrivial: boolean
    overloadBreaks: boolean
    steady: Array<LittleLawReading & { strategy: string }>
    overload: Array<LittleLawReading & { strategy: string }>
    note: string
  }
  crosscheck: { evidence: BackpressureEvidence }
  verdict: {
    vectors: Record<string, string>
    trilemmaDistinguishes: boolean
    noUniversalWinner: boolean
    noStrategyWinsAll: boolean
    backpressureRejectsBursts: boolean
    bufferingPaysLatency: boolean
    sheddingDropsMessages: boolean
    sheddingNotFreeLunch: boolean
    scalingStallsOnRebalance: boolean
    bufferingDropsUnderMemoryPressure: boolean
    bufferingAccumulatesUnderOverload: boolean
    littleLawHolds: boolean
    littleLawNontrivial: boolean
    overloadBreaksLittleLaw: boolean
    zeroLossBackfiresLatency: boolean
    boundedLatencyBackfiresNoLoss: boolean
    unlimitedBufferErasesOomOnly: boolean
    highThroughputCausallyUnerasable: boolean
  }
  rigged: boolean
}

export function backpressureStudy(opts?: {
  now?: number | (() => number)
  steps?: number
  mu?: number
  acceptBudget?: number
  latencyBudget?: number
  bufferCap?: number
  memoryCap?: number
  seed?: number
  jitter?: boolean
  scenarios?: readonly string[]
  zeroLoss?: boolean
  boundedLatency?: boolean
  unlimitedBuffer?: boolean
  rigged?: boolean
}): BackpressureStudy

/** compareBackpressure 同构别名：研究入口的另一名字，指向同一 buildStudy。 */
export const compareBackpressure: typeof backpressureStudy

export function backpressureSnapshot(study: BackpressureStudy): {
  builtAt: number
  config: BackpressureStudy['config']
  rows: BackpressureStudy['rows']
  vectors: Record<string, string>
  littleLaw: BackpressureStudy['littleLaw']
  crosscheck: { evidence: BackpressureEvidence }
  verdict: BackpressureStudy['verdict']
  topology: Record<string, string>
} | null

/** 十一枚真件交叉印证：返回每个真件的一小组真实读数（全真 API 真回读，计数不硬编码）。 */
export function createBackpressureEvidence(opts?: { seed?: number }): BackpressureEvidence
