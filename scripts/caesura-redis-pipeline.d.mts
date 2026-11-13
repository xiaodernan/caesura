/** `scripts/caesura-redis-pipeline.mjs` —— Redis 三策略事务教学件（KI-549） */

export const REDIS_PIPELINE_DEFAULTS: Readonly<{
  seed: number
  messages: number
  freeAtomicity: boolean
  freeLua: boolean
  freeCas: boolean
  rigged: boolean
}>
export const REDIS_PIPELINE_STRATEGIES: readonly string[]
export const REDIS_PIPELINE_SCENARIOS: readonly string[]

export interface PipelineBatchInstance {
  protocol: 'PipelineBatch'
  invoke(reqs: any[]): { processed: number; acceptedByParser: number }
  atomicPerPipe: boolean
  roundTripCount: boolean
  contendedLockFree: boolean
}
export interface LuaScriptingInstance {
  protocol: 'LuaScripting'
  invoke(reqs: any[]): { processed: number; scriptMs: number }
  atomicPerPipe: boolean
  roundTripCount: boolean
  contendedLockFree: boolean
}
export interface WatchCasInstance {
  protocol: 'WatchCas'
  invoke(reqs: any[]): { processed: number; execSucceeded: number; execAborted: number }
  atomicPerPipe: boolean
  roundTripCount: boolean
  contendedLockFree: boolean
}
export function createPipelineBatch(opts?: { freeAtomicity?: boolean }): PipelineBatchInstance
export function createLuaScripting(opts?: { freeLua?: boolean }): LuaScriptingInstance
export function createWatchCas(opts?: { freeCas?: boolean }): WatchCasInstance

export interface RedisPipelineCell {
  id: string
  messages: number
  processed: number
  atomicPerPipe: boolean
  roundTripCount: boolean
  contendedLockFree: boolean
  fault: string
}
export interface RedisPipelineRow {
  protocol: 'PipelineBatch' | 'LuaScripting' | 'WatchCas'
  scenarios: RedisPipelineCell[]
  trilemma: { atomicPerPipe: boolean; roundTripCount: boolean; contendedLockFree: boolean }
  metrics: { totalProcessed: number; totalMessages: number }
}
export interface RedisPipelineCausalLocks {
  pipelineNotAtomicCausallyUnerasable: boolean
  luaSingleThreadCausallyUnerasable: boolean
  watchLiveLockCausallyUnerasable: boolean
  causalLocksAllHold: boolean
}
export interface RedisPipelineStudy {
  builtAt: number
  config: {
    seed: number
    messages: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    freeAtomicity: boolean
    freeLua: boolean
    freeCas: boolean
  }
  rows: RedisPipelineRow[]
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
  causalLocks: RedisPipelineCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: {
      laneA: { pipelineAccepted: number; expected: number }
      laneB: { luaExecuted: number; scriptMs: number; expected: number }
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        pipelineNotAtomic: { holds: boolean; reason: string }
        luaLongBlock: { holds: boolean; reason: string }
        watchLiveLock: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function redisPipelineStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  messages?: number
  scenarios?: readonly string[]
  freeAtomicity?: boolean
  freeLua?: boolean
  freeCas?: boolean
  rigged?: boolean
}): RedisPipelineStudy
export const compareRedisPipeline: typeof redisPipelineStudy
export interface RedisPipelineSnapshot extends Omit<RedisPipelineStudy, 'causalLocks'> {
  causalLocks?: RedisPipelineCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function redisPipelineSnapshot(study: RedisPipelineStudy | null | Record<string, never>): RedisPipelineSnapshot | null
export function verifyRedisPipelineSoundness(input: {
  events?: Array<{ id: string; op: string; key: string; delta: number; version: number }>
  seed?: number
  messages?: number
  now?: number | (() => number)
}, opts?: { seed?: number; messages?: number }): RedisPipelineStudy['crosscheck']['soundness']
export function verifyCausalLocks(cfg?: { seed?: number; messages?: number }): RedisPipelineCausalLocks
export function createRedisPipelineEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
