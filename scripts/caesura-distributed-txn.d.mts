/**
 * scripts/caesura-distributed-txn.d.mts —— KI-506 分布式事务教学件的类型声明。
 *
 * 与 `caesura-distributed-txn.mjs` 的值导出**严格同名**（`decl-parity` 门逐枚对账，10 枚）：
 *   DTX_DEFAULTS / DTX_PROTOCOLS / DTX_SCENARIOS /
 *   createTwoPhaseCommit / createSaga / createTcc /
 *   runDtxnScenario / compareDistributedTxn / distributedTxnStudy / dtSnapshot
 * 另导出纯类型（不参与值名册）：*Options / *Stats / *Snapshot / DtxnVerdict 等。
 *
 * 判定权与阈值全在 Node 侧，这里只描述形状；前端只读 `dtSnapshot` 的纯数据渲染、不复核不实测。
 */

/** 缺省教学参数（参与方/步数/故障点/重试上限）。 */
export const DTX_DEFAULTS: Readonly<{
  participants: readonly string[]
  sagaSteps: readonly string[]
  tccSteps: readonly string[]
  failIndex: number
  compensateFailIndex: number
  confirmFlakyIndex: number
  confirmFailTimes: number
  maxRetries: number
  zero: number
}>

/** 三协议枚举（短名作矩阵 key）。 */
export const DTX_PROTOCOLS: readonly Readonly<{ id: string; short: string; label: string }>[]

/** 六类确定性故障场景（矩阵列）。 */
export const DTX_SCENARIOS: readonly Readonly<{ id: string; label: string }>[]

/** 统一读数：三协议每格都收敛成这一形状，供 compare / 前端共用。 */
export interface DtxnCellReading {
  protocol: string
  scenario: string
  label: string
  committed: boolean
  aborted: boolean
  blocked: number
  dirty: number
  retries: number
  messages: number
  isolation: boolean
  intrusion: number
  atomic: boolean
  detail: Record<string, any>
}

/** 故障注入：at 决定打哪个协议，index/compIndex/times 决定打在哪一步。 */
export interface DtxnFault {
  at?: 'voteNo' | 'coordinatorDown' | 'stepFail' | 'compensateFail' | 'confirmFlaky' | string
  index?: number
  compIndex?: number
  times?: number
  [k: string]: any
}

/** 一个故障场景。 */
export interface DtxnScenario {
  id: string
  label?: string
  fault?: DtxnFault
}

/* ---------------- ① 2PC ---------------- */

export interface TwoPhaseCommitOptions {
  participants?: string[]
  now?: () => number
}

export interface TwoPhaseCommitStats {
  phase: 'init' | 'prepared' | 'committed' | 'aborted' | 'blocked'
  participants: number
  votesYes: number
  votesNo: number
  coordinatorDown: boolean
  blockedParticipants: number
  acks: number
  messages: number
  commitCalls: number
  rollbackCalls: number
  resolvedBy: string | null
  isolation: true
  intrusion: number
}

export interface TwoPhaseCommit {
  prepare(fo?: { noVotes?: string[] }): { ok: boolean; error?: string; phase?: string; allYes?: boolean; votes?: Record<string, string>; messages: number }
  commit(fo?: { coordinatorDown?: boolean }): { committed: boolean; idempotent?: boolean; error?: string; phase?: string; coordinatorDown?: boolean; blockedParticipants?: number; messages: number; commitCalls?: number }
  rollback(fo?: { rescued?: boolean }): { aborted: boolean; idempotent?: boolean; error?: string; phase?: string; rescued?: boolean; messages: number; rollbackCalls?: number }
  resolveBlocked(decision?: 'commit' | 'rollback'): { resolved: boolean; reason?: string; decision?: string; phase?: string; [k: string]: any }
  stats(): TwoPhaseCommitStats
  snapshot(t?: number): Record<string, any>
  reset(): void
  readonly phase: string
  readonly messages: number
  readonly participants: string[]
}

export function createTwoPhaseCommit(opts?: TwoPhaseCommitOptions): TwoPhaseCommit

/* ---------------- ② Saga ---------------- */

export interface SagaOptions {
  steps?: string[]
  compensations?: string[]
  now?: () => number
}

export interface SagaStats {
  phase: 'init' | 'committed' | 'aborted' | 'dirty'
  steps: number
  stepsDone: number
  compensated: number
  dirtyData: number
  messages: number
  blockedParticipants: 0
  isolation: false
  intrusion: number
}

export interface Saga {
  run(fo?: { failAtStep?: number; compensateFailAt?: number }): {
    ok: boolean; error?: string; committed?: boolean; phase?: string; stepsDone?: number
    compensationOrder?: number[]; compensated?: number[]; dirtyData?: number; messages: number; isolation?: boolean
  }
  stats(): SagaStats
  snapshot(t?: number): Record<string, any>
  reset(): void
  readonly phase: string
  readonly messages: number
  readonly steps: string[]
  readonly compensations: string[]
}

export function createSaga(opts?: SagaOptions): Saga

/* ---------------- ③ TCC ---------------- */

