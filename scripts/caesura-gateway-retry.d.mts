/** `scripts/caesura-gateway-retry.mjs` —— Spring Cloud Gateway Retry 三策略教学件（KI-550） */

export const GATEWAY_RETRY_DEFAULTS: Readonly<{
  seed: number
  messages: number
  freeBudget: boolean
  freeConvoy: boolean
  freeTail: boolean
  rigged: boolean
}>
export const GATEWAY_RETRY_STRATEGIES: readonly string[]
export const GATEWAY_RETRY_SCENARIOS: readonly string[]

export interface ImmediateRetryInstance {
  protocol: 'ImmediateRetry'
  invoke(reqs: any[]): { processed: number; backlogSize: number }
  amplification: boolean
  budgetBoundedness: boolean
  tailAvoidance: boolean
}
export interface FixedBackoffInstance {
  protocol: 'FixedBackoff'
  invoke(reqs: any[]): { processed: number; maxBackoffTicks: number }
  amplification: boolean
  budgetBoundedness: boolean
  tailAvoidance: boolean
}
export interface ExponentialFullJitterInstance {
  protocol: 'ExponentialFullJitter'
  invoke(reqs: any[]): { processed: number; jitterSpread: number }
  amplification: boolean
  budgetBoundedness: boolean
  tailAvoidance: boolean
}
export function createImmediateRetry(opts?: { freeBudget?: boolean }): ImmediateRetryInstance
export function createFixedBackoff(opts?: { freeConvoy?: boolean }): FixedBackoffInstance
export function createExponentialFullJitter(opts?: { freeTail?: boolean }): ExponentialFullJitterInstance

export interface GatewayRetryCell {
  id: string
  messages: number
  processed: number
  amplification: boolean
  budgetBoundedness: boolean
  tailAvoidance: boolean
  fault: string
}
export interface GatewayRetryRow {
  protocol: 'ImmediateRetry' | 'FixedBackoff' | 'ExponentialFullJitter'
  scenarios: GatewayRetryCell[]
  trilemma: { amplification: boolean; budgetBoundedness: boolean; tailAvoidance: boolean }
  metrics: { totalProcessed: number; totalMessages: number }
}
export interface GatewayRetryCausalLocks {
  immediateSaturationCausallyUnerasable: boolean
  fixedBackoffConvoyCausallyUnerasable: boolean
  exponentialJitterTailCausallyUnerasable: boolean
  causalLocksAllHold: boolean
}
export interface GatewayRetryStudy {
  builtAt: number
  config: {
    seed: number
    messages: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    freeBudget: boolean
    freeConvoy: boolean
    freeTail: boolean
  }
  rows: GatewayRetryRow[]
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
  causalLocks: GatewayRetryCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: {
      laneA: { immediateProcessed: number; expected: number }
      laneB: { jitterProcessed: number; jitterSpread: number; expected: number }
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        immediateSaturates: { holds: boolean; reason: string }
        fixedBackoffSync: { holds: boolean; reason: string }
        exponentialTailRate: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function gatewayRetryStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  messages?: number
  scenarios?: readonly string[]
  freeBudget?: boolean
  freeConvoy?: boolean
  freeTail?: boolean
  rigged?: boolean
}): GatewayRetryStudy
export const compareGatewayRetry: typeof gatewayRetryStudy
export interface GatewayRetrySnapshot extends Omit<GatewayRetryStudy, 'causalLocks'> {
  causalLocks?: GatewayRetryCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function gatewayRetrySnapshot(study: GatewayRetryStudy | null | Record<string, never>): GatewayRetrySnapshot | null
export function verifyGatewayRetrySoundness(input: {
  events?: Array<{ id: string; key: string; attempt: number; timeout: boolean }>
  seed?: number
  messages?: number
  now?: number | (() => number)
}, opts?: { seed?: number; messages?: number }): GatewayRetryStudy['crosscheck']['soundness']
export function verifyCausalLocks(cfg?: { seed?: number; messages?: number }): GatewayRetryCausalLocks
export function createGatewayRetryEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
