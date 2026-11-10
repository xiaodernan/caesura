/**
 * scripts/caesura-raft-consensus.d.mts —— KI-507 Raft 共识教学件的类型声明。
 *
 * 与 `caesura-raft-consensus.mjs` 的值导出**严格同名**（`decl-parity` 门逐枚对账，10 枚）：
 *   RAFT_DEFAULTS / RAFT_PROTOCOLS / RAFT_SCENARIOS /
 *   createRaftCluster / createMultiMaster / createGossipStore /
 *   runRaftScenario / compareRaftConsensus / raftConsensusStudy / rcSnapshot
 * 另导出纯类型（不参与值名册）：*Options / *Stats / *Snapshot / RaftVerdict 等。
 *
 * 判定权与阈值全在 Node 侧，这里只描述形状；前端只读 `rcSnapshot` 的纯数据渲染、不复核不实测。
 */

/** 缺省教学参数（节点集/反熵与复制轮数/内部随机种子）。 */
export const RAFT_DEFAULTS: Readonly<{
  nodes: readonly string[]
  antiEntropyRounds: number
  replicationRounds: number
  skipRounds: number
  seed: number
  zero: number
}>

/** 三协议枚举（短名作矩阵 key）。 */
export const RAFT_PROTOCOLS: readonly Readonly<{ id: string; short: string; label: string }>[]

/** 六类确定性故障场景（矩阵列）。 */
export const RAFT_SCENARIOS: readonly Readonly<{ id: string; label: string }>[]

/** 统一读数：三协议每格都收敛成这一形状，供 compare / 前端共用。 */
export interface RaftCellReading {
  protocol: string
  scenario: string
  label: string
  committed: boolean
  blockedWrites: number
  staleReads: number
  conflicts: number
  converged: boolean
  linearizable: boolean
  messages: number
  terms: number
  rounds: number
  detail: Record<string, any>
}

/** 故障注入：at 决定打哪个协议，key/skipRounds 决定打在哪。 */
export interface RaftFault {
  at?: 'allOk' | 'leaderElection' | 'networkPartition' | 'writeConflict' | 'replicationLag' | 'antiEntropyGap' | string
  key?: string
  concurrentValue?: string
  skipRounds?: number
  [k: string]: any
}

/** 一个故障场景。 */
export interface RaftScenario {
  id: string
  label?: string
  fault?: RaftFault
}

/** 通用集群选项（三协议共用）。 */
export interface ClusterOptions {
  nodes?: string[]
  now?: () => number
  rand?: () => number
  seed?: number
}

/* ---------------- ① Raft ---------------- */

export interface RaftElectionResult {
  elected: boolean
  term: number
  reason?: 'split-vote' | 'leader-completeness' | 'no-quorum'
  leader?: string | null
  votes?: number
  quorum?: number
  timeouts?: number[]
  lowestTimeoutNode?: string
  splitVoteDetected?: boolean
  resolvedByTimeout?: boolean
  lastLog?: { term: number; index: number }
  messages: number
}

export interface RaftAppendResult {
  committed: boolean
  blocked?: boolean
  rejected?: boolean
  reason?: string
  term: number
  index?: number
  commitIndex?: number
  appliedIndex?: number
  quorum?: number
  acks?: number
  messages: number
}

export interface RaftReadResult {
  ok: boolean
  rejected?: boolean
  blocked?: boolean
  reason?: string
  value?: any
  commitIndex?: number
  appliedIndex?: number
  linearizable?: boolean
  staleReads: number
  messages: number
}

export interface RaftStats {
  term: number
  role: string
  leader: string | null
  quorum: number
  nodes: number
  logLength: number
  commitIndex: number
  appliedIndex: number
  applied: number
  matchIndex: Record<string, number>
  nextIndex: Record<string, number>
  messages: number
  blockedWrites: number
  staleLeaderRejected: number
  nextIndexRetries: number
  rejectedReads: number
  leaderChanges: number
  converged: boolean
  linearizable: boolean
  termsSeen: number[]
  lastLog: { term: number; index: number }
}

export interface RaftCluster {
  elect(fo?: { leaderDown?: boolean; splitVote?: boolean; splitVoteResolved?: boolean; candidateStaleLog?: boolean; votesAvailable?: number }): RaftElectionResult
  append(cmd: { key: string; value: any } | any, fo?: { networkPartition?: boolean; logBehindAt?: number; staleLeader?: boolean; reason?: string }): RaftAppendResult
  read(key: string, fo?: { staleLeader?: boolean }): RaftReadResult
  stats(): RaftStats
  snapshot(t?: number): Record<string, any>
  reset(): void
  readonly term: number
  readonly role: string
  readonly leader: string | null
  readonly quorum: number
  readonly nodes: string[]
  readonly messages: number
}

export function createRaftCluster(opts?: ClusterOptions): RaftCluster

/* ---------------- ② 多主复制 ---------------- */

export interface ReplicatedStats {
  nodes: number
  writes: number
  staleReads: number
  blockedWrites: number
  conflicts: number
  messages: number
  replicateCalls: number
  converged: boolean
  convergenceBound: number | null
}

export interface MultiMasterWriteResult { ok: boolean; reason?: string; committed?: boolean; blockedWrites?: number; node?: string; key?: string; ver?: number; by?: string; messages?: number }
export interface MultiMasterReplicateResult { replicated: boolean; reason?: string; rounds: number; changed?: boolean; converged: boolean; messages: number }
export interface ReplicatedReadResult { ok: boolean; value: any; stale: boolean; staleReads: number; ver: number; lastWriteNode?: string | null }

