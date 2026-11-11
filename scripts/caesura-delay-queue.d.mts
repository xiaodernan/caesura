/** `scripts/caesura-delay-queue.mjs` 的声明：延迟消息队列三协议教学状态机（KI-518）。 */

export const DQ_DEFAULTS: Readonly<Record<string, number | boolean>>
export const DQ_PROTOCOLS: readonly string[]
export const DQ_SCENARIOS: readonly string[]

export interface TimingWheelStats {
  scheduled: number
  cancelled: number
  fired: number
  lateMs: number
  tombstones: number
  idleTicks: number
  rescanSweeps: number
  tickMs: number
}

export interface TimingWheel {
  schedule(dueAt: number, payload?: unknown): number
  cancel(id: number): boolean
  advance(toTs: number): Array<{ id: number; dueAt: number; payload: unknown }>
  drainDue(): Array<{ id: number; dueAt: number; payload: unknown }>
  stats(): TimingWheelStats
  pending(): number
}

export interface MinHeapStats {
  scheduled: number
  cancelled: number
  fired: number
  comparisons: number
  tombstones: number
  lateMs: number
}

export interface MinHeapDelayQueue {
  schedule(dueAt: number, payload?: unknown): number
  cancel(id: number): boolean
  advance(toTs: number): Array<{ id: number; dueAt: number; payload: unknown }>
  drainDue(): Array<{ id: number; dueAt: number; payload: unknown }>
  stats(): MinHeapStats
  pending(): number
  peek(): { id: number; dueAt: number; payload: unknown } | null
}

export interface ZsetStats {
  scheduled: number
  cancelled: number
  fired: number
  lateMs: number
  idlePolls: number
  centerRounds: number
  duplicatePickups: number
  lostOnRestart: number
}

export interface RedisZsetDelayQueue {
  schedule(dueAt: number, payload?: unknown): number
  cancel(id: number): boolean
  poll(): Array<{ id: number; dueAt: number; payload: unknown }>
  restore(): { pending: number; lostOnRestart: number }
  stats(): ZsetStats
  backend: unknown
  setNow(v: number): void
}

export interface DelayQueueCell {
  id: string
  protocol: string
  fired: number
  lateMs: number
  duplicatePickups: number
  lostOnRestart: number
  opUnits: number
  lowCost: boolean
  punctual: boolean
  sharedDurable: boolean
}

export interface DelayQueueRow {
  protocol: string
  scenarios: DelayQueueCell[]
  totals: {
    fired: number
    lateMs: number
    duplicatePickups: number
    lostOnRestart: number
    opUnits: number
  }
  trilemma: { lowCost: boolean; punctual: boolean; sharedDurable: boolean }
}

export interface DelayQueueEvidence {
  hashRingNodes: number
  hashRingEmptyNodes: number
  redisEntries: number
  walLines: number
  busDelivered: number
  tokenBucketOk: boolean
  bplusRangeCount: number
  poolAcquired: number
}

export interface DelayQueueStudy {
  builtAt: number
  config: Record<string, number | boolean>
  rows: DelayQueueRow[]
  vectors: Record<'TimingWheel' | 'MinHeap' | 'RedisZset', string>
  topology: Record<'TimingWheel' | 'MinHeap' | 'RedisZset', string>
  crosscheck: { evidence: DelayQueueEvidence }
  verdict: {
    vectors: Record<'TimingWheel' | 'MinHeap' | 'RedisZset', string>
    trilemmaDistinguishes: boolean
    noProtocolWinsAll: boolean
    noUniversalWinner: boolean
    wheelCheapest: boolean
    wheelUnpunctual: boolean
    heapPunctual: boolean
    heapPaysComparisons: boolean
    heapRestartLoses: boolean
    zsetSharedDurable: boolean
    zsetPaysPollRtt: boolean
    zsetNonAtomicDuplicatePickups: boolean
    wheelRestartLoses: boolean
    timingWheelLosesOnRestart: boolean
    minHeapZeroLateMs: boolean
    redisZsetNeverSilentLossOnRestart: boolean
  }
  rigged: boolean
}

export interface DelayQueueSnapshot {
  builtAt: number
  config: DelayQueueStudy['config']
  rows: DelayQueueRow[]
  vectors: DelayQueueStudy['vectors']
  crosscheck: { evidence: DelayQueueEvidence }
  verdict: DelayQueueStudy['verdict']
  topology: DelayQueueStudy['topology']
}

export function createTimingWheel(opts?: { tickMs?: number; wheelSlots?: number; now?: number }): TimingWheel
export function createMinHeapDelayQueue(opts?: { now?: number }): MinHeapDelayQueue
export function createRedisZsetDelayQueue(opts?: { now?: number; pollIntervalMs?: number; backend?: unknown; atomicPick?: boolean }): RedisZsetDelayQueue
export function compareDelayQueue(opts?: Record<string, unknown>): DelayQueueStudy
export function delayQueueStudy(opts?: Record<string, unknown>): DelayQueueStudy
export function delayQueueSnapshot(study: DelayQueueStudy): DelayQueueSnapshot | null
export function createDelayQueueEvidence(opts?: Record<string, unknown>): DelayQueueEvidence
