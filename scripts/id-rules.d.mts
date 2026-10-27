/** `id-rules.mjs` 的声明：判据住在 .mjs 里（它要被 node 直接跑，也要被合成夹具喂），测试要能被 `tsc --noEmit`
 *  检查 ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `ledger-rules.d.mts` 同一个理由）。 */

/** 一条判据的读数形状：挂在哪里 ＋ 说清"为什么该红"（与 `ledger-rules.mjs` 的 `LedgerError` 同形） */
export interface IdFinding {
  key: string
  msg: string
}

/** 架构 §8.2 那条规则句解析出来的三格 */
export interface IdRule {
  /** 规则句说的前缀表（`KI-/TD-/PF-/ENV-` → `['KI','TD','PF','ENV']`） */
  prefixes: string[]
  /** 规则句说的位数（3） */
  digits: number
  /** 规则句举的例子（`KI-325`） */
  example: string
}

/** 正册的一行：号、所在小节、按竖线切出来的格子（认转义形） */
export interface LedgerRow {
  id: string
  line: number
  section: string
  cells: string[]
}

/** 架构 §8.3 指针表的一行 */
export interface SeedRow {
  id: string
  line: number
  title: string
}

/** 已退役拼写名册的一格：它今天是什么（`now` 为 null ＝ 它本来就不是号，是规则句里的例子） ＋ 为什么 */
export interface RetiredSpelling {
  now: string | null
  why: string
}

/** 正册在用的四个前缀（§8.2 那条规则句必须与它逐字相等） */
export const LEDGER_PREFIXES: string[]

/** 正册的号一律几位 */
export const ID_DIGITS: number

/** 已退役的 4 位拼写 → 它今天是什么（那里是旧拼写唯一的家；文档里一个字都不许留） */
export const RETIRED_SPELLINGS: Record<string, RetiredSpelling>

/** 解析架构 §8.2 那条规则句；读不出来返回 null（不猜：读不到就是读不到） */
export function parseIdRule(archText: string): IdRule | null

/** 正册的行（号、所在小节、格子） */
export function ledgerRows(ledgerText: string): LedgerRow[]

/** 架构 §8.3 那张指针表的行（只认 §8.3 那一节） */
export function seedRows(archText: string): SeedRow[]

/** 一个号在正册里只许有一行 */
export function duplicateIdFindings(rows: LedgerRow[]): IdFinding[]

/** 判据①：§8.2 规则句 ↔ 正册实况同形（前缀集合、位数、例子） */
export function ruleSentenceFindings(input: { archText: string; ledgerText: string }): IdFinding[]

/** 判据②：§8.3 指针表 ↔ 正册行（每个号恰好一行） */
export function seedPointerFindings(input: { archText: string; ledgerText: string }): IdFinding[]

/** 判据③：全库只许一套号（4 位拼写只许出现在名册里） */
export function retiredSpellingFindings(input: { files: { rel: string; text: string }[]; registerFile: string }): IdFinding[]

/** 名册自证：每一格说得出身它今天是什么，指的那个号必须真的在正册里有一行 */
export function retiredRegisterFindings(input: { ledgerText: string }): IdFinding[]
