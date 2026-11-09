/**
 * `validate-data.mjs` 的声明（KI-440 新增这一对）。
 *
 * 这份声明以前**不存在**，而那枚 import 是真实存在的：`tests/unit/ledger-rules.test.ts` 在进程内跑校验器，
 * 用的是 `const VALIDATOR_SPEC = '../../scripts/validate-data.mjs'` ＋ `await import(VALIDATOR_SPEC as string)`。
 * 注释写着那是为了躲 TS7016——实测没错（`.scratch/ki440/probe-ts7016.mjs`：字面 specifier 指无声明脚本
 * ⇒ `tsc` rc=2 一条 TS7016），但躲法把整条 import 挪出了类型层（同一探针 P3：rc=0，0 条 error，
 * 连**路径存在性**都不再被查）。补上这份声明，那条 import 就能回到字面 specifier 的形状，`tsc` 重新成为它的读者。
 *
 * **只声明值导出，不声明副作用**：`validate-data.mjs` 一被求值就跑全仓校验并在末尾 `process.exit(...)`
 * （这是 KI-118 那一族的既有事实）。类型层里没有「import 我会有副作用」这种表达方式，所以那句话
 * 只能由读它的那条腿自己钉住（`ledger-rules.test.ts` 里的 `runValidator` 把 `process.exit` 换成
 * 「记下退出码再抛」，并钉住一个 worker 里只许跑一趟）。
 */

/**
 * 里程碑 `grant` 字段的白名单（校验器拿它拒「不认的 grant 字段」）。对账对手是 `src/data/schema.ts`
 * 的 `MilestoneGrant`，那一条住在同一份 `validate-data.mjs` 的词表名册里（`VOCAB_PAIRS` 那一行的
 * `copied: GRANT_FIELDS`），由校验器自己跑——不在测试树上，所以这份声明只描述形状，不替那一场对账说话。
 */
export const GRANT_FIELDS: readonly string[]
