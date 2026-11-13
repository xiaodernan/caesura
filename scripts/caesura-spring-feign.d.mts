/** `scripts/caesura-spring-feign.mjs` 的声明：Spring Cloud OpenFeign 三策略 Client 教学件（KI-546）。 */

export const SPRING_FEIGN_DEFAULTS: Readonly<{
  seed: number
  messages: number
  freeStub: boolean
  freePipeline: boolean
  freeBatch: boolean
  rigged: boolean
}>
export const SPRING_FEIGN_STRATEGIES: readonly string[]
export const SPRING_FEIGN_SCENARIOS: readonly string[]

export interface StubDecoderInstance {
  protocol: 'StubDecoder'
  invoke(reqs: any[]): { processed: number }
  lowLatency: boolean
  batchFriendly: boolean
  pipelineable: boolean
}
export interface ReactiveClientInstance {
  protocol: 'ReactiveClient'
  invoke(reqs: any[]): { processed: number; streamSize: number }
  lowLatency: boolean
  batchFriendly: boolean
  pipelineable: boolean
}
export interface BlockingClientInstance {
  protocol: 'BlockingClient'
  invoke(reqs: any[]): { processed: number; logSize: number }
  lowLatency: boolean
  batchFriendly: boolean
  pipelineable: boolean
}
export function createStubDecoder(opts?: { freeStub?: boolean }): StubDecoderInstance
export function createReactiveClient(opts?: { freePipeline?: boolean }): ReactiveClientInstance
export function createBlockingClient(opts?: { freeBatch?: boolean }): BlockingClientInstance

export interface FeignCell {
  id: string
  messages: number
  processed: number
  lowLatency: boolean
  batchFriendly: boolean
  pipelineable: boolean
  fault: string
}
export interface FeignRow {
  protocol: 'StubDecoder' | 'ReactiveClient' | 'BlockingClient'
  scenarios: FeignCell[]
  trilemma: { lowLatency: boolean; batchFriendly: boolean; pipelineable: boolean }
  metrics: { totalProcessed: number; totalMessages: number }
}
export interface FeignCausalLocks {
  pipelineWriteFriendlyCausallyUnerasable: boolean
  stubNoNetworkCausallyUnerasable: boolean
  blockingPipelineAtomicityCausallyUnerasable: boolean
  causalLocksAllHold: boolean
}
export interface SpringFeignStudy {
  builtAt: number
  config: {
    seed: number
    messages: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    freeStub: boolean
    freePipeline: boolean
    freeBatch: boolean
  }
  rows: FeignRow[]
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
  causalLocks: FeignCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: {
      laneA: { stubProcessed: number; expected: number }
      laneB: { reactiveProcessed: number; expected: number }
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        stubShotgun: { holds: boolean; reason: string }
        reactiveTimeout: { holds: boolean; reason: string }
        blockingOverflow: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function springFeignStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  messages?: number
  scenarios?: readonly string[]
  freeStub?: boolean
  freePipeline?: boolean
  freeBatch?: boolean
  rigged?: boolean
}): SpringFeignStudy
export const compareSpringFeign: typeof springFeignStudy
export interface SpringFeignSnapshot extends Omit<SpringFeignStudy, 'causalLocks'> {
  causalLocks?: FeignCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function springFeignSnapshot(study: SpringFeignStudy | null | Record<string, never>): SpringFeignSnapshot | null
export function verifySpringFeignSoundness(input: {
  events?: Array<{ id: string; method: string; url: string; body?: any; retry?: boolean }>
  seed?: number
  messages?: number
  now?: number | (() => number)
}, opts?: { seed?: number; messages?: number }): SpringFeignStudy['crosscheck']['soundness']
export function verifyCausalLocks(cfg?: { seed?: number; messages?: number }): FeignCausalLocks
export function createSpringFeignEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
