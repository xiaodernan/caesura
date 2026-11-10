/** `scripts/caesura-cache-guard.mjs` 的声明：缓存防护三件套——击穿 / 穿透 / 雪崩（KI-501）。 */

/** 缺省教学参数（判定仍由注入值定）。 */
export const GUARD_DEFAULTS: Readonly<{
  concurrency: number
  ttlMs: number
  beta: number
  keys: number
  absentRatio: number
  rounds: number
  jitterRatio: number
  buckets: number
  missingValue: string
}>

export interface GuardBaseOptions {
  now?: () => number
  rand?: () => number
  seed?: number
  cacheFactory?: () => GuardCache
}

/** 一片教学缓存的最小判定面（KI-493 createRedisCache 的形状）。 */
export interface GuardCache {
  get(k: any): any
  set(k: any, v: any, ttlMs?: number): any
  load?(k: any, loader: (...args: any[]) => any, ttlMs?: number): Promise<any>
  stats?(): any
}

export interface GuardBloom {
  add(k: any): any
  mightHave(k: any): boolean
  stats?(): { falsePositives?: number; estimatedFpRate?: number; [k: string]: any }
}

export interface StampedeOptions extends GuardBaseOptions {
  concurrency?: number
  ttlMs?: number
  beta?: number
  loader?: () => Promise<any>
}

export interface StampedeComparison {
  concurrency: number
  ttlMs: number
  beta: number
  key: string
  /** 无防护：N 个并发各真调一次 loader 的次数。 */
  naiveLoads: number
  /** singleflight（KI-493 load）真被合并到的 loader 次数（正常为 1）。 */
  singleflightLoads: number
  savedLoads: number
  /** 放大倍数 naive/singleflight（0 并发为 null）。 */
  amplification: number | null
  xfetchEarlyRefreshes: number
  xfetchAvoidedMisses: number
}

/** ① 击穿对照（异步：真跑并发 loader + singleflight）。 */
export function compareStampede(opts?: StampedeOptions): Promise<StampedeComparison>

/** XFetch / 概率提前过期判据（纯函数）；P(age)=min(1, beta·age/ttl)，rand()<P 则提前续期。 */
export function shouldEarlyExpire(o: {
  ageMs: number
  ttlMs: number
  beta: number
  rand?: () => number
}): boolean

export interface PenetrationOptions extends GuardBaseOptions {
  /** 显式 key 列（存在 + 不存在）；给了就用它，否则按 keysCount 造 `q:i`。 */
  keys?: any[]
  keysCount?: number
  /** 库里真有的 key；不给则按 absentRatio 把前面一段当存在。 */
  presentKeys?: any[]
  absentRatio?: number
  rounds?: number
  negativeTtlMs?: number
  tombstone?: any
  bloom?: () => GuardBloom
  bloomOpts?: Record<string, any>
}

export interface PenetrationComparison {
  keys: number
  present: number
  absent: number
  rounds: number
  /** 无防护：不存在 key × rounds 次回源。 */
  naiveDbHits: number
  /** 空值墓碑（KI-493）：只首轮回源。 */
  negativeDbHits: number
  /** 布隆放行（含假阳性）的回源。 */
  bloomDbHits: number
  /** 布隆负查直接拒绝、0 次回源的 key 数。 */
  bloomRejected: number
  /** 诚实暴露的假阳性数（不零误判）。 */
  bloomFalsePositives: number | null
  bloomEstimatedFpRate: number | null
  /** 布隆省下的回源比例（naive 为 0 时 null）。 */
  bloomSavedRate: number | null
}

/** ② 穿透对照（同步：三路回源计数）。 */
export function comparePenetration(opts?: PenetrationOptions): PenetrationComparison

export interface AvalancheOptions {
  keys?: number
  ttlMs?: number
  jitterRatio?: number
  buckets?: number
  rand?: () => number
  seed?: number
}

export interface AvalancheComparison {
  keys: number
  ttlMs: number
  jitterRatio: number
  buckets: number
  /** 统一 TTL：单 bucket 峰值（＝全量）。 */
  uniformPeak: number
  /** TTL 抖动后单 bucket 峰值（下降）。 */
  jitterPeak: number
  /** 峰值削减比例 (uniform−jitter)/uniform。 */
  peakReduction: number
  uniformBuckets: number
  jitterBuckets: number
  totalExpirations: number
  histogram: { uniform: number[]; jitter: number[] }
}

/** ③ 雪崩对照（同步：统一 TTL vs TTL 抖动的过期 bucket 分布）。 */
export function compareAvalanche(opts?: AvalancheOptions): AvalancheComparison

export interface CacheGuardStudyOptions {
  /** 规模：穿透造 keys 个 `q:i`、雪崩跑 keys 个 key（缺省 GUARD_DEFAULTS.keys）。 */
  keys?: number
  /** 显式给穿透的查询 key 列（给了就优先，穿透忽略 keys 规模）。 */
  queryKeys?: any[]
  presentKeys?: any[]
  absentRatio?: number
  rounds?: number
  negativeTtlMs?: number
  tombstone?: any
  bloom?: () => GuardBloom
  bloomOpts?: Record<string, any>
  concurrency?: number
  ttlMs?: number
  beta?: number
  loader?: () => Promise<any>
  jitterRatio?: number
  buckets?: number
  now?: () => number
  rand?: () => number
  seed?: number
  cacheFactory?: () => GuardCache
}

/** 三件汇总成一份纯数据（供 status / 前端）；缺省给击穿 / 雪崩各用不同 seed 的独立 LCG。 */
export interface CacheGuardStudy {
  stampede: StampedeComparison
  penetration: PenetrationComparison
  avalanche: AvalancheComparison
  builtAt: number
}

export function cacheGuardStudy(opts?: CacheGuardStudyOptions): Promise<CacheGuardStudy>

/** 纯数据快照（不夹带函数/Map/缓存实例/Bloom 位数组）。 */
export function guardSnapshot(study: CacheGuardStudy | null): CacheGuardStudy | null
