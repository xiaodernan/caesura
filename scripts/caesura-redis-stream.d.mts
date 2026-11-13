/** `scripts/caesura-redis-stream.mjs` —— Redis Stream 三策略教学件（KI-553） */

export const REDIS_STREAM_DEFAULTS: Readonly<{
  seed: number
  messages: number
  freeDurability: boolean
  freeReplay: boolean
  freeCap: boolean
  rigged: boolean
}>
export const REDIS_STREAM_STRATEGIES: readonly string[]
export const REDIS_STREAM_SCENARIOS: readonly string[]

export interface PubSubInstance {
  protocol: 'PubSub'
  invoke(reqs: any[]): { processed: number; subscribers: number }
  durable: boolean
  fanout: boolean
  replayable: boolean
}
export interface PersistentQueueInstance {
  protocol: 'PersistentQueue'
  invoke(reqs: any[]): { processed: number }
  durable: boolean
  fanout: boolean
  replayable: boolean
}
export interface StreamLogInstance {
  protocol: 'StreamLog'
  invoke(reqs: any[]): { processed: number; pendingRemaining: number }
  durable: boolean
  fanout: boolean
  replayable: boolean
}
export function createPubSub(opts?: { freeDurability?: boolean }): PubSubInstance
export function createPersistentQueue(opts?: { freeReplay?: boolean }): PersistentQueueInstance
export function createStreamLog(opts?: { freeCap?: boolean }): StreamLogInstance

export interface RedisStreamCell {
  id: string
  messages: number
  processed: number
  durable: boolean
  fanout: boolean
  replayable: boolean
  fault: string
}
export interface RedisStreamRow {
  protocol: 'PubSub' | 'PersistentQueue' | 'StreamLog'
  scenarios: RedisStreamCell[]
  trilemma: { durable: boolean; fanout: boolean; replayable: boolean }
  metrics: { totalProcessed: number; totalMessages: number }
}
export interface RedisStreamCausalLocks {
  pubSubEphemeralCausallyUnerasable: boolean
  listNoAckCausallyUnerasable: boolean
  streamEntryCapCausallyUnerasable: boolean
  causalLocksAllHold: boolean
}
export interface RedisStreamStudy {
  builtAt: number
  config: {
    seed: number
    messages: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    freeDurability: boolean
    freeReplay: boolean
    freeCap: boolean
  }
  rows: RedisStreamRow[]
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
  causalLocks: RedisStreamCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: {
      laneA: { persistentQueueProcessed: number; expected: number }
      laneB: { streamProcessed: number; pendingRemaining: number; expected: number }
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        pubSubNotDurable: { holds: boolean; reason: string }
        listNoXackFlow: { holds: boolean; reason: string }
        streamCapDiscard: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function redisStreamStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  messages?: number
  scenarios?: readonly string[]
  freeDurability?: boolean
  freeReplay?: boolean
  freeCap?: boolean
  rigged?: boolean
}): RedisStreamStudy
export const compareRedisStream: typeof redisStreamStudy
export interface RedisStreamSnapshot extends Omit<RedisStreamStudy, 'causalLocks'> {
  causalLocks?: RedisStreamCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function redisStreamSnapshot(study: RedisStreamStudy | null | Record<string, never>): RedisStreamSnapshot | null
export function verifyRedisStreamSoundness(input: {
  events?: Array<{ id: string; op: string; key: string; entry: number; consumerDead?: boolean }>
  seed?: number
  messages?: number
  now?: number | (() => number)
}, opts?: { seed?: number; messages?: number }): RedisStreamStudy['crosscheck']['soundness']
export function verifyCausalLocks(cfg?: { seed?: number; messages?: number }): RedisStreamCausalLocks
export function createRedisStreamEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
