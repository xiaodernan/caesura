/** `scripts/caesura-consumer-rebalance.mjs` 的声明：Kafka 消费组再平衡三策略诚实权衡教学件（KI-541）。 */

export const REBALANCE_DEFAULTS: Readonly<{
  seed: number
  partitions: number
  members: number
  sessionTimeoutMs: number
  perfectMemberSingleInstance: boolean
  zeroIncrementalConflict: boolean
  zeroSessionTimeout: boolean
  rigged: boolean
}>
export const REBALANCE_STRATEGIES: readonly string[]
export const REBALANCE_SCENARIOS: readonly string[]

export interface EagerRebalancerInstance {
  protocol: 'Eager'
  assignAll(members: string[]): { generation: number; assignment: Map<string, string>; fullStop: number }
  stats(): { generation: number; stops: number }
  zeroStopPause: boolean
  simpleProtocol: boolean
  staleFreeAssignment: boolean
}
export interface CooperativeStickyRebalancerInstance {
  protocol: 'CooperativeSticky'
  assignIncrement(members: string[], prev: Map<string, string> | null): { generation: number; assignment: Map<string, string>; revokedPartitions: number; conflictWindow: number }
  stats(): { generation: number; revoked: number; assigned: number }
  zeroStopPause: boolean
  simpleProtocol: boolean
  staleFreeAssignment: boolean
}
export interface StaticMembershipRebalancerInstance {
  protocol: 'StaticMembership'
  assignAll(members: string[]): { assignment: Map<string, string>; staleMembers: number; sessionTimeoutMs: number }
  stalePhantoms(): number
  sessionOverstayMs(): number
  zeroStopPause: boolean
  simpleProtocol: boolean
  staleFreeAssignment: boolean
}

export function createEagerRebalancer(opts?: { seed?: number; partitions?: number }): EagerRebalancerInstance
export function createCooperativeStickyRebalancer(opts?: { seed?: number; partitions?: number; zeroIncrementalConflict?: boolean }): CooperativeStickyRebalancerInstance
export function createStaticMembershipRebalancer(opts?: { sessionTimeoutMs?: number; zeroSessionTimeout?: boolean; seed?: number; partitions?: number }): StaticMembershipRebalancerInstance

export interface RebalanceCell {
  id: string
  members: number
  partitionsAssigned: number
  fullStops: number
  revokedPartitions: number
  conflictWindow: number
  staleMembers: number
  zeroStopPause: boolean
  simpleProtocol: boolean
  staleFreeAssignment: boolean
  fault: string
}
export interface RebalanceRow {
  protocol: 'Eager' | 'CooperativeSticky' | 'StaticMembership'
  scenarios: RebalanceCell[]
  trilemma: { zeroStopPause: boolean; simpleProtocol: boolean; staleFreeAssignment: boolean }
  metrics: { totalMembers: number; totalFullStops: number; totalRevoked: number; totalConflictWindows: number; totalStale: number }
}
export interface RebalanceCausalLocks {
  eagerPauseCausallyUnerasable: boolean
  cooperativeIncrementalComplexityCausallyUnerasable: boolean
  staticSessionTimeoutCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  probes?: Record<string, number>
}

export interface ConsumerRebalanceStudy {
  builtAt: number
  config: {
    seed: number
    partitions: number
    members: number
    sessionTimeoutMs: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    perfectMemberSingleInstance: boolean
    zeroIncrementalConflict: boolean
    zeroSessionTimeout: boolean
  }
  rows: RebalanceRow[]
  vectors: Record<string, string>
  verdict: {
    vectors: Record<string, string>
    noUniversalWinner: boolean
    trilemmaDistinguishes: boolean
    noStrategyWinsAll: boolean
    vectorFromTrilemma: boolean
    eagerFullStop: boolean
    coopIncremental: boolean
    staticStaleFree: boolean
    rigged_pkg: boolean
    rigged_pkg_flags?: Record<string, boolean>
    riggedConvergenceCollapsed: boolean
    perfectMemberMakesStaticComplete: boolean
    zeroConflictMakesCoopSimple: boolean
    zeroSessionTimeoutMakesStaticStaleFree: boolean
  }
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks: RebalanceCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: {
      laneA: Record<string, boolean>
      laneB: Record<string, number>
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        memberLeak: { holds: boolean; reason: string }
        staleAssignment: { holds: boolean; reason: string }
        emptyMembership: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}

export function consumerRebalanceStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  partitions?: number
  members?: number
  sessionTimeoutMs?: number
  scenarios?: readonly string[]
  perfectMemberSingleInstance?: boolean
  zeroIncrementalConflict?: boolean
  zeroSessionTimeout?: boolean
  rigged?: boolean
}): ConsumerRebalanceStudy

export const compareConsumerRebalance: typeof consumerRebalanceStudy

export interface ConsumerRebalanceSnapshot extends Omit<ConsumerRebalanceStudy, 'causalLocks'> {
  causalLocks?: RebalanceCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}

export function consumerRebalanceSnapshot(study: ConsumerRebalanceStudy | null | Record<string, never>): ConsumerRebalanceSnapshot | null

export function verifyRebalanceSoundness(input: {
  events?: string[]
  seed?: number
  partitions?: number
  members?: number
  now?: number | (() => number)
}, opts?: { seed?: number; partitions?: number; members?: number }): ConsumerRebalanceStudy['crosscheck']['soundness']

export function verifyCausalLocks(cfg?: { seed?: number; partitions?: number; members?: number }): RebalanceCausalLocks

export function createConsumerRebalanceEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>

export function makeMemberSet(kind: 'cleanSteadyState' | 'memberJoin' | 'memberLeave' | 'memberFlap' | 'coldStart' | 'cleanRerun', opts?: { members?: number }): string[]
