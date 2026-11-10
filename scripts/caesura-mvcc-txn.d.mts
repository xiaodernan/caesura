/** `scripts/caesura-mvcc-txn.mjs` 的声明：MVCC 多版本可见性 + 五档隔离级别异常对照 + 行锁 2PL 死锁检测（KI-505）。 */

/** 缺省教学参数（阈值/轨迹仍由调用方注入）。 */
export const MV_DEFAULTS: Readonly<{
  initialA: number
  initialB: number
  dirtyWrite: number
  updateA1: number
  updateA2: number
  zero: number
  rangeLo: string
  rangeHi: string
  victimPolicy: 'youngest' | 'min-locks'
  gcVersions: number
  gcLongWaterMark: number
  gcCleanWaterMark: number
}>

/** 一个隔离级别。 */
export interface IsolationLevel {
  readonly id: 'read-uncommitted' | 'read-committed' | 'repeatable-read' | 'snapshot-isolation' | 'serializable'
  readonly short: 'RU' | 'RC' | 'RR' | 'SI' | 'SER'
  readonly label: string
}
/** 五档隔离级别（弱→强）。 */
export const ISOLATION_LEVELS: ReadonlyArray<Readonly<IsolationLevel>>

/** 一类经典并发异常。 */
export interface Anomaly {
  readonly id: 'dirtyRead' | 'nonRepeatableRead' | 'phantom' | 'lostUpdate' | 'writeSkew'
  readonly label: string
}
/** 五类经典异常。 */
export const ANOMALIES: ReadonlyArray<Readonly<Anomaly>>

/* ---------------- ① 多版本链 ---------------- */

export interface Version {
  value: any
  beginTs: number
  commitTs: number | null
  writerTxn: string
  tombstone: boolean
}
export interface VersionChainOptions {
  compare?: (a: any, b: any) => number
}
export interface VisibleResult {
  found: boolean
  deleted: boolean
  value: any
  version: number | null
  commitTs: number | null
  writerTxn?: string
  /** 非 null 表示读到了别人未提交的版本（脏读的证据）。 */
  uncommittedFrom: string | null
  readTs: number
}
export interface CompactResult {
  removed: number
  kept: number
  waterMarkTs: number
  liveVersions: number
}
export interface VersionChainStats {
  size: number
  appended: number
  compacted: number
  lastCommittedTs: number | null
  pending: number
}
export interface VersionChainSnapshot {
  versions: Version[]
  size: number
  appended: number
  compacted: number
  lastCommittedTs: number | null
}
/** 单 key 多版本链：MVCC 可见性判据 + 水位 gc。 */
export interface VersionChain {
  append(v: Partial<Version> & { value?: any }): Version
  visibleAt(readTs: number, readerTxn: string | null, includeUncommitted?: boolean): VisibleResult
  setCommitTs(writerTxn: string, ts: number): number
  discardUncommitted(writerTxn: string): number
  lastCommittedTs(): number | null
  hasCommittedAfter(ts: number): boolean
  latestCommitted(): Version | null
  compact(waterMarkTs: number): CompactResult
  snapshot(): VersionChainSnapshot
  stats(): VersionChainStats
  reset(): void
  readonly size: number
  readonly compare: (a: any, b: any) => number
}
export function createVersionChain(opts?: VersionChainOptions): VersionChain

/* ---------------- ② MVCC 事务存储 ---------------- */

