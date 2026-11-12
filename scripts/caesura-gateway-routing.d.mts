/** `scripts/caesura-gateway-routing.mjs` 的声明：Spring Cloud Gateway 三策略路由教学件（KI-539）。 */

export const GR_DEFAULTS: Readonly<{
  seed: number
  requests: number
  perfectGlobMatcher: boolean
  regexProfiling: boolean
  headerFallbackOnMiss: boolean
  rigged: boolean
}>
export const GR_STRATEGIES: readonly string[]
export const GR_SCENARIOS: readonly string[]

export interface PathPrefixRoutingInstance {
  protocol: 'PathPrefixRouting'
  pick(req: { path: string; method?: string; headers?: Record<string, string> }): { routeId: string; uri: string | null }
  run(stream: Array<Record<string, any>>): { hits: number; routesHit: Map<string, number>; total: number }
  footprint(): number
}
export interface RegexCaptureRoutingInstance {
  protocol: 'RegexCaptureRouting'
  pick(req: { path: string }): { routeId: string; uri: string | null; flavor?: string; id?: number }
  run(stream: Array<Record<string, any>>): { hits: number; flavors: number; flavorsUsed: number; cacheHits: number; total: number }
  regex: RegExp
  footprint(): number
}
export interface HeaderGroupRoutingInstance {
  protocol: 'HeaderGroupRouting'
  pick(req: any, requested?: string): { routeId: string; uri: string | null }
  run(stream: Array<Record<string, any>>): { hits: number; groups: { groupA: number; groupB: number; miss: number }; miss: number; total: number }
  groupHeader: string
  mode: string
  footprint(): number
}

export function createPathPrefixRouting(opts?: { seed?: number; bigRouteTable?: boolean; conflictingRoutes?: boolean }): PathPrefixRoutingInstance
export function createRegexCaptureRouting(opts?: Record<string, any>): RegexCaptureRoutingInstance
export function createHeaderGroupRouting(opts?: { groupHeader?: string; fallback?: boolean }): HeaderGroupRoutingInstance

export interface GrCell {
  id: string
  requests: number
  hits: number
  miss: number
  strictMatch: boolean
  capturePower: boolean
  debugFriendly: boolean
  fault: string
}
export interface GrRow {
  protocol: 'PathPrefixRouting' | 'RegexCaptureRouting' | 'HeaderGroupRouting'
  scenarios: GrCell[]
  trilemma: { strictMatch: boolean; capturePower: boolean; debugFriendly: boolean }
  metrics: { totalHits: number; strictCells: number; powerCells: number }
}
export interface GrCausalLocks {
  pathPrefixMatchingConflictsCausallyUnerasable: boolean
  regexCaptureExtraCostCausallyUnerasable: boolean
  headerGroupHeaderDependencyCausallyUnerasable: boolean
  causalLocksAllHold: boolean
}
export interface GatewayRoutingStudy {
  builtAt: number
  config: {
    seed: number
    requests: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    perfectGlobMatcher: boolean
    regexProfiling: boolean
    headerFallbackOnMiss: boolean
  }
  rows: GrRow[]
  vectors: Record<string, string>
  verdict: {
    vectors: Record<string, string>
    noUniversalWinner: boolean
    trilemmaDistinguishes: boolean
    noStrategyWinsAll: boolean
    vectorFromTrilemma: boolean
    pathFindsHashMiss: boolean
    regexDistinguishesLabs: boolean
    headerGroupNotPowered: boolean
    rigged_pkg: boolean
    rigged_pkg_flags?: Record<string, boolean>
    riggedConvergenceCollapsed: boolean
    perfectGlobMatchErasesPrefixBurden: boolean
    regexProfilingErasesDebugBurden: boolean
    headerFallbackForcesDebuggability: boolean
  }
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks: GrCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    routing: {
      laneA: { pathPrefixHits: number; total: number }
      laneB: { capturedUnique: number; total: number }
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        missingRoutes: { holds: boolean; reason: string }
        tryStrTruncation: { holds: boolean; reason: string }
        emptyStream: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function gatewayRoutingStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  requests?: number
  scenarios?: readonly string[]
  perfectGlobMatcher?: boolean
  regexProfiling?: boolean
  headerFallbackOnMiss?: boolean
  rigged?: boolean
}): GatewayRoutingStudy
export const compareGatewayRouting: typeof gatewayRoutingStudy

export interface GatewayRoutingSnapshot extends Omit<GatewayRoutingStudy, 'causalLocks'> {
  causalLocks?: GrCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function gatewayRoutingSnapshot(study: GatewayRoutingStudy | null | Record<string, never>): GatewayRoutingSnapshot | null

export function verifyGatewayRoutingSoundness(input: {
  events?: Array<Record<string, any>>
  seed?: number
  now?: number | (() => number)
}, opts?: { seed?: number }): GatewayRoutingStudy['crosscheck']['routing']

export function verifyCausalLocks(cfg?: { seed?: number; requests?: number }): GrCausalLocks

export function createGatewayRoutingEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
