/**
 * `reaction-rules.mjs` 的声明：判据住在 .mjs 里（校验脚本要能被 node 直接跑），测试要能被
 * `tsc --noEmit` 检查 ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `ducking-rules.d.mts` 同一个理由）。
 *
 * 导出集合与 .mjs 双向相等由 `tests/unit/event-rules.test.ts` 那条普查门逐张判（KI-436 新增这一对）。
 */

/** 校验器报告里那一行的形状：`level` 决定它进 ERROR 还是 WARN 计数 */
export interface ReactionFinding {
  level: 'error' | 'warn'
  file: string
  where: string
  msg: string
}

/** 两张表之间的关系判据的一条漏判（与 `ledger-rules.mjs` 的 `statusLedgerErrors` 同一形状） */
export interface ReactionLedgerError {
  key: string
  msg: string
}

/** id → 字段白名单；一行 = §8 表里的一档，一格 = 一个有消费方的数值 */
export const REACTION_FIELDS: Record<string, string[]>
/** id → 每格的取值界；主人是这一份，`report.sub` 只是把它说出来 */
export const REACTION_SPECS: Record<string, Record<string, { min?: number; max?: number; int?: boolean }>>
/** 分级序涉及的那几档（R0/R4 不在这条轴上：一个只有发光时长，一个只有破势） */
export const REACTION_TIER_ORDER: string[]

/**
 * 名册 ⇄ 区间的格级双向对账（KI-434 结案的那句话）。
 * 两张表都收 `unknown`：本函数**第一件事**就是问它们读没读到，读空／读到非对象时报"在空转"而不是闭嘴。
 * @param fields 默认走本模块那份真名册（生产调用走默认路径）
 * @param specs  默认走本模块那份真区间表
 */
export function reactionLedgerErrors(opts?: { fields?: unknown; specs?: unknown }): ReactionLedgerError[]

/**
 * 一张 `reactions.json` → findings（形状／缺行／浮空行／不认的字段／两半对账／档间关系）。
 * 数值 min/max 不在这里，仍由校验器的 `report.sub` 说。
 */
export function reactionFindings(
  file: string,
  rows: unknown,
  opts?: { fields?: unknown; specs?: unknown },
): ReactionFinding[]
