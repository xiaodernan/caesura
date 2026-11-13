/** `scripts/caesura-spring-stream-binding.mjs` 的声明：Spring Cloud Stream 绑定策略诚实权衡教学件（KI-545）。 */

export const SPRING_STREAM_DEFAULTS: Readonly<{
  seed: number
  messages: number
  unboundedCapacity: boolean
  magicAckCoordinator: boolean
  freeExactlyOnceDedup: boolean
  rigged: boolean
}>
export const SPRING_STREAM_STRATEGIES: readonly string[]
export const SPRING_STREAM_SCENARIOS: readonly string[]

export interface ExclusiveConsumerInstance {
  protocol: 'ExclusiveConsumer'
  consume(messages: any[], owner: string): { processed: number; polled: number; owner: string }
  reset(): void
  lowLatency: boolean
  burstFriendly: boolean
  exactlyOnce: boolean
}
export interface SharedConsumerInstance {
  protocol: 'SharedConsumer'
  consume(messages: any[], consumers: Array<{ name: string }>): { accepted: number; duplicates: number; overlap: string }
  lowLatency: boolean
  burstFriendly: boolean
  exactlyOnce: boolean
}
export interface ClusteredConsumerInstance {
  protocol: 'ClusteredConsumer'
  consume(messages: any[]): { confirmed: number; ackRpcs: number; clusterPartitioned: boolean }
  lowLatency: boolean
  burstFriendly: boolean
  exactlyOnce: boolean
}
export function createExclusiveConsumer(opts?: { unboundedCapacity?: boolean }): ExclusiveConsumerInstance
export function createSharedConsumer(opts?: { freeExactlyOnceDedup?: boolean }): SharedConsumerInstance
export function createClusteredConsumer(opts?: { magicAckCoordinator?: boolean }): ClusteredConsumerInstance

export interface SpringStreamCell {
  id: string
  messages: number
  processed: number
  lowLatency: boolean
  burstFriendly: boolean
  exactlyOnce: boolean
  fault: string
}
export interface SpringStreamRow {
  protocol: 'ExclusiveConsumer' | 'SharedConsumer' | 'ClusteredConsumer'
  scenarios: SpringStreamCell[]
  trilemma: { lowLatency: boolean; burstFriendly: boolean; exactlyOnce: boolean }
  metrics: { totalProcessed: number; totalMessages: number }
}
export interface SpringStreamCausalLocks {
  exclusiveLockCausallyUnerasable: boolean
  sharedThroughputCausallyUnerasable: boolean
  clusterAckCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  probes?: Record<string, number>
}
export interface SpringStreamBindingStudy {
  builtAt: number
  config: {
    seed: number
    messages: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    unboundedCapacity: boolean
    magicAckCoordinator: boolean
    freeExactlyOnceDedup: boolean
  }
  rows: SpringStreamRow[]
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
  causalLocks: SpringStreamCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: {
      laneA: { exclusiveProcessed: number; expected: number }
      laneB: { sharedAccepted: number; duplicates: number }
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        exclusiveLockGrab: { holds: boolean; reason: string }
        sharedAckLost: { holds: boolean; reason: string }
        clusterRpcDrop: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function springStreamBindingStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  messages?: number
  scenarios?: readonly string[]
  unboundedCapacity?: boolean
  magicAckCoordinator?: boolean
  freeExactlyOnceDedup?: boolean
  rigged?: boolean
}): SpringStreamBindingStudy
export const compareSpringStreamBinding: typeof springStreamBindingStudy
export interface SpringStreamBindingSnapshot extends Omit<SpringStreamBindingStudy, 'causalLocks'> {
  causalLocks?: SpringStreamCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function springStreamBindingSnapshot(study: SpringStreamBindingStudy | null | Record<string, never>): SpringStreamBindingSnapshot | null
export function verifySpringStreamBindingSoundness(input: {
  events?: Array<{ id: string; topic: string; offset?: number; rebalanced?: boolean }>
  seed?: number
  messages?: number
  now?: number | (() => number)
}, opts?: { seed?: number; messages?: number }): SpringStreamBindingStudy['crosscheck']['soundness']
export function verifyCausalLocks(cfg?: { seed?: number; messages?: number }): SpringStreamCausalLocks
export function createSpringStreamBindingEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