export interface TccOptions {
  steps?: string[]
  maxRetries?: number
  now?: () => number
}

export interface TccStats {
  phase: 'init' | 'committed' | 'aborted' | 'dirty'
  steps: number
  tryOk: number
  confirmed: number
  cancelled: number
  dirtyData: number
  messages: number
  retries: number
  blockedParticipants: 0
  isolation: true
  intrusion: number
}

export interface Tcc {
  run(fo?: { tryFailAt?: number; confirmFlakyAt?: number; confirmFailTimes?: number; cancelFailAt?: number }): {
    ok: boolean; error?: string; committed?: boolean; phase?: string; tryFailAt?: number
    cancelOrder?: number[]; confirmed?: number; dirtyData?: number; messages: number; retries: number; isolation?: boolean
  }
  stats(): TccStats
  snapshot(t?: number): Record<string, any>
  reset(): void
  readonly phase: string
  readonly messages: number
  readonly steps: string[]
  readonly maxRetries: number
}

export function createTcc(opts?: TccOptions): Tcc

/* ---------------- ④ 对照 ---------------- */

export interface CompareDtxnOptions {
  scenarios?: DtxnScenario[]
  participants?: string[]
  sagaSteps?: string[]
  tccSteps?: string[]
  maxRetries?: number
  failIndex?: number
  compensateFailIndex?: number
  confirmFlakyIndex?: number
  confirmFailTimes?: number
  now?: () => number
}

export interface TrilemmaVector {
  /** 所有场景都不阻塞（2PC 协调者宕机场景会翻 false）。 */
  noBlock: boolean
  /** 所有场景都不留脏（Saga 补偿失败场景会翻 false）。 */
  noDirty: boolean
  /** 侵入度等于三协议最低（只有 2PC 为 true）。 */
  lowIntrusion: boolean
}

export interface DtxnMatrixCell {
  protocol: string
  label: string
  scenarios: Record<string, DtxnCellReading>
  totals: { committed: number; aborted: number; blocked: number; dirty: number; retries: number; messages: number }
  intrusion: number
  isolation: boolean
  trilemma: TrilemmaVector
}

export interface DtxnVerdict {
  twoPcBlocksOnCoordinatorDown: boolean
  sagaLeaksDirtyOnCompensateFail: boolean
  sagaNeverBlocks: boolean
  tccSelfHealsConfirm: boolean
  tccMostIntrusive: boolean
  twoPcAndTccIsolated: boolean
  trilemmaDistinguishes: boolean
  noProtocolWinsAll: boolean
  noUniversalWinner: boolean
}

export interface IsolationComparison {
  generator: 'caesura-distributed-txn/compare'
  protocols: string[]
  scenarios: Array<{ id: string; label: string; fault: DtxnFault }>
  /** 三协议各自的三难向量（如 011/100/110），前端可直读判词载体。 */
  trilemmaVectors: Record<string, string>
  matrix: Record<string, DtxnMatrixCell>
  verdict: DtxnVerdict
}

export function runDtxnScenario(opts?: CompareDtxnOptions & { protocol?: string; scenario?: DtxnScenario }): DtxnCellReading

export function compareDistributedTxn(opts?: CompareDtxnOptions): IsolationComparison

/* ---------------- ⑤ study / snapshot ---------------- */

export interface DistributedTxnStudy {
  generator: 'caesura-distributed-txn'
  comparison: IsolationComparison
  idempotency: {
    firstCommitted: boolean
    replayIdempotent: boolean
    messagesFirst: number
    messagesReplay: number
    rollbackAfterCommitRejected: boolean
    stats: TwoPhaseCommitStats
  }
  sagaOrder: { compensationOrder: number[]; expected: number[]; reverseOrder: boolean; dirtyData: number }
  tccRetry: { committed: boolean; retries: number; phase: string; dirtyData: number; messages: number; stats: TccStats }
  verdict: DtxnVerdict & {
    twoPcCommitIdempotent: boolean
    sagaCompensatesInReverse: boolean
    tccConfirmIdempotentRetry: boolean
  }
  builtAt: number
}

export interface DtxnSnapshotRow {
  protocol: string
  label: string
  intrusion: number
  isolation: boolean
  trilemma: TrilemmaVector
  totals: { committed: number; aborted: number; blocked: number; dirty: number; retries: number; messages: number }
  scenarios: Array<DtxnCellReading & { label: string }>
}

export interface DtxnSnapshot {
  config: { protocols: string[]; scenarios: Array<{ id: string; label: string }> }
  rows: DtxnSnapshotRow[]
  idempotency: DistributedTxnStudy['idempotency']
  sagaOrder: DistributedTxnStudy['sagaOrder']
  tccRetry: DistributedTxnStudy['tccRetry']
  verdict: DistributedTxnStudy['verdict']
  builtAt: number
}

export function distributedTxnStudy(opts?: CompareDtxnOptions): DistributedTxnStudy

/** 把 study 收敛成前端 / status 友好的只读结构；null 入参诚实降级为 null。 */
export function dtSnapshot(study: DistributedTxnStudy | null | undefined): DtxnSnapshot | null
