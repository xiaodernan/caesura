/** `scripts/caesura-idempotent-consumer.mjs` 的声明：幂等去重三策略诚实权衡教学件（KI-540）。 */

export const IDEMPOTENT_DEFAULTS: Readonly<{
  seed: number
  messages: number
  bloomBits: number
  bloomK: number
  redisTtlMs: number
  unboundedRam: boolean
  zeroRttNetwork: boolean
  collisionFreeBloom: boolean
  rigged: boolean
}>
export const IDEMPOTENT_STRATEGIES: readonly string[]
export const IDEMPOTENT_SCENARIOS: readonly string[]

export interface InMemoryDedupSetInstance {
  protocol: 'InMemoryDedupSet'
  add(id: string): { added: boolean; deduped: boolean; bytes?: number; oom?: boolean }
  has(id: string): boolean
  size(): number
  memoryBytes(): number
  clear(): void
  set: Set<string>
  fanout: string[]
  unboundedRam: boolean
}
export interface RedisSetNxInstance {
  protocol: 'RedisSetNx'
  add(id: string): { ok: boolean; deduped: boolean; rtt: number }
  has(id: string): boolean
  size(): number
  rtt(): number
  clear(): void
  zeroRttNetwork: boolean
  storeSize(): number
}
export interface BloomGuardInstance {
  protocol: 'BloomGuard'
  add(id: string): { added: boolean; indices: number[] }
  has(id: string): boolean
  loadFactor(): number
  fpr(): number
  clear(): void
  hashIndexes(str: string): number[]
  bits: number
  k: number
  collisionFreeBloom: boolean
}
export function createInMemoryDedupSet(opts?: { unboundedRam?: boolean }): InMemoryDedupSetInstance
export function createRedisSetNx(opts?: { now?: number | (() => number); ttlMs?: number; zeroRttNetwork?: boolean }): RedisSetNxInstance
export function createBloomGuard(opts?: { bits?: number; k?: number; collisionFreeBloom?: boolean }): BloomGuardInstance

export interface IdempotentCell {
  id: string
  messages: number
  exact: number
  rejected: number
  falsePositiveRejections: number
  oom: number
  exactDedup: boolean
  lowOverhead: boolean
  durableBounded: boolean
  fault: string
  loadFactor: number | null
  fpr: number
}
export interface IdempotentRow {
  protocol: 'InMemoryDedupSet' | 'RedisSetNx' | 'BloomGuard'
  scenarios: IdempotentCell[]
  trilemma: { exactDedup: boolean; lowOverhead: boolean; durableBounded: boolean }
  metrics: { totalExact: number; totalRejected: number; falsePositiveRejections: number; totalOom: number }
}
export interface IdempotentCausalLocks {
  bloomFalsePositiveCausallyUnerasable: boolean
  redisRttCausallyUnerasable: boolean
  inMemoryVolatilityCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  probes?: Record<string, number>
}
export interface IdempotentConsumerStudy {
  builtAt: number
  config: {
    seed: number
    messages: number
    bloomBits: number
    bloomK: number
    redisTtlMs: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    unboundedRam: boolean
    zeroRttNetwork: boolean
    collisionFreeBloom: boolean
  }
  rows: IdempotentRow[]
  vectors: Record<string, string>
  verdict: {
    vectors: Record<string, string>
    noUniversalWinner: boolean
    trilemmaDistinguishes: boolean
    noStrategyWinsAll: boolean
    vectorFromTrilemma: boolean
    memPureCrash: boolean
    redisStillExact: boolean
    bloomOverheads: boolean
    rigged_pkg: boolean
    rigged_pkg_flags?: Record<string, boolean>
    riggedConvergenceCollapsed: boolean
    unboundedRamErasesInMemoryOom: boolean
    zeroRttErasesRedisLowOverheadBit: boolean
    collisionFreeBloomErasesBloomFp: boolean
  }
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks: IdempotentCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: {
      laneA: { consistentAcceptedInMemory: number; consistentAcceptedRedis: number; unique: number }
      laneB: { atLeastOnceAcceptedInMemory: number; atLeastOnceAcceptedRedis: number; atLeastOnceAcceptedBloom: number; unique: number }
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        duplicateInvisible: { holds: boolean; reason: string }
        forgedDedupHit: { holds: boolean; reason: string }
        emptyStream: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function idempotentConsumerStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  messages?: number
  bloomBits?: number
  bloomK?: number
  redisTtlMs?: number
  scenarios?: readonly string[]
  unboundedRam?: boolean
  zeroRttNetwork?: boolean
  collisionFreeBloom?: boolean
  rigged?: boolean
}): IdempotentConsumerStudy
export const compareIdempotentConsumer: typeof idempotentConsumerStudy

export interface IdempotentConsumerSnapshot extends Omit<IdempotentConsumerStudy, 'causalLocks'> {
  causalLocks?: IdempotentCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function idempotentConsumerSnapshot(study: IdempotentConsumerStudy | null | Record<string, never>): IdempotentConsumerSnapshot | null

export function verifyIdempotencySoundness(input: {
  events?: Array<{ id: string; payload?: string }>
  seed?: number
  now?: number | (() => number)
}, opts?: { seed?: number; messages?: number }): IdempotentConsumerStudy['crosscheck']['soundness']

export function verifyCausalLocks(cfg?: { seed?: number; messages?: number }): IdempotentCausalLocks

export function createIdempotentEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