export type IsolationId = IsolationLevel['id']
export interface MvccStoreOptions {
  /** 逻辑时钟基线（注入 ⇒ 确定性；内部单调 tick 保证 beginTs/commitTs 严格递增）。 */
  now?: () => number
  compare?: (a: any, b: any) => number
  isolation?: IsolationId
}
export interface TxnHandle {
  readonly id: string
  readonly isolation: IsolationId | undefined
  readonly beginTs: number | undefined
  readonly status: 'active' | 'committed' | 'aborted' | undefined
}
export interface TxnState {
  id: string
  isolation: IsolationId
  beginTs: number
  firstReadTs: number | null
  status: 'active' | 'committed' | 'aborted'
  commitTs: number | null
  readSet: string[]
  writeSet: string[]
}
export interface StoreReadResult extends VisibleResult {
  txn: TxnHandle
  key: string
}
export interface StoreRangeResult {
  results: Array<{ key: string; value: any; commitTs: number | null; uncommittedFrom: string | null }>
  readTs: number
  count: number
  error?: string
}
export interface CommitResult {
  committed: boolean
  txn?: string
  commitTs?: number
  writes?: number
  reason?: string
  error?: string
  aborted?: boolean
}
export interface MvccStoreStats {
  begins: number
  reads: number
  writes: number
  deletes: number
  ranges: number
  committed: number
  aborted: number
  rollbacks: number
  writeConflicts: number
  writeSkews: number
  keys: number
  versions: number
  commitLogSize: number
  now: number
}
export interface FinalCell {
  value: any
  commitTs: number | null
  tombstone: boolean
}
export interface MvccStoreSnapshot {
  generator: 'caesura-mvcc-txn/store'
  stats: MvccStoreStats
  final: Record<string, FinalCell>
  transactions: Record<string, TxnState>
  commitLog: Array<{ txnId: string; committedAt: number; readSet: string[]; writeSet: string[] }>
  builtAt: number
}
/** MVCC 事务管理器：begin/read/write/del/range/commit/rollback + 隔离级别读视图 + 写冲突中止。 */
export interface MvccStore {
  begin(isolation?: IsolationId): TxnHandle
  seed(key: string, value: any, ts?: number): { key: string; value: any; commitTs: number }
  read(txnOrId: TxnHandle | string, key: string): StoreReadResult
  write(txnOrId: TxnHandle | string, key: string, value: any): { written: boolean; key: string; value?: any; writerTxn?: string; error?: string }
  del(txnOrId: TxnHandle | string, key: string): { deleted: boolean; key: string; writerTxn?: string; error?: string }
  range(txnOrId: TxnHandle | string, lo: any, hi: any): StoreRangeResult
  commit(txnOrId: TxnHandle | string, ts?: number): CommitResult
  rollback(txnOrId: TxnHandle | string): { rolledBack: boolean; txn?: string; discarded?: number; error?: string }
  gc(waterMarkTs: number): { removed: number; kept: number; waterMarkTs: number }
  finalState(): Record<string, FinalCell>
  transactionStates(): Record<string, TxnState>
  stats(): MvccStoreStats
  snapshot(t?: number): MvccStoreSnapshot
  chainOf(key: string): VersionChain
  reset(): void
  readonly now: number
}
export function createMvccStore(opts?: MvccStoreOptions): MvccStore

/* ---------------- ③ 行锁 + 死锁 ---------------- */

export interface DeadlockResult {
  hasCycle: boolean
  cycle: string[]
  closedCycle: string[]
  nodesVisited: number
  edgeCount: number
}
/** 等待图三色 DFS 环检测（无环也如实报，非恒真）。 */
export function detectDeadlock(graph: Record<string, string[]>): DeadlockResult

