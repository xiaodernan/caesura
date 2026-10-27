/** `id-scope-rules.mjs` 的声明：判据住在 .mjs 里（它要被 node 直接跑，也要被合成夹具喂），测试要能被 `tsc --noEmit`
 *  检查 ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `id-rules.d.mts` 同一个理由）。 */

/** 一条判据的读数形状：挂在哪一格 ＋ 说清「为什么该红」 */
export interface ScopeFinding {
  key: string
  msg: string
}

/** 交付总体里的一份文件（相对路径 ＋ 原文） */
export interface SurfaceFile {
  rel: string
  text: string
}

/** 读不出来的一份文件（解码器自己的原话） */
export interface UnreadableFile {
  rel: string
  error: string
}

/** 交付总体：四棵树 ＋ 根的具名散文件 */
export interface DeliverySurface {
  files: SurfaceFile[]
  unreadable: UnreadableFile[]
  binaries: string[]
  missing: string[]
}

/** 一个有名有理由的洞（交付总体之外的面积） */
export interface NamedHole {
  area: string
  why: string
}

/** 按号引用的形状：`KI-` ＋ 数字（任何位数——这一格不做归一） */
export const CITATION_RE: RegExp

/** 交付总体之外那些「有名字、有理由」的面积 */
export const NAMED_HOLES: NamedHole[]

/** 交付总体（口径出自 `text-corpus.mjs`，致命解码；读不出来的文件变成可见读数） */
export function deliverySurface(root: string): DeliverySurface

/** 已入库的文件名册（`git ls-tree HEAD` ＝ 提交面；提交过但此刻不在工作树上的单列成 absent） */
export function trackedFiles(root: string): {
  files: SurfaceFile[]
  unreadable: UnreadableFile[]
  binaries: string[]
  absent: string[]
  names: string[]
}

/** 一份文件里带着哪些按号引用（去重、排序） */
export function citedIds(text: string): string[]

/** 一份文件落在总体之外时它属于哪一堆（面积名） */
export function holeArea(rel: string): string

/** 判据①：门实际读到的文件集必须逐份等于交付总体（两个方向的差集都空） */
export function populationFindings(input: { scanned: string[]; surface: string[] }): ScopeFinding[]

/** 判据②：已入库却落在总体之外的面积，每一堆都必须有名字有理由（登记过期也红） */
export function holeFindings(input: { tracked: string[]; surface: string[]; holes: NamedHole[] }): ScopeFinding[]

/** 判据③：带着按号引用的已入库文件，不许落在走查面之外（除非落在有名有理由的洞里） */
export function carrierFindings(input: { tracked: SurfaceFile[]; scanned: string[]; holes: NamedHole[] }): ScopeFinding[]

/** 判据④：账本自己引的号也要读得到行；豁免名册逐条自证（过期也红、泄露也红） */
export function ledgerSelfFindings(input: {
  ledgerText: string
  rowIds: string[]
  exempt: { token: string; why: string }[]
  ledgerRel: string
  registerRel: string
  surfaceFiles: SurfaceFile[]
}): ScopeFinding[]

/** 四条判据的合流 */
export function scopeFindings(input: {
  scanned: string[]
  surface: string[]
  tracked: SurfaceFile[]
  holes: NamedHole[]
  ledgerText?: string
  rowIds?: string[]
  exempt?: { token: string; why: string }[]
  ledgerRel?: string
  registerRel?: string
}): ScopeFinding[]

/** 按号判据里吃文件总体的那两个入口 */
export const GATE_ENTRIES: string[]

/** 一个文件里"喂给按号判据的文件集"从哪儿来（判据入口的 `files:` 实参 ＋ 自扫引用的循环） */
export function populationSites(text: string): { expr: string; kind: string; pos: number }[]

/** 判据⑤：按号这一族的总体只有一个出处（交付总体或当场拼出来的合成夹具，没有第三样东西） */
export function populationSourceFindings(input: {
  files: SurfaceFile[]
  ownerRel?: string
  minGates?: number
}): ScopeFinding[]
