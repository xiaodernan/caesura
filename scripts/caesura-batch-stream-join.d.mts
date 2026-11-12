/** `scripts/caesura-batch-stream-join.mjs` 的声明：批流 join 三策略诚实权衡教学件（KI-543）。 */

export const BATCH_STREAM_DEFAULTS: Readonly<{
  seed: number
  messages: number
  batchSize: number
  infiniteBatchRssi: boolean
  magicExactlyOnceDedup: boolean
  perfectBinlogReplay: boolean
  rigged: boolean
}>
export const BATCH_STREAM_STRATEGIES: readonly string[]
export const BATCH_STREAM_SCENARIOS: readonly string[]

export interface MicroBatchJoinInstance {
  protocol: 'MicroBatchJoin'
  join(orderStream: Array<{ id: string; orderId: string; ts?: number }>, shipmentStream: Array<{ id: string; orderId: string; ts?: number }>): { joins: number; rejected: number; txnCount: number; flushedAt: number }
  txnCount(): number
  joins(): number
  bulkThroughput: boolean
  lowLatency: boolean
  exactlyOnce: boolean
}
export interface StreamWindowJoinInstance {
  protocol: 'StreamWindowJoin'
  join(orderStream: Array<{ id: string; orderId: string; ts?: number }>, shipmentStream: Array<{ id: string; orderId: string; ts?: number }>): { joins: number; evicted: number; processingLatency: string }
  merged(): number
  bulkThroughput: boolean
  lowLatency: boolean
  exactlyOnce: boolean
}
export interface CdcOutboxJoinInstance {
  protocol: 'CdcOutboxJoin'
  join(orderStream: Array<{ id: string; orderId: string; ts?: number }>, shipmentStream: Array<{ id: string; orderId: string; ts?: number }>, firstReadNs?: number): { joins: number; tailIncrement: number; duplicates: number }
  tailPosition(): number
  bulkThroughput: boolean
  lowLatency: boolean
  exactlyOnce: boolean
}
export function createMicroBatchJoin(opts?: { batchSize?: number; infiniteBatchRssi?: boolean }): MicroBatchJoinInstance
export function createStreamWindowJoin(opts?: { magicExactlyOnceDedup?: boolean }): StreamWindowJoinInstance
export function createCdcOutboxJoin(opts?: { perfectBinlogReplay?: boolean }): CdcOutboxJoinInstance

export interface BsjCell {
  id: string
  messages: number
  joins: number
  duplicates: number
  bulkThroughput: boolean
  lowLatency: boolean
  exactlyOnce: boolean
  fault: string
}
export interface BsjRow {
  protocol: 'MicroBatchJoin' | 'StreamWindowJoin' | 'CdcOutboxJoin'
  scenarios: BsjCell[]
  trilemma: { bulkThroughput: boolean; lowLatency: boolean; exactlyOnce: boolean }
  metrics: { totalJoins: number; totalDuplicates: number }
}
export interface BsjCausalLocks {
  batchWindowCausallyUnerasable: boolean
  streamExactlyOnceCausallyUnerasable: boolean
  cdcReplayCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  probes?: Record<string, number>
}
export interface BatchStreamJoinStudy {
  builtAt: number
  config: {
    seed: number
    messages: number
    batchSize: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    infiniteBatchRssi: boolean
    magicExactlyOnceDedup: boolean
    perfectBinlogReplay: boolean
  }
  rows: BsjRow[]
  vectors: Record<string, string>
  verdict: {
    vectors: Record<string, string>
    noUniversalWinner: boolean
    trilemmaDistinguishes: boolean
    noStrategyWinsAll: boolean
    vectorFromTrilemma: boolean
    rigged_pkg: boolean
    rigged_pkg_flags?: Record<string, boolean>
    riggedConvergenceCollapsed: boolean
    avgJoinsMax: number
  }
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks: BsjCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: {
      laneA: { microJoins: number; microTxnCount: number }
      laneB: { streamJoins: number; streamInterleave: boolean; cdcTailIncrement: number }
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        batchBucketDrift: { holds: boolean; reason: string }
        windowMiss: { holds: boolean; reason: string }
        cdcDupe: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function batchStreamJoinStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  messages?: number
  batchSize?: number
  scenarios?: readonly string[]
  infiniteBatchRssi?: boolean
  magicExactlyOnceDedup?: boolean
  perfectBinlogReplay?: boolean
  rigged?: boolean
}): BatchStreamJoinStudy
export const compareBatchStreamJoin: typeof batchStreamJoinStudy
export interface BatchStreamJoinSnapshot extends Omit<BatchStreamJoinStudy, 'causalLocks'> {
  causalLocks?: BsjCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function batchStreamJoinSnapshot(study: BatchStreamJoinStudy | null | Record<string, never>): BatchStreamJoinSnapshot | null
export function verifyBatchStreamJoinSoundness(input: {
  events?: Array<{ id: string; orderId: string; ts?: number; late?: boolean }>
  seed?: number
  messages?: number
  batchSize?: number
  now?: number | (() => number)
}, opts?: { seed?: number; messages?: number; batchSize?: number }): BatchStreamJoinStudy['crosscheck']['soundness']
export function verifyCausalLocks(cfg?: { seed?: number; messages?: number; batchSize?: number }): BsjCausalLocks
export function createBatchStreamJoinEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
