/** `scripts/caesura-console-gen.mjs` 的声明：前端集大成控制台真 E2E 数据生成器（P8 / KI-495）。 */

export const SCENARIO_IDS: string[]
export const SCENARIO_TITLES: Record<string, string>

export interface ConsoleHighlights {
  services: number | null
  spanCount: number | null
  canaryHits: number | null
  cacheHitRate: number | null
  timedOut: number | null
  cwnd: number | null
  rto: number | null
}

export interface ConsoleScenario {
  id: string
  title: string
  ok: boolean
  [k: string]: any
}

export interface ConsoleSnapshot {
  schema: number
  generatedAt: number
  generator: string
  scenarios: ConsoleScenario[]
  highlights: ConsoleHighlights
}

export interface E2ERunner {
  run(): Promise<any>
  gc?: any
}

export function buildSnapshot(opts?: {
  runner?: (scenarioId: string) => E2ERunner
  now?: () => number
  driveNet?: boolean
}): Promise<ConsoleSnapshot>

export function realScenarioOpts(id: string): Record<string, any>

export function normalizeScenario(id: string, gc: any, r: any): ConsoleScenario

export function driveNetSeries(net: any): any | null

export function cwndSeries(history: any): Array<{ step: number; cwnd: number | null; event: string | null; mode: string | null }>

export function deriveHighlights(scenarios: ConsoleScenario[]): ConsoleHighlights
