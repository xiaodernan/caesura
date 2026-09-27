/** `ledger-rules.mjs` 的声明：判据住在 .mjs 里（校验脚本要能被 node 直接跑），测试要能被 `tsc --noEmit`
 *  检查 ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `report-reds.d.mts` 同一个理由）。 */

export interface LedgerError {
  /** 报错要挂的 key（`PENDING_MILESTONE_GRANTS.ms_x` / `UI_BOUND_MILESTONES.ms_y` / 旗标本身） */
  key: string
  /** 说清"哪条账、为什么该销"——理由原文要一起印出来，那句谎才是给人看的东西 */
  msg: string
}

/** 三份"先记账后接线"的账本：id/旗标 → 那句"为什么还欠着"。校验器与单元测试读的都是这一份 */
export const PENDING_MILESTONE_GRANTS: Record<string, string>
export const UI_BOUND_MILESTONES: Record<string, string>
export const PENDING_FLAG_WRITERS: Record<string, string>

export interface MilestoneRow {
  id: string
  grant?: Record<string, unknown>
  [k: string]: unknown
}

export function hasMilestoneLeg(row: MilestoneRow | null | undefined, movementMsIds: Set<string>): boolean

export function milestoneLedgerErrors(input: {
  pending: Record<string, string>
  uiBound: Record<string, string>
  rows: MilestoneRow[]
  movementMsIds: Set<string>
}): LedgerError[]

export function flagLedgerErrors(input: {
  pending: Record<string, string>
  written: Map<string, string>
}): LedgerError[]

/** 状态名册 ↔ 两张按 id 键控的派生表（字段白名单 / 取值范围）的三向一致性（KI-076） */
export function statusLedgerErrors(input: {
  roster: string[]
  fields: Record<string, string[]>
  specs: Record<string, unknown>
}): LedgerError[]
