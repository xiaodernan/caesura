/** `scripts/caesura-consumer-group.mjs` 的声明：消费者组 rebalance / 分区所有权三协议教学状态机（KI-523）。 */

export const CGP_DEFAULTS: Readonly<Record<string, number | boolean | string>>
export const CGP_PROTOCOLS: readonly string[]
export const CGP_SCENARIOS: readonly string[]

export interface ConsumerAssignment {
  [partitionKey: string]: string
}
export interface AssignmentOp {
  n: number
}
export interface ConsumerGroupAssignor {
  protocol: string
  assign(
    consumers: string[],
    topics: string[],
    partsPerTopic: Record<string, number>,
    subs: Record<string, string[]>,
    prev: ConsumerAssignment | null,
    op: AssignmentOp,
  ): ConsumerAssignment
}

export function createRangeAssignor(opts?: Record<string, unknown>): ConsumerGroupAssignor
export function createRoundRobinAssignor(opts?: Record<string, unknown>): ConsumerGroupAssignor
export function createStickyAssignor(opts?: { balanceRounds?: number }): ConsumerGroupAssignor

export interface ConsumerGroupCell {
  id: string
  protocol: string
  consumers: number
  partitions: number
  imbalance: number
  starved: boolean
  moveRate: number
  opUnits: number
  opPerPart: number
  loads: number[]
  fault: string
  balanced: boolean
  minimalMovement: boolean
  cheap: boolean
}

export interface ConsumerGroupRow {
  protocol: 'Range' | 'RoundRobin' | 'Sticky'
  scenarios: ConsumerGroupCell[]
  trilemma: { balanced: boolean; minimalMovement: boolean; cheap: boolean }
  metrics: { avgImbalance: number; starved: boolean; moveSum: number; opPerPart: number }
}

export interface ConsumerGroupEvidence {
  remapConsistentRate: number
  remapModuloRate: number
  remapSavedRate: number
  routerMoved: number
  routerRate: number
  hashRingNodes: number
  hashRingEmptyNodes: number
  walLines: number
  walReplayed: number
  rebalanceNotices: number
  busListeners: number
  groupMetaEntries: number
  poolAcquired: number
  bucketAllowed: number
  bucketRejected: number
  heapFired: number
}

export interface ConsumerGroupStudy {
  builtAt: number
  config: Record<string, number | boolean | string | string[]>
  rows: ConsumerGroupRow[]
  vectors: Record<'Range' | 'RoundRobin' | 'Sticky', string>
  topology: Record<'Range' | 'RoundRobin' | 'Sticky', string>
  crosscheck: { evidence: ConsumerGroupEvidence }
  verdict: {
    vectors: Record<'Range' | 'RoundRobin' | 'Sticky', string>
    trilemmaDistinguishes: boolean
    noUniversalWinner: boolean
    noProtocolWinsAll: boolean
    rangeCheapest: boolean
    rangeSkews: boolean
    roundRobinBalanced: boolean
    roundRobinMigrates: boolean
    stickyBalanced: boolean
    stickyMinimalMovement: boolean
    stickyNotFreeLunch: boolean
    zeroMovementStarvesJoiner: boolean
    minimalMovementCausallyUnerasable: boolean
    steadyStateVacuousTrue: boolean
  }
  rigged: boolean
}

export interface ConsumerGroupSnapshot {
  builtAt: number
  config: ConsumerGroupStudy['config']
  rows: ConsumerGroupRow[]
  vectors: ConsumerGroupStudy['vectors']
  crosscheck: { evidence: ConsumerGroupEvidence }
  verdict: ConsumerGroupStudy['verdict']
  topology: ConsumerGroupStudy['topology']
}

export function compareConsumerGroup(opts?: Record<string, unknown>): ConsumerGroupStudy
export function consumerGroupStudy(opts?: Record<string, unknown>): ConsumerGroupStudy
export function consumerGroupSnapshot(study: ConsumerGroupStudy): ConsumerGroupSnapshot | null
export function createConsumerGroupEvidence(opts?: Record<string, unknown>): ConsumerGroupEvidence
