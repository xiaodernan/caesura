/** `scripts/caesura-spring-load-balance.mjs` 的声明：Spring Cloud LoadBalancer 三策略教学件（KI-536）。 */

export const LB_DEFAULTS: Readonly<{
  seed: number
  requests: number
  virtualNodes: number
  capacity: number[]
  uniformLoad: boolean
  perfectRing: boolean
  unlimitedBudget: boolean
  rigged: boolean
}>
export const LB_STRATEGIES: readonly string[]
export const LB_SCENARIOS: readonly string[]

export interface WeightedRoundRobinInstance {
  protocol: 'WeightedRoundRobin'
  pick(): number
  run(requests: Array<{ id: string; clientId: string }>): { counts: Map<number, number>; picked: null[] }
  countsReset(): void
  footprint(): number
  unlimited(): boolean
}
export interface LeastConnectionsInstance {
  protocol: 'LeastConnections'
  pick(): number
  acquire(instance: number): void
  release(instance: number): void
  counters: number[]
  instanceCount: number
  footprint(): number
  unlimited(): boolean
}
export interface ConsistentHashInstance {
  protocol: 'ConsistentHash'
  ring: Array<{ hash: number; instance: number }>
  pick(clientId: string): { instance: number; ringHit: boolean }
  clientFingerprint(key: string, attend?: number): { key: string; instance: number; attend?: number }
  hash(key: string): number
  virtualNodes: number
  domination(): number
  footprint(): number
}
export function createWeightedRoundRobin(opts?: { seed?: number; capacity?: number[] }): WeightedRoundRobinInstance
export function createLeastConnections(opts?: { instanceCount?: number; seed?: number }): LeastConnectionsInstance
export function createConsistentHashRing(opts?: { seed?: number; virtualNodes?: number; instanceCount?: number; perfectRing?: boolean }): ConsistentHashInstance

export interface LbCell {
  id: string
  requests: number
  maxLoad: number
  minLoad: number
  skew: number
  stickyHits: number
  evenDistribution: boolean
  stickyAffinity: boolean
  stateFree: boolean
  fault: string
}
export interface LbRow {
  protocol: 'WeightedRoundRobin' | 'LeastConnections' | 'ConsistentHash'
  scenarios: LbCell[]
  trilemma: { evenDistribution: boolean; stickyAffinity: boolean; stateFree: boolean }
  metrics: { totalRequests: number; worstSkew: number; stickyHits: number }
}
export interface LbCausalLocks {
  roundRobinBlindToLoadCausallyUnerasable: boolean
  leastConnRequiresSharedCountersCausallyUnerasable: boolean
  consistentHashSkewCausallyUnerasable: boolean
  causalLocksAllHold: boolean
  // 真观测量（去尽恒真重言式后的可证伪判据支撑）
  rrDecisionInvariant: boolean          // 翻转热点标签平行流 pick 序列逐位恒同
  rrWeakGetsTraffic: boolean            // RR 仍给弱实例分流量（对容量差不减弱）
  lcWithCounters: number                // 装满 0 号后 pick 避开 0（=1）
  noSharedStateDegenerates: boolean     // 摘掉共享计数后 pick 恒退化到 0
  denseSkew: number                     // 密集环 max-min，佐证 skew 只能收敛不能归零
  probeSkew: { max: number; min: number; clients: number }
}
export interface SpringLoadBalanceStudy {
  builtAt: number
  config: {
    seed: number
    requests: number
    virtualNodes: number
    capacity: number[]
    scenarios: string[] | readonly string[]
    rigged: boolean
    uniformLoad: boolean
    perfectRing: boolean
    unlimitedBudget: boolean
  }
  rows: LbRow[]
  vectors: Record<string, string>
  verdict: {
    vectors: Record<string, string>
    noUniversalWinner: boolean
    trilemmaDistinguishes: boolean
    noStrategyWinsAll: boolean
    vectorFromTrilemma: boolean
    chStickyOutperformsRR: boolean
    stateFreeDegradesLC: boolean
    hashSkewPersists: boolean
    rigged_pkg: boolean
    riggedConvergenceCollapsed: boolean
    perfectRingErasesSkew: boolean
    unlimitedBudgetErasesLCNeed: boolean
    uniformLoadErasesHotspotSkew: boolean
    // 三难交叉印证：两维由真跑观测量支撑、一维是设计目标结构分类（如实标注，不谎称纯观测量现算）
    trilemmaCrosscheck: {
      stickyAffinityBackedByHits: boolean   // CH stickyHits>0 ∧ WRR/LC=0，与三难判定一致
      chMeasuredSkew: number                // CH 真跑 worstSkew 读数（暴露供核对）
      chEvenClaimHonest: boolean            // CH evenDistribution=true 时 skew<=1 才诚实
      stickyHitByProtocol: Record<string, number>
      worstSkewByProtocol: Record<string, number>
      stateFreeClassification: Record<string, boolean>
      note: string
    }
  }
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
  causalLocks: LbCausalLocks
  crosscheck: {
    evidence: Record<string, number>
    routing: RoutingSoundness
  }
  rigged: boolean
}

/** verifyRoutingSoundness：双路自证 + 三路真喂回可证伪；falsifiable 由 baseline.holds ∧ 三路 tamper 真红现算。 */
export interface RoutingSoundness {
  laneA: { stableClients: number; clients: number }
  laneB: { ringHits: number; probes: number; hitRate: number; skew: number }
  invariants: { laneAOk: boolean; laneBOk: boolean; hitRate: number; skew: number; stableClients: number; clients: number }
  baselineHolds: boolean
  holds: boolean
  nontrivial: boolean
  falsifiable: boolean
  tamper: {
    emptyRing: { holds: boolean; reason: string }
    silentAffinityDrop: { holds: boolean; reason: string }
    emptyEvents: { holds: boolean; nontrivial: boolean; reason: string }
  }
  events: number
}
export function springLoadBalanceStudy(opts?: {
  now?: number | (() => number)
  seed?: number
  requests?: number
  virtualNodes?: number
  capacity?: number[]
  scenarios?: readonly string[]
  uniformLoad?: boolean
  perfectRing?: boolean
  unlimitedBudget?: boolean
  rigged?: boolean
}): SpringLoadBalanceStudy
export const compareSpringLoadBalance: typeof springLoadBalanceStudy

export interface SpringLoadBalanceSnapshot extends Omit<SpringLoadBalanceStudy, 'causalLocks'> {
  causalLocks?: LbCausalLocks
  noUniversalWinner: boolean
  trilemmaDistinguishes: boolean
}
export function springLoadBalanceSnapshot(study: SpringLoadBalanceStudy | null | Record<string, never>): SpringLoadBalanceSnapshot | null

export function verifyRoutingSoundness(input?: {
  events?: Array<Record<string, any>>
  seed?: number
  virtualNodes?: number
  now?: number | (() => number)
}, opts?: { capacity?: number[]; seed?: number }): RoutingSoundness

export function verifyCausalLocks(cfg?: { seed?: number }): LbCausalLocks

export function createLbEvidence(opts?: { seed?: number; now?: number | (() => number) }): Record<string, number>
