/** `scripts/caesura-log-compaction.mjs` 的声明：append-only 日志压缩与回放边界三策略诚实权衡教学状态机（KI-526）。 */

export const LC_DEFAULTS: Readonly<{
  seed: number
  ops: number
  keySpace: number
  retentionOps: number
  retentionMs: number
  deleteRetention: number
  snapshotAt: number
  footprintBudget: number
  replayBudget: number
  unlimitedRetention: boolean
  instantSnapshot: boolean
  zeroReplayCost: boolean
  rigged: boolean
}>
export const LC_STRATEGIES: readonly string[]
export const LC_SCENARIOS: readonly string[]

/** Size/Time Retention 引擎：超保留窗口删最老段，replay(from) 真算 missingOps。 */
export interface SizeTimeRetentionEngine {
  append(rec: { lsn: number; ts: number; op: string; key: string; value: unknown }): number
  compact(currentLsn: number, tsNow: number): { compactedOps: number; retainedOps: number; cutoffLsn: number; cutoffTs: number }
  replay(replayFromLsn: number): { replayOps: number; missingOps: number; complete: boolean; firstServedLsn: number }
  state(): {
    retainedOps: number; oldestLsn: number; newestLsn: number; writeAmplification: number
    entries(): Array<Record<string, unknown>>
  }
}
export function createSizeTimeRetention(opts?: { retentionOps?: number; retentionMs?: number }): SizeTimeRetentionEngine

/** Key Compaction 引擎：同 key 只留最新 put + tombstone；delete-retention 边界早清 tombstone 致复活。 */
export interface KeyCompactionEngine {
  append(rec: { lsn: number; ts: number; op: string; key: string; value: unknown }): number
  compact(currentLsn: number): { compactedOps: number; retainedOps: number; tombstoneCleared: number; resurrect: boolean }
  replay(): { replayOps: number; distinctKeys: number; tombstones: number; complete: boolean; resurrectedKeys: number }
  state(): {
    retainedOps: number; distinctKeys: number; tombstones: number; writeAmplification: number
    entries(): { latest: Array<[string, unknown]>; tombstones: Array<[string, number]> }
  }
}
export function createKeyCompaction(opts?: { deleteRetention?: number }): KeyCompactionEngine

/** Snapshot + 增量 WAL 引擎：按 LSN 去重重放折叠段 + 增量保 exactly-once；空快照令去重失效、全量重放。 */
export interface SnapshotPlusWalEngine {
  append(rec: { lsn: number; ts: number; op: string; key: string; value: unknown }): number
  takeSnapshot(lsn: number): { snapshotLsn: number; snapshotKeys: number; walRetained: number; foldedCount: number }
  replay(): {
    replayOps: number; replayedRaw: number; replayedUnique: number; dedupSkipped: number
    complete: boolean; exactlyOnce: boolean; materializedKeys: number
  }
  state(): {
    totalOps: number; snapshotLsn: number; snapshotEmpty: boolean; walRetained: number
    writeAmplification: number; entries(): Array<Record<string, unknown>>
  }
}
export function createSnapshotPlusWal(opts?: { snapshotAt?: number; instantSnapshot?: boolean }): SnapshotPlusWalEngine

/** 回放边界双路守恒自证（纯函数，可独立证伪）：A 成本守恒 + B 完整性守恒（相对回放位点、按 mode 分派）。 */
export interface ReplayBoundaryReading {
  mode: 'retention' | 'key' | 'snapshot'
  totalOps: number
  compactedOps: number
  replayOps: number
  foldedOps: number
  minReplay: number
  costGap: number
  snapshotLsn: number
  currentLsn: number
  walFromLsn: number
  walToLsn: number
  replayFromLsn: number
  distinctKeys: number
  tombstoneCleared: boolean
  resurrected: boolean
  walCovers: boolean
  replayCostConserved: boolean
  replayComplete: boolean
  nontrivial: boolean
  holds: boolean
}
export function verifyReplayBoundary(a: {
  mode?: string
  totalOps?: number
  compactedOps?: number
  replayOps?: number
  currentLsn?: number
  snapshotLsn?: number
  hasSnapshot?: boolean
  walFromLsn?: number
  walToLsn?: number
  replayFromLsn?: number
  distinctKeys?: number
  tombstoneCleared?: boolean
  resurrected?: boolean
}): ReplayBoundaryReading

