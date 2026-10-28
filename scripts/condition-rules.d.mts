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
