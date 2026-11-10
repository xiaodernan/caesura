/**
 * services/spring/spawn-ledger-check.d.mts —— 进程账本核对器的类型面（KI-441）。
 *
 * <p>有类型面才谈得上「测试 import 它」：`npx tsc --noEmit` 走的是这一份，运行时走的是同名 `.mjs`。
 * 两面的名字必须一致（`tests/unit/decl-parity.test.ts` 按扩展名在全树里两向对账）。
 *
 * <p>这里的类型**只描述读数的形状**，不描述任何预言：核对器的判据全住在 `.mjs` 那一边，
 * 类型面要是能决定红绿，就等于把判决搬进了一层没人跑的代码。
 */

/** 一笔账：`spawn-mark.mjs` 每被真起一次落下的一行 */
export interface SpawnMark {
  atMs: number
  pid: number
  ppid: number | null
  /** 孩子拿到的命令行（`process.argv.slice(2)`）；读不懂的行是 null */
  argv: string[] | null
  /** 账本里的第几行（1 起）：报名的时候要能指回那一行 */
  lineNo: number
}

/** 账本里读不懂的一行 —— 报名，不静默跳过 */
export interface BadLedgerLine {
  lineNo: number
  why: string
  text: string
}

export interface ParsedLedger {
  rows: SpawnMark[]
  bad: BadLedgerLine[]
}

/** 名册里的一格（`GET /gates` 的 `gates` 数组元素，Java 那边把 command 与 args 拼成一串） */
export interface GateRosterRow {
  id: string
  family?: string
  command: string
  timeoutSec?: number
  blocking?: boolean
}

/**
 * 跑测记录（`POST /gates/{id}/run` 的判决 + 核对器补上的那几格）。
 * `after` 是**跑完之后**从 `GET /circuit/{id}` 现读的账；编排层负责填 `group`。
 */
export interface RoundReading {
  id: string
  verdict: string
  exitCode: number
  durationMs: number
  ranAt: string
  circuitState?: string | null
  group?: string | null
  after?: CircuitSnapshot | null
}

/** `GET /circuit/{id}` 的那一格账（字段与 Java 的 `CircuitBreaker.Snapshot` 一一对应） */
export interface CircuitSnapshot {
  id: string
  state: string
  consecutiveFailures: number
  trialInFlight: boolean
  openedAtMs: number
  cooldownMs: number
  remainingMs: number
}

/** 一趟跑测对应的时间窗口 + 这一趟**应该**有几笔账 */
export interface RoundWindow {
  i: number
  id: string
  verdict: string | null
  exitCode: number | null
  circuitState: string | null
  durationMs: number | null
  fromMs: number | null
  toMs: number | null
  /** 唯一「没有起跑」的拼法是 `verdict === 'circuit_open'` */
  allowed: boolean
  marking: boolean
  expectedMarks: number
  group: string | null
  /** 这一趟自己推不出窗口的原因（空数组＝推得出） */
  unreadable: string[]
}

/** 窗口带着跑完之后的账（状态机那半的对账要用） */
export type RoundWindowWithAfter = RoundWindow & {
  after?: CircuitSnapshot | null
}

/** 一笔账落进几个窗口的归属结果 */
export interface MarkAttribution {
  perRound: { atMs: number; pid: number }[][]
  ambiguous: { atMs: number; pid: number; in: number[] }[]
  outside: { atMs: number; pid: number }[]
}

/** 一条红：key 是被指控的那句话，msg 带着能指回的数与行号 */
export interface LedgerFinding {
  key: string
  msg: string
}

/** 「表 vs 账本」对照表的一行 */
export interface StopwatchRow {
  i: number
  id: string
  verdict: string | null
  durationMs: number | null
  marks: number
  marking: boolean
  watchSays: 'unreadable' | 'no-time' | 'time-spent'
  ledgerSays: string
  inference: 'agree' | 'watch-overclaims' | 'watch-underclaims' | 'blind'
}

