/** `scripts/caesura-circuit-breaker.mjs` 的声明：Spring Cloud CircuitBreaker 三策略教学件（KI-537）。 */

export const CIRCUIT_DEFAULTS: Readonly<{
  seed: number
  calls: number
  windowSize: number
  failureThreshold: number
  failureRateThreshold: number
  slowCallRateThreshold: number
  slowThresholdMs: number
  perfectMonitoring: boolean
  unlimitedWindow: boolean
  instantRecovery: boolean
  rigged: boolean
}>
export const CIRCUIT_STRATEGIES: readonly string[]
export const CIRCUIT_SCENARIOS: readonly string[]

export interface CountBasedBreakerInstance {
  protocol: 'CountBasedBreaker'
  window: Array<{ durationMs: number; failed: boolean; slow: boolean }>
  state_machine: { readonly state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'; record(outcome: { durationMs?: number; failed?: boolean; slow?: boolean }): string }
  run(stream: Array<{ id?: string; durationMs?: number; failed?: boolean; slow?: boolean }>): { observed: number; trips: number; finalState: string; failureRate: number }
  footprint(): number
}
export interface RateBasedBreakerInstance {
  protocol: 'RateBasedBreaker'
  window: Array<{ durationMs: number; failed: boolean; slow: boolean }>
  state_machine: { readonly state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'; record(outcome: { durationMs?: number; failed?: boolean; slow?: boolean }): string }
  run(stream: Array<{ id?: string; durationMs?: number; failed?: boolean; slow?: boolean }>): { observed: number; trips: number; finalState: string; failureRate: number }
  footprint(): number
  minimumNumberOfCalls: number
}
export interface SlowCallBreakerInstance {
  protocol: 'SlowCallBreaker'
  window: Array<{ durationMs: number; failed: boolean; slow: boolean }>
  state_machine: { readonly state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'; record(outcome: { durationMs?: number; failed?: boolean; slow?: boolean }): string }
  run(stream: Array<{ id?: string; durationMs?: number; failed?: boolean; slow?: boolean }>): { observed: number; trips: number; finalState: string; slowRate: number }
  footprint(): number
}

export function createCountBasedBreaker(opts?: { seed?: number; windowSize?: number; failureThreshold?: number; openTicks?: number }): CountBasedBreakerInstance
export function createRateBasedBreaker(opts?: { seed?: number; windowSize?: number; failureRateThreshold?: number; minimumNumberOfCalls?: number; openTicks?: number }): RateBasedBreakerInstance
export function createSlowCallBreaker(opts?: { seed?: number; windowSize?: number; slowCallRateThreshold?: number; slowThresholdMs?: number; openTicks?: number }): SlowCallBreakerInstance

/** 三难三条独立考场真跑 trips 现算（零查表）。 */
export interface CircuitExam {
  hardFaultsAware: boolean
  degradedFaultsAware: boolean
  sparseTrafficSafe: boolean
  trips: { hard: number; degraded: number; sparse: number }
}
export interface CircuitCell {
  id: string
  calls: number
  trips: number
  failureRate?: number
  slowRate?: number
  finalState: string
  hardFaultsAware: boolean
  degradedFaultsAware: boolean
  sparseTrafficSafe: boolean
  exam: { hard: number; degraded: number; sparse: number }
  fault: string
}
export interface CircuitRow {
  protocol: 'CountBasedBreaker' | 'RateBasedBreaker' | 'SlowCallBreaker'
  scenarios: CircuitCell[]
  trilemma: { hardFaultsAware: boolean; degradedFaultsAware: boolean; sparseTrafficSafe: boolean }
  exam: CircuitExam
  metrics: { totalTrips: number; finalOpenCount: number }
}
export interface CircuitCausalLocks {
  countThresholdIgnoresSlowCausallyUnerasable: boolean
  rateThresholdRequiresSampleCausallyUnerasable: boolean
  slowCallIgnoresHardFaultsCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  probes: { countOnSlowTrips: number; rateWithMinTrips: number; rateWithoutMinTrips: number; slowOnHostileTrips: number }
}
export interface CircuitStudy {
  builtAt: number
  config: {
    seed: number
    calls: number
    windowSize: number
    failureThreshold: number
    failureRateThreshold: number
    slowCallRateThreshold: number
    slowThresholdMs: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    perfectMonitoring: boolean
    unlimitedWindow: boolean
    instantRecovery: boolean
  }
  rows: CircuitRow[]
  vectors: Record<string, string>
  verdict: {
    vectors: Record<string, string>
    noUniversalWinner: boolean
    trilemmaDistinguishes: boolean
    noStrategyWinsAll: boolean
    vectorFromTrilemma: boolean
    slowCallBlindToFailures: boolean
    countBlindToSlow: boolean
    rateSafeOnSparse: boolean
    rigged_pkg: boolean
    rigged_pkg_flags?: Record<string, boolean>
    riggedConvergenceCollapsed: boolean
    perfectMonitoringErasesFalsyPositives: boolean
    unlimitedWindowErasesStutteringFalseAlert: boolean
    instantRecoveryPreventsHalfOpenStuttering: boolean
    trilemmaCrosscheck: {
      examReadouts: Record<string, { vector: string; hard: number; degraded: number; sparse: number }>
      examVectorsMatchRows: boolean
      noStrategyWinsAll: boolean
      note: string
    }
    riggedEffects: {
      perfectMonitoring: { holds: boolean; noisyTrips: number; cleanTrips: number }
      unlimitedWindow: { holds: boolean; smallWindowTrips: number; largeWindowTrips: number }
      instantRecovery: { holds: boolean; slowRecoverTrips: number; fastRecoverTrips: number }
      note: string
    }
  }
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks: CircuitCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: {
      laneA: { steadyTrips: number; countTrips: number; rateTrips: number; slowTrips: number }
      laneB: { burstyCountTrips: number; burstyRateTrips: number; burstySlowTrips: number }
      invariants: { laneAOk: boolean; laneBOk: boolean }
      baselineHolds: boolean
      holds: boolean
      nontrivial: boolean
      falsifiable: boolean
      tamper: {
        forgedLatency: { holds: boolean; reason: string }
        silentFailuresIgnored: { holds: boolean; reason: string }
        emptyStream: { holds: boolean; nontrivial: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function circuitBreakerStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  calls?: number
  windowSize?: number
  failureThreshold?: number
  failureRateThreshold?: number
  slowCallRateThreshold?: number
  slowThresholdMs?: number
  scenarios?: readonly string[]
  perfectMonitoring?: boolean
  unlimitedWindow?: boolean
  instantRecovery?: boolean
  rigged?: boolean
}): CircuitStudy
export const compareCircuitBreaker: typeof circuitBreakerStudy

export interface CircuitSnapshot extends Omit<CircuitStudy, 'causalLocks'> {
  causalLocks?: CircuitCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function circuitBreakerSnapshot(study: CircuitStudy | null | Record<string, never>): CircuitSnapshot | null

export function verifyCircuitSoundness(input: {
  events?: Array<Record<string, any>>
  seed?: number
  now?: number | (() => number)
}, opts?: { seed?: number; calls?: number }): CircuitStudy['crosscheck']['soundness']

export function verifyCausalLocks(cfg?: { seed?: number; calls?: number }): CircuitCausalLocks

export function createCircuitEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
