/** `scripts/caesura-spring-batch.mjs` 的声明：Spring Batch chunk-oriented R-P-W 教学件（KI-532）。 */

export const BATCH_DEFAULTS: Readonly<{
  seed: number
  items: number
  skipLimit: number
  chunkSize: number
  perfectOracle: boolean
  unlimitedSkip: boolean
  rigged: boolean
}>
export const BATCH_STRATEGIES: readonly string[]
export const BATCH_SCENARIOS: readonly string[]

export interface BatchEvent {
  id: number
  poison?: boolean
  payload?: string
  [key: string]: unknown
}

export interface BulkWriterInstance {
  protocol: 'BulkWriter'
  flush(events: BatchEvent[]): { flushed: boolean; processed: number; faults?: number }
  restart(events: BatchEvent[]): { processed: number; faults: number; survivors: number }
  runToEnd(events: BatchEvent[]): { processed: number; faults: number; survivors: number }
  seq: BatchEvent[]
  stats(): { processed: number; dropped: number; faults: number; checkpoints: number }
  restartability(): boolean
  footprint(): number
}
export interface ChunkedWriterInstance {
  protocol: 'ChunkedWriter'
  flush(events: BatchEvent[]): { flushed: boolean; processed: number; faults: number; checkpoints: number }
  flushChunk(chunk: BatchEvent[]): boolean
  restart(events: BatchEvent[], fromChk?: number): { processed: number; faults: number; committedChunks: number }
  chk(): number
  seq: BatchEvent[]
  stats(): { processed: number; dropped: number; faults: number; checkpoints: number }
  faultIsolation(): boolean
  restartability(): boolean
  footprint(): number
}
export interface SkipRetryWriterInstance {
  protocol: 'SkipRetryWriter'
  flush(events: BatchEvent[]): { flushed: boolean; processed: number; skips?: number; faults?: number }
  restart(events: BatchEvent[], fromChk?: number): { flushed: boolean; processed: number; skips: number; faults: number }
  skips(): number
  seq: BatchEvent[]
  stats(): { processed: number; dropped: number; faults: number; skips: number; checkpoints: number }
  faultIsolation(): boolean
  restartability(): boolean
  footprint(): number
}
export function createBulkWriter(opts?: { perfectOracle?: boolean; unlimitedSkip?: boolean }): BulkWriterInstance
export function createChunkedWriter(opts?: { perfectOracle?: boolean; chunkSize?: number }): ChunkedWriterInstance
export function createSkipRetryWriter(opts?: { perfectOracle?: boolean; unlimitedSkip?: boolean; skipLimit?: number }): SkipRetryWriterInstance

/** 六场景正交项流的构造器（导出供真件层/测试复现确定性流）。 */
export function streamOf(id: string, opts?: { seed?: number; items?: number }): BatchEvent[]

export interface SpringBatchCell {
  id: string
  processed: number
  faults: number
  poisonCount: number
  size: number
  checkpoints: number      // 真观测量：chk 有无 ⇒ restartability/throughput 唯一分界
  dropped: number          // 真观测量：skip 永久丢
  wholeBatchDied: boolean  // 含毒场景里整批死（faultIsolation 破的真判据）
  faultIsolation: boolean
  restartability: boolean
  throughput: boolean
  fault: string
  inFaultExam: boolean
  inRestartExam: boolean
  inThroughputExam: boolean
}
export interface SpringBatchRow {
  protocol: 'BulkWriter' | 'ChunkedWriter' | 'SkipRetryWriter'
  scenarios: SpringBatchCell[]
  trilemma: { faultIsolation: boolean; restartability: boolean; throughput: boolean }
  metrics: { chunkedCheckpoints: number; poisonDeaths: number; itemsProcessed: number; itemsDropped: number }
}

export interface CausalLocks {
  checkpointTradeoffCausallyUnerasable: boolean
  skipSilentLossCausallyUnerasable: boolean
  bulkAllOrNothingCausallyUnerasable: boolean
  causalLocksAllHold: boolean
}
export function verifyCausalLocks(cfg: {
  seed?: number
  items?: number
  chunkSize?: number
  skipLimit?: number
}): CausalLocks

/** 唯一判定内核的对外可证伪面：稳态真撞合 + 三路篡改真喂回同一内核现算翻 false。 */
export interface CheckpointInvariants {
  laneAOk: boolean
  poisonIsolated: boolean
  noDuplicate: boolean
  noLoss: boolean
  poisonChunkDetected: boolean
}
export interface CheckpointResult {
  laneA: { baselineProcessed: number; baselineFaults: number; baselineItemsSnapshot: number }
  laneB: { completedProcessed: number; completedFaults: number; committedChunks: number; uniqueCommitted: number }
  invariants: CheckpointInvariants
  baselineHolds: boolean
  holds: boolean
  nontrivial: boolean
  falsifiable: boolean
  tamper: {
    corruptedCheckpoint: { holds: boolean; invariants: CheckpointInvariants; reason: string }
    silentPoison: { holds: boolean; invariants: CheckpointInvariants; reason: string }
    emptyJob: { holds: boolean; nontrivial: boolean; reason: string }
  }
  events: number
}
export function verifyCheckpoint(
  input: { events?: BatchEvent[]; seed?: number; chunkSize?: number; items?: number; now?: number | (() => number) },
  opts?: { seed?: number; chunkSize?: number },
): CheckpointResult

export interface SpringBatchVerdict {
  vectors: Record<string, string>
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  noStrategyWinsAll: boolean
  vectorFromTrilemma: boolean
  bulkExplodesOnPoison: boolean       // 恒以纯净基线标定主教义（rigged 不翻）
  chunkedSurvivesPoison: boolean
  chunkedChkAvailable: boolean
  skipFastest: boolean
  skipSilentLoss: boolean
  rigged_pkg: boolean
  riggedConvergenceCollapsed: boolean // rigged 下 Bulk≡Skip=101，诚实标注区分度收敛
  perfectOracleErasesPoison: boolean
  unlimitedSkipNoRestart: boolean
  checkpointTradeoffCausallyUnerasable: boolean
  skipSilentLossCausallyUnerasable: boolean
  bulkAllOrNothingCausallyUnerasable: boolean
  causalLocksAllHold: boolean
}
export interface SpringBatchStudy {
  builtAt: number
  config: {
    seed: number
    items: number
    chunkSize: number
    skipLimit: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    perfectOracle: boolean
    unlimitedSkip: boolean
  }
  rows: SpringBatchRow[]
  vectors: Record<string, string>
  verdict: SpringBatchVerdict
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks: CausalLocks
  crosscheck: {
    evidence: Record<string, number>
    checkpoint: CheckpointResult
  }
  rigged: boolean
}
export function springBatchStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  items?: number
  chunkSize?: number
  skipLimit?: number
  scenarios?: readonly string[]
  perfectOracle?: boolean
  unlimitedSkip?: boolean
  rigged?: boolean
}): SpringBatchStudy
export const compareSpringBatch: typeof springBatchStudy

export interface SpringBatchSnapshot {
  builtAt: number
  config: SpringBatchStudy['config']
  rows: SpringBatchStudy['rows']
  vectors: Record<string, string>
  verdict: SpringBatchVerdict
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks: CausalLocks
  crosscheck?: { evidence?: Record<string, number>; checkpoint?: CheckpointResult }
  rigged: boolean
}
export function springBatchSnapshot(study: SpringBatchStudy | null | Record<string, never>): SpringBatchSnapshot | null

export interface SpringBatchEvidence {
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
export function createBatchEvidence(opts?: { seed?: number; now?: number | (() => number) }): SpringBatchEvidence
