/**
 * 类型声明 · caesura-gateway-filters（KI-563）
 * 保持与 .mjs 的命名、参数顺序、返回形状一致。
 */

export const GATEWAY_FILTERS_DEFAULTS: {
  readonly seed: number
  readonly messages: number
  readonly capacity: number
  readonly refillPerSec: number
  readonly failureThreshold: number
  readonly cooldownTicks: number
  readonly halfOpenMax: number
  readonly rigged: false
}
export const GATEWAY_FILTERS_STRATEGIES: readonly ['OrderedChain', 'RateLimitGatewayFilter', 'CircuitBreakerGatewayFilter']
export const GATEWAY_FILTERS_SCENARIOS: readonly ['normalTraffic', 'burstOverload', 'downstreamOutage', 'cleanRerun']

export interface FilterRegistration {
  name: string
  order: number
}
export const FILTER_REGISTRY: ReadonlyArray<FilterRegistration>

export interface FilterChain {
  pre: string[]
  post: string[]
  combined: string[]
}
export function buildFilterChain(registrations?: ReadonlyArray<FilterRegistration>): FilterChain
export function evaluateOnionChain(registrations?: ReadonlyArray<FilterRegistration>): string[]

export interface RateLimitGateOptions {
  capacity?: number
  refillPerSec?: number
  now?: number
}
export interface RateLimitGate {
  capacity: number
  refillPerSec: number
  allow(): boolean
  stats(): Record<string, any>
}
export function createRateLimitGate(opts?: RateLimitGateOptions): RateLimitGate

export interface BreakerGateOptions {
  failureThreshold?: number
  cooldownTicks?: number
  halfOpenMax?: number
}
export interface BreakerCallResult {
  ok: boolean
  reason?: string
}
export interface BreakerGate {
  readonly state: 'CLOSED' | 'HALF_OPEN' | 'OPEN'
  readonly metrics: { state: string; failures: number; successes: number; rejects: number; openAtTick: number }
  tick(n?: number): void
  call(fn: () => unknown, ticks?: number): BreakerCallResult
}
export function createBreakerGate(opts?: BreakerGateOptions): BreakerGate

export interface GatewayFiltersTrilemma {
  orderedCorrect: boolean
  rateLimited: boolean
  circuitBroken: boolean
}
export interface GatewayFiltersStrategy {
  protocol: 'OrderedChain' | 'RateLimitGatewayFilter' | 'CircuitBreakerGatewayFilter'
  trilemma(): GatewayFiltersTrilemma
  capability: GatewayFiltersTrilemma
  opts: Record<string, unknown>
}
export function createOrderedChain(opts?: Record<string, unknown>): GatewayFiltersStrategy
export function createRateLimitGatewayFilter(opts?: Record<string, unknown>): GatewayFiltersStrategy
export function createCircuitBreakerGatewayFilter(opts?: Record<string, unknown>): GatewayFiltersStrategy

export interface GatewayScenarioCell {
  id: 'normalTraffic' | 'burstOverload' | 'downstreamOutage' | 'cleanRerun'
  messages: number
  processed: number
  matched: number
  state: 'hit' | 'miss'
  fault: string
}
export interface GatewayScenarioRow {
  protocol: 'OrderedChain' | 'RateLimitGatewayFilter' | 'CircuitBreakerGatewayFilter'
  scenarios: GatewayScenarioCell[]
  trilemma: GatewayFiltersTrilemma
  metrics: { stateHits: number }
}

export interface GatewayFiltersStudyOptions {
  seed?: number
  messages?: number
  freeOrderedCorrect?: boolean
  freeRateLimited?: boolean
  freeCircuitBroken?: boolean
  rigged?: boolean
  now?: () => number
}

export interface GatewayFiltersVerdict {
  vectors: Record<string, string>
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  scenarioDistinguishes: boolean
  noStrategyWinsAll: boolean
  vectorFromTrilemma: boolean
  rigged: boolean
  rigged_pkg_flags: Record<string, boolean>
  riggedConvergenceCollapsed: boolean
}

