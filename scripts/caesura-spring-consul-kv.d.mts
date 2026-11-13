/** `scripts/caesura-spring-consul-kv.mjs` —— Spring Cloud Consul KV 三策略教学件（KI-551） */

export const CONSUL_KV_DEFAULTS: Readonly<{
  seed: number
  messages: number
  freeStrong: boolean
  freeReload: boolean
  freeSession: boolean
  rigged: boolean
}>
export const CONSUL_KV_STRATEGIES: readonly string[]
export const CONSUL_KV_SCENARIOS: readonly string[]

export interface PollingReadInstance {
  protocol: 'PollingRead'
  invoke(reqs: any[]): { processed: number; lastConsulIndex: number }
  strongConsistency: boolean
  hotReloadEvents: boolean
  sessionState: boolean
}
export interface BlockingQueryInstance {
  protocol: 'BlockingQuery'
  invoke(reqs: any[]): { processed: number; maxIndex: number }
  strongConsistency: boolean
  hotReloadEvents: boolean
  sessionState: boolean
}
export interface SessionLockKVInstance {
  protocol: 'SessionLockKV'
  invoke(reqs: any[]): { processed: number; sessionTtlSec: number }
  strongConsistency: boolean
  hotReloadEvents: boolean
  sessionState: boolean
}
export function createPollingRead(opts?: { freeStrong?: boolean }): PollingReadInstance
export function createBlockingQuery(opts?: { freeReload?: boolean }): BlockingQueryInstance
export function createSessionLockKV(opts?: { freeSession?: boolean }): SessionLockKVInstance

export interface ConsulKvCell {
  id: string
  messages: number
  processed: number
  strongConsistency: boolean
  hotReloadEvents: boolean
  sessionState: boolean
  fault: string
}
export interface ConsulKvRow {
  protocol: 'PollingRead' | 'BlockingQuery' | 'SessionLockKV'
  scenarios: ConsulKvCell[]
  trilemma: { strongConsistency: boolean; hotReloadEvents: boolean; sessionState: boolean }
  metrics: { totalProcessed: number; totalMessages: number }
}
export interface ConsulKvCausalLocks {
  consulPollingCausallyUnerasable: boolean
  consulSessionCausallyUnerasable: boolean
  consulRaftCausallyUnerasable: boolean
  causalLocksAllHold: boolean
}
export interface SpringConsulStudy {
  builtAt: number
  config: {
    seed: number
    messages: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    freeStrong: boolean
    freeReload: boolean
    freeSession: boolean
  }
  rows: ConsulKvRow[]
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
  causalLocks: ConsulKvCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: {
      laneA: { pollingProcessed: number; lastConsulIndex: number; expected: number }
      laneB: { sessionProcessed: number; sessionTtlSec: number; expected: number }
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        staleIndex: { holds: boolean; reason: string }
        sessionExpired: { holds: boolean; reason: string }
        raftPartition: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function springConsulStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  messages?: number
  scenarios?: readonly string[]
  freeStrong?: boolean
  freeReload?: boolean
  freeSession?: boolean
  rigged?: boolean
}): SpringConsulStudy
export const compareSpringConsul: typeof springConsulStudy
export interface SpringConsulSnapshot extends Omit<SpringConsulStudy, 'causalLocks'> {
  causalLocks?: ConsulKvCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function springConsulSnapshot(study: SpringConsulStudy | null | Record<string, never>): SpringConsulSnapshot | null
export function verifySpringConsulSoundness(input: {
  events?: Array<{ id: string; op: string; key: string; raftIndex: number; resettle?: boolean }>
  seed?: number
  messages?: number
  now?: number | (() => number)
}, opts?: { seed?: number; messages?: number }): SpringConsulStudy['crosscheck']['soundness']
export function verifyCausalLocks(cfg?: { seed?: number; messages?: number }): ConsulKvCausalLocks
export function createSpringConsulEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
