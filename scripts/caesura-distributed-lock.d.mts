/**
 * scripts/caesura-distributed-lock.d.mts —— KI-508 分布式锁与租约教学件的类型声明。
 *
 * 与 `caesura-distributed-lock.mjs` 的值导出**严格同名**（`decl-parity` 门逐枚对账，10 枚）：
 *   LOCK_DEFAULTS / LOCK_PROTOCOLS / LOCK_SCENARIOS /
 *   createRedisSetnxLock / createRedlock / createEtcdLeaseLock /
 *   runDistributedLockScenario / compareDistributedLock / distributedLockStudy / dlSnapshot
 * 另导出纯类型（不参与值名册）：*Options / *Stats / *Snapshot / DistributedLockVerdict 等。
 *
 * 判定权与阈值全在 Node 侧，这里只描述形状；前端只读 `dlSnapshot` 的纯数据渲染、不复核不实测。
 */

/** 缺省教学参数（实例/节点集、TTL、内部随机种子）。 */
export const LOCK_DEFAULTS: Readonly<{
  instances: number
  nodes: readonly string[]
  ttlMs: number
  seed: number
  zero: number
}>

/** 三协议枚举（短名作矩阵 key）。 */
export const LOCK_PROTOCOLS: readonly Readonly<{ id: string; short: string; label: string }>[]

/** 六类确定性故障场景（矩阵列）。 */
export const LOCK_SCENARIOS: readonly Readonly<{ id: string; label: string }>[]

/** 通用选项（三协议共用）。 */
export interface LockOptions {
  now?: () => number
  rand?: () => number
  seed?: number
  ttlMs?: number
  instances?: number
  nodes?: string[]
  nodeDownCount?: number
}

/** 故障注入：at 决定场景；afterExpiry/clockDrift/nodeDown/partitionMinority/stale/forceTakeover/token 决定打法。 */
export interface LockFault {
  at?: 'allOk' | 'gcPause' | 'clockDrift' | 'nodeDown' | 'partitionMinority' | 'staleFencing' | string
  afterExpiry?: boolean
  clockDrift?: boolean
  nodeDown?: boolean
  nodeDownCount?: number
  partitionMinority?: boolean
  forceTakeover?: boolean
  stale?: boolean
  token?: number
  renewFail?: boolean
  reason?: string
  [k: string]: any
}

/** 一个故障场景。 */
export interface LockScenario {
  id: string
  label?: string
  fault?: LockFault
}

/* ---------------- ① SETNX ---------------- */

export interface SetnxAcquireResult {
  acquired: boolean
  reason?: string
  owner?: string | null
  expiresAt?: number
  fencingToken: number
  quorum: number
  messages: number
  latency: number
  blockedAcquires?: number
}
export interface SetnxWriteResult {
  written: boolean
  fenced: boolean
  reason?: string
  dirtyWrite?: number
  staleWritesRejected?: number
  owner?: string | null
}
export interface SetnxStats {
  owner: string | null
  expiresAt: number
  ttlMs: number
  acquires: number
  ttlExpires: number
  doubleOwners: number
  dirtyWrites: number
  blockedAcquires: number
  messages: number
  latency: number
  quorum: number
  fencingToken: number
  fencedProtected: boolean
  locked: boolean
}

export interface RedisSetnxLock {
  acquire(client?: string, fo?: LockFault): SetnxAcquireResult
  write(client?: string, fo?: LockFault): SetnxWriteResult
  release(client?: string): { released: boolean; reason?: string }
  expire(): boolean
  stats(): SetnxStats
  snapshot(t?: number): Record<string, any>
  reset(): void
  readonly owner: string | null
  readonly messages: number
  readonly doubleOwners: number
  readonly dirtyWrites: number
}

export function createRedisSetnxLock(opts?: LockOptions): RedisSetnxLock

/* ---------------- ② Redlock ---------------- */