export interface GatewayFiltersCausalLocks {
  onionWrapperCausallyUnerasable: boolean
  bucketThroughputCausallyUnerasable: boolean
  halfOpenRecoveryCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  probes: {
    preFirst: string
    handlerAt: number
    burstAllowed: number
    openedAtFive: boolean
    rejectedWhileOpen: boolean
    closedAgain: boolean
  }
}

export interface GatewayFiltersLaneA {
  orderedCorrect: boolean
  sawHandler: boolean
  securityBeforeRewrite: boolean
  seqHash: number
}
export interface GatewayFiltersLaneB {
  allowed: number
  rejected: number
  capacity: number
  burst: number
  holds: boolean
}
export interface GatewayFiltersLaneC {
  state: string
  opened: boolean
  rejectedInOpen: number
  afterCooldown: string
  closedAgain: boolean
  holds: boolean
}
export interface GatewayFiltersTamperResult {
  holds: boolean
  reason: string
}
export interface GatewayFiltersSoundness {
  laneA: GatewayFiltersLaneA
  laneB: GatewayFiltersLaneB
  laneC: GatewayFiltersLaneC
  baselineHolds: boolean
  holds: boolean
  nontrivial: boolean
  falsifiable: boolean
  tamper: {
    reorderedFilter: GatewayFiltersTamperResult
    overdraftBucket: GatewayFiltersTamperResult
    alwaysClosed: GatewayFiltersTamperResult
  }
  events: string[]
}

export interface GatewayFiltersEvidence {
  routerMoved: number
  routerTracked: number
  ringNodes: number
  ringShardsUsed: number
  walLines: number
  walReplayed: number
  notices: number
  busListeners: number
  redisBitmapHits: number
  redisSlots: number
  poolCreated: number
  poolReused: number
  bucketAllowed: number
  bucketRejected: number
  heapFired: number
  heapPending: number
  counterSum: number
  counterFalseSharing: number
  jitterSpread: number
  remapConsistentRate: number
  remapModuloRate: number
}

export interface GatewayFiltersCrosscheck {
  evidence: GatewayFiltersEvidence
  soundness: GatewayFiltersSoundness
}

export interface GatewayFiltersStudy {
  builtAt: number
  config: {
    seed: number
    messages: number
    freeOrderedCorrect: boolean
    freeRateLimited: boolean
    freeCircuitBroken: boolean
    rigged: boolean
  }
  rows: GatewayScenarioRow[]
  vectors: Record<string, string>
  verdict: GatewayFiltersVerdict
  causalLocks: GatewayFiltersCausalLocks
  crosscheck: GatewayFiltersCrosscheck
  rigged: boolean
}

export function gatewayFiltersStudy(opts?: GatewayFiltersStudyOptions): GatewayFiltersStudy
export const compareGatewayFilters: typeof gatewayFiltersStudy
export const compareGatewayFilterChain: typeof gatewayFiltersStudy

export interface GatewayFiltersSnapshot {
  builtAt: number
  config: GatewayFiltersStudy['config']
  rows: GatewayScenarioRow[]
  vectors: Record<string, string>
  verdict: GatewayFiltersVerdict
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  scenarioDistinguishes: boolean
  noStrategyWinsAll: boolean
  causalLocks: GatewayFiltersCausalLocks
  crosscheck: GatewayFiltersCrosscheck
  rigged: boolean
}
export function gatewayFiltersSnapshot(study?: GatewayFiltersStudy): GatewayFiltersSnapshot

export function verifyGatewayFiltersSoundness(
  input?: { seed?: number; messages?: number },
  opts?: { seed?: number; messages?: number },
): GatewayFiltersSoundness

export function verifyCausalLocks(): GatewayFiltersCausalLocks

export function createGatewayFiltersEvidence(opts?: {
  seed?: number
  freeOrderedCorrect?: boolean
  freeRateLimited?: boolean
  freeCircuitBroken?: boolean
  rigged?: boolean
  now?: () => number
}): GatewayFiltersEvidence