export interface MultiMaster {
  write(node: string, key: string, val: any, fo?: { concurrentOn?: string; concurrentValue?: any }): MultiMasterWriteResult
  replicate(fo?: { lag?: boolean; rounds?: number }): MultiMasterReplicateResult
  read(node: string, key: string): ReplicatedReadResult
  converged(): boolean
  stats(): ReplicatedStats & { convergenceBound: number }
  snapshot(t?: number): Record<string, any>
  reset(): void
  readonly nodes: string[]
  readonly messages: number
  readonly conflicts: number
}

export function createMultiMaster(opts?: ClusterOptions): MultiMaster

/* ---------------- ③ Gossip ---------------- */

export interface GossipAntiEntropyResult { rounds: number; skipped: number; changed: boolean; converged: boolean; messages: number }

export interface GossipStore {
  write(node: string, key: string, val: any, fo?: { concurrentOn?: string; concurrentValue?: any }): MultiMasterWriteResult
  antiEntropy(fo?: { rounds?: number; skipRounds?: number }): GossipAntiEntropyResult
  read(node: string, key: string): ReplicatedReadResult
  converged(): boolean
  stats(): ReplicatedStats & { antiEntropyCalls: number; roundsRun: number; roundsSkipped: number; convergenceBound: null }
  snapshot(t?: number): Record<string, any>
  reset(): void
  readonly nodes: string[]
  readonly messages: number
  readonly conflicts: number
}

export function createGossipStore(opts?: ClusterOptions): GossipStore

/* ---------------- ④ 对照 ---------------- */

export interface CompareRaftOptions extends ClusterOptions {
  scenarios?: RaftScenario[]
  conflictKey?: string
  concurrentValue?: string
  lagKey?: string
  gapKey?: string
  skipRounds?: number
}

/** 三难向量：线性一致性 ∧ 分区可用性 ∧ 收敛确定性。 */
export interface TrilemmaVector {
  linearizable: boolean
  partitionAvailable: boolean
  boundedConvergence: boolean
}

export interface RaftMatrixCell {
  protocol: string
  label: string
  scenarios: Record<string, RaftCellReading>
  totals: { committed: number; blockedWrites: number; staleReads: number; conflicts: number; messages: number; diverged: number }
  trilemma: TrilemmaVector
}

export interface RaftVerdict {
  raftBlocksOnLeaderElection: boolean
  raftBlocksOnPartition: boolean
  raftNeverStale: boolean
  multiMasterPartitionAvailable: boolean
  multiMasterConflictsOnWrite: boolean
  multiMasterStaleOnLag: boolean
  gossipPartitionAvailable: boolean
  gossipStaleOnGap: boolean
  gossipDivergesOnGap: boolean
  trilemmaDistinguishes: boolean
  noProtocolWinsAll: boolean
  noUniversalWinner: boolean
}

export interface ConsensusComparison {
  generator: 'caesura-raft-consensus/compare'
  protocols: string[]
  scenarios: Array<{ id: string; label: string; fault: RaftFault }>
  /** 三协议各自的三难向量（如 101/011/010），前端可直读判词载体。 */
  trilemmaVectors: Record<string, string>
  matrix: Record<string, RaftMatrixCell>
  verdict: RaftVerdict
}

export function runRaftScenario(opts?: CompareRaftOptions & { protocol?: string; scenario?: RaftScenario }): RaftCellReading

export function compareRaftConsensus(opts?: CompareRaftOptions): ConsensusComparison

/* ---------------- ⑤ study / snapshot ---------------- */

export interface ElectionProbe {
  terms: number[]
  termMonotonic: boolean
  splitVoteDetected: boolean
  resolvedByTimeout: boolean
  noQuorumLeavesNoLeader: boolean
  leaderCompleteness: boolean
}

export interface ReplicationProbe {
  committed: boolean
  commitIndex: number
  appliedIndex: number
  orderedApply: boolean
  nextIndexRetried: boolean
  minorityBlocked: boolean
  staleLeaderRejected: boolean
  stats: RaftStats
}

export interface SafetyProbe {
  termAdvanced: boolean
  staleWriteRejected: boolean
  staleReadRejected: boolean
  noSplitBrainWrite: boolean
  stateMachine: boolean
}

export interface GossipProbe {
  convergesClean: boolean
  cleanReadFresh: boolean
  gapNotConverged: boolean
  gapReadStale: boolean
  noBound: boolean
  roundsRun: number
  roundsSkipped: number
}

export interface RaftConsensusStudy {
  generator: 'caesura-raft-consensus'
  comparison: ConsensusComparison
  election: ElectionProbe
  replication: ReplicationProbe
  safety: SafetyProbe
  gossip: GossipProbe
  verdict: RaftVerdict & {
    electionTermsMonotonic: boolean
    electionBreaksTieByTimeout: boolean
    electionLeaderCompleteness: boolean
    replicationOrderedApply: boolean
    replicationNextIndexRetry: boolean
    safetyNoSplitBrainWrite: boolean
    gossipConvergesClean: boolean
    gossipNoConvergenceBound: boolean
  }
  builtAt: number
}

export interface RaftSnapshotRow {
  protocol: string
  label: string
  trilemma: TrilemmaVector
  totals: RaftMatrixCell['totals']
  scenarios: Array<RaftCellReading & { label: string }>
}

export interface RaftSnapshot {
  config: { protocols: string[]; scenarios: Array<{ id: string; label: string }> }
  rows: RaftSnapshotRow[]
  election: ElectionProbe
  replication: ReplicationProbe
  safety: SafetyProbe
  gossip: GossipProbe
  verdict: RaftConsensusStudy['verdict']
  builtAt: number
}

export function raftConsensusStudy(opts?: CompareRaftOptions): RaftConsensusStudy

/** 把 study 收敛成前端 / status 友好的只读结构；null 入参诚实降级为 null。 */
export function rcSnapshot(study: RaftConsensusStudy | null | undefined): RaftSnapshot | null
