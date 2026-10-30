/** `condition-rules.mjs` 的声明：判据住在 .mjs 里（校验脚本要能被 node 直接跑），测试要能被 `tsc --noEmit`
 *  检查 ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `ambience-rules.d.mts` 同一个理由）。 */

/** `state.K==V` / `state.K!=V` 那一形 */
export const STATE_TERM_RE: RegExp

/** 条件里的一个旗标读方（`name` = 去掉 `!` 之后交给 `has(key)` 的那个键） */
export interface ConditionFlagTerm {
  name: string
  negated: boolean
  term: string
}

/** 条件里的一个状态读方 */
export interface ConditionStateTerm {
  key: string
  op: '==' | '!='
  value: string
  term: string
}

/** 形状不合法的那一项（运行时的读法是"该项为假"，门禁一侧要点名） */
export interface ConditionBadTerm {
  term: string
  why: string
}

/** 一串条件 ⇒ 三个桶 */
export interface ConditionTerms {
  flags: ConditionFlagTerm[]
  states: ConditionStateTerm[]
  bad: ConditionBadTerm[]
}

/** 读一串条件。非字符串也有说法而不抛（调用方那一格自己报"必须是非空字符串"） */
export function readCondition(expr: unknown): ConditionTerms

/** 一串条件里所有旗标的名字（给旗标双向对账登记读方用） */
export function conditionFlagNames(expr: unknown): string[]

/** 一份陈设里条件语言问出口的读方名册：键 = 旗名／`state.KEY`，值 = 第一次读到它的那一格（`where`） */
export interface ConditionRosters {
  flags: Map<string, string>
  states: Map<string, string>
}

/**
 * 遍历 `regions.json` 的两个条件宿主（`spawnGroups[].condition` 与 `music.ambienceVariants[].condition`），
 * 交出读方名册两张。非数组／null 行／条件不是字符串都不抛（那些形状由校验器按宿主点名报错）。
 */
export function conditionReadsOf(regions: unknown): ConditionRosters

/** 把名册并进普查那一张 Map（已有条目赢）；返回真正加进去的格数 */
export function mergeConditionReads(target: Map<string, string>, roster: unknown): number
