/** `scripts/caesura-spring-bus.mjs` —— Spring Cloud Bus 事件分发三策略教学件（KI-548） */

export const SPRING_BUS_DEFAULTS: Readonly<{
  seed: number
  messages: number
  freePersistent: boolean
  freeOrder: boolean
  freeOverhead: boolean
  rigged: boolean
}>
export const SPRING_BUS_STRATEGIES: readonly string[]
export const SPRING_BUS_SCENARIOS: readonly string[]

export interface InMemoryLocalBusInstance {
  protocol: 'InMemoryLocalBus'
  invoke(reqs: any[]): { processed: number; busUnavailableMs: number }
  persistent: boolean
  orderedPerTopic: boolean
  lowOverhead: boolean
}
export interface RedisPubSubBusInstance {
  protocol: 'RedisPubSubBus'
  invoke(reqs: any[]): { processed: number; subscribers: number }
  persistent: boolean
  orderedPerTopic: boolean
  lowOverhead: boolean
}
export interface KafkaBrokerBusInstance {
  protocol: 'KafkaBrokerBus'
  invoke(reqs: any[]): { processed: number; partitionCount: number }
  persistent: boolean
  orderedPerTopic: boolean
  lowOverhead: boolean
}
export function createInMemoryLocalBus(opts?: { freePersistent?: boolean }): InMemoryLocalBusInstance
export function createRedisPubSubBus(opts?: { freeOrder?: boolean }): RedisPubSubBusInstance
export function createKafkaBrokerBus(opts?: { freeOverhead?: boolean }): KafkaBrokerBusInstance

export interface BusCell {
  id: string
  messages: number
  processed: number
  persistent: boolean
  orderedPerTopic: boolean
  lowOverhead: boolean
  fault: string
}
export interface BusRow {
  protocol: 'InMemoryLocalBus' | 'RedisPubSubBus' | 'KafkaBrokerBus'
  scenarios: BusCell[]
  trilemma: { persistent: boolean; orderedPerTopic: boolean; lowOverhead: boolean }
  metrics: { totalProcessed: number; totalMessages: number }
}
export interface BusCausalLocks {
  inMemoryVolatilityCausallyUnerasable: boolean
  redisPubSubNotExactlyCausallyUnerasable: boolean
  kafkaPartitionHotKeyCausallyUnerasable: boolean
  causalLocksAllHold: boolean
}
export interface SpringBusStudy {
  builtAt: number
  config: {
    seed: number
    messages: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    freePersistent: boolean
    freeOrder: boolean
    freeOverhead: boolean
  }
  rows: BusRow[]
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
  causalLocks: BusCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: {
      laneA: { localDelivered: number; expected: number }
      laneB: { redisDelivered: number; subscribers: number; expected: number }
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        subscriberStuck: { holds: boolean; reason: string }
        pubSubLagging: { holds: boolean; reason: string }
        topicSplit: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function springBusStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  messages?: number
  scenarios?: readonly string[]
  freePersistent?: boolean
  freeOrder?: boolean
  freeOverhead?: boolean
  rigged?: boolean
}): SpringBusStudy
export const compareSpringBus: typeof springBusStudy
export interface SpringBusSnapshot extends Omit<SpringBusStudy, 'causalLocks'> {
  causalLocks?: BusCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function springBusSnapshot(study: SpringBusStudy | null | Record<string, never>): SpringBusSnapshot | null
export function verifySpringBusSoundness(input: {
  events?: Array<{ id: string; topic: string; app: string; seq: number; reconnect?: boolean }>
  seed?: number
  messages?: number
  now?: number | (() => number)
}, opts?: { seed?: number; messages?: number }): SpringBusStudy['crosscheck']['soundness']
export function verifyCausalLocks(cfg?: { seed?: number; messages?: number }): BusCausalLocks
export function createSpringBusEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
