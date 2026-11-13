/** `scripts/caesura-spring-config.mjs` —— Spring Cloud Config 分布式配置中心三策略教学件（KI-547） */

export const SPRING_CONFIG_DEFAULTS: Readonly<{
  seed: number
  messages: number
  freeHotReload: boolean
  freeScale: boolean
  freeConsistency: boolean
  rigged: boolean
}>
export const SPRING_CONFIG_STRATEGIES: readonly string[]
export const SPRING_CONFIG_SCENARIOS: readonly string[]

export interface GitBackendInstance {
  protocol: 'GitBackend'
  invoke(reqs: any[]): { processed: number; headVersion: number }
  hotReload: boolean
  scaleFriendly: boolean
  consistency: boolean
}
export interface NativeBackendInstance {
  protocol: 'NativeBackend'
  invoke(reqs: any[]): { processed: number; fsLogSize: number }
  hotReload: boolean
  scaleFriendly: boolean
  consistency: boolean
}
export interface RedisBackendInstance {
  protocol: 'RedisBackend'
  invoke(reqs: any[]): { processed: number; subscribers: number }
  hotReload: boolean
  scaleFriendly: boolean
  consistency: boolean
}
export function createGitBackend(opts?: { freeConsistency?: boolean }): GitBackendInstance
export function createNativeBackend(opts?: { freeScale?: boolean }): NativeBackendInstance
export function createRedisBackend(opts?: { freeHotReload?: boolean }): RedisBackendInstance

export interface ConfigCell {
  id: string
  messages: number
  processed: number
  hotReload: boolean
  scaleFriendly: boolean
  consistency: boolean
  fault: string
}
export interface ConfigRow {
  protocol: 'GitBackend' | 'NativeBackend' | 'RedisBackend'
  scenarios: ConfigCell[]
  trilemma: { hotReload: boolean; scaleFriendly: boolean; consistency: boolean }
  metrics: { totalProcessed: number; totalMessages: number }
}
export interface ConfigCausalLocks {
  gitCommitLagCausallyUnerasable: boolean
  nativeHostAffinityCausallyUnerasable: boolean
  redisHotRttCausallyUnerasable: boolean
  causalLocksAllHold: boolean
}
export interface SpringConfigStudy {
  builtAt: number
  config: {
    seed: number
    messages: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    freeHotReload: boolean
    freeScale: boolean
    freeConsistency: boolean
  }
  rows: ConfigRow[]
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
  causalLocks: ConfigCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: {
      laneA: { gitProcessed: number; expected: number }
      laneB: { redisDelivered: number; subscribers: number; expected: number }
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        gitStaleCache: { holds: boolean; reason: string }
        redisNotifyLoss: { holds: boolean; reason: string }
        busEventStorm: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function springConfigStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  messages?: number
  scenarios?: readonly string[]
  freeHotReload?: boolean
  freeScale?: boolean
  freeConsistency?: boolean
  rigged?: boolean
}): SpringConfigStudy
export const compareSpringConfig: typeof springConfigStudy
export interface SpringConfigSnapshot extends Omit<SpringConfigStudy, 'causalLocks'> {
  causalLocks?: ConfigCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function springConfigSnapshot(study: SpringConfigStudy | null | Record<string, never>): SpringConfigSnapshot | null
export function verifySpringConfigSoundness(input: {
  events?: Array<{ id: string; key: string; op: string; version: number; drift?: boolean }>
  seed?: number
  messages?: number
  now?: number | (() => number)
}, opts?: { seed?: number; messages?: number }): SpringConfigStudy['crosscheck']['soundness']

export function verifyCausalLocks(cfg?: { seed?: number; messages?: number }): ConfigCausalLocks
export function createSpringConfigEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
