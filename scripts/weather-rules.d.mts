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
/** §5.9.33③ 三条玩法腿乘数的合法区间（`WeatherRow.gameplay` 的三格；0 与 1 另有专门说法） */
export const GAMEPLAY_MUL_RANGE: { min: number; max: number }
/** `schema.ts > WeatherGameplay` 的三格：敌人浓度／失谐累积速率／声景增益 */
export const WEATHER_GAMEPLAY_FIELDS: string[]
/**
 * 欠读数的天气名账本：名字 → "为什么今天给不出读数"（≥20 字，判据④双向盯着它别长_dead_条目）。
 * 它是**对象字面量**而不是 `[` 名单，所以 KI-086 那张手抄名单普查对它没话说；能说话的是判据自己。
 */
export const PENDING_WEATHER_READINGS: { [name: string]: string }

/**
 * 「这一区的第二格天气今天由谁的条件来」还没裁的那些区（判据 S1）：区 id → 为什么今天给不出条件。
 * 与上面那张欠读数的账同族：条目双向能销（区有了被追踪的钟 ⇒ 该销；区没了第二格 ⇒ 作废）。
 */
export const PENDING_WEATHER_SWITCHES: { [regionId: string]: string }

/**
 * §5.9.33③ 的**裁决账本**：天气名 → "这一行 `gameplay` 的乘数凭什么敢写下来"（≥20 字）。
 * 与两张 `PENDING_*` 不是同一族：那两张记"今天还给不出"，这一张记"今天给了，而文档没有"。
 * 判据 G1（有乘数必须有理由）与 G2（理由对应的行已不声明 ⇒ 该销）两面盯着它。
 */
export const WEATHER_GAMEPLAY_RULINGS: { [name: string]: string }

/**
 * 「修钟之后换天气」那条切换的判据（KI-094②，S1–S5）。量的是三方关系：任务线追踪的旗标 ×
 * 各区 `kind === 'bell'` 交互物立的旗 × 每区声明的 `weatherPresets` 格数。
 * @param regions `regions.json` 的顶层（读不到传 null ⇒ 报"门在空转"）
 * @param questFlags `quests.json > steps[].advanceOn.flags` 的去重名册（由调用方现推；null/空 ⇒ 门在空转）
 * @param pending 欠条件的区域账本：区 id → 理由（读不到传 null）
 */
export function weatherSwitchFindings(
  file: string,
  regions: unknown,
  questFlags: string[] | null,
  pending: { [regionId: string]: string } | null,
  /**
   * S6 对账用的值域登记表（`states.json` 推出的 key → 合法取值）。
   * 不传 = 跳过 key/in 的成员检查（只能拿它当替代哪个调用方真的读了 states.json）。
   */
  stateDefs?: Map<string, { values: string[] }> | null,
): WeatherFinding[]

/**
 * 这一区里"立着被任务线追踪的旗的钟"的旗标名册（判据与读者共用的那一条口径，导出是为了让
 * `tests/unit/weather-switch.test.ts` 能拿真实两张表逐区对账 `src/world/WeatherSwitch.ts > repairBellFlags`）。
 */
export function trackedBellFlags(region: unknown, tracked: ReadonlySet<string>): string[]

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
  /** §5.9.33③ 裁决账本；null = 这一轮不判 G1/G2（调用方读不到账本时门会自己说空转，见下） */
  rulings?: { [name: string]: string } | null,
): WeatherFinding[]