export type LockMode = 'S' | 'X'
export type VictimPolicy = 'youngest' | 'min-locks'
export interface LockManagerOptions {
  victim?: VictimPolicy
}
export interface LockAcquireResult {
  granted: boolean
  txn: string
  key: string
  mode: LockMode
  reason?: 'conflict' | '2pl-violation'
  waitFor?: string[]
  phase?: 'growing' | 'shrinking'
}
export interface DeadlockResolution {
  resolved: boolean
  reason?: string
  victim?: string | null
  cycle?: string[]
  closedCycle?: string[]
  regranted?: number
  after?: DeadlockResult
  policy?: VictimPolicy
  hasCycle?: boolean
  nodesVisited?: number
  edgeCount?: number
}
export interface LockManagerStats {
  grants: number
  blocks: number
  releases: number
  conflicts: number
  deadlocks: number
  aborts: number
  plViolations: number
  heldKeys: number
  blockedTxns: number
  activeTxns: number
  policy: VictimPolicy
}
export interface LockManagerState {
  held: Record<string, Array<{ txn: string; mode: LockMode }>>
  waiting: Record<string, Array<{ key: string; mode: LockMode }>>
  phases: Record<string, 'growing' | 'shrinking'>
  graph: Record<string, string[]>
}
/** S/X 行锁 + 两阶段锁 + wait-for graph 死锁检测。 */
export interface LockManager {
  begin(txnId: string): { txn: string; phase: 'growing' | 'shrinking' }
  acquire(txnId: string, key: string, mode?: LockMode): LockAcquireResult
  release(txnId: string, key: string): { released: boolean; txn: string; key: string; phase: 'growing' | 'shrinking' }
  releaseAll(txnId: string): { released: number; txn: string }
  waitForGraph(): Record<string, string[]>
  detectDeadlock(): DeadlockResult
  pickVictim(cycle: string[], policy?: VictimPolicy): string | null
  abortDeadlock(policy?: VictimPolicy): DeadlockResolution
  resolveBlocked(): number
  state(): LockManagerState
  stats(): LockManagerStats
  reset(): void
}
export function createLockManager(opts?: LockManagerOptions): LockManager

/* ---------------- ④ 隔离级别 × 异常调度对照 ---------------- */

export interface ScheduleSeed {
  key: string
  value: any
  commitTs?: number
}
export type ScheduleStep =
  | { t: 'begin'; txn: string }
  | { t: 'read'; txn: string; key: string }
  | { t: 'range'; txn: string; lo: any; hi: any }
  | { t: 'write'; txn: string; key: string; value: any }
  | { t: 'del'; txn: string; key: string }
  | { t: 'commit'; txn: string }
  | { t: 'rollback'; txn: string }
  | { t: string; txn?: string; key?: string; value?: any; lo?: any; hi?: any }
export interface Schedule {
  anomaly: Anomaly['id']
  label: string
  seed: ScheduleSeed[]
  steps: ScheduleStep[]
}
export interface TraceStep {
  i: number
  t: string
  txn: string | null
  key: string | null
  found?: boolean
  value?: any
  readTs?: number
  uncommittedFrom?: string | null
  error?: string | null
  count?: number
  results?: Array<{ key: string; value: any; uncommittedFrom: string | null }>
  commit?: CommitResult
  rollback?: { rolledBack: boolean; discarded?: number }
}
export interface ScheduleTrace {
  level: IsolationId
  anomaly: Anomaly['id'] | null
  steps: TraceStep[]
  transactions: Record<string, TxnState>
  final: Record<string, FinalCell>
  aborted: number
  committed: number
  stats: MvccStoreStats
}
export interface RunScheduleOptions {
  store?: MvccStore
  level?: IsolationId
  schedule?: Partial<Schedule>
  seed?: ScheduleSeed[]
  steps?: ScheduleStep[]
  anomaly?: Anomaly['id']
  now?: () => number
}
/** 在给定 store 上跑一条调度（level 覆盖所有 begin）。 */
export function runSchedule(opts?: RunScheduleOptions): ScheduleTrace

