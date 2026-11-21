export interface StuffingDefaults {
  readonly attempts: number
  readonly concurrency: number
  readonly users: number
  readonly maxAttempts: number
  readonly windowMs: number
  readonly lockMs: number
  readonly seed: number
}
export declare const STUFFING_DEFAULTS: Readonly<StuffingDefaults>

export interface LoginAttemptResult {
  accepted: boolean
  reason: 'ok' | 'bad-password' | 'just-locked' | 'locked'
  remaining?: number
  remainingMs?: number
}
export interface LoginGuardStats {
  attempts: number
  failures: number
  locked: number
  accepted: number
  falseAccepts: number
  uniqueUsers: number
}
export interface LoginGuard {
  attempt(user: string, password: string): LoginAttemptResult
  stats(): LoginGuardStats
  advance(ms: number): void
  lockState(user: string): { locked: boolean; remainingMs: number }
}
export declare function createLoginGuard(opts?: {
  secret?: string
  maxAttempts?: number
  windowMs?: number
  lockMs?: number
  now?: number
  nowFn?: () => number
}): LoginGuard

export interface StuffingRun extends LoginGuardStats {
  attempts: number
  concurrency: number
  users: number
  reasons: Record<string, number>
  falseAccepts: number
  avgLatencyUs: number
  p50Us: number
  p95Us: number
  p99Us: number
  heapGrowthMb: number
  wallMs: number
  sound: boolean
}
export declare function runStuffing(opts?: {
  attempts?: number
  concurrency?: number
  users?: number
  seed?: number
  maxAttempts?: number
  windowMs?: number
  lockMs?: number
  rand?: () => number
  nowFn?: () => number
}): Promise<StuffingRun>

export interface StuffingSnapshot {
  attempts: number
  concurrency: number
  users: number
  accepted: number
  rejected: number
  falseAccepts: number
  sound: boolean
  avgLatencyUs: number
  p50Us: number
  p95Us: number
  p99Us: number
  heapGrowthMb: number
  wallMs: number
}
export declare function credentialStuffingSnapshot(run: StuffingRun): StuffingSnapshot
