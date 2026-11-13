/** `scripts/caesura-cdc-outbox-join.mjs` 的声明：CDC outbox join 三策略诚实权衡教学件（KI-544）。 */

export const CDC_JOIN_DEFAULTS: Readonly<{
  seed: number
  messages: number
  interval: number
  nailedSnapshot: boolean
  freeBinlog: boolean
  noLatch: boolean
  rigged: boolean
}>
export const CDC_JOIN_STRATEGIES: readonly string[]
export const CDC_JOIN_SCENARIOS: readonly string[]

export interface LsmSnapshotJoinInstance {
  protocol: 'LsmSnapshotJoin'
  join(orders: any[], shipments: any[]): { joins: number; snapshotInterval: number; pairs: any[] }
  snapshotConsistent: boolean
  zeroDowntime: boolean
  rendezvousCapable: boolean
  footprint(): number
}
export interface RawBinlogJoinInstance {
  protocol: 'RawBinlogJoin'
  join(orders: any[], shipments: any[], opts?: { borderlineMiss?: boolean }): { joins: number; binlogBorderline: number; fullScan: boolean }
  snapshotConsistent: boolean
  zeroDowntime: boolean
  rendezvousCapable: boolean
  footprint(): number
}
export interface OutboxAtomicJoinInstance {
  protocol: 'OutboxAtomicJoin'
  join(orders: any[], shipments: any[]): { joins: number; latchAcquired: number; transactional: boolean }
  snapshotConsistent: boolean
  zeroDowntime: boolean
  rendezvousCapable: boolean
  footprint(): number
  latchCount(): number
}
export function createLsmSnapshotJoin(opts?: { interval?: number; nailedSnapshot?: boolean }): LsmSnapshotJoinInstance
export function createRawBinlogJoin(opts?: { freeBinlog?: boolean }): RawBinlogJoinInstance
export function createOutboxAtomicJoin(opts?: { noLatch?: boolean }): OutboxAtomicJoinInstance

export interface CdcJoinCell {
  id: string
  messages: number
  joins: number
  snapshotConsistent: boolean
  zeroDowntime: boolean
  rendezvousCapable: boolean
  fault: string
}
export interface CdcJoinRow {
  protocol: 'LsmSnapshotJoin' | 'RawBinlogJoin' | 'OutboxAtomicJoin'
  scenarios: CdcJoinCell[]
  trilemma: { snapshotConsistent: boolean; zeroDowntime: boolean; rendezvousCapable: boolean }
  metrics: { totalJoins: number; totalMessages: number }
}
export interface CdcJoinCausalLocks {
  snapshotCommitWindowCausallyUnerasable: boolean
  binlogBorderlineCausallyUnerasable: boolean
  outboxLockCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  probes?: Record<string, number>
}
export interface CdcOutboxJoinStudy {
  builtAt: number
  config: {
    seed: number
    messages: number
    interval: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    nailedSnapshot: boolean
    freeBinlog: boolean
    noLatch: boolean
  }
  rows: CdcJoinRow[]
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
  }
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks: CdcJoinCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: {
      laneA: { snapshotJoins: number; snapshotInterval: number }
      laneB: { binlogJoins: number; fullScan: boolean }
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        snapshotMismatched: { holds: boolean; reason: string }
        binlogMiss: { holds: boolean; reason: string }
        atomicLatchLeak: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function cdcOutboxJoinStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  messages?: number
  interval?: number
  scenarios?: readonly string[]
  nailedSnapshot?: boolean
  freeBinlog?: boolean
  noLatch?: boolean
  rigged?: boolean
}): CdcOutboxJoinStudy
export const compareCdcOutboxJoin: typeof cdcOutboxJoinStudy

export interface CdcOutboxJoinSnapshot extends Omit<CdcOutboxJoinStudy, 'causalLocks'> {
  causalLocks?: CdcJoinCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function cdcOutboxJoinSnapshot(study: CdcOutboxJoinStudy | null | Record<string, never>): CdcOutboxJoinSnapshot | null
export function verifyCdcOutboxJoinSoundness(input: {
  events?: Array<{ id: string; orderId: string; paid?: boolean }>
  seed?: number
  messages?: number
  interval?: number
  now?: number | (() => number)
}, opts?: { seed?: number; messages?: number; interval?: number }): CdcOutboxJoinStudy['crosscheck']['soundness']
export function verifyCausalLocks(cfg?: { seed?: number; messages?: number; interval?: number }): CdcJoinCausalLocks
export function createCdcOutboxJoinEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
