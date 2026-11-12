/** `scripts/caesura-priority-queue.mjs` 的声明：有界优先级队列三策略诚实权衡教学件（KI-542）。 */

export const PRIORITY_DEFAULTS: Readonly<{
  seed: number
  messages: number
  capacity: number
  infiniteCapacity: boolean
  zeroVtimeAccounting: boolean
  infinitePriorityStarvation: boolean
  rigged: boolean
}>
export const PRIORITY_STRATEGIES: readonly string[]
export const PRIORITY_SCENARIOS: readonly string[]

export interface BoundedStrictQueueInstance {
  protocol: 'BoundedStrict'
  push(m: { id: string; priority: number; deadline?: number }): { ok: boolean; rejected?: boolean; size?: number }
  pop(): { id: string; priority: number; deadline?: number } | null
  peek(): { id: string; priority: number; deadline?: number } | null
  size(): number
  lowOverhead: boolean
  boundedUnfairness: boolean
  deadlineAwareness: boolean
}
export interface MotionWeightedFairQueueInstance {
  protocol: 'MotionWeightedFair'
  push(m: { id: string; priority: number; deadline?: number }): { ok: boolean; rejected?: boolean; size?: number }
  pop(): { id: string; priority: number; deadline?: number } | null
  peek(): { id: string; priority: number; deadline?: number } | null
  size(): number
  lowOverhead: boolean
  boundedUnfairness: boolean
  deadlineAwareness: boolean
}
export interface DeadlineSchedulerQueueInstance {
  protocol: 'DeadlineScheduler'
  push(m: { id: string; priority: number; deadline: number }): { ok: boolean; rejected?: boolean; size?: number }
  pop(): { id: string; priority: number; deadline: number } | null
  peek(): { id: string; priority: number; deadline: number } | null
  size(): number
  lowOverhead: boolean
  boundedUnfairness: boolean
  deadlineAwareness: boolean
}

export function createBoundedStrictQueue(opts?: { capacity?: number; infiniteCapacity?: boolean }): BoundedStrictQueueInstance
export function createMotionWeightedFairQueue(opts?: { capacity?: number; infiniteCapacity?: boolean; zeroVtimeAccounting?: boolean }): MotionWeightedFairQueueInstance
export function createDeadlineSchedulerQueue(opts?: { capacity?: number; infiniteCapacity?: boolean; infinitePriorityStarvation?: boolean }): DeadlineSchedulerQueueInstance

export interface PqCell {
  id: string
  messages: number
  pushed: number
  rejected: number
  heapOps: number
  lowOverhead: boolean
  boundedUnfairness: boolean
  deadlineAwareness: boolean
  fault: string
}
export interface PqRow {
  protocol: 'BoundedStrict' | 'MotionWeightedFair' | 'DeadlineScheduler'
  scenarios: PqCell[]
  trilemma: { lowOverhead: boolean; boundedUnfairness: boolean; deadlineAwareness: boolean }
  metrics: { totalPush: number; totalRejected: number; totalHeapOps: number }
}
export interface PqCausalLocks {
  strictStarvationCausallyUnerasable: boolean
  fairVtimeAccountingCausallyUnerasable: boolean
  deadlineBlindnessCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  probes?: Record<string, number>
}
export interface PriorityQueueStudy {
  builtAt: number
  config: {
    seed: number
    messages: number
    capacity: number
    scenarios: string[] | readonly string[]
    rigged: boolean
    infiniteCapacity: boolean
    zeroVtimeAccounting: boolean
    infinitePriorityStarvation: boolean
  }
  rows: PqRow[]
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
  causalLocks: PqCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    soundness: {
      laneA: { topPopPriority: number[] }
      laneB: { drainedViaVtime: boolean; fairInterleave: boolean }
      holds: boolean
      nontrivial: boolean
      falsifiable: true
      tamper: {
        starvationAnchor: { holds: boolean; reason: string }
        vtimeDrift: { holds: boolean; reason: string }
        deadlineBlind: { holds: boolean; reason: string }
      }
      events: number
    }
  }
  rigged: boolean
}
export function priorityQueueStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  messages?: number
  capacity?: number
  scenarios?: readonly string[]
  infiniteCapacity?: boolean
  zeroVtimeAccounting?: boolean
  infinitePriorityStarvation?: boolean
  rigged?: boolean
}): PriorityQueueStudy
export const comparePriorityQueue: typeof priorityQueueStudy
export interface PriorityQueueSnapshot extends Omit<PriorityQueueStudy, 'causalLocks'> {
  causalLocks?: PqCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function priorityQueueSnapshot(study: PriorityQueueStudy | null | Record<string, never>): PriorityQueueSnapshot | null
export function verifyPriorityScheduleSoundness(input: {
  events?: Array<{ id: string; priority: number; deadline?: number }>
  seed?: number
  messages?: number
  capacity?: number
  now?: number | (() => number)
}, opts?: { seed?: number; messages?: number; capacity?: number }): PriorityQueueStudy['crosscheck']['soundness']
export function verifyCausalLocks(cfg?: { seed?: number; messages?: number; capacity?: number }): PqCausalLocks
export function createPriorityQueueEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
