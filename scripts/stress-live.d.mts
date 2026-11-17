/** scripts/stress-live.mjs 的类型声明（tsc 与 Vitest 共用；行为以源码为准） */
export function percentile(sorted: number[], p: number): number
export interface StressRoundSample {
  ok: boolean
  status: number
  bytes: number
  latencyMs: number
  error?: string
}
export interface StressRound {
  wallMs: number
  samples: StressRoundSample[]
}
export interface StressReport {
  total: number
  failures: number
  failureRate: number
  mean: number
  min: number
  p50: number
  p95: number
  p99: number
  max: number
  totalBytes: number
}
export function buildReport(rounds: StressRound[]): StressReport