export interface RedlockAcquireResult {
  acquired: boolean
  reason?: string
  quorum: number
  acks?: number
  latency: number
  messages: number
  fencingToken?: number
  owner?: string
  doubleOwners?: number
  clockDrift?: boolean
}
export interface RedlockWriteResult {
  written: boolean
  fenced: boolean
  reason?: string
  dirtyWrite?: number
  staleWritesRejected?: number
  held?: number
}
export interface RedlockStats {
  instances: number
  quorum: number
  acquires: number
  blockedAcquires: number
  clockDrifts: number
  doubleOwners: number
  dirtyWrites: number
  staleWritesRejected: number
  fencedProtected: boolean
  messages: number
  latency: number
  fencingToken: number
  locked: boolean
}

export interface Redlock {
  acquire(client?: string, fo?: LockFault): RedlockAcquireResult
  write(client?: string, fo?: LockFault): RedlockWriteResult
  release(client?: string): { released: number; ok: boolean }
  expire(): number
  stats(): RedlockStats
  snapshot(t?: number): Record<string, any>
  reset(): void
  readonly quorum: number
  readonly instances: number
  readonly messages: number
  readonly doubleOwners: number
  readonly dirtyWrites: number
}

export function createRedlock(opts?: LockOptions): Redlock

/* ---------------- ③ etcd Lease + Fencing ---------------- */

export interface EtcdAcquireResult {
  acquired: boolean
  reason?: string
  fencingToken?: number
  quorum: number
  acks?: number
  latency: number
  raftRounds?: number
  messages: number
  owner?: string | null
  clockDriftTolerated?: boolean
}
export interface EtcdWriteResult {
  written: boolean
  fenced: boolean
  reason?: string
  token?: number
  currentToken?: number
  staleWritesRejected?: number
  owner?: string | null
}
export interface EtcdRenewResult {
  renewed: boolean
  reason?: string
  expired?: boolean
  expiresAt?: number
}
export interface EtcdStats {
  nodes: number
  quorum: number
  currentToken: number
  leaseOwner: string | null
  expiresAt: number
  acquires: number
  blockedAcquires: number
  leaseExpires: number
  renewals: number
  writes: number
  staleWritesRejected: number
  doubleOwners: number
  dirtyWrites: number
  messages: number
  latency: number
  raftRounds: number
  fencedProtected: boolean
  locked: boolean
}

export interface EtcdLeaseLock {
  acquire(client?: string, fo?: LockFault): EtcdAcquireResult
  renew(client?: string, fo?: LockFault): EtcdRenewResult
  write(client?: string, fo?: LockFault): EtcdWriteResult
  release(client?: string, fo?: LockFault): { released: boolean; reason?: string }
  expire(): boolean
  stats(): EtcdStats
  snapshot(t?: number): Record<string, any>
  reset(): void
  readonly quorum: number
  readonly nodes: string[]
  readonly messages: number
  readonly currentToken: number
  readonly staleWritesRejected: number
}

export function createEtcdLeaseLock(opts?: LockOptions): EtcdLeaseLock

/* ---------------- ④ 对照 ---------------- */

/** 统一读数：三协议每格都收敛成这一形状，供 compare / 前端共用。 */
export interface LockCellReading {
  protocol: string
  scenario: string
  label: string
  acquired: boolean
  doubleOwners: number
  dirtyWrites: number
  blockedAcquires: number
  staleWritesRejected: number
  fencedProtected: boolean
  mutualExcluded: boolean
  converged: boolean
  messages: number
  latency: number
  quorum: number
  rounds: number
  detail: Record<string, any>
  fault?: LockFault
}

export interface CompareDistributedLockOptions extends LockOptions {
  scenarios?: LockScenario[]
}

/** 三难向量：互斥安全 ∧ 部分容错可用 ∧ 低延迟。 */
export interface LockTrilemma {
  mutualExclusion: boolean
  partialFaultTolerance: boolean
  lowLatency: boolean
}

export interface LockMatrixCell {
  protocol: string
  label: string
  scenarios: Record<string, LockCellReading>
  totals: {
    acquired: number
    doubleOwners: number
    dirtyWrites: number
    blockedAcquires: number
    staleWritesRejected: number
    messages: number
    fencedCount: number
  }
  trilemma: LockTrilemma
}

