/**
 * `weather-rules.mjs` 的声明（与 `ducking-rules.d.mts` 同一个理由）：判据住在 .mjs 里，
 * `validate-data.mjs` 才能被 node 直接跑；测试要能被 `tsc --noEmit` 检查 ⇒ 中间放这份声明。
 */

/** 校验器报告里那一行的形状：`level` 决定它进 ERROR 还是 WARN 计数 */
export interface WeatherFinding {
  level: 'error' | 'warn'
  file: string
  where: string
  msg: string
}

/** `schema.ts > WeatherRow` 的五格；词表对账（`VOCAB_PAIRS`）读的就是这一张 */
export const WEATHER_FIELDS: string[]
/** 三格读数（`fogDensity` / `brightnessMul` / `contrastMul`）：一行至少要说出一件可观测的事 */
export const WEATHER_READING_FIELDS: string[]
/** 没有读数的天气名走的那一行：`ColorGrade` 的退路，判据⑤盯的就是它 */
export const WEATHER_BASELINE_ID: string
/** 雾密度上界（文档最深一档 Fog 0.030 的四倍） */
export const FOG_DENSITY_MAX: number
/** 明度/对比乘数的合法区间：拦的是数量级手误，不是审美 */
export const GRADE_MUL_RANGE: { min: number; max: number }
/**
 * 欠读数的天气名账本：名字 → "为什么今天给不出读数"（≥20 字，判据④双向盯着它别长_dead_条目）。
 * 它是**对象字面量**而不是 `[` 名单，所以 KI-086 那张手抄名单普查对它没话说；能说话的是判据自己。
 */
export const PENDING_WEATHER_READINGS: { [name: string]: string }

/**
 * 一表天气行 → findings。
 * @param docIds 需求 §38 那四档（由调用方从 `schema.ts > WeatherDocId` 现推；读不到传 null）
 * @param referenced `regions.json > weatherPresets` 去重后的名字（读不到传 null）
 * @param pending 待裁决名单：天气名 → "为什么今天给不出读数"（读不到传 null）
 */
export function weatherFindings(
  file: string,
  rows: unknown,
  docIds: string[] | null,
  referenced: string[] | null,
  pending: { [name: string]: string } | null,
): WeatherFinding[]
