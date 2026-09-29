/**
 * `validator-map-rules.mjs` 的声明：判据住在 .mjs 里（校验脚本要能被 node 直接跑），测试要能被
 * `tsc --noEmit` 检查 ⇒ 两边中间放这份声明（与 `ducking-rules.d.mts` 同一个理由）。
 */

/** 校验器报告里那一行的形状（本门只出 ERROR：一条没交代的缝不存在"可以忽略"的那种） */
export interface ValidatorFinding {
  level: 'error'
  file: string
  where: string
  msg: string
}

/** 一个顶层校验函数的读数：两端都由 `scripts/schema-vocab.mjs` 的抽取器从源码现推，不许手抄 */
export interface ValidatorReading {
  name: string
  /** false = `matchBrace` 切不出这个函数的体 ⇒ 它报哪张表无从知道 */
  bodyOk: boolean
  /** 它报的表（函数里 `const file = '…'` 的读数）；null/空 = 一张都不报（全局对账，需要豁免） */
  subjects: string[] | null
  /** 它读过的表（函数里 `data['…']` 的键读数） */
  reads: string[] | null
  /** 它有没有走 `data[file]` 这一种变量式（那等价于"读自己那一张"） */
  readsVar: boolean
}

/** 一条"确实不报任何表"的豁免：`why` 说凭什么，缺了它豁免本身就算一条没交代的缝 */
export interface SubjectWaiver {
  name: string
  why: string
}

/** `SUBJECT_WAIVERS` 那一行的字段白名单 */
export const MAP_WAIVER_FIELDS: string[]

/**
 * 名册 ⇄ 校验函数的对账 → findings。只读不改，也不认识任何文件。
 * @param roster `FILES` 的读数（`arrayLiterals` 现推）；null/空 ⇒ 报"这道门在空转"
 * @param calls 主循环里被调用过的 `validateX(` 名字读数（`calledNames` 现推）
 */
export function mapFindings(input: {
  file: string
  roster: string[] | null
  validators: ValidatorReading[] | null
  calls: string[] | null
  waivers?: SubjectWaiver[]
}): ValidatorFinding[]