export interface LogCompactionCell {
  id: string
  strategy: string
  totalOps: number
  currentLsn: number
  replayFromLsn: number
  compactedOps: number
  retainedOps: number
  replayOps: number
  missingOps: number
  writeAmplification: number
  cutoffLsn: number
  tombstoneResurrect: number
  snapshotLsn?: number
  snapshotEmpty?: boolean
  dedupSkipped?: number
  exactlyOnce?: boolean
  replayBoundary: ReplayBoundaryReading
  /** 只在 compactFootprint 考场做真判定，其余场景空真 */
  compactFootprint: boolean
  /** 只在 replayCompleteness 考场做真判定，其余场景空真 */
  replayCompleteness: boolean
  /** 只在 fastRecovery 考场做真判定，其余场景空真 */
  fastRecovery: boolean
  inFootprintExam: boolean
  inCompletenessExam: boolean
  inRecoveryExam: boolean
}

export interface LogCompactionRow {
  strategy: 'SizeTimeRetention' | 'KeyCompaction' | 'SnapshotPlusWal'
  scenarios: LogCompactionCell[]
  trilemma: { compactFootprint: boolean; replayCompleteness: boolean; fastRecovery: boolean }
  metrics: {
    compactedOps: number
    replayOps: number
    peakWriteAmplification: number
    missingOps: number
    tombstoneResurrect: number
  }
}

/** 单场景公开入口（可独立单测）；非法 strategy/scenario 回 null。 */
export function runLogCompactionScenario(
  strategy: string,
  scenario: string,
  opts?: Record<string, unknown>,
): LogCompactionCell | null

export interface LogCompactionEvidence {
  walLastSeq: number
  walLines: number
  walReplayed: number
  zqFired: number
  zqPendingAfterRestore: number
  zqLostOnRestart: number
  heapFired: number
  shardHits: number
  bloomHit: boolean
  bloomMiss: boolean
  counterSum: number
  counterFalseSharing: number
  bucketAllowed: number
  bucketRejected: number
  poolCreated: number
  poolReused: number
  notices: number
  busListeners: number
  ringShardsUsed: number
  ringFirst: string | null
  jitterSpread: number
}

export interface LogCompactionStudy {
  builtAt: number
  config: {
    seed: number
    ops: number
    keySpace: number
    retentionOps: number
    retentionMs: number
    deleteRetention: number
    snapshotAt: number
    footprintBudget: number
    replayBudget: number
    unlimitedRetention: boolean
    instantSnapshot: boolean
    zeroReplayCost: boolean
    rigged: boolean
    scenarios: readonly string[]
  }
  rows: LogCompactionRow[]
  vectors: Record<string, string>
  topology: Record<string, string>
  replayBoundary: {
    holds: boolean
    nontrivial: boolean
    falsifiable: boolean
    steady: Array<ReplayBoundaryReading & { strategy: string }>
    tamper: { replayOps: ReplayBoundaryReading; walGap: ReplayBoundaryReading; tombstone: ReplayBoundaryReading }
    note: string
  }
  crosscheck: { evidence: LogCompactionEvidence }
  verdict: {
    vectors: Record<string, string>
    trilemmaDistinguishes: boolean
    noUniversalWinner: boolean
    noStrategyWinsAll: boolean
    retentionDropsSlowConsumer: boolean
    keyCompactionPaysRecovery: boolean
    keyCompactionResurrectsUnderShortRetention: boolean
    snapshotPaysWriteAmplification: boolean
    snapshotExactlyOnce: boolean
    replayBoundaryHolds: boolean
    replayBoundaryNontrivial: boolean
    replayBoundaryFalsifiable: boolean
    unlimitedRetentionBackfiresRecovery: boolean
    instantSnapshotBackfiresRecovery: boolean
    zeroReplayCostErasesNothing: boolean
    fastRecoveryCausallyUnerasable: boolean
  }
  rigged: boolean
}

export function logCompactionStudy(opts?: {
  now?: number | (() => number)
  ops?: number
  keySpace?: number
  retentionOps?: number
  retentionMs?: number
  deleteRetention?: number
  snapshotAt?: number
  footprintBudget?: number
  replayBudget?: number
  seed?: number
  scenarios?: readonly string[]
  unlimitedRetention?: boolean
  instantSnapshot?: boolean
  zeroReplayCost?: boolean
  rigged?: boolean
}): LogCompactionStudy

/** compareLogCompaction 同构别名：研究入口的另一名字，指向同一 buildStudy。 */
export const compareLogCompaction: typeof logCompactionStudy

export function logCompactionSnapshot(study: LogCompactionStudy): {
  builtAt: number
  config: LogCompactionStudy['config']
  rows: LogCompactionStudy['rows']
  vectors: Record<string, string>
  replayBoundary: LogCompactionStudy['replayBoundary']
  crosscheck: { evidence: LogCompactionEvidence }
  verdict: LogCompactionStudy['verdict']
  topology: Record<string, string>
} | null

/** 十一枚真件交叉印证：返回每个真件的一组真实读数（全真 API 真回读，计数不硬编码）。 */
export function createLogCompactionEvidence(opts?: { seed?: number }): LogCompactionEvidence