export interface DistributedLockVerdict {
  setnxGcPauseDoubleOwner: boolean
  setnxSinglePointDown: boolean
  setnxLowLatencyOnly: boolean
  redlockClockDriftDoubleOwner: boolean
  redlockToleratesNodeDown: boolean
  redlockMinorityRefuses: boolean
  redlockNoFencing: boolean
  etcdNeverDirty: boolean
  etcdToleratesNodeDown: boolean
  etcdMinorityRefusesCP: boolean
  etcdFencingRejectsStale: boolean
  etcdPaysQuorumLatency: boolean
  trilemmaDistinguishes: boolean
  noProtocolWinsAll: boolean
  noUniversalWinner: boolean
}

export interface LockComparison {
  generator: 'caesura-distributed-lock/compare'
  protocols: string[]
  scenarios: Array<{ id: string; label: string; fault: LockFault }>
  trilemmaVectors: Record<string, string>
  matrix: Record<string, LockMatrixCell>
  verdict: DistributedLockVerdict
}

export function runDistributedLockScenario(opts?: CompareDistributedLockOptions & { protocol?: string; scenario?: LockScenario }): LockCellReading

export function compareDistributedLock(opts?: CompareDistributedLockOptions): LockComparison

/* ---------------- ⑤ study / snapshot ---------------- */

export interface SetnxProbe {
  acquired: boolean
  mutexWhileLive: boolean
  ttlAutoRelease: boolean
  gcPauseDoubleOwner: boolean
  gcPauseDirtyWrite: boolean
  singlePointDown: boolean
  noFencing: boolean
}

export interface RedlockProbe {
  quorumAcquire: boolean
  quorum: number
  instances: number
  toleratesNodeDown: boolean
  minorityRefuses: boolean
  clockDriftDoubleOwner: boolean
  clockDrifts: boolean
  noFencingDirtyWrite: boolean
}

export interface FencingProbe {
  tokenMonotonic: boolean
  firstToken: number
  nextToken: number
  rejectsStaleWrite: boolean
  noDirtyOnStale: boolean
  fencedProtected: boolean
  minorityRefusesCP: boolean
  toleratesNodeDown: boolean
  leaseRenewFresh: boolean
  expiredLeaseCannotRenew: boolean
  quorum: number
}

export interface DistributedLockStudy {
  generator: 'caesura-distributed-lock'
  comparison: LockComparison
  setnx: SetnxProbe
  redlock: RedlockProbe
  fencing: FencingProbe
  verdict: DistributedLockVerdict & {
    setnxMutexWhileLive: boolean
    setnxTtlAutoRelease: boolean
    setnxGcPauseDoubleOwner: boolean
    setnxSinglePointDown: boolean
    redlockQuorumAcquire: boolean
    redlockToleratesNodeDown: boolean
    redlockMinorityRefuses: boolean
    redlockClockDriftDoubleOwner: boolean
    redlockNoFencingDirtyWrite: boolean
    fencingTokenMonotonic: boolean
    fencingLeaseRenewFresh: boolean
    fencingExpiredLeaseNoRenew: boolean
    fencingRejectsStaleWrite: boolean
    fencingNoDirtyOnStale: boolean
    fencingMinorityRefusesCP: boolean
  }
  builtAt: number
}

export interface LockSnapshotRow {
  protocol: string
  label: string
  trilemma: LockTrilemma
  totals: LockMatrixCell['totals']
  scenarios: Array<LockCellReading & { label: string }>
}

export interface LockSnapshot {
  config: { protocols: string[]; scenarios: Array<{ id: string; label: string }> }
  rows: LockSnapshotRow[]
  setnx: SetnxProbe
  redlock: RedlockProbe
  fencing: FencingProbe
  verdict: DistributedLockStudy['verdict']
  builtAt: number
}

export function distributedLockStudy(opts?: CompareDistributedLockOptions): DistributedLockStudy

/** 把 study 收敛成前端 / status 友好的只读结构；null 入参诚实降级为 null。 */
export function dlSnapshot(study: DistributedLockStudy | null | undefined): LockSnapshot | null
