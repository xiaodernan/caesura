/** `scripts/caesura-retry-dlq.mjs` 的声明：消息重试退避与死信队列三协议教学状态机（KI-520）。 */

export const RDL_DEFAULTS: Readonly<Record<string, number | boolean>>
export const RDL_PROTOCOLS: readonly string[]
export const RDL_SCENARIOS: readonly string[]

export interface RetryPolicy {
  protocol: string
  nextDelay(msgId?: number): number
  delayFor(attempt: number, msgId?: number): number
  stats(): { attempts: number; [k: string]: number | string }
  reset(): void
}

export function createImmediateRetry(opts?: { minDelayTicks?: number }): RetryPolicy
export function createExponentialBackoff(opts?: { baseTicks?: number; capTicks?: number }): RetryPolicy
export function createFullJitterBackoff(opts?: { baseTicks?: number; capTicks?: number; seed?: number }): RetryPolicy

export interface RetryDlqCell {
  id: string
  protocol: string
  delivered: number
  retries: number
  deadLettered: number
  stormPerMsg: number
  herdPeaks: number
  herdRatio: number
  peakConcurrency: number
  recoveryLag: number
  fastRecovery: boolean
  noStorm: boolean
  noHerd: boolean
  fault: string
}

export interface RetryDlqRow {
  protocol: string
  scenarios: RetryDlqCell[]
  totals: {
    delivered: number
    retries: number
    deadLettered: number
    stormPerMsg: number
    herdPeaks: number
    recoveryLag: number
  }
  trilemma: { fastRecovery: boolean; noStorm: boolean; noHerd: boolean }
}

export interface RetryDlqEvidence {
  heapFired: number
  bucketAllowed: number
  bucketRejected: number
  walLines: number
  walReplayed: number
  hashRingNodes: number
  hashRingEmptyNodes: number
  idemEntries: number
  deadNotices: number
  busListeners: number
  poolAcquired: number
}

export interface RetryDlqStudy {
  builtAt: number
  config: Record<string, number | boolean | string | string[]>
  rows: RetryDlqRow[]
  vectors: Record<'Immediate' | 'Exponential' | 'FullJitter', string>
  topology: Record<'Immediate' | 'Exponential' | 'FullJitter', string>
  crosscheck: { evidence: RetryDlqEvidence }
  verdict: {
    vectors: Record<'Immediate' | 'Exponential' | 'FullJitter', string>
    trilemmaDistinguishes: boolean
    noUniversalWinner: boolean
    noProtocolWinsAll: boolean
    immediateFastest: boolean
    immediateStorms: boolean
    immediateHerds: boolean
    exponentialNoStorm: boolean
    exponentialHerds: boolean
    exponentialSlowRecovery: boolean
    fullJitterNoStorm: boolean
    fullJitterNoHerd: boolean
    fullJitterNotFreeLunch: boolean
    dlqLands: boolean
    dlqReleasedWhenNoBudget: boolean
    permanentOutageVacuousTrue: boolean
    noStormCausallyUnerasable: boolean
  }
  rigged: boolean
}

export interface RetryDlqSnapshot {
  builtAt: number
  config: RetryDlqStudy['config']
  rows: RetryDlqRow[]
  vectors: RetryDlqStudy['vectors']
  crosscheck: { evidence: RetryDlqEvidence }
  verdict: RetryDlqStudy['verdict']
  topology: RetryDlqStudy['topology']
}

export function compareRetryDlq(opts?: Record<string, unknown>): RetryDlqStudy
export function retryDlqStudy(opts?: Record<string, unknown>): RetryDlqStudy
export function retryDlqSnapshot(study: RetryDlqStudy): RetryDlqSnapshot | null
export function createRetryDlqEvidence(opts?: Record<string, unknown>): RetryDlqEvidence
