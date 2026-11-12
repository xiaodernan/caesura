/** `scripts/caesura-transactional-outbox.mjs` 的声明：事务性发件箱与消费幂等教学件（KI-534）。 */

export const OUTBOX_DEFAULTS: Readonly<{
  seed: number
  items: number
  pollInterval: number
  cdcLag: number
  retryLimit: number
  latencyBudget: number
  atomicMagic: boolean
  zeroPollInterval: boolean
  perfectDedup: boolean
  rigged: boolean
}>
export const OUTBOX_STRATEGIES: readonly string[]
export const OUTBOX_SCENARIOS: readonly string[]

export interface DualWriteInstance {
  protocol: 'DualWrite'
  run(items: Array<Record<string, any>>, scenarioId: string): any
  metrics(): { committed: number; delivered: number; ghost: number }
  outbox: false
}
export interface PollingOutboxInstance {
  protocol: 'PollingOutbox'
  run(items: Array<Record<string, any>>, scenarioId: string): any
  metrics(): { committed: number; delivered: number; ghost: number; duplicateProcessed: number }
  outbox: true
  consumerDedup: true
}
export interface CdcOutboxInstance {
  protocol: 'CdcOutbox'
  run(items: Array<Record<string, any>>, scenarioId: string): any
  metrics(): { committed: number; delivered: number; ghost: number; duplicateProcessed: number }
  outbox: true
  consumerDedup: false
}

export function createDualWrite(opts?: { seed?: number; atomicMagic?: boolean }): DualWriteInstance
export function createPollingOutbox(opts?: { seed?: number; pollInterval?: number; retryLimit?: number; zeroPollInterval?: boolean }): PollingOutboxInstance
export function createCdcOutbox(opts?: { seed?: number; cdcLag?: number; retryLimit?: number; perfectDedup?: boolean }): CdcOutboxInstance

export interface OutboxCell {
  id: string
  committed: number
  delivered: number
  lost: number
  ghost: number
  duplicates: number
  maxDeliveryLag: number
  atomicDelivery: boolean
  lowLatency: boolean
  noDuplicate: boolean
  fault: string
}
export interface OutboxRow {
  protocol: 'DualWrite' | 'PollingOutbox' | 'CdcOutbox'
  scenarios: OutboxCell[]
  trilemma: { atomicDelivery: boolean; lowLatency: boolean; noDuplicate: boolean }
  metrics: { committed: number; delivered: number; lost: number; duplicates: number; maxDeliveryLag: number }
}
export interface OutboxCausalLocks {
  atomicDeliveryRequiresOutboxCausallyUnerasable: boolean
  atLeastOnceRequiresDedupCausallyUnerasable: boolean
  zeroLatencyNeedsCdcReplayCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  retrySweep: Array<{ retryLimit: number; duplicates: number }>
  pollSweep: Array<{ pollInterval: number; maxDeliveryLag: number; duplicates: number }>
}
export interface OutboxStudy {
  builtAt: number
  config: {
    seed: number
    items: number
    pollInterval: number
    cdcLag: number
    retryLimit: number
    latencyBudget: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    atomicMagic: boolean
    zeroPollInterval: boolean
    perfectDedup: boolean
  }
  rows: OutboxRow[]
  vectors: Record<string, string>
  verdict: {
    vectors: Record<string, string>
    noUniversalWinner: boolean
    trilemmaDistinguishes: boolean
    noStrategyWinsAll: boolean
    vectorFromTrilemma: boolean
    dualWriteLosesOnCrash: boolean
    pollingNoDup: boolean
    cdcDuplicatesOnHalfCrash: boolean
    rigged_pkg: boolean
    riggedConvergenceCollapsed: boolean
    atomicMagicKeepsDualWriteFragile: boolean
    zeroPollIntervalErasesPollingDupRule: boolean
    perfectDedupKeepsCdcFragilitySignals: boolean
  }
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks: OutboxCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: {
      laneA: { businessTransactions: number; messagesDelivered: number; ghostDeliveries: number }
      laneAOk: boolean
      laneB: { committed: number; deliveries: number; uniqueProcessed: number; duplicatesFilteredByDedup: number }
      laneBOk: boolean
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        forgedCommit: { holds: boolean; reason: string }
        silentDrop: { holds: boolean; reason: string }
        duplicateRelease: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function transactionalOutboxStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  items?: number
  scenarios?: readonly string[]
  atomicMagic?: boolean
  zeroPollInterval?: boolean
  perfectDedup?: boolean
  rigged?: boolean
}): OutboxStudy
export const compareTransactionalOutbox: typeof transactionalOutboxStudy

export interface OutboxSnapshot extends Omit<OutboxStudy, 'causalLocks'> {
  causalLocks?: OutboxCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function transactionalOutboxSnapshot(study: OutboxStudy | null | Record<string, never>): OutboxSnapshot | null

export function verifyOutboxSoundness(input: {
  events?: Array<Record<string, any>>
  seed?: number
  now?: number | (() => number)
}, opts?: { seed?: number }): OutboxStudy['crosscheck']['soundness']

export function verifyCausalLocks(cfg?: { seed?: number }): OutboxCausalLocks

export function createOutboxEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
