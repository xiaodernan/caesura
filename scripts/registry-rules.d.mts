/** `registry-rules.mjs` 的声明：判据住在 .mjs 里（它要被 node 直接跑，也要被合成夹具喂），测试要能被 `tsc --noEmit`
 *  检查 ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `ledger-rules.d.mts` 同一个理由）。 */

/** 一条判据的读数形状：挂在哪里 ＋ 说清"为什么该红"（与 `id-rules.mjs` 的 `IdFinding` 同形） */
export interface RegistryFinding {
  key: string
  msg: string
}

/** 每类号（按 ID 前缀）的行形状：`cells` 是按竖线切出来的格数，`status` 是末格是不是 §78 状态列 */
export interface RowShape {
  cells: number
  status: boolean
}

/** 正册的一张表：标题、表头、数据行 */
export interface LedgerTable {
  title: string
  headLine: number
  head: { line: number; cells: string[] } | null
  rows: { line: number; cells: string[]; id: string }[]
}

/** 每类号的行形状（判据本身，写死；数据才不许写死） */
export const ROW_SHAPES: Record<string, RowShape>

/** 四张表各自本家的前缀（**键是表号**，标题在正册里带中文后缀 ⇒ 认表不认标题） */
export const TABLE_PREFIX: Record<string, string>

/** 一张表的小节号（`2. Technical Debt（技术债）` → `2`；`1.5 系统状态总表…` → `1.5`） */
export function tableNumber(title: string): string

/** §78 状态词表**从正册自己现推**（不许抄第二份） */
export function statusVocab(ledgerText: string): string[]

/** 正册的表：按 `## ` 标题切，每张表带表头与数据行 */
export function ledgerTables(ledgerText: string): LedgerTable[]

/** 判据 I1：非 KI 行按前缀判形状 ＋ 末格状态；每张表的表头列数按它本家那类行判 */
export function rowShapeFindings(ledgerText: string): RegistryFinding[]

/** 判据 I2：全库 `TD-`/`PF-`/`ENV-` 的按号引用必须读得到行（活着的行，或注记里已销案的号） */
export function idReferenceFindings(input: { files: { rel: string; text: string }[]; ledgerText: string }): RegistryFinding[]

/** 判据 I3：§1.5「系统状态总表」那一行的格数必须与表头一致（缺口栏里的裸竖线） */
export function statusOverviewFindings(ledgerText: string): RegistryFinding[]

/** 名册自证：§8.2 规则句喊的每个前缀在正册里都得真有一行 */
export function prefixCoverageFindings(ledgerText: string): RegistryFinding[]
