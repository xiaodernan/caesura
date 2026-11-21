/** `scripts/lib/llm-router.mjs` 的声明：LLM 驱动的条件路由判据内核（可注入、可证伪、零网络）。 */

export const BRANCHES: readonly string[]
export const FALLBACK: string
export const TRILEMMA: readonly string[]
export const TAMPER_MODES: readonly string[]
export const DEFAULT_STATES: readonly RouterState[]

export interface RouterState {
  id: string
  tension: number
  threads: number
  lastKind: string
  anchors: string[]
  [key: string]: unknown
}

export interface Decision {
  next: string | null
  reason: string
  canon: string
  valid: boolean
  source: string
  error?: string | null
  status?: number | null
}

export interface RouteRow {
  id: string
  next: string
  reason: string
  canon: string
  source: string
  valid: boolean
}

export interface StrategyResult {
  strategy: string
  key: string
  llmCalls: number
  stateResponsive: boolean
  canonGrounded: boolean
  auditable: boolean
  distinctBranches: number
}

export interface RouteStudy {
  states: number
  branches: string[]
  dims: string[]
  strategies: StrategyResult[]
  rows: { LLMDecided: RouteRow[]; ConstantBaseline: RouteRow[] }
  tamper: string
  rigged: boolean
  riggedConvergenceCollapsed: boolean
  falsifiable: boolean
  noUniversalWinner: boolean
}

export interface RouterSnapshot {
  generatedAt: number
  states: number
  branches: string[]
  dims: string[]
  strategies: StrategyResult[]
  tamper: string
  rigged: boolean
  riggedConvergenceCollapsed: boolean
  falsifiable: boolean
  noUniversalWinner: boolean
}

export type RouterCall = (args: { state: RouterState; branches: string[] }) => unknown | Promise<unknown>

export function normalizeDecision(raw: unknown, branches?: readonly string[]): Decision
export function decideNext(opts: { state: RouterState; call: RouterCall; branches?: readonly string[]; fallback?: string }): Promise<Decision>
export function fixtureCall(args?: { state?: RouterState; branches?: string[] }): Decision | Record<string, unknown>
export function routeStudy(opts?: { states?: RouterState[]; call?: RouterCall; branches?: readonly string[]; fallback?: string; tamper?: string; rigged?: boolean }): Promise<RouteStudy>
export function routerSnapshot(study: RouteStudy, now?: number): RouterSnapshot
