/** `scripts/caesura-redis-ha.mjs` —— Redis 高可用三策略教学件（KI-552） */

export const REDIS_HA_DEFAULTS: Readonly<{
  seed: number
  messages: number
  freeFailover: boolean
  freeRpo: boolean
  freeSharding: boolean
  rigged: boolean
}>
export const REDIS_HA_STRATEGIES: readonly string[]
export const REDIS_HA_SCENARIOS: readonly string[]

export interface SentinelInstance {
  protocol: 'Sentinel'
  invoke(reqs: any[]): { processed: number; votes: number }
  autoFailover: boolean
  zeroRpo: boolean
  dataSharding: boolean
}
export interface SyncPairInstance {
  protocol: 'SyncPair'
  invoke(reqs: any[]): { processed: number; waitedFor: number }
  autoFailover: boolean
  zeroRpo: boolean
  dataSharding: boolean
}
export interface ClusterInstance {
  protocol: 'Cluster'
  invoke(reqs: any[]): { processed: number; slotCount: number }
  autoFailover: boolean
  zeroRpo: boolean
  dataSharding: boolean
}
export function createSentinel(opts?: { freeFailover?: boolean }): SentinelInstance
export function createSyncPair(opts?: { freeRpo?: boolean }): SyncPairInstance
export function createCluster(opts?: { freeSharding?: boolean }): ClusterInstance

export interface RedisHaCell {
  id: string
  messages: number
  processed: number
  autoFailover: boolean
  zeroRpo: boolean
  dataSharding: boolean
  fault: string
}
export interface RedisHaRow {
  protocol: 'Sentinel' | 'SyncPair' | 'Cluster'
  scenarios: RedisHaCell[]
  trilemma: { autoFailover: boolean; zeroRpo: boolean; dataSharding: boolean }
  metrics: { totalProcessed: number; totalMessages: number }
}
export interface RedisHaCausalLocks {
  sentinelRpoCausallyUnerasable: boolean
  syncWriteCausallyUnerasable: boolean
  clusterCrossSlotCausallyUnerasable: boolean
  causalLocksAllHold: boolean
}
export interface RedisHaStudy {
  builtAt: number
  config: {
    seed: number
    messages: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    freeFailover: boolean
    freeRpo: boolean
    freeSharding: boolean
  }
  rows: RedisHaRow[]
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
  causalLocks: RedisHaCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: {
      laneA: { sentinelProcessed: number; votes: number; expected: number }
      laneB: { syncPairProcessed: number; waitedFor: number; expected: number }
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        sentinelQuorumFlaky: { holds: boolean; reason: string }
        syncWriteStall: { holds: boolean; reason: string }
        clusterCrossSlotRegress: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function redisHaStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  messages?: number
  scenarios?: readonly string[]
  freeFailover?: boolean
  freeRpo?: boolean
  freeSharding?: boolean
  rigged?: boolean
}): RedisHaStudy
export const compareRedisHa: typeof redisHaStudy
export interface RedisHaSnapshot extends Omit<RedisHaStudy, 'causalLocks'> {
  causalLocks?: RedisHaCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function redisHaSnapshot(study: RedisHaStudy | null | Record<string, never>): RedisHaSnapshot | null
export function verifyRedisHaSoundness(input: {
  events?: Array<{ id: string; op: string; key: string; slot: number; resettle?: boolean }>
  seed?: number
  messages?: number
  now?: number | (() => number)
}, opts?: { seed?: number; messages?: number }): RedisHaStudy['crosscheck']['soundness']
export function verifyCausalLocks(cfg?: { seed?: number; messages?: number }): RedisHaCausalLocks
export function createRedisHaEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