export interface StopwatchTable {
  rows: StopwatchRow[]
  summary: {
    rounds: number
    markingRounds: number
    blindRounds: number
    agree: number
    watchOverclaims: number
    watchUnderclaims: number
    zeroDurationRounds: number
  }
}

/** 编排参数：缺格是 null，不回落默认值 */
export interface CircuitYmlParams {
  failureThreshold: number | null
  cooldownSec: number | null
  duplicates: string[]
}

/** 走查要用的角色：全部从**跑着的名册**现推 */
export interface RosterRoles {
  flip: GateRosterRow | null
  slow: GateRosterRow | null
  markRed: GateRosterRow | null
  markGreen: GateRosterRow | null
  plain: GateRosterRow[]
  unspawnable: GateRosterRow[]
  marking: GateRosterRow[]
  all: GateRosterRow[]
}

/** 一趟走查的结果（`readings` 里全是读数，判据只在 `findings` 那一条线上） */
export interface SpawnLedgerResult {
  verdict: 'OK' | 'RED'
  readings: Record<string, unknown>
  findings: LedgerFinding[]
  rounds: RoundReading[]
  table?: StopwatchTable
  marks?: SpawnMark[]
  bad?: BadLedgerLine[]
}

export interface SpawnLedgerCheckOptions {
  base: string
  phase?: 'open' | 'halfopen'
  ledgerPath?: string
  request?: (method: string, path: string) => Promise<{ status: number; body: Record<string, unknown> }>
  sleep?: (ms: number) => Promise<void>
  readLedger?: () => string | null
  truncateLedger?: (path: string) => void
  maxWaitMs?: number
  circuitYml?: string | null
}

/** 账本路径唯一的出处：孩子 import 这一个名字，不抄第二遍 */
export const SPAWN_LEDGER_ENV: string

/** 记账那个孩子的路径（相对仓库根）：命令行点到它，那一趟才算「会记账的门」 */
export const MARK_SCRIPT_RELPATH: string

/** 这一格名册是不是「会记账的门」 */
export function isMarking(command: string | null | undefined): boolean

/** 名册里所有「会记账」的门 id */
export function markingIds(rows: GateRosterRow[] | null | undefined): string[]

/** 账本文本 → 行 + 读不懂的那几行（读不懂不许当没看见） */
export function parseLedger(text: string): ParsedLedger

/** 每一趟跑测 → 时间窗口 + 这一趟应该有几种账 */
export function roundWindows(
  rounds: RoundReading[] | null | undefined,
  opts?: { marking?: string[] },
): RoundWindow[]

/** 把每一笔账归到它发生时正在跑的那些趟 */
export function attributeMarks(
  marks: { atMs: number; pid: number }[] | null | undefined,
  windows: (RoundWindow | null | undefined)[] | null | undefined,
): MarkAttribution

/** 对账：判决说什么 ⇄ 孩子记了什么 */
export function ledgerFindings(input: {
  windows: RoundWindow[]
  attributed: MarkAttribution
  markCount: number
  badLines?: BadLedgerLine[]
}): LedgerFinding[]

/** 「表 vs 账本」那一张对照表本身（不判红：它摆的是关系，不是判决） */
export function stopwatchTable(windows: RoundWindow[], attributed: MarkAttribution): StopwatchTable

/** 状态机那半的对账：半开那一档第一次被读，而不是被推断 */
export function halfOpenFindings(
  windows: RoundWindowWithAfter[],
  opts?: { threshold?: number | null; trialExpected?: boolean },
): LedgerFinding[]

/** 从 gate 自己的 `application.yml` 现读那两个编排参数（缺格 null，不回落） */
export function parseCircuitYml(text: string): CircuitYmlParams

/** 走查的角色：按命令行上的旗标现推，核对器里不抄门 id 名单 */
export function rolesFromRoster(rows: GateRosterRow[] | null | undefined): RosterRoles

/** 走一遍（**会动 HTTP 与文件**，所以只有当命令跑时才跑它） */
export function runSpawnLedgerCheck(opts: SpawnLedgerCheckOptions): Promise<SpawnLedgerResult>