export interface AnomalyCell {
  observed: boolean
  prevented: boolean
  label: string
}
export interface MatrixRow {
  level: IsolationId
  short: IsolationLevel['short']
  aborted: number
  committed: number
  observedCount: number
  preventedCount: number
  anomalies: Record<Anomaly['id'], AnomalyCell>
  trace: Record<Anomaly['id'], {
    observed: boolean
    steps: Array<{
      i: number; t: string; txn: string | null; key: string | null
      value?: any; found?: boolean; uncommittedFrom?: string | null; readTs?: number
      count?: number; committed?: boolean; reason?: string
    }>
    final: Record<string, FinalCell>
  }>
}
export interface IsolationVerdict {
  matrixWellFormed: boolean
  ruSeesAllFive: boolean
  rcStopsDirtyRead: boolean
  rrFreezesReadView: boolean
  siStopsLostUpdateButLeaksWriteSkew: boolean
  serializableStopsWriteSkew: boolean
  serializableCostsMostAborts: boolean
  noUniversalWinner: boolean
}
export interface IsolationComparison {
  generator: 'caesura-mvcc-txn/isolation'
  levels: IsolationLevel['short'][]
  anomalies: Anomaly['id'][]
  levelLabels: Record<string, string>
  matrix: Record<IsolationLevel['short'], MatrixRow>
  verdict: IsolationVerdict
}
export interface CompareIsolationOptions {
  now?: () => number
  /** 覆盖内置五类调度（键为异常 id）。 */
  schedules?: Partial<Record<Anomaly['id'], Partial<Schedule>>>
  initialA?: number
  initialB?: number
  dirtyWrite?: number
  updateA1?: number
  updateA2?: number
  zero?: number
  rangeLo?: string
  rangeHi?: string
}
/** 五类异常 × 五档隔离核心对照。 */
export function compareIsolationLevels(opts?: CompareIsolationOptions): IsolationComparison

/* ---------------- ⑤ study / snapshot ---------------- */

export interface DeadlockStudy {
  before: Array<{ step: string; granted: boolean; reason: string | null; waitFor: string[] }>
  graph: Record<string, string[]>
  detected: DeadlockResult
  acyclicProbe: { hasCycle: boolean; cycle: string[] }
  resolution: DeadlockResolution
  stats: LockManagerStats
}
export interface GcStudy {
  versions: number
  longWaterMark: CompactResult
  cleanWaterMark: CompactResult
  longTxnRetainsMoreVersions: boolean
}
export interface MvccStudy {
  generator: 'caesura-mvcc-txn'
  comparison: IsolationComparison
  deadlock: DeadlockStudy
  twoPhaseLock: { lateAcquireBlocked: boolean; reason: string; stats: LockManagerStats }
  gc: GcStudy
  store: { readValue: any; committed: boolean; stats: MvccStoreStats; final: Record<string, FinalCell> }
  verdict: IsolationVerdict & {
    deadlockDetectedAndBroken: boolean
    dfsNotTautological: boolean
    twoPhaseLockEnforced: boolean
    longTransactionRetainsVersions: boolean
  }
  builtAt: number
}
export interface StudyOptions {
  now?: () => number
  victim?: VictimPolicy
  schedules?: CompareIsolationOptions['schedules']
  gcVersions?: number
  gcLongWaterMark?: number
  gcCleanWaterMark?: number
}
/** 汇总成纯数据 study（确定性、无真时钟/socket/磁盘）。 */
export function mvccStudy(opts?: StudyOptions): MvccStudy

export interface MvSnapshot {
  config: { levels: IsolationLevel['short'][]; anomalies: Anomaly['id'][] }
  levels: Array<{
    short: IsolationLevel['short']
    label: string
    anomalies: Record<Anomaly['id'], { observed: boolean; label: string }>
    observedCount: number
    preventedCount: number
    aborted: number
  }>
  deadlock: {
    graph: Record<string, string[]>
    detected: boolean
    cycle: string[]
    resolved: boolean
    victim: string | null
    acyclicProbeNoCycle: boolean
    stats: LockManagerStats
  }
  twoPhaseLock: { lateAcquireBlocked: boolean; reason: string; stats: LockManagerStats }
  gc: GcStudy
  store: MvccStudy['store']
  verdict: MvccStudy['verdict']
  builtAt: number
}
/** 把 study 收敛成前端 / status 友好的只读结构。 */
export function mvSnapshot(study: MvccStudy | null | undefined): MvSnapshot | null
